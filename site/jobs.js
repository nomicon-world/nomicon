// Job cards: an option from paths.json plus a place on the World map, filled in.
// The agent has the same logic in agent/src/jobs.ts; a test keeps the two identical.
/** A link on the map as a place: id from--type--to, with both ends' labels. */
export function edgeNode(edge, byId) {
  const a = byId.get(edge.from), b = byId.get(edge.to);
  return { id: `${edge.from}--${edge.type}--${edge.to}`, label: `${a ? a.label : edge.from} → ${b ? b.label : edge.to} (${edge.type})`, kind: "edge", parent: null, source: edge.source,
    from: edge.from, to: edge.to, rel: edge.type, from_label: a ? a.label : edge.from, to_label: b ? b.label : edge.to, open_questions: edge.open_questions ?? 0, questions: edge.questions ?? [], ...(edge.unexplained ? { unexplained: true } : {}) };
}
export function placeType(node) {
  if (!node) return "none";
  if (node.kind === "edge") return "edge";
  if (node.stub) return "stub";
  if (node.kind === "law" || node.kind === "article" || node.kind === "machine") return node.kind;
  if (node.kind === "space") return node.layer ? "rules-space" : "space";
  if (node.kind === "question") return "question";
  return "node";
}
export function spaceOf(node, byId) {
  let n = node, guard = 0;
  while (n && guard++ < 64) {
    if (n.kind === "space") return n.id.replace(/^space-/, "");
    const m = /^world\/([^/]+)\//.exec(n.source || "");
    if (m) return m[1];
    n = n.parent ? byId.get(n.parent) : null;
  }
  return "<space>";
}
function fill(text, vals) {
  return String(text).replace(/\{([a-z_]+)\}/g, (all, k) => (vals[k] !== undefined && vals[k] !== null ? String(vals[k]) : all));
}
export function findOption(catalog, id) {
  for (const d of catalog.doors) for (const o of d.options) if (o.id === id) return { door: d, option: o };
  return null;
}
export function fee(layer, baseMicro) {
  if (layer === "free") return "free";
  const m = (layer === "laws" ? 10 : 1) * Number(baseMicro);
  return `${(m / 1e6).toFixed(2)} USDC`;
}
/** The job card, or { error } when the option does not fit the place. */
export function jobCard(catalog, optionId, node, byId, baseMicro, mapUrl) {
  const found = findOption(catalog, optionId);
  if (!found) return { error: `no option ${optionId} in paths.json` };
  const { door, option } = found;
  const recipe = catalog.recipes[option.recipe];
  const type = placeType(node);
  const ok = option.applies.includes("any") || option.applies.includes(type);
  if (!ok) return { error: type === "none" ? `${option.label} needs a place on the map: ${option.applies.join(", ")}` : `${option.label} does not apply to ${type === "stub" ? "an open spot" : "a " + type}` };
  const place = type === "none" ? null : node;
  if (place && option.open_only && place.answered) return { error: `${option.label} is for questions nobody has answered; this one is answered, so use "Give a competing answer"` };
  if (place && option.answered_only && !place.answered) return { error: `${option.label} is for questions already answered; this one is open, so use "Answer an open question"` };
  if (place && option.unwritten_only && !place.unwritten) return { error: `${option.label} is for points nobody has written about yet; this one has an entry, so extend or correct it` };
  if (place && option.unexplained_only && !place.unexplained) return { error: `${option.label} is for links nobody has explained yet; this one is explained` };
  const vals = {
    node: place ? place.id : "<node id>", node_label: place ? place.label : "<node>", space: place ? spaceOf(place, byId) : "<space>",
    source: place && place.source ? place.source : "<file>", kind: option.kind ?? "idea", rel: option.rel ?? "relates", verb: option.verb ?? "improve",
    template: option.template ?? "", target: option.target ?? "", command: option.command ?? "",
    title: option.title ?? "<your title>", new_id: "<your-id>", slug: "<your-file-name>",
    from: place && place.from ? place.from : "<from>", to: place && place.to ? place.to : "<to>", rel_type: place && place.rel ? place.rel : "relates",
    from_label: place && place.from_label ? place.from_label : "<from>", to_label: place && place.to_label ? place.to_label : "<to>",
  };
  vals.file = fill(recipe.file ?? "", vals);
  vals.pr_title = fill(recipe.pr_title ?? "", vals);
  const card = {
    option: option.id, label: option.label, door: door.label, detail: option.detail,
    place: place ? { id: place.id, label: place.label, type: placeType(place), space: vals.space, source: place.source ?? null } : null,
    channel: recipe.channel, layer: recipe.layer, cost: fee(recipe.layer, baseMicro),
    file: recipe.file ? vals.file : null, header: recipe.header ? fill(recipe.header, vals) : null, pr_title: recipe.pr_title ? vals.pr_title : null,
    link: recipe.link ? fill(recipe.link, vals) : null,
    steps: recipe.steps.map((s) => fill(s, vals)), ask_first: [...(recipe.ask_first ?? [])], voters_only: !!recipe.voters_only,
    cost_note: recipe.layer === "free" ? null : (catalog.fee_note ?? null),
  };
  if (mapUrl) card.map = place ? `${mapUrl}#node=${encodeURIComponent(place.id)}&do=${encodeURIComponent(option.id)}` : `${mapUrl}#do=${encodeURIComponent(option.id)}`;
  return card;
}
/** Options that make sense at a place, in catalog order. */
export function optionsFor(catalog, node) {
  const type = placeType(node);
  const out = [];
  for (const d of catalog.doors) for (const o of d.options) {
    if (node && o.open_only && node.answered) continue;
    if (node && o.answered_only && !node.answered) continue;
    if (node && o.unwritten_only && !node.unwritten) continue;
    if (node && o.unexplained_only && !node.unexplained) continue;
    if (type === "none" ? o.applies.includes("none") || o.applies.includes("any") : o.applies.includes(type)) out.push({ door: d, option: o });
  }
  return out;
}
