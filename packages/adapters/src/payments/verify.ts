// SPDX-License-Identifier: AGPL-3.0-or-later
// Mercury webhook signatures (documented at https://docs.mercury.com/reference/webhooks):
//   header  Mercury-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>
//   signed  "<t>.<raw request body>"  keyed with the endpoint's secret (returned once at webhook creation)
// Verification uses a constant-time comparison and a ±5 minute window (replay protection).
// The fake rail signs with exactly this scheme so the app's /webhooks/mercury route is exercised end to end.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { headerValue } from '../http';

export const MERCURY_SIGNATURE_HEADER = 'mercury-signature';
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type WebhookVerifyFailure = 'missing_header' | 'malformed_header' | 'stale_timestamp' | 'future_timestamp' | 'bad_signature';

export function computeMercurySignature(rawBody: string, secret: string, timestamp: number): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
}

/** Produces the header value for a payload (used by the fake rail and tests). */
export function signMercuryWebhook(rawBody: string, secret: string, now: Date = new Date()): string {
  const t = Math.floor(now.getTime() / 1000);
  return `t=${t},v1=${computeMercurySignature(rawBody, secret, t)}`;
}

export function parseSignatureHeader(value: string): { timestamp: number; signatures: string[] } | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of value.split(',')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === 't' && /^\d{1,12}$/.test(v)) timestamp = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/i.test(v)) signatures.push(v.toLowerCase());
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export function verifyMercurySignatureDetailed(
  rawBody: string,
  headers: Record<string, string | undefined>,
  secret: string,
  opts: { now?: Date; toleranceSeconds?: number } = {},
): { ok: true } | { ok: false; reason: WebhookVerifyFailure } {
  const header = headerValue(headers, MERCURY_SIGNATURE_HEADER);
  if (!header) return { ok: false, reason: 'missing_header' };
  if (!secret) return { ok: false, reason: 'bad_signature' };
  const parsed = parseSignatureHeader(header);
  if (!parsed) return { ok: false, reason: 'malformed_header' };
  const tolerance = opts.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  const nowS = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (parsed.timestamp < nowS - tolerance) return { ok: false, reason: 'stale_timestamp' };
  if (parsed.timestamp > nowS + tolerance) return { ok: false, reason: 'future_timestamp' };
  const expected = Buffer.from(computeMercurySignature(rawBody, secret, parsed.timestamp), 'hex');
  const match = parsed.signatures.some((sig) => {
    const given = Buffer.from(sig, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  return match ? { ok: true } : { ok: false, reason: 'bad_signature' };
}

export function verifyMercurySignature(
  rawBody: string,
  headers: Record<string, string | undefined>,
  secret: string,
  now?: Date,
): boolean {
  return verifyMercurySignatureDetailed(rawBody, headers, secret, { now }).ok;
}
