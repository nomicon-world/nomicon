import { describe, expect, it } from "vitest";
import { parseHeader, titleOf } from "../src/questions.js";
import { buildWorldMap, type MapFile } from "../src/worldmap.js";

function file(path: string, md: string, pr: number, at: number): MapFile {
  const h = parseHeader(md), t = titleOf(md);
  return { path, ...(t ? { title: t } : {}), ...(h?.map ? { map: h.map } : {}), answers: h?.answers ?? [], pr, by: 7, login: "ada", merged_at: at };
}
const head = (y: string) => `---\nnomicon:\n${y}\n---\n# Title\n`;
const byId = (m: ReturnType<typeof buildWorldMap>) => Object.fromEntries(m.nodes.map((n) => [n.id, n]));

describe("needs grow the frontier", () => {
  it("turns needs into open spots that a later file fills", () => {
    const a = { "world/s/a.md": file("world/s/a.md", head("  map:\n    node: { id: a, label: A, kind: idea }\n    needs: [b, c]"), 1, 1) };
    const m1 = byId(buildWorldMap(a, null, 9));
    expect(m1["b"]).toMatchObject({ stub: true, pointed_by: ["world/s/a.md"] });
    expect(m1["c"]!.stub).toBe(true);
    const both = { ...a, "world/s/b.md": file("world/s/b.md", head("  map:\n    node: { id: b, label: B, kind: idea }"), 2, 2) };
    const m2 = byId(buildWorldMap(both, null, 9));
    expect(m2["b"]!.stub).toBeUndefined();
    expect(m2["c"]!.stub).toBe(true);
    expect(buildWorldMap(both, null, 9).edges).toContainEqual(expect.objectContaining({ from: "a", to: "b", type: "needs" }));
  });
});
