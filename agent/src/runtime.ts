/**
 * The orchestrator. One `tick()` applies the rules to every open pull request
 * and to the fee clock. All state is derived from the ledger; the runtime
 * keeps nothing in memory that a restart would lose.
 */
import { createHash } from "node:crypto";
import { BOOTSTRAP_MAX_DAYS } from "./constitution.js";
import { adjustBase, quote as computeQuote, throughputTarget } from "./fee.js";
import { intake } from "./intake.js";
import { Ledger, type LedgerEvent } from "./ledger.js";
import { parseLaws, LawsError, type Laws, type LoadedLaws } from "./laws.js";
import { phaseOf, type Phase } from "./phases.js";
import type { ChainPort, Clock, GitHubPort, PaymentNotice, PriceOracle, PullInfo, ScreenPort } from "./ports.js";
import { fold, serializeState, type State } from "./state.js";
import { tally, type Review } from "./tally.js";
import type { OpenQuote } from "./pay.js";
import { parseHeader, buildIndex, titleOf, type Header, type QuestionsIndex } from "./questions.js";
import { buildWorldMap, type SourceEdge, type SourceNode, type WorldMap } from "./worldmap.js";
import { jobCard, type Catalog } from "./jobs.js";
import { mentionTargets } from "./notify.js";
import type { Notifier } from "./notifier.js";

