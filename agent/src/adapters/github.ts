import { Octokit } from "@octokit/rest";
import type { DoorbellPort, DoorbellRecord, DoorbellStore, GitHubPort, IssueComment, PullCommit, PullInfo } from "../ports.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { doorbellUrlProblem, isPrivateAddress } from "../limits.js";
import type { ChangedFile } from "../paths.js";
import type { Review } from "../tally.js";

const SIGNOFF = /^Signed-off-by: .+ <.+@.+>$/m;

/** Bytes of added lines per file, from a unified diff. */
export function bytesChangedByFile(diff: string): Map<string, number> {
  const out = new Map<string, number>();
  let current: string | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      current = m ? m[2]! : null;
      if (current && !out.has(current)) out.set(current, 0);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) out.set(current, (out.get(current) ?? 0) + Buffer.byteLength(line.slice(1), "utf8") + 1);
  }
  return out;
}

export class GitHubAdapter implements GitHubPort {
  private octokit: Octokit;
  /** ETag and last body per conditional request, so an unchanged answer costs no API budget (GitHub does not count 304s). */
  private cache = new Map<string, { etag: string; data: unknown }>();
  /** Requests left in the current hour, from the last response seen; null until one has been. */
  rateLimitRemaining: number | null = null;
  /** `auth` is a personal token, or an Octokit already authenticated (see adapters/auth.ts for App auth). */
  constructor(private owner: string, private repo: string, auth: string | Octokit, private ledgerBranch = "main") {
    this.octokit = typeof auth === "string" ? new Octokit({ auth }) : auth;
  }

  /**
   * One page, conditionally: send the ETag of the last answer and reuse that answer on 304.
   * Returns the data and whether it came from the cache.
   */
  private async conditional<T>(key: string, request: (headers: Record<string, string>) => Promise<{ data: T; headers: Record<string, string | number | undefined> }>): Promise<{ data: T; cached: boolean }> {
    const prev = this.cache.get(key);
    const headers: Record<string, string> = prev ? { "if-none-match": prev.etag } : {};
    try {
      const res = await request(headers);
      const remaining = res.headers["x-ratelimit-remaining"];
      if (remaining !== undefined) this.rateLimitRemaining = Number(remaining);
      const etag = res.headers["etag"];
      if (typeof etag === "string") this.cache.set(key, { etag, data: res.data });
      return { data: res.data, cached: false };
    } catch (e) {
      if ((e as { status?: number }).status === 304 && prev) return { data: prev.data as T, cached: true };
      throw e;
    }
  }

  private toInfo(p: { number: number; title: string; body: string | null; head: { sha: string }; base: { sha: string }; user: { id: number; login: string } | null; state: string; draft?: boolean; merged?: boolean | null; created_at: string }): PullInfo {
    return {
      number: p.number, title: p.title, body: p.body ?? "", headSha: p.head.sha, baseSha: p.base.sha,
      author: { id: p.user?.id ?? 0, login: p.user?.login ?? "" },
      state: p.state === "open" ? "open" : "closed", draft: !!p.draft, merged: !!p.merged,
      createdAt: Math.floor(Date.parse(p.created_at) / 1000),
    };
  }

  /** Open pull requests, most recently updated first. The first page is conditional: any change to any open pull request moves it there. */
  async listOpenPulls(): Promise<PullInfo[]> {
    const base = { owner: this.owner, repo: this.repo, state: "open" as const, sort: "updated" as const, direction: "desc" as const, per_page: 100 };
    const first = await this.conditional("pulls", (headers) => this.octokit.pulls.list({ ...base, page: 1, headers }));
    if (first.cached) return (first.data as Parameters<GitHubAdapter["toInfo"]>[0][]).map((p) => this.toInfo(p));
    let all = first.data as Parameters<GitHubAdapter["toInfo"]>[0][];
    if (all.length === 100) {
      const rest = await this.octokit.paginate(this.octokit.pulls.list, { ...base, page: 2 });
      all = all.concat(rest);
      const c = this.cache.get("pulls"); if (c) this.cache.set("pulls", { etag: c.etag, data: all });
    }
    return all.map((p) => this.toInfo(p));
  }

