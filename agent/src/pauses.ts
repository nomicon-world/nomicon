/**
 * Constitution Article 8 (pause) and LAWS.md Law 5 (recorded outages): while the agent, or one of its functions,
 * is paused or out, no deadline that runs against a contributor ends; each is pushed back by the time lost.
 * Pure: the running agent and the replay tool read deadlines through the same function.
 */
import type { LedgerEvent } from "./ledger.js";

/** What a pause stops. "all" stops the agent; the others stop one function. An outage counts as "all". */
export const PAUSE_SCOPES = ["all", "quotes", "payments", "votes", "merges"] as const;
export type PauseScope = (typeof PAUSE_SCOPES)[number];
export interface Pause { from: number; to: number | null; scope: PauseScope; reason: string; kind: "pause" | "outage" }

/** Pauses and recorded outages, in order. A pause runs from its event until the next resume; an outage names its own interval. */
export function pausesOf(events: Iterable<LedgerEvent>): Pause[] {
  const out: Pause[] = [];
  for (const e of events) {
    if (e.type !== "declare") continue;
    if (e["what"] === "pause") {
      const scope = (PAUSE_SCOPES as readonly string[]).includes(String(e["scope"])) ? (String(e["scope"]) as PauseScope) : "all";
      out.push({ from: e.at, to: null, scope, reason: String(e["reason"] ?? ""), kind: "pause" });
    } else if (e["what"] === "resume") {
      for (const p of out) if (p.kind === "pause" && p.to === null) p.to = Math.max(p.from, e.at);
    } else if (e["what"] === "outage") {
      const from = Number(e["from"]), to = Number(e["to"]);
      if (Number.isFinite(from) && Number.isFinite(to) && to > from) out.push({ from, to, scope: "all", reason: String(e["reason"] ?? ""), kind: "outage" });
    }
  }
  return out;
}

/** The paused intervals as of `now`, merged so that overlapping pauses count once. */
function intervals(pauses: Pause[], now: number): Array<[number, number]> {
  const raw = pauses.map((p) => [p.from, p.to ?? Math.max(now, p.from)] as [number, number]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of raw) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * A deadline set at `setAt`, pushed back by every paused interval that began after it was set and before it
 * (as already pushed back) would have passed. While a pause is still running, the deadline moves with `now`.
 */
export function extended(deadline: number, setAt: number, pauses: Pause[], now: number): number {
  let d = deadline;
  for (const [a, b] of intervals(pauses, now)) {
    if (a < setAt || a >= d) continue;
    d += b - a;
  }
  return d;
}

/** Whether `scope` is stopped at `now`: by a pause of that function or of the whole agent, or by an outage. */
export function pausedAt(pauses: Pause[], scope: PauseScope, now: number): boolean {
  return pauses.some((p) => (p.scope === "all" || p.scope === scope) && p.from <= now && (p.to === null || p.to > now));
}

/** Seconds paused, or covered by a maintenance window, in the twelve months before `now` (Article 14 counts more than ninety days as a lapse). */
export function stoppedSecondsInYear(pauses: Pause[], maintenance: Array<[number, number]>, now: number): number {
  const since = now - 365 * 86400;
  const all = [...intervals(pauses, now), ...maintenance.filter(([a, b]) => b > a)].map(([a, b]) => [Math.max(a, since), Math.min(b, now)] as [number, number]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0, end = -Infinity;
  for (const [a, b] of all) {
    if (b <= end) continue;
    total += b - Math.max(a, end);
    end = b;
  }
  return total;
}
