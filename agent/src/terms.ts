// Article 13: which commit of TERMS.md a quote cites.
//
// After bootstrap the owner may record a legally required change to TERMS.md as a
// `declare` event with `what: "terms_amendment"`, carrying the commit of the new text,
// the commit it replaces, the provision that requires it, and `effective_at`, thirty
// days after the record. A quote issued before that moment cites the earlier text.

import type { LedgerEvent } from "./ledger.js";

export const TERMS_AMENDMENT_NOTICE_DAYS = 30;

export function termsAmendments(events: readonly LedgerEvent[]): LedgerEvent[] {
  return events.filter((e) => e.type === "declare" && e["what"] === "terms_amendment");
}

/**
 * The commit a new quote cites. Until a first amendment is recorded (always so during bootstrap, when the owner edits
 * TERMS.md directly under Article 3) it is the newest commit that changed TERMS.md on main, so a quote never cites text
 * that has since been replaced; `fallback` serves only when that cannot be read.
 */
export async function termsCommitForQuote(events: readonly LedgerEvent[], at: number, latest: () => Promise<string | null>, fallback: string): Promise<string> {
  if (termsAmendments(events).length === 0) {
    try { const c = await latest(); if (c) return c; } catch { /* use the fallback */ }
  }
  return termsCommitAt(events, at, fallback);
}

/** The Terms the last quote cited: what was in force before a first amendment. */
export function lastQuotedTerms(events: readonly LedgerEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) if (events[i]!.type === "quote" && typeof events[i]!["terms_commit"] === "string") return events[i]!["terms_commit"] as string;
  return null;
}

/** The commit of TERMS.md in force at `at`, or `fallback` when no amendment was ever recorded. */
export function termsCommitAt(events: readonly LedgerEvent[], at: number, fallback: string): string {
  const all = termsAmendments(events);
  if (all.length === 0) return fallback;
  const inForce = all.filter((e) => Number(e["effective_at"]) <= at);
  if (inForce.length > 0) return String(inForce[inForce.length - 1]!["commit"]);
  return String(all[0]!["previous_commit"]);
}
