import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { jobCard, optionsFor, edgeNode, type Catalog } from "../src/jobs.js";
import { buildWorldMap } from "../src/worldmap.js";
import { rulesFrom } from "../src/rulesmap.js";

const cat = JSON.parse(readFileSync("../paths.json", "utf8")) as Catalog;
const rep = { nodes: [{ id: "stars", label: "Stars", kind: "phys", domain: "c" }, { id: "black-holes", label: "Black holes", kind: "phys", domain: "c" }], edges: [{ from: "stars", to: "black-holes", type: "desc" }] };
const m = buildWorldMap({}, rep, 1, rulesFrom("## Law 5. Fees\n", "## Article 7. Fees\n"));
const byId = new Map(m.nodes.map((n) => [n.id, n]));

describe("jobs for the new places", () => {
  it("offers write-entry on an unwritten point and explain-link on an unexplained link, with the right files and headers", () => {
    const w = jobCard(cat, "write-entry", byId.get("black-holes")!, byId, 1_000_000) as Record<string, string>;
    expect(w["file"]).toBe("world/replicator-map/black-holes.md");
    expect(w["header"]).toContain("explains: black-holes");
    const e = edgeNode(m.edges[0]!, byId);
    const x = jobCard(cat, "explain-link", e, byId, 1_000_000) as Record<string, string>;
    expect(x["file"]).toBe("world/replicator-map/stars--desc--black-holes.md");
    expect(x["header"]).toContain("explains: stars--desc--black-holes");
  });

  it("offers a Law a change and a question, an article only a question, and a machine part a bug report and a change", () => {
    const ids = (id: string) => optionsFor(cat, byId.get(id)!).map((o) => o.option.id).sort();
    expect(ids("law-5")).toEqual(["ask", "propose-rule"]);
    expect(ids("article-7")).toEqual(["ask"]);
    expect(ids("machine-payments")).toEqual(["ask", "propose-machine", "report-bug", "verify-ledger"]);
    expect(ids("space-laws")).toEqual(["ask"]); // a question about the Laws as a whole
    const r = jobCard(cat, "propose-rule", byId.get("law-5")!, byId, 1_000_000) as Record<string, string>;
    expect(r).toMatchObject({ file: "LAWS.md", layer: "laws", cost: "10.00 USDC", pr_title: "Laws: Law 5. Fees, <what changes>" });
    expect(jobCard(cat, "write-entry", byId.get("law-5")!, byId, 1_000_000)["error"]).toBeTruthy();
  });
});
