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
