/**
 * Constitution Article 8: a voted change to the served files is deployed no sooner than fourteen days after it
 * merges. The site is served from the `live` branch, which the agent moves to main's head except while such a
 * change is younger than that; then it stops at the commit just before the earliest of them. Pages read the ledger
 * and the World from main directly, so only the served files wait.
 */
import type { LedgerEvent } from "./ledger.js";

export const LIVE_DELAY_DAYS = 14;

/** The files the owner runs or publishes as its own (Article 8). */
export function isServed(path: string): boolean {
  return path.startsWith("agent/") || path === "laws.json" || path.startsWith("site/") || path === "index.html";
}

/** The earliest voted change to the served files that is still too young to serve, or null when main may be served. */
export function heldBack(events: LedgerEvent[], now: number, delayDays = LIVE_DELAY_DAYS): LedgerEvent | null {
  let first: LedgerEvent | null = null;
  for (const e of events) {
    if (e.type !== "merge" || e["layer"] !== "laws" || e.at <= now - delayDays * 86400) continue;
    const paths = Array.isArray(e["paths"]) ? (e["paths"] as unknown[]).map(String) : [];
    if (!paths.some(isServed) || !e["merge_commit"]) continue;
    if (!first || e.at < first.at) first = e;
  }
  return first;
}
