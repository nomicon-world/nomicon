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
  const ledger = new Ledger(mkdtempSync(join(tmpdir(), "nomicon-direct-")));
  const rt = new Runtime({
    github, chain: new FakeChain(clock), screen: new FakeScreen(), oracle: new FixedOracle(), clock, ledger, publicBaseUrl: "https://pay.example",
    loadLaws: async () => ({ rawLaws, rawSchema }), termsCommit: async () => "tt".repeat(20),
  });
  ledger.append(t0, "genesis", { head: "aa".repeat(20), laws_hash: loaded.hash, owner_accounts: [100], owner_keys: [], agent_account: 101, fee_destination: "0xdest", network: "eip155:84532" });
  return { clock, github, ledger, rt };
}
const published = (g: FakeGitHub, path: string) => JSON.parse(g.published.find((f) => f.path === path)!.content);

describe("World files no merge explains (D38)", () => {
  it("are recorded in the ledger once per fingerprint, marked direct, and their citations are drawn", async () => {
    const h = harness();
    h.github.repoFiles["world/q/ask.md"] = "---\nnomicon:\n  question: \"Why?\"\n---\n# Why\n";
    h.github.repoFiles["world/a/one.md"] = "---\nnomicon:\n  answers: [world/q/ask.md]\n  map:\n    node: { id: one, label: One, kind: idea }\n---\n# One\n";
    h.github.repoFiles["world/a/two.md"] = "---\nnomicon:\n  cites: [world/a/one.md]\n  map:\n    node: { id: two, label: Two, kind: idea }\n---\n# Two\n";
    await h.rt.tick();
    const direct = () => h.ledger.events.filter((e) => e.type === "world_direct");
    expect(direct()).toHaveLength(1);
    const paths = (direct()[0]!["files"] as Array<{ path: string }>).map((f) => f.path).sort();
    expect(paths).toEqual(["world/README.md", "world/a/one.md", "world/a/two.md", "world/q/ask.md"]);
    h.clock.advance(400);
    await h.rt.tick();
    expect(direct()).toHaveLength(1);
    h.github.repoFiles["world/a/two.md"] += "More.\n";
    h.clock.advance(400);
    await h.rt.tick();
    expect(direct()).toHaveLength(2);
    expect((direct()[1]!["files"] as Array<{ path: string }>).map((f) => f.path)).toEqual(["world/a/two.md"]);
    const map = published(h.github, "ledger/map.json");
    expect(map.edges).toContainEqual(expect.objectContaining({ from: "two", to: "one", type: "cites" }));
    const qs = published(h.github, "ledger/questions.json");
    expect(qs.answered[0]).toMatchObject({ direct: true, answers: [expect.objectContaining({ path: "world/a/one.md", direct: true })] });
  });
});
