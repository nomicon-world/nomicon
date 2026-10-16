import { describe, expect, it } from "vitest";
import { parseHeader } from "../src/questions.js";
import { fold } from "../src/state.js";
import { buildWorldMap } from "../src/worldmap.js";
import type { LedgerEvent } from "../src/ledger.js";
import { laws } from "./helpers.js";

const head = (y: string) => `---\nnomicon:\n${y}\n---\n# X\n\nBody.\n`;
const path = "world/notes/x.md";
const v1 = head("  map:\n    node: { id: x, label: X, kind: idea }\n    edges:\n      - { to: y, type: feeds }");
const v2 = head("  map:\n    node: { id: x, label: X, kind: idea }\n    edges:\n      - { to: y, type: feeds }\n      - { to: z, type: feeds }");
const merge = (id: number, pr: number, by: number, login: string, md: string) =>
  ({ id, at: 1000 + id, type: "merge", pr, account: by, login, layer: "world", paths: [path], headers: { [path]: parseHeader(md)! }, weight_micro: "1000000" }) as unknown as LedgerEvent;

describe("who made what on the map", () => {
  it("keeps the maker of a point and of its links after an edit, and credits a link the edit added to the editor", () => {
    const st = fold([merge(1, 1, 1, "alice", v1), merge(2, 2, 2, "bob", v2)], 5000, laws);
    const m = buildWorldMap(st.map_files, null, 5000);
    expect(m.nodes.find((n) => n.id === "x")).toMatchObject({ pr: 1, by: 1, login: "alice", merged_at: 1001 });
    expect(m.edges.find((e) => e.to === "y")).toMatchObject({ pr: 1, login: "alice" });
    expect(m.edges.find((e) => e.to === "z")).toMatchObject({ pr: 2, login: "bob" });
    expect(st.map_files[path]).toMatchObject({ pr: 2, login: "bob" }); // the file itself was last changed by the edit
  });

  it("forgets a maker whose merge was revoked, so the next merge that writes it is its maker", () => {
    const takedown = { id: 2, at: 1002, type: "takedown", prs: [1] } as unknown as LedgerEvent;
    const st = fold([merge(1, 1, 1, "alice", v1), takedown, merge(3, 2, 2, "bob", v1)], 5000, laws);
    const m = buildWorldMap(st.map_files, null, 5000);
    expect(m.nodes.find((n) => n.id === "x")).toMatchObject({ pr: 2, login: "bob" });
    expect(m.edges.find((e) => e.to === "y")).toMatchObject({ pr: 2, login: "bob" });
  });
});
