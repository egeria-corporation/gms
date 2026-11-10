// SPDX-License-Identifier: AGPL-3.0-only
// Outbound webhooks (build spec §9): fan-out to subscriptions, HMAC-SHA256 signing, retries with
// exponential backoff for 24 hours. Subscription secrets are stored encrypted (AES-GCM) under
// WEBHOOK_SECRET_KEY and only decrypted at the moment of signing.

export const WEBHOOK_EVENT_TYPES = [
  "application.submitted",
  "application.status.changed",
  "review.submitted",
  "decision.committed",
  "award.created",
  "award.status.changed",
  "agreement.executed",
  "tranche.due",
  "tranche.status.changed",
  "disbursement.status.changed",
  "requirement.due",
  "submission.received",
  "submission.accepted",
  "org.change.pending",
  "approval.requested",
  "approval.resolved",
  "opportunity.published",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
export const isWebhookEventType = (s: string): s is WebhookEventType => (WEBHOOK_EVENT_TYPES as readonly string[]).includes(s);

export const SIGNATURE_HEADER = "X-GMS-Signature";
export const TIMESTAMP_HEADER = "X-GMS-Timestamp";
export const EVENT_HEADER = "X-GMS-Event";
export const DELIVERY_HEADER = "X-GMS-Delivery";
/** Receivers should reject timestamps further than this from their clock (replay window). */
export const DEFAULT_TOLERANCE_SEC = 300;

export interface WebhookEvent<T = unknown> {
  /** Stable across retries; receivers dedupe on it. */
  id: string;
  type: WebhookEventType;
  workspaceId: string;
  occurredAt: string;
  data: T;
}

// ---- encoding helpers ------------------------------------------------------------------------

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function timingSafeEqual(a: string, b: string): boolean {
  const ea = enc.encode(a);
  const eb = enc.encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

// ---- signing ---------------------------------------------------------------------------------

export const generateWebhookSecret = (): string => `whsec_${b64urlEncode(crypto.getRandomValues(new Uint8Array(32)))}`;

/** `v1=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>`. The timestamp is Unix seconds. */
export async function signPayload(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${body}`));
  return `v1=${hex(new Uint8Array(mac))}`;
}

export interface VerifyInput {
  secret: string;
  /** The raw request body, exactly as received. */
  body: string;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  now?: Date;
  toleranceSec?: number;
}

export type VerifyResult = { ok: true } | { ok: false; reason: "missing_headers" | "bad_timestamp" | "stale" | "bad_signature" };

/** What a receiver runs. Exported so funders' integrations and our own tests share one implementation. */
export async function verifySignature(input: VerifyInput): Promise<VerifyResult> {
  if (!input.signature || !input.timestamp) return { ok: false, reason: "missing_headers" };
  if (!/^\d{1,12}$/.test(input.timestamp)) return { ok: false, reason: "bad_timestamp" };
  const ts = Number(input.timestamp);
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - ts) > (input.toleranceSec ?? DEFAULT_TOLERANCE_SEC)) return { ok: false, reason: "stale" };
  const expected = await signPayload(input.secret, ts, input.body);
  // A header may carry several signatures during secret rotation.
  const candidates = input.signature.split(",").map((s) => s.trim());
  return candidates.some((c) => timingSafeEqual(c, expected)) ? { ok: true } : { ok: false, reason: "bad_signature" };
}

// ---- secret encryption at rest ---------------------------------------------------------------

async function importAesKey(keyB64url: string): Promise<CryptoKey> {
  const raw = b64urlDecode(keyB64url);
  if (raw.length !== 32) throw new Error("WEBHOOK_SECRET_KEY must be 32 bytes, base64url");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** `v1.<iv>.<ciphertext>`, both base64url. A fresh 96-bit IV per value. */
export async function encryptSecret(plaintext: string, keyB64url: string): Promise<string> {
  const key = await importAesKey(keyB64url);
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return `v1.${b64urlEncode(iv)}.${b64urlEncode(new Uint8Array(ct))}`;
}

export async function decryptSecret(stored: string, keyB64url: string): Promise<string> {
  const [v, iv, ct] = stored.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("unrecognized encrypted secret format");
  const key = await importAesKey(keyB64url);
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64urlDecode(iv) }, key, b64urlDecode(ct)));
}

// ---- retry schedule --------------------------------------------------------------------------

/** Delay before attempt n+1 after attempt n fails: 1m, 5m, 15m, 1h, 2h, 4h, 8h, then 8h 39m (24h in total). */
export const BACKOFF_SCHEDULE_SEC = [60, 300, 900, 3600, 7200, 14400, 28800, 31140] as const;
export const MAX_ATTEMPTS = BACKOFF_SCHEDULE_SEC.length + 1;
export const RETRY_WINDOW_SEC = BACKOFF_SCHEDULE_SEC.reduce((a, b) => a + b, 0);

/** When to try again after `attempt` (1-based) failed, or null when the delivery is exhausted. */
export function nextAttemptAt(attempt: number, failedAt: Date): Date | null {
  const delay = BACKOFF_SCHEDULE_SEC[attempt - 1];
  return delay === undefined ? null : new Date(failedAt.getTime() + delay * 1000);
}

// ---- subscriptions and deliveries ------------------------------------------------------------

export interface WebhookSubscription {
  id: string;
  workspaceId: string;
  url: string;
  /** Empty means every event type. */
  eventTypes: string[];
  secretEnc: string;
  active: boolean;
}

export type DeliveryStatus = "pending" | "delivered" | "failed" | "exhausted";

export interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  eventId: string;
  eventType: string;
  /** The exact JSON body that is signed and sent on every attempt. */
  payload: string;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface WebhookStore {
  listSubscriptions(workspaceId: string): Promise<WebhookSubscription[]>;
  getSubscription(id: string): Promise<WebhookSubscription | null>;
  insertDelivery(d: WebhookDelivery): Promise<void>;
  getDelivery(id: string): Promise<WebhookDelivery | null>;
  updateDelivery(id: string, patch: Partial<WebhookDelivery>): Promise<void>;
  /** Deliveries that are `pending` or `failed` with `nextAttemptAt <= now`. */
  listDue(now: string, limit: number): Promise<WebhookDelivery[]>;
}

export class MemoryWebhookStore implements WebhookStore {
  readonly subscriptions: WebhookSubscription[] = [];
  readonly deliveries: WebhookDelivery[] = [];

  async listSubscriptions(workspaceId: string) {
    return this.subscriptions.filter((s) => s.workspaceId === workspaceId);
  }
  async getSubscription(id: string) {
    return this.subscriptions.find((s) => s.id === id) ?? null;
  }
  async insertDelivery(d: WebhookDelivery) {
    this.deliveries.push({ ...d });
  }
  async getDelivery(id: string) {
    const d = this.deliveries.find((x) => x.id === id);
    return d ? { ...d } : null;
  }
  async updateDelivery(id: string, patch: Partial<WebhookDelivery>) {
    const d = this.deliveries.find((x) => x.id === id);
    if (d) Object.assign(d, patch);
  }
  async listDue(now: string, limit: number) {
    return this.deliveries
      .filter((d) => (d.status === "pending" || d.status === "failed") && d.nextAttemptAt !== null && d.nextAttemptAt <= now)
      .slice(0, limit)
      .map((d) => ({ ...d }));
  }
}

/** The slice of a Supabase client this store uses. */
export interface WebhookDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural stand-in for the PostgREST query builder
  from(table: "webhook_subscriptions" | "webhook_deliveries"): any;
}

/** `webhook_subscriptions` (supabase/migrations/0007). */
interface SubscriptionRow {
  id: string;
  workspace_id: string;
  url: string;
  events: string[] | null;
  secret_enc: string;
  active: boolean;
}

/** `webhook_deliveries` (0007 + 0010). `payload` is jsonb; `attempt` counts attempts made so far. */
interface DeliveryRow {
  id: string;
  workspace_id: string;
  subscription_id: string;
  event_id: string;
  event: string;
  payload: unknown;
  status: DeliveryStatus;
  attempt: number;
  next_attempt_at: string | null;
  status_code: number | null;
  last_error: string | null;
  delivered_at: string | null;
  created_at: string;
}

const toSubscription = (r: SubscriptionRow): WebhookSubscription => ({
  id: r.id,
  workspaceId: r.workspace_id,
  url: r.url,
  eventTypes: r.events ?? [],
  secretEnc: r.secret_enc,
  active: r.active,
});

const toDelivery = (r: DeliveryRow): WebhookDelivery => ({
  id: r.id,
  subscriptionId: r.subscription_id,
  eventId: r.event_id,
  eventType: r.event,
  // The body is signed when it is sent, so re-serializing the stored JSON is safe.
  payload: typeof r.payload === "string" ? r.payload : JSON.stringify(r.payload),
  status: r.status,
  attempts: r.attempt,
  nextAttemptAt: r.next_attempt_at,
  lastStatusCode: r.status_code,
  lastError: r.last_error,
  deliveredAt: r.delivered_at,
  createdAt: r.created_at,
});

const DELIVERY_COLUMNS: Record<keyof WebhookDelivery, keyof DeliveryRow> = {
  id: "id",
  subscriptionId: "subscription_id",
  eventId: "event_id",
  eventType: "event",
  payload: "payload",
  status: "status",
  attempts: "attempt",
  nextAttemptAt: "next_attempt_at",
  lastStatusCode: "status_code",
  lastError: "last_error",
  deliveredAt: "delivered_at",
  createdAt: "created_at",
};

function toRow(patch: Partial<WebhookDelivery>): Partial<DeliveryRow> {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === "payload") row.payload = JSON.parse(v as string) as unknown;
    else if (k === "lastError") row.last_error = typeof v === "string" ? v.slice(0, 500) : v;
    else row[DELIVERY_COLUMNS[k as keyof WebhookDelivery]] = v;
  }
  return row as Partial<DeliveryRow>;
}

export class SupabaseWebhookStore implements WebhookStore {
  constructor(private readonly db: WebhookDb) {}

  private static check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
    if (res.error) throw new Error(`${what} failed: ${res.error.message}`);
    return res.data;
  }

  async listSubscriptions(workspaceId: string) {
    const rows = SupabaseWebhookStore.check<SubscriptionRow[]>(await this.db.from("webhook_subscriptions").select("*").eq("workspace_id", workspaceId), "subscription list");
    return rows.map(toSubscription);
  }
  async getSubscription(id: string) {
    const row = SupabaseWebhookStore.check<SubscriptionRow | null>(await this.db.from("webhook_subscriptions").select("*").eq("id", id).maybeSingle(), "subscription read");
    return row ? toSubscription(row) : null;
  }
  async insertDelivery(d: WebhookDelivery) {
    // A delivery row carries its workspace (RLS and the workspace's delivery log read it from there).
    const sub = await this.getSubscription(d.subscriptionId);
    if (!sub) throw new Error("delivery insert failed: unknown subscription");
    SupabaseWebhookStore.check(await this.db.from("webhook_deliveries").insert({ ...toRow(d), workspace_id: sub.workspaceId }), "delivery insert");
  }
  async getDelivery(id: string) {
    const row = SupabaseWebhookStore.check<DeliveryRow | null>(await this.db.from("webhook_deliveries").select("*").eq("id", id).maybeSingle(), "delivery read");
    return row ? toDelivery(row) : null;
  }
  async updateDelivery(id: string, patch: Partial<WebhookDelivery>) {
    SupabaseWebhookStore.check(await this.db.from("webhook_deliveries").update(toRow(patch)).eq("id", id), "delivery update");
  }
  async listDue(now: string, limit: number) {
    const rows = SupabaseWebhookStore.check<DeliveryRow[]>(
      await this.db.from("webhook_deliveries").select("*").in("status", ["pending", "failed"]).lte("next_attempt_at", now).order("next_attempt_at", { ascending: true }).limit(limit),
      "due delivery list",
    );
    return rows.map(toDelivery);
  }
}

// ---- fan-out and delivery --------------------------------------------------------------------

export interface DeliveryDeps {
  store: WebhookStore;
  /** WEBHOOK_SECRET_KEY. */
  secretKey: string;
  fetch?: typeof fetch;
  now?: () => Date;
  newId?: () => string;
  timeoutMs?: number;
}

const wants = (s: WebhookSubscription, type: string) => s.active && (s.eventTypes.length === 0 || s.eventTypes.includes(type));

/** Only HTTPS endpoints (plain HTTP is tolerated for localhost so self-hosters can develop). */
export function isDeliverableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"));
  } catch {
    return false;
  }
}

/**
 * Create one pending delivery per matching subscription. The API calls this inside the request and
 * enqueues the returned ids on GMS_EVENTS; the jobs Worker calls `attemptDelivery` for each.
 */
export async function fanOut(event: WebhookEvent, deps: Pick<DeliveryDeps, "store" | "now" | "newId">): Promise<WebhookDelivery[]> {
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const payload = JSON.stringify(event);
  const created: WebhookDelivery[] = [];
  for (const sub of await deps.store.listSubscriptions(event.workspaceId)) {
    if (!wants(sub, event.type)) continue;
    const delivery: WebhookDelivery = {
      id: (deps.newId ?? (() => crypto.randomUUID()))(),
      subscriptionId: sub.id,
      eventId: event.id,
      eventType: event.type,
      payload,
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      lastStatusCode: null,
      lastError: null,
      deliveredAt: null,
      createdAt: now,
    };
    await deps.store.insertDelivery(delivery);
    created.push(delivery);
  }
  return created;
}

/** One HTTP attempt. Updates the delivery row and returns its new state. */
export async function attemptDelivery(deliveryId: string, deps: DeliveryDeps): Promise<WebhookDelivery | null> {
  const delivery = await deps.store.getDelivery(deliveryId);
  if (!delivery || delivery.status === "delivered" || delivery.status === "exhausted") return delivery;
  const sub = await deps.store.getSubscription(delivery.subscriptionId);
  const now = (deps.now ?? (() => new Date()))();
  const attempts = delivery.attempts + 1;

  const fail = async (statusCode: number | null, error: string): Promise<WebhookDelivery> => {
    const next = nextAttemptAt(attempts, now);
    const patch: Partial<WebhookDelivery> = {
      attempts,
      status: next ? "failed" : "exhausted",
      nextAttemptAt: next ? next.toISOString() : null,
      lastStatusCode: statusCode,
      lastError: error.slice(0, 500),
    };
    await deps.store.updateDelivery(delivery.id, patch);
    return { ...delivery, ...patch };
  };

  if (!sub || !sub.active) {
    const patch: Partial<WebhookDelivery> = { status: "exhausted", nextAttemptAt: null, lastError: "subscription removed or paused" };
    await deps.store.updateDelivery(delivery.id, patch);
    return { ...delivery, ...patch };
  }
  if (!isDeliverableUrl(sub.url)) return fail(null, "endpoint must be https");

  const timestamp = Math.floor(now.getTime() / 1000);
  let signature: string;
  try {
    signature = await signPayload(await decryptSecret(sub.secretEnc, deps.secretKey), timestamp, delivery.payload);
  } catch {
    return fail(null, "could not sign: subscription secret is unreadable");
  }

  try {
    const res = await (deps.fetch ?? fetch)(sub.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "OpenGrants-GMS-Webhooks/1",
        [SIGNATURE_HEADER]: signature,
        [TIMESTAMP_HEADER]: String(timestamp),
        [EVENT_HEADER]: delivery.eventType,
        [DELIVERY_HEADER]: delivery.id,
      },
      body: delivery.payload,
      redirect: "manual",
      signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
    });
    if (res.status >= 200 && res.status < 300) {
      const patch: Partial<WebhookDelivery> = { attempts, status: "delivered", nextAttemptAt: null, lastStatusCode: res.status, lastError: null, deliveredAt: now.toISOString() };
      await deps.store.updateDelivery(delivery.id, patch);
      return { ...delivery, ...patch };
    }
    return fail(res.status, `endpoint answered ${res.status}`);
  } catch (err) {
    return fail(null, err instanceof Error ? err.name : "network error");
  }
}

/** Cron sweep: retry everything that is due. */
export async function deliverDue(deps: DeliveryDeps, limit = 100): Promise<WebhookDelivery[]> {
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const out: WebhookDelivery[] = [];
  for (const d of await deps.store.listDue(now, limit)) {
    const r = await attemptDelivery(d.id, deps);
    if (r) out.push(r);
  }
  return out;
}
