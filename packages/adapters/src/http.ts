// SPDX-License-Identifier: AGPL-3.0-only
// Small fetch helpers shared by the HTTP adapters (Mercury, Resend, LLMs): retries with exponential backoff
// + full jitter on 429/5xx, honoring Retry-After. Never logs request headers or bodies (they carry secrets).

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RetryPolicy {
  /** Total attempts including the first. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Which failures may be retried. 'rate-limit-only' is for non-idempotent writes. */
  mode: 'transient' | 'rate-limit-only';
}

export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 4, baseDelayMs: 400, maxDelayMs: 8_000, mode: 'transient' };

export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parses Retry-After (delta-seconds or HTTP-date) into milliseconds; null when absent/invalid. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

/** Exponential backoff with full jitter: random(0, min(max, base * 2^attempt)). */
export function backoffDelay(attempt: number, policy: RetryPolicy, random: () => number = Math.random): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  return Math.round(random() * ceiling);
}

export function isRetryableStatus(status: number, mode: RetryPolicy['mode']): boolean {
  if (status === 429) return true;
  if (mode === 'rate-limit-only') return false;
  return status >= 500 && status <= 599;
}

export interface RetryingFetchOptions {
  fetch: FetchLike;
  policy?: Partial<RetryPolicy>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
}

/**
 * Performs a fetch with retries. `makeInit` is called for every attempt so bodies (FormData, streams) can be
 * rebuilt. Returns the final Response (which may still be an error status) or throws the last network error.
 */
export async function fetchWithRetry(
  url: string,
  makeInit: () => RequestInit,
  opts: RetryingFetchOptions,
): Promise<Response> {
  const policy: RetryPolicy = { ...DEFAULT_RETRY, ...opts.policy };
  const sleep = opts.sleep ?? defaultSleep;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    const init = makeInit();
    const controller = opts.timeoutMs ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs) : null;
    try {
      const res = await opts.fetch(url, controller ? { ...init, signal: controller.signal } : init);
      if (!isRetryableStatus(res.status, policy.mode) || attempt === policy.maxAttempts - 1) return res;
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      // Drain the body so the connection can be reused.
      await res.arrayBuffer().catch(() => undefined);
      await sleep(Math.min(policy.maxDelayMs * 4, retryAfter ?? backoffDelay(attempt, policy, opts.random)));
    } catch (err) {
      lastError = err;
      // Network errors on non-idempotent writes are not retried: the request may have been processed.
      if (policy.mode === 'rate-limit-only' || attempt === policy.maxAttempts - 1) throw err;
      await sleep(backoffDelay(attempt, policy, opts.random));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('request failed');
}

/** Reads a JSON body defensively (empty body → null). */
export async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 500) };
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Removes every occurrence of the given secrets from a string (defense in depth for error messages). */
export function redact(text: string, secrets: readonly (string | undefined | null)[]): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join('[redacted]');
  }
  return out;
}

/** Case-insensitive header lookup over a plain record. */
export function headerValue(headers: Record<string, string | undefined>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}
