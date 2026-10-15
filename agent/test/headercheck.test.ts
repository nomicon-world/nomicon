import { describe, expect, it } from "vitest";
import { headerReport } from "../src/headercheck.js";
import type { MapFile } from "../src/worldmap.js";

const T = 1_800_000_000;
const world: Record<string, MapFile> = {
  "world/questions/q.md": { path: "world/questions/q.md", question: "What is it?", answers: [], pr: 2, by: 1, login: "a", merged_at: T },
  "world/answers/a.md": { path: "world/answers/a.md", title: "An answer", map: { node: { id: "taken", label: "Taken", kind: "idea", domain: "general" }, edges: [], place_under: [], needs: [] }, answers: ["world/questions/q.md"], pr: 3, by: 2, login: "b", merged_at: T },
};
const header = (body: string) => `---\nnomicon:\n${body}\n---\n\n# My entry\n\ntext`;

describe("header report posted with the quote", () => {
  it("confirms a sound header: answers, cites, node and open spots", () => {
    const r = headerReport([{ path: "world/answers/b.md", content: header("  answers: [world/questions/q.md]\n  cites: [world/answers/a.md]\n  map:\n    node: { id: mine, label: \"Mine\", kind: idea }\n    needs: [next-thing]") }], [], world, null, 9, T);
    expect(r).toHaveLength(1);
    expect(r[0]).toContain('appears on the map as "Mine" (id `mine`');
    expect(r[0]).toContain("answers `world/questions/q.md`;");
    expect(r[0]).toContain("cites `world/answers/a.md`;");
    expect(r[0]).toContain("opens a spot for `next-thing`");
    expect(r[0]).not.toContain("dropped");
  });

  it("names a typo in answers or cites, a taken node id, and an unreadable header", () => {
    const r = headerReport([{ path: "world/answers/b.md", content: header("  answers: [world/questions/qq.md]\n  cites: [world/answers/a.md, world/x.md]\n  map:\n    node: { id: taken, label: \"Mine\" }") }], [], world, null, 9, T);
    expect(r[0]).toContain("answers `world/questions/qq.md`, which is not a file in the World, so that link would be dropped");
    expect(r[0]).toContain("cites `world/x.md`, which is not a file in the World");
    expect(r[0]).toContain("node id taken is already declared by world/answers/a.md");
    const bad = headerReport([{ path: "world/answers/c.md", content: "---\nnomicon: [unclosed\n---\n\n# C" }], [], world, null, 9, T);
    expect(bad[0]).toContain("its header could not be read");
    expect(headerReport([{ path: "world/answers/b.md", content: header("  answers: [world/answers/a.md]") }], [], world, null, 9, T)[0]).toContain("which asks no question");
  });

  it("ignores files outside the World and non-Markdown files", () => {
    expect(headerReport([{ path: "LAWS.md", content: "x" }, { path: "world/data.csv", content: "a,b" }], [], world, null, 9, T)).toEqual([]);
  });
});
