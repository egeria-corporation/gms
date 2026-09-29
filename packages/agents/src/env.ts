// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared environment + HTTP helpers for the agent surfaces (MCP, A2A, /api/v1, OAuth, discovery).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Runtime, WorkspaceRef } from '@gms/actions';
import { toProblem, type ProblemDetails } from '@gms/domain';
import type { JWTVerifyGetKey } from 'jose';

/** Resolves an https client-metadata URL to a parsed JSON document (overridable for tests). */
export type ClientMetadataFetcher = (url: string) => Promise<unknown>;

export interface AgentEnv {
  /** The tenant the request was routed to (from the host name). */
  workspace: WorkspaceRef;
  /** Public origin of the tenant, e.g. http://halcyon.localhost:3000 (no trailing slash). */
  origin: string;
  /** The foundation's display name (branding). */
  brandName: string;
  /** `getRuntime()` in the app; tests pass `createRuntime({ db })`. */
  runtime: Runtime;
  requestId: string;
  ip?: string | null;
  /** Supabase OAuth 2.1 server. Defaults to process.env.SUPABASE_URL when unset; pass null to disable. */
  supabaseUrl?: string | null;
  /** Overrides the SSRF-safe CIMD fetcher (tests). */
  fetchClientMetadata?: ClientMetadataFetcher;
  /** Overrides the JWKS used to verify Supabase access tokens (tests). */
  supabaseJwks?: JWTVerifyGetKey;
}

/** Protected resources served by GMS. */
export type ResourceKind = 'mcp' | 'a2a' | 'api';
export const RESOURCE_PATHS: Record<ResourceKind, string> = { mcp: '/mcp', a2a: '/a2a', api: '/api/v1' };

export function trimOrigin(origin: string): string {
  return origin.replace(/\/+$/, '');
}

export function resourceUrl(env: Pick<AgentEnv, 'origin'>, kind: ResourceKind): string {
  return `${trimOrigin(env.origin)}${RESOURCE_PATHS[kind]}`;
}

export function resourceMetadataUrl(env: Pick<AgentEnv, 'origin'>, kind: ResourceKind): string {
  return `${trimOrigin(env.origin)}/.well-known/oauth-protected-resource${RESOURCE_PATHS[kind]}`;
}

export function now(env: AgentEnv): Date {
  return env.runtime.deps.clock();
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time comparison of two strings (hashes, PKCE challenges). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** A new opaque secret `<prefix>_<32 random bytes, base64url>` with its sha256 hash and display prefix. */
export function newSecret(prefix: string): { token: string; hash: string; prefix: string } {
  const token = `${prefix}_${randomBytes(32).toString('base64url')}`;
  return { token, hash: sha256Hex(token), prefix: token.slice(0, prefix.length + 7) };
}

export type HeaderMap = Record<string, string>;

export function json(body: unknown, status = 200, headers: HeaderMap = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function text(body: string, contentType: string, status = 200, headers: HeaderMap = {}): Response {
  return new Response(body, { status, headers: { 'content-type': contentType, ...headers } });
}

export function problemResponse(problem: ProblemDetails, headers: HeaderMap = {}): Response {
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: {
      'content-type': 'application/problem+json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

/** RFC 9457 response for any thrown value (DomainError → mapped; everything else → 500 without leaking detail). */
export function errorResponse(err: unknown, instance?: string, headers: HeaderMap = {}): Response {
  if (err instanceof HttpError) return problemResponse(err.problem(instance), { ...err.headers, ...headers });
  const p = toProblem(err, instance);
  if (p.status >= 500) console.error('[agents] unexpected error', (err as Error)?.message ?? err);
  return problemResponse(p, headers);
}

/** An error that already knows its HTTP status, problem body and headers (auth challenges, rate limits). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    message: string,
    readonly headers: HeaderMap = {},
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'HttpError';
  }

  problem(instance?: string): ProblemDetails {
    return {
      type: `https://gms.dev/problems/${this.code}`,
      title: this.title,
      status: this.status,
      detail: this.message,
      code: this.code as ProblemDetails['code'],
      ...(instance ? { instance } : {}),
      ...this.extra,
    };
  }
}

export function isHttpError(e: unknown): e is HttpError {
  return e instanceof HttpError;
}

/** Reads a JSON body with a size cap; throws a 400/413 HttpError on problems. */
export async function readJson(req: Request, maxBytes = 1_000_000): Promise<unknown> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > maxBytes)
    throw new HttpError(
      413,
      'validation_failed',
      'Request too large',
      `The body is larger than ${maxBytes} bytes.`,
    );
  const raw = await req.text();
  if (raw.length > maxBytes)
    throw new HttpError(
      413,
      'validation_failed',
      'Request too large',
      `The body is larger than ${maxBytes} bytes.`,
    );
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(400, 'validation_failed', 'Invalid JSON', 'The request body is not valid JSON.');
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
