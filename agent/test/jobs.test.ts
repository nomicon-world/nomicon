import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { jobCard, optionsFor, type Catalog } from "../src/jobs.js";
// @ts-expect-error plain JavaScript module shared with the site
import * as site from "../../site/jobs.js";

const catalog = JSON.parse(readFileSync(new URL("../../paths.json", import.meta.url), "utf8")) as Catalog;
const nodes = [
  { id: "space-questions", label: "questions", kind: "space", parent: null, source: "world/questions/" },
  { id: "file-questions-why", label: "Why?", kind: "question", parent: "space-questions", source: "world/questions/why.md" },
  { id: "file-questions-how", label: "How?", kind: "question", parent: "space-questions", source: "world/questions/how.md", answered: true },
  { id: "pdf-skill", label: "PDF skill", kind: "skill", parent: "space-skills", source: "world/skills/pdf.md" },
  { id: "space-skills", label: "skills", kind: "space", parent: null, source: "world/skills/" },
  { id: "ocr-skill", label: "ocr skill", kind: "stub", parent: "space-skills", source: null, stub: true },
  { id: "big-bang", label: "Big Bang", kind: "phys", parent: "space-replicator-map", source: "world/replicator-map/nodes.json" },
  { id: "space-replicator-map", label: "replicator-map", kind: "space", parent: null, source: "world/replicator-map/" },
];
const byId = new Map(nodes.map((n) => [n.id, n]));
const MAP = "https://nomicon-world.github.io/nomicon/site/map.html";

describe("paths.json", () => {
  it("has 8 doors, 56 options with unique ids, known recipes, and existing first options", () => {
    const ids = catalog.doors.flatMap((d) => d.options.map((o) => o.id));
    expect(catalog.doors).toHaveLength(8);
    expect(ids).toHaveLength(56);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of catalog.doors) for (const o of d.options) expect(catalog.recipes[o.recipe], o.id).toBeDefined();
    for (const f of catalog.first) expect(ids).toContain(f);
  });
});

describe("job cards", () => {
  it("are identical from the site and the agent, for every option at every kind of place", () => {
    for (const d of catalog.doors) for (const o of d.options) for (const n of [null, ...nodes]) {
      expect(site.jobCard(catalog, o.id, n, byId, 1000000n, MAP), `${o.id} at ${n?.id}`).toEqual(jobCard(catalog, o.id, n as never, byId as never, 1000000n, MAP));
    }
    for (const n of [null, ...nodes]) expect(site.optionsFor(catalog, n).map((x: { option: { id: string } }) => x.option.id)).toEqual(optionsFor(catalog, n as never).map((x) => x.option.id));
  });

  it("fill in the place: an answer names the question's file, an open spot keeps its id", () => {
    const a = jobCard(catalog, "answer", byId.get("file-questions-why") as never, byId as never, 1000000n, MAP);
    expect(a["header"]).toContain("answers: [world/questions/why.md]");
    expect(a["file"]).toBe("world/answers/<your-file-name>.md");
    expect(a["cost"]).toBe("1.00 USDC");
    expect(a["map"]).toBe(`${MAP}#node=file-questions-why&do=answer`);
    const f = jobCard(catalog, "fill-spot", byId.get("ocr-skill") as never, byId as never, 1000000n);
    expect(f["header"]).toContain("node: { id: ocr-skill, label: \"ocr skill\"");
    expect(f["file"]).toBe("world/skills/ocr-skill.md");
  });

  it("send open questions to answer and answered ones to a competing answer, and carry the fee note on paid cards", () => {
    const how = byId.get("file-questions-how") as never, why = byId.get("file-questions-why") as never;
    expect(jobCard(catalog, "answer", how, byId as never, 1000000n)["error"]).toMatch(/competing answer/);
    expect(jobCard(catalog, "competing-answer", why, byId as never, 1000000n)["error"]).toMatch(/Answer an open question/);
    expect(jobCard(catalog, "competing-answer", how, byId as never, 1000000n)["error"]).toBeUndefined();
    expect(optionsFor(catalog, how).map((x) => x.option.id)).not.toContain("answer");
    expect(optionsFor(catalog, why).map((x) => x.option.id)).not.toContain("competing-answer");
    expect(jobCard(catalog, "answer", why, byId as never, 1000000n)["cost_note"]).toMatch(/8 kilobytes/);
    expect(jobCard(catalog, "report-bug", null, byId as never, 1000000n)["cost_note"]).toBeNull();
  });

  it("refuse an option that does not fit the place, and price the Laws layer at ten times", () => {
    expect(jobCard(catalog, "answer", byId.get("pdf-skill") as never, byId as never, 1000000n)["error"]).toMatch(/does not apply/);
    expect(jobCard(catalog, "answer", null, byId as never, 1000000n)["error"]).toMatch(/needs a place/);
    expect(jobCard(catalog, "fix-agent", null, byId as never, 1500000n)["cost"]).toBe("15.00 USDC");
    expect(jobCard(catalog, "report-bug", null, byId as never, 1000000n)["link"]).toContain("template=bug-report.yml");
    expect(jobCard(catalog, "new-node", byId.get("big-bang") as never, byId as never, 1000000n)["file"]).toBe("world/replicator-map/<your-file-name>.md");
  });
});
