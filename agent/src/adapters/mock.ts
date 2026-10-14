/**
 * In-memory adapters for tests and for the Phase 3 simulation. They model
 * just enough of GitHub and the chain for the rules to be exercised.
 */
import type { ChainPort, Clock, DoorbellPort, DoorbellRecord, DoorbellStore, GitHubPort, IssueComment, PriceOracle, PullCommit, PullInfo, ScreenDecision, ScreenInput, ScreenPort } from "../ports.js";
import type { ChangedFile } from "../paths.js";
import type { Review } from "../tally.js";
import { createHash } from "node:crypto";

export class FakeClock implements Clock {
  constructor(public t: number) {}
  now(): number { return this.t; }
  advance(seconds: number): void { this.t += seconds; }
}

export interface FakePull extends PullInfo {
  mergeCommit?: string;
  files: ChangedFile[];
  contents: Record<string, string>;
  commits: PullCommit[];
  reviews: Review[];
  comments: string[];
}

export class FakeGitHub implements GitHubPort {
  pulls = new Map<number, FakePull>();
  /** Files at the base branch; merges add to it. */
  repoFiles: Record<string, string> = { "README.md": "# Nomicon", "LAWS.md": "# Laws", "world/README.md": "# World" };
  get basePaths(): string[] { return Object.keys(this.repoFiles); }
  published: Array<{ path: string; content: string }> = [];
  merges: Array<{ pr: number; head: string }> = [];
  issueComments: Record<number, IssueComment[]> = {};
  watchers: Array<{ id: number; login: string }> = [];
  discussions: Array<{ title: string; body: string }> = [];
  discussionsEnabled = true;
  private seq = 0;
  constructor(private clock: Clock) {}

  open(author: { id: number; login: string }, files: Record<string, string>, over: Partial<FakePull> = {}): FakePull {
    const n = ++this.seq;
    const head = createHash("sha1").update(`pr${n}:${JSON.stringify(files)}:${this.clock.now()}`).digest("hex");
    const changed: ChangedFile[] = Object.entries(files).map(([path, content]) => ({ path, status: this.repoFiles[path] !== undefined ? "modified" : "added", mode: "100644", bytesChanged: Buffer.byteLength(content), sizeAfter: Buffer.byteLength(content) }));
    const pull: FakePull = {
      number: n, title: `pr ${n}`, body: "", headSha: head, baseSha: "base", author, state: "open", draft: false, merged: false, createdAt: this.clock.now(),
      files: changed, contents: files, commits: [{ sha: head, signedOff: true, authorId: author.id, verified: true }], reviews: [], comments: [], ...over,
    };
    this.pulls.set(n, pull);
    return pull;
  }
  review(pr: number, account: number, state: Review["state"], at = this.clock.now()): void {
    const p = this.pulls.get(pr)!;
    p.reviews.push({ reviewId: pr * 1000 + p.reviews.length + 1, account, login: `u${account}`, state, submittedAt: at });
  }
  /** A collaborator dismisses an account's latest review on the platform; the ledger's record of it must still count (Law 2). */
  dismissReview(pr: number, account: number): void {
    const p = this.pulls.get(pr)!;
    const mine = p.reviews.filter((r) => r.account === account);
    if (mine.length) mine[mine.length - 1]!.state = "DISMISSED" as Review["state"];
  }
  push(pr: number): void { const p = this.pulls.get(pr)!; p.headSha = createHash("sha1").update(p.headSha + "push").digest("hex"); }

