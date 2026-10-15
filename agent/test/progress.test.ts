import { describe, expect, it } from "vitest";
import { parseChallenge, parseLabel, progressBoard, windowOpen } from "../src/progress.js";
import type { LedgerEvent } from "../src/ledger.js";
import type { MapFile } from "../src/worldmap.js";
import { laws } from "./helpers.js";

const T = 1_800_000_000, D = 86400, BASE = 1_000_000n;
let id = 0;
const ev = (type: string, at: number, f: Record<string, unknown>): LedgerEvent => ({ id: ++id, at, type, ...f } as unknown as LedgerEvent);

describe("Law 14 parsing", () => {
  it("reads a label, and a new label's pointer only when it names both what it differs from and why", () => {
    expect(parseLabel("label: new, unlike https://doi.org/10.1/x, because it measures it directly")).toEqual({ label: "new", unlike: "https://doi.org/10.1/x", because: "it measures it directly" });
    expect(parseLabel("label: new — unlike the 2019 survey because it adds error bars")).toEqual({ label: "new", unlike: "the 2019 survey", because: "it adds error bars" });
    expect(parseLabel("label: new")).toEqual({ label: "new", unlike: null, because: null });
    expect(parseLabel("label: new, unlike X")).toEqual({ label: "new", unlike: null, because: null });
    expect(parseLabel("label: builds")?.label).toBe("builds");
    expect(parseLabel("LABEL: Collects")?.label).toBe("collects");
    expect(parseLabel("label: new\nlabel: builds")?.label).toBe("builds");
    expect(parseLabel("the label: new idea")).toBeNull();
    expect(parseLabel("label: novel")).toBeNull();
    expect(parseLabel(`label: new, unlike ${"x".repeat(500)}, because y y`, 280)!.unlike!.length).toBe(280);
  });

  it("reads a challenge line, the last one winning, and ignores one too short to say anything", () => {
    expect(parseChallenge("Thanks.\nchallenge: Smith 2020 already reports this result")).toBe("Smith 2020 already reports this result");
    expect(parseChallenge("challenge: no")).toBeNull();
    expect(parseChallenge("challenge: first one\nchallenge: second one")).toBe("second one");
  });

  it("keeps the window open thirty days after the merge and reopens it after a challenge", () => {
    expect(windowOpen(T, [], 30, T + 10 * D)).toBe(true);
    expect(windowOpen(T, [], 30, T + 31 * D)).toBe(false);
    expect(windowOpen(T, [T + 40 * D], 30, T + 45 * D)).toBe(true);
    expect(windowOpen(T, [T + 40 * D], 30, T + 35 * D)).toBe(false);
  });
});

