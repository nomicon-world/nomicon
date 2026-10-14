import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHeader, titleOf } from "../src/questions.js";
import { buildWorldMap, type MapFile } from "../src/worldmap.js";
import { edgeNode, jobCard, optionsFor, type Catalog } from "../src/jobs.js";

const catalog = JSON.parse(readFileSync(new URL("../../paths.json", import.meta.url), "utf8")) as Catalog;
function file(path: string, md: string, pr: number, at: number): MapFile {
  const h = parseHeader(md), t = titleOf(md);
  return { path, ...(t ? { title: t } : {}), ...(h?.map ? { map: h.map } : {}), ...(h?.question ? { question: h.question } : {}), ...(h?.about ? { about: h.about } : {}), answers: h?.answers ?? [], pr, by: 7, login: "ada", merged_at: at };
}
const head = (y: string) => `---\nnomicon:\n${y}\n---\n# Title\n`;

describe("everything is a question", () => {
  const files = {
    "world/s/a.md": file("world/s/a.md", head("  map:\n    node: { id: a, label: A, kind: idea }\n    edges:\n      - { to: b, type: dep }"), 1, 1),
    "world/s/b.md": file("world/s/b.md", head("  map:\n    node: { id: b, label: B, kind: idea }"), 2, 2),
    "world/questions/q1.md": file("world/questions/q1.md", head('  question: "Is A right?"\n  about: a'), 3, 3),
    "world/questions/q2.md": file("world/questions/q2.md", head('  question: "Is the link right?"\n  about: a--dep--b'), 4, 4),
    "world/answers/r1.md": file("world/answers/r1.md", head("  answers: [world/questions/q1.md]"), 5, 5),
  };
  const m = buildWorldMap(files, null, 9);
  const byId = new Map(m.nodes.map((n) => [n.id, n]));

  it("reads about as a node id or a from--type--to link, and ignores anything else", () => {
    expect(parseHeader(head("  about: a--dep--b"))!.about).toBe("a--dep--b");
    expect(parseHeader(head("  about: Not An Id"))!.about).toBeUndefined();
  });

  it("counts the questions about a node and a link, and how many are still open", () => {
    expect(byId.get("a")).toMatchObject({ questions: ["file-questions-q1"], open_questions: 0 });
    const link = m.edges.find((e) => e.from === "a" && e.to === "b" && e.type === "dep")!;
    expect(link).toMatchObject({ questions: ["file-questions-q2"], open_questions: 1 });
    expect(byId.get("file-questions-q2")!.about).toBe("a--dep--b");
  });

  it("makes a link a place with its own jobs and standing questions", () => {
    const link = m.edges.find((e) => e.type === "dep")!;
    const place = edgeNode(link, byId as never);
    expect(place.id).toBe("a--dep--b");
    const ids = optionsFor(catalog, place).map((x) => x.option.id);
    expect(ids).toEqual(expect.arrayContaining(["ask", "fix-link", "relink", "between"]));
    const between = jobCard(catalog, "between", place, byId as never, 1000000n);
    expect(between["header"]).toContain("{ from: a, to: <your-id>, type: dep }");
    expect(between["header"]).toContain("{ from: <your-id>, to: b, type: dep }");
    expect(jobCard(catalog, "ask", place, byId as never, 1000000n)["header"]).toContain("about: a--dep--b");
    for (const kind of ["node", "edge", "question", "stub", "space"]) for (const [, opt] of (catalog as unknown as { standing: Record<string, string[][]> }).standing[kind]!) expect(catalog.doors.some((d) => d.options.some((o) => o.id === opt)), `${kind}: ${opt}`).toBe(true);
  });
});
