/**
 * Article 11: the append-only, signed ledger. Canonical JSON (sorted keys,
 * no whitespace, bigints as decimal strings) is what gets signed.
 */
import { createHash, sign as edSign, verify as edVerify, createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";

export type EventType =
  | "genesis" | "intake_reject" | "screen_hold" | "hold_resolved" | "quote" | "quote_lapsed" | "payment" | "vote_open" | "review"
  | "vote_close" | "merge" | "withdrawal" | "expiry" | "owner_confirm" | "owner_reject" | "fee_adjust"
  | "takedown" | "redaction" | "patch" | "deploy" | "destination_change" | "agent_account_change" | "screen_deferred" | "vote_queued" | "key_rotation" | "merge_deferred" | "bar_lifted" | "owner_accounts_change" | "declare" | "correction" | "refusal"
  | "laws_snapshot" | "owner_action_applied" | "channel" | "notice" | "digest" | "world_direct";

export interface LedgerEvent {
  id: number;
  at: number;
  type: EventType;
  sig?: string;
  [k: string]: unknown;
}

export function canonical(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const keys = Object.keys(value as object).filter((k) => k !== "sig" && (value as Record<string, unknown>)[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical((value as Record<string, unknown>)[k])).join(",") + "}";
}

export function eventHash(e: LedgerEvent): string {
  return createHash("sha256").update(canonical(e)).digest("hex");
}

export class Signer {
  private key: KeyObject;
  constructor(privateKeyPem: string) { this.key = createPrivateKey(privateKeyPem); }
  publicKeyPem(): string { return createPublicKey(this.key).export({ type: "spki", format: "pem" }) as string; }
  sign(e: LedgerEvent): string { return edSign(null, Buffer.from(canonical(e)), this.key).toString("base64"); }
}

/** Article 11: days an announced replacement for a lost key must wait before the new key may sign. */
export const ROTATION_WAIT_DAYS = 14;

const normPem = (s: string) => s.replace(/\r/g, "").trim();
export function samePem(a: string, b: string): boolean { return normPem(a) === normPem(b); }

/** The signing key in force after these events, following rotations from the key named in the Constitution. */
export function keyInForce(events: LedgerEvent[], initialPem: string): string {
  let current = initialPem;
  for (const e of events) if (e.type === "key_rotation" && typeof e["new_public_key"] === "string") current = e["new_public_key"];
  return current;
}

/**
 * Verify every signature, following the chain of rotations: a rotation is
 * signed by the key in force, or, after a lost key, by the new key itself
 * no sooner than ROTATION_WAIT_DAYS after the announcement it cites.
 */
export function verifyLedgerSignatures(events: LedgerEvent[], initialPem: string): Array<{ event: number; problem: string }> {
  const findings: Array<{ event: number; problem: string }> = [];
  let current = initialPem, lastPlannedRotationAt = 0;
  for (const e of events) {
    if (e.type === "key_rotation") {
      const next = typeof e["new_public_key"] === "string" ? e["new_public_key"] : "";
      if (!next.includes("BEGIN PUBLIC KEY")) { findings.push({ event: e.id, problem: "key rotation names no public key" }); continue; }
      if (e["lost"] === true) {
        // Article 11: announced by a transaction from the fee destination; its block time is the clock; a planned rotation in the meantime prevails.
        if (typeof e["tx"] !== "string") findings.push({ event: e.id, problem: "rotation after a lost key cites no announcing transaction" });
        if (!(e.at - Number(e["announced_at"]) >= ROTATION_WAIT_DAYS * 86400)) findings.push({ event: e.id, problem: `rotation after a lost key sooner than ${ROTATION_WAIT_DAYS} days after its announcement` });
        if (lastPlannedRotationAt > Number(e["announced_at"])) findings.push({ event: e.id, problem: "a rotation by the key in force followed the announcement; the lost-key rotation does not stand" });
        if (!verifyEvent(e, next)) findings.push({ event: e.id, problem: "rotation after a lost key not signed by the new key" });
      } else {
        if (!verifyEvent(e, current)) findings.push({ event: e.id, problem: "rotation not signed by the key in force" });
        lastPlannedRotationAt = e.at;
      }
      current = next;
      continue;
    }
    if (!verifyEvent(e, current)) findings.push({ event: e.id, problem: "bad or missing signature" });
  }
  return findings;
}

export function verifyEvent(e: LedgerEvent, publicKeyPem: string): boolean {
  if (!e.sig) return false;
  return edVerify(null, Buffer.from(canonical(e)), createPublicKey(publicKeyPem), Buffer.from(e.sig, "base64"));
}

/** Serialise one event for a segment file: bigints as strings. */
export function serialize(e: LedgerEvent): string {
  return JSON.stringify(e, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

/** Parse one segment; ids must continue from `after`. */
export function parseEvents(text: string, after = 0): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    out.push(JSON.parse(line) as LedgerEvent);
  }
  for (let i = 0; i < out.length; i++) if (out[i]!.id !== after + i + 1) throw new Error(`ledger event ${after + i + 1} has id ${out[i]!.id}`);
  return out;
}

/** UTC day of a timestamp: the name of the segment the event belongs in. */
export function segmentOf(at: number): string {
  return new Date(at * 1000).toISOString().slice(0, 10);
}

export interface LedgerHead { version: 1; head_event: number; head_hash: string; segment: string | null; updated_at: number }

const SEGMENT = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

function segmentNames(segDir: string): string[] {
  return existsSync(segDir) ? readdirSync(segDir).filter((n) => SEGMENT.test(n)).sort() : [];
}

/**
 * Read a ledger directory: every daily segment under events/ in order, ids
 * continuous across files and each event in the file of its own day. A
 * directory that still holds the old single events.jsonl is read as that
 * file; one that holds both is refused.
 */
export function readLedgerDir(dir: string): LedgerEvent[] {
  const segDir = join(dir, "events"), legacy = join(dir, "events.jsonl");
  const names = segmentNames(segDir);
  if (names.length && existsSync(legacy)) throw new Error(`${dir} holds both events/ and events.jsonl; run \`nomicon migrate-ledger\``);
  if (!names.length) return existsSync(legacy) ? parseEvents(readFileSync(legacy, "utf8")) : [];
  const out: LedgerEvent[] = [];
  for (const n of names) {
    const day = n.slice(0, 10);
    for (const e of parseEvents(readFileSync(join(segDir, n), "utf8"), out.length)) {
      if (segmentOf(e.at) !== day) throw new Error(`ledger event ${e.id} is in segment ${day} but belongs to ${segmentOf(e.at)}`);
      out.push(e);
    }
  }
  return out;
}

/**
 * The ledger on disk: ledger/events/YYYY-MM-DD.jsonl, one file per UTC day,
 * plus ledger/head.json naming the latest event. Appends are exclusive
 * across processes (the owner's commands and the agent share one ledger).
 */
export class Ledger {
  readonly events: LedgerEvent[] = [];
  private running = createHash("sha256");
  private dirty = new Set<string>();
  private lastSegmentStart = 0;
  /** `initialPem` is the key named in the Constitution; rotations are followed from it. Defaults to the signer's own key. */
  constructor(readonly dir: string, private signer?: Signer, private initialPem?: string) {
    for (const e of readLedgerDir(dir)) this.adopt(e);
  }
  get head(): number { return this.events.length; }
  /** After a rotation, sign with the new key. */
  setSigner(signer: Signer): void { this.signer = signer; }
  private segmentPath(name: string): string { return join(this.dir, "events", name + ".jsonl"); }

  private adopt(e: LedgerEvent): void {
    const last = this.events[this.events.length - 1];
    if (!last || segmentOf(e.at) !== segmentOf(last.at)) this.lastSegmentStart = this.events.length;
    this.events.push(e);
    this.running.update(eventHash(e));
    this.dirty.add(segmentOf(e.at));
  }

  /**
   * Adopt events another process appended. Only the segment holding the last
   * known event and any newer segments are read; what is already in memory
   * must match the disk exactly, and the disk must extend memory.
   */
  reload(): number {
    if (this.events.length === 0) { for (const e of readLedgerDir(this.dir)) this.adopt(e); return this.events.length; }
    const segDir = join(this.dir, "events");
    if (existsSync(join(this.dir, "events.jsonl")) && segmentNames(segDir).length === 0) {
      const onDisk = readLedgerDir(this.dir);
      return this.adoptExtension(onDisk, 0);
    }
    const from = segmentOf(this.events[this.lastSegmentStart]!.at);
    let idx = this.lastSegmentStart, added = 0;
    for (const n of segmentNames(segDir).filter((n) => n.slice(0, 10) >= from)) {
      const day = n.slice(0, 10);
      const parsed = parseEvents(readFileSync(join(segDir, n), "utf8"), idx);
      for (const e of parsed) if (segmentOf(e.at) !== day) throw new Error(`ledger event ${e.id} is in segment ${day} but belongs to ${segmentOf(e.at)}`);
      added += this.adoptExtension(parsed, idx);
      idx += parsed.length;
    }
    if (idx < this.events.length) throw new Error(`ledger on disk has ${idx} events but memory has ${this.events.length}`);
    return added;
  }

  /** Events `onDisk` are those at memory indexes `offset`...; verify the overlap, adopt the rest. */
  private adoptExtension(onDisk: LedgerEvent[], offset: number): number {
    let added = 0;
    for (let i = 0; i < onDisk.length; i++) {
      const idx = offset + i, e = onDisk[i]!;
      if (idx < this.events.length) { if (eventHash(e) !== eventHash(this.events[idx]!)) throw new Error(`ledger event ${e.id} differs on disk`); }
      else { this.adopt(e); added++; }
    }
    return added;
  }

  /** Exclusive advisory lock on <dir>/events.lock, so two processes never append at once. */
  private withLock<T>(fn: () => T): T {
    const lock = join(this.dir, "events.lock");
    const deadline = Date.now() + 10_000;
    for (;;) {
      try { const fd = openSync(lock, "wx"); writeSync(fd, `${process.pid} ${new Date().toISOString()}`); closeSync(fd); break; }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        // A lock older than a minute belongs to a process that died holding it; an append takes milliseconds.
        try { if (Date.now() - statSync(lock).mtimeMs > 60_000) { unlinkSync(lock); continue; } } catch { /* raced */ }
        if (Date.now() > deadline) throw new Error("ledger lock held for more than 10 seconds: " + lock);
        const until = Date.now() + 50; while (Date.now() < until) { /* spin briefly */ }
      }
    }
    try { return fn(); } finally { try { unlinkSync(lock); } catch { /* already gone */ } }
  }

  /** Append, sign, write to the segment of the event's day, update head.json. Returns the stored event. */
  append(at: number, type: EventType, fields: Record<string, unknown>): LedgerEvent {
    return this.withLock(() => {
      if (existsSync(join(this.dir, "events.jsonl"))) throw new Error("ledger/events.jsonl is the old single-file ledger; run `nomicon migrate-ledger` first");
      this.reload();
      // Article 11: only the key in force signs. A rotation recorded by another process stops this one here, not after a stray signature.
      if (this.signer && !samePem(keyInForce(this.events, this.initialPem ?? this.signer.publicKeyPem()), this.signer.publicKeyPem())) {
        throw new Error("the configured signing key is not the ledger key in force (Article 11); configure the key the ledger names and restart");
      }
      const last = this.events[this.events.length - 1];
      if (last && at < last.at) at = last.at; // one ledger, one clock: time does not run backwards across segments
      const e: LedgerEvent = { id: this.head + 1, at, type, ...fields };
      if (this.signer) e.sig = this.signer.sign(e);
      mkdirSync(join(this.dir, "events"), { recursive: true });
      appendFileSync(this.segmentPath(segmentOf(at)), serialize(e) + "\n", "utf8");
      this.adopt(e);
      writeFileSync(join(this.dir, "head.json"), this.headJson(), "utf8");
      return e;
    });
  }

  /** SHA-256 over the hashes of every event in order, kept incrementally. */
  headHash(): string { return this.running.copy().digest("hex"); }

  headJson(): string {
    const last = this.events[this.events.length - 1];
    const head: LedgerHead = { version: 1, head_event: this.head, head_hash: this.headHash(), segment: last ? segmentOf(last.at) : null, updated_at: last?.at ?? 0 };
    return JSON.stringify(head, null, 2) + "\n";
  }

  /** Segments with events not yet published, oldest first. */
  dirtySegments(): string[] { return [...this.dirty].sort(); }
  markPublished(names: string[]): void { for (const n of names) this.dirty.delete(n); }
  segmentContent(name: string): string {
    const start = name === segmentOf(this.events[this.lastSegmentStart]?.at ?? 0) ? this.lastSegmentStart : 0;
    const lines: string[] = [];
    for (let i = start; i < this.events.length; i++) { const e = this.events[i]!; if (segmentOf(e.at) === name) lines.push(serialize(e)); }
    return lines.join("\n") + (lines.length ? "\n" : "");
  }

  /** Split the old single events.jsonl into daily segments and head.json. Returns the number of events moved. */
  static migrate(dir: string): number {
    const legacy = join(dir, "events.jsonl");
    if (!existsSync(legacy)) throw new Error(`${legacy} does not exist; nothing to migrate`);
    if (segmentNames(join(dir, "events")).length) throw new Error(`${dir}/events already holds segments; refusing to mix`);
    const events = parseEvents(readFileSync(legacy, "utf8"));
    mkdirSync(join(dir, "events"), { recursive: true });
    const byDay = new Map<string, string[]>();
    for (const e of events) { const d = segmentOf(e.at); byDay.set(d, [...(byDay.get(d) ?? []), serialize(e)]); }
    for (const [d, lines] of byDay) writeFileSync(join(dir, "events", d + ".jsonl"), lines.join("\n") + "\n", "utf8");
    unlinkSync(legacy);
    const led = new Ledger(dir);
    writeFileSync(join(dir, "head.json"), led.headJson(), "utf8");
    return events.length;
  }
}
