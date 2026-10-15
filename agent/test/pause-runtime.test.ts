import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Runtime } from "../src/runtime.js";
import { Ledger } from "../src/ledger.js";
import { FakeChain, FakeClock, FakeGitHub, FakeScreen, FixedOracle } from "../src/adapters/mock.js";
import { phaseOf } from "../src/phases.js";
import { replay } from "../src/replay.js";
import { loaded, rawLaws, rawSchema } from "./helpers.js";

const t0 = 1_800_000_000, H = 3600, OWNER = { id: 100, login: "owner" }, A = { id: 1, login: "alice" };

function harness() {
  const clock = new FakeClock(t0), github = new FakeGitHub(clock), chain = new FakeChain(clock);
  const ledger = new Ledger(mkdtempSync(join(tmpdir(), "nomicon-pause-")));
  const rt = new Runtime({ github, chain, screen: new FakeScreen(), oracle: new FixedOracle(), clock, ledger, publicBaseUrl: "https://pay.example",
    loadLaws: async () => ({ rawLaws, rawSchema }), termsCommit: async () => "tt".repeat(20) });
  ledger.append(t0, "genesis", { head: "aa".repeat(20), laws_hash: loaded.hash, owner_accounts: [OWNER.id], owner_keys: [], agent_account: 101, fee_destination: "0xdest", network: "eip155:84532" });
  const owner = (fields: Record<string, unknown>) => ledger.append(clock.now(), "declare", { ...fields, by: OWNER.id });
  return { clock, github, ledger, rt, owner };
}

describe("a pause under Constitution Article 8", () => {
  it("stops quoting while the agent is paused, and pushes the quote's expiry back by the pause", async () => {
    const h = harness();
    h.owner({ what: "pause", scope: "all", reason: "server breach under investigation" });
    const pr = h.github.open(A, { "world/a.md": "# A\n\ntext" });
    await h.rt.tick();
    expect(phaseOf(pr.number, h.ledger.events).kind).toBe("new");
    h.clock.advance(2 * H);
    h.owner({ what: "resume", reason: "fixed" });
    await h.rt.tick();
    const q = h.rt.quoteFor(pr.number)!;
    expect(q).not.toBeNull();
    const quotedAt = h.clock.now(), validFor = q.expires - quotedAt;

    // Payments paused for five hours after the quote: the quote stays open five hours longer.
    h.clock.advance(H);
    h.owner({ what: "pause", scope: "payments", reason: "facilitator reports fraud" });
    expect(h.rt.paused("payments")).toBe(true);
    expect(h.rt.paused("quotes")).toBe(false);
    h.clock.advance(5 * H);
    h.owner({ what: "resume", reason: "facilitator cleared" });
    expect(h.rt.quoteFor(pr.number)!.expires).toBe(quotedAt + validFor + 5 * H);
    h.clock.advance(validFor - 4 * H); // 26 hours after quoting: past the original expiry, inside the extended one
    await h.rt.tick();
    expect(phaseOf(pr.number, h.ledger.events).kind).toBe("quoted");
  });

  it("holds a vote open through a pause of votes, and replay reproduces the close", async () => {
    const h = harness();
    const B = { id: 2, login: "bob" };
    // Alice earns weight first, so the next vote has a real 72-hour window (Law 9).
    const first = h.github.open(A, { "world/a.md": "a" });
    await h.rt.tick();
    await h.rt.onPaid({ pr: first.number, tx: "0x" + "1".padStart(64, "0"), payer: "0xpayer", amountMicro: h.rt.quoteFor(first.number)!.feeMicro, network: "eip155:84532" });
    await h.rt.tick(); await h.rt.tick();
    h.ledger.append(h.clock.now(), "owner_confirm", { pr: first.number, reason: "test", by: OWNER.id });
    await h.rt.tick();
    h.clock.advance(31 * 24 * H);
    const pr = h.github.open(B, { "world/b.md": "b" });
    await h.rt.tick();
    await h.rt.onPaid({ pr: pr.number, tx: "0x" + "4".padStart(64, "0"), payer: "0xpayer", amountMicro: h.rt.quoteFor(pr.number)!.feeMicro, network: "eip155:84532" });
    await h.rt.tick();
    expect(phaseOf(pr.number, h.ledger.events).kind).toBe("voting");
    h.clock.advance(H);
    h.owner({ what: "pause", scope: "votes", reason: "tally defect: counts dismissed reviews" });
    h.clock.advance(80 * H); // past the 72-hour window
    await h.rt.tick();
    expect(phaseOf(pr.number, h.ledger.events).kind).toBe("voting");
    h.owner({ what: "resume", reason: "patched" });
    await h.rt.tick();
    expect(phaseOf(pr.number, h.ledger.events).kind).toBe("voting"); // 80 hours paused, so the window runs 80 hours longer
    h.clock.advance(72 * H);
    await h.rt.tick();
    expect(phaseOf(pr.number, h.ledger.events).kind).toBe("await_owner");
    const r = replay(h.ledger.events, new Map([[loaded.hash, rawLaws]]), rawSchema, null, h.clock.now());
    expect(r.findings).toEqual([]);
  });

  it("revokes the weight of a refunded contribution, in the agent and in replay", async () => {
    const h = harness();
    const pr = h.github.open(A, { "world/c.md": "c" });
    await h.rt.tick();
    const q = h.rt.quoteFor(pr.number)!;
    await h.rt.onPaid({ pr: pr.number, tx: "0x" + "2".padStart(64, "0"), payer: "0xpayer", amountMicro: q.feeMicro, network: "eip155:84532" });
    await h.rt.tick();
    h.clock.advance(73 * H); await h.rt.tick();
    h.ledger.append(h.clock.now(), "owner_confirm", { pr: pr.number, reason: "test", by: OWNER.id });
    await h.rt.tick();
    expect(h.rt.state().weights["1"]!.immature_micro).toBe(1_000_000n);
    h.owner({ what: "refund", pr: pr.number, tx: "0x" + "3".padStart(64, "0"), ground: "Small Claims Court judgment" });
    expect(h.rt.state().weights["1"]).toBeUndefined();
    const r = replay(h.ledger.events, new Map([[loaded.hash, rawLaws]]), rawSchema, null, h.clock.now());
    expect(r.findings).toEqual([]);
  });
});

