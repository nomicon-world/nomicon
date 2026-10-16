import { describe, expect, it } from "vitest";
import { parseChallenge, parseLabel, progressBoard, windowOpen } from "../src/progress.js";
import type { LedgerEvent } from "../src/ledger.js";
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
  const m = (pr: number, by: number, headers: Record<string, Record<string, unknown>> = {}, paths = Object.keys(headers)) =>
    ev("merge", T + pr * D, { pr, layer: "world", account: by, login: `u${by}`, paths, headers });
  const merges = [m(1, 1, {}, ["world/notes/a.md"]), ...[2, 3, 4, 5].map((n) => m(n, n, {}, [`world/notes/n${n}.md`]))];
  const weights = new Map<number, bigint>([[2, 10_000_000n], [3, 1_000_000n], [4, 1_000_000n], [5, 1_000_000n], [6, 1_000_000n]]);
  const merged = new Set([1, 2, 3, 4, 5, 6]), owners = new Set([100]);
  const label = (acct: number, l: string, at: number, pointer = true, pr = 1) => ev("label", at, { pr, account: acct, login: `u${acct}`, label: l, unlike: pointer && l === "new" ? "prior work" : null, because: pointer && l === "new" ? "it adds this" : null, submitted: at });
  const board = (events: LedgerEvent[], ms = merges) => progressBoard([...ms, ...events], weights, merged, owners, BASE, laws, T + 20 * D).contributions;
  const a = (events: LedgerEvent[], ms = merges) => board(events, ms).find((c) => c.pr === 1)!;

  it("keeps a label provisional until three accounts have labelled, scoring the default meanwhile", () => {
    const c = a([label(2, "new", T + 6 * D), label(3, "new", T + 6 * D)]);
    expect(c).toMatchObject({ state: "provisional", leading: "new", label: "builds", labellers: 2, score: 1 });
  });

  it("caps one labeller's share once settled, the same way a vote does, which can change the result", () => {
    const c = a([label(2, "new", T + 6 * D), label(3, "collects", T + 6 * D), label(4, "collects", T + 6 * D), label(5, "collects", T + 6 * D)]);
    expect(c.state).toBe("settled");
    expect(c.label).toBe("collects"); // uncapped, 10 USDC of "new" would beat 3 USDC of "collects"
    expect(c.label_weight).toEqual({ new: "2600000", builds: "0", collects: "3000000" });
  });

  it("counts a new label without its pointer as builds and reports it as new?, unless the author's header names one", () => {
    const bare = [label(2, "new", T + 6 * D, false), label(3, "new", T + 6 * D, false), label(4, "new", T + 6 * D, false)];
    expect(a(bare)).toMatchObject({ state: "settled", label: "builds", new_unsupported: 3 });
    const withPointer = [m(1, 1, { "world/notes/a.md": { answers: [], cites: [], challenges: [], prior: "Smith 2019", adds: "direct measurement" } }), ...merges.slice(1)];
    expect(a(bare, withPointer)).toMatchObject({ label: "new", new_unsupported: 0, author_pointer: { prior: "Smith 2019", adds: "direct measurement" }, score: 2 });
  });

  it("marks a challenged contribution contested until two others have labelled it after the challenge", () => {
    const before = [label(2, "new", T + 6 * D), label(3, "new", T + 6 * D), label(4, "new", T + 6 * D)];
    const challenge = ev("challenge", T + 8 * D, { pr: 1, account: 5, login: "u5", text: "Smith 2019 already shows this", source: "comment", source_id: 9, submitted: T + 8 * D });
    const c1 = a([...before, challenge]);
    expect(c1).toMatchObject({ contested: true, label: "new", window_closes: T + 38 * D }); // the claim is not silently changed
    const c2 = a([...before, challenge, label(5, "collects", T + 9 * D), label(3, "builds", T + 9 * D)]);
    expect(c2.contested).toBe(true); // the challenger's own label does not clear it
    const c3 = a([...before, challenge, label(3, "builds", T + 9 * D), label(4, "builds", T + 9 * D)]);
    expect(c3).toMatchObject({ contested: false, label: "new" }); // cleared; account 2's new (capped at 2.4) still outweighs two builds (2.0)
  });

  it("treats a file that challenges a work as contesting it, never as citing it, and ignores the author, the owner and accounts without merged work", () => {
    const events = [m(6, 6, { "world/notes/dispute.md": { answers: [], challenges: ["world/notes/a.md"], cites: ["world/notes/a.md"] } }),
      m(7, 5, { "world/notes/uses.md": { answers: [], cites: ["world/notes/a.md"] } }),
      label(1, "new", T + 8 * D), label(100, "new", T + 8 * D), label(9, "new", T + 8 * D)];
    const c = a(events);
    expect(c.cited_by).toEqual([5]);
    expect(c.challenges).toMatchObject([{ account: 6, source: "file", path: "world/notes/dispute.md" }]);
    expect(c).toMatchObject({ contested: true, labellers: 0, state: "unlabelled" });
  });

  it("keeps a contribution and its labels when a later one edits its file, and gives the edit no credit for what was already there", () => {
    const q = "world/questions/q.md", ans = "world/answers/a.md";
    const ms = [m(1, 1, { [q]: { question: "Why?", answers: [], cites: [] } }), m(2, 2, { [ans]: { answers: [q], cites: [] } }),
      m(3, 3, { [ans]: { answers: [q], cites: [] } }), m(4, 4, { [q]: { question: "Why, exactly?", answers: [], cites: [] } })];
    const b = board([label(1, "builds", T + 5 * D, true, 2), label(3, "builds", T + 5 * D, true, 2), label(4, "builds", T + 5 * D, true, 2)], ms);
    const by = (pr: number) => b.find((c) => c.pr === pr)!;
    expect(b).toHaveLength(4);
    expect(by(1)).toMatchObject({ structure: ["asked a question that was answered"], edits: [] });
    expect(by(2)).toMatchObject({ paths: [ans], structure: ["answers a question"], edits: [], labellers: 3, state: "settled", score: 1.25 });
    expect(by(3)).toMatchObject({ paths: [ans], structure: [], edits: [ans], structure_factor: 1 });
    expect(by(4)).toMatchObject({ paths: [q], structure: [], edits: [q] });
  });

  it("credits a citation to every contribution that wrote the cited file before it, and none written after", () => {
    const c = "world/notes/c.md";
    const ms = [m(1, 1, { [c]: { answers: [], cites: [] } }), m(2, 2, { [c]: { answers: [], cites: [] } }),
      m(3, 3, { "world/notes/uses.md": { answers: [], cites: [c] } }), m(4, 4, { [c]: { answers: [], cites: [] } })];
    const by = (pr: number) => board([], ms).find((x) => x.pr === pr)!;
    expect(by(1)).toMatchObject({ cited_by: [3], score: 2 }); // builds 1 × (1 + one citing account)
    expect(by(2)).toMatchObject({ cited_by: [3], edits: [c] });
    expect(by(4)).toMatchObject({ cited_by: [], edits: [c] });
  });

  it("gives a first entry, an explained link and an open spot to the first contribution only", () => {
    const ms = [
      m(1, 1, { "world/notes/x.md": { answers: [], explains: "big-bang", map: { needs: ["spot"] } } }),
      m(2, 2, { "world/notes/y.md": { answers: [], explains: "big-bang" } }),
      m(3, 3, { "world/notes/spot.md": { answers: [], map: { node: { id: "spot" } } } }),
      m(4, 4, { "world/notes/spot.md": { answers: [], map: { node: { id: "spot" } } }, "world/notes/l.md": { answers: [], explains: "a--fuse--b" } }),
    ];
    const by = (pr: number) => board([], ms).find((x) => x.pr === pr)!;
    expect(by(1).structure).toEqual(["writes a first entry"]);
    expect(by(2).structure).toEqual([]);
    expect(by(3).structure).toEqual(["fills an open spot"]);
    expect(by(4)).toMatchObject({ structure: ["explains a link"], edits: ["world/notes/spot.md"] });
  });

  it("contests every contribution that wrote a challenged file, except the challenger's own", () => {
    const c = "world/notes/c.md";
    const ms = [m(1, 1, { [c]: { answers: [] } }), m(2, 2, { [c]: { answers: [] } }), m(3, 2, { "world/notes/d.md": { answers: [], challenges: [c] } })];
    const by = (pr: number) => board([], ms).find((x) => x.pr === pr)!;
    expect(by(1)).toMatchObject({ contested: true, challenges: [{ account: 2, path: "world/notes/d.md", source: "file" }] });
    expect(by(2)).toMatchObject({ contested: false, challenges: [] });
  });

  it("drops a revoked contribution, which then names nobody and is named by nobody", () => {
    const ms = [m(1, 1, { "world/notes/c.md": { answers: [], explains: "big-bang" } }), m(2, 2, { "world/notes/e.md": { answers: [], explains: "big-bang" } })];
    const b = board([ev("takedown", T + 3 * D, { prs: [1] })], ms);
    expect(b.map((x) => x.pr)).toEqual([2]);
    expect(b[0]!.structure).toEqual(["writes a first entry"]);
  });
});
