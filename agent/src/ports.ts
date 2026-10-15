/**
 * Interfaces the runtime depends on. Real adapters talk to GitHub, Base and a
 * model; the mock adapters in adapters/mock.ts drive the simulation and tests.
 */
import type { ChangedFile } from "./paths.js";
import type { Review } from "./tally.js";

export interface PullInfo {
  number: number;
  title: string;
  body: string;
  headSha: string;
  baseSha: string;
  author: { id: number; login: string };
  state: "open" | "closed";
  draft: boolean;
  merged: boolean;
  createdAt: number;
}

/** `verified`: the platform verified the commit's signature as belonging to `authorId` (Law 1); an unverified author name is anyone's to write. */
/** signoffMatchesAuthor: whether a Signed-off-by email is the commit's author email; absent when unknown. */
export interface PullCommit { sha: string; signedOff: boolean; signoffMatchesAuthor?: boolean; authorId?: number; committerId?: number; verified?: boolean }

export interface IssueComment { id: number; account: number; login: string; body: string; createdAt: number }

export interface GitHubPort {
  listOpenPulls(): Promise<PullInfo[]>;
  getPull(n: number): Promise<PullInfo>;
  /** Changed files with modes, sizes and bytes changed. */
  listFiles(n: number): Promise<ChangedFile[]>;
  listCommits(n: number): Promise<PullCommit[]>;
  listReviews(n: number): Promise<Review[]>;
  /** All paths at a commit. */
  listPaths(ref: string): Promise<string[]>;
  /** Every file at a ref with its blob sha; conditional on main, so an unchanged tree costs no API budget. */
  listBlobs(ref: string): Promise<Array<{ path: string; sha: string }>>;
  /** UTF-8 content of a file at a commit. */
  readFile(ref: string, path: string): Promise<string>;
  comment(n: number, body: string): Promise<void>;
  /** Merge the recorded head commit. Returns the merge commit sha, or null if it cannot merge cleanly. */
  merge(n: number, headSha: string): Promise<string | null>;
  close(n: number): Promise<void>;
  /** Publish ledger files to the repository. */
  publishLedger(files: Array<{ path: string; content: string }>, message: string): Promise<void>;
  /** The commit a branch points at, or null when the branch does not exist. */
  branchHead?(branch: string): Promise<string | null>;
  /** A commit's first parent: for a merge, the main branch just before it. */
  firstParent?(sha: string): Promise<string>;
  /** Point a branch at a commit, creating it if needed. */
  setBranch?(branch: string, sha: string): Promise<void>;
  /** Comments on an issue, oldest first. */
  listIssueComments(issue: number): Promise<IssueComment[]>;
  /** Accounts watching the repository. */
  listWatchers(): Promise<Array<{ id: number; login: string }>>;
  /** How many accounts have starred the repository. */
  starCount(): Promise<number>;
  /** Post a discussion; returns its URL. Throws if discussions are unavailable. */
  postDiscussion(title: string, body: string): Promise<string>;
}

/** Delivers one signed event to a registered doorbell. */
export interface DoorbellPort {
  deliver(url: string, body: string): Promise<{ ok: boolean; status: number }>;
}

export interface DoorbellRecord { account: number; login: string; url: string; failures: number; retired: boolean; registeredAt: number; /** Issue comment that registered it; a new comment re-registers. */ comment?: number }

/** Private store for doorbell URLs and the delivery cursor. Never published. */
export interface DoorbellStore {
  load(): { doorbells: Record<string, DoorbellRecord>; lastDelivered: number };
  save(data: { doorbells: Record<string, DoorbellRecord>; lastDelivered: number }): void;
}

export interface ChainPort {
  /** Timestamp and block of a settled transaction. Null if not found. */
  transactionInfo(txHash: string): Promise<{ blockNumber: bigint; blockTime: number } | null>;
  /** Anchor a hash on the chain. Returns the transaction hash. */
  anchor(hashHex: string): Promise<string>;
}

export interface ScreenInput {
  pr: number;
  title: string;
  body: string;
  files: Array<{ path: string; content: string }>;
}

export type ScreenDecision = { decision: "pass" } | { decision: "hold"; reasonClass: string; note: string };

export interface ScreenPort {
  screen(input: ScreenInput): Promise<ScreenDecision>;
}

export interface PriceOracle {
  /** Canadian-dollar value of one USDC at the moment, as a decimal string. */
  usdcToCad(): Promise<string>;
}

export interface Clock { now(): number }

export interface PaymentNotice {
  pr: number;
  tx: string;
  payer: string;
  amountMicro: bigint;
  network: string;
  /** True when the agent accepted the payment for settlement while the quote was open (Law 5: then it is on time whatever its block timestamp). */
  acceptedWhileOpen?: boolean;
}