describe("next jobs after a merge", () => {
  it("reads main at once and suggests the open work beside what merged", async () => {
    const h = harness();
    h.github.repoFiles["world/replicator-map/nodes.json"] = JSON.stringify({ nodes: [{ id: "stars", label: "Stars", kind: "phys", domain: "c" }, { id: "black-holes", label: "Black holes", kind: "phys", domain: "c" }, { id: "earth", label: "Earth", kind: "phys", domain: "c" }] });
    h.github.repoFiles["world/replicator-map/relations.json"] = JSON.stringify({ relations: [{ from: "stars", to: "black-holes", type: "desc" }, { from: "stars", to: "earth", type: "desc" }] });
    await h.rt.tick();
    const pr = h.github.open(A, { "world/replicator-map/black-holes.md": "---\nnomicon:\n  explains: black-holes\n---\n# Black holes\n\ntext" });
    await h.rt.tick();
    await h.rt.onPaid({ pr: pr.number, tx: "0x" + "9".padStart(64, "0"), payer: "0xpayer", amountMicro: h.rt.quoteFor(pr.number)!.feeMicro, network: "eip155:84532" });
    await h.rt.tick(); await h.rt.tick();
    h.ledger.append(h.clock.now(), "owner_confirm", { pr: pr.number, reason: "test", by: OWNER.id });
    await h.rt.tick();
    const next = pr.comments.find((c) => c.startsWith("Next jobs near this one"));
    expect(next).toBeDefined();
    expect(next).toContain('Write the first entry for "Stars"');
    expect(next).toContain("Explain the link");
    expect(pr.comments.some((c) => c.includes("accrues to the author"))).toBe(true);
  });
});
