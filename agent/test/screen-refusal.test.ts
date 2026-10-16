import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activeHtml, deterministicChecks } from "../src/screen.js";
import { Runtime } from "../src/runtime.js";
import { Ledger } from "../src/ledger.js";
import { FakeChain, FakeClock, FakeGitHub, FakeScreen, FixedOracle } from "../src/adapters/mock.js";
import { loaded, rawLaws, rawSchema } from "./helpers.js";

describe("HTML that can run, hidden in Markdown", () => {
  it("is found in prose, and skipped inside code blocks and inline code", () => {
    expect(activeHtml("# Hi\n\n<script>alert(1)</script>")).toMatch(/<script/i);
    expect(activeHtml("text <IFRAME src=x></iframe>")).toMatch(/iframe/i);
    expect(activeHtml("<img src=x onerror=alert(1)>")).toMatch(/onerror/);
    expect(activeHtml("[click](javascript:alert(1))")).toMatch(/javascript/);
    expect(activeHtml("<a href=\"data:text/html,x\">x</a>")).toMatch(/data:/);
    expect(activeHtml("An example:\n\n```html\n<script>alert(1)</script>\n```\n\nand `<iframe>` inline.")).toBeNull();
    expect(activeHtml("Plain text with a < b and an <https://example.com> autolink, and the word <format>.")).toBeNull();
  });

  it("holds such a Markdown file before any fee, and leaves other text types alone", () => {
    const hold = deterministicChecks({ pr: 1, title: "t", body: "", files: [{ path: "world/notes/x.md", content: "<script>x</script>" }] } as never);
    expect(hold).toMatchObject({ decision: "hold", reasonClass: "malware_or_harm" });
    expect(deterministicChecks({ pr: 1, title: "t", body: "", files: [{ path: "world/data/x.json", content: "{\"a\": \"<script>\"}" }] } as never)).toBeNull();
  });
});

describe("a refused Laws change", () => {
  it("names its pull request in the record and says why on that pull request; the board and map name the Laws in force", async () => {
    const clock = new FakeClock(1_800_000_000), github = new FakeGitHub(clock), ledger = new Ledger(mkdtempSync(join(tmpdir(), "nomicon-refuse-")));
    const rt = new Runtime({ github, chain: new FakeChain(clock), screen: new FakeScreen(), oracle: new FixedOracle(), clock, ledger, publicBaseUrl: "https://pay.example", loadLaws: async () => ({ rawLaws, rawSchema }), termsCommit: async () => "tt".repeat(20) });
    ledger.append(clock.now(), "genesis", { head: "aa".repeat(20), laws_hash: loaded.hash, owner_accounts: [100], owner_keys: [], agent_account: 101, fee_destination: "0xdest", network: "eip155:84532" });
    await rt.tick();
    const pr = github.open({ id: 1, login: "alice" }, { "laws.json": "{}" });
    const broken = JSON.parse(rawLaws); broken.weight.maturity_days = 0;
    ledger.append(clock.now(), "laws_snapshot", { pr: pr.number, laws_hash: "bad", laws_raw: JSON.stringify(broken), schema_raw: rawSchema, effective_at: clock.now(), merge_commit: "mm".repeat(20) });
    clock.advance(60);
    await rt.tick();
    const refusal = ledger.events.find((e) => e.type === "refusal")!;
    expect(refusal["pr"]).toBe(pr.number);
    expect(pr.comments.some((c) => c.includes("passed its vote but cannot take effect"))).toBe(true);
    expect(rt.progress()).toMatchObject({ laws_version: loaded.laws.version, laws_hash: loaded.hash });
    const map = JSON.parse(github.published.filter((f) => f.path === "ledger/map.json").at(-1)!.content);
    expect(map.laws).toEqual({ version: loaded.laws.version, hash: loaded.hash });
  });
});
