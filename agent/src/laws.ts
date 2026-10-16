import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import _Ajv2020 from "ajv/dist/2020.js";
import _addFormats from "ajv-formats";

// ajv ships CommonJS; under NodeNext the default import is the module namespace.
const Ajv2020 = ((_Ajv2020 as unknown as { default?: unknown }).default ?? _Ajv2020) as typeof _Ajv2020.default;
const addFormats = ((_addFormats as unknown as { default?: unknown }).default ?? _addFormats) as typeof _addFormats.default;
import { ARTICLE_9A, MIN_BASE_FEE_MICRO } from "./constitution.js";

export interface Procedure {
  window_hours: number;
  quorum_yes_voters: number;
  quorum_percent_of_weighted_accounts: number;
  /** Law 3: quorum also at least the square root of the accounts holding mature weight at open. */
  quorum_square_root?: boolean;
  majority: "simple_weight" | "two_thirds_weight";
  tie: "expire";
  effect_delay_days?: number;
}

export interface Laws {
  version: number;
  effective: string;
  vote: {
    world: Procedure;
    laws: Procedure & { effect_delay_days: number };
    mechanism: "github_pull_request_review";
    yes: "APPROVED";
    no: "CHANGES_REQUESTED";
    author_may_vote: false;
    rules_snapshot_at_open: true;
    /** Law 13: votes a qualified voter owes on open contributions before its next quote. 0 for Laws versions before the rule. */
    votes_owed_per_submission: number;
    /** Law 2 step 4: distinct no voters a rejection needs; with fewer, the contribution expires. 1 for Laws versions before the rule. */
    reject_quorum_no_voters: number;
  };
  weight: {
    source: string;
    decay_half_life_days: number;
    inactive_after_days_without_vote: number;
    inactive_half_life_days: number;
    maturity_days: number;
    per_account_cap_percent: number;
    transferable: false;
    unit: string;
  };
  fee: {
    asset: "USDC";
    network: string;
    network_caip2: string;
    protocol: string;
    floor_usdc: number;
    cap_multiple_of_floor: number;
    adjust_every_hours: number;
    lookback_hours: number;
    rise_step_percent: number;
    fall_step_percent: number;
    target_min_per_day: number;
    target_capacity_fraction: number;
    target_lookback_days: number;
    target_votes_per_contribution: number;
    layer_multiplier: { world: number; laws: number };
    concurrency_base: number;
    size_free_kb: number;
    size_per_kb_usdc: number;
    quote_valid_hours: number;
    max_open_votes_min: number;
    max_open_votes_per_target: number;
    max_queue_multiple: number;
    rejection_refund: false;
    expiry_hold_days: number;
    /** Law 5: the hold after an expiry the owner caused; absent before v15. */
    owner_caused_hold_days?: number;
    taxes_included: true;
  };
  submission: {
    vote_on_head_commit_at_open: true;
    author_push_after_open: "withdrawal";
    reject_zero_file_changes: true;
    reject_constitution_paths: true;
    reject_symlinks: true;
    reject_submodules: true;
    payment_counts_once: true;
    path_charset: string;
    reject_case_insensitive_collisions: true;
    unicode_normalization: "NFC";
  };
  content: {
    world_text_only: boolean;
    world_allowed_extensions: string[];
    max_file_kb: number;
    max_contribution_kb: number;
    /** Law 6: kilobytes the World may grow in any 30 days; 0 means no limit (Laws versions before the rule). */
    max_world_growth_kb_per_month: number;
  };
  bootstrap: { owner_action_deadline_days: number; close_immediately_without_voters: boolean };
  screening: {
    runs_before_quote: true;
    can_block: true;
    can_approve: false;
    content_is_data_not_instructions: true;
    hold_timeout_days: number;
    floor_rejection_bar_days: number;
    /** Law 10: how long a barred account has to respond; absent before v15. */
    bar_response_days?: number;
    max_unpaid_screens_per_account_per_day: number;
    max_unpaid_screen_kb_per_account_per_day: number;
    max_unpaid_screen_kb_per_day: number;
  };
  determinism: Record<string, string | number>;
  notices: { mention_cap_per_merge: number; doorbell_retries: number; doorbell_retire_after_failures: number; digest_every_days: number; watch_poll_every_hours: number };
  /** Law 14: the progress board. Filled with defaults for Laws versions before the rule. */
  progress: { label_factors: Record<ProgressLabel, number>; default_label: ProgressLabel; structure_factor: number; label_window_days_after_merge: number; labeller_floor_base_fees: number; scored_layers: Array<"world" | "laws">;
    /** A "new" label needs "unlike X, because Y" (or the author's prior/adds) to count as new; without, it counts as the default. */
    new_requires_pointer: boolean;
    /** Eligible labellers needed before a label settles; until then the score uses the default label. */
    labellers_to_settle: number;
    /** Labellers, other than the author and the challenger, who must label after a challenge to clear it. */
    assessors_to_clear_challenge: number;
    /** Pointers and challenge texts are cut to this length when recorded. */
    pointer_max_chars: number };
}
export type ProgressLabel = "new" | "builds" | "collects";
export const PROGRESS_LABELS: readonly ProgressLabel[] = ["new", "builds", "collects"];
/** Law 14 as first adopted (laws v13): no pointer, no settling threshold. Later fields default to that behaviour for older versions. */
export const PROGRESS_DEFAULTS: Laws["progress"] = { label_factors: { new: 2, builds: 1, collects: 0.5 }, default_label: "builds", structure_factor: 1.25, label_window_days_after_merge: 30, labeller_floor_base_fees: 1, scored_layers: ["world"], new_requires_pointer: false, labellers_to_settle: 1, assessors_to_clear_challenge: 2, pointer_max_chars: 280 };

