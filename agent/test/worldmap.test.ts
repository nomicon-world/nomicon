import { describe, expect, it } from "vitest";
import { parseHeader, titleOf } from "../src/questions.js";
import { buildWorldMap, type MapFile } from "../src/worldmap.js";

function file(path: string, md: string, pr: number, at: number): MapFile {
  const h = parseHeader(md);
  const t = titleOf(md);
  return { path, ...(t ? { title: t } : {}), ...(h?.map ? { map: h.map } : {}), ...(h?.question ? { question: h.question } : {}), answers: h?.answers ?? [], pr, by: 7, login: "ada", merged_at: at };
}
const head = (y: string) => `---\nnomicon:\n${y}\n---\n# Title of the file\n\nBody.\n`;
const byId = (m: ReturnType<typeof buildWorldMap>) => Object.fromEntries(m.nodes.map((n) => [n.id, n]));

describe("Law 12 map header", () => {
  it("reads a node, edges, place_under and inside, and rejects bad ids", () => {
    const h = parseHeader(head("  map:\n    node: { id: pdf-skill, label: PDF skill, kind: skill, domain: code, inside: skills }\n    place_under: [agents]\n    edges:\n      - { to: ocr, type: dep }\n      - { to: Bad_Id, type: dep }\n      - { from: x, to: y, type: Measures!! }"))!;
    expect(h.map!.node).toEqual({ id: "pdf-skill", label: "PDF skill", kind: "skill", domain: "code", inside: "skills" });
    expect(h.map!.place_under).toEqual(["agents"]);
    expect(h.map!.edges).toEqual([{ to: "ocr", type: "dep" }, { from: "x", to: "y", type: "rel" }]);
    expect(titleOf(head("  question: q"))).toBe("Title of the file");
  });
});

describe("World map", () => {
  it("draws spaces as containers, unplaced files as entries, and edges to nobody as frontier stubs", () => {
    const files = {
      "world/skills/pdf.md": file("world/skills/pdf.md", head("  map:\n    node: { id: pdf-skill, label: PDF skill, kind: skill }\n    edges:\n      - { to: ocr-skill, type: dep }"), 1, 10),
      "world/notes/loose.md": file("world/notes/loose.md", "# A loose note\n", 2, 20),
    };
    const m = byId(buildWorldMap(files, null, 99));
    expect(m["space-skills"]!.kind).toBe("space");
    expect(m["pdf-skill"]!.parent).toBe("space-skills");
    expect(m["file-notes-loose"]).toMatchObject({ kind: "entry", auto: true, label: "A loose note", parent: "space-notes" });
    expect(m["ocr-skill"]).toMatchObject({ stub: true, pointed_by: ["world/skills/pdf.md"], parent: "space-skills" });
    expect(m["space-skills"]!.children).toBe(2);
  });

  it("nests with inside, refuses loops and duplicate ids, and links answers to questions", () => {
    const files = {
      "world/a/city.md": file("world/a/city.md", head("  map:\n    node: { id: city, label: City, kind: place }"), 1, 1),
      "world/a/house.md": file("world/a/house.md", head("  map:\n    node: { id: house, label: House, kind: place, inside: city }"), 2, 2),
      "world/a/room.md": file("world/a/room.md", head("  map:\n    node: { id: room, label: Room, kind: place, inside: house }"), 3, 3),
      "world/a/loop.md": file("world/a/loop.md", head("  map:\n    node: { id: city2, label: C2, kind: place, inside: room }"), 4, 4),
      "world/b/dup.md": file("world/b/dup.md", head("  map:\n    node: { id: city, label: Another city, kind: place }"), 5, 5),
      "world/q/ask.md": file("world/q/ask.md", head('  question: "Why?"'), 6, 6),
      "world/q/reply.md": file("world/q/reply.md", head("  answers: [world/q/ask.md]"), 7, 7),
    };
    const out = buildWorldMap(files, null, 9);
    const m = byId(out);
    expect(m["house"]!.parent).toBe("city");
    expect(m["room"]!.parent).toBe("house");
    expect(m["city2"]!.parent).toBe("room");
    expect(m["city"]!.label).toBe("City");
    expect(m["file-b-dup"]).toMatchObject({ kind: "entry", parent: "space-b" });
    expect(out.conflicts.map((c) => c.path)).toContain("world/b/dup.md");
    expect(m["file-q-ask"]).toMatchObject({ kind: "question", question: "Why?", answered: true });
    expect(out.edges).toContainEqual(expect.objectContaining({ from: "file-q-reply", to: "file-q-ask", type: "answers" }));
  });

  it("refuses a containment loop", () => {
    const files = {
      "world/a/x.md": file("world/a/x.md", head("  map:\n    node: { id: x, label: X, kind: idea, inside: y }"), 1, 1),
      "world/a/y.md": file("world/a/y.md", head("  map:\n    node: { id: y, label: Y, kind: idea, inside: x }"), 2, 2),
    };
    const out = buildWorldMap(files, null, 9);
    const m = byId(out);
    expect([m["x"]!.parent, m["y"]!.parent].filter((p) => p === "space-a").length).toBe(1);
    expect(out.conflicts.some((c) => /loop/.test(c.problem))).toBe(true);
  });

  it("reads the replicator map as one more source, inside its own space", () => {
    const out = buildWorldMap({}, { nodes: [{ id: "big-bang", label: "Big Bang", kind: "phys", domain: "physics", position: [0, 0, 0] }], edges: [{ from: "big-bang", to: "particles", type: "desc" }] }, 1);
    const m = byId(out);
    expect(m["big-bang"]!.parent).toBe("space-replicator-map");
    expect(m["particles"]!.stub).toBe(true);
  });
});
