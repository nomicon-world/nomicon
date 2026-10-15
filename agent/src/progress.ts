/**
 * Law 14: the progress board. What the commons judged each merged World contribution to be (a label given in a
 * review or a comment, a "new" one with its pointer), what it did to the frontier (structure), who built on it
 * (citations), and whether its label is provisional, settled or contested. Visibility only: it mints no weight
 * and moves no money. Pure, from the ledger alone, so the agent and replay compute the same board.
 */
import type { LedgerEvent } from "./ledger.js";
import type { Laws, ProgressLabel } from "./laws.js";
import { PROGRESS_LABELS } from "./laws.js";
import type { MapFile } from "./worldmap.js";

export interface ParsedLabel { label: ProgressLabel; unlike: string | null; because: string | null }
export interface LabelEntry { account: number; login: string; label: ProgressLabel; counted_as: ProgressLabel; unlike: string | null; because: string | null; at: number }
export interface ChallengeEntry { account: number; login: string; text: string | null; path: string | null; source: string; at: number }
export interface Contribution {
  pr: number; account: number; login: string; merged_at: number; paths: string[]; layer: string;
  /** The label the score uses: the settled label, or the default while provisional. */
  label: ProgressLabel;
  /** The label ahead among counted labels, settled or not; null when nobody has labelled. */
  leading: ProgressLabel | null;
  state: "unlabelled" | "provisional" | "settled";
  labelled: boolean; labellers: number; settle_at: number;
  /** "new" labels counted as builds for lack of a pointer: the board shows the claim as "new?". */
  new_unsupported: number;
  author_pointer: { prior: string; adds: string } | null;
  contested: boolean;
  label_weight: Record<ProgressLabel, string>;
  labels: LabelEntry[]; challenges: ChallengeEntry[];
  /** When labels and challenges stop being accepted, unless a new challenge reopens it. */
  window_closes: number;
  structure: string[]; structure_factor: number; cited_by: number[]; score: number;
}
export interface ProgressBoard { version: 2; computed_at: number; contributions: Contribution[]; authors: Array<{ account: number; login: string; score: number; contributions: number; new: number }> }

const clip = (s: string, max: number) => s.trim().replace(/\s+/g, " ").slice(0, max);

/** The label line in a text: `label: builds`, `label: collects`, or `label: new, unlike <X>, because <Y>`. The last one wins. */
export function parseLabel(body: string | undefined | null, max = 280): ParsedLabel | null {
  if (!body) return null;
  let out: ParsedLabel | null = null;
  for (const m of body.matchAll(/^[ \t]*label:[ \t]*(new|builds|collects)\b(.*)$/gim)) {
    const label = m[1]!.toLowerCase() as ProgressLabel;
    let unlike: string | null = null, because: string | null = null;
    if (label === "new") {
      const p = /^[\s,;:.–—-]*unlike\s+(.+?)[\s,;]*\bbecause\s+(.+?)\s*$/i.exec(m[2] ?? "");
      if (p && p[1]!.trim().length >= 2 && p[2]!.trim().length >= 2) { unlike = clip(p[1]!, max); because = clip(p[2]!, max); }
    }
    out = { label, unlike, because };
  }
  return out;
}

/** The challenge line in a text: `challenge: <the earlier or overlapping work, and why>`. The last one wins. */
export function parseChallenge(body: string | undefined | null, max = 280): string | null {
  if (!body) return null;
  let out: string | null = null;
  for (const m of body.matchAll(/^[ \t]*challenge:[ \t]*(.+?)[ \t]*$/gim)) if (m[1]!.trim().length >= 3) out = clip(m[1]!, max);
  return out;
}

/** Whether labels and challenges are accepted at `t`: within the window after the merge, or after any earlier challenge. */
export function windowOpen(mergedAt: number, challengeTimes: number[], windowDays: number, t: number): boolean {
  const w = windowDays * 86400;
  if (t >= mergedAt && t <= mergedAt + w) return true;
  return challengeTimes.some((c) => c <= t && t <= c + w);
}

/**
 * The board. `files` are the merged World files as the ledger recorded them (state.map_files), `events` the ledger,
 * `weights` each account's weight (mature plus maturing), `merged` the accounts with a merged contribution that was
 * not revoked, `owners` the owner accounts, whose labels and challenges never count (Article 1).
 */
