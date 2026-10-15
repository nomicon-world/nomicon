import { describe, expect, it } from "vitest";
import { parseLabel, progressBoard } from "../src/progress.js";
import type { LedgerEvent } from "../src/ledger.js";
import type { MapFile } from "../src/worldmap.js";
import { laws } from "./helpers.js";

const T = 1_800_000_000, D = 86400;
let id = 0;
const ev = (type: string, at: number, f: Record<string, unknown>): LedgerEvent => ({ id: ++id, at, type, ...f } as unknown as LedgerEvent);
const file = (path: string, pr: number, by: number, extra: Partial<MapFile> = {}): MapFile => ({ path, pr, by, login: `u${by}`, merged_at: T + pr * D, answers: [], ...extra });
const BASE = 1_000_000n;

describe("Law 14 labels", () => {
  it("reads the last label line in a text, case-insensitively, and nothing else", () => {
    expect(parseLabel("Looks right.\nlabel: new\n")).toBe("new");
    expect(parseLabel("LABEL: Collects")).toBe("collects");
    expect(parseLabel("label: new\nlabel: builds")).toBe("builds");
    expect(parseLabel("the label: new idea")).toBeNull();
    expect(parseLabel("label: novel")).toBeNull();
    expect(parseLabel("")).toBeNull();
  });
});

describe("the progress board", () => {
  const files = {
    "world/questions/q.md": file("world/questions/q.md", 1, 1, { question: "Q?", map: { edges: [], place_under: [], needs: ["thing"] } }),
    "world/answers/a.md": file("world/answers/a.md", 2, 2, { answers: ["world/questions/q.md"] }),
    "world/notes/thing.md": file("world/notes/thing.md", 3, 3, { map: { node: { id: "thing", label: "Thing", kind: "idea", domain: "x" }, edges: [], place_under: [], needs: [] }, cites: ["world/answers/a.md"] }),
    "world/notes/loose.md": file("world/notes/loose.md", 4, 4, { cites: ["world/answers/a.md", "world/notes/thing.md"] }),
    "world/notes/self.md": file("world/notes/self.md", 5, 2, { cites: ["world/answers/a.md"] }),
  };
  const merges = [1, 2, 3, 4, 5].map((pr) => ev("merge", T + pr * D, { pr, layer: "world", account: files[Object.keys(files)[pr - 1] as keyof typeof files].by }));
  const weights = new Map<number, bigint>([[1, 5_000_000n], [2, 1_000_000n], [3, 200_000n], [4, 0n]]);
  const merged = new Set([1, 2, 3, 4]);
  const owners = new Set([100]);

  it("scores structure and citations with no labels: default label, structure factor, other accounts' citations only", () => {
    const b = progressBoard(files, merges, weights, merged, owners, BASE, laws, T + 10 * D);
    const by = new Map(b.contributions.map((c) => [c.pr, c]));
    expect(by.get(1)).toMatchObject({ label: "builds", labelled: false, structure: ["asked a question that was answered"], structure_factor: 1.25, cited_by: [], score: 1.25 });
    expect(by.get(2)).toMatchObject({ structure: ["answers a question"], cited_by: [3, 4], score: 3.75 }); // self-citation from pr 5 (same account) does not count
    expect(by.get(3)).toMatchObject({ structure: ["fills an open spot"], cited_by: [4], score: 2.5 });
    expect(by.get(4)).toMatchObject({ structure: [], structure_factor: 1, cited_by: [], score: 1 });
    expect(b.contributions[0]!.pr).toBe(2);
    expect(b.authors[0]).toMatchObject({ account: 2, contributions: 2 });
  });

  it("weighs labels by the labeller's weight with a floor, ignores the author, the owner and accounts without a merge, and breaks ties toward the default", () => {
    const events = [...merges,
      ev("label", T + 6 * D, { pr: 4, account: 3, label: "new" }),      // weight below the floor: counts as one base fee
      ev("label", T + 6 * D, { pr: 4, account: 2, label: "collects" }), // one base fee
      ev("label", T + 6 * D, { pr: 4, account: 4, label: "collects" }), // the author: ignored
      ev("label", T + 6 * D, { pr: 4, account: 100, label: "collects" }), // the owner: ignored
      ev("label", T + 6 * D, { pr: 4, account: 9, label: "collects" }), // never merged anything: ignored
      ev("label", T + 7 * D, { pr: 3, account: 1, label: "new" }),      // 5 USDC of weight
      ev("label", T + 7 * D, { pr: 3, account: 2, label: "collects" }), // 1 USDC
    ];
    const b = progressBoard(files, events, weights, merged, owners, BASE, laws, T + 10 * D);
    const by = new Map(b.contributions.map((c) => [c.pr, c]));
    expect(by.get(4)).toMatchObject({ label: "builds", labelled: true, label_weight: { new: "1000000", builds: "0", collects: "1000000" }, score: 1 }); // a tie goes to builds
    expect(by.get(3)).toMatchObject({ label: "new", label_weight: { new: "5000000", builds: "0", collects: "1000000" }, score: 5 }); // 2 x 1.25 x (1 + 1)
    expect(by.get(3)!.labels).toEqual([{ account: 1, label: "new" }, { account: 2, label: "collects" }]);
    expect(b.authors.find((a) => a.account === 3)!.new).toBe(1);
  });

  it("drops a revoked contribution, and a later label replaces an earlier one from the same account", () => {
    const events = [...merges, ev("takedown", T + 8 * D, { prs: [3] }),
      ev("label", T + 6 * D, { pr: 4, account: 1, label: "collects" }), ev("label", T + 7 * D, { pr: 4, account: 1, label: "new" })];
    const b = progressBoard(files, events, weights, merged, owners, BASE, laws, T + 10 * D);
    expect(b.contributions.some((c) => c.pr === 3)).toBe(false);
    expect(b.contributions.find((c) => c.pr === 4)).toMatchObject({ label: "new", score: 2 });
  });
});
