// SPDX-License-Identifier: AGPL-3.0-only
// Append-only ledger. Every write that changes status, money, consent or access is recorded here
// (build spec §8, §10.13). The table has no UPDATE or DELETE grants; this package only ever inserts.
// A nightly job archives the day's events to R2 as JSONL with a SHA-256 hash chain.

/** Who did it. The wire format is the `actor` column of `ledger_events`. */
export type Actor =
  | { kind: "user"; userId: string }
  | { kind: "client"; clientId: string }
  /** An agent or API client acting for a signed-in person (MCP, delegated tokens). */
  | { kind: "delegated"; userId: string; clientId: string }
  | { kind: "system"; job: string }
  | { kind: "passport" };

export function formatActor(a: Actor): string {
  switch (a.kind) {
    case "user":
      return `user:${a.userId}`;
    case "client":
      return `client:${a.clientId}`;
    case "delegated":
      return `user:${a.userId}/client:${a.clientId}`;
    case "system":
      return `system:${a.job}`;
    case "passport":
      return "passport";
  }
}

const ID = "[A-Za-z0-9_.:@-]+";
const ACTOR = new RegExp(`^(?:passport|system:(${ID})|user:(${ID})/client:(${ID})|user:(${ID})|client:(${ID}))$`);

export function parseActor(s: string): Actor | null {
  const m = ACTOR.exec(s);
  if (!m) return null;
  if (s === "passport") return { kind: "passport" };
  if (m[1]) return { kind: "system", job: m[1] };
  if (m[2] && m[3]) return { kind: "delegated", userId: m[2], clientId: m[3] };
  if (m[4]) return { kind: "user", userId: m[4] };
  if (m[5]) return { kind: "client", clientId: m[5] };
  return null;
}

export interface LedgerEvent {
  id: string;
  workspaceId: string | null;
  actor: string;
  eventType: string;
  subjectType: string;
  subjectId: string;
  data: Record<string, unknown>;
  /** ISO 8601. */
  occurredAt: string;
}

export interface LedgerEntry {
  workspaceId: string | null;
  actor: Actor;
  /** Dotted, past tense: `application.submitted`, `tranche.released`, `consent.granted`. */
  eventType: string;
  subjectType: string;
  subjectId: string;
  data?: Record<string, unknown>;
}

export interface LedgerQuery {
  workspaceId?: string;
  subjectType?: string;
  subjectId?: string;
  eventType?: string;
  /** Inclusive lower bound, exclusive upper bound (ISO 8601). */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** Persistence port. There is deliberately no update or delete. */
export interface LedgerStore {
  append(event: LedgerEvent): Promise<void>;
  list(query: LedgerQuery): Promise<LedgerEvent[]>;
  count(query: LedgerQuery): Promise<number>;
}

const EVENT_TYPE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/** Names that must never appear as a key anywhere in ledger data (CLAUDE.md: no bank or identity data). */
const FORBIDDEN_KEY = /^(routing|account)[\s_-]*(number|num|no)$|^(s{2}n|d[o]b)$|birth|^iban$|^government[\s_-]*id/i;

function assertNoSensitiveKeys(value: unknown, path = "data", depth = 0): void {
  if (depth > 12 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) return value.forEach((v, i) => assertNoSensitiveKeys(v, `${path}[${i}]`, depth + 1));
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(k)) throw new Error(`ledger data must not carry bank or identity fields (${path}.${k})`);
    assertNoSensitiveKeys(v, `${path}.${k}`, depth + 1);
  }
}

export interface LedgerOptions {
  now?: () => Date;
  newId?: () => string;
}

/**
 * Validate one event and give it its id and time, without storing it. For a caller that writes the
 * event in the same database transaction as the change it records; everyone else uses `record`.
 */