export interface RuntimeDeps {
  github: GitHubPort;
  chain: ChainPort;
  screen: ScreenPort;
  oracle: PriceOracle;
  clock: Clock;
  ledger: Ledger;
  /** Fallback source for laws.json and laws.schema.json when the ledger holds no snapshot yet. */
  loadLaws(): Promise<{ rawLaws: string; rawSchema: string }>;
  termsCommit(): Promise<string>;
  publicBaseUrl: string;
  log?: (msg: string) => void;
  /** Law 12 duties. Optional so the rules engine can run without them. */
  notifier?: Notifier;
  /** Shown on every quote once the owner is registered for GST/HST (Law 5). */
  tax?: { included: string; registration: string };
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export class Runtime {
  private laws: LoadedLaws | null = null;
  private schemaHash = "";
  private lastPublishedHead = "";
  private log: (msg: string) => void;
  constructor(private d: RuntimeDeps) { this.log = d.log ?? (() => {}); }

  get events(): LedgerEvent[] { return this.d.ledger.events; }

  private index = { length: 0, byPr: new Map<number, LedgerEvent[]>() };
  /** The events of one pull request, from an index that grows with the ledger, so a phase costs the events of that pull request, not of all. */
  private eventsOf(pr: number): LedgerEvent[] {
    const ev = this.events;
    if (this.index.length > ev.length) this.index = { length: 0, byPr: new Map() };
    for (let i = this.index.length; i < ev.length; i++) {
      const e = ev[i]!, p = e["pr"];
      if (p === undefined || p === null) continue;
      const k = Number(p), arr = this.index.byPr.get(k);
      if (arr) arr.push(e); else this.index.byPr.set(k, [e]);
    }
    this.index.length = ev.length;
    return this.index.byPr.get(pr) ?? [];
  }
  private phase(pr: number): Phase { return phaseOf(pr, this.eventsOf(pr)); }

  private memo = new Map<string, { length: number; now: number; value: unknown }>();
  /** A per-tick memo: valid while neither the clock nor the ledger has moved. */
  private memoized<T>(key: string, now: number, compute: () => T): T {
    const m = this.memo.get(key);
    if (m && m.length === this.events.length && m.now === now) return m.value as T;
    const value = compute();
    this.memo.set(key, { length: this.events.length, now, value });
    return value;
  }

  /**
   * Article 8 and Law 3: the rules in force are the latest laws_snapshot whose
   * effective time has passed. A non-compliant snapshot is refused and the
   * previous compliant one stays in force.
   */
  async refreshLaws(): Promise<Laws> {
    const now = this.d.clock.now();
    const snapshots = this.events.filter((e) => e.type === "laws_snapshot" && Number(e["effective_at"]) <= now);
    const candidates: Array<{ rawLaws: string; rawSchema: string; label: string }> = [];
    for (let i = snapshots.length - 1; i >= 0; i--) {
      const s = snapshots[i]!;
      candidates.push({ rawLaws: String(s["laws_raw"]), rawSchema: String(s["schema_raw"]), label: `snapshot ${s.id}` });
    }
    if (candidates.length === 0) {
      const f = await this.d.loadLaws();
      candidates.push({ rawLaws: f.rawLaws, rawSchema: f.rawSchema, label: "repository" });
    }
    for (const c of candidates) {
      try {
        const loaded = parseLaws(c.rawLaws, c.rawSchema);
        if (!this.laws || this.laws.hash !== loaded.hash) this.log(`laws ${loaded.hash.slice(0, 12)} in force (${c.label})`);
        this.laws = loaded;
        this.schemaHash = sha256(c.rawSchema);
        return loaded.laws;
      } catch (e) {
        if (!(e instanceof LawsError)) throw e;
        const hash = sha256(c.rawLaws);
        if (!this.events.some((ev) => ev.type === "refusal" && ev["laws_hash"] === hash)) {
          this.d.ledger.append(now, "refusal", { laws_hash: hash, reason: e.problems.join("; ") });
          this.log(`refused laws ${hash.slice(0, 12)}: ${e.problems.join("; ")}`);
        }
      }
    }
    if (this.laws) return this.laws.laws;
    throw new Error("no compliant laws.json has ever been loaded");
  }

  private stateCache: { now: number; length: number; state: State } | null = null;
  /** The state folded from the ledger at `now`, computed once per tick and per append. */
  state(now = this.d.clock.now()): State {
    const c = this.stateCache;
    if (c && c.now === now && c.length === this.events.length) return c.state;
    const state = this.stateUncached(now);
    this.stateCache = { now, length: this.events.length, state };
    return state;
  }
  private stateUncached(now: number): State {
    if (!this.laws) throw new Error("laws not loaded");
    return fold(this.events, now, this.laws.laws);
  }

  /** Ledger events after `since`, for the feed endpoint. */
  feed(since: number, limit = 200): LedgerEvent[] { return this.events.filter((e) => e.id > since).slice(0, limit); }

  /** Law 12: the open-questions index. */
  questionsIndex(now = this.d.clock.now()): QuestionsIndex { return buildIndex(this.state(now).questions, now); }

  /** Current open quote for the payment endpoint. */
  quoteFor(pr: number): OpenQuote | null {
    const p = this.phase(pr);
    if (p.kind !== "quoted") return null;
    const q = p.quote;
    return { pr, feeMicro: BigInt(String(q["fee_micro"])), destination: String(q["destination"]), expires: Number(q["expires"]) };
  }

  /** Called by the payment endpoint after settlement. */
  async onPaid(n: PaymentNotice): Promise<void> {
    const now = this.d.clock.now();
    const p = this.phase(n.pr);
    if (p.kind !== "quoted") {
      this.log(`payment for pr ${n.pr} arrived in phase ${p.kind}; recorded as unmatched`);
      this.d.ledger.append(now, "payment", { pr: n.pr, tx: n.tx, from: n.payer, amount_micro: n.amountMicro, matched: false });
      return;
    }
    const quoted = BigInt(String(p.quote["fee_micro"]));
    // The facilitator can answer before a public node has seen the block, so look again for a few seconds
    // rather than record a payment without the block whose timestamp Law 5 judges arrival by.
    let info = await this.d.chain.transactionInfo(n.tx);
    for (let i = 0; !info && i < 8; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      info = await this.d.chain.transactionInfo(n.tx);
    }
    if (!info) this.log(`pr ${n.pr}: transaction ${n.tx} not visible on chain yet; arrival taken as the agent's clock`);
    const arrival = info?.blockTime ?? now;
    // Law 5: a payment the agent accepted while the quote was open is on time whatever its block timestamp;
    // one recorded later is on time if its block preceded the quote's expiry.
    const matched = n.amountMicro >= quoted && (n.acceptedWhileOpen === true || arrival <= Number(p.quote["expires"]));
    const cad = await this.d.oracle.usdcToCad();
    const amountCad = ((Number(n.amountMicro) / 1_000_000) * Number(cad)).toFixed(2);
    this.d.ledger.append(now, "payment", {
      pr: n.pr, tx: n.tx, block: info?.blockNumber?.toString() ?? null, block_time: info?.blockTime ?? null,
      amount_micro: n.amountMicro, quoted_micro: quoted, from: n.payer, cad_value: amountCad, cad_rate: cad, matched,
    });
    if (!matched) this.log(`payment for pr ${n.pr} did not match its quote (amount ${n.amountMicro} vs ${quoted}, arrival ${arrival})`);
  }

  async tick(): Promise<void> {
    const added = this.d.ledger.reload();
    if (added) this.log(`${added} ledger event(s) appended by another process`);
    const laws = await this.refreshLaws();
    const now = this.d.clock.now();
    if (!this.events.some((e) => e.type === "genesis")) { this.log("no genesis event; run `nomicon genesis` first"); return; }
    await this.maybeAdjustFee(laws, now);
    await this.maybeEndBootstrap(now);
    const pulls = await this.d.github.listOpenPulls();
    // Closes are processed in the order their windows closed, then by number, so an earlier submission wins a conflict.
    // Order of service: votes by their close time, then paid submissions in order of payment, then submissions
    // never quoted before those whose quote lapsed, then by number. So places go oldest first (Law 2, Law 5).
    const st = this.state(now);
    const closes = new Map(st.open_votes.map((v) => [v.pr, v.closes] as [number, number]));
    const paidAt = new Map<number, number>(), quoted = new Set<number>();
    for (const e of this.events) {
      if (e.type === "payment" && e["matched"] !== false && !paidAt.has(Number(e["pr"]))) paidAt.set(Number(e["pr"]), e.id);
      if (e.type === "quote") quoted.add(Number(e["pr"]));
    }
    const key = (p: PullInfo): [number, number, number] => {
      const c = closes.get(p.number);
      if (c !== undefined) return [0, c, p.number];
      const paid = paidAt.get(p.number);
      if (paid !== undefined) return [1, paid, p.number];
      return [2, quoted.has(p.number) ? 1 : 0, p.number];
    };
    pulls.sort((a, b) => { const x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
    const openNumbers = new Set(pulls.map((p) => p.number));
    // One failing pull request must not stop the others, the owner's decisions, the sweeps or the publish.
    for (const pr of pulls) {
      try { await this.handlePull(pr, laws, now); }
      catch (e) { this.log(`pr ${pr.number}: ${(e as Error).message}; skipped this tick`); if (isRateLimited(e)) { this.log("API rate limit reached; the rest of this tick waits"); break; } }
    }
    await this.guard("owner decisions", () => this.applyOwnerDecisions(laws, now, openNumbers));
    // A pull request closed or drafted while its vote was open is a withdrawal (Law 8).
    await this.guard("withdrawals", async () => { for (const v of this.state(now).open_votes) if (!openNumbers.has(v.pr)) await this.withdraw(v.pr, laws, now, "closed after the vote opened"); });
    await this.guard("closed before open", () => this.sweepClosed(openNumbers, laws, now));
    await this.guard("merge reconciliation", () => this.reconcileClosed(openNumbers, laws, now));
    await this.guard("laws snapshots", () => this.reconcileLawsSnapshots(now, laws));
    await this.guard("bootstrap end", () => this.sweepBootstrapEnd(laws, now));
    if (this.d.notifier) {
      const n = this.d.notifier;
      await this.guard("doorbell registrations", () => n.pollRegistrations(now));
      await this.guard("watchers", () => n.pollWatchers(now, laws, this.state(now)));
      await this.guard("digest", () => n.maybeDigest(now, laws, this.state(now), this.events));
      await this.guard("doorbell deliveries", () => n.deliver(now, laws, this.state(now), this.events));
    }
    await this.publish(now);
  }

  private async handlePull(pr: PullInfo, laws: Laws, now: number): Promise<void> {
    const p = this.phase(pr.number);
    const state = this.state(now);
    switch (p.kind) {
      case "new": return this.intakeAndScreen(pr, laws, now, state);
      case "held":
        if (now - p.since >= laws.screening.hold_timeout_days * 86400) {
          this.d.ledger.append(now, "hold_resolved", { pr: pr.number, decision: "timeout", reason: "no owner action within the hold timeout" });
          await this.d.github.comment(pr.number, "The screening hold was not resolved within the time the Laws allow. This submission is closed without charge; it may be resubmitted.");
          await this.d.github.close(pr.number);
        }
        return;
      case "quoted":
        if (Number(p.quote["expires"]) < now) {
          this.d.ledger.append(now, "quote_lapsed", { pr: pr.number });
          await this.d.github.comment(pr.number, "The quote lapsed unpaid. A new quote will be issued on the agent's next pass while this pull request stays open.");
        }
        return;
      case "paid": {
        const maxOpen = this.maxOpenVotes(now, laws);
        if (state.open_votes.length >= maxOpen) return this.queueVote(pr, p.payment, now, maxOpen);
        return this.openVote(pr, p.quote, laws, now, state);
      }
      case "voting": return this.maybeClose(pr, p.open, p.quote, laws, now, state);
      case "await_owner":
        if (now - p.close.at >= laws.bootstrap.owner_action_deadline_days * 86400) await this.expire(pr.number, p.quote, laws, now, "the owner did not act within the bootstrap deadline", OWNER_CAUSED_HOLD_DAYS);
        return;
      case "confirmed": return this.doMerge(pr.number, String(p.open["head"]), p.quote, laws, now, pr.author);
      case "merging": return this.doMerge(pr.number, String(p.open["head"]), p.quote, laws, now, pr.author);
      default: return;
    }
  }

  private async intakeAndScreen(pr: PullInfo, laws: Laws, now: number, state: State): Promise<void> {
    const barred = state.barred_until[pr.author.id];
    if (barred && barred > now) {
      this.d.ledger.append(now, "intake_reject", { pr: pr.number, account: pr.author.id, reasons: [`author is barred from submitting until ${iso(barred)}`] });
      await this.d.github.comment(pr.number, `Submissions from this account are not accepted until ${iso(barred)} (Law 10).`);
      await this.d.github.close(pr.number);
      return;
    }
    // Law 10: an earlier pass on this exact head, or an owner release, means no new screening is needed.
    // A release covers the head the owner looked at, not whatever is pushed after it (Article 4, Law 10).
    const lastHold = [...this.events].reverse().find((e) => e.type === "screen_hold" && Number(e["pr"]) === pr.number);
    const released = lastHold !== undefined && String(lastHold["head"]) === pr.headSha
      && this.events.some((e) => e.type === "hold_resolved" && e["decision"] === "release" && Number(e["pr"]) === pr.number && e.id > lastHold.id);
    const passedBefore = this.events.some((e) => e.type === "quote" && Number(e["pr"]) === pr.number && String(e["head"]) === pr.headSha);
    const screening: "model" | "reused" | "released" = released ? "released" : passedBefore ? "reused" : "model";
    // Law 10: each account may have only so many unpaid submissions screened per day. Checked from the ledger
    // alone, before any platform call, so a flood of junk pull requests costs neither screening nor API budget.
    // Law 13: a qualified voter owes votes on open contributions before its next quote.
    const debt = this.votesOwed(pr.author.id, now, state, laws);
    if (debt.owed > 0) {
      const list = debt.available.slice(0, debt.owed).map((v) => `#${v.pr}`).join(", ");
      await this.deferScreening(pr, now, "votes_owed", `this account can vote and owes ${debt.owed} vote${debt.owed === 1 ? "" : "s"} on open contributions before its next quote (Law 13), for example ${list}. Approve or request changes on them; either counts. The quote follows on the agent's next pass`);
      return;
    }
    // Law 5: while the paid queue is longer than the members could review in weeks, no new quote is issued;
    // the submission waits, at no charge, and is quoted as the queue shortens. Checked from the ledger alone.
    const maxOpen = this.maxOpenVotes(now, laws);
    const waiting = this.paidWaiting(now).length;
    if (waiting >= maxOpen * laws.fee.max_queue_multiple) {
      await this.deferScreening(pr, now, "capacity", `${waiting} paid contributions are waiting for a vote and ${state.open_votes.length} votes are open, which is more than the members can review for weeks (Law 5). This submission is quoted automatically when the queue shortens, oldest first`);
      return;
    }
    const budget = screening === "model" ? this.unpaidScreening(now, state) : null;
    const mine = budget?.byAccount.get(pr.author.id) ?? { count: 0, bytes: 0 };
    if (budget && mine.count >= laws.screening.max_unpaid_screens_per_account_per_day) {
      await this.deferScreening(pr, now, "account_count", `this account already has ${mine.count} screened submissions from the last 24 hours that are unpaid, and the Laws allow ${laws.screening.max_unpaid_screens_per_account_per_day} (Law 10). Paying an open quote frees its place at once; otherwise places free themselves 24 hours after each screening`);
      return;
    }
    const [files, commits, existing] = await Promise.all([this.d.github.listFiles(pr.number), this.d.github.listCommits(pr.number), this.d.github.listPaths(pr.baseSha)]);
    const result = intake({ files, existingPaths: existing, commits }, laws);
    if (!result.ok) {
      this.d.ledger.append(now, "intake_reject", { pr: pr.number, account: pr.author.id, reasons: result.reasons });
      await this.d.github.comment(pr.number, "Not accepted at intake:\n\n" + result.reasons.map((r) => "- " + r).join("\n") + "\n\nSee LAWS.md Law 6 and Law 8. No fee was charged.");
      await this.d.github.close(pr.number);
      return;
    }
    // Law 6: the World grows by at most so many kilobytes in any 30 days; beyond that a submission waits for older merges to age out.
    const growthKb = laws.content.max_world_growth_kb_per_month;
    if (growthKb > 0 && result.layer === "world") {
      const incoming = files.reduce((a, f) => a + f.bytesChanged, 0);
      const used = this.worldGrowthLast30Days(now) + this.worldBytesInFlight(now);
      if (used + incoming > growthKb * 1024) {
        await this.deferScreening(pr, now, "growth", `the World has grown by ${Math.ceil(used / 1024)} kB in the last 30 days and the Laws allow ${growthKb} kB (Law 6); merges older than 30 days stop counting day by day, and this submission proceeds when there is room`);
        return;
      }
    }
    // Law 10: the byte budgets, per account and for everyone, with half of the total reserved for accounts that have paid before.
    let screenedBytes = 0;
    if (budget) {
      const kb = (b: number) => Math.ceil(b / 1024);
      screenedBytes = files.filter((f) => f.status !== "removed").reduce((a, f) => a + f.sizeAfter, 0);
      const perAccount = laws.screening.max_unpaid_screen_kb_per_account_per_day * 1024;
      const total = laws.screening.max_unpaid_screen_kb_per_day * 1024;
      const newcomer = !budget.known.has(pr.author.id);
      let reason: string | null = null, why = "";
      if (mine.bytes + screenedBytes > perAccount) { reason = "account_bytes"; why = `this account already has ${kb(mine.bytes)} kB of unpaid screened content from the last 24 hours, and the Laws allow ${laws.screening.max_unpaid_screen_kb_per_account_per_day} kB`; }
      else if (budget.total + screenedBytes > total) { reason = "global_bytes"; why = `the agent has screened ${kb(budget.total)} kB of unpaid content in the last 24 hours, and the Laws allow ${laws.screening.max_unpaid_screen_kb_per_day} kB a day in all`; }
      else if (newcomer && budget.newcomers + screenedBytes > total / 2) { reason = "newcomer_bytes"; why = `accounts that have not paid before share half of the daily screening budget, and ${kb(budget.newcomers)} kB of it is used; the other half is kept for accounts that have paid`; }
      if (reason) { await this.deferScreening(pr, now, reason, why + " (Law 10). Paying an open quote frees its place at once; otherwise places free themselves 24 hours after each screening"); return; }
    }
    // Law 10: screen before any quote.
    if (screening === "model") {
      const contents = await Promise.all(files.filter((f) => f.status !== "removed").map(async (f) => ({ path: f.path, content: await this.d.github.readFile(pr.headSha, f.path) })));
      let decision;
      try { decision = await this.d.screen.screen({ pr: pr.number, title: pr.title, body: pr.body, files: contents }); }
      catch (e) { this.log(`screen error on pr ${pr.number}: ${(e as Error).message}; will retry`); return; }
      if (decision.decision === "hold") {
        this.d.ledger.append(now, "screen_hold", { pr: pr.number, head: pr.headSha, account: pr.author.id, reason_class: decision.reasonClass, screened_bytes: screenedBytes });
        await this.d.github.comment(pr.number, "Held for the owner's review under Constitution Article 4. No fee has been charged. A hold is not a finding; it means a person must look before a vote can open.");
        return;
      }
    }
    // Law 5: quote. Concurrency counts this account's other submissions that are paid and not yet decided.
    const openPaid = new Set<number>();
    for (const e of this.events) {
      if (e.type !== "quote" || Number(e["account"]) !== pr.author.id || Number(e["pr"]) === pr.number) continue;
      const k = this.phase(Number(e["pr"])).kind;
      if (k === "paid" || k === "voting" || k === "await_owner" || k === "confirmed") openPaid.add(Number(e["pr"]));
    }
    const q = computeQuote({ layer: result.layer, bytesChanged: result.bytesChanged, openPaidByAccount: openPaid.size, baseMicro: state.fee.base_micro }, laws);
    const held = state.held_fees.find((h) => h.account === pr.author.id && h.layer === result.layer && h.micro >= q.feeMicro);
    const terms = await this.d.termsCommit();
    const expires = now + laws.fee.quote_valid_hours * 3600;
    const genesis = this.events.find((e) => e.type === "genesis");
    const network = genesis && typeof genesis["network"] === "string" ? (genesis["network"] as string) : laws.fee.network_caip2;
    const ev = this.d.ledger.append(now, "quote", {
      pr: pr.number, head: pr.headSha, account: pr.author.id, login: pr.author.login, layer: result.layer, network,
      fee_micro: held ? 0n : q.feeMicro, base_micro: q.baseMicro, multiplier: q.multiplier, concurrency: q.concurrency, size_kb: q.sizeKbCharged,
      weight_micro: q.weightMicro, terms_commit: terms, destination: state.fee.destination, expires, held_fee_pr: held?.pr ?? null, screening,
      bytes: files.reduce((a, f) => a + f.bytesChanged, 0), queue_ahead: this.paidWaiting(now).length,
      tax: this.d.tax?.included ?? "none", tax_registration: this.d.tax?.registration ?? "none",
      ...(screening === "model" ? { screened_bytes: screenedBytes } : {}),
    });
    if (held) {
      this.d.ledger.append(now, "payment", { pr: pr.number, tx: null, amount_micro: 0n, quoted_micro: 0n, from: null, cad_value: "0.00", matched: true, from_held_fee_pr: held.pr });
      await this.d.github.comment(pr.number, `A held fee from pull request #${held.pr} covers this submission. The vote opens on the agent's next pass.`);
      return;
    }
    await this.d.github.comment(pr.number, quoteComment(ev, laws, this.d.publicBaseUrl));
  }

  /** Model screenings in the last day whose submission is unpaid: per account, in total, and the newcomers' share; `known` holds accounts that have ever paid. */
  private unpaidScreening(now: number, state: State): { byAccount: Map<number, { count: number; bytes: number }>; total: number; newcomers: number; known: Set<number> } { return this.memoized("unpaidScreening", now, () => this.unpaidScreeningUncached(now, state)); }
  private unpaidScreeningUncached(now: number, state: State): { byAccount: Map<number, { count: number; bytes: number }>; total: number; newcomers: number; known: Set<number> } {
    const paid = new Set<number>(), known = new Set<number>();
    for (const e of this.events) if (e.type === "payment" && e["matched"] !== false) paid.add(Number(e["pr"]));
    for (const [id, w] of Object.entries(state.weights)) if (w.mature_micro > 0n) known.add(Number(id)); // Law 10: the reserved half is for members
    const byAccount = new Map<number, { count: number; bytes: number }>();
    let total = 0, newcomers = 0;
    for (const e of this.events) {
      if (now - e.at >= 86400 || paid.has(Number(e["pr"]))) continue;
      if (e.type !== "screen_hold" && e.type !== "quote") continue; // every quote counts toward the five; only model screenings cost bytes
      const account = Number(e["account"]), bytes = e.type === "quote" && (e["screening"] ?? "model") !== "model" ? 0 : Number(e["screened_bytes"] ?? 0);
      const m = byAccount.get(account) ?? { count: 0, bytes: 0 };
      m.count++; m.bytes += bytes; byAccount.set(account, m);
      total += bytes; if (!known.has(account)) newcomers += bytes;
    }
    return { byAccount, total, newcomers, known };
  }

  /** Bytes merged into the World in the last 30 days (Law 6), counting the bytes each merge added or changed in its diff. */
  private worldGrowthLast30Days(now: number): number {
    let total = 0;
    for (const e of this.events) if (e.type === "merge" && e["layer"] === "world" && now - e.at < 30 * 86400) total += Number(e["bytes"] ?? 0);
    return total;
  }

  /** Bytes of World contributions quoted or paid and not yet decided, reserved against the growth budget (Law 6). */
  private worldBytesInFlight(now: number): number { return this.memoized("worldBytesInFlight", now, () => this.worldBytesInFlightUncached(now)); }
  private worldBytesInFlightUncached(now: number): number {
    let total = 0;
    const seen = new Set<number>();
    for (const e of this.events) {
      if (e.type !== "quote" || e["layer"] !== "world") continue;
      const pr = Number(e["pr"]);
      if (seen.has(pr)) continue;
      seen.add(pr);
      const p = this.phase(pr);
      if (p.kind === "quoted" && Number(p.quote["expires"]) < now) continue;
      if (p.kind === "quoted" || p.kind === "paid" || p.kind === "voting" || p.kind === "await_owner" || p.kind === "confirmed" || p.kind === "merging") total += Number(p.quote["bytes"] ?? 0);
    }
    return total;
  }

  /** Reviews by qualified voters in the target lookback, the community's own review capacity (Law 5). */
  private qualifiedVotesInLookback(now: number, laws: Laws): number {
    const since = now - laws.fee.target_lookback_days * 86400;
    // Only contributions whose close reached quorum count: a bloc reviewing everything demonstrates no capacity until something closes properly.
    const reached = new Set<number>();
    for (const e of this.events) if (e.type === "vote_close" && e.at >= since && Number(e["yes_voters"]) >= Number(e["quorum"])) reached.add(Number(e["pr"]));
    const votes = new Set<string>();
    for (const e of this.events) if (e.type === "review" && Number(e["submitted"]) >= since && reached.has(Number(e["pr"]))) votes.add(`${e["account"]}:${e["pr"]}`);
    return votes.size; // one vote per voter per contribution, however often the review changed
  }

  private mergesInLookback(now: number, laws: Laws): number {
    const since = now - laws.fee.target_lookback_days * 86400;
    return this.events.filter((e) => e.type === "merge" && e.at >= since).length;
  }

  /** Law 2: how many votes may be open at once, from the throughput target. */
  private maxOpenVotes(now: number, laws: Laws): number {
    return Math.max(laws.fee.max_open_votes_min, laws.fee.max_open_votes_per_target * throughputTarget(this.qualifiedVotesInLookback(now, laws), this.mergesInLookback(now, laws), laws));
  }

  /** Paid submissions whose vote has not opened, in order of payment. */
  private paidWaiting(now: number): number[] { return this.memoized("paidWaiting", now, () => this.paidWaitingUncached(now)); }
  private paidWaitingUncached(now: number): number[] {
    const seen = new Set<number>(), out: number[] = [];
    for (const e of this.events) {
      if (e.type !== "payment" || e["matched"] === false) continue;
      const pr = Number(e["pr"]);
      if (seen.has(pr)) continue;
      seen.add(pr);
      if (this.phase(pr).kind === "paid") out.push(pr);
    }
    return out;
  }

  /** A paid submission waits for a place; record its position once and tell the author once. */
  private async queueVote(pr: PullInfo, payment: LedgerEvent, now: number, maxOpen: number): Promise<void> {
    if (this.events.some((e) => e.type === "vote_queued" && Number(e["pr"]) === pr.number && Number(e["payment"]) === payment.id)) return;
    const position = this.paidWaiting(now).indexOf(pr.number) + 1;
    this.d.ledger.append(now, "vote_queued", { pr: pr.number, payment: payment.id, position, max_open: maxOpen });
    await this.d.github.comment(pr.number, `Paid. ${maxOpen} votes are open, which is what the members can review at once, so this vote opens when a place frees, in order of payment. Position in the queue: ${position}. The window starts when it opens (Law 2).`);
  }

  /** Law 13: votes an account owes before its next quote, and the open votes it could cast them on, soonest to close first. */
  private votesOwed(account: number, now: number, state: State, laws: Laws): { owed: number; available: Array<{ pr: number; closes: number }> } {
    const k = laws.vote.votes_owed_per_submission;
    const w = state.weights[String(account)];
    if (!k || !w || w.mature_micro <= 0n) return { owed: 0, available: [] };
    // Law 13: counted from the account's previous payment, so a lapsed quote does not reset the debt.
    let lastPaidAt = 0;
    for (const e of this.events) if (e.type === "payment" && e["matched"] !== false && state.pr_account[Number(e["pr"])] === account) lastPaidAt = e.at;
    const voted = new Set<number>();
    for (const e of this.events) if (e.type === "review" && Number(e["account"]) === account && Number(e["submitted"]) > lastPaidAt) voted.add(Number(e["pr"]));
    const available = state.open_votes
      .filter((v) => v.qualified.includes(account) && !v.authors.includes(account) && !voted.has(v.pr))
      .map((v) => ({ pr: v.pr, closes: v.closes }))
      .sort((a, b) => a.closes - b.closes || a.pr - b.pr);
    return { owed: Math.min(Math.max(0, k - voted.size), available.length), available };
  }

  /** Record once per head that screening waits, and tell the author once. */
  private async deferScreening(pr: PullInfo, now: number, reason: string, why: string): Promise<void> {
    if (this.events.some((e) => e.type === "screen_deferred" && Number(e["pr"]) === pr.number && String(e["head"]) === pr.headSha)) return;
    this.d.ledger.append(now, "screen_deferred", { pr: pr.number, head: pr.headSha, account: pr.author.id, reason });
    await this.d.github.comment(pr.number, `Waiting: ${why}. This submission proceeds automatically then. Nothing is charged for waiting.`);
  }

  private async openVote(pr: PullInfo, quote: LedgerEvent, laws: Laws, now: number, state: State): Promise<void> {
    if (pr.headSha !== String(quote["head"])) { await this.withdraw(pr.number, laws, now, "head changed before the vote opened", quote); return; }
    const commits = await this.d.github.listCommits(pr.number);
    const authors = new Set<number>([pr.author.id]);
    // Law 1: only a commit the platform verified as signed by an account makes that account an author; names on commits are anyone's to write.
    for (const c of commits) if (c.verified && c.authorId) authors.add(c.authorId);
    const commitRecord = commits.map((c) => ({ sha: c.sha, author: c.authorId ?? null, verified: c.verified === true }));
    const qualified = Object.entries(state.weights).filter(([id, w]) => w.mature_micro > 0n && !authors.has(Number(id))).map(([id]) => Number(id)).sort((a, b) => a - b);
    const layer = quote["layer"] as "world" | "laws";
    const proc = layer === "laws" ? laws.vote.laws : laws.vote.world;
    const immediate = state.bootstrap.active && qualified.length === 0 && laws.bootstrap.close_immediately_without_voters;
    const closes = immediate ? now : now + proc.window_hours * 3600;
    this.d.ledger.append(now, "vote_open", {
      pr: pr.number, head: pr.headSha, layer, opened: now, closes, laws_hash: this.laws!.hash,
      qualified, authors: [...authors].sort((a, b) => a - b), commits: commitRecord, weighted_accounts: state.weighted_accounts,
    });
    await this.d.github.comment(pr.number, "```nomicon-vote\n" + [`pr: ${pr.number}`, `head: ${pr.headSha}`, `layer: ${layer}`, `opened: ${iso(now)}`, `closes: ${iso(closes)}`, `laws: ${this.laws!.hash}`, `qualified_voters: ${qualified.length}`].join("\n") + "\n```\nQualified voters vote by reviewing this pull request: Approve is yes, Request changes is no. Do not push to it.");
  }

  private async maybeClose(pr: PullInfo, open: LedgerEvent, quote: LedgerEvent, laws: Laws, now: number, state: State): Promise<void> {
    if (pr.headSha !== String(open["head"]) || pr.draft) { await this.withdraw(pr.number, laws, now, pr.draft ? "converted to draft" : "pushed after the vote opened", quote); return; }
    const closesAt = Number(open["closes"]);
    // Reviews are recorded as they appear, so the ledger shows votes as cast and Law 13 can count them.
    const reviews = await this.d.github.listReviews(pr.number);
    const qualified = new Set((open["qualified"] as number[]) ?? []);
    const authors = new Set((open["authors"] as number[]) ?? []);
    this.recordReviews(pr.number, reviews, qualified, Number(open["opened"]), closesAt, now);
    if (now < closesAt) return;
    const lawsAtOpen = this.lawsByHash(String(open["laws_hash"]), laws);
    const atClose = fold(this.events, closesAt, lawsAtOpen);
    const matureAtClose = new Map<number, bigint>();
    for (const [id, w] of Object.entries(atClose.weights)) matureAtClose.set(Number(id), w.mature_micro);
    const base = {
      layer: open["layer"] as "world" | "laws", openedAt: Number(open["opened"]), closesAt, qualified, authors,
      // Law 2: the vote is what the ledger recorded while the window was open; a later dismissal on the platform is ignored.
      reviews: this.recordedReviews(pr.number),
      matureAtClose, weightedAccountsAtOpen: Number(open["weighted_accounts"]),
    };
    const result = tally(base, lawsAtOpen);
    // Article 3: during bootstrap every closed vote waits for the owner, whatever the tally says.
    const bootstrap = state.bootstrap.active;
    const recorded = bootstrap ? "await_owner" : result.result;
    this.d.ledger.append(now, "vote_close", {
      pr: pr.number, yes_voters: result.yesVoters, quorum: result.quorum, yes_micro: result.yesMicro, no_micro: result.noMicro,
      tie: result.tie, tally_result: result.result, result: recorded, bootstrap,
      votes: result.votes.map((v) => ({ account: v.account, yes: v.yes, weight_micro: v.weightMicro })),
    });
    const summary = `Tally: ${result.result}. Yes voters ${result.yesVoters} of quorum ${result.quorum}. Yes weight ${micro(result.yesMicro)}, no weight ${micro(result.noMicro)}${result.tie ? ". Equal weight is no decision (Law 2)" : ""}.`;
    if (recorded === "await_owner") { await this.d.github.comment(pr.number, summary + " Bootstrap is active: this merges only when the owner confirms, and the owner may reject."); return; }
    if (recorded === "merge") { await this.doMerge(pr.number, String(open["head"]), quote, laws, now, pr.author, summary); return; }
    if (recorded === "reject") { await this.d.github.comment(pr.number, summary + " The fee is forfeit (Law 5)."); await this.d.github.close(pr.number); return; }
    await this.expire(pr.number, quote, laws, now, summary + (result.tie ? "" : " Quorum was not reached."));
  }

  /** Run one tick duty, logging a failure instead of abandoning the duties after it. */
  private async guard(what: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); } catch (e) { this.log(`${what} failed this tick: ${(e as Error).message}`); }
  }

  /**
   * Submissions that left the open list before their vote opened: quoted, paid, or awaiting the owner (Law 8).
   * A paid one is a withdrawal with the fee held, since no vote could have been cast; without this they would
   * hold queue places and concurrency forever.
   */
  private async sweepClosed(openNumbers: Set<number>, laws: Laws, now: number): Promise<void> {
    const seen = new Set<number>();
    for (const e of this.events) {
      if (e.type !== "quote") continue;
      const pr = Number(e["pr"]);
      if (seen.has(pr) || openNumbers.has(pr)) continue;
      seen.add(pr);
      const p = this.phase(pr);
      if (p.kind !== "quoted" && p.kind !== "paid" && p.kind !== "await_owner") continue;
      let info: PullInfo;
      try { info = await this.d.github.getPull(pr); } catch (err) { this.log(`pr ${pr}: cannot read the closed pull request: ${(err as Error).message}`); continue; }
      if (info.state === "open") continue;
      if (info.merged) { this.log(`pr ${pr} was merged outside the rules while ${p.kind}; left for the owner`); continue; }
      if (p.kind === "quoted") { this.d.ledger.append(now, "quote_lapsed", { pr, reason: "closed unpaid" }); continue; }
      await this.withdraw(pr, laws, now, p.kind === "paid" ? "closed before the vote opened" : "closed while awaiting the owner", p.quote);
    }
  }

  /** Article 3: when bootstrap ends, every contribution still awaiting the owner's action is treated as expired, with the fee held for the owner-caused term. */
  private async sweepBootstrapEnd(laws: Laws, now: number): Promise<void> {
    if (this.state(now).bootstrap.active) return;
    const seen = new Set<number>();
    for (const e of this.events) {
      if (e.type !== "vote_close" || e["result"] !== "await_owner") continue;
      const pr = Number(e["pr"]);
      if (seen.has(pr)) continue;
      seen.add(pr);
      const p = this.phase(pr);
      if (p.kind === "await_owner") await this.expire(pr, p.quote, laws, now, "bootstrap ended with no owner decision (Article 3)", OWNER_CAUSED_HOLD_DAYS);
    }
  }

  /** A Laws-layer merge whose snapshot could not be read at merge time gets it on a later tick, so no Laws change is ever lost. */
  private async reconcileLawsSnapshots(now: number, laws: Laws): Promise<void> {
    for (const m of this.events) {
      if (m.type !== "merge" || m["layer"] !== "laws") continue;
      const commit = String(m["merge_commit"]);
      if (this.events.some((e) => e.type === "laws_snapshot" && String(e["merge_commit"]) === commit)) continue;
      const paths = (m["paths"] as string[] | undefined) ?? [];
      if (!paths.includes("laws.json") && !paths.includes("laws.schema.json")) continue;
      await this.snapshotLaws(Number(m["pr"]), commit, m.at, laws);
    }
  }

  /** Pull requests that left the open list while the ledger still expects a merge: a crash between GitHub's merge and the ledger write, or a close by the author in that moment. */
  private async reconcileClosed(openNumbers: Set<number>, laws: Laws, now: number): Promise<void> {
    const candidates = new Set<number>();
    for (const e of this.events) if (e.type === "vote_close" || e.type === "owner_confirm") candidates.add(Number(e["pr"]));
    for (const pr of candidates) {
      if (openNumbers.has(pr)) continue;
      const p = this.phase(pr);
      if (p.kind !== "merging" && p.kind !== "confirmed") continue;
      let info: PullInfo;
      try { info = await this.d.github.getPull(pr); } catch (e) { this.log(`pr ${pr}: cannot read the closed pull request: ${(e as Error).message}`); continue; }
      if (info.merged) await this.doMerge(pr, String(p.open["head"]), p.quote, laws, now, info.author);
      else await this.withdraw(pr, laws, now, "closed before it could be merged", p.quote);
    }
  }

  /** The reviews the ledger recorded for a pull request, in order, as tally input. */
  private recordedReviews(pr: number): Array<{ reviewId: number; account: number; login: string; state: Review["state"]; submittedAt: number }> {
    return this.events.filter((e) => e.type === "review" && Number(e["pr"]) === pr).map((e) => ({
      reviewId: Number(e["review_id"]), account: Number(e["account"]), login: String(e["login"]), state: String(e["state"]) as Review["state"], submittedAt: Number(e["submitted"]),
    }));
  }

  /**
   * Record each qualified voter's latest counting review when it changes, so replay needs nothing from the
   * platform (Article 11) and a voter changing its mind a thousand times writes a bounded number of events.
   * Returns how many accounts have a counting review.
   */
  private recordReviews(pr: number, reviews: Array<{ reviewId: number; account: number; login: string; state: string; submittedAt: number }>, qualified: Set<number>, opened: number, closesAt: number, now: number): number {
    const latest = new Map<number, (typeof reviews)[number]>();
    for (const r of reviews) {
      if ((r.state !== "APPROVED" && r.state !== "CHANGES_REQUESTED") || !qualified.has(r.account) || r.submittedAt <= opened || r.submittedAt > closesAt) continue;
      const prev = latest.get(r.account);
      if (!prev || r.submittedAt > prev.submittedAt || (r.submittedAt === prev.submittedAt && r.reviewId > prev.reviewId)) latest.set(r.account, r);
    }
    for (const r of latest.values()) {
      const mine = this.events.filter((e) => e.type === "review" && Number(e["pr"]) === pr && Number(e["account"]) === r.account);
      const last = mine[mine.length - 1];
      if (last && Number(last["review_id"]) === r.reviewId) continue;
      if (mine.length >= MAX_RECORDED_REVIEWS_PER_VOTER && now < closesAt) continue; // further changes are recorded at close only
      this.d.ledger.append(now, "review", { pr, account: r.account, login: r.login, review_id: r.reviewId, state: r.state, submitted: r.submittedAt });
    }
    return latest.size;
  }

  private async doMerge(pr: number, head: string, quote: LedgerEvent, laws: Laws, now: number, author: { id: number; login: string }, note = ""): Promise<void> {
    // Law 8 at close: main may have moved since the quote, so the path rules run again against it,
    // unless GitHub already performed this merge (a crash before the record, see reconcileClosed).
    let alreadyMerged = false;
    try { alreadyMerged = (await this.d.github.getPull(pr)).merged; } catch { /* treat as not merged */ }
    if (!alreadyMerged) {
      let again;
      try {
        const [files, commits, existing] = await Promise.all([this.d.github.listFiles(pr), this.d.github.listCommits(pr), this.d.github.listPaths("main")]);
        again = intake({ files, existingPaths: existing, commits }, laws);
      } catch (e) { this.log(`pr ${pr}: could not re-check intake at close, retrying next tick: ${(e as Error).message}`); return; }
      if (!again.ok) { await this.expire(pr, quote, laws, now, `no longer passes intake against the current main: ${again.reasons.join("; ")}.`); return; }
    }
    // Law 2.6: a merge that would exceed the growth budget waits, in order of close, until the budget allows it.
    if (!alreadyMerged && quote["layer"] === "world" && laws.content.max_world_growth_kb_per_month > 0) {
      const incoming = Number(quote["bytes"] ?? 0);
      if (this.worldGrowthLast30Days(now) + incoming > laws.content.max_world_growth_kb_per_month * 1024) {
        if (!this.events.some((e) => e.type === "merge_deferred" && Number(e["pr"]) === pr)) {
          this.d.ledger.append(now, "merge_deferred", { pr, reason: "growth" });
          await this.d.github.comment(pr, "Passed, and waiting to merge: the World's growth budget for the last 30 days is used (Law 6). This merges automatically, in order of close, as older merges leave the window. The outcome stands.");
        }
        return;
      }
    }
    const mergeCommit = await this.d.github.merge(pr, head);
    if (!mergeCommit) { await this.expire(pr, quote, laws, now, "could not be merged cleanly at close"); return; }
    // Law 12: record what was merged and any headers, so questions and citations replay from the ledger alone.
    const paths: string[] = [];
    const headers: Record<string, Header> = {};
    const titles: Record<string, string> = {};
    let bytes = 0;
    try {
      const files = await this.d.github.listFiles(pr);
      for (const f of files) {
        if (f.status === "removed") continue;
        paths.push(f.path);
        bytes += f.bytesChanged;
        if (f.path.startsWith("world/") && f.path.toLowerCase().endsWith(".md")) {
          const content = await this.d.github.readFile(mergeCommit, f.path);
          const h = parseHeader(content);
          if (h) headers[f.path] = h;
          const t = titleOf(content);
          if (t) titles[f.path] = t;
        }
      }
    } catch (e) { this.log(`could not read merged files of pr ${pr}: ${(e as Error).message}`); }
    // Article 6: the owner may publish like anyone, paying the fee, and earns no weight by doing so.
    const weight = this.state(now).owner_accounts.includes(author.id) ? 0n : BigInt(String(quote["weight_micro"]));
    const mergeEvent = this.d.ledger.append(now, "merge", { pr, head, merge_commit: mergeCommit, weight_micro: weight, account: author.id, login: author.login, layer: quote["layer"], paths, headers, titles, bytes });
    if (paths.some((x) => x.startsWith("world/replicator-map/"))) this.replicatorSource = undefined;
    if (paths.includes("paths.json")) this.catalogSource = undefined;
    await this.d.github.comment(pr, (note ? note + " " : "") + `Merged as ${mergeCommit}. Weight ${micro(weight)} USDC accrues to the author and matures in ${laws.weight.maturity_days} days.`);
    // Law 12: tell the people this contribution answered or built on.
    const targets = mentionTargets(author.id, headers, this.state(now), laws.notices.mention_cap_per_merge);
    if (targets.length) {
      const st = this.state(now);
      const lines = targets.map((t) => `@${st.logins[t.account] ?? t.account}: this contribution ${t.reason} (${t.about}).`);
      try { await this.d.github.comment(pr, lines.join("\n")); } catch (e) { this.log(`mention comment failed on pr ${pr}: ${(e as Error).message}`); }
      for (const t of targets) this.d.ledger.append(now, "notice", { kind: "mention", target: t.account, pr, about: mergeEvent.id, reason: t.reason, ok: true });
    }
    // paths.json: suggest three next jobs near what was merged, so the next arrival has somewhere to start.
    try {
      const next = await this.nextJobs(paths, now);
      if (next.length) await this.d.github.comment(pr, ["Next jobs near this one, for anyone who wants them:", ...next, `All the ways to take part are in paths.json and at ${MAP_URL.replace(/map\.html$/, "ways.html")}.`].join("\n"));
    } catch (e) { this.log(`next-jobs comment failed on pr ${pr}: ${(e as Error).message}`); }
    // Law 3: a change to the Laws takes effect after the delay. Snapshot what was merged; a failure here is retried by reconcileLawsSnapshots.
    if (quote["layer"] === "laws") {
      try { await this.snapshotLaws(pr, mergeCommit, now, laws); }
      catch (e) { this.log(`pr ${pr}: laws snapshot deferred to a later tick: ${(e as Error).message}`); }
    }
  }

  /** Record the Laws merged at `mergeCommit`, effective `effect_delay_days` after the merge, if they differ from the Laws in force. */
  private async snapshotLaws(pr: number, mergeCommit: string, mergedAt: number, laws: Laws): Promise<void> {
    const [rawLaws, rawSchema] = await Promise.all([this.d.github.readFile(mergeCommit, "laws.json"), this.d.github.readFile(mergeCommit, "laws.schema.json")]);
    if (sha256(rawLaws) === this.laws!.hash && sha256(rawSchema) === this.schemaHash) return;
    const effective = mergedAt + laws.vote.laws.effect_delay_days * 86400;
    this.d.ledger.append(this.d.clock.now(), "laws_snapshot", { pr, laws_hash: sha256(rawLaws), laws_raw: rawLaws, schema_raw: rawSchema, effective_at: effective, merge_commit: mergeCommit });
    try { await this.d.github.comment(pr, `This change to the Laws takes effect at ${iso(effective)} (Law 3). Votes opened before then run under the rules recorded at their open.`); } catch { /* the ledger has it */ }
  }

  private async expire(pr: number, quote: LedgerEvent, laws: Laws, now: number, why: string, holdDays = laws.fee.expiry_hold_days): Promise<void> {
    const heldUntil = now + holdDays * 86400;
    this.d.ledger.append(now, "expiry", { pr, account: Number(quote["account"]), layer: quote["layer"], fee_micro: BigInt(String(quote["fee_micro"])), held_until: heldUntil, reason: why });
    await this.d.github.comment(pr, `Expired: ${why} The fee is held until ${iso(heldUntil)} for resubmission at the same layer (Law 5).`);
    await this.d.github.close(pr);
  }

  /** Law 8: a push, close or draft conversion after the vote opened. Forfeit once any qualified vote was cast. */
  private async withdraw(pr: number, laws: Laws, now: number, why: string, quote?: LedgerEvent): Promise<void> {
    const q = quote ?? [...this.events].reverse().find((e) => e.type === "quote" && Number(e["pr"]) === pr);
    const open = [...this.events].reverse().find((e) => e.type === "vote_open" && Number(e["pr"]) === pr);
    let anyVote = false;
    if (open) {
      let reviews: Awaited<ReturnType<GitHubPort["listReviews"]>> = [];
      try { reviews = await this.d.github.listReviews(pr); } catch { /* closed and gone: fall back to the ledger */ }
      anyVote = this.recordReviews(pr, reviews, new Set((open["qualified"] as number[]) ?? []), Number(open["opened"]), now, now) > 0
        || this.events.some((e) => e.type === "review" && Number(e["pr"]) === pr);
    }
    const held = !anyVote && !!q;
    this.d.ledger.append(now, "withdrawal", { pr, reason: why, fee_disposition: held ? "held" : "forfeit" });
    if (held) {
      const heldUntil = now + laws.fee.expiry_hold_days * 86400;
      this.d.ledger.append(now, "expiry", { pr, account: Number(q["account"]), layer: q["layer"], fee_micro: BigInt(String(q["fee_micro"])), held_until: heldUntil, reason: "withdrawal before any vote" });
    }
    try { await this.d.github.comment(pr, `Withdrawn: ${why}. Fee ${held ? "held for resubmission" : "forfeit"} (Law 8).`); await this.d.github.close(pr); } catch { /* already closed */ }
  }

  /** Article 3, Article 5 and Law 10: carry out owner decisions recorded by the CLI. */
  private async applyOwnerDecisions(laws: Laws, now: number, openNumbers: Set<number>): Promise<void> {
    for (const e of this.events) {
      const isReject = e.type === "owner_reject" || (e.type === "hold_resolved" && e["decision"] === "reject");
      if (!isReject) continue;
      if (this.events.some((a) => a.type === "owner_action_applied" && Number(a["event"]) === e.id)) continue;
      const pr = Number(e["pr"]);
      let disposition = "none";
      if (e.type === "owner_reject") {
        const close = [...this.events].reverse().find((x) => x.type === "vote_close" && Number(x["pr"]) === pr && x.id < e.id);
        const q = [...this.events].reverse().find((x) => x.type === "quote" && Number(x["pr"]) === pr && x.id < e.id);
        const tallyResult = close ? String(close["tally_result"] ?? close["result"]) : "none";
        // Article 3: a rejection after a passing vote is an expiry for the fee; so is one before any tally.
        if (q && tallyResult !== "reject") {
          const heldUntil = now + OWNER_CAUSED_HOLD_DAYS * 86400;
          this.d.ledger.append(now, "expiry", { pr, account: Number(q["account"]), layer: q["layer"], fee_micro: BigInt(String(q["fee_micro"])), held_until: heldUntil, reason: "owner rejection" });
          disposition = "held";
        } else disposition = q ? "forfeit" : "none";
      }
      if (openNumbers.has(pr)) {
        try {
          await this.d.github.comment(pr, e.type === "owner_reject" ? `Rejected by the owner: ${e["reason"]}. Fee ${disposition === "held" ? "held for resubmission" : disposition}.` : `The screening hold was resolved as a rejection: ${e["reason"]}.`);
          await this.d.github.close(pr);
        } catch (err) { this.log(`could not close pr ${pr}: ${(err as Error).message}`); }
      }
      this.d.ledger.append(now, "owner_action_applied", { pr, event: e.id, fee_disposition: disposition });
    }
  }

  private async maybeAdjustFee(laws: Laws, now: number): Promise<void> {
    const last = [...this.events].reverse().find((e) => e.type === "fee_adjust" || e.type === "genesis");
    if (last && now - last.at < laws.fee.adjust_every_hours * 3600) return;
    const state = this.state(now);
    const lookback = now - laws.fee.lookback_hours * 3600;
    const paid = this.events.filter((e) => e.type === "payment" && e["matched"] !== false && e.at >= lookback).length;
    const qualifiedVotes = this.qualifiedVotesInLookback(now, laws);
    const merges = this.mergesInLookback(now, laws);
    const queueAboveOpenLimit = this.paidWaiting(now).length > this.maxOpenVotes(now, laws);
    const r = adjustBase({ baseMicro: state.fee.base_micro, paidSubmissionsInLookback: paid, qualifiedVotesInLookback: qualifiedVotes, mergesInLookback: merges, queueAboveOpenLimit }, laws);
    let anchorTx: string | null = null;
    const head = this.d.ledger.headHash();
    try { anchorTx = await this.d.chain.anchor(head); } catch (e) { this.log(`anchor failed: ${(e as Error).message}`); }
    this.d.ledger.append(now, "fee_adjust", { base_micro: r.baseMicro, submissions_24h: paid, target: r.target, per_day: r.perDay, anchor_tx: anchorTx, ledger_head: head });
  }

  private async maybeEndBootstrap(now: number): Promise<void> {
    const state = this.state(now);
    if (!state.bootstrap.active || !state.bootstrap.began) return;
    if (now - state.bootstrap.began < BOOTSTRAP_MAX_DAYS * 86400) return;
    this.d.ledger.append(now, "declare", { what: "bootstrap_end", reason: `${BOOTSTRAP_MAX_DAYS} days elapsed (Article 3)` });
  }

  private lawsByHash(hash: string, current: Laws): Laws {
    if (this.laws && this.laws.hash === hash) return this.laws.laws;
    const snap = this.events.find((e) => e.type === "laws_snapshot" && e["laws_hash"] === hash);
    if (snap) {
      try { return parseLaws(String(snap["laws_raw"]), String(snap["schema_raw"])).laws; } catch { /* fall through */ }
    }
    this.log(`laws ${hash.slice(0, 12)} not available; using current`);
    return current;
  }

  /** world/replicator-map read from main, one more source of the World map; refreshed after a merge touches it. */
  private replicatorSource: { nodes: SourceNode[]; edges: SourceEdge[] } | null | undefined;
  private async replicator(): Promise<{ nodes: SourceNode[]; edges: SourceEdge[] } | null> {
    if (this.replicatorSource !== undefined) return this.replicatorSource;
    try {
      const [n, r] = await Promise.all([this.d.github.readFile("main", "world/replicator-map/nodes.json"), this.d.github.readFile("main", "world/replicator-map/relations.json")]);
      const nodes = (JSON.parse(n) as { nodes?: SourceNode[] }).nodes ?? [];
      const edges = ((JSON.parse(r) as { relations?: Array<SourceEdge & { hidden?: boolean }> }).relations ?? []).map((e) => ({ from: e.from, to: e.to, type: e.type }));
      this.replicatorSource = { nodes, edges };
    } catch { this.replicatorSource = null; }
    return this.replicatorSource;
  }

  /** paths.json from main, the ways to take part; refreshed after a merge changes it. */
  private catalogSource: Catalog | null | undefined;
  async catalog(): Promise<Catalog | null> {
    if (this.catalogSource !== undefined) return this.catalogSource;
    try { this.catalogSource = JSON.parse(await this.d.github.readFile("main", "paths.json")) as Catalog; } catch { this.catalogSource = null; }
    return this.catalogSource;
  }
  async worldMap(now: number): Promise<WorldMap> { return buildWorldMap(this.state(now).map_files, await this.replicator(), now); }
  /** A job card for an option at a node of the World map. */
  async job(option: string, nodeId: string | null): Promise<Record<string, unknown>> {
    const cat = await this.catalog();
    if (!cat) return { error: "paths.json is not available yet" };
    const now = this.d.clock.now();
    const m = await this.worldMap(now);
    const byId = new Map(m.nodes.map((n) => [n.id, n]));
    let node = null;
    if (nodeId) { node = byId.get(nodeId) ?? null; if (!node) return { error: `no node ${nodeId} on the map` }; }
    return jobCard(cat, option, node, byId, this.state(now).fee.base_micro, MAP_URL);
  }
  /** Up to three jobs near what a merge added: open spots and open questions beside it, else ways to build on it. */
  async nextJobs(paths: string[], now: number): Promise<string[]> {
    const m = await this.worldMap(now);
    const placed = m.nodes.filter((n) => n.source && paths.includes(n.source));
    const lines: string[] = [], seen = new Set<string>();
    const add = (id: string, label: string, option: string, text: string) => {
      const key = `${id}|${option}`; if (seen.has(key) || lines.length >= 3) return; seen.add(key);
      lines.push(`- ${text} "${label}": ${MAP_URL}#node=${encodeURIComponent(id)}&do=${option}`);
    };
    for (const p of placed) for (const n of m.nodes) if (n.parent === p.parent || n.parent === p.id) {
      if (n.stub) add(n.id, n.label, "fill-spot", "Fill the open spot");
      else if (n.kind === "question" && !n.answered) add(n.id, n.label, "answer", "Answer the open question");
    }
    for (const p of placed) { add(p.id, p.label, "add-inside", "Add something inside"); add(p.id, p.label, "connect", "Connect to something related:"); }
    return lines;
  }

  private async publish(now: number): Promise<void> {
    const head = this.d.ledger.headHash();
    if (head === this.lastPublishedHead) return;
    const state = this.state(now);
    // Only segments with new events travel; older days are already in the repository.
    const names = this.d.ledger.dirtySegments();
    await this.d.github.publishLedger([
      ...names.map((n) => ({ path: `ledger/events/${n}.jsonl`, content: this.d.ledger.segmentContent(n) })),
      { path: "ledger/head.json", content: this.d.ledger.headJson() },
      { path: "ledger/state.json", content: serializeState(state) },
      { path: "ledger/questions.json", content: JSON.stringify(buildIndex(state.questions, now), null, 2) + "\n" },
      { path: "ledger/map.json", content: JSON.stringify(buildWorldMap(state.map_files, await this.replicator(), now), null, 1) + "\n" },
    ], `ledger: event ${this.d.ledger.head}`);
    this.d.ledger.markPublished(names);
    this.lastPublishedHead = head;
  }
}

function isRateLimited(e: unknown): boolean {
  const status = (e as { status?: number }).status, msg = String((e as Error).message ?? "");
  return status === 429 || (status === 403 && /rate limit/i.test(msg));
}

/** The public World map; job cards and suggestions link into it. */
const MAP_URL = process.env["NOMICON_MAP_URL"] || "https://nomicon-world.github.io/nomicon/site/map.html";

/** Law 5: an expiry the owner caused, by inaction or by ending bootstrap, holds the fee this long. */
const OWNER_CAUSED_HOLD_DAYS = 365;

/** A voter may change its review this many times during a window and have each change recorded; the final state is always recorded at close. */
const MAX_RECORDED_REVIEWS_PER_VOTER = 10;

export function quoteComment(q: LedgerEvent, laws: Laws, base: string): string {
  const lines = [
    `pr: ${q["pr"]}`, `head: ${q["head"]}`, `layer: ${q["layer"]}`,
    `fee_usdc: ${micro(BigInt(String(q["fee_micro"])))}`, `base_usdc: ${micro(BigInt(String(q["base_micro"])))}`,
    `multiplier: ${q["multiplier"]}`, `concurrency: ${q["concurrency"]}`, `size_kb_charged: ${q["size_kb"]}`,
    `terms_commit: ${q["terms_commit"]}`, `destination: ${q["destination"]}`, `network: ${q["network"] ?? laws.fee.network_caip2}`,
    `pay: ${base.replace(/\/$/, "")}/pay/${q["pr"]}`, `expires: ${iso(Number(q["expires"]))}`,
    `queue_ahead: ${q["queue_ahead"] ?? 0}`, `tax: ${q["tax"] ?? "none"}`, `tax_registration: ${q["tax_registration"] ?? "none"}`,
  ];
  return `Paying this quote accepts TERMS.md at commit ${q["terms_commit"]}, with the owner named in NOTICES.md; the fee is not refunded on rejection and is held on expiry as LAWS.md Law 5 says.\n\n` + "```nomicon-quote\n" + lines.join("\n") + "\n```\nPay within the validity window with USDC on Base via x402 (see agent/PROTOCOL.md). Paying is acceptance of TERMS.md at the commit shown. Verify the destination against CONSTITUTION.md Article 7 before paying.";
}

export function micro(m: bigint): string {
  const s = m.toString().padStart(7, "0");
  return s.slice(0, -6) + "." + s.slice(-6);
}
export function iso(t: number): string { return new Date(t * 1000).toISOString(); }