  async getPull(n: number): Promise<PullInfo> {
    const { data } = await this.octokit.pulls.get({ owner: this.owner, repo: this.repo, pull_number: n });
    return this.toInfo(data);
  }

  async listFiles(n: number): Promise<ChangedFile[]> {
    const files = await this.octokit.paginate(this.octokit.pulls.listFiles, { owner: this.owner, repo: this.repo, pull_number: n, per_page: 100 });
    const pr = await this.octokit.pulls.get({ owner: this.owner, repo: this.repo, pull_number: n });
    const tree = await this.octokit.git.getTree({ owner: this.owner, repo: this.repo, tree_sha: pr.data.head.sha, recursive: "1" });
    const modes = new Map<string, { mode: string; size: number }>();
    for (const t of tree.data.tree) if (t.path) modes.set(t.path, { mode: t.mode ?? "100644", size: t.size ?? 0 });
    // GitHub will not render a diff above its size limits (406/422); a 1 MB text file Law 6 allows can exceed them.
    // Then every added or changed file is charged at its full size, the conservative reading of Law 5.
    let bytes: Map<string, number> | null = null;
    try {
      const diffResp = await this.octokit.pulls.get({ owner: this.owner, repo: this.repo, pull_number: n, mediaType: { format: "diff" } });
      bytes = bytesChangedByFile(diffResp.data as unknown as string);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status !== 406 && status !== 422) throw e;
    }
    return files.map((f) => {
      const m = modes.get(f.filename);
      const entry: ChangedFile = {
        path: f.filename,
        status: f.status as ChangedFile["status"],
        bytesChanged: bytes ? (bytes.get(f.filename) ?? 0) : (f.status === "removed" ? 0 : (m?.size ?? 0)),
        sizeAfter: f.status === "removed" ? 0 : (m?.size ?? 0),
      };
      if (m?.mode) entry.mode = m.mode;
      if (f.previous_filename) entry.previousPath = f.previous_filename;
      return entry;
    });
  }

  async listCommits(n: number): Promise<PullCommit[]> {
    const commits = await this.octokit.paginate(this.octokit.pulls.listCommits, { owner: this.owner, repo: this.repo, pull_number: n, per_page: 100 });
    return commits.map((c) => {
      const out: PullCommit = { sha: c.sha, signedOff: SIGNOFF.test(c.commit.message), verified: c.commit.verification?.verified === true };
      if (c.author?.id) out.authorId = c.author.id;
      if (c.committer?.id) out.committerId = c.committer.id;
      return out;
    });
  }

  async listReviews(n: number): Promise<Review[]> {
    const base = { owner: this.owner, repo: this.repo, pull_number: n, per_page: 100 };
    const first = await this.conditional(`reviews:${n}`, (headers) => this.octokit.pulls.listReviews({ ...base, page: 1, headers }));
    type R = Awaited<ReturnType<Octokit["pulls"]["listReviews"]>>["data"];
    let reviews = first.data as R;
    // A full first page may hide later pages behind an unchanged ETag (reviews are listed oldest first), so page on regardless.
    if (reviews.length === 100) reviews = reviews.concat(await this.octokit.paginate(this.octokit.pulls.listReviews, { ...base, page: 2 }));
    return reviews.map((r) => ({
      reviewId: r.id, account: r.user?.id ?? 0, login: r.user?.login ?? "",
      state: r.state as Review["state"],
      submittedAt: r.submitted_at ? Math.floor(Date.parse(r.submitted_at) / 1000) : 0,
    }));
  }

  async listPaths(ref: string): Promise<string[]> {
    const tree = await this.octokit.git.getTree({ owner: this.owner, repo: this.repo, tree_sha: ref, recursive: "1" });
    return tree.data.tree.filter((t) => t.type === "blob" && t.path).map((t) => t.path!);
  }

  async listBlobs(ref: string): Promise<Array<{ path: string; sha: string }>> {
    const { data } = await this.conditional(`tree:${ref}`, (headers) => this.octokit.git.getTree({ owner: this.owner, repo: this.repo, tree_sha: ref, recursive: "1", headers }) as never);
    const tree = (data as { tree: Array<{ type?: string; path?: string; sha?: string }> }).tree;
    return tree.filter((t) => t.type === "blob" && t.path && t.sha).map((t) => ({ path: t.path!, sha: t.sha! }));
  }

  async readFile(ref: string, path: string): Promise<string> {
    const { data } = await this.octokit.repos.getContent({ owner: this.owner, repo: this.repo, path, ref });
    if (Array.isArray(data) || data.type !== "file") throw new Error(`${path} is not a file`);
    return Buffer.from(data.content, "base64").toString("utf8");
  }

  async comment(n: number, body: string): Promise<void> {
    await this.octokit.issues.createComment({ owner: this.owner, repo: this.repo, issue_number: n, body });
  }

  async merge(n: number, headSha: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.pulls.merge({ owner: this.owner, repo: this.repo, pull_number: n, sha: headSha, merge_method: "merge" });
      return data.merged ? data.sha : null;
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status !== 405 && status !== 409) throw e;
      // Already merged (a crash after GitHub merged, or a retry): its merge commit, if it is the head that was voted on.
      try {
        const { data: p } = await this.octokit.pulls.get({ owner: this.owner, repo: this.repo, pull_number: n });
        if (p.merged && p.head.sha === headSha && p.merge_commit_sha) return p.merge_commit_sha;
      } catch { /* fall through: not mergeable */ }
      return null;
    }
  }

  async close(n: number): Promise<void> {
    await this.octokit.pulls.update({ owner: this.owner, repo: this.repo, pull_number: n, state: "closed" });
  }

  /**
   * All ledger files in one commit, so the repository never holds an events file and a state file that disagree,
   * and each publish costs one commit (and one Pages build). Retried when main moved underneath, e.g. a merge.
   */
  async publishLedger(files: Array<{ path: string; content: string }>, message: string): Promise<void> {
    const o = { owner: this.owner, repo: this.repo };
    for (let attempt = 0; ; attempt++) {
      const { data: ref } = await this.octokit.git.getRef({ ...o, ref: `heads/${this.ledgerBranch}` });
      const { data: head } = await this.octokit.git.getCommit({ ...o, commit_sha: ref.object.sha });
      const tree = [];
      for (const f of files) {
        const { data: blob } = await this.octokit.git.createBlob({ ...o, content: f.content, encoding: "utf-8" });
        tree.push({ path: f.path, mode: "100644" as const, type: "blob" as const, sha: blob.sha });
      }
      const { data: newTree } = await this.octokit.git.createTree({ ...o, base_tree: head.tree.sha, tree });
      if (newTree.sha === head.tree.sha) return; // nothing changed
      const { data: commit } = await this.octokit.git.createCommit({ ...o, message, tree: newTree.sha, parents: [head.sha] });
      try {
        await this.octokit.git.updateRef({ ...o, ref: `heads/${this.ledgerBranch}`, sha: commit.sha, force: false });
        return;
      } catch (e) {
        const status = (e as { status?: number }).status;
        if ((status === 422 || status === 409) && attempt < 4) continue; // main moved; rebuild on the new head
        throw e;
      }
    }
  }

  async listIssueComments(issue: number): Promise<IssueComment[]> {
    const base = { owner: this.owner, repo: this.repo, issue_number: issue, per_page: 100 };
    const first = await this.conditional(`comments:${issue}`, (headers) => this.octokit.issues.listComments({ ...base, page: 1, headers }));
    type C = Awaited<ReturnType<Octokit["issues"]["listComments"]>>["data"];
    let comments = first.data as C;
    if (comments.length === 100) comments = comments.concat(await this.octokit.paginate(this.octokit.issues.listComments, { ...base, page: 2 }));
    return comments.map((c) => ({ id: c.id, account: c.user?.id ?? 0, login: c.user?.login ?? "", body: c.body ?? "", createdAt: Math.floor(Date.parse(c.created_at) / 1000) }));
  }

  async starCount(): Promise<number> {
    const { data } = await this.octokit.repos.get({ owner: this.owner, repo: this.repo });
    return data.stargazers_count;
  }

  async listWatchers(): Promise<Array<{ id: number; login: string }>> {
    const subs = await this.octokit.paginate(this.octokit.activity.listWatchersForRepo, { owner: this.owner, repo: this.repo, per_page: 100 });
    return subs.map((u) => ({ id: u.id, login: u.login }));
  }

  async postDiscussion(title: string, body: string): Promise<string> {
    const q = await this.octokit.graphql<{ repository: { id: string; discussionCategories: { nodes: Array<{ id: string; name: string }> } } }>(
      `query($owner:String!,$repo:String!){ repository(owner:$owner,name:$repo){ id discussionCategories(first:20){ nodes{ id name } } } }`, { owner: this.owner, repo: this.repo });
    const cats = q.repository.discussionCategories.nodes;
    const cat = cats.find((c) => /announce/i.test(c.name)) ?? cats.find((c) => /general/i.test(c.name)) ?? cats[0];
    if (!cat) throw new Error("repository has no discussion categories; enable Discussions in the repository settings");
    const m = await this.octokit.graphql<{ createDiscussion: { discussion: { url: string } } }>(
      `mutation($repo:ID!,$cat:ID!,$title:String!,$body:String!){ createDiscussion(input:{repositoryId:$repo,categoryId:$cat,title:$title,body:$body}){ discussion{ url } } }`,
      { repo: q.repository.id, cat: cat.id, title, body });
    return m.createDiscussion.discussion.url;
  }
}

