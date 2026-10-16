/**
 * Job cards: an option from paths.json plus a place on the World map, filled in.
 * site/jobs.js holds the same logic for the browser; test/jobs.test.ts keeps the two identical.
 */
import type { WorldNode } from "./worldmap.js";

export interface Recipe { channel: string; layer: "world" | "laws" | "free"; file?: string; header?: string; pr_title?: string; link?: string; steps: string[]; ask_first?: string[]; voters_only?: boolean }
export interface CatalogOption { id: string; label: string; detail: string; recipe: string; applies: string[]; merged_only?: boolean; kind?: string; rel?: string; verb?: string; template?: string; target?: string; command?: string; title?: string; open_only?: boolean; answered_only?: boolean; unwritten_only?: boolean; unexplained_only?: boolean }
export interface Catalog { version: number; repo?: string; first: string[]; fee_note?: string; doors: Array<{ id: string; label: string; say: string; color: string; options: CatalogOption[] }>; recipes: Record<string, Recipe> }
type Node = Pick<WorldNode, "id" | "label" | "kind" | "parent" | "source" | "pr" | "entry" | "entry_pr"> & { stub?: boolean; answered?: boolean; from?: string; to?: string; rel?: string; from_label?: string; to_label?: string; open_questions?: number; questions?: string[]; unwritten?: boolean; unexplained?: boolean; layer?: string };