describe("the Law 14 board", () => {
  const f = (path: string, pr: number, by: number, extra: Partial<MapFile> = {}): MapFile => ({ path, pr, by, login: `u${by}`, merged_at: T + pr * D, answers: [], ...extra });
  const base: Record<string, MapFile> = {
    "world/notes/a.md": f("world/notes/a.md", 1, 1),
    ...Object.fromEntries([2, 3, 4, 5].map((n) => [`world/notes/n${n}.md`, f(`world/notes/n${n}.md`, n, n)])),
  };
  const merges = [1, 2, 3, 4, 5].map((pr) => ev("merge", T + pr * D, { pr, layer: "world", account: pr }));
  const weights = new Map<number, bigint>([[2, 10_000_000n], [3, 1_000_000n], [4, 1_000_000n], [5, 1_000_000n], [6, 1_000_000n]]);
  const merged = new Set([1, 2, 3, 4, 5, 6]), owners = new Set([100]);
  const label = (acct: number, l: string, at: number, pointer = true) => ev("label", at, { pr: 1, account: acct, login: `u${acct}`, label: l, unlike: pointer && l === "new" ? "prior work" : null, because: pointer && l === "new" ? "it adds this" : null, submitted: at });
  const a = (files: Record<string, MapFile>, events: LedgerEvent[]) => progressBoard(files, [...merges, ...events], weights, merged, owners, BASE, laws, T + 20 * D).contributions.find((c) => c.pr === 1)!;

  it("keeps a label provisional until three accounts have labelled, scoring the default meanwhile", () => {
    const c = a(base, [label(2, "new", T + 6 * D), label(3, "new", T + 6 * D)]);
    expect(c).toMatchObject({ state: "provisional", leading: "new", label: "builds", labellers: 2, score: 1 });
  });

  it("caps one labeller's share once settled, the same way a vote does, which can change the result", () => {
    const c = a(base, [label(2, "new", T + 6 * D), label(3, "collects", T + 6 * D), label(4, "collects", T + 6 * D), label(5, "collects", T + 6 * D)]);
    expect(c.state).toBe("settled");
    expect(c.label).toBe("collects"); // uncapped, 10 USDC of "new" would beat 3 USDC of "collects"
    expect(c.label_weight).toEqual({ new: "2600000", builds: "0", collects: "3000000" });
  });

  it("counts a new label without its pointer as builds and reports it as new?, unless the author's header names one", () => {
    const bare = [label(2, "new", T + 6 * D, false), label(3, "new", T + 6 * D, false), label(4, "new", T + 6 * D, false)];
    expect(a(base, bare)).toMatchObject({ state: "settled", label: "builds", new_unsupported: 3 });
    const withPointer = { ...base, "world/notes/a.md": f("world/notes/a.md", 1, 1, { prior: "Smith 2019", adds: "direct measurement" }) };
    expect(a(withPointer, bare)).toMatchObject({ label: "new", new_unsupported: 0, author_pointer: { prior: "Smith 2019", adds: "direct measurement" }, score: 2 });
  });

  it("marks a challenged contribution contested until two others have labelled it after the challenge", () => {
    const before = [label(2, "new", T + 6 * D), label(3, "new", T + 6 * D), label(4, "new", T + 6 * D)];
    const challenge = ev("challenge", T + 8 * D, { pr: 1, account: 5, login: "u5", text: "Smith 2019 already shows this", source: "comment", source_id: 9, submitted: T + 8 * D });
    const c1 = a(base, [...before, challenge]);
    expect(c1).toMatchObject({ contested: true, label: "new", window_closes: T + 38 * D }); // the claim is not silently changed
    const c2 = a(base, [...before, challenge, label(5, "collects", T + 9 * D), label(3, "builds", T + 9 * D)]);
    expect(c2.contested).toBe(true); // the challenger's own label does not clear it
    const c3 = a(base, [...before, challenge, label(3, "builds", T + 9 * D), label(4, "builds", T + 9 * D)]);
    expect(c3).toMatchObject({ contested: false, label: "new" }); // cleared; account 2's new (capped at 2.4) still outweighs two builds (2.0)
  });

  it("treats a file that challenges a work as contesting it, never as citing it, and ignores the author, the owner and accounts without merged work", () => {
    const files = { ...base,
      "world/notes/dispute.md": f("world/notes/dispute.md", 6, 6, { challenges: ["world/notes/a.md"], cites: ["world/notes/a.md"] }),
      "world/notes/uses.md": f("world/notes/uses.md", 7, 5, { cites: ["world/notes/a.md"] }) };
    const events = [ev("merge", T + 6 * D, { pr: 6, layer: "world", account: 6 }), ev("merge", T + 7 * D, { pr: 7, layer: "world", account: 5 }),
      label(1, "new", T + 8 * D), label(100, "new", T + 8 * D), label(9, "new", T + 8 * D)];
    const c = a(files, events);
    expect(c.cited_by).toEqual([5]);
    expect(c.challenges).toMatchObject([{ account: 6, source: "file", path: "world/notes/dispute.md" }]);
    expect(c).toMatchObject({ contested: true, labellers: 0, state: "unlabelled" });
  });
});