/** Doorbell URLs live in a private JSON file, never in the repository. */
export class FileDoorbellStore implements DoorbellStore {
  constructor(private path: string) {}
  load(): { doorbells: Record<string, DoorbellRecord>; lastDelivered: number } {
    if (!existsSync(this.path)) return { doorbells: {}, lastDelivered: 0 };
    return JSON.parse(readFileSync(this.path, "utf8"));
  }
  save(d: { doorbells: Record<string, DoorbellRecord>; lastDelivered: number }): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(d, null, 2), "utf8");
  }
}

/** Posts a signed event to a doorbell with a short timeout. */
/**
 * Delivers to public https addresses only: the address is checked again at
 * every delivery, the host must resolve to public addresses, redirects are
 * not followed, and the response body is never read. `allowPrivate` exists
 * for local testing and must stay off in production.
 */
export class HttpDoorbell implements DoorbellPort {
  constructor(private opts: { timeoutMs?: number; allowPrivate?: boolean } = {}) {}
  async deliver(url: string, body: string): Promise<{ ok: boolean; status: number }> {
    const allowPrivate = this.opts.allowPrivate ?? false;
    if (doorbellUrlProblem(url, { allowPrivate })) return { ok: false, status: 0 };
    if (!allowPrivate) {
      try {
        const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
        const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
        if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) return { ok: false, status: 0 };
      } catch { return { ok: false, status: 0 }; }
    }
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.opts.timeoutMs ?? 10_000);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "nomicon-agent" }, body, signal: ctl.signal, redirect: "manual" });
      return { ok: res.status >= 200 && res.status < 300, status: res.status };
    } catch { return { ok: false, status: 0 }; }
    finally { clearTimeout(t); }
  }
}