  /** Newest first, as GitHub lists them. */
  async listOpenPulls(): Promise<PullInfo[]> { return [...this.pulls.values()].filter((p) => p.state === "open").reverse(); }
  async getPull(n: number): Promise<PullInfo> { return this.pulls.get(n)!; }
  async listFiles(n: number): Promise<ChangedFile[]> { return this.pulls.get(n)!.files; }
  async listCommits(n: number): Promise<PullCommit[]> { return this.pulls.get(n)!.commits; }
  async listReviews(n: number): Promise<Review[]> { return this.pulls.get(n)!.reviews; }
  async listPaths(): Promise<string[]> { return this.basePaths; }
  async listBlobs(): Promise<Array<{ path: string; sha: string }>> {
    const h = (s: string) => { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x.toString(16); };
    return Object.entries(this.repoFiles).map(([path, c]) => ({ path, sha: h(c) }));
  }
  async readFile(ref: string, path: string): Promise<string> {
    for (const p of this.pulls.values()) if ((p.headSha === ref || p.mergeCommit === ref) && p.contents[path] !== undefined) return p.contents[path]!;
    if (this.repoFiles[path] !== undefined) return this.repoFiles[path]!;
    for (const p of this.pulls.values()) if (p.contents[path] !== undefined) return p.contents[path]!;
    return "";
  }
  /** Comments on a pull go to it; comments on any other number are issue comments by the agent (account 0). */
  async comment(n: number, body: string): Promise<void> {
    const p = this.pulls.get(n);
    if (p) { p.comments.push(body); return; }
    const list = (this.issueComments[n] ??= []);
    list.push({ id: n * 10000 + list.length + 1, account: 0, login: "nomicon-agent", body, createdAt: this.clock.now() });
  }
  /** Set to "before" or "after" to make the next merge call throw, before or after the merge was performed. */
  failNextMerge: "before" | "after" | null = null;
  async merge(n: number, headSha: string): Promise<string | null> {
    const p = this.pulls.get(n)!;
    if (p.merged) return p.headSha === headSha ? (p.mergeCommit ?? null) : null;
    if (p.headSha !== headSha || p.state !== "open") return null;
    for (const f of p.files) if (f.status === "added" && this.repoFiles[f.path] !== undefined) return null; // both added the path: a git conflict
    if (this.failNextMerge === "before") { this.failNextMerge = null; throw new Error("simulated network failure before the merge"); }
    p.state = "closed"; p.merged = true; this.merges.push({ pr: n, head: headSha });
    for (const [path, content] of Object.entries(p.contents)) this.repoFiles[path] = content;
    p.mergeCommit = createHash("sha1").update("merge" + headSha).digest("hex");
    if (this.failNextMerge === "after") { this.failNextMerge = null; throw new Error("simulated response loss after the merge"); }
    return p.mergeCommit;
  }
  async close(n: number): Promise<void> { this.pulls.get(n)!.state = "closed"; }
  async publishLedger(files: Array<{ path: string; content: string }>): Promise<void> { this.published = files; }
  async listIssueComments(issue: number): Promise<IssueComment[]> { return this.issueComments[issue] ?? []; }
  async listWatchers(): Promise<Array<{ id: number; login: string }>> { return this.watchers; }
  stars = 0;
  async starCount(): Promise<number> { return this.stars; }
  async postDiscussion(title: string, body: string): Promise<string> {
    if (!this.discussionsEnabled) throw new Error("discussions are not enabled");
    this.discussions.push({ title, body }); return `https://sim/discussions/${this.discussions.length}`;
  }
  /** Simulate an account posting on the doorbell issue. */
  commentOnIssue(issue: number, account: { id: number; login: string }, body: string): void {
    const list = (this.issueComments[issue] ??= []);
    list.push({ id: issue * 10000 + list.length + 1, account: account.id, login: account.login, body, createdAt: this.clock.now() });
  }
}

export class MemoryDoorbellStore implements DoorbellStore {
  data: { doorbells: Record<string, DoorbellRecord>; lastDelivered: number } = { doorbells: {}, lastDelivered: 0 };
  load() { return this.data; }
  save(d: { doorbells: Record<string, DoorbellRecord>; lastDelivered: number }) { this.data = d; }
}

export class FakeDoorbell implements DoorbellPort {
  deliveries: Array<{ url: string; body: string }> = [];
  failing = new Set<string>();
  async deliver(url: string, body: string): Promise<{ ok: boolean; status: number }> {
    if (this.failing.has(url)) return { ok: false, status: 500 };
    this.deliveries.push({ url, body }); return { ok: true, status: 200 };
  }
}

export class FakeChain implements ChainPort {
  anchors: string[] = [];
  constructor(private clock: Clock) {}
  async transactionInfo(txHash: string): Promise<{ blockNumber: bigint; blockTime: number } | null> {
    return { blockNumber: BigInt(parseInt(txHash.slice(2, 10), 16) || 1), blockTime: this.clock.now() };
  }
  async anchor(hashHex: string): Promise<string> { this.anchors.push(hashHex); return "0x" + createHash("sha256").update("anchor" + hashHex).digest("hex"); }
}

export class FakeScreen implements ScreenPort {
  calls = 0;
  constructor(private holdIf: (input: ScreenInput) => ScreenDecision | null = () => null) {}
  async screen(input: ScreenInput): Promise<ScreenDecision> { this.calls++; return this.holdIf(input) ?? { decision: "pass" }; }
}

export class FixedOracle implements PriceOracle { async usdcToCad(): Promise<string> { return "1.37"; } }
