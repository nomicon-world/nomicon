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
import { MACHINE, machineHref, type RulesSource } from "./rulesmap.js";

export interface MapFile { path: string; title?: string; map?: MapDecl; question?: string; answers: string[]; cites?: string[]; about?: string; explains?: string; challenges?: string[]; prior?: string; adds?: string; pr: number; by: number; login: string; merged_at: number; direct?: boolean;
  /** The merge that first added each thing the file declares, by `declarationKeys`, and the file itself under `file`; a later edit changes none of them. */
  origin?: Record<string, Origin> }
/** A merge that added something: its pull request, its author and when. */
export interface Origin { pr: number; by: number; login: string; merged_at: number }

/** The keys of what a header declares, so the merge that first added each can be remembered (`MapFile.origin`). */
export function declarationKeys(h: { map?: MapDecl | undefined; answers?: string[] | undefined; cites?: string[] | undefined; challenges?: string[] | undefined; about?: string | undefined; explains?: string | undefined }): string[] {
  const k: string[] = [];
  if (h.map?.node) k.push(`node:${h.map.node.id}`);
  for (const u of h.map?.place_under ?? []) k.push(`under:${u}`);
  for (const n of h.map?.needs ?? []) k.push(`needs:${n}`);
  for (const e of h.map?.edges ?? []) k.push(`edge:${e.from ?? ""}|${e.type}|${e.to}`);
  for (const q of h.answers ?? []) k.push(`answers:${q}`);
  for (const c of h.cites ?? []) k.push(`cites:${c}`);
  for (const c of h.challenges ?? []) k.push(`challenges:${c}`);
  if (h.about) k.push(`about:${h.about}`);
  if (h.explains) k.push(`explains:${h.explains}`);
  return k;
}
/** parent: the starter map's own nesting, an inner component of another point (world/replicator-map/README.md). */
export interface SourceNode { id: string; label: string; kind: string; domain: string; description?: string; position?: number[]; lod?: number; parent?: string }
export interface SourceEdge { from: string; to: string; type: string }

export interface WorldNode {
  id: string; label: string; kind: string; domain: string; parent: string | null;
  source: string | null; pr?: number; by?: number; login?: string; merged_at?: number;
  description?: string; position?: number[]; lod?: number;
  auto?: true; stub?: true; direct?: true; pointed_by?: string[]; question?: string; answered?: boolean; children: number;
  /** Question nodes asked about this node, and how many are still open. */
  questions?: string[]; open_questions?: number;
  /** For a question: the node id or from--type--to edge it is about. */
  about?: string;
  /** A starter-map point nobody has written about yet, and the file that wrote its first entry once someone has. */
  unwritten?: true; entry?: string; entry_pr?: number; entry_login?: string;
  /** Rules and machine points: their layer, where to read them, the files of a machine part, and whether no vote can change them. */
  layer?: "laws" | "constitution" | "machine"; href?: string; files?: string[]; locked?: true;
  /** Law 14: what the commons judged the contribution that made this to be. */
  progress?: Progress;
}
export interface Progress { label: string; leading?: string | null; state?: string; labellers?: number; settle_at?: number; contested?: boolean; new_unsupported?: number; labelled: boolean; cited_by: number; score: number }
export interface WorldEdge { from: string; to: string; type: string; source: string; pr?: number; by?: number; login?: string; questions?: string[]; open_questions?: number; unexplained?: true; entry?: string; entry_pr?: number; progress?: Progress }
/** The open work on the map, counted: what a newcomer could take on today. */
export interface Frontier { open_questions: number; open_spots: number; unwritten: number; unexplained: number; laws: number; articles: number }
export interface WorldMap { version: 1; computed_at: number; nodes: WorldNode[]; edges: WorldEdge[]; conflicts: Array<{ path: string; problem: string }>; frontier: Frontier }

