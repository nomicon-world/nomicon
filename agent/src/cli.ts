#!/usr/bin/env node
/**
 * nomicon <command>
 *
 *   keygen                         print a new ed25519 key pair for ledger signing
 *   genesis                        write the first ledger event (bootstrap begins)
 *   run                            start the agent loop and the payment endpoint
 *   replay                         recompute the ledger and report differences
 *   confirm <pr> <reason>          bootstrap: confirm a contribution
 *   reject <pr> <reason> [--bar]   bootstrap: reject a contribution (--bar applies the Article 4 bar)
 *   release <pr> <reason>          resolve a screening hold by releasing it to a vote
 *   hold-reject <pr> <reason>      resolve a screening hold by rejecting it (applies the bar)
 *   takedown <pr,...> <reason> [notice_hash]
 *   rotate-destination <address> <reason>
 *   set-agent-account <reason>   record that the agent now acts as the GitHub identity its current credentials resolve to
 *   maintenance <from_iso> <to_iso> <reason>
 *   end-bootstrap <reason>
 *   deploy <commit> <reason>
 *   patch <commit> <reason>
 *   amend-laws <reason>            bootstrap only: bring the repository's current laws.json into force now (Article 3)
 *   amend-terms <commit> <provision>  after bootstrap only: record a legally required change to TERMS.md (Article 13), effective 30 days later
 *
 * Environment: NOMICON_REPO_ROOT, NOMICON_LEDGER_KEY (pkcs8 pem or path),
 * GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY (pem or path) [+ GITHUB_APP_INSTALLATION_ID] for the agent's own
 * GitHub App identity, or GITHUB_TOKEN for local testing; GITHUB_OWNER, GITHUB_REPO, NOMICON_NETWORK (eip155:8453 | eip155:84532), BASE_RPC_URL,
 * ANCHOR_PRIVATE_KEY, X402_FACILITATOR_URL, NOMICON_PUBLIC_URL, NOMICON_PORT, ANTHROPIC_API_KEY,
 * NOMICON_OWNER_ACCOUNTS (comma-separated numeric ids), NOMICON_AGENT_ACCOUNT, NOMICON_FEE_DESTINATION,
 * NOMICON_DOORBELL_ISSUE (issue number accounts comment on to register a doorbell; unset disables),
 * NOMICON_DATA_DIR (private directory for doorbell URLs; default <repo root>/../nomicon-private),
 * CDP_API_KEY_ID + CDP_API_KEY_SECRET (Coinbase facilitator, required on Base mainnet) or X402_FACILITATOR_URL (testnets),
 * ANCHOR_PRIVATE_KEY (gas wallet for ledger anchors, required on mainnet), NOMICON_USDC_CAD (fixed rate; unset = Bank of Canada daily),
 * NOMICON_SCREEN_MODEL (default claude-opus-5-5), NOMICON_TRUST_PROXY=1 behind a reverse proxy that sets X-Forwarded-For,
 * NOMICON_DOORBELL_ALLOW_PRIVATE=1 accepts http and private doorbell addresses (local testing only).
 */
import { generateKeyPairSync } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ledger, ROTATION_WAIT_DAYS, Signer, keyInForce, samePem } from "./ledger.js";
import { replayFromFiles } from "./replay.js";
import { Runtime } from "./runtime.js";
import { FileDoorbellStore, GitHubAdapter, HttpDoorbell } from "./adapters/github.js";
import { octokitFor, parseGitHubAuthEnv, type GitHubIdentity } from "./adapters/auth.js";
import { Notifier } from "./notifier.js";
import { BaseChainAdapter, USDC } from "./adapters/chain.js";
import { ClaudeScreen } from "./screen.js";
import { createPayServer, describeFacilitator, type FacilitatorChoice } from "./pay.js";
import { BankOfCanadaOracle } from "./adapters/oracle.js";
import { preflight } from "./check.js";
import { loadLaws, sha256Hex } from "./laws.js";
import { phaseOf } from "./phases.js";
import { TERMS_AMENDMENT_NOTICE_DAYS, termsCommitAt } from "./terms.js";
import type { PriceOracle } from "./ports.js";

