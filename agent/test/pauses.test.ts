import { describe, expect, it } from "vitest";
import { extended, pausedAt, pausesOf, stoppedSecondsInYear } from "../src/pauses.js";
import { maintenanceProblems, pauseProblems, powerWarnings } from "../src/powers.js";
import type { LedgerEvent } from "../src/ledger.js";

const D = 86400, T = 1_800_000_000;
let id = 0;
const ev = (at: number, fields: Record<string, unknown>, type = "declare"): LedgerEvent => ({ id: ++id, at, type, ...fields } as unknown as LedgerEvent);

describe("pauses and outages push back contributor deadlines", () => {
  const events = [
    ev(T + 1 * D, { what: "pause", scope: "all", reason: "server breached" }),
    ev(T + 3 * D, { what: "resume", reason: "fixed" }),
    ev(T + 10 * D, { what: "outage", from: T + 10 * D, to: T + 11 * D, reason: "facilitator down" }),
  ];
  const p = pausesOf(events);

  it("extends a deadline by pauses that began after it was set and before it passed", () => {
    expect(extended(T + 5 * D, T, p, T + 20 * D)).toBe(T + 7 * D); // the two-day pause only; the outage starts after day 7
    expect(extended(T + 12 * D, T, p, T + 20 * D)).toBe(T + 15 * D); // both
    expect(extended(T + 12 * D, T + 2 * D, p, T + 20 * D)).toBe(T + 13 * D); // set during the pause: only the outage counts
    expect(extended(T + D / 2, T, p, T + 20 * D)).toBe(T + D / 2); // passed before any pause
  });

  it("moves a deadline with the clock while a pause is still running, and knows which function is stopped", () => {
    const running = pausesOf([ev(T + D, { what: "pause", scope: "payments", reason: "facilitator compromised" })]);
    expect(extended(T + 2 * D, T, running, T + 5 * D)).toBe(T + 6 * D);
    expect(pausedAt(running, "payments", T + 2 * D)).toBe(true);
    expect(pausedAt(running, "quotes", T + 2 * D)).toBe(false);
    expect(pausedAt(p, "quotes", T + 2 * D)).toBe(true); // a pause of everything stops every function
    expect(pausedAt(p, "quotes", T + 4 * D)).toBe(false);
  });

  it("counts paused and maintenance days in the last twelve months once each", () => {
    expect(stoppedSecondsInYear(p, [[T + 2 * D, T + 4 * D]], T + 20 * D)).toBe(4 * D); // days 1-4 merged, plus day 10-11
  });
});

describe("owner power checks", () => {
  it("refuses a pause without a ground or with an unknown scope, and a maintenance window over thirty days or in the past", () => {
    expect(pauseProblems("all", "a defect: the agent comments on every pull request in a loop")).toEqual([]);
    expect(pauseProblems("everything", "x")).toHaveLength(2);
    expect(maintenanceProblems(T + D, T + 31 * D, T)).toEqual([]);
    expect(maintenanceProblems(T + D, T + 32 * D, T)[0]).toMatch(/at most 30 days/);
    expect(maintenanceProblems(T - D, T + D, T)[0]).toMatch(/in advance/);
  });

  it("warns about a long pause, an overdue veto review, and a voted change due for deployment", () => {
    const events = [
      ev(T, { what: "pause", scope: "votes", reason: "defect in the tally" }),
      ev(T, { what: "veto", pr: 9, record: "unlawful: PIPEDA s.5; collects emails" }),
      ev(T, { pr: 12, layer: "laws" }, "merge"),
    ];
    const w = powerWarnings(events, T + 80 * D).join("\n");
    expect(w).toContain("votes paused for 80 of 30 days");
    expect(w).toMatch(/veto event \d+ \(pr 9\): review due in 10 days/);
    expect(w).toContain("pr 12 (Laws, merged");
  });
});
