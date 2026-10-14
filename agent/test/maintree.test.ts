import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Runtime } from "../src/runtime.js";
import { Ledger } from "../src/ledger.js";
import { FakeChain, FakeClock, FakeGitHub, FakeScreen, FixedOracle } from "../src/adapters/mock.js";
import { loaded, rawLaws, rawSchema } from "./helpers.js";

const t0 = 1_800_000_000;
function harness() {
  const clock = new FakeClock(t0);
  const github = new FakeGitHub(clock);
  const ledger = new Ledger(mkdtempSync(join(tmpdir(), "nomicon-tree-")));
  const rt = new Runtime({
    github, chain: new FakeChain(clock), screen: new FakeScreen(), oracle: new FixedOracle(), clock, ledger, publicBaseUrl: "https://pay.example",
    loadLaws: async () => ({ rawLaws, rawSchema }), termsCommit: async () => "tt".repeat(20),
  });
  ledger.append(t0, "genesis", { head: "aa".repeat(20), laws_hash: loaded.hash, owner_accounts: [100], owner_keys: [], agent_account: 101, fee_destination: "0xdest", network: "eip155:84532" });
  return { clock, github, rt };
}
const published = (g: FakeGitHub, path: string) => JSON.parse(g.published.find((f) => f.path === path)!.content);

describe("the map reads main (Law 12)", () => {
  it("shows a file the owner committed directly, marked as such, and lets it answer a question", async () => {
    const h = harness();
    h.github.repoFiles["world/q/ask.md"] = "---\nnomicon:\n  question: \"Why?\"\n---\n# Why\n";
    h.github.repoFiles["world/a/reply.md"] = "---\nnomicon:\n  answers: [world/q/ask.md]\n  map:\n    node: { id: reply, label: Reply, kind: idea }\n---\n# Because\n";
    await h.rt.tick();
    const map = published(h.github, "ledger/map.json");
    const reply = map.nodes.find((n: { id: string }) => n.id === "reply");
    expect(reply).toMatchObject({ direct: true, by: 100, parent: "space-a" });
    const qs = published(h.github, "ledger/questions.json");
    expect(qs.answered.map((q: { id: string }) => q.id)).toEqual(["world/q/ask.md"]);
  });

  it("republishes the map when main changes without a ledger event, and drops files removed from main", async () => {
    const h = harness();
    h.github.repoFiles["world/x/one.md"] = "# One\n";
    await h.rt.tick();
    h.github.published = [];
    h.clock.advance(400);
    h.github.repoFiles["world/x/two.md"] = "# Two\n";
    delete h.github.repoFiles["world/x/one.md"];
    await h.rt.tick();
    const labels = published(h.github, "ledger/map.json").nodes.map((n: { label: string }) => n.label);
    expect(labels).toContain("Two");
    expect(labels).not.toContain("One");
  });
});
