// Builds an x402 version 2 "exact" payment on Base for a browser wallet, the same way @x402/core and
// @x402/evm do, so the wallet signs and the key never leaves it. agent/test/x402pay.test.ts checks this
// module against those libraries, byte for byte.
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const BASE_CHAIN_ID = 8453;

const b64encode = (s) => btoa(Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join(""));
const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

/** The PAYMENT-REQUIRED header of a 402 answer, decoded. */
export function decodeRequired(header) { return JSON.parse(b64decode(header)); }

/** The requirement to pay: exact scheme on Base mainnet. */
export function pickRequirement(required) {
  return (required.accepts || []).find((a) => a.scheme === "exact" && a.network === "eip155:8453") || null;
}

/** Reasons not to sign this requirement; empty when it matches the quote and the destination in force. */
export function requirementProblems(acc, destination, feeMicro) {
  const out = [];
  if (!acc) return ["the endpoint offered no exact payment on Base"];
  if (String(acc.payTo).toLowerCase() !== String(destination).toLowerCase()) out.push(`it asks to pay ${acc.payTo}, not the destination in force ${destination}`);
  if (BigInt(acc.amount) !== BigInt(feeMicro)) out.push(`it asks for ${acc.amount} micro-USDC, not the quoted ${feeMicro}`);
  if (String(acc.asset).toLowerCase() !== BASE_USDC.toLowerCase()) out.push(`it names asset ${acc.asset}, not USDC on Base`);
  if (!acc.extra || !acc.extra.name || !acc.extra.version) out.push("it lacks the token's signing domain");
  return out;
}

/** The EIP-3009 authorization and the EIP-712 typed data a wallet signs (eth_signTypedData_v4). */
export function authorization(acc, from, nowSeconds, nonceHex) {
  return { from, to: acc.payTo, value: String(acc.amount), validAfter: "0", validBefore: String(nowSeconds + Number(acc.maxTimeoutSeconds)), nonce: nonceHex };
}
export function typedData(acc, auth) {
  return {
    types: {
      EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
      TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }],
    },
    primaryType: "TransferWithAuthorization",
    domain: { name: acc.extra.name, version: acc.extra.version, chainId: BASE_CHAIN_ID, verifyingContract: acc.asset },
    message: auth,
  };
}

/** The PAYMENT-SIGNATURE header for the retried request. */
export function paymentHeader(required, acc, auth, signature) {
  const payload = { x402Version: required.x402Version, payload: { authorization: auth, signature } };
  if (required.extensions) payload.extensions = required.extensions;
  payload.resource = required.resource;
  payload.accepted = acc;
  return b64encode(JSON.stringify(payload));
}

/** A fresh 32-byte nonce as 0x-hex. */
export function newNonce() {
  return "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
}
