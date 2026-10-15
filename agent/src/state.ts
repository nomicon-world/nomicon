/**
 * Fold ledger events into state.json (ledger/README.md). Pure and deterministic:
 * the replay tool and the running agent share this exact code.
 */
import type { LedgerEvent } from "./ledger.js";
import type { Laws } from "./laws.js";
import { weightsAt, type Merge } from "./weight.js";
import type { Question } from "./questions.js";
import type { MapFile } from "./worldmap.js";
import { extended, pausesOf, type Pause } from "./pauses.js";

/** since: when the fee was held; until: when it is forfeited, before any pause pushes that back (Article 8). */
export interface HeldFee { account: number; layer: "world" | "laws"; micro: bigint; until: number; pr: number; since?: number }
/** A held fee applied to a later submission: consumed by that submission's merge or rejection, held again on its expiry (Law 5). */
export interface HeldFeeInUse extends HeldFee { used_by: number }
export interface OpenVote { pr: number; head: string; layer: "world" | "laws"; opened: number; closes: number; laws_hash: string; qualified: number[]; authors: number[]; weightedAccountsAtOpen: number }

export interface State {
  version: 2;
  computed_at: number | null;
  head_event: number;
  bootstrap: { active: boolean; began: number | null; ends_by: number | null };
  fee: { base_micro: bigint; destination: string | null; last_adjusted_at: number | null };
  weights: Record<string, { login: string; mature_micro: bigint; immature_micro: bigint; last_vote_at: number | null }>;
  weighted_accounts: number;
  open_votes: OpenVote[];
  held_fees: HeldFee[];
  /** Held fees applied to submissions still in flight, keyed by the using pull request. */
  held_in_use: Record<number, HeldFeeInUse>;
  /** Owner accounts named under Article 6, each effective fourteen days after it was recorded. */
  pending_owner_accounts: Array<{ account: number; effective_at: number }>;
  deployed_agent: string | null;
  /** Public key signing the ledger now, after any rotation; null until a rotation (then the Constitution's key). */
  ledger_key: string | null;
  /** Internal bookkeeping needed to continue folding; included in state.json for transparency. */
  merges: Array<{ pr: number; account: number; mergedAt: number; weightMicro: bigint; revoked?: boolean }>;
  logins: Record<string, string>;
  last_vote_at: Record<string, number>;
  owner_accounts: number[];
  agent_account: number | null;
  barred_until: Record<string, number>;
  /** Author account of each pull request, learned from its first intake, hold or quote event. */
  pr_account: Record<string, number>;
  /** Author account of each merged World path (Law 12 citations). */
  path_author: Record<string, number>;
  /** Questions asked in merged files, keyed by the asking file's path (Law 12). */
  questions: Record<string, Question>;
  /** Every merged World Markdown file with its map declarations (Law 12); published as ledger/map.json, not in state.json. */
  map_files: Record<string, MapFile>;
  /** How each account chose to be reached (Law 12). */
  channels: Record<string, { doorbell?: "active" | "retired" | "off"; watch?: boolean }>;
}

export function emptyState(): State {
  return {
    version: 2, computed_at: null, head_event: 0,
    bootstrap: { active: false, began: null, ends_by: null },
    fee: { base_micro: 1_000_000n, destination: null, last_adjusted_at: null },
    weights: {}, weighted_accounts: 0, open_votes: [], held_fees: [], held_in_use: {}, pending_owner_accounts: [], deployed_agent: null, ledger_key: null,
    merges: [], logins: {}, last_vote_at: {}, owner_accounts: [], agent_account: null, barred_until: {}, pr_account: {}, path_author: {}, questions: {}, map_files: {}, channels: {},
  };
}

const big = (v: unknown): bigint => (typeof v === "bigint" ? v : BigInt(String(v)));
const num = (v: unknown): number => Number(v);

