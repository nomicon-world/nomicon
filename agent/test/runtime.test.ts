import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Runtime } from "../src/runtime.js";
import { Ledger } from "../src/ledger.js";
import { FakeChain, FakeClock, FakeGitHub, FakeScreen, FixedOracle } from "../src/adapters/mock.js";
import { phaseOf } from "../src/phases.js";
import { replay } from "../src/replay.js";
import { DAY, loaded, rawLaws, rawSchema } from "./helpers.js";

const t0 = 1_800_000_000;
const OWNER = { id: 100, login: "owner" };
const A = { id: 1, login: "alice" }, B = { id: 2, login: "bob" }, C = { id: 3, login: "carol" }, D = { id: 4, login: "dan" };

function harness(holdIf?: ConstructorParameters<typeof FakeScreen>[0]) {
  const clock = new FakeClock(t0);
  const github = new FakeGitHub(clock);
  const chain = new FakeChain(clock);
  const dir = mkdtempSync(join(tmpdir(), "nomicon-rt-"));
  const ledger = new Ledger(dir);
  const rt = new Runtime({
    github, chain, screen: new FakeScreen(holdIf), oracle: new FixedOracle(), clock, ledger, publicBaseUrl: "https://pay.example",
    loadLaws: async () => ({ rawLaws, rawSchema }), termsCommit: async () => "tt".repeat(20),
  });
  ledger.append(t0, "genesis", { head: "aa".repeat(20), laws_hash: loaded.hash, owner_accounts: [OWNER.id], owner_keys: [], agent_account: 101, fee_destination: "0xdest", network: "eip155:84532" });
  const pay = async (pr: number) => {
    const q = rt.quoteFor(pr);
    if (!q) throw new Error(`no quote for ${pr}`);
    await rt.onPaid({ pr, tx: "0x" + pr.toString(16).padStart(64, "0"), payer: "0xpayer", amountMicro: q.feeMicro, network: "eip155:84532" });
  };
  const confirm = (pr: number) => ledger.append(clock.now(), "owner_confirm", { pr, reason: "test", by: OWNER.id });
  return { clock, github, chain, ledger, rt, pay, confirm };
}