const env = (k: string, def?: string): string => {
  const v = process.env[k] ?? def;
  if (v === undefined) throw new Error(`missing environment variable ${k}`);
  return v;
};
const root = () => resolve(env("NOMICON_REPO_ROOT", process.cwd()));
const now = () => Math.floor(Date.now() / 1000);

function signer(): Signer {
  const k = env("NOMICON_LEDGER_KEY");
  const pem = existsSync(k) ? readFileSync(k, "utf8") : k;
  return new Signer(pem);
}
function ledger(): Ledger {
  const p = resolve(root(), "ledger/public-key.pem");
  return new Ledger(resolve(root(), "ledger"), signer(), existsSync(p) ? readFileSync(p, "utf8") : undefined);
}

/** The public key signing the ledger now: the Constitution's key (ledger/public-key.pem) followed through rotations. */
function ledgerKeyInForce(led: Ledger): { inForce: string; configured: string; matches: boolean } {
  const p = resolve(root(), "ledger/public-key.pem");
  const initial = existsSync(p) ? readFileSync(p, "utf8") : signer().publicKeyPem();
  const inForce = keyInForce(led.events, initial), configured = signer().publicKeyPem();
  return { inForce, configured, matches: samePem(inForce, configured) };
}

/** Article 11: rotate the ledger signing key. Planned rotations are signed by the key in force; after a lost key the new key signs after the waiting period. */
async function rotateKey(args: string[], lost: boolean): Promise<void> {
  const led = ledger();
  const by = env("NOMICON_OWNER_ACCOUNTS").split(",")[0]!;
  if (!lost) {
    const [pubPath, commit, ...rest] = args;
    if (!pubPath || !commit || !rest.length) throw new Error('usage: nomicon rotate-key <new-public-key.pem> <announcing commit sha> "<reason>"');
    const k = ledgerKeyInForce(led);
    if (!k.matches) throw new Error("the configured NOMICON_LEDGER_KEY is not the key in force; the key in force must sign a planned rotation");
    const next = readFileSync(pubPath, "utf8");
    if (!next.includes("BEGIN PUBLIC KEY")) throw new Error(`${pubPath} is not a public key PEM`);
    const e = led.append(now(), "key_rotation", { new_public_key: next, commit, reason: rest.join(" "), by });
    console.log(`recorded event ${e.id}: key_rotation. Switch NOMICON_LEDGER_KEY to the new private key and restart the agent; the old key signs nothing from now on.`);
    return;
  }
  const [privPath, tx, ...rest] = args;
  if (!privPath || !tx || !rest.length) throw new Error('usage: nomicon rotate-key-lost <new-private-key.pem> <announcing transaction hash> "<reason>"');
  const next = new Signer(readFileSync(privPath, "utf8"));
  const network = env("NOMICON_NETWORK", "eip155:84532") as Network;
  const chain = new BaseChainAdapter(network, env("BASE_RPC_URL"));
  const t = await chain.transactionDetails(tx);
  if (!t) throw new Error("that transaction is not found or did not succeed on the fee network");
  const dest = replayFromFiles(root(), now()).state.fee.destination;
  if (!dest || t.from.toLowerCase() !== dest.toLowerCase()) throw new Error(`the announcement must come from the fee destination in force ${dest}; this transaction is from ${t.from}`);
  const want = "0x" + sha256Hex(next.publicKeyPem());
  if (t.input.toLowerCase() !== want.toLowerCase()) throw new Error("the transaction's data is not the SHA-256 of the new public key");
  if (now() - t.blockTime < ROTATION_WAIT_DAYS * 86400) throw new Error(`the announcement must be at least ${ROTATION_WAIT_DAYS} days old; its block is ${Math.floor((now() - t.blockTime) / 86400)} days old`);
  const l = new Ledger(resolve(root(), "ledger"), next, next.publicKeyPem());
  const e = l.append(now(), "key_rotation", { new_public_key: next.publicKeyPem(), tx, announced_at: t.blockTime, announced_from: t.from, lost: true, reason: rest.join(" "), by });
  console.log(`recorded event ${e.id}: key_rotation after a lost key. Set NOMICON_LEDGER_KEY to ${privPath} and restart the agent.`);
}

