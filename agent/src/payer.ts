#!/usr/bin/env node
/**
 * nomicon-pay <pull request number> [--key <file>] [--repo <owner/name>] [--yes]
 *
 * Pays a Nomicon quote in one step, after checking it. It reads the quote the agent posted on the
 * pull request, checks that the agent account posted it, that the destination is the one in force in
 * ledger/state.json, that the quote has not expired, and that the paying wallet holds enough USDC; it
 * shows all of that and asks before paying. Then it pays through the agent's x402 endpoint.
 *
 * Use a small wallet kept only for this, holding a few dollars: the key file sits on disk as text.
 * The key (0x followed by 64 hex characters) is read from the file given by --key, or by
 * NOMICON_PAYER_KEY. It is used only to sign the payment authorization and is never sent anywhere.
 * GITHUB_TOKEN is optional; without it GitHub allows 60 reads an hour, which is plenty.
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";

const USDC: Record<string, Hex> = {
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};
const CHAINS = { "eip155:8453": base, "eip155:84532": baseSepolia } as const;

export type Quote = Record<string, string>;

/** The fields of the fenced `nomicon-quote` block in an agent comment, or null when there is none. */
export function parseQuote(body: string): Quote | null {
  const m = /```nomicon-quote\r?\n([\s\S]*?)\r?\n```/.exec(body);
  if (!m) return null;
  const q: Quote = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) q[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return q;
}

/** Every reason not to pay this quote; empty when it may be paid. */
export function quoteProblems(q: Quote, pr: number, destinationInForce: string, now: number, pull?: { state: string; head: string }): string[] {
  const out: string[] = [];
  if (Number(q["pr"]) !== pr) out.push(`the quote names pull request ${q["pr"]}, not ${pr}`);
  if (pull && pull.state !== "open") out.push(`pull request #${pr} is ${pull.state}: nothing to pay`);
  if (pull && pull.state === "open" && pull.head !== q["head"]) out.push(`pull request #${pr} changed after the quote (quoted ${String(q["head"]).slice(0, 7)}, now ${pull.head.slice(0, 7)}); paying would pay for a version that is gone, and the agent quotes the current one on its next pass`);
  const network = q["network"] ?? "";
  if (!USDC[network]) out.push(`unknown network ${network}`);
  let dest = "";
  try { dest = getAddress(q["destination"] ?? ""); } catch { out.push(`the quote's destination ${q["destination"]} is not an address`); }
  if (dest && dest !== getAddress(destinationInForce)) out.push(`the quote's destination ${dest} is not the destination in force, ${destinationInForce}`);
  const expires = Date.parse(q["expires"] ?? "");
  if (!(expires > now)) out.push(`the quote expired at ${q["expires"]}; the agent will issue a new one`);
  if (!/^\d+(\.\d{1,6})?$/.test(q["fee_usdc"] ?? "")) out.push(`the fee ${q["fee_usdc"]} is not an amount`);
  const pay = q["pay"] ?? "";
  if (!pay.endsWith(`/pay/${pr}`)) out.push(`the pay address ${pay} is not this pull request's`);
  if (network === "eip155:8453" && !/^https:\/\//.test(pay)) out.push(`the pay address ${pay} is not https`);
  return out;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function fail(msg: string): never {
  console.error(`\nStopped: ${msg}`);
  process.exit(1);
}

async function gh(path: string): Promise<unknown> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "nomicon-pay" };
  if (process.env["GITHUB_TOKEN"]) headers["authorization"] = `Bearer ${process.env["GITHUB_TOKEN"]}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) fail(`GitHub answered ${res.status} for ${path}`);
  return res.json();
}

async function raw(repo: string, file: string): Promise<string> {
  const res = await fetch(`https://raw.githubusercontent.com/${repo}/main/${file}`);
  if (!res.ok) fail(`could not read ${file} from ${repo} (${res.status})`);
  return res.text();
}

