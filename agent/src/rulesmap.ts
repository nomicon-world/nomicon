/**
 * The rules and the machine on the World map: one point per Law and per Constitution article, read from
 * LAWS.md and CONSTITUTION.md as they stand on main, and one point per part of the enforcement machinery.
 * They are places to ask about and, for the Laws and the machine, to propose changes to; never content.
 */
const REPO = "https://github.com/nomicon-world/nomicon";

export interface RulePoint { id: string; label: string; href: string }
export interface MachinePoint { id: string; label: string; files: string[] }
export interface RulesSource { laws: RulePoint[]; articles: RulePoint[] }

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens. */
export function anchor(heading: string): string {
  return heading.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/ /g, "-");
}

/** Each "## Law N. Title" and "## Article N. Title" heading, in order. */
export function rulesFrom(lawsMd: string, constitutionMd: string): RulesSource {
  const laws = [...lawsMd.matchAll(/^## (Law (\d+)\. (.+?))\s*$/gm)].map((m) => ({ id: `law-${m[2]}`, label: `Law ${m[2]}. ${m[3]}`, href: `${REPO}/blob/main/LAWS.md#${anchor(m[1]!)}` }));
  const articles = [...constitutionMd.matchAll(/^## (Article (\d+[A-Z]?)\. (.+?))\s*$/gm)].map((m) => ({ id: `article-${m[2]!.toLowerCase()}`, label: `Article ${m[2]}. ${m[3]}`, href: `${REPO}/blob/main/CONSTITUTION.md#${anchor(m[1]!)}` }));
  return { laws, articles };
}

/** The parts of the machine, each with the files that make it. They change by the Laws procedure. */
export const MACHINE: MachinePoint[] = [
  { id: "machine-payments", label: "Payments", files: ["agent/src/pay.ts", "agent/src/payer.ts", "site/pay.html", "site/x402pay.js"] },
  { id: "machine-screening", label: "Intake and screening", files: ["agent/src/intake.ts", "agent/src/screen.ts", "agent/src/paths.ts", "agent/src/headercheck.ts"] },
  { id: "machine-votes", label: "Votes and weight", files: ["agent/src/tally.ts", "agent/src/weight.ts", "agent/src/phases.ts"] },
  { id: "machine-agent", label: "The agent's daily round", files: ["agent/src/runtime.ts", "agent/src/notify.ts", "agent/src/pauses.ts"] },
  { id: "machine-ledger", label: "The ledger and replay", files: ["agent/src/ledger.ts", "agent/src/state.ts", "agent/src/replay.ts"] },
  { id: "machine-map", label: "The map and the jobs", files: ["agent/src/worldmap.ts", "agent/src/jobs.ts", "paths.json", "site/map.html", "site/jobs.js"] },
  { id: "machine-briefing", label: "The briefing", files: ["SKILL.md", "README.md", "CONTRIBUTING.md"] },
  { id: "machine-site", label: "The website", files: ["index.html", "site/ways.html", "site/leaderboard.html"] },
];
export const machineHref = (file: string): string => `${REPO}/blob/main/${file}`;
