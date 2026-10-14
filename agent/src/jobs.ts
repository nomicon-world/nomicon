/**
 * Job cards: an option from paths.json plus a place on the World map, filled in.
 * site/jobs.js holds the same logic for the browser; test/jobs.test.ts keeps the two identical.
 */
import type { WorldNode } from "./worldmap.js";

export interface Recipe { channel: string; layer: "world" | "laws" | "free"; file?: string; header?: string; pr_title?: string; link?: string; steps: string[]; ask_first?: string[]; voters_only?: boolean }
export interface CatalogOption { id: string; label: string; detail: string; recipe: string; applies: string[]; kind?: string; rel?: string; verb?: string; template?: string; target?: string; command?: string; title?: string; open_only?: boolean; answered_only?: boolean }
export interface Catalog { version: number; first: string[]; fee_note?: string; doors: Array<{ id: string; label: string; say: string; color: string; options: CatalogOption[] }>; recipes: Record<string, Recipe> }
type Node = Pick<WorldNode, "id" | "label" | "kind" | "parent" | "source"> & { stub?: boolean; answered?: boolean; from?: string; to?: string; rel?: string; from_label?: string; to_label?: string; open_questions?: number; questions?: string[] };

/** A link on the map as a place: id from--type--to, with both ends' labels. */
export function edgeNode(edge: { from: string; to: string; type: string; source: string; questions?: string[]; open_questions?: number }, byId: Map<string, Node>): Node {
  const a = byId.get(edge.from), b = byId.get(edge.to);
  return { id: `${edge.from}--${edge.type}--${edge.to}`, label: `${a ? a.label : edge.from} → ${b ? b.label : edge.to} (${edge.type})`, kind: "edge", parent: null, source: edge.source,
    from: edge.from, to: edge.to, rel: edge.type, from_label: a ? a.label : edge.from, to_label: b ? b.label : edge.to, open_questions: edge.open_questions ?? 0, questions: edge.questions ?? [] };
}
export function placeType(node: Node | null): string {
  if (!node) return "none";
  if (node.kind === "edge") return "edge";
  if (node.stub) return "stub";
  if (node.kind === "space") return "space";
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
  const vals: Record<string, string> = {
    node: place ? place.id : "<node id>", node_label: place ? place.label : "<node>", space: place ? spaceOf(place, byId) : "<space>",
    source: place && place.source ? place.source : "<file>", kind: option.kind ?? "idea", rel: option.rel ?? "relates", verb: option.verb ?? "improve",
    template: option.template ?? "", target: option.target ?? "", command: option.command ?? "",
    title: option.title ?? "<your title>", new_id: "<your-id>", slug: "<your-file-name>",
    from: place && place.from ? place.from : "<from>", to: place && place.to ? place.to : "<to>", rel_type: place && place.rel ? place.rel : "relates",
    from_label: place && place.from_label ? place.from_label : "<from>", to_label: place && place.to_label ? place.to_label : "<to>",
  };
  vals["file"] = fill(recipe.file ?? "", vals);
  vals["pr_title"] = fill(recipe.pr_title ?? "", vals);
  const card: Record<string, unknown> = {
    option: option.id, label: option.label, door: door.label, detail: option.detail,
    place: place ? { id: place.id, label: place.label, type: placeType(place), space: vals["space"], source: place.source ?? null } : null,
    channel: recipe.channel, layer: recipe.layer, cost: fee(recipe.layer, baseMicro),
    file: recipe.file ? vals["file"] : null, header: recipe.header ? fill(recipe.header, vals) : null, pr_title: recipe.pr_title ? vals["pr_title"] : null,
    link: recipe.link ? fill(recipe.link, vals) : null,
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
    if (type === "none" ? o.applies.includes("none") || o.applies.includes("any") : o.applies.includes(type)) out.push({ door: d, option: o });
  }
  return out;
}