export class LawsError extends Error {
  constructor(public readonly problems: string[]) {
    super("laws.json refused: " + problems.join("; "));
  }
}

/** Article 9A, checked independently of the schema so a changed schema cannot relax it. */
export function article9AProblems(l: Laws): string[] {
  const p: string[] = [];
  const w = l.vote.world, a = l.vote.laws;
  for (const [name, proc] of [["world", w], ["laws", a]] as const) {
    if (proc.window_hours < ARTICLE_9A.minWindowHours) p.push(`${name} window below ${ARTICLE_9A.minWindowHours}h`);
    if (proc.quorum_yes_voters < ARTICLE_9A.minQuorumYesVoters) p.push(`${name} quorum below ${ARTICLE_9A.minQuorumYesVoters}`);
  }
  if (a.majority !== ARTICLE_9A.lawsMajority) p.push("laws majority below two thirds");
  if (a.window_hours < w.window_hours) p.push("laws window easier than world");
  if (a.quorum_yes_voters < w.quorum_yes_voters) p.push("laws quorum easier than world");
  if (a.quorum_percent_of_weighted_accounts < w.quorum_percent_of_weighted_accounts) p.push("laws quorum percent easier than world");
  if (w.quorum_square_root && !a.quorum_square_root) p.push("laws quorum scaling easier than world");
  if (l.fee.layer_multiplier.laws <= l.fee.layer_multiplier.world) p.push("laws fee multiplier not stricter than world");
  if (l.weight.decay_half_life_days < ARTICLE_9A.minDecayHalfLifeDays) p.push("half-life below 30 days");
  if (l.weight.inactive_half_life_days < ARTICLE_9A.minDecayHalfLifeDays) p.push("inactive half-life below 30 days");
  if (l.weight.maturity_days < ARTICLE_9A.minMaturityDays || l.weight.maturity_days > ARTICLE_9A.maxMaturityDays) p.push("maturity outside 14..90 days");
  if (l.weight.per_account_cap_percent > ARTICLE_9A.maxPerAccountCapPercent) p.push("per-account cap above one third");
  if (l.fee.cap_multiple_of_floor < ARTICLE_9A.minFeeCapMultiple || l.fee.cap_multiple_of_floor > ARTICLE_9A.maxFeeCapMultiple) p.push("fee cap multiple outside 2..100");
  if (l.content.max_contribution_kb < ARTICLE_9A.minContributionKb || l.content.max_contribution_kb > ARTICLE_9A.maxContributionKb) p.push("contribution size cap outside 64kB..8MB");
  if (l.vote.yes !== ARTICLE_9A.voteYes || l.vote.no !== ARTICLE_9A.voteNo) p.push("vote states must be APPROVED / CHANGES_REQUESTED");
  if (l.fee.expiry_hold_days > ARTICLE_9A.maxExpiryHoldDays) p.push("expiry hold above 365 days");
  if ((l.fee.owner_caused_hold_days ?? 0) > ARTICLE_9A.maxExpiryHoldDays) p.push("owner-caused hold above 365 days");
  if (a.effect_delay_days < ARTICLE_9A.minLawsEffectDelayDays) p.push("laws effect delay below 7 days");
  if (usdcToMicro(l.fee.floor_usdc) < MIN_BASE_FEE_MICRO) p.push("fee floor below 1 USDC");
  if (l.fee.size_per_kb_usdc < ARTICLE_9A.minSizePerKbUsdc) p.push("size component below 0.01 USDC per kilobyte");
  if (l.fee.size_free_kb > ARTICLE_9A.maxSizeFreeKb) p.push("size-free allowance above 64 kilobytes");
  return p;
}