/** Apply one event. Mutates and returns the state. */
export function applyEvent(s: State, e: LedgerEvent, laws: Laws): State {
  if (e["account"] !== undefined && e["pr"] !== undefined && e["pr"] !== null && (e.type === "quote" || e.type === "screen_hold" || e.type === "intake_reject")) s.pr_account[num(e["pr"])] = num(e["account"]);
  const accountOf = (): number => (e["account"] !== undefined ? num(e["account"]) : (s.pr_account[num(e["pr"])] ?? NaN));
  switch (e.type) {
    case "genesis":
      s.bootstrap = { active: true, began: e.at, ends_by: e.at + 365 * 86400 };
      s.fee.destination = String(e["fee_destination"]);
      s.owner_accounts = (e["owner_accounts"] as number[]) ?? [];
      s.agent_account = e["agent_account"] !== undefined ? num(e["agent_account"]) : null;
      break;
    case "quote": {
      // Law 5: a quote covered by a held fee takes that fee out of the held set until the submission is decided.
      const used = e["held_fee_pr"];
      if (used !== undefined && used !== null) {
        const acct = num(e["account"]), pr = num(e["pr"]);
        const i = s.held_fees.findIndex((h) => h.account === acct && h.pr === num(used));
        if (i >= 0) { const fee = s.held_fees.splice(i, 1)[0]!; s.held_in_use[pr] = { ...fee, used_by: pr }; }
      }
      break;
    }
    case "vote_open":
      s.open_votes.push({
        pr: num(e["pr"]), head: String(e["head"]), layer: e["layer"] as "world" | "laws", opened: num(e["opened"]), closes: num(e["closes"]),
        laws_hash: String(e["laws_hash"]), qualified: (e["qualified"] as number[]) ?? [], authors: (e["authors"] as number[]) ?? [],
        weightedAccountsAtOpen: num(e["weighted_accounts"]),
      });
      break;
    case "review": {
      const acct = num(e["account"]);
      s.logins[acct] = String(e["login"]);
      const t = num(e["submitted"]);
      if ((s.last_vote_at[acct] ?? 0) < t) s.last_vote_at[acct] = t;
      break;
    }
    case "vote_close":
      s.open_votes = s.open_votes.filter((v) => v.pr !== num(e["pr"]));
      if (e["result"] === "reject") delete s.held_in_use[num(e["pr"])]; // rejection consumes a held fee
      break;
    case "withdrawal":
      s.open_votes = s.open_votes.filter((v) => v.pr !== num(e["pr"]));
      if (e["fee_disposition"] !== "held") delete s.held_in_use[num(e["pr"])];
      break;
    case "owner_action_applied":
      if (e["fee_disposition"] === "forfeit") delete s.held_in_use[num(e["pr"])];
      break;
    case "bar_lifted":
      delete s.barred_until[num(e["account"])];
      break;
    case "owner_accounts_change":
      s.pending_owner_accounts.push({ account: num(e["account"]), effective_at: num(e["effective_at"]) });
      break;
    case "merge": {
      const acct = num(e["account"]);
      const login = String(e["login"] ?? s.logins[acct] ?? "");
      s.logins[acct] = login;
      s.merges.push({ pr: num(e["pr"]), account: acct, mergedAt: e.at, weightMicro: big(e["weight_micro"]) });
      s.held_fees = s.held_fees.filter((h) => !(h.account === acct && h.pr === num(e["pr"])));
      delete s.held_in_use[num(e["pr"])]; // a merge consumes the held fee that paid for it
      const paths = (e["paths"] as string[] | undefined) ?? [];
      const headers = (e["headers"] as Record<string, { question?: string; answers?: string[]; cites?: string[] }> | undefined) ?? {};
      for (const p of paths) s.path_author[p] = acct;
      const titles = (e["titles"] as Record<string, string> | undefined) ?? {};
      for (const p of paths) {
        if (!p.startsWith("world/") || !p.toLowerCase().endsWith(".md")) continue;
        const h = headers[p] as { question?: string; answers?: string[]; cites?: string[]; about?: string; explains?: string; challenges?: string[]; prior?: string; adds?: string; map?: MapFile["map"] } | undefined;
        s.map_files[p] = { path: p, ...(titles[p] ? { title: titles[p] } : {}), ...(h?.map ? { map: h.map } : {}), ...(h?.question ? { question: h.question } : {}), answers: h?.answers ?? [], ...(h?.cites?.length ? { cites: h.cites } : {}), ...(h?.about ? { about: h.about } : {}), ...(h?.explains ? { explains: h.explains } : {}), ...(h?.challenges?.length ? { challenges: h.challenges } : {}), ...(h?.prior && h?.adds ? { prior: h.prior, adds: h.adds } : {}), pr: num(e["pr"]), by: acct, login, merged_at: e.at };
      }
      for (const [p, h] of Object.entries(headers)) {
        if (h.question && !s.questions[p]) s.questions[p] = { id: p, question: h.question, asked_by: acct, asked_login: login, asked_at: e.at, pr: num(e["pr"]), answers: [] };
        for (const qid of h.answers ?? []) {
          const q = s.questions[qid];
          if (q && !q.answers.some((a) => a.path === p)) q.answers.push({ path: p, by: acct, login, merged_at: e.at, pr: num(e["pr"]) });
        }
      }
      break;
    }
    case "channel": {
      const acct = num(e["account"]);
      const c = s.channels[acct] ?? {};
      if (e["channel"] === "doorbell") c.doorbell = e["status"] as "active" | "retired" | "off";
      if (e["channel"] === "watch") c.watch = e["status"] !== "off";
      s.channels[acct] = c;
      if (e["login"]) s.logins[acct] = String(e["login"]);
      break;
    }
    case "expiry": {
      const pr = num(e["pr"]), inUse = s.held_in_use[pr];
      if (inUse) delete s.held_in_use[pr]; // Law 5: a held fee is applied once; the funded submission's expiry forfeits it
      else s.held_fees.push({ account: num(e["account"]), layer: e["layer"] as "world" | "laws", micro: big(e["fee_micro"]), until: num(e["held_until"]), pr, since: e.at });
      s.open_votes = s.open_votes.filter((v) => v.pr !== pr);
      break;
    }
    case "owner_reject": {
      s.open_votes = s.open_votes.filter((v) => v.pr !== num(e["pr"]));
      if (e["barred_until"] !== undefined && Number.isFinite(accountOf())) s.barred_until[accountOf()] = num(e["barred_until"]);
      break;
    }
    case "fee_adjust":
      s.fee.base_micro = big(e["base_micro"]);
      s.fee.last_adjusted_at = e.at;
      break;
    case "takedown":
      for (const pr of (e["prs"] as number[]) ?? []) for (const m of s.merges) if (m.pr === pr) m.revoked = true;
      break;
    case "destination_change":
      s.fee.destination = String(e["destination"]);
      break;
    case "agent_account_change":
      s.agent_account = num(e["agent_account"]);
      break;
    case "deploy":
      s.deployed_agent = String(e["commit"]);
      break;
    case "key_rotation":
      s.ledger_key = typeof e["new_public_key"] === "string" ? e["new_public_key"] : s.ledger_key;
      break;
    case "declare":
      if (e["what"] === "bootstrap_end") s.bootstrap.active = false;
      // Article 7: a refund the law requires revokes the weight its fee minted.
      if (e["what"] === "refund") for (const m of s.merges) if (m.pr === num(e["pr"])) m.revoked = true;
      break;
    case "hold_resolved":
      if (e["decision"] === "reject" && e["barred_until"] !== undefined && Number.isFinite(accountOf())) s.barred_until[accountOf()] = num(e["barred_until"]);
      break;
    default:
      break;
  }
  s.head_event = e.id;
  return s;
}

