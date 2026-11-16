// SPDX-License-Identifier: AGPL-3.0-only
// Zernio webhooks: `X-Zernio-Signature` is the lowercase hex HMAC-SHA256 of the raw body with the
// endpoint's secret. Verify it (constant time) before reading anything, then read the event into
// the few facts the GMS keeps: the event's id and type, the profile's externalId (our workspace
// id), and the account or post ids, platforms, statuses and URLs. Nothing else is kept: an inbox
// event's message text, a token or a follower list never leaves this function.
import { accountOf, postOf, type ZernioAccount, type ZernioPost } from "./client.ts";
import { isPlatform } from "./platforms.ts";
import { constantTimeEqual, hmacHex, sha256Hex } from "./tokens.ts";

export const SIGNATURE_HEADER = "X-Zernio-Signature";

/** The signature Zernio sends for `rawBody` (tests and the fake server sign with this). */
export const signZernioBody = (secret: string, rawBody: string) => hmacHex(secret, rawBody);

export async function verifyZernioSignature(secret: string, rawBody: string, header: string | null | undefined): Promise<boolean> {
  if (!secret || !header) return false;
  const given = header.trim().replace(/^sha256=/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(given)) return false;
  return constantTimeEqual(await hmacHex(secret, rawBody), given.toLowerCase());
}

/** The events the GMS acts on. Any other verified event is acknowledged and dropped. */
export const HANDLED_EVENTS = ["account.connected", "account.disconnected", "post.scheduled", "post.published", "post.partial", "post.failed", "post.cancelled"] as const;
export type HandledEvent = (typeof HANDLED_EVENTS)[number];
export const isHandledEvent = (t: string): t is HandledEvent => (HANDLED_EVENTS as readonly string[]).includes(t);

export interface ZernioEvent {
  /** Zernio's event id, or the SHA-256 of the body when it gives none (an exact replay has the same one). */
  id: string;
  type: string;
  occurredAt: string | null;
  profileExternalId: string | null;
  profileId: string | null;
  /** Every profile the event names (`profiles[]`: Zernio's `id` and our `externalId`, the workspace id). */
  profiles: { id: string | null; externalId: string | null }[];
  account: ZernioAccount | null;
  /** For an account event with only an id. */
  accountId: string | null;
  post: ZernioPost | null;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 && v.length <= 200 ? v : null);

function timeOf(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString();
  return null;
}

/** The event in a verified body, or null when the body is not a Zernio event. */
export async function parseZernioEvent(rawBody: string): Promise<ZernioEvent | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const root = obj(parsed);
  if (!root) return null;
  const data = obj(root.data) ?? root;
  const type = str(root.event) ?? str(root.type) ?? str(data.event);
  if (!type || !/^[a-z][a-z0-9_.]{0,80}$/.test(type)) return null;
  const profiles = Array.isArray(root.profiles) ? root.profiles : Array.isArray(data.profiles) ? data.profiles : [];
  const listed = (profiles.length ? profiles : [data.profile]).map(obj).filter((p): p is Json => !!p).slice(0, 20);
  const profile = listed[0] ?? null;
  const accountRaw = obj(data.account);
  const account = accountRaw ? accountOf(accountRaw) : null;
  const accountId = account?.id ?? str(accountRaw?._id) ?? str(accountRaw?.id) ?? str(data.accountId);
  const post = obj(data.post) ? postOf(data.post) : null;
  return {
    id: str(root.id) ?? str(root.eventId) ?? str(root.webhookId) ?? (await sha256Hex(rawBody)),
    type,
    occurredAt: timeOf(root.timestamp ?? root.createdAt ?? root.occurredAt),
    profileExternalId: str(profile?.externalId),
    profileId: str(profile?._id) ?? str(profile?.id) ?? str(data.profileId),
    profiles: listed.map((p) => ({ id: str(p._id) ?? str(p.id), externalId: str(p.externalId) })),
    account: account ?? (accountId && accountRaw && isPlatform(accountRaw.platform) ? { id: accountId, platform: accountRaw.platform, username: null, profileId: null } : null),
    accountId,
    post,
  };
}
