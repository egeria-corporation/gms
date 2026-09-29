// SPDX-License-Identifier: AGPL-3.0-or-later
// HTTP helpers: JSON responses, RFC 9457 problem responses that also satisfy the CommonGrants
// error envelope ({ status, message, errors }), and Cache-Control policy.
import { DomainError, toProblem, type ErrorCode, type FieldIssue } from '@gms/domain';

/** A DomainError with an explicit HTTP status (used for 400 Bad Request and 405). */
export class HttpError extends DomainError {
  readonly httpStatus: number;
  constructor(httpStatus: number, code: ErrorCode, message: string, details: Record<string, unknown> = {}, issues: FieldIssue[] = []) {
    super(code, message, details, issues);
    this.httpStatus = httpStatus;
  }
  override get status(): number {
    return this.httpStatus;
  }
}

export function badRequest(message: string, issues: FieldIssue[] = []): HttpError {
  return new HttpError(400, 'validation_failed', message, {}, issues);
}

export const CACHE_PUBLIC = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';
export const CACHE_PRIVATE = 'private, no-store';
export const CACHE_NONE = 'no-store';

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/** Problem details (RFC 9457) plus the CG error fields `message` and `errors`. */
export function problemBody(err: unknown, instance?: string): Record<string, unknown> & { status: number } {
  const p = toProblem(err, instance);
  const status = err instanceof HttpError ? err.httpStatus : p.status;
  const title = err instanceof HttpError && err.httpStatus === 400 ? 'Bad request' : err instanceof HttpError && err.httpStatus === 405 ? 'Method not allowed' : p.title;
  return { ...p, title, status, message: p.detail, errors: p.errors ?? [] };
}

export function problem(err: unknown, instance?: string, headers: Record<string, string> = {}): Response {
  const body = problemBody(err, instance);
  return new Response(JSON.stringify(body), {
    status: body.status,
    headers: { 'content-type': 'application/problem+json; charset=utf-8', 'cache-control': CACHE_NONE, ...headers },
  });
}

export async function readJsonBody(request: Request, { optional = false } = {}): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) {
    if (optional) return {};
    throw badRequest('A JSON request body is required.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw badRequest('The request body is not valid JSON.');
  }
}