/** The agent account in force: genesis, then any owner change of custody (Article 6). */
function agentAccountInForce(events: Ledger["events"]): number | null {
  let id: number | null = null;
  for (const e of events) if ((e.type === "genesis" || e.type === "agent_account_change") && e["agent_account"] !== undefined) id = Number(e["agent_account"]);
  return id;
}

async function githubFromEnv(): Promise<{ github: GitHubAdapter; identity: GitHubIdentity }> {
  const owner = env("GITHUB_OWNER"), repo = env("GITHUB_REPO");
  const { octokit, identity } = await octokitFor(parseGitHubAuthEnv(process.env), owner, repo);
  return { github: new GitHubAdapter(owner, repo, octokit), identity };
}

function ownerCommand(type: Parameters<Ledger["append"]>[1], fields: Record<string, unknown>): void {
  const l = ledger();
  const e = l.append(now(), type, { ...fields, by: env("NOMICON_OWNER_ACCOUNTS").split(",")[0]! });
  console.log(`recorded event ${e.id}: ${type}`);
}

async function main(argv: string[]): Promise<void> {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case "keygen": {
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      console.log(privateKey.export({ type: "pkcs8", format: "pem" }));
      console.log(publicKey.export({ type: "spki", format: "pem" }));
      console.log(`sha256 of the public key, the data a lost-key announcement carries (Article 11): 0x${sha256Hex(publicKey.export({ type: "spki", format: "pem" }) as string)}`);
      return;
    }
    case "genesis": {
      const l = ledger();
      if (l.head > 0) throw new Error("ledger already has events");
      const { hash, raw } = loadLaws(root());
      const rawSchema = readFileSync(resolve(root(), "laws.schema.json"), "utf8");
      const head = args[0] ?? env("NOMICON_HEAD_COMMIT");
      const e = l.append(now(), "genesis", {
        head, laws_hash: hash,
        owner_accounts: env("NOMICON_OWNER_ACCOUNTS").split(",").map(Number),
        owner_keys: [signer().publicKeyPem()],
        agent_account: process.env["NOMICON_AGENT_ACCOUNT"] ? Number(process.env["NOMICON_AGENT_ACCOUNT"]) : (await githubFromEnv()).identity.id,
        fee_destination: env("NOMICON_FEE_DESTINATION"),
        network: env("NOMICON_NETWORK"),
      });
      l.append(now(), "laws_snapshot", { pr: null, laws_hash: hash, laws_raw: raw, schema_raw: rawSchema, effective_at: e.at, merge_commit: head });
      console.log(`genesis recorded as event ${e.id}; bootstrap has begun`);
      return;
    }
    case "replay": {
      const r = replayFromFiles(root(), now());
      if (r.ok) console.log(`replay ok: ${r.state.head_event} events, ${r.state.weighted_accounts} weighted accounts, base fee ${r.state.fee.base_micro} micro`);
      else { for (const f of r.findings) console.log(`event ${f.event}: ${f.problem}`); process.exitCode = 1; }
      return;
    }
    case "confirm": ownerCommand("owner_confirm", { pr: Number(args[0]), reason: args.slice(1).join(" ") }); return;
    case "reject": {
      const bar = args.includes("--bar");
      const reason = args.slice(1).filter((a) => a !== "--bar").join(" ");
      const fields: Record<string, unknown> = { pr: Number(args[0]), reason };
      if (bar) { const l = loadLaws(root()).laws; fields["barred_until"] = now() + l.screening.floor_rejection_bar_days * 86400; }
      ownerCommand("owner_reject", fields); return;
    }
    case "release": ownerCommand("hold_resolved", { pr: Number(args[0]), decision: "release", reason: args.slice(1).join(" ") }); return;
    case "hold-reject": {
      const l = loadLaws(root()).laws;
      ownerCommand("hold_resolved", { pr: Number(args[0]), decision: "reject", reason: args.slice(1).join(" "), barred_until: now() + l.screening.floor_rejection_bar_days * 86400 }); return;
    }
    case "takedown": ownerCommand("takedown", { prs: args[0]!.split(",").map(Number), reason: args[1], notice_hash: args[2] ?? null }); return;
    case "rotate-destination": ownerCommand("destination_change", { destination: args[0], reason: args.slice(1).join(" ") }); return;
    case "set-agent-account": {
      const reason = args.join(" ").trim();
      if (!reason) throw new Error('usage: nomicon set-agent-account "<reason>"');
      const { identity } = await githubFromEnv();
      if (agentAccountInForce(ledger().events) === identity.id) { console.log(`${identity.login} (${identity.id}) is already the agent account in force`); return; }
      ownerCommand("agent_account_change", { agent_account: identity.id, login: identity.login, reason });
      return;
    }
    case "maintenance": ownerCommand("declare", { what: "maintenance_window", from: Math.floor(Date.parse(args[0]!) / 1000), to: Math.floor(Date.parse(args[1]!) / 1000), reason: args.slice(2).join(" ") }); return;
    case "end-bootstrap": ownerCommand("declare", { what: "bootstrap_end", reason: args.join(" ") }); return;
    case "deploy": ownerCommand("deploy", { commit: args[0], reason: args.slice(1).join(" ") }); return;
    case "patch": ownerCommand("patch", { commit: args[0], reason: args.slice(1).join(" ") }); return;
    case "amend-laws": {
      const l = ledger();
      if (l.events.some((e) => e.type === "declare" && e["what"] === "bootstrap_end")) throw new Error("bootstrap has ended; the Laws change only by the Laws procedure");
      const { hash, raw } = loadLaws(root());
      const rawSchema = readFileSync(resolve(root(), "laws.schema.json"), "utf8");
      let head = process.env["NOMICON_HEAD_COMMIT"] || "";
      try { head = execSync("git rev-parse HEAD", { cwd: root(), encoding: "utf8" }).trim(); } catch { /* keep env value */ }
      const e = l.append(now(), "laws_snapshot", { pr: null, laws_hash: hash, laws_raw: raw, schema_raw: rawSchema, effective_at: now(), merge_commit: head, amended_by_owner: true, reason: args.join(" "), by: env("NOMICON_OWNER_ACCOUNTS").split(",")[0]! });
      console.log(`laws ${hash.slice(0, 12)} in force now as event ${e.id} (owner amendment during bootstrap)`);
      return;
    }
    case "amend-terms": {
      const commit = (args[0] ?? "").toLowerCase(), provision = args.slice(1).join(" ").trim();
      if (!/^[0-9a-f]{40}$/.test(commit) || !provision) throw new Error('usage: nomicon amend-terms <full commit of the new TERMS.md on main> "<the statute, regulation or decision that requires it>"');
      const l = ledger();
      if (!l.events.some((e) => e.type === "declare" && e["what"] === "bootstrap_end")) throw new Error("bootstrap has not ended; amend TERMS.md directly under Article 3");
      const previous = termsCommitAt(l.events, now(), env("NOMICON_TERMS_COMMIT", "main"));
      if (previous === commit) throw new Error("that commit is already the Terms in force");
      const effective_at = now() + TERMS_AMENDMENT_NOTICE_DAYS * 86400;
      ownerCommand("declare", { what: "terms_amendment", commit, previous_commit: previous, provision, effective_at });
      console.log(`TERMS.md at ${commit.slice(0, 12)} takes effect at ${new Date(effective_at * 1000).toISOString()} for quotes issued after that; quotes until then cite ${previous.slice(0, 12)}`);
      return;
    }
    case "run": return run();
    case "record-payment": return recordPayment(Number(args[0]), args[1] ?? "");
    case "lift-bar": {
      const account = Number(args[0]), reason = args.slice(1).join(" ").trim();
      if (!account || !reason) throw new Error('usage: nomicon lift-bar <account id> "<reason>"');
      ownerCommand("bar_lifted", { account, reason }); return;
    }
    case "name-owner": {
      const account = Number(args[0]), reason = args.slice(1).join(" ").trim();
      if (!account || !reason) throw new Error('usage: nomicon name-owner <account id> "<reason>"');
      ownerCommand("owner_accounts_change", { account, effective_at: now() + 14 * 86400, reason }); return;
    }
    case "pending": return pending();
    case "rotate-key": return rotateKey(args, false);
    case "rotate-key-lost": return rotateKey(args, true);
    case "migrate-ledger": { const n = Ledger.migrate(resolve(root(), "ledger")); console.log(`moved ${n} events into ledger/events/ by day; head.json written; events.jsonl removed`); return; }
    case "check": return check();
    default:
      console.log("usage: nomicon <keygen|genesis|run|replay|confirm|reject|release|hold-reject|takedown|rotate-destination|set-agent-account|maintenance|end-bootstrap|deploy|patch|amend-laws|amend-terms|record-payment|check|migrate-ledger|rotate-key|rotate-key-lost|lift-bar|name-owner|pending>");
      process.exitCode = 1;
  }
}

