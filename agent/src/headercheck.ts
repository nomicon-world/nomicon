import { parseHeader, titleOf } from "./questions.js";
import { buildWorldMap, type MapFile, type SourceEdge, type SourceNode } from "./worldmap.js";

/**
 * Law 12: what the agent read from the headers of a submission's World files, as the map would show them after
 * merge. Posted with the quote, so a mistyped header is found before paying rather than dropped silently after.
 */
export function headerReport(
  changed: Array<{ path: string; content: string }>,
  removed: string[],
  world: Record<string, MapFile>,
  replicator: { nodes: SourceNode[]; edges: SourceEdge[] } | null,
  pr: number,
  now: number,
): string[] {
  const mine = changed.filter((f) => f.path.startsWith("world/") && f.path.toLowerCase().endsWith(".md"));
  if (!mine.length) return [];
  const files: Record<string, MapFile> = { ...world };
  for (const p of removed) delete files[p];
  const unreadable = new Set<string>();
  for (const f of mine) {
    const h = parseHeader(f.content);
    if (!h && /^\uFEFF?---\r?\n/.test(f.content)) unreadable.add(f.path);
    const title = titleOf(f.content);
    files[f.path] = {
      path: f.path, answers: h?.answers ?? [], pr, by: 0, login: "", merged_at: now,
      ...(title ? { title } : {}), ...(h?.map ? { map: h.map } : {}), ...(h?.question ? { question: h.question } : {}),
      ...(h?.cites.length ? { cites: h.cites } : {}), ...(h?.about ? { about: h.about } : {}),
    };
  }
  const m = buildWorldMap(files, replicator, now);
  const out: string[] = [];
  for (const f of mine) {
    const parts: string[] = [];
    const node = m.nodes.find((n) => n.source === f.path && !n.stub);
    if (unreadable.has(f.path)) parts.push("its header could not be read (check the YAML and the `nomicon:` key), so it is placed by its title only");
    if (node) parts.push(`appears on the map as "${node.label}" (id \`${node.id}\`${node.parent ? `, inside \`${node.parent}\`` : ""})`);
    const mf = files[f.path]!;
    if (mf.question) parts.push("asks a question");
    for (const a of mf.answers) {
      const t = files[a];
      parts.push(!t ? `answers \`${a}\`, which is not a file in the World, so that link would be dropped` : !t.question ? `answers \`${a}\`, which asks no question, so that link would be dropped` : `answers \`${a}\``);
    }
    for (const c of mf.cites ?? []) parts.push(files[c] ? `cites \`${c}\`` : `cites \`${c}\`, which is not a file in the World, so that link would be dropped`);
    if (mf.about) parts.push(`is about \`${mf.about}\``);
    if (mf.map?.needs.length) parts.push(`opens ${mf.map.needs.length === 1 ? "a spot" : "spots"} for ${mf.map.needs.map((n) => `\`${n}\``).join(", ")}`);
    for (const c of m.conflicts) if (c.path === f.path) parts.push(c.problem);
    out.push(`\`${f.path}\`: ${parts.length ? parts.join("; ") : "no Nomicon header"}.`);
  }
  return out;
}