describe("runtime end to end", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => { h = harness(); });

  it("withdraws a quote at once when the pull request changes, and quotes the new head on the next pass", async () => {
    const pr = h.github.open(A, { "world/notes/a.md": "# A\n\nhello" });
    await h.rt.tick();
    const first = h.rt.quoteFor(pr.number)!;
    expect(first.head).toBe(pr.headSha);
    expect(pr.comments[0]).toContain("What the agent read from your file headers");
    expect(pr.comments[0]).toContain('- `world/notes/a.md`: appears on the map as "A"');
    h.github.push(pr.number);
    expect(h.rt.quoteFor(pr.number)!.currentHead).toBe(first.head); // the endpoint knows only what the last pass saw
    await h.rt.tick();
    expect(h.ledger.events.some((e) => e.type === "quote_lapsed" && e["reason"] === "head changed")).toBe(true);
    expect(h.rt.quoteFor(pr.number)).toBeNull();
    expect(pr.comments.at(-1)).toContain("changed after the quote");
    await h.rt.tick();
    const second = h.rt.quoteFor(pr.number)!;
    expect(second.head).toBe(pr.headSha);
    expect(second.head).not.toBe(first.head);
  });

  it("quotes, takes payment, opens a vote, and during bootstrap waits for the owner then merges and mints weight", async () => {
    const pr = h.github.open(A, { "world/notes/a.md": "# A\n\nhello" });
    await h.rt.tick();
    expect(phaseOf(pr.number, h.ledger.events).kind).toBe("quoted");
    expect(pr.comments[0]).toContain("nomicon-quote");
    expect(pr.comments[0]).toContain("fee_usdc: 1.000000");
    await h.pay(pr.number);
    await h.rt.tick();
    expect(phaseOf(pr.number, h.ledger.events).kind).toBe("voting");
    h.clock.advance(72 * 3600 + 120);
    await h.rt.tick();
    const ph = phaseOf(pr.number, h.ledger.events);
    expect(ph.kind).toBe("await_owner");
    h.confirm(pr.number);
    await h.rt.tick();
    expect(phaseOf(pr.number, h.ledger.events).kind).toBe("done");
    expect(h.github.merges).toHaveLength(1);
    const st = h.rt.state();
    expect(st.weights["1"]!.immature_micro).toBe(1_000_000n);
    expect(st.weighted_accounts).toBe(0);
    h.clock.advance(30 * DAY);
    expect(h.rt.state().weighted_accounts).toBe(1);
    const paths = h.github.published.map((f) => f.path);
    expect(paths.filter((p) => p.startsWith("ledger/events/") && p.endsWith(".jsonl")).length).toBeGreaterThan(0);
    expect(paths.slice(-5)).toEqual(["ledger/head.json", "ledger/state.json", "ledger/questions.json", "ledger/progress.json", "ledger/map.json"]);
  });

  it("rejects at intake without a fee, and holds with no quote", async () => {
    h = harness((i) => (i.files.some((f) => f.content.includes("BAD")) ? { decision: "hold", reasonClass: "unlawful", note: "x" } : null));
    const bad = h.github.open(A, { "world/x.html": "<b>" });
    const held = h.github.open(B, { "world/y.md": "BAD" });
    await h.rt.tick();
    expect(phaseOf(bad.number, h.ledger.events).kind).toBe("intake_rejected");
    expect(bad.state).toBe("closed");
    expect(phaseOf(held.number, h.ledger.events).kind).toBe("held");
    expect(h.rt.quoteFor(held.number)).toBeNull();
    h.clock.advance(15 * DAY);
    await h.rt.tick();
    expect(phaseOf(held.number, h.ledger.events).kind).toBe("done");
  });

  it("lets three mature founders carry a World vote after bootstrap, and expires one without quorum", async () => {
    for (const who of [A, B, C]) {
      const pr = h.github.open(who, { [`world/${who.login}.md`]: "seed" });
      await h.rt.tick(); await h.pay(pr.number); await h.rt.tick();
      h.clock.advance(72 * 3600 + 120); await h.rt.tick(); h.confirm(pr.number); await h.rt.tick();
    }
    h.ledger.append(h.clock.now(), "declare", { what: "bootstrap_end", reason: "test", by: OWNER.id });
    h.clock.advance(31 * DAY);
    expect(h.rt.state().weighted_accounts).toBe(3);

    const good = h.github.open(D, { "world/dan.md": "x" });
    await h.rt.tick(); await h.pay(good.number); await h.rt.tick();
    const open = h.ledger.events.find((e) => e.type === "vote_open" && e["pr"] === good.number)!;
    expect(open["qualified"]).toEqual([1, 2, 3]);
    h.clock.advance(3600);
    h.github.review(good.number, A.id, "APPROVED"); h.github.review(good.number, B.id, "APPROVED"); h.github.review(good.number, C.id, "APPROVED");
    h.clock.advance(72 * 3600);
    await h.rt.tick();
    expect(phaseOf(good.number, h.ledger.events).kind).toBe("done");
    expect(h.github.merges.some((m) => m.pr === good.number)).toBe(true);

    const lonely = h.github.open(D, { "world/dan2.md": "y" });
    await h.rt.tick(); await h.pay(lonely.number); await h.rt.tick();
    h.clock.advance(3600);
    h.github.review(lonely.number, A.id, "APPROVED");
    h.clock.advance(72 * 3600);
    await h.rt.tick();
    const exp = h.ledger.events.find((e) => e.type === "expiry" && e["pr"] === lonely.number);
    expect(exp).toBeDefined();
    expect(h.rt.state().held_fees.some((f) => f.account === D.id)).toBe(true);

    // The held fee pays for the next submission at the same layer.
    const again = h.github.open(D, { "world/dan3.md": "z" });
    await h.rt.tick();
    expect(phaseOf(again.number, h.ledger.events).kind).toBe("paid");

    const r = replay(h.ledger.events, new Map([[loaded.hash, rawLaws]]), rawSchema, null, h.clock.now());
    expect(r.findings).toEqual([]);
  });

  it("treats a push after the vote opens as a withdrawal and forfeits once a vote exists", async () => {
    const pr = h.github.open(A, { "world/a.md": "a" });
    await h.rt.tick(); await h.pay(pr.number); await h.rt.tick();
    h.github.push(pr.number);
    await h.rt.tick();
    const w = h.ledger.events.find((e) => e.type === "withdrawal" && e["pr"] === pr.number)!;
    expect(w["fee_disposition"]).toBe("held");
    expect(pr.state).toBe("closed");
  });

  it("adjusts the base fee on the clock and anchors the ledger head", async () => {
    await h.rt.tick();
    expect(h.ledger.events.filter((e) => e.type === "fee_adjust")).toHaveLength(0);
    h.clock.advance(6 * 3600 + 1);
    await h.rt.tick();
    const adj = h.ledger.events.filter((e) => e.type === "fee_adjust");
    expect(adj).toHaveLength(1);
    expect(adj[0]!["base_micro"]).toBe(1_000_000n);
    expect(h.chain.anchors).toHaveLength(1);
  });

  it("refuses a non-compliant laws.json and keeps running on the last good one", async () => {
    await h.rt.tick();
    const broken = JSON.parse(rawLaws); broken.weight.maturity_days = 0;
    const rt2 = new Runtime({
      github: h.github, chain: h.chain, screen: new FakeScreen(), oracle: new FixedOracle(), clock: h.clock, ledger: h.ledger, publicBaseUrl: "x",
      loadLaws: async () => ({ rawLaws: JSON.stringify(broken), rawSchema }), termsCommit: async () => "t",
    });
    await expect(rt2.tick()).rejects.toThrow(/no compliant/);
    expect(h.ledger.events.some((e) => e.type === "refusal")).toBe(true);
  });
});
