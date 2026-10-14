import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { getAddress, verifyTypedData } from "viem";
import { x402Client } from "@x402/core/client";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
// The browser pay page's module (site/pay.html), checked against the libraries the agent and nomicon-pay use.
import * as pay from "../../site/x402pay.js";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const; // a well-known test key
const account = privateKeyToAccount(KEY);
const DEST = getAddress("0x5aeda56215b167893e80b4fe645ba6d5bab767de");
const required = {
  x402Version: 2,
  resource: { url: "https://agent.example/pay/7", description: "Nomicon fee for pull request 7", mimeType: "application/json" },
  accepts: [{ scheme: "exact", network: "eip155:8453", amount: "500000", asset: pay.BASE_USDC, payTo: DEST, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" } }],
} as const;

describe("browser x402 payment", () => {
  it("decodes the 402 header and picks the Base requirement", () => {
    const decoded = pay.decodeRequired(encodePaymentRequiredHeader(required as never));
    expect(decoded).toEqual(required);
    expect(pay.pickRequirement(decoded)).toEqual(required.accepts[0]);
    expect(pay.pickRequirement({ accepts: [{ ...required.accepts[0], network: "eip155:84532" }] })).toBeNull();
  });

  it("refuses a requirement that differs from the quote or the destination in force", () => {
    const acc = required.accepts[0];
    expect(pay.requirementProblems(acc, DEST.toLowerCase(), "500000")).toEqual([]);
    expect(pay.requirementProblems(acc, "0x00000000000000000000000000000000000000Ab", "500000")[0]).toMatch(/destination in force/);
    expect(pay.requirementProblems(acc, DEST, "400000")[0]).toMatch(/quoted 400000/);
    expect(pay.requirementProblems({ ...acc, asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" }, DEST, "500000")[0]).toMatch(/not USDC on Base/);
    expect(pay.requirementProblems(null, DEST, "500000")).toHaveLength(1);
  });

  it("builds the same signed header as @x402/core with @x402/evm, byte for byte", async () => {
    const client = x402Client.fromConfig({ schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(account) }] });
    const lib = await client.createPaymentPayload(required as never);
    const libAuth = (lib.payload as { authorization: Record<string, string> }).authorization;

    // Same nonce and deadline as the library chose; the page signs through the wallet with eth_signTypedData_v4.
    const acc = pay.pickRequirement(required);
    const now = Number(libAuth["validBefore"]) - acc.maxTimeoutSeconds;
    const auth = pay.authorization(acc, account.address, now, libAuth["nonce"]);
    expect(auth).toEqual(libAuth);
    const td = pay.typedData(acc, auth);
    const { EIP712Domain: _, ...types } = td.types;
    const signature = await account.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: auth } as never);
    expect(signature).toBe((lib.payload as { signature: string }).signature);
    expect(await verifyTypedData({ address: account.address, domain: td.domain, types, primaryType: td.primaryType, message: auth, signature } as never)).toBe(true);

    const header = pay.paymentHeader(required, acc, auth, signature);
    expect(header).toBe(encodePaymentSignatureHeader(lib));
    expect(decodePaymentSignatureHeader(header)).toEqual(lib);
  });

  it("makes a fresh 32-byte nonce", () => {
    const a = pay.newNonce(), b = pay.newNonce();
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});