export const spaceOf = (path: string): string | null => {
  const m = /^world\/([^/]+)\//.exec(path);
  return m ? m[1]!.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60) : null;
};
const spaceId = (s: string) => `space-${s}`;
const niceName = (path: string) => path.split("/").pop()!.replace(/\.md$/i, "").replace(/[-_]+/g, " ");
const labelOf = (f: MapFile) => f.title ?? (f.question ? (f.question.length > 80 ? f.question.slice(0, 78) + "…" : f.question) : niceName(f.path));
const fileId = (path: string) => "file-" + path.replace(/^world\//, "").replace(/\.md$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 58);

export function buildWorldMap(files: Record<string, MapFile>, replicator: { nodes: SourceNode[]; edges: SourceEdge[] } | null, now: number, rules: RulesSource | null = null): WorldMap {
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
  if (rules) {
    put({ id: "space-laws", label: "The Laws", kind: "space", domain: "rules", parent: null, source: "LAWS.md", layer: "laws", href: machineHref("LAWS.md"), children: 0 });
    for (const r of rules.laws) put({ id: r.id, label: r.label, kind: "law", domain: "rules", parent: "space-laws", source: "LAWS.md", layer: "laws", href: r.href, children: 0 });
    put({ id: "space-constitution", label: "The Constitution", kind: "space", domain: "rules", parent: null, source: "CONSTITUTION.md", layer: "constitution", href: machineHref("CONSTITUTION.md"), locked: true, children: 0 });
    for (const r of rules.articles) put({ id: r.id, label: r.label, kind: "article", domain: "rules", parent: "space-constitution", source: "CONSTITUTION.md", layer: "constitution", href: r.href, locked: true, children: 0 });
    put({ id: "space-machine", label: "The machine", kind: "space", domain: "machine", parent: null, source: "agent/", layer: "machine", href: "https://github.com/nomicon-world/nomicon/tree/main/agent", children: 0 });
    for (const m of MACHINE) put({ id: m.id, label: m.label, kind: "machine", domain: "machine", parent: "space-machine", source: m.files[0]!, layer: "machine", href: machineHref(m.files[0]!), files: m.files, children: 0 });
  }
  const inside = new Map<string, string>();
  // The starter map's own nesting: a part drawn inside the point it is a component of.
  for (const n of replicator?.nodes ?? []) if (n.parent && n.parent !== n.id && nodes.has(n.parent)) inside.set(n.id, n.parent);
  const ordered = Object.values(files).sort((a, b) => a.merged_at - b.merged_at || a.pr - b.pr || a.path.localeCompare(b.path));
  // A point or a link carries the merge that first added it to its file, so a later edit takes nothing from its maker.
  const made = (f: MapFile, key: string): Origin => f.origin?.[key] ?? { pr: f.pr, by: f.by, login: f.login, merged_at: f.merged_at };
  const meta = (f: MapFile, key: string) => { const o = made(f, key); return { source: f.path, pr: o.pr, by: o.by, login: o.login, merged_at: o.merged_at, ...(f.direct ? { direct: true as const } : {}) }; };
  const claim = (f: MapFile, key: string) => { const o = made(f, key); return { source: f.path, pr: o.pr, by: o.by, login: o.login }; };
  const nodeOfPath = new Map<string, string>();
  const pendingAbout: Array<[string, string]> = [];
  const explaining: MapFile[] = [];
  for (const f of ordered) {
    const sp = spaceOf(f.path); if (!sp) continue;
    ensureSpace(sp);
    if (f.explains) { explaining.push(f); continue; }
    const decl = f.map?.node;
    let id: string;
    if (decl && nodes.has(decl.id) && nodes.get(decl.id)!.source !== f.path && !nodes.get(decl.id)!.stub) {
      conflicts.push({ path: f.path, problem: `node id ${decl.id} is already declared by ${nodes.get(decl.id)!.source}; this file is shown as an entry instead` });
      id = fileId(f.path);
      put({ id, label: labelOf(f), kind: f.question ? "question" : "entry", domain: decl.domain, parent: spaceId(sp), ...meta(f, "file"), auto: true, children: 0 });
    } else if (decl) {
      id = decl.id;
      put({ id, label: decl.label, kind: f.question ? "question" : decl.kind, domain: decl.domain, parent: spaceId(sp), ...meta(f, `node:${decl.id}`), children: 0 });
      if (decl.inside) inside.set(id, decl.inside);
    } else {
      id = fileId(f.path);
      put({ id, label: labelOf(f), kind: f.question ? "question" : "entry", domain: "general", parent: spaceId(sp), ...meta(f, "file"), auto: true, children: 0 });
    }
    if (f.question) nodes.get(id)!.question = f.question;
    nodeOfPath.set(f.path, id);
    for (const u of f.map?.place_under ?? []) edges.push({ from: u, to: id, type: "desc", ...claim(f, `under:${u}`) });
    // What this entry needs and nobody has written: each becomes an open spot until a file declares it.
    for (const n of f.map?.needs ?? []) if (n !== id) edges.push({ from: id, to: n, type: "needs", ...claim(f, `needs:${n}`) });
    for (const e of f.map?.edges ?? []) edges.push({ from: e.from ?? id, to: e.to, type: e.type, ...claim(f, `edge:${e.from ?? ""}|${e.type}|${e.to}`) });
  }
  // Law 12: a file that explains a starter-map point is that point's entry, drawn on the point itself; a file that
  // explains a link marks the link explained and sits inside its first end. A point already written, a point that is
  // a file, or a missing target: the file becomes a point of its own, inside the target where there is one.
  for (const f of explaining) {
    const sp = spaceOf(f.path)!;
    const t = f.explains!, parts = t.split("--"), isLink = parts.length === 3;
    const first = made(f, `explains:${t}`);
    const target = isLink ? undefined : nodes.get(t);
    let id: string;
    if (target && !target.entry && !target.stub && target.kind !== "space" && !target.layer && target.source === "world/replicator-map/nodes.json") {
      target.entry = f.path; target.entry_pr = first.pr; target.entry_login = first.login;
      id = target.id;
    } else {
      id = fileId(f.path);
      let parent = spaceId(sp);
      if (isLink) {
        const e = edges.find((x) => x.from === parts[0] && x.type === parts[1] && x.to === parts[2]);
        if (!e) conflicts.push({ path: f.path, problem: `explains: ${t} names no link on the map` });
        else if (e.entry) conflicts.push({ path: f.path, problem: `explains: ${t} is already explained by ${e.entry}; this file is shown inside ${parts[0]}` });
        else { e.entry = f.path; e.entry_pr = first.pr; }
        if (nodes.has(parts[0]!)) parent = parts[0]!;
      } else if (target) parent = target.id;
      else conflicts.push({ path: f.path, problem: `explains: ${t} names no point on the map; placed in its space` });
      put({ id, label: labelOf(f), kind: f.question ? "question" : "entry", domain: "general", parent, ...meta(f, `explains:${t}`), auto: true, children: 0 });
      if (f.question) nodes.get(id)!.question = f.question;
    }
    nodeOfPath.set(f.path, id);
    for (const u of f.map?.place_under ?? []) edges.push({ from: u, to: id, type: "desc", ...claim(f, `under:${u}`) });
    for (const n of f.map?.needs ?? []) if (n !== id) edges.push({ from: id, to: n, type: "needs", ...claim(f, `needs:${n}`) });
    for (const e of f.map?.edges ?? []) edges.push({ from: e.from ?? id, to: e.to, type: e.type, ...claim(f, `edge:${e.from ?? ""}|${e.type}|${e.to}`) });
  }
  // Answers draw an edge from the answer to its question, and mark the question answered.
  for (const f of ordered) for (const q of f.answers) {
    const a = nodeOfPath.get(f.path), qn = nodeOfPath.get(q);
    if (a && qn) { edges.push({ from: a, to: qn, type: "answers", ...claim(f, `answers:${q}`) }); nodes.get(qn)!.answered = true; }
  }
  // Citations draw an edge from the citing file to each cited file it can find.
  for (const f of ordered) for (const c of f.cites ?? []) {
    const a = nodeOfPath.get(f.path), b = nodeOfPath.get(c);
    if (a && b && a !== b) edges.push({ from: a, to: b, type: "cites", ...claim(f, `cites:${c}`) });
  }
  // Challenges (Law 14) draw their own kind of link, so a dispute never reads as building on the work.
  for (const f of ordered) for (const c of f.challenges ?? []) {
    const a = nodeOfPath.get(f.path), b = nodeOfPath.get(c);
    if (a && b && a !== b) edges.push({ from: a, to: b, type: "challenges", ...claim(f, `challenges:${c}`) });
  }
  // Questions about a node or an edge: the question points at it, and it counts the questions still open.
  for (const f of ordered) {
    if (!f.question || !f.about) continue;
    const qid = nodeOfPath.get(f.path); if (!qid) continue;
    const q = nodes.get(qid)!; q.about = f.about;
    const parts = f.about.split("--");
    if (parts.length === 3) {
      const e = edges.find((x) => x.from === parts[0] && x.type === parts[1] && x.to === parts[2]);
      if (e) { (e.questions ??= []).push(qid); } else conflicts.push({ path: f.path, problem: `about: ${f.about} names no edge on the map` });
    } else {
      edges.push({ from: qid, to: f.about, type: "about", ...claim(f, `about:${f.about}`) });
      pendingAbout.push([f.about, qid]);
    }
  }
  // Questions and answers sit where they belong: a question inside the point it is about (a link's first end, a rule),
  // an answer inside the first question it answers. The files stay in world/questions and world/answers, whose paths
  // are their ids; only the drawing moves. A declared `inside` wins, and the cycle check below applies to both.
  for (const f of ordered) {
    const id = nodeOfPath.get(f.path); if (!id || inside.has(id)) continue;
    if (f.question && f.about) {
      const target = f.about.includes("--") ? f.about.split("--")[0]! : f.about;
      if (target !== id && nodes.has(target) && !nodes.get(target)!.stub) inside.set(id, target);
    } else if (f.answers.length && nodes.get(id)!.source === f.path) {
      const q = f.answers.map((p) => nodeOfPath.get(p)).find((x) => x && x !== id);
      if (q) inside.set(id, q);
    }
  }
  // Containment, refusing cycles and unknown containers (those fall back to the file's space).
  for (const [child, parent] of inside) {
    if (!nodes.has(parent)) { conflicts.push({ path: nodes.get(child)!.source ?? child, problem: `inside: ${parent} names no node; placed in its space` }); continue; }
    let p: string | null = parent, cycle = false;
    for (let i = 0; p && i < 64; i++) { if (p === child) { cycle = true; break; } p = inside.get(p) ?? nodes.get(p)?.parent ?? null; }
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
  for (const [target, qid] of pendingAbout) { const t = nodes.get(target); if (t) (t.questions ??= []).push(qid); }
  const isOpen = (qid: string) => { const q = nodes.get(qid); return !!q && !q.answered; };
  for (const n of nodes.values()) if (n.questions) n.open_questions = n.questions.filter(isOpen).length;
  for (const e of edges) if (e.questions) e.open_questions = e.questions.filter(isOpen).length;
  const seen = new Set<string>();
  const uniq = edges.filter((e) => { const k = `${e.from}|${e.to}|${e.type}`; if (seen.has(k)) return false; seen.add(k); return true; });
  // The open work: starter-map points and links nobody has written about yet, alongside open questions and spots.
  for (const n of nodes.values()) if (n.source === "world/replicator-map/nodes.json" && !n.entry) n.unwritten = true;
  for (const e of uniq) if (e.source === "world/replicator-map/relations.json" && !e.entry) e.unexplained = true;
  // A folder space left empty, now that its questions or answers sit elsewhere, is not drawn.
  const all = [...nodes.values()].filter((n) => !(n.kind === "space" && !n.layer && n.children === 0 && (n.source ?? "").startsWith("world/")));
  const frontier: Frontier = {
    open_questions: all.filter((n) => n.kind === "question" && !n.answered).length,
    open_spots: all.filter((n) => n.stub).length,
    unwritten: all.filter((n) => n.unwritten).length,
    unexplained: uniq.filter((e) => e.unexplained).length,
    laws: all.filter((n) => n.kind === "law").length,
    articles: all.filter((n) => n.kind === "article").length,
  };
  return { version: 1, computed_at: now, nodes: all.sort((a, b) => a.id.localeCompare(b.id)), edges: uniq, conflicts, frontier };
}
