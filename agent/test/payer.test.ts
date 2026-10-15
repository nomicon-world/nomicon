import { describe, expect, it } from "vitest";
import { parseQuote, quoteProblems } from "../src/payer.js";

const DEST = "0xfdEd1371127F4c22e2Caf355fB058bDc5f579144";
const NOW = Date.parse("2026-10-13T12:00:00Z");

function comment(fields: Record<string, string>): string {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
  return "Paying this quote accepts TERMS.md...\n\n```nomicon-quote\n" + lines.join("\n") + "\n```\nPay within the validity window.";
}

const good = {
  pr: "7", layer: "world", fee_usdc: "1", base_usdc: "1", multiplier: "1",
  destination: DEST.toLowerCase(), network: "eip155:8453",
  pay: "https://agent.nomicon.world/pay/7", expires: "2026-10-14T12:00:00Z", terms_commit: "c2f00ee",
};

describe("nomicon-pay quote checks", () => {
  it("reads the fields of a quote comment", () => {
    const q = parseQuote(comment(good))!;
    expect(q["fee_usdc"]).toBe("1");
    expect(q["pay"]).toBe("https://agent.nomicon.world/pay/7");
    expect(parseQuote("no quote here")).toBeNull();
  });

  it("accepts a sound quote, whatever the address capitalisation", () => {
    expect(quoteProblems(parseQuote(comment(good))!, 7, DEST, NOW)).toEqual([]);
  });

  it("refuses a destination other than the one in force", () => {
    const q = parseQuote(comment({ ...good, destination: "0x000000000000000000000000000000000000dEaD" }))!;
    expect(quoteProblems(q, 7, DEST, NOW).join()).toMatch(/not the destination in force/);
  });

  it("refuses an expired quote, another pull request's quote, and a pay address for another pull request", () => {
    expect(quoteProblems(parseQuote(comment({ ...good, expires: "2026-10-13T11:00:00Z" }))!, 7, DEST, NOW).join()).toMatch(/expired/);
    expect(quoteProblems(parseQuote(comment(good))!, 8, DEST, NOW).join()).toMatch(/names pull request 7, not 8/);
    expect(quoteProblems(parseQuote(comment({ ...good, pay: "https://agent.nomicon.world/pay/9" }))!, 7, DEST, NOW).join()).toMatch(/not this pull request's/);
  });

  it("refuses plain http on mainnet, an unknown network and a malformed fee", () => {
    expect(quoteProblems(parseQuote(comment({ ...good, pay: "http://agent.nomicon.world/pay/7" }))!, 7, DEST, NOW).join()).toMatch(/not https/);
    expect(quoteProblems(parseQuote(comment({ ...good, network: "eip155:1" }))!, 7, DEST, NOW).join()).toMatch(/unknown network/);
    expect(quoteProblems(parseQuote(comment({ ...good, fee_usdc: "1e9" }))!, 7, DEST, NOW).join()).toMatch(/not an amount/);
  });

  it("refuses a pull request that changed after the quote, or is no longer open", () => {
    const q = parseQuote(comment({ ...good, head: "aaaaaaa1111" }))!;
    expect(quoteProblems(q, 7, DEST, NOW, { state: "open", head: "aaaaaaa1111" })).toEqual([]);
    expect(quoteProblems(q, 7, DEST, NOW, { state: "open", head: "bbbbbbb2222" }).join()).toMatch(/changed after the quote \(quoted aaaaaaa, now bbbbbbb\)/);
    expect(quoteProblems(q, 7, DEST, NOW, { state: "merged", head: "aaaaaaa1111" }).join()).toMatch(/is merged: nothing to pay/);
  });
});