type Network = "eip155:8453" | "eip155:84532";
const MAINNET: Network = "eip155:8453";

/** Mainnet settles only through a facilitator that supports it; x402.org settles testnets. */
function facilitatorFromEnv(network: Network): FacilitatorChoice {
  const id = process.env["CDP_API_KEY_ID"], secret = process.env["CDP_API_KEY_SECRET"];
  if (id && secret) return { kind: "cdp", apiKeyId: id, apiKeySecret: secret };
  const url = env("X402_FACILITATOR_URL", "https://x402.org/facilitator");
  if (network === MAINNET && /x402\.org/.test(url)) throw new Error("x402.org settles test networks only; on Base mainnet set CDP_API_KEY_ID and CDP_API_KEY_SECRET (see RUNBOOK.md, Going to mainnet)");
  return { kind: "url", url };
}

function oracleFromEnv(log: (m: string) => void): PriceOracle {
  const fixed = process.env["NOMICON_USDC_CAD"];
  if (fixed) return { usdcToCad: async () => fixed };
  return new BankOfCanadaOracle("1.37", log);
}

/** Everything the runtime needs, built from the environment; shared by `run` and the owner commands that act through the runtime. */
async function buildRuntime(): Promise<{ rt: Runtime; led: Ledger; chain: BaseChainAdapter; network: Network; log: (m: string) => void; publicBaseUrl: string; trustProxy: boolean }> {
  const network = env("NOMICON_NETWORK", "eip155:84532") as Network;
  const { github, identity } = await githubFromEnv();
  const led = ledger();
  const key = ledgerKeyInForce(led);
  if (!key.matches) throw new Error("NOMICON_LEDGER_KEY is not the ledger signing key in force (Article 11); record a rotation with `nomicon rotate-key`, or configure the key the ledger names");
  const agentAccount = agentAccountInForce(led.events);
  if (agentAccount !== null && agentAccount !== identity.id) throw new Error(`GitHub identity ${identity.login} (${identity.id}) is not the agent account ${agentAccount} in force in the ledger; quotes would come from the wrong account. If the agent's identity changed on purpose, record it with \`nomicon set-agent-account "<reason>"\``);
  const log = (m: string) => console.log(new Date().toISOString(), m);
  log(`github identity: ${identity.login} (${identity.id})`);
  const anchorKey = process.env["ANCHOR_PRIVATE_KEY"] as `0x${string}` | undefined;
  const chain = new BaseChainAdapter(network, env("BASE_RPC_URL"), anchorKey);
  const oracle = oracleFromEnv(log);
  const publicBaseUrl = env("NOMICON_PUBLIC_URL");
  if (network === MAINNET && !publicBaseUrl.startsWith("https://")) throw new Error("NOMICON_PUBLIC_URL must be https on mainnet");
  const doorbellIssue = process.env["NOMICON_DOORBELL_ISSUE"] ? Number(process.env["NOMICON_DOORBELL_ISSUE"]) : null;
  const dataDir = env("NOMICON_DATA_DIR", resolve(root(), "..", "nomicon-private"));
  const allowPrivate = process.env["NOMICON_DOORBELL_ALLOW_PRIVATE"] === "1";
  const trustProxy = process.env["NOMICON_TRUST_PROXY"] === "1";
  if (allowPrivate && network === MAINNET) throw new Error("NOMICON_DOORBELL_ALLOW_PRIVATE must not be set on mainnet");
  if (allowPrivate) log("WARNING: NOMICON_DOORBELL_ALLOW_PRIVATE is set; private doorbell addresses are accepted. Never run like this in production.");
  const notifier = new Notifier({ github, doorbell: new HttpDoorbell({ allowPrivate }), store: new FileDoorbellStore(resolve(dataDir, "doorbells.json")), ledger: led, clock: { now }, log, doorbellIssue, allowPrivateDoorbells: allowPrivate });
  const rt = new Runtime({
    github, chain, screen: new ClaudeScreen(process.env["NOMICON_SCREEN_MODEL"] || undefined), oracle, clock: { now }, ledger: led, publicBaseUrl, notifier,
    ...(process.env["NOMICON_TAX_INCLUDED"] ? { tax: { included: process.env["NOMICON_TAX_INCLUDED"], registration: process.env["NOMICON_TAX_REGISTRATION"] ?? "none" } } : {}),
    loadLaws: async () => ({ rawLaws: await github.readFile("main", "laws.json"), rawSchema: await github.readFile("main", "laws.schema.json") }),
    termsCommit: async () => termsCommitAt(led.events, now(), env("NOMICON_TERMS_COMMIT", "main")),
    log,
  });
  return { rt, led, chain, network, log, publicBaseUrl, trustProxy };
}