export function ledgerEvent(entry: LedgerEntry, opts: LedgerOptions = {}): LedgerEvent {
  if (!EVENT_TYPE.test(entry.eventType)) throw new Error(`invalid ledger event type: ${entry.eventType}`);
  if (!entry.subjectType || !entry.subjectId) throw new Error("ledger events need a subject");
  const data = entry.data ?? {};
  assertNoSensitiveKeys(data);
  return {
    id: (opts.newId ?? (() => crypto.randomUUID()))(),
    workspaceId: entry.workspaceId,
    actor: formatActor(entry.actor),
    eventType: entry.eventType,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId,
    data,
    occurredAt: (opts.now ?? (() => new Date()))().toISOString(),
  };
}

/** Validate and append one event. Returns the stored event so callers can fan it out to webhooks. */
export async function record(store: LedgerStore, entry: LedgerEntry, opts: LedgerOptions = {}): Promise<LedgerEvent> {
  const event = ledgerEvent(entry, opts);
  await store.append(event);
  return event;
}

function matches(e: LedgerEvent, q: LedgerQuery): boolean {
  return (
    (q.workspaceId === undefined || e.workspaceId === q.workspaceId) &&
    (q.subjectType === undefined || e.subjectType === q.subjectType) &&
    (q.subjectId === undefined || e.subjectId === q.subjectId) &&
    (q.eventType === undefined || e.eventType === q.eventType) &&
    (q.from === undefined || e.occurredAt >= q.from) &&
    (q.to === undefined || e.occurredAt < q.to)
  );
}

export class MemoryLedgerStore implements LedgerStore {
  readonly events: LedgerEvent[] = [];

  async append(event: LedgerEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }

  async list(q: LedgerQuery): Promise<LedgerEvent[]> {
    const all = this.events.filter((e) => matches(e, q)).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const offset = q.offset ?? 0;
    return all.slice(offset, offset + (q.limit ?? all.length)).map((e) => structuredClone(e));
  }

  async count(q: LedgerQuery): Promise<number> {
    return this.events.filter((e) => matches(e, q)).length;
  }
}

export interface LedgerRow {
  id: string;
  workspace_id: string | null;
  actor: string;
  event_type: string;
  subject_type: string;
  subject_id: string;
  data: Record<string, unknown>;
  occurred_at: string;
}

/** The slice of a Supabase client this store uses; `@supabase/supabase-js` satisfies it. */
export interface LedgerDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural stand-in for the PostgREST query builder
  from(table: "ledger_events"): any;
}

/** An event as a `ledger_events` row, for a database function that writes it in its own transaction. */
export const ledgerRow = (e: LedgerEvent): LedgerRow => ({ id: e.id, workspace_id: e.workspaceId, actor: e.actor, event_type: e.eventType, subject_type: e.subjectType, subject_id: e.subjectId, data: e.data, occurred_at: e.occurredAt });

const toEvent = (r: LedgerRow): LedgerEvent => ({
  id: r.id,
  workspaceId: r.workspace_id,
  actor: r.actor,
  eventType: r.event_type,
  subjectType: r.subject_type,
  subjectId: r.subject_id,
  data: r.data ?? {},
  occurredAt: new Date(r.occurred_at).toISOString(),
});

export class SupabaseLedgerStore implements LedgerStore {
  constructor(private readonly db: LedgerDb) {}

  async append(e: LedgerEvent): Promise<void> {
    const { error } = await this.db.from("ledger_events").insert(ledgerRow(e));
    if (error) throw new Error(`ledger append failed: ${error.message}`);
  }

  private filtered(select: string, q: LedgerQuery, opts?: { count: "exact"; head: true }) {
    let b = this.db.from("ledger_events").select(select, opts);
    if (q.workspaceId !== undefined) b = b.eq("workspace_id", q.workspaceId);
    if (q.subjectType !== undefined) b = b.eq("subject_type", q.subjectType);
    if (q.subjectId !== undefined) b = b.eq("subject_id", q.subjectId);
    if (q.eventType !== undefined) b = b.eq("event_type", q.eventType);
    if (q.from !== undefined) b = b.gte("occurred_at", q.from);
    if (q.to !== undefined) b = b.lt("occurred_at", q.to);
    return b;
  }

