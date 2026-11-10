// SPDX-License-Identifier: AGPL-3.0-only
// Inbound Passport webhooks. Passport signs `"<timestamp>.<body>"` with HMAC-SHA256 under the
// subscription secret and sends `X-Passport-Signature: v1=<hex>` and `X-Passport-Timestamp: <unix seconds>`.
import { PASSPORT_EVENTS, type PassportEvent, type PassportEventType } from "./types.ts";

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function signPassportPayload(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `v1=${hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${body}`)))}`;
}

export interface VerifyOptions {
  now?: Date;
  /** Reject deliveries whose timestamp is further than this from now. Default 300 s. */
  toleranceSec?: number;
}

export async function verifyPassportSignature(secret: string, signature: string | null | undefined, timestamp: string | null | undefined, body: string, opts: VerifyOptions = {}): Promise<boolean> {
  if (!signature || !timestamp) return false;
  const ts = Number(timestamp);
  if (!Number.isInteger(ts)) return false;
  const now = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - ts) > (opts.toleranceSec ?? 300)) return false;
  const expected = await signPassportPayload(secret, ts, body);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export type ParsedWebhook = { ok: true; event: PassportEvent } | { ok: false; reason: "bad_signature" | "bad_body" | "unknown_event" };

/** Verify a delivery and parse its envelope. The raw body must be the exact bytes received. */
export async function parsePassportWebhook(secret: string, headers: { get(name: string): string | null }, rawBody: string, opts: VerifyOptions = {}): Promise<ParsedWebhook> {
  if (!(await verifyPassportSignature(secret, headers.get("X-Passport-Signature"), headers.get("X-Passport-Timestamp"), rawBody, opts))) return { ok: false, reason: "bad_signature" };
  let e: Partial<PassportEvent>;
  try {
    e = JSON.parse(rawBody) as Partial<PassportEvent>;
  } catch {
    return { ok: false, reason: "bad_body" };
  }
  if (!e || typeof e.id !== "string" || typeof e.type !== "string" || typeof e.orgId !== "string" || typeof e.occurredAt !== "string") return { ok: false, reason: "bad_body" };
  if (!(PASSPORT_EVENTS as readonly string[]).includes(e.type)) return { ok: false, reason: "unknown_event" };
  return { ok: true, event: { id: e.id, type: e.type as PassportEventType, orgId: e.orgId, occurredAt: e.occurredAt, data: e.data } };
}

/**
 * Where seen event ids are kept. `inbound_events.external_id` is unique, so the production store is
 * "insert, and report whether the row was new".
 */
export interface EventDedupeStore {
  /** Returns true when the id was not seen before (and records it). */
  claim(provider: "passport", eventId: string): Promise<boolean>;
}

export function memoryDedupeStore(): EventDedupeStore {
  const seen = new Set<string>();
  return {
    claim(provider, eventId) {
      const k = `${provider}:${eventId}`;
      if (seen.has(k)) return Promise.resolve(false);
      seen.add(k);
      return Promise.resolve(true);
    },
  };
}

/** Run `handle` once per event id. Passport retries for 24 h, so the same event can arrive many times. */
export async function handleOnce<T>(store: EventDedupeStore, event: PassportEvent, handle: (e: PassportEvent) => Promise<T>): Promise<{ duplicate: true } | { duplicate: false; result: T }> {
  if (!(await store.claim("passport", event.id))) return { duplicate: true };
  return { duplicate: false, result: await handle(event) };
}
