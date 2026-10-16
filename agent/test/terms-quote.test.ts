import { describe, expect, it } from "vitest";
import { lastQuotedTerms, termsCommitForQuote } from "../src/terms.js";
import type { LedgerEvent } from "../src/ledger.js";

const ev = (id: number, type: string, f: Record<string, unknown>) => ({ id, at: 1000 + id, type, ...f }) as unknown as LedgerEvent;

describe("the Terms a quote cites", () => {
  it("cites the newest commit of TERMS.md until an amendment is recorded, and the fallback only when that cannot be read", async () => {
    expect(await termsCommitForQuote([], 5000, async () => "new".padEnd(40, "0"), "pinned")).toBe("new".padEnd(40, "0"));
    expect(await termsCommitForQuote([], 5000, async () => { throw new Error("offline"); }, "pinned")).toBe("pinned");
    expect(await termsCommitForQuote([], 5000, async () => null, "pinned")).toBe("pinned");
  });

  it("follows recorded amendments once there are any, and knows what the last quote cited", async () => {
    const events = [ev(1, "quote", { pr: 1, terms_commit: "a".repeat(40) }), ev(2, "declare", { what: "terms_amendment", commit: "b".repeat(40), previous_commit: "a".repeat(40), effective_at: 9000 })];
    expect(await termsCommitForQuote(events, 5000, async () => "b".repeat(40), "pinned")).toBe("a".repeat(40)); // not yet in force
    expect(await termsCommitForQuote(events, 9001, async () => "c".repeat(40), "pinned")).toBe("b".repeat(40));
    expect(lastQuotedTerms(events)).toBe("a".repeat(40));
    expect(lastQuotedTerms([])).toBeNull();
  });
});