/** A link on the map as a place: id from--type--to, with both ends' labels. */
export function edgeNode(edge: { from: string; to: string; type: string; source: string; questions?: string[]; open_questions?: number; unexplained?: boolean; pr?: number; entry?: string; entry_pr?: number }, byId: Map<string, Node>): Node {
  const a = byId.get(edge.from), b = byId.get(edge.to);
  return { id: `${edge.from}--${edge.type}--${edge.to}`, label: `${a ? a.label : edge.from} → ${b ? b.label : edge.to} (${edge.type})`, kind: "edge", parent: null, source: edge.source,
    from: edge.from, to: edge.to, rel: edge.type, from_label: a ? a.label : edge.from, to_label: b ? b.label : edge.to, open_questions: edge.open_questions ?? 0, questions: edge.questions ?? [], ...(edge.unexplained ? { unexplained: true } : {}),
    ...(edge.pr ? { pr: edge.pr } : {}), ...(edge.entry ? { entry: edge.entry } : {}), ...(edge.entry_pr ? { entry_pr: edge.entry_pr } : {}) };
}
/** The pull request of the merged contribution that made a point or a link: its own, or the one that first explained it (Law 14). */
export function madeBy(node: Node): number | null { return node.pr || node.entry_pr || null; }
export function placeType(node: Node | null): string {
  if (!node) return "none";
  if (node.kind === "edge") return "edge";
  if (node.stub) return "stub";
  if (node.kind === "law" || node.kind === "article" || node.kind === "machine") return node.kind;
  if (node.kind === "space") return node.layer ? "rules-space" : "space";
  if (node.kind === "question") return "question";
  return "node";
}
export function spaceOf(node: Node, byId: Map<string, Node>): string {
  let n: Node | undefined = node, guard = 0;
  while (n && guard++ < 64) {
    if (n.kind === "space") return n.id.replace(/^space-/, "");
    const m = /^world\/([^/]+)\//.exec(n.source ?? "");
    if (m) return m[1]!;
    n = n.parent ? byId.get(n.parent) : undefined;
  }
  return "<space>";
}
function fill(text: string, vals: Record<string, string>): string {
  return String(text).replace(/\{([a-z_]+)\}/g, (all, k: string) => (vals[k] !== undefined ? vals[k]! : all));
}
export function findOption(catalog: Catalog, id: string) {
  for (const d of catalog.doors) for (const o of d.options) if (o.id === id) return { door: d, option: o };
  return null;
}
export function fee(layer: string, baseMicro: bigint | number | string): string {
  if (layer === "free") return "free";
  const m = (layer === "laws" ? 10 : 1) * Number(baseMicro);
  return `${(m / 1e6).toFixed(2)} USDC`;
}
export function jobCard(catalog: Catalog, optionId: string, node: Node | null, byId: Map<string, Node>, baseMicro: bigint | number | string, mapUrl?: string): Record<string, unknown> {
  const found = findOption(catalog, optionId);
  if (!found) return { error: `no option ${optionId} in paths.json` };
  const { door, option } = found;
  const recipe = catalog.recipes[option.recipe]!;
  const type = placeType(node);
  const ok = option.applies.includes("any") || option.applies.includes(type);
  if (!ok) return { error: type === "none" ? `${option.label} needs a place on the map: ${option.applies.join(", ")}` : `${option.label} does not apply to ${type === "stub" ? "an open spot" : "a " + type}` };
  const place = type === "none" ? null : node;
  if (place && option.open_only && place.answered) return { error: `${option.label} is for questions nobody has answered; this one is answered, so use "Give a competing answer"` };
  if (place && option.answered_only && !place.answered) return { error: `${option.label} is for questions already answered; this one is open, so use "Answer an open question"` };
  if (place && option.unwritten_only && !place.unwritten) return { error: `${option.label} is for points nobody has written about yet; this one has an entry, so extend or correct it` };
  if (place && option.unexplained_only && !place.unexplained) return { error: `${option.label} is for links nobody has explained yet; this one is explained` };
  const made = place ? madeBy(place) : null;
  if (place && option.merged_only && !made) return { error: `${option.label} is for points and links a merged contribution made; nothing merged made this one` };
  const vals: Record<string, string> = {
    node: place ? place.id : "<node id>", node_label: place ? place.label : "<node>", space: place ? spaceOf(place, byId) : "<space>",
    source: place && place.source ? place.source : "<file>", kind: option.kind ?? "idea", rel: option.rel ?? "relates", verb: option.verb ?? "improve",
    template: option.template ?? "", target: option.target ?? "", command: option.command ?? "",
    title: option.title ?? "<your title>", new_id: "<your-id>", slug: "<your-file-name>",
    from: place && place.from ? place.from : "<from>", to: place && place.to ? place.to : "<to>", rel_type: place && place.rel ? place.rel : "relates",
    from_label: place && place.from_label ? place.from_label : "<from>", to_label: place && place.to_label ? place.to_label : "<to>",
    pull_ref: made ? `pull request #${made}` : "a merged World pull request", entry_file: (place && (place.entry || place.source)) || "<its file>",
  };
  vals["file"] = fill(recipe.file ?? "", vals);
  vals["pr_title"] = fill(recipe.pr_title ?? "", vals);
  const card: Record<string, unknown> = {
    option: option.id, label: option.label, door: door.label, detail: option.detail,
    place: place ? { id: place.id, label: place.label, type: placeType(place), space: vals["space"], source: place.source ?? null } : null,
    channel: recipe.channel, layer: recipe.layer, cost: fee(recipe.layer, baseMicro),
    file: recipe.file ? vals["file"] : null, header: recipe.header ? fill(recipe.header, vals) : null, pr_title: recipe.pr_title ? vals["pr_title"] : null,
    link: option.merged_only && made ? `${catalog.repo ?? "https://github.com/nomicon-world/nomicon"}/pull/${made}` : recipe.link ? fill(recipe.link, vals) : null,
    ...(option.merged_only ? { pull_request: made } : {}),
    steps: recipe.steps.map((s) => fill(s, vals)), ask_first: [...(recipe.ask_first ?? [])], voters_only: !!recipe.voters_only,
    cost_note: recipe.layer === "free" ? null : (catalog.fee_note ?? null),
  };
  if (mapUrl) card["map"] = place ? `${mapUrl}#node=${encodeURIComponent(place.id)}&do=${encodeURIComponent(option.id)}` : `${mapUrl}#do=${encodeURIComponent(option.id)}`;
  return card;
}
export function optionsFor(catalog: Catalog, node: Node | null) {
  const type = placeType(node);
  const out: Array<{ door: Catalog["doors"][number]; option: CatalogOption }> = [];
  for (const d of catalog.doors) for (const o of d.options) {
    if (node && o.open_only && node.answered) continue;
    if (node && o.answered_only && !node.answered) continue;
    if (node && o.unwritten_only && !node.unwritten) continue;
    if (node && o.unexplained_only && !node.unexplained) continue;
    if (node && o.merged_only && !madeBy(node)) continue;
    if (type === "none" ? o.applies.includes("none") || o.applies.includes("any") : o.applies.includes(type)) out.push({ door: d, option: o });
  }
  return out;
}
