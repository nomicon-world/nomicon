/**
 * Law 2, Law 3 and Law 11: counting a vote.
 */
import type { Laws, Procedure } from "./laws.js";
import { cappedWeight } from "./weight.js";
import type { Layer } from "./constitution.js";

export interface Review {
  reviewId: number;
  account: number;
  login: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  /** Platform timestamp, UTC seconds. */
  submittedAt: number;
  /** The review's text, where a Law 14 label may be given. */
  body?: string;
}

export interface TallyInput {
  layer: Layer;
  openedAt: number;
  closesAt: number;
  /** Qualified voter set recorded at open. */
  qualified: ReadonlySet<number>;
  authors: ReadonlySet<number>;
  reviews: Review[];
  /** Mature weight per account at close, uncapped. */
  matureAtClose: Map<number, bigint>;
  /** Count of accounts holding mature weight at open (Law 3 percent quorum). */
  weightedAccountsAtOpen: number;
}

export interface CountedVote { account: number; login: string; reviewId: number; yes: boolean; weightMicro: bigint }

export interface TallyResult {
  result: "merge" | "reject" | "expire";
  votes: CountedVote[];
  yesVoters: number;
  quorum: number;
  yesMicro: bigint;
  noMicro: bigint;
  /** Law 2: yes weight equalled no weight, so there was no decision. */
  tie: boolean;
  procedure: Procedure;
}

/** Law 2 step 2: the one review per eligible account that counts. */
export function countedReviews(input: TallyInput): Map<number, Review> {
  const latest = new Map<number, Review>();
  for (const r of input.reviews) {
    if (r.state !== "APPROVED" && r.state !== "CHANGES_REQUESTED") continue;
    if (r.submittedAt <= input.openedAt || r.submittedAt > input.closesAt) continue;
    if (!input.qualified.has(r.account) || input.authors.has(r.account)) continue;
    const prev = latest.get(r.account);
    if (!prev || r.submittedAt > prev.submittedAt || (r.submittedAt === prev.submittedAt && r.reviewId > prev.reviewId)) latest.set(r.account, r);
  }
  return latest;
}

/** Smallest integer r with r × r ≥ n, computed in integers so every replay agrees. */
export function ceilSqrt(n: number): number {
  if (n <= 0) return 0;
  let r = Math.floor(Math.sqrt(n));
  while (r * r < n) r++;
  while (r > 0 && (r - 1) * (r - 1) >= n) r--;
  return r;
}

export function quorumFor(layer: Layer, weightedAccounts: number, laws: Laws): { quorum: number; procedure: Procedure } {
  const procedure = layer === "laws" ? laws.vote.laws : laws.vote.world;
  const pct = Math.ceil((procedure.quorum_percent_of_weighted_accounts / 100) * weightedAccounts);
  const root = procedure.quorum_square_root ? ceilSqrt(weightedAccounts) : 0;
  return { quorum: Math.max(procedure.quorum_yes_voters, pct, root), procedure };
}

export function tally(input: TallyInput, laws: Laws): TallyResult {
  const { quorum, procedure } = quorumFor(input.layer, input.weightedAccountsAtOpen, laws);
  const counted = countedReviews(input);
  let totalMature = 0n;
  for (const w of input.matureAtClose.values()) totalMature += w;
  const votes: CountedVote[] = [];
  let yesMicro = 0n, noMicro = 0n, yesVoters = 0;
  for (const r of counted.values()) {
    const raw = input.matureAtClose.get(r.account) ?? 0n;
    const w = cappedWeight(raw, totalMature, laws);
    const yes = r.state === "APPROVED";
    votes.push({ account: r.account, login: r.login, reviewId: r.reviewId, yes, weightMicro: w });
    if (yes) { yesMicro += w; yesVoters++; } else noMicro += w;
  }
  votes.sort((a, b) => a.account - b.account);
  const base = { votes, yesVoters, quorum, yesMicro, noMicro, procedure };
  if (yesVoters < quorum) return { ...base, result: "expire", tie: false };
  // Law 2 step 5: equal weight is no decision. Law 3: at least two thirds of the counted weight passes.
  if (procedure.majority === "simple_weight" && yesMicro === noMicro) return { ...base, result: "expire", tie: true };
  const passes = yesMicro > noMicro && (procedure.majority !== "two_thirds_weight" || yesMicro * 3n >= (yesMicro + noMicro) * 2n);
  if (passes) return { ...base, result: "merge", tie: false };
  // Law 2 step 4: a rejection, which forfeits the fee, needs as many distinct no voters as a merge needs yes voters;
  // with fewer, one account's weight alone decides nothing and the contribution expires with the fee held.
  const noVoters = votes.filter((v) => !v.yes).length;
  return { ...base, result: noVoters >= laws.vote.reject_quorum_no_voters ? "reject" : "expire", tie: false };
}
