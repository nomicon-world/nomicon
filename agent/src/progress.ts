/**
 * Law 14: the progress board. What the commons judged each merged World contribution to be (a label given in a
 * review or a comment), what it did to the frontier (structure), and who built on it (citations), combined into
 * a score. Visibility only: it mints no weight and moves no money. Pure, from the ledger alone, so replay agrees.
 */
import type { LedgerEvent } from "./ledger.js";
import type { Laws, ProgressLabel } from "./laws.js";
import { PROGRESS_LABELS } from "./laws.js";
import type { MapFile } from "./worldmap.js";

export interface Labeller { account: number; weightMicro: bigint }
export interface Contribution {
  pr: number; account: number; login: string; merged_at: number; paths: string[]; layer: string;
  /** The winning label, the weight behind each label (micro-USDC), and who gave which. */
  label: ProgressLabel; labelled: boolean; label_weight: Record<ProgressLabel, string>; labels: Array<{ account: number; label: ProgressLabel }>;
  /** What it did to the frontier, and the factor that earns. */
  structure: string[]; structure_factor: number;
  /** Distinct other accounts whose merged contributions cite it. */
  cited_by: number[];
  score: number;
}
export interface ProgressBoard { version: 1; computed_at: number; contributions: Contribution[]; authors: Array<{ account: number; login: string; score: number; contributions: number; new: number }> }

/** The label in a review or comment: one line `label: new|builds|collects`. The last such line wins. */
export function parseLabel(body: string | undefined | null): ProgressLabel | null {
  if (!body) return null;
  let out: ProgressLabel | null = null;
  for (const m of body.matchAll(/^\s*label:\s*(new|builds|collects)\s*$/gim)) out = m[1]!.toLowerCase() as ProgressLabel;
  return out;
}

/**
 * The board. `files` are the merged World files as the ledger recorded them (state.map_files), `events` the ledger,
 * `weights` each account's weight (mature plus maturing), `merged` the accounts with a merged contribution that was
 * not revoked, `owners` the owner accounts, whose labels never count (Article 1: the owner judges no content).
 */
export function progressBoard(files: Record<string, MapFile>, events: LedgerEvent[], weights: Map<number, bigint>, merged: Set<number>, owners: Set<number>, baseMicro: bigint, laws: Laws, now: number): ProgressBoard {
  const p = laws.progress;
  const byPr = new Map<number, MapFile[]>();
  for (const f of Object.values(files)) { if (!f.pr) continue; if (!byPr.has(f.pr)) byPr.set(f.pr, []); byPr.get(f.pr)!.push(f); }
  const layerOf = new Map<number, string>();
  for (const e of events) if (e.type === "merge") layerOf.set(Number(e["pr"]), String(e["layer"] ?? "world"));
  const revoked = new Set<number>();
  for (const e of events) {
    if (e.type === "takedown") for (const pr of (e["prs"] as number[]) ?? []) revoked.add(pr);
    if (e.type === "declare" && e["what"] === "refund") revoked.add(Number(e["pr"]));
  }
  // Latest label per account per pull request.
  const labels = new Map<number, Map<number, ProgressLabel>>();
  for (const e of events) {
    if (e.type !== "label") continue;
    const pr = Number(e["pr"]), acct = Number(e["account"]), l = String(e["label"]) as ProgressLabel;
    if (!(PROGRESS_LABELS as readonly string[]).includes(l)) continue;
    if (!labels.has(pr)) labels.set(pr, new Map());
    labels.get(pr)!.set(acct, l);
  }
  const floor = BigInt(Math.round(p.labeller_floor_base_fees * Number(baseMicro)));
  const pathPr = new Map<string, number>();
  for (const [pr, fs] of byPr) for (const f of fs) pathPr.set(f.path, pr);
  // Ids that earlier files needed: declaring one fills a spot.
  const ordered = [...byPr.entries()].sort((a, b) => a[1][0]!.merged_at - b[1][0]!.merged_at || a[0] - b[0]);
  const contributions: Contribution[] = [];
  for (const [pr, fs] of ordered) {
    const layer = layerOf.get(pr) ?? "world";
    if (!p.scored_layers.includes(layer as "world" | "laws") || revoked.has(pr)) continue;
    const first = fs[0]!, mergedAt = Math.min(...fs.map((f) => f.merged_at));
    const weight: Record<ProgressLabel, bigint> = { new: 0n, builds: 0n, collects: 0n };
    const given: Array<{ account: number; label: ProgressLabel }> = [];
    for (const [acct, l] of labels.get(pr) ?? []) {
      if (acct === first.by || owners.has(acct) || !merged.has(acct)) continue;
      const w = weights.get(acct) ?? 0n;
      weight[l] += w > floor ? w : floor;
      given.push({ account: acct, label: l });
    }
    const labelled = given.length > 0;
    let label: ProgressLabel = p.default_label;
    if (labelled) {
      let best = -1n;
      for (const l of PROGRESS_LABELS) if (weight[l] > best) { best = weight[l]; label = l; }
      const tied = PROGRESS_LABELS.filter((l) => weight[l] === best);
      if (tied.length > 1) label = p.default_label; // a tie is no judgment: the default stands
    }
    const structure: string[] = [];
    const needed = new Set<string>();
    for (const [, gs] of ordered) for (const g of gs) if (g.merged_at < mergedAt) for (const n of g.map?.needs ?? []) needed.add(n);
    for (const f of fs) {
      if (f.explains) structure.push(f.explains.includes("--") ? "explains a link" : "writes a first entry");
      if (f.answers.length) structure.push("answers a question");
      if (f.map?.node && needed.has(f.map.node.id)) structure.push("fills an open spot");
      if (f.question && [...byPr.values()].some((gs) => gs.some((g) => g.pr !== pr && g.answers.includes(f.path)))) structure.push("asked a question that was answered");
    }
    const uniq = [...new Set(structure)];
    const cited = new Set<number>();
    for (const [other, gs] of byPr) if (other !== pr) for (const g of gs) if (g.by !== first.by && merged.has(g.by) && (g.cites ?? []).some((c) => pathPr.get(c) === pr)) cited.add(g.by);
    const structureFactor = uniq.length ? p.structure_factor : 1;
    const score = Math.round(p.label_factors[label] * structureFactor * (1 + cited.size) * 100) / 100;
    contributions.push({
      pr, account: first.by, login: first.login, merged_at: mergedAt, paths: fs.map((f) => f.path).sort(), layer,
      label, labelled, label_weight: { new: weight.new.toString(), builds: weight.builds.toString(), collects: weight.collects.toString() }, labels: given.sort((a, b) => a.account - b.account),
      structure: uniq, structure_factor: structureFactor, cited_by: [...cited].sort((a, b) => a - b), score,
    });
  }
  contributions.sort((a, b) => b.score - a.score || a.merged_at - b.merged_at || a.pr - b.pr);
  const authors = new Map<number, { account: number; login: string; score: number; contributions: number; new: number }>();
  for (const c of contributions) {
    const a = authors.get(c.account) ?? { account: c.account, login: c.login, score: 0, contributions: 0, new: 0 };
    a.score = Math.round((a.score + c.score) * 100) / 100; a.contributions++; if (c.label === "new") a.new++;
    authors.set(c.account, a);
  }
  return { version: 1, computed_at: now, contributions, authors: [...authors.values()].sort((a, b) => b.score - a.score || a.account - b.account) };
}