async function main(): Promise<void> {
  const pr = Number(process.argv[2]);
  if (!Number.isInteger(pr) || pr <= 0) fail("usage: nomicon-pay <pull request number> [--key <file>] [--repo <owner/name>] [--yes]");
  const repo = arg("repo") ?? "nomicon-world/nomicon";
  const keyFile = arg("key") ?? process.env["NOMICON_PAYER_KEY"];
  if (!keyFile) fail("give the paying wallet's key file with --key <file> (or set NOMICON_PAYER_KEY)");
  const key = readFileSync(keyFile, "utf8").trim() as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) fail(`${keyFile} must hold one private key: 0x followed by 64 hex characters`);
  const account = privateKeyToAccount(key);

  // What is in force, read from the repository itself.
  const state = JSON.parse(await raw(repo, "ledger/state.json")) as { agent_account?: number; fee?: { destination?: string } };
  const agentId = state.agent_account;
  const destInForce = state.fee?.destination;
  if (!agentId || !destInForce) fail("ledger/state.json does not name the agent account and the destination in force");

  // The latest quote on the pull request, posted by the agent account and nobody else.
  const comments = (await gh(`/repos/${repo}/issues/${pr}/comments?per_page=100`)) as Array<{ body?: string; user?: { id?: number } }>;
  const others = comments.filter((c) => c.user?.id !== agentId && /```nomicon-quote/.test(c.body ?? ""));
  if (others.length) console.log(`Warning: ignored ${others.length} quote-like comment(s) from other accounts. Only the agent issues quotes.`);
  const quotes = comments.filter((c) => c.user?.id === agentId).map((c) => parseQuote(c.body ?? "")).filter((q): q is Quote => q !== null);
  const q = quotes[quotes.length - 1];
  if (!q) fail(`no quote from the agent account (${agentId}) on pull request #${pr} yet; the agent posts one a few minutes after screening`);

  const pullInfo = (await gh(`/repos/${repo}/pulls/${pr}`)) as { state?: string; merged?: boolean; head?: { sha?: string } };
  const pull = { state: pullInfo.merged ? "merged" : (pullInfo.state ?? "unknown"), head: pullInfo.head?.sha ?? "" };
  const problems = quoteProblems(q, pr, destInForce, Date.now(), pull);
  if (problems.length) fail(problems.join("; "));

  const network = q["network"]!;
  const chain = CHAINS[network as keyof typeof CHAINS];
  const fee = q["fee_usdc"]!;
  const feeMicro = parseUnits(fee, 6);
  const pub = createPublicClient({ chain, transport: http() });
  const balance = await pub.readContract({ address: USDC[network]!, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const mins = Math.round((Date.parse(q["expires"]!) - Date.now()) / 60000);

  console.log(`
Nomicon quote for pull request #${pr} in ${repo}
  fee              ${fee} USDC  (${q["tax"] && q["tax"] !== "none" ? `includes ${q["tax"]}` : "no tax"})
  layer            ${q["layer"]}, base ${q["base_usdc"]} x ${q["multiplier"]}
  destination      ${q["destination"]}  (matches the destination in force)
  network          ${network}
  pay via          ${q["pay"]}
  expires          ${q["expires"]}  (in about ${mins} min)
  queue ahead      ${q["queue_ahead"] ?? "0"}
  terms accepted   TERMS.md at commit ${q["terms_commit"]}
  paying wallet    ${account.address}, holds ${formatUnits(balance, 6)} USDC
`);
  if (balance < feeMicro) fail(`the paying wallet holds ${formatUnits(balance, 6)} USDC, less than the fee`);

  if (!process.argv.includes("--yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`Pay ${fee} USDC and accept the Terms at that commit? Type yes to pay: `)).trim().toLowerCase();
    rl.close();
    if (answer !== "yes") fail("not paid");
  }

  const client = x402Client.fromConfig({
    schemes: [{ network: network as `${string}:${string}`, client: new ExactEvmScheme(account) }],
    spendControls: { maxAmountPerPayment: `$${fee}` },
  });
  const fetchWithPay = wrapFetchWithPayment(fetch, client);
  console.log("Paying...");
  const res = await fetchWithPay(q["pay"]!, { method: "POST" });
  const body = await res.text();
  let parsed: { transaction?: string; error?: string } = {};
  try { parsed = JSON.parse(body); } catch { /* keep the raw body */ }
  if (res.ok && parsed.transaction) {
    const explorer = network === "eip155:8453" ? "https://basescan.org/tx/" : "https://sepolia.basescan.org/tx/";
    console.log(`\nPaid. Transaction ${parsed.transaction}\n${explorer}${parsed.transaction}\nThe agent records it in the ledger and opens the vote when a place is free.`);
    return;
  }
  fail(`the endpoint answered ${res.status}: ${parsed.error ?? body.slice(0, 300)}`);
}

// Run only when executed directly, so the tests can import the checks.
if (process.argv[1] && /payer\.(js|ts)$/.test(process.argv[1])) main().catch((e) => fail((e as Error).message));