async function run(): Promise<void> {
  const { rt, network, publicBaseUrl, trustProxy, log } = await buildRuntime();
  const facilitator = facilitatorFromEnv(network);
  log(`network ${network}, facilitator ${describeFacilitator(facilitator)}`);
  const { server } = await createPayServer({
    network, facilitator,
    quoteFor: (pr) => rt.quoteFor(pr), onPaid: (n) => rt.onPaid(n), now, publicBaseUrl,
    feed: (since) => rt.feed(since), questions: () => rt.questionsIndex(), paths: () => rt.catalog(), job: (option, node) => rt.job(option, node),
    limits: { trustProxy },
  });
  server.listen(Number(env("NOMICON_PORT", "8402")), () => console.log(`payment endpoint on :${env("NOMICON_PORT", "8402")}`));
  const interval = Number(env("NOMICON_TICK_SECONDS", "60")) * 1000;
  for (;;) {
    try { await rt.tick(); } catch (e) { console.error(new Date().toISOString(), "tick failed:", (e as Error).message); }
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Verify the configuration against the live services without moving money. Exit 1 on any failure. */
async function check(): Promise<void> {
  const network = env("NOMICON_NETWORK", "eip155:84532") as Network;
  let facilitator: FacilitatorChoice | Error;
  try { facilitator = facilitatorFromEnv(network); } catch (e) { facilitator = e as Error; }
  const results = await preflight({
    network, rpcUrl: env("BASE_RPC_URL"), usdc: USDC[network], destination: process.env["NOMICON_FEE_DESTINATION"] ?? null,
    publicBaseUrl: process.env["NOMICON_PUBLIC_URL"] ?? "", facilitator, anchorKey: process.env["ANCHOR_PRIVATE_KEY"] ?? null,
    allowPrivate: process.env["NOMICON_DOORBELL_ALLOW_PRIVATE"] === "1", dataDir: env("NOMICON_DATA_DIR", resolve(root(), "..", "nomicon-private")),
    anthropicKey: !!process.env["ANTHROPIC_API_KEY"],
    github: async () => { const { github, identity } = await githubFromEnv(); const pulls = await github.listOpenPulls(); return { ...identity, detail: `${identity.login} (${identity.id}), ${pulls.length} open pull request(s) readable` }; },
    ledgerKey: () => { const k = ledgerKeyInForce(ledger()); return { prefix: k.configured.split("\n")[1]?.slice(0, 16) ?? "", matches: k.matches }; },
    ledger: () => { const l = ledger(); const g = l.events.find((e) => e.type === "genesis"); return g ? { agentAccount: agentAccountInForce(l.events) ?? Number(g["agent_account"]), destination: replayFromFiles(root(), now()).state.fee.destination ?? String(g["fee_destination"]), network: String(g["network"]) } : null; },
  });
  let failed = 0;
  for (const r of results) { if (!r.ok && r.severity === "fail") failed++; console.log(`${r.ok ? "ok  " : r.severity === "fail" ? "FAIL" : "warn"}  ${r.name}: ${r.detail}`); }
  console.log(failed ? `${failed} check(s) failed` : "all checks passed");
  if (failed) process.exitCode = 1;
}

/** What waits on the owner, with the clock on each (Articles 3, 4 and 14). */
async function pending(): Promise<void> {
  const led = ledger(), laws = loadLaws(root()).laws, t = now();
  const days = (s: number) => Math.floor(s / 86400);
  const prs = new Set<number>();
  for (const e of led.events) if (e["pr"] !== undefined && e["pr"] !== null && (e.type === "quote" || e.type === "screen_hold")) prs.add(Number(e["pr"]));
  const rows: string[] = [];
  let oldestWait = 0;
  for (const pr of [...prs].sort((a, b) => a - b)) {
    const p = phaseOf(pr, led.events);
    if (p.kind === "held") rows.push(`pr ${pr}: screening hold, ${days(t - p.since)} of ${laws.screening.hold_timeout_days} days used; release <pr> or hold-reject <pr>`);
    else if (p.kind === "await_owner") rows.push(`pr ${pr}: vote closed (tally ${p.close["tally_result"]}), ${days(t - p.close.at)} of ${laws.bootstrap.owner_action_deadline_days} days used; confirm <pr> or reject <pr>`);
    else if (p.kind === "paid") { const w = t - p.payment.at; oldestWait = Math.max(oldestWait, w); rows.push(`pr ${pr}: paid, waiting ${days(w)} days for a place`); }
  }
  for (const r of rows) console.log(r);
  if (!rows.length) console.log("nothing waits on the owner");
  if (oldestWait >= 60 * 86400) console.log(`WARNING: a paid contribution has waited ${days(oldestWait)} days; at 90 the Article 14 lapse begins`);
}

/** A payment the facilitator settled but the agent failed to record: verify the transfer on chain, then record it through the same path as a live payment. */
async function recordPayment(pr: number, tx: string): Promise<void> {
  if (!pr || !tx) throw new Error("usage: nomicon record-payment <pr> <transaction hash>");
  const { rt, led, chain, network } = await buildRuntime();
  if (led.events.some((e) => e.type === "payment" && String(e["tx"]).toLowerCase() === tx.toLowerCase())) throw new Error("that transaction is already recorded");
  const t = await chain.usdcTransfer(tx, USDC[network]);
  if (!t) throw new Error("no successful USDC transfer found in that transaction");
  const dest = replayFromFiles(root(), now()).state.fee.destination;
  if (!dest || t.to.toLowerCase() !== dest.toLowerCase()) throw new Error(`the transfer went to ${t.to}, not the destination in force ${dest}`);
  await rt.onPaid({ pr, tx, payer: t.from, amountMicro: t.amountMicro, network, acceptedWhileOpen: false });
  console.log(`payment recorded for pr ${pr}: ${t.amountMicro} micro-USDC from ${t.from} in block ${t.blockNumber}`);
}

main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
