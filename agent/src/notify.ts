/**
 * Law 12: who gets told what. Mentions on GitHub, deliveries to registered
 * doorbells, watcher detection, and the weekly digest. Pure functions where
 * possible so the simulation can check them.
 */
import { createHash } from "node:crypto";
import type { LedgerEvent } from "./ledger.js";
import type { State } from "./state.js";
import type { Laws } from "./laws.js";
import { buildIndex } from "./questions.js";

/** Accounts an event concerns, for doorbell delivery. */
export function targetsOf(e: LedgerEvent, state: State): number[] {
  const out = new Set<number>();
  const pr = e["pr"] !== undefined && e["pr"] !== null ? Number(e["pr"]) : null;
  // The submission's author: from its quote, or, for events before any quote (intake, holds, waiting), from the event itself.
  const author = pr !== null ? (state.pr_account[pr] ?? (e["account"] !== undefined && e["account"] !== null ? Number(e["account"]) : undefined)) : undefined;
  switch (e.type) {
    case "quote": case "quote_lapsed": case "payment": case "vote_close": case "merge": case "expiry": case "withdrawal":
    case "intake_reject": case "screen_hold": case "screen_deferred": case "hold_resolved": case "owner_confirm": case "owner_reject":
      if (author !== undefined) out.add(author);
      break;
    case "vote_open":
      if (author !== undefined) out.add(author);
      for (const q of (e["qualified"] as number[]) ?? []) out.add(q);
      break;
    case "notice":
      if (e["kind"] === "mention" && e["target"] !== undefined) out.add(Number(e["target"]));
      break;
    case "digest": case "laws_snapshot": case "declare":
      for (const [acct, c] of Object.entries(state.channels)) if (c.doorbell === "active") out.add(Number(acct));
      break;
    default: break;
  }
  return [...out].sort((a, b) => a - b);
}

/** Accounts to mention when a merge answers questions or cites entries. Capped, author excluded. */
export function mentionTargets(author: number, headers: Record<string, { answers?: string[]; cites?: string[]; challenges?: string[] }>, state: State, cap: number): Array<{ account: number; reason: string; about: string }> {
  const seen = new Set<number>();
  const out: Array<{ account: number; reason: string; about: string }> = [];
  const add = (account: number | undefined, reason: string, about: string) => {
    if (account === undefined || account === author || seen.has(account) || out.length >= cap) return;
    seen.add(account); out.push({ account, reason, about });
  };
  for (const h of Object.values(headers)) {
    for (const q of h.answers ?? []) add(state.questions[q]?.asked_by, "answered your question", q);
    // A challenge is named before a citation, so an author both cited and challenged learns of the challenge.
    for (const c of h.challenges ?? []) add(state.path_author[c], "challenges your contribution (Law 14); you may answer on its pull request", c);
    for (const c of h.cites ?? []) add(state.path_author[c], "built on your contribution", c);
  }
  return out;
}

export const DOORBELL_RE = /^\s*doorbell:\s*(off|https?:\/\/\S+)\s*$/im;

export function urlHash(url: string): string { return createHash("sha256").update(url).digest("hex").slice(0, 16); }

export interface DigestInput { events: LedgerEvent[]; state: State; now: number; laws: Laws; days: number; stars?: number }

export function buildDigest(i: DigestInput): { title: string; body: string; counts: Record<string, number> } {
  const since = i.now - i.days * 86400;
  const recent = i.events.filter((e) => e.at >= since);
  const merges = recent.filter((e) => e.type === "merge");
  const activeAccounts = new Set<number>();
  for (const e of recent) { if (e["account"] !== undefined) activeAccounts.add(Number(e["account"])); if (e.type === "review") activeAccounts.add(Number(e["account"])); }
  const idx = buildIndex(i.state.questions, i.now);
  const soon = i.state.open_votes.filter((v) => v.closes - i.now <= 48 * 3600);
  const board = Object.entries(i.state.weights).filter(([, w]) => w.mature_micro > 0n).sort((a, b) => (b[1].mature_micro > a[1].mature_micro ? 1 : -1)).slice(0, 10);
  const lines: string[] = [];
  const day = new Date(i.now * 1000).toISOString().slice(0, 10);
  lines.push(`Nomicon, week ending ${day}.`, "");
  lines.push(`Merged this week: ${merges.length}. Accounts active: ${activeAccounts.size}. Base fee: ${(Number(i.state.fee.base_micro) / 1e6).toFixed(2)} USDC.${i.stars !== undefined ? ` Stars: ${i.stars}.` : ""}`, "");
  if (merges.length) { lines.push("Merged:"); for (const m of merges) lines.push(`- #${m["pr"]} by ${m["login"]}: ${((m["paths"] as string[]) ?? []).join(", ")}`); lines.push(""); }
  if (soon.length) { lines.push("Votes closing within 48 hours:"); for (const v of soon) lines.push(`- #${v.pr}, closes ${new Date(v.closes * 1000).toISOString()}`); lines.push(""); }
  const newQ = idx.open.filter((q) => q.asked_at >= since);
  if (newQ.length) { lines.push("New questions:"); for (const q of newQ) lines.push(`- ${q.question} (${q.id}, asked by ${q.asked_login})`); lines.push(""); }
  const oldQ = idx.open.filter((q) => q.asked_at < since).slice(0, 10);
  if (oldQ.length) { lines.push("Still unanswered:"); for (const q of oldQ) lines.push(`- ${q.question} (${q.id}, ${Math.floor((i.now - q.asked_at) / 86400)} days)`); lines.push(""); }
  if (board.length) { lines.push("Leaderboard, mature weight:"); board.forEach(([acct, w], n) => lines.push(`${n + 1}. ${w.login || acct}: ${(Number(w.mature_micro) / 1e6).toFixed(2)}`)); lines.push(""); }
  lines.push("Nothing here is vetted. Only the process is guaranteed. Read before you act.");
  return { title: `Nomicon digest, week ending ${day}`, body: lines.join("\n"), counts: { merges: merges.length, open_votes: i.state.open_votes.length, open_questions: idx.open.length, active_accounts: activeAccounts.size, ...(i.stars !== undefined ? { stars: i.stars } : {}) } };
}
