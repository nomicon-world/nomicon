import { describe, expect, it } from "vitest";
import { buildWorldMap, type MapFile } from "../src/worldmap.js";
import { rulesFrom } from "../src/rulesmap.js";

const T = 1_800_000_000;
const rep = { nodes: [{ id: "stars", label: "Stars", kind: "phys", domain: "c" }, { id: "earth", label: "Earth", kind: "phys", domain: "c" }], edges: [{ from: "stars", to: "earth", type: "desc" }] };
const rules = rulesFrom("## Law 5. Fees\n", "## Article 7. Fees\n");
const f = (path: string, extra: Partial<MapFile>, pr: number): MapFile => ({ path, answers: [], pr, by: 1, login: "a", merged_at: T + pr, ...extra });
const parentOf = (m: ReturnType<typeof buildWorldMap>, path: string) => m.nodes.find((n) => n.source === path)!.parent;

describe("questions and answers sit where they belong on the map", () => {
  const m = buildWorldMap({
    "world/questions/q-stars.md": f("world/questions/q-stars.md", { question: "How do stars die?", about: "stars" }, 1),
    "world/questions/q-link.md": f("world/questions/q-link.md", { question: "How did stars make Earth?", about: "stars--desc--earth" }, 2),
    "world/questions/q-law.md": f("world/questions/q-law.md", { question: "Why is the floor 1 USDC?", about: "law-5" }, 3),
    "world/questions/q-general.md": f("world/questions/q-general.md", { question: "What should an agent check first?" }, 4),
    "world/answers/a1.md": f("world/answers/a1.md", { answers: ["world/questions/q-stars.md"] }, 5),
    "world/answers/a2.md": f("world/answers/a2.md", { answers: ["world/questions/q-general.md"] }, 6),
    "world/questions/q-pinned.md": f("world/questions/q-pinned.md", { question: "Placed by hand", about: "stars", map: { node: { id: "q-pinned", label: "Placed by hand", kind: "question", domain: "general", inside: "earth" }, edges: [], place_under: [], needs: [] } }, 7),
  }, rep, T, rules);

  it("draws a question inside the point, the link's first end, or the rule it is about", () => {
    expect(parentOf(m, "world/questions/q-stars.md")).toBe("stars");
    expect(parentOf(m, "world/questions/q-link.md")).toBe("stars");
    expect(parentOf(m, "world/questions/q-law.md")).toBe("law-5");
  });

  it("keeps a question about nothing in its space, and draws each answer inside its question", () => {
    expect(parentOf(m, "world/questions/q-general.md")).toBe("space-questions");
    expect(parentOf(m, "world/answers/a1.md")).toBe(m.nodes.find((n) => n.source === "world/questions/q-stars.md")!.id);
    expect(parentOf(m, "world/answers/a2.md")).toBe(m.nodes.find((n) => n.source === "world/questions/q-general.md")!.id);
  });

  it("lets a declared inside win, and still pins the question to what it is about", () => {
    expect(m.nodes.find((n) => n.id === "q-pinned")!.parent).toBe("earth");
    expect(m.nodes.find((n) => n.id === "stars")!.questions).toContain("q-pinned");
    expect(m.conflicts).toEqual([]);
  });

  it("refuses a loop between a question and an answer about each other", () => {
    const loop = buildWorldMap({
      "world/answers/a.md": f("world/answers/a.md", { answers: ["world/questions/q.md"], map: { node: { id: "a", label: "A", kind: "idea", domain: "general" }, edges: [], place_under: [], needs: [] } }, 1),
      "world/questions/q.md": f("world/questions/q.md", { question: "Q?", about: "a" }, 2),
    }, null, T, null);
    const a = loop.nodes.find((n) => n.id === "a")!, q = loop.nodes.find((n) => n.source === "world/questions/q.md")!;
    expect(a.parent === q.id && q.parent === a.id).toBe(false);
  });
});

describe("empty folder spaces", () => {
  it("does not draw a folder space once everything in it sits elsewhere", () => {
    const m = buildWorldMap({
      "world/questions/q.md": f("world/questions/q.md", { question: "General?" }, 1),
      "world/answers/a.md": f("world/answers/a.md", { answers: ["world/questions/q.md"] }, 2),
    }, null, T, null);
    expect(m.nodes.some((n) => n.id === "space-answers")).toBe(false);
    expect(m.nodes.some((n) => n.id === "space-questions")).toBe(true);
  });
});
