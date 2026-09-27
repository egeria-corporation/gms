// SPDX-License-Identifier: AGPL-3.0-only
// Resend mailer (HTTP API via fetch) plus Svix signature verification for Resend's delivery/bounce webhooks.
// Outside production deploys this mailer is always wrapped by GuardedMailer (./guard.ts), which only lets mail
// through to @resend.dev test addresses or GMS_EMAIL_ALLOWLIST hosts.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fetchWithRetry, headerValue, isRecord, readJson, redact, type FetchLike } from '../http';
import type { MailMessage, Mailer, MailResult } from '../types';

export const RESEND_API_URL = 'https://api.resend.com';
export const SVIX_TOLERANCE_SECONDS = 5 * 60;

export class MailProviderError extends Error {
  constructor(
    readonly provider: 'resend' | 'smtp',
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'MailProviderError';
  }
}

export interface ResendMailerOptions {
  apiKey: string;
  fetch?: FetchLike;
  baseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
}

/** Resend tag names/values allow only ASCII letters, numbers, underscores and dashes (max 256). */
function sanitizeTag(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256);
}

function formatFrom(msg: MailMessage): string {
  if (!msg.fromName) return msg.from;
  const name = msg.fromName.replace(/["\r\n<>]/g, '').trim();
  return `"${name}" <${msg.from}>`;
}

export class ResendMailer implements Mailer {
  readonly name = 'resend' as const;
  readonly #apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly sleep?: (ms: number) => Promise<void>;

  constructor(opts: ResendMailerOptions) {
    if (!opts.apiKey) throw new Error('RESEND_API_KEY is missing');
    this.#apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.baseUrl = (opts.baseUrl ?? RESEND_API_URL).replace(/\/$/, '');
    this.sleep = opts.sleep;
  }

  toJSON(): Record<string, unknown> {
    return { name: this.name };
  }

  async send(msg: MailMessage): Promise<MailResult> {
    const tags = Object.entries(msg.tags ?? {}).map(([name, value]) => ({ name: sanitizeTag(name), value: sanitizeTag(value) }));
    if (msg.workspaceId) tags.push({ name: 'workspace_id', value: sanitizeTag(msg.workspaceId) });
    const body = {
      from: formatFrom(msg),
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
      ...(msg.headers && Object.keys(msg.headers).length ? { headers: msg.headers } : {}),
      ...(tags.length ? { tags } : {}),
    };
    const apiKey = this.#apiKey;
    const res = await fetchWithRetry(
      `${this.baseUrl}/emails`,
      () => ({
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      // Sending is not idempotent without an idempotency key: only retry when Resend rate-limits.
      { fetch: this.fetchImpl, policy: { mode: 'rate-limit-only' }, sleep: this.sleep, timeoutMs: 20_000 },
    );
    const json = await readJson(res);
    if (!res.ok || !isRecord(json) || typeof json.id !== 'string') {
      const message = isRecord(json) && typeof json.message === 'string' ? json.message : `status ${res.status}`;
      throw new MailProviderError('resend', res.status, `Resend rejected the message: ${redact(message, [apiKey])}`);
    }
    return { provider: 'resend', messageId: json.id };
  }

  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>, secret: string): boolean {
    return verifySvixSignature(rawBody, headers, secret);
  }
}

/**
 * Svix webhook verification (used by Resend):
 *   signed content = "<svix-id>.<svix-timestamp>.<raw body>"
 *   key            = base64-decoded secret after the "whsec_" prefix
 *   svix-signature = space-separated list of "v1,<base64 HMAC-SHA256>"
 * Rejects timestamps outside ±5 minutes.
 */
export function verifySvixSignature(
  rawBody: string,
  headers: Record<string, string | undefined>,
  secret: string,
  now: Date = new Date(),
  toleranceSeconds = SVIX_TOLERANCE_SECONDS,
): boolean {
  const id = headerValue(headers, 'svix-id') ?? headerValue(headers, 'webhook-id');
  const timestamp = headerValue(headers, 'svix-timestamp') ?? headerValue(headers, 'webhook-timestamp');
  const signatures = headerValue(headers, 'svix-signature') ?? headerValue(headers, 'webhook-signature');
  if (!id || !timestamp || !signatures || !secret) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const ts = Number(timestamp);
  const nowS = Math.floor(now.getTime() / 1000);
  if (Math.abs(nowS - ts) > toleranceSeconds) return false;
  let key: Buffer;
  try {
    key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  } catch {
    return false;
  }
  if (key.length === 0) return false;
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`, 'utf8').digest();
  for (const part of signatures.split(' ')) {
    const [version, sig] = part.split(',', 2);
    if (version !== 'v1' || !sig) continue;
    const given = Buffer.from(sig, 'base64');
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

/** Test helper: produces Svix headers for a payload. */
export function signSvixPayload(rawBody: string, secret: string, id: string, now: Date = new Date()): Record<string, string> {
  const ts = String(Math.floor(now.getTime() / 1000));
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  const sig = createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`, 'utf8').digest('base64');
  return { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` };
}
