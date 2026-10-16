import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Runtime } from "../src/runtime.js";
import { Ledger } from "../src/ledger.js";
import { FakeChain, FakeClock, FakeGitHub, FakeScreen, FixedOracle } from "../src/adapters/mock.js";
import { heldBack, isServed } from "../src/live.js";
import { loaded, rawLaws, rawSchema } from "./helpers.js";

const t0 = 1_800_000_000, D = 86400;

describe("the site waits fourteen days for voted changes to the served files (Article 8)", () => {
  it("knows which files are served", () => {
    expect(["agent/src/x.ts", "laws.json", "site/pay.html", "index.html"].every(isServed)).toBe(true);
    expect(["world/a.md", "LAWS.md", "SKILL.md", "ledger/state.json"].some(isServed)).toBe(false);
  });

  it("serves main, holds back at the commit before a young voted change, then catches up", async () => {
    const clock = new FakeClock(t0), github = new FakeGitHub(clock), ledger = new Ledger(mkdtempSync(join(tmpdir(), "nomicon-live-")));
    const rt = new Runtime({ github, chain: new FakeChain(clock), screen: new FakeScreen(), oracle: new FixedOracle(), clock, ledger, publicBaseUrl: "https://pay.example",
      loadLaws: async () => ({ rawLaws, rawSchema }), termsCommit: async () => "tt".repeat(20), liveBranch: "live" });
    ledger.append(t0, "genesis", { head: "aa".repeat(20), laws_hash: loaded.hash, owner_accounts: [100], owner_keys: [], agent_account: 101, fee_destination: "0xdest", network: "eip155:84532" });
    github.branches["main"] = "c1";
    await rt.advanceLive(clock.now());
    expect(github.branches["live"]).toBe("c1");

    // A voted change to the pay page merges as c3, on top of c2; a World merge and an owner commit follow.
    ledger.append(clock.now(), "merge", { pr: 5, layer: "laws", merge_commit: "c3", paths: ["site/pay.html"], account: 1, weight_micro: "0", head: "h" });
    ledger.append(clock.now(), "merge", { pr: 6, layer: "world", merge_commit: "c4", paths: ["world/a.md"], account: 2, weight_micro: "0", head: "h" });
    github.parents["c3"] = "c2"; github.branches["main"] = "c5";
    expect(heldBack(ledger.events, clock.now())?.["pr"]).toBe(5);
    await rt.advanceLive(clock.now());
    expect(github.branches["live"]).toBe("c2");

    clock.advance(14 * D + 60);
    await rt.advanceLive(clock.now());
    expect(github.branches["live"]).toBe("c5");
  });
});

describe("progress on the map (Law 14)", () => {
  it("puts a contribution's progress on the starter-map point and link its file explains", async () => {
    const clock = new FakeClock(t0), github = new FakeGitHub(clock), ledger = new Ledger(mkdtempSync(join(tmpdir(), "nomicon-prog-")));
    const rt = new Runtime({ github, chain: new FakeChain(clock), screen: new FakeScreen(), oracle: new FixedOracle(), clock, ledger, publicBaseUrl: "https://pay.example", loadLaws: async () => ({ rawLaws, rawSchema }), termsCommit: async () => "tt".repeat(20) });
    ledger.append(t0, "genesis", { head: "aa".repeat(20), laws_hash: loaded.hash, owner_accounts: [100], owner_keys: [], agent_account: 101, fee_destination: "0xdest", network: "eip155:84532" });
    github.repoFiles["world/replicator-map/nodes.json"] = JSON.stringify({ nodes: [{ id: "stars", label: "Stars", kind: "phys", domain: "c" }, { id: "earth", label: "Earth", kind: "phys", domain: "c" }] });
    github.repoFiles["world/replicator-map/relations.json"] = JSON.stringify({ relations: [{ from: "stars", to: "earth", type: "desc" }] });
    await rt.tick();
    for (const [path, body] of [["world/replicator-map/stars.md", "explains: stars"], ["world/replicator-map/stars--desc--earth.md", "explains: stars--desc--earth"]]) {
      const pr = github.open({ id: 1, login: "alice" }, { [path]: `---\nnomicon:\n  ${body}\n---\n# X\n` });
      await rt.tick();
      await rt.onPaid({ pr: pr.number, tx: "0x" + String(pr.number).padStart(64, "0"), payer: "0xp", amountMicro: rt.quoteFor(pr.number)!.feeMicro, network: "eip155:84532" });
      await rt.tick(); await rt.tick();
      ledger.append(clock.now(), "owner_confirm", { pr: pr.number, reason: "t", by: 100 });
      await rt.tick();
    }
    const map = JSON.parse(github.published.find((f) => f.path === "ledger/map.json")!.content);
    expect(map.nodes.find((n: { id: string }) => n.id === "stars").progress).toMatchObject({ label: "builds", score: 1.25 });
    expect(map.edges.find((e: { from: string }) => e.from === "stars").progress).toMatchObject({ label: "builds", score: 1.25 });
  });

  it("keeps the first writer's progress on a point after someone else edits its file, and lists the edit on its own", async () => {
    const clock = new FakeClock(t0), github = new FakeGitHub(clock), ledger = new Ledger(mkdtempSync(join(tmpdir(), "nomicon-edit-")));
    const rt = new Runtime({ github, chain: new FakeChain(clock), screen: new FakeScreen(), oracle: new FixedOracle(), clock, ledger, publicBaseUrl: "https://pay.example", loadLaws: async () => ({ rawLaws, rawSchema }), termsCommit: async () => "tt".repeat(20) });
    ledger.append(t0, "genesis", { head: "aa".repeat(20), laws_hash: loaded.hash, owner_accounts: [100], owner_keys: [], agent_account: 101, fee_destination: "0xdest", network: "eip155:84532" });
    github.repoFiles["world/replicator-map/nodes.json"] = JSON.stringify({ nodes: [{ id: "stars", label: "Stars", kind: "phys", domain: "c" }] });
    github.repoFiles["world/replicator-map/relations.json"] = JSON.stringify({ relations: [] });
    await rt.tick();
    const path = "world/replicator-map/stars.md";
    for (const [who, body] of [[{ id: 1, login: "alice" }, "# Stars\n"], [{ id: 2, login: "bob" }, "# Stars\n\nA correction.\n"]] as const) {
      const pr = github.open(who, { [path]: `---\nnomicon:\n  explains: stars\n---\n${body}` });
      await rt.tick();
      await rt.onPaid({ pr: pr.number, tx: "0x" + String(pr.number).padStart(64, "0"), payer: "0xp", amountMicro: rt.quoteFor(pr.number)!.feeMicro, network: "eip155:84532" });
      await rt.tick(); await rt.tick();
      ledger.append(clock.now(), "owner_confirm", { pr: pr.number, reason: "t", by: 100 });
      await rt.tick();
    }
    expect(rt.progress().contributions.map((c) => [c.login, c.structure, c.edits])).toEqual([["alice", ["writes a first entry"], []], ["bob", [], [path]]]);
    const map = JSON.parse(github.published.filter((f) => f.path === "ledger/map.json").at(-1)!.content);
    expect(map.nodes.find((n: { id: string }) => n.id === "stars").progress).toMatchObject({ score: 1.25 });
  });
});
