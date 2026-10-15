/**
 * Owner powers recorded in the ledger (Constitution Articles 5, 6, 6A, 8, 11 and 14): what each record must say,
 * and the clocks the owner has to keep. Pure: the CLI records, the `pending` report warns, replay reads the same.
 */
import type { LedgerEvent } from "./ledger.js";
import { pausesOf, stoppedSecondsInYear, PAUSE_SCOPES } from "./pauses.js";

const DAY = 86400;
/** Recorded powers that carry only a written record. */
export const RECORDED_POWERS = ["security", "adapt", "refuse", "measure", "retire", "transfer", "sealed"] as const;
export const MAX_PAUSE_DAYS = 30, MAX_MAINTENANCE_DAYS = 30, MAX_STOPPED_DAYS_PER_YEAR = 90;
export const VETO_REVIEW_DAYS = 90, DEPLOY_NO_LATER_DAYS = 21, DEPLOY_NO_SOONER_DAYS = 14;
export const MEASURE_DAYS = 90, MEASURE_DAYS_IN_THREE_YEARS = 180;

/** Problems with a pause request; empty when it may be recorded. */
export function pauseProblems(scope: string, reason: string): string[] {
  const out: string[] = [];
  if (!(PAUSE_SCOPES as readonly string[]).includes(scope)) out.push(`scope must be one of ${PAUSE_SCOPES.join(", ")}`);
  if (reason.trim().length < 10) out.push("say why: the ground and, for a defect, what the agent is doing wrong (Article 8)");
  return out;
}

/** Problems with a maintenance window; Article 14 allows at most thirty days, declared in advance. */
export function maintenanceProblems(from: number, to: number, now: number): string[] {
  const out: string[] = [];
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) out.push("give a start and an end, the end after the start");
  if (from < now) out.push("a maintenance window is declared in advance (Article 14)");
  if (to - from > MAX_MAINTENANCE_DAYS * DAY) out.push(`a maintenance window lasts at most ${MAX_MAINTENANCE_DAYS} days (Article 14)`);
  return out;
}

/** The owner's clocks, as warnings for the `pending` report. */
export function powerWarnings(events: LedgerEvent[], now: number): string[] {
  const out: string[] = [];
  const days = (s: number) => Math.floor(s / DAY);
  for (const p of pausesOf(events)) {
    if (p.kind !== "pause" || p.to !== null) continue;
    const ran = now - p.from;
    out.push(`${p.scope === "all" ? "the agent" : `${p.scope}`} paused for ${days(ran)} of ${MAX_PAUSE_DAYS} days (${p.reason}); resume, or record a new pause with a new reason before day ${MAX_PAUSE_DAYS}`);
  }
  const windows = events.filter((e) => e.type === "declare" && e["what"] === "maintenance_window").map((e) => [Number(e["from"]), Number(e["to"])] as [number, number]);
  const stopped = stoppedSecondsInYear(pausesOf(events), windows, now);
  if (stopped >= 60 * DAY) out.push(`WARNING: paused or in maintenance ${days(stopped)} days in the last twelve months; more than ${MAX_STOPPED_DAYS_PER_YEAR} is a lapse under Article 14`);
  // Vetoes: every ninety days the owner records whether the ground remains.
  for (const v of events.filter((e) => e.type === "declare" && e["what"] === "veto")) {
    const reviews = events.filter((e) => e.type === "declare" && e["what"] === "veto_review" && Number(e["veto_event"]) === v.id);
    const last = reviews[reviews.length - 1];
    if (last && last["outcome"] === "lifted") continue;
    const since = last ? last.at : v.at, left = since + VETO_REVIEW_DAYS * DAY - now;
    if (left <= 14 * DAY) out.push(`veto event ${v.id} (pr ${v["pr"]}): review due in ${Math.max(0, days(left))} days; record veto-review ${v.id} remains|lifted "<why>"`);
  }
  // Voted changes to the served files deploy between fourteen and twenty-one days after merging, unless vetoed.
  for (const m of events.filter((e) => e.type === "merge" && e["layer"] === "laws")) {
    const deployed = events.some((e) => e.type === "deploy" && e.at >= m.at + DEPLOY_NO_SOONER_DAYS * DAY);
    const vetoed = events.some((e) => e.type === "declare" && e["what"] === "veto" && Number(e["pr"]) === Number(m["pr"]));
    if (deployed || vetoed) continue;
    const opens = m.at + DEPLOY_NO_SOONER_DAYS * DAY, closes = m.at + DEPLOY_NO_LATER_DAYS * DAY;
    if (now >= opens - 3 * DAY) out.push(`pr ${m["pr"]} (Laws, merged ${new Date(m.at * 1000).toISOString().slice(0, 10)}): deploy between ${new Date(opens * 1000).toISOString().slice(0, 10)} and ${new Date(closes * 1000).toISOString().slice(0, 10)}, or record a veto (Article 8)`);
  }
  // Article 6A: at most ninety days a measure, one hundred and eighty in any three years.
  const measures = events.filter((e) => e.type === "declare" && e["what"] === "power" && e["power"] === "measure");
  const used = measures.filter((e) => e.at > now - 3 * 365 * DAY).reduce((a, e) => a + Math.min(MEASURE_DAYS * DAY, Math.max(0, now - e.at)), 0);
  if (used > 120 * DAY) out.push(`WARNING: unforeseen-necessity measures have run ${days(used)} of ${MEASURE_DAYS_IN_THREE_YEARS} days allowed in three years (Article 6A)`);
  return out;
}