  async list(q: LedgerQuery): Promise<LedgerEvent[]> {
    const offset = q.offset ?? 0;
    const limit = q.limit ?? 1000;
    const { data, error } = await this.filtered("*", q)
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(`ledger read failed: ${error.message}`);
    return (data as LedgerRow[]).map(toEvent);
  }

  async count(q: LedgerQuery): Promise<number> {
    const { count, error } = await this.filtered("id", q, { count: "exact", head: true });
    if (error) throw new Error(`ledger count failed: ${error.message}`);
    return count ?? 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Archive: JSONL with a hash chain. Each line is `{ ...event, prevHash, hash }` where
// `hash = SHA-256(prevHash + "\n" + canonicalJson(event))`. The first line of an archive chains
// from the last hash of the previous archive, so removing or editing any line breaks every hash
// after it.
// ---------------------------------------------------------------------------------------------

export const GENESIS_HASH = "0".repeat(64);

/** JSON with object keys sorted, so the same event always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const chainHash = (prevHash: string, event: LedgerEvent): Promise<string> => sha256Hex(`${prevHash}\n${canonicalJson(event)}`);

export interface ArchivedLine extends LedgerEvent {
  prevHash: string;
  hash: string;
}

export async function buildArchive(events: LedgerEvent[], prevHash = GENESIS_HASH): Promise<{ jsonl: string; lastHash: string; count: number }> {
  const lines: string[] = [];
  let prev = prevHash;
  for (const event of events) {
    const hash = await chainHash(prev, event);
    lines.push(canonicalJson({ ...event, prevHash: prev, hash } satisfies ArchivedLine));
    prev = hash;
  }
  return { jsonl: lines.length ? lines.join("\n") + "\n" : "", lastHash: prev, count: lines.length };
}

export type ArchiveVerification = { ok: true; lastHash: string; count: number } | { ok: false; line: number; reason: string };

export async function verifyArchive(jsonl: string, prevHash = GENESIS_HASH): Promise<ArchiveVerification> {
  let prev = prevHash;
  const lines = jsonl.split("\n").filter((l) => l.length > 0);
  for (const [i, raw] of lines.entries()) {
    let parsed: ArchivedLine;
    try {
      parsed = JSON.parse(raw) as ArchivedLine;
    } catch {
      return { ok: false, line: i + 1, reason: "not JSON" };
    }
    const { prevHash: p, hash, ...event } = parsed;
    if (p !== prev) return { ok: false, line: i + 1, reason: "prevHash does not match the previous line" };
    if ((await chainHash(prev, event)) !== hash) return { ok: false, line: i + 1, reason: "hash does not match the event" };
    prev = hash;
  }
  return { ok: true, lastHash: prev, count: lines.length };
}

/** The slice of an R2 bucket the archiver needs. */
export interface ArchiveBucket {
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
}

export interface ArchiveResult {
  key: string;
  count: number;
  prevHash: string;
  lastHash: string;
}

const PAGE = 1000;

/**
 * Archive one UTC day (`YYYY-MM-DD`) to `ledger/YYYY/MM/DD.jsonl`. The caller passes the previous
 * archive's `lastHash` and stores the returned one for the next run. Re-running a day rewrites the
 * same key with the same content.
 */
export async function archiveDay(store: LedgerStore, bucket: ArchiveBucket, day: string, prevHash = GENESIS_HASH): Promise<ArchiveResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("day must be YYYY-MM-DD");
  const from = `${day}T00:00:00.000Z`;
  const to = new Date(Date.parse(from) + 86_400_000).toISOString();
  const events: LedgerEvent[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await store.list({ from, to, limit: PAGE, offset });
    events.push(...page);
    if (page.length < PAGE) break;
  }
  const { jsonl, lastHash, count } = await buildArchive(events, prevHash);
  const key = `ledger/${day.slice(0, 4)}/${day.slice(5, 7)}/${day.slice(8, 10)}.jsonl`;
  await bucket.put(key, jsonl, { httpMetadata: { contentType: "application/x-ndjson" }, customMetadata: { prevHash, lastHash, count: String(count) } });
  return { key, count, prevHash, lastHash };
}