/** Recompute weights at `now` from the folded merges. */
export function materialize(s: State, now: number, laws: Laws, pauses: Pause[] = []): State {
  const merges: Merge[] = s.merges.filter((m) => !m.revoked).map((m) => ({ account: m.account, mergedAt: m.mergedAt, weightMicro: m.weightMicro }));
  const lastVote = new Map<number, number>(Object.entries(s.last_vote_at).map(([k, v]) => [Number(k), v]));
  const w = weightsAt(merges, lastVote, now, laws);
  s.weights = {};
  let count = 0;
  for (const [acct, aw] of w) {
    s.weights[acct] = { login: s.logins[acct] ?? "", mature_micro: aw.matureMicro, immature_micro: aw.immatureMicro, last_vote_at: s.last_vote_at[acct] ?? null };
    if (aw.matureMicro > 0n) count++;
  }
  s.weighted_accounts = count;
  s.held_fees = s.held_fees.filter((h) => extended(h.until, h.since ?? h.until, pauses, now) > now);
  for (const p of s.pending_owner_accounts) if (p.effective_at <= now && !s.owner_accounts.includes(p.account)) s.owner_accounts.push(p.account);
  s.pending_owner_accounts = s.pending_owner_accounts.filter((p) => p.effective_at > now);
  s.computed_at = now;
  return s;
}

export function fold(events: LedgerEvent[], now: number, laws: Laws): State {
  let s = emptyState();
  for (const e of events) s = applyEvent(s, e, laws);
  return materialize(s, now, laws, pausesOf(events));
}

export function serializeState(s: State): string {
  return JSON.stringify(s, (k, v) => (k === "map_files" ? undefined : typeof v === "bigint" ? v.toString() : v), 2) + "\n";
}