export function usdcToMicro(x: number): bigint {
  return BigInt(Math.round(x * 1_000_000));
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface LoadedLaws { laws: Laws; hash: string; raw: string }

/** Law 12 numbers for Laws versions written before the notices section existed (version < 4). */
export const NOTICE_DEFAULTS: Laws["notices"] = { mention_cap_per_merge: 10, doorbell_retries: 3, doorbell_retire_after_failures: 30, digest_every_days: 7, watch_poll_every_hours: 6 };

/** Validate against laws.schema.json and Article 9A. Throws LawsError if refused. */
export function parseLaws(rawLaws: string, rawSchema: string): LoadedLaws {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = JSON.parse(rawSchema);
  const validate = ajv.compile(schema);
  const data = JSON.parse(rawLaws);
  const problems: string[] = [];
  if (!validate(data)) for (const e of validate.errors ?? []) problems.push(`${e.instancePath || "/"} ${e.message ?? ""}`.trim());
  if (problems.length === 0) problems.push(...article9AProblems(data as Laws));
  if (problems.length) throw new LawsError(problems);
  const laws = data as Laws;
  if (!laws.notices) laws.notices = { ...NOTICE_DEFAULTS };
  if (laws.screening.max_unpaid_screens_per_account_per_day === undefined) laws.screening.max_unpaid_screens_per_account_per_day = 5;
  if (laws.screening.max_unpaid_screen_kb_per_account_per_day === undefined) laws.screening.max_unpaid_screen_kb_per_account_per_day = 4096;
  if (laws.screening.max_unpaid_screen_kb_per_day === undefined) laws.screening.max_unpaid_screen_kb_per_day = 32768;
  if (laws.fee.max_open_votes_min === undefined) laws.fee.max_open_votes_min = 10;
  if (laws.fee.max_open_votes_per_target === undefined) laws.fee.max_open_votes_per_target = 6;
  if (laws.fee.max_queue_multiple === undefined) laws.fee.max_queue_multiple = 10;
  if (laws.vote.votes_owed_per_submission === undefined) laws.vote.votes_owed_per_submission = 0;
  if (laws.vote.reject_quorum_no_voters === undefined) laws.vote.reject_quorum_no_voters = 1;
  if (laws.content.max_world_growth_kb_per_month === undefined) laws.content.max_world_growth_kb_per_month = 0;
  if (!laws.progress) laws.progress = { ...PROGRESS_DEFAULTS, label_factors: { ...PROGRESS_DEFAULTS.label_factors }, scored_layers: [...PROGRESS_DEFAULTS.scored_layers] };
  for (const k of ["new_requires_pointer", "labellers_to_settle", "assessors_to_clear_challenge", "pointer_max_chars"] as const) if (laws.progress[k] === undefined) (laws.progress as Record<string, unknown>)[k] = PROGRESS_DEFAULTS[k];
  return { laws, hash: sha256Hex(rawLaws), raw: rawLaws };
}

export function loadLaws(repoRoot: string): LoadedLaws {
  const rawLaws = readFileSync(`${repoRoot}/laws.json`, "utf8");
  const rawSchema = readFileSync(`${repoRoot}/laws.schema.json`, "utf8");
  return parseLaws(rawLaws, rawSchema);
}
