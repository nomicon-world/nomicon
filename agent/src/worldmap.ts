/**
 * Law 12: the World map, derived from what merged files declare.
 *
 * Every top-level directory under world/ is a space and is drawn as a container. A file that declares
 * a node puts that node inside its space, or inside the node it names with `inside`. A file that
 * declares no node still appears, as an entry inside its space. An edge to an id nobody declared is a
 * frontier stub: an open spot. The map is derived output, never an input to a vote, and is rebuilt
 * from the ledger (plus the files of world/replicator-map, read as one more source) after every merge.
 */
import type { MapDecl } from "./questions.js";

export interface MapFile { path: string; title?: string; map?: MapDecl; question?: string; answers: string[]; pr: number; by: number; login: string; merged_at: number; direct?: boolean }
export interface SourceNode { id: string; label: string; kind: string; domain: string; description?: string; position?: number[]; lod?: number }
export interface SourceEdge { from: string; to: string; type: string }

export interface WorldNode {
  id: string; label: string; kind: string; domain: string; parent: string | null;
  source: string | null; pr?: number; by?: number; login?: string; merged_at?: number;
  description?: string; position?: number[]; lod?: number;
  auto?: true; stub?: true; direct?: true; pointed_by?: string[]; question?: string; answered?: boolean; children: number;
}
export interface WorldEdge { from: string; to: string; type: string; source: string; pr?: number }
export interface WorldMap { version: 1; computed_at: number; nodes: WorldNode[]; edges: WorldEdge[]; conflicts: Array<{ path: string; problem: string }> }

export const spaceOf = (path: string): string | null => {
  const m = /^world\/([^/]+)\//.exec(path);
  return m ? m[1]!.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60) : null;
};
const spaceId = (s: string) => `space-${s}`;
const niceName = (path: string) => path.split("/").pop()!.replace(/\.md$/i, "").replace(/[-_]+/g, " ");
const labelOf = (f: MapFile) => f.title ?? (f.question ? (f.question.length > 80 ? f.question.slice(0, 78) + "…" : f.question) : niceName(f.path));
const fileId = (path: string) => "file-" + path.replace(/^world\//, "").replace(/\.md$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 58);

export function buildWorldMap(files: Record<string, MapFile>, replicator: { nodes: SourceNode[]; edges: SourceEdge[] } | null, now: number): WorldMap {
  const nodes = new Map<string, WorldNode>();
  const edges: WorldEdge[] = [];
  const conflicts: WorldMap["conflicts"] = [];
  const put = (n: WorldNode) => { nodes.set(n.id, n); };
  const ensureSpace = (s: string) => { if (!nodes.has(spaceId(s))) put({ id: spaceId(s), label: s, kind: "space", domain: "world", parent: null, source: `world/${s}/`, children: 0 }); };

  if (replicator) {
    ensureSpace("replicator-map");
    for (const n of replicator.nodes) put({ id: n.id, label: n.label, kind: n.kind, domain: n.domain, parent: spaceId("replicator-map"), source: "world/replicator-map/nodes.json", ...(n.description !== undefined ? { description: n.description } : {}), ...(n.position ? { position: n.position } : {}), ...(n.lod !== undefined ? { lod: n.lod } : {}), children: 0 });
    for (const e of replicator.edges) edges.push({ from: e.from, to: e.to, type: e.type, source: "world/replicator-map/relations.json" });
  }
  const inside = new Map<string, string>();
  const ordered = Object.values(files).sort((a, b) => a.merged_at - b.merged_at || a.pr - b.pr || a.path.localeCompare(b.path));
  const nodeOfPath = new Map<string, string>();
  for (const f of ordered) {
    const sp = spaceOf(f.path); if (!sp) continue;
    ensureSpace(sp);
    const meta = { source: f.path, pr: f.pr, by: f.by, login: f.login, merged_at: f.merged_at, ...(f.direct ? { direct: true as const } : {}) };
    const decl = f.map?.node;
    let id: string;
    if (decl && nodes.has(decl.id) && nodes.get(decl.id)!.source !== f.path && !nodes.get(decl.id)!.stub) {
      conflicts.push({ path: f.path, problem: `node id ${decl.id} is already declared by ${nodes.get(decl.id)!.source}; this file is shown as an entry instead` });
      id = fileId(f.path);
      put({ id, label: labelOf(f), kind: f.question ? "question" : "entry", domain: decl.domain, parent: spaceId(sp), ...meta, auto: true, children: 0 });
    } else if (decl) {
      id = decl.id;
      put({ id, label: decl.label, kind: f.question ? "question" : decl.kind, domain: decl.domain, parent: spaceId(sp), ...meta, children: 0 });
      if (decl.inside) inside.set(id, decl.inside);
    } else {
      id = fileId(f.path);
      put({ id, label: labelOf(f), kind: f.question ? "question" : "entry", domain: "general", parent: spaceId(sp), ...meta, auto: true, children: 0 });
    }
    if (f.question) nodes.get(id)!.question = f.question;
    nodeOfPath.set(f.path, id);
    for (const u of f.map?.place_under ?? []) edges.push({ from: u, to: id, type: "desc", source: f.path, pr: f.pr });
    for (const e of f.map?.edges ?? []) edges.push({ from: e.from ?? id, to: e.to, type: e.type, source: f.path, pr: f.pr });
  }
  // Answers draw an edge from the answer to its question, and mark the question answered.
  for (const f of ordered) for (const q of f.answers) {
    const a = nodeOfPath.get(f.path), qn = nodeOfPath.get(q);
    if (a && qn) { edges.push({ from: a, to: qn, type: "answers", source: f.path, pr: f.pr }); nodes.get(qn)!.answered = true; }
  }
  // Containment, refusing cycles and unknown containers (those fall back to the file's space).
  for (const [child, parent] of inside) {
    if (!nodes.has(parent)) { conflicts.push({ path: nodes.get(child)!.source ?? child, problem: `inside: ${parent} names no node; placed in its space` }); continue; }
    let p: string | null = parent, cycle = false;
    for (let i = 0; p && i < 64; i++) { if (p === child) { cycle = true; break; } p = inside.get(p) ?? null; }
    if (cycle) { conflicts.push({ path: nodes.get(child)!.source ?? child, problem: `inside: ${parent} would make a loop; placed in its space` }); inside.delete(child); continue; }
    nodes.get(child)!.parent = parent;
  }
  // Frontier stubs: every edge end nobody declared.
  for (const e of edges) for (const end of [e.from, e.to]) {
    if (nodes.has(end) && !nodes.get(end)!.stub) continue;
    const stub = nodes.get(end) ?? { id: end, label: end.replace(/-/g, " "), kind: "stub", domain: "frontier", parent: null, source: null, stub: true as const, pointed_by: [], children: 0 };
    if (!stub.pointed_by!.includes(e.source)) stub.pointed_by!.push(e.source);
    if (stub.parent === null) { const other = end === e.from ? e.to : e.from; stub.parent = nodes.get(other)?.parent ?? null; }
    put(stub);
  }
  for (const n of nodes.values()) if (n.parent && nodes.has(n.parent)) nodes.get(n.parent)!.children++;
  const seen = new Set<string>();
  const uniq = edges.filter((e) => { const k = `${e.from}|${e.to}|${e.type}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { version: 1, computed_at: now, nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)), edges: uniq, conflicts };
}
