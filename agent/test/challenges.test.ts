import { describe, expect, it } from "vitest";
import { buildWorldMap, type MapFile } from "../src/worldmap.js";
import { mentionTargets } from "../src/notify.js";
import { emptyState } from "../src/state.js";
import { parseHeader } from "../src/questions.js";

const T = 1_800_000_000;
const f = (path: string, pr: number, by: number, extra: Partial<MapFile> = {}): MapFile => ({ path, pr, by, login: `u${by}`, merged_at: T + pr, answers: [], ...extra });

describe("challenges (Law 14)", () => {
  it("reads challenges and the author's pointer from a header; a pointer needs both halves", () => {
    const h = parseHeader("---\nnomicon:\n  challenges: [world/notes/a.md]\n  prior: Smith 2019\n  adds: a direct measurement\n---\n# x")!;
    expect(h).toMatchObject({ challenges: ["world/notes/a.md"], prior: "Smith 2019", adds: "a direct measurement" });
    expect(parseHeader("---\nnomicon:\n  prior: Smith 2019\n---\n# x")!.prior).toBeUndefined();
  });

  it("draws a challenge as its own kind of link, apart from citations", () => {
    const m = buildWorldMap({ "world/notes/a.md": f("world/notes/a.md", 1, 1), "world/notes/b.md": f("world/notes/b.md", 2, 2, { challenges: ["world/notes/a.md"] }) }, null, T, null);
    expect(m.edges.filter((e) => e.type === "challenges")).toHaveLength(1);
    expect(m.edges.some((e) => e.type === "cites")).toBe(false);
  });

  it("tells a challenged author about the challenge, even when the same file also cites them", () => {
    const st = emptyState(); st.path_author["world/notes/a.md"] = 1; st.path_author["world/notes/c.md"] = 1;
    const t = mentionTargets(2, { "world/notes/b.md": { cites: ["world/notes/c.md"], challenges: ["world/notes/a.md"] } }, st, 10);
    expect(t).toHaveLength(1);
    expect(t[0]!.reason).toContain("challenges your contribution");
  });
});
