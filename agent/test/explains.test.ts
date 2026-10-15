import { describe, expect, it } from "vitest";
import { buildWorldMap, type MapFile } from "../src/worldmap.js";
import { anchor, rulesFrom } from "../src/rulesmap.js";
import { parseHeader } from "../src/questions.js";

const T = 1_800_000_000;
const replicator = {
  nodes: [{ id: "stars", label: "Stars", kind: "phys", domain: "cosmos" }, { id: "black-holes", label: "Black holes", kind: "phys", domain: "cosmos" }, { id: "earth", label: "Earth", kind: "phys", domain: "cosmos" }],
  edges: [{ from: "stars", to: "black-holes", type: "desc" }, { from: "stars", to: "earth", type: "desc" }],
};
const file = (path: string, extra: Partial<MapFile> = {}, pr = 5): MapFile => ({ path, answers: [], pr, by: 1, login: "a", merged_at: T + pr, ...extra });
const rules = rulesFrom("# Laws\n\n## Law 1. Accounts, authors and voters\n\ntext\n\n## Law 5. Fees\n", "## Article 6A. Unforeseen necessity\n\n## Article 9A. Minimums the Laws may not cross\n");

describe("open work on the map", () => {
  it("counts starter-map points and links nobody has written about, and the rules", () => {
    const m = buildWorldMap({}, replicator, T, rules);
    expect(m.frontier).toEqual({ open_questions: 0, open_spots: 0, unwritten: 3, unexplained: 2, laws: 2, articles: 2 });
    expect(m.nodes.find((n) => n.id === "black-holes")!.unwritten).toBe(true);
    expect(m.edges.every((e) => e.unexplained)).toBe(true);
  });

  it("writes the first entry of a point onto the point itself, and explains a link from a file inside its first end", () => {
    const m = buildWorldMap({
      "world/replicator-map/black-holes.md": file("world/replicator-map/black-holes.md", { title: "Black holes", explains: "black-holes", map: { edges: [], place_under: [], needs: ["hawking-radiation"] } }),
      "world/replicator-map/stars--desc--earth.md": file("world/replicator-map/stars--desc--earth.md", { title: "Why stars made Earth", explains: "stars--desc--earth" }, 6),
    }, replicator, T, rules);
    const bh = m.nodes.find((n) => n.id === "black-holes")!;
    expect(bh.unwritten).toBeUndefined();
    expect(bh.entry).toBe("world/replicator-map/black-holes.md");
    expect(m.nodes.filter((n) => n.source === "world/replicator-map/black-holes.md")).toHaveLength(0); // no duplicate point
    expect(m.nodes.find((n) => n.id === "hawking-radiation")!.stub).toBe(true); // its needs still open spots
    const link = m.edges.find((e) => e.from === "stars" && e.to === "earth")!;
    expect(link.entry).toBe("world/replicator-map/stars--desc--earth.md");
    expect(link.unexplained).toBeUndefined();
    expect(m.nodes.find((n) => n.source === "world/replicator-map/stars--desc--earth.md")!.parent).toBe("stars");
    expect(m.frontier.unwritten).toBe(2);
    expect(m.frontier.unexplained).toBe(1);
  });

  it("puts a second explanation inside the point, and names a missing target as a conflict", () => {
    const m = buildWorldMap({
      "world/replicator-map/a.md": file("world/replicator-map/a.md", { explains: "black-holes" }),
      "world/replicator-map/b.md": file("world/replicator-map/b.md", { title: "More on black holes", explains: "black-holes" }, 6),
      "world/replicator-map/c.md": file("world/replicator-map/c.md", { explains: "nowhere" }, 7),
    }, replicator, T, rules);
    expect(m.nodes.find((n) => n.source === "world/replicator-map/b.md")!.parent).toBe("black-holes");
    expect(m.conflicts.map((c) => c.problem).join()).toContain("explains: nowhere names no point on the map");
  });

  it("draws the Laws, the locked articles and the machine as their own spaces, with GitHub anchors", () => {
    const m = buildWorldMap({}, null, T, rules);
    const law5 = m.nodes.find((n) => n.id === "law-5")!;
    expect(law5).toMatchObject({ kind: "law", parent: "space-laws", layer: "laws", href: "https://github.com/nomicon-world/nomicon/blob/main/LAWS.md#law-5-fees" });
    expect(m.nodes.find((n) => n.id === "article-9a")).toMatchObject({ kind: "article", locked: true, parent: "space-constitution" });
    expect(m.nodes.find((n) => n.id === "machine-payments")!.files).toContain("site/pay.html");
    expect(anchor("Article 9A. Minimums the Laws may not cross")).toBe("article-9a-minimums-the-laws-may-not-cross");
  });

  it("reads explains from a header, as a point or a link", () => {
    expect(parseHeader("---\nnomicon:\n  explains: black-holes\n---\n# x")!.explains).toBe("black-holes");
    expect(parseHeader("---\nnomicon:\n  explains: stars--desc--earth\n---\n# x")!.explains).toBe("stars--desc--earth");
    expect(parseHeader("---\nnomicon:\n  explains: Not An Id\n---\n# x")!.explains).toBeUndefined();
  });
});

describe("the starter map's own nesting", () => {
  it("draws a part inside the point it belongs to, and refuses a loop", () => {
    const m = buildWorldMap({}, {
      nodes: [{ id: "eukaryote", label: "Eukaryote", kind: "pop", domain: "life" }, { id: "nucleus", label: "Nucleus", kind: "part", domain: "life", parent: "eukaryote" },
        { id: "a", label: "A", kind: "part", domain: "x", parent: "b" }, { id: "b", label: "B", kind: "part", domain: "x", parent: "a" }],
      edges: [],
    }, T, null);
    expect(m.nodes.find((n) => n.id === "nucleus")!.parent).toBe("eukaryote");
    expect(m.nodes.find((n) => n.id === "eukaryote")!.children).toBe(1);
    const a = m.nodes.find((n) => n.id === "a")!, b = m.nodes.find((n) => n.id === "b")!;
    expect(a.parent === "b" && b.parent === "a").toBe(false);
  });
});
