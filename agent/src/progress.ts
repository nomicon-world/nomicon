/**
 * Law 14: the progress board. What the commons judged each merged World contribution to be (a label given in a
 * review or a comment, a "new" one with its pointer), what it did to the frontier (structure), who built on it
 * (citations), and whether its label is provisional, settled or contested. Visibility only: it mints no weight
 * and moves no money. Pure, from the ledger alone, so the agent and replay compute the same board.
 */
import type { LedgerEvent } from "./ledger.js";
import type { Laws, ProgressLabel } from "./laws.js";
import { PROGRESS_LABELS } from "./laws.js";

export interface ParsedLabel { label: ProgressLabel; unlike: string | null; because: string | null }
export interface LabelEntry { account: number; login: string; label: ProgressLabel; counted_as: ProgressLabel; unlike: string | null; because: string | null; at: number }
export interface ChallengeEntry { account: number; login: string; text: string | null; path: string | null; source: string; at: number }
export interface Contribution {
  pr: number; account: number; login: string; merged_at: number; paths: string[]; layer: string;
  /** Paths it changed that an earlier merged contribution wrote: an edit, which takes nothing from the earlier one. */
  edits: string[];
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

/** A file's header as its merge recorded it (`headers` in the merge event). */
interface MergedHeader { question?: string; answers?: string[]; cites?: string[]; challenges?: string[]; explains?: string; prior?: string; adds?: string; map?: { node?: { id?: string }; needs?: string[]; edges?: Array<{ from?: string; to: string; type: string }> } }

/**
 * The board, from the ledger alone: `events` the ledger, `weights` each account's weight (mature plus maturing),
 * `merged` the accounts with a merged contribution that was not revoked, `owners` the owner accounts, whose labels
 * and challenges never count (Article 1).
 *
 * A contribution is judged as it merged: its paths, and the headers its merge recorded. A later edit to one of its
 * files is a contribution of its own and takes nothing from it. Structure counts only what a merge added to the map,
 * and a citation or a challenge of a path names every contribution that wrote the path before the citing file merged.
 * Structure counts only real targets: an answer to a question someone asked, and an entry for a point or a link
 * that exists, either declared by an earlier merge or, when `onMap` is given, on the World map (the starter map, the rules).
 */
export function progressBoard(events: LedgerEvent[], weights: Map<number, bigint>, merged: Set<number>, owners: Set<number>, baseMicro: bigint, laws: Laws, now: number, onMap?: (target: string) => boolean): ProgressBoard {
  const p = laws.progress;
  const revoked = new Set<number>();
  for (const e of events) {
    if (e.type === "takedown") for (const pr of (e["prs"] as number[]) ?? []) revoked.add(pr);
    if (e.type === "declare" && e["what"] === "refund") revoked.add(Number(e["pr"]));
  }
  // The merges that stand, in ledger order, and each account's latest login.
  const logins = new Map<number, string>();
  const merges: Array<{ pr: number; account: number; at: number; layer: string; paths: string[]; headers: Record<string, MergedHeader> }> = [];
  const seen = new Set<number>();
  for (const e of events) {
    if (typeof e["login"] === "string" && e["account"] !== undefined) logins.set(Number(e["account"]), e["login"]);
    const pr = Number(e["pr"]);
    if (e.type !== "merge" || revoked.has(pr) || seen.has(pr)) continue;
    seen.add(pr);
    merges.push({ pr, account: Number(e["account"]), at: e.at, layer: String(e["layer"] ?? "world"), paths: [...((e["paths"] as string[] | undefined) ?? [])].sort(), headers: (e["headers"] as Record<string, MergedHeader> | undefined) ?? {} });
  }
  // Walk the merges in order: what each added to the map, and which earlier contributions its files cite or challenge.
  const writers = new Map<string, number[]>();                    // path -> the merges that wrote it so far
  const lastHeader = new Map<string, MergedHeader | undefined>();  // path -> its header at the latest write
  const explained = new Set<string>(), defined = new Set<string>(), needed = new Set<string>(), linked = new Set<string>();
  // Files the owner committed directly (Article 3) are on main without a header in the ledger; an answer to one counts.
  const direct = new Set<string>();
  for (const e of events) if (e.type === "world_direct") for (const f of (e["files"] as Array<{ path: string }> | undefined) ?? []) direct.add(f.path);
  const real = (t: string) => (t.includes("--") ? linked.has(t) : defined.has(t)) || (onMap ? onMap(t) : true);
  const asker = new Map<string, number>();                         // question path -> the merge that asked it
  const structure = new Map<number, Set<string>>(), edits = new Map<number, string[]>();
  const citedBy = new Map<number, Set<number>>(), fileChallenges = new Map<number, ChallengeEntry[]>();
  for (const m of merges) {
    const s = new Set<string>(), changed: string[] = [];
    structure.set(m.pr, s); edits.set(m.pr, changed);
    const wrote = (paths: string[] | undefined) => new Set((paths ?? []).flatMap((x) => writers.get(x) ?? []));
    const askedHere = new Set(m.paths.filter((x) => m.headers[x]?.question));
    const isQuestion = (q: string) => asker.has(q) || askedHere.has(q) || direct.has(q);
    for (const path of m.paths) {
      if (writers.has(path)) changed.push(path);
      const h = m.headers[path], before = lastHeader.get(path);
      if (!h) continue;
      if (h.explains && !explained.has(h.explains) && real(h.explains)) s.add(h.explains.includes("--") ? "explains a link" : "writes a first entry");
      if ((h.answers ?? []).some((q) => q !== path && isQuestion(q) && !(before?.answers ?? []).includes(q))) s.add("answers a question");
      const node = h.map?.node?.id;
      if (node && needed.has(node) && !defined.has(node)) s.add("fills an open spot");
      if (h.question && !before?.question && !asker.has(path)) asker.set(path, m.pr);
      for (const q of h.answers ?? []) { const a = asker.get(q); if (a !== undefined && a !== m.pr) structure.get(a)!.add("asked a question that was answered"); }
      // A file that lists a path under `challenges` does not cite the contributions that wrote it.
      const challenged = wrote(h.challenges);
      for (const w of wrote(h.cites)) if (!challenged.has(w)) { if (!citedBy.has(w)) citedBy.set(w, new Set()); citedBy.get(w)!.add(m.account); }
      for (const w of challenged) {
        if (!fileChallenges.has(w)) fileChallenges.set(w, []);
        fileChallenges.get(w)!.push({ account: m.account, login: logins.get(m.account) ?? "", text: null, path, source: "file", at: m.at });
      }
    }
    for (const path of m.paths) {
      const h = m.headers[path];
      if (h?.explains) explained.add(h.explains);
      if (h?.map?.node?.id) defined.add(h.map.node.id);
      const own = h?.map?.node?.id;
      for (const e of h?.map?.edges ?? []) { const from = e.from ?? own; if (from) linked.add(`${from}--${e.type}--${e.to}`); }
      for (const n of h?.map?.needs ?? []) needed.add(n);
      writers.set(path, [...(writers.get(path) ?? []), m.pr]);
      lastHeader.set(path, h);
    }
  }
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
  const contributions: Contribution[] = [];
  for (const m of merges) {
    if (!p.scored_layers.includes(m.layer as "world" | "laws")) continue;
    const pr = m.pr, author = m.account, mergedAt = m.at;
    const eligible = (acct: number) => acct !== author && !owners.has(acct) && merged.has(acct);
    const pointer = m.paths.map((x) => m.headers[x]).find((h) => h?.prior && h?.adds);
    const authorPointer = pointer ? { prior: pointer.prior!, adds: pointer.adds! } : null;
    // Challenges: comments recorded in the ledger, and merged files that list one of its paths under `challenges`.
    const challenges: ChallengeEntry[] = [];
    for (const e of challengeEvents.get(pr) ?? []) if (eligible(Number(e["account"]))) challenges.push({ account: Number(e["account"]), login: String(e["login"] ?? ""), text: String(e["text"] ?? ""), path: null, source: String(e["source"] ?? "comment"), at: atOf(e) });
    for (const x of fileChallenges.get(pr) ?? []) if (eligible(x.account)) challenges.push(x);
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
    const s = structure.get(pr)!;
    const cited = [...(citedBy.get(pr) ?? [])].filter((a) => a !== author && merged.has(a)).sort((a, b) => a - b);
    const structureFactor = s.size ? p.structure_factor : 1;
    contributions.push({
      pr, account: author, login: logins.get(author) ?? "", merged_at: mergedAt, paths: m.paths, layer: m.layer, edits: edits.get(pr)!,
      label, leading, state: labellers === 0 ? "unlabelled" : settled ? "settled" : "provisional", labelled: labellers > 0, labellers, settle_at: p.labellers_to_settle,
      new_unsupported: newUnsupported, author_pointer: authorPointer, contested,
      label_weight: { new: weight.new.toString(), builds: weight.builds.toString(), collects: weight.collects.toString() },
      labels: entries, challenges, window_closes,
      structure: [...s], structure_factor: structureFactor, cited_by: cited,
      score: Math.round(p.label_factors[label] * structureFactor * (1 + cited.length) * 100) / 100,
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