export function progressBoard(files: Record<string, MapFile>, events: LedgerEvent[], weights: Map<number, bigint>, merged: Set<number>, owners: Set<number>, baseMicro: bigint, laws: Laws, now: number): ProgressBoard {
  const p = laws.progress;
  const revoked = new Set<number>();
  for (const e of events) {
    if (e.type === "takedown") for (const pr of (e["prs"] as number[]) ?? []) revoked.add(pr);
    if (e.type === "declare" && e["what"] === "refund") revoked.add(Number(e["pr"]));
  }
  const byPr = new Map<number, MapFile[]>();
  for (const f of Object.values(files)) { if (!f.pr || revoked.has(f.pr)) continue; if (!byPr.has(f.pr)) byPr.set(f.pr, []); byPr.get(f.pr)!.push(f); }
  const layerOf = new Map<number, string>();
  for (const e of events) if (e.type === "merge") layerOf.set(Number(e["pr"]), String(e["layer"] ?? "world"));
  const pathPr = new Map<string, number>();
  for (const [pr, fs] of byPr) for (const f of fs) pathPr.set(f.path, pr);
  // The latest label per account per pull request, and every challenge, as recorded.
  const labelsOf = new Map<number, Map<number, LedgerEvent>>();
  const challengeEvents = new Map<number, LedgerEvent[]>();
  for (const e of events) {
    const pr = Number(e["pr"]);
    if (e.type === "label" && (PROGRESS_LABELS as readonly string[]).includes(String(e["label"]))) { if (!labelsOf.has(pr)) labelsOf.set(pr, new Map()); labelsOf.get(pr)!.set(Number(e["account"]), e); }
    if (e.type === "challenge") { if (!challengeEvents.has(pr)) challengeEvents.set(pr, []); challengeEvents.get(pr)!.push(e); }
  }
  const floor = BigInt(Math.round(p.labeller_floor_base_fees * Number(baseMicro)));
  const capNum = BigInt(Math.round(laws.weight.per_account_cap_percent * 1000));
  const atOf = (e: LedgerEvent) => (e["submitted"] !== undefined && e["submitted"] !== null ? Number(e["submitted"]) : e.at);
  const ordered = [...byPr.entries()].sort((a, b) => a[1][0]!.merged_at - b[1][0]!.merged_at || a[0] - b[0]);
  const contributions: Contribution[] = [];
  for (const [pr, fs] of ordered) {
    const layer = layerOf.get(pr) ?? "world";
    if (!p.scored_layers.includes(layer as "world" | "laws")) continue;
    const first = fs[0]!, author = first.by, mergedAt = Math.min(...fs.map((f) => f.merged_at));
    const eligible = (acct: number) => acct !== author && !owners.has(acct) && merged.has(acct);
    const pointerFile = fs.find((f) => f.prior && f.adds);
    const authorPointer = pointerFile ? { prior: pointerFile.prior!, adds: pointerFile.adds! } : null;
    // Challenges: comments recorded in the ledger, and merged files that list this contribution under `challenges`.
    const challenges: ChallengeEntry[] = [];
    for (const e of challengeEvents.get(pr) ?? []) if (eligible(Number(e["account"]))) challenges.push({ account: Number(e["account"]), login: String(e["login"] ?? ""), text: String(e["text"] ?? ""), path: null, source: String(e["source"] ?? "comment"), at: atOf(e) });
    for (const [other, gs] of byPr) if (other !== pr) for (const g of gs) if ((g.challenges ?? []).some((c) => pathPr.get(c) === pr) && eligible(g.by)) challenges.push({ account: g.by, login: g.login, text: null, path: g.path, source: "file", at: g.merged_at });
    challenges.sort((a, b) => a.at - b.at || a.account - b.account);
    const window_closes = Math.max(mergedAt, ...challenges.map((c) => c.at)) + p.label_window_days_after_merge * 86400;
    // Labels, each counted as given unless a "new" lacks its pointer.
    const entries: LabelEntry[] = [];
    let newUnsupported = 0;
    for (const [acct, e] of labelsOf.get(pr) ?? []) {
      if (!eligible(acct)) continue;
      const label = String(e["label"]) as ProgressLabel;
      const unlike = typeof e["unlike"] === "string" ? (e["unlike"] as string) : null, because = typeof e["because"] === "string" ? (e["because"] as string) : null;
      let counted: ProgressLabel = label;
      if (label === "new" && p.new_requires_pointer && !(unlike && because) && !authorPointer) { counted = p.default_label; newUnsupported++; }
      entries.push({ account: acct, login: String(e["login"] ?? ""), label, counted_as: counted, unlike, because, at: atOf(e) });
    }
    entries.sort((a, b) => a.account - b.account);
    const labellers = entries.length, settled = labellers >= p.labellers_to_settle;
    const raw = entries.map((x) => { const w = weights.get(x.account) ?? 0n; return w > floor ? w : floor; });
    const total = raw.reduce((a, b) => a + b, 0n), cap = (total * capNum) / 100_000n;
    const weight: Record<ProgressLabel, bigint> = { new: 0n, builds: 0n, collects: 0n };
    entries.forEach((x, i) => { const w = settled && labellers > 1 && raw[i]! > cap ? cap : raw[i]!; weight[x.counted_as] += w; });
    let leading: ProgressLabel | null = null;
    if (labellers) {
      let best = -1n;
      for (const l of PROGRESS_LABELS) if (weight[l] > best) { best = weight[l]; leading = l; }
      if (PROGRESS_LABELS.filter((l) => weight[l] === best).length > 1) leading = p.default_label; // a tie is no judgment
    }
    const label: ProgressLabel = settled && leading ? leading : p.default_label;
    // Contested from the latest challenge until enough others have labelled after it.
    const last = challenges[challenges.length - 1];
    const assessors = last ? entries.filter((x) => x.account !== last.account && x.at > last.at).length : 0;
    const contested = !!last && assessors < p.assessors_to_clear_challenge;
    const structure = new Set<string>();
    const needed = new Set<string>();
    for (const [, gs] of ordered) for (const g of gs) if (g.merged_at < mergedAt) for (const n of g.map?.needs ?? []) needed.add(n);
    for (const f of fs) {
      if (f.explains) structure.add(f.explains.includes("--") ? "explains a link" : "writes a first entry");
      if (f.answers.length) structure.add("answers a question");
      if (f.map?.node && needed.has(f.map.node.id)) structure.add("fills an open spot");
      if (f.question && [...byPr.values()].some((gs) => gs.some((g) => g.pr !== pr && g.answers.includes(f.path)))) structure.add("asked a question that was answered");
    }
    // Citations by other accounts; a file that challenges a path does not cite it.
    const cited = new Set<number>();
    for (const [other, gs] of byPr) if (other !== pr) for (const g of gs) if (g.by !== author && merged.has(g.by) && (g.cites ?? []).some((c) => pathPr.get(c) === pr && !(g.challenges ?? []).includes(c))) cited.add(g.by);
    const structureFactor = structure.size ? p.structure_factor : 1;
    contributions.push({
      pr, account: author, login: first.login, merged_at: mergedAt, paths: fs.map((f) => f.path).sort(), layer,
      label, leading, state: labellers === 0 ? "unlabelled" : settled ? "settled" : "provisional", labelled: labellers > 0, labellers, settle_at: p.labellers_to_settle,
      new_unsupported: newUnsupported, author_pointer: authorPointer, contested,
      label_weight: { new: weight.new.toString(), builds: weight.builds.toString(), collects: weight.collects.toString() },
      labels: entries, challenges, window_closes,
      structure: [...structure], structure_factor: structureFactor, cited_by: [...cited].sort((a, b) => a - b),
      score: Math.round(p.label_factors[label] * structureFactor * (1 + cited.size) * 100) / 100,
    });
  }
  contributions.sort((a, b) => b.score - a.score || a.merged_at - b.merged_at || a.pr - b.pr);
  const authors = new Map<number, { account: number; login: string; score: number; contributions: number; new: number }>();
  for (const c of contributions) {
    const a = authors.get(c.account) ?? { account: c.account, login: c.login, score: 0, contributions: 0, new: 0 };
    a.score = Math.round((a.score + c.score) * 100) / 100; a.contributions++; if (c.label === "new") a.new++;
    authors.set(c.account, a);
  }
  return { version: 2, computed_at: now, contributions, authors: [...authors.values()].sort((a, b) => b.score - a.score || a.account - b.account) };
}
