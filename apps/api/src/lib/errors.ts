// SPDX-License-Identifier: AGPL-3.0-only
// CommonGrants envelopes. Success: `{ status, message, data }` or
// `{ status, message, items, paginationInfo }`. Errors: `{ status, message, errors }`.
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { localizedBody } from "./error-locale.ts";
import { requestLocale } from "./locale.ts";

/** One entry in the CommonGrants `Error.errors` array. `code` is a stable machine-readable string. */
export interface ErrorDetail {
  code: string;
  detail?: string;
  field?: string;
  /** The message in the request's language, on GMS routes only (lib/error-locale.ts). */
  detailLocalized?: string;
}

export interface ErrorBody {
  status: number;
  message: string;
  errors: ErrorDetail[];
}

export class ApiError extends Error {
  /** For `not_found`: what was not found ("Award"), so the message can be given in the person's language. */
  resource?: string;
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details: ErrorDetail[] = [],
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  toBody(): ErrorBody {
    return { status: this.status, message: this.message, errors: [{ code: this.code }, ...this.details] };
  }
}

export const badRequest = (message: string, details: ErrorDetail[] = []) => new ApiError(400, "bad_request", message, details);
export const notFound = (what = "Resource") => Object.assign(new ApiError(404, "not_found", `${what} not found`), { resource: what });
export const notImplemented = (what: string) => new ApiError(501, "not_implemented", `${what} is not implemented yet`);
export const unavailable = (code: string, message: string) => new ApiError(503, code, message);

export function errorResponse(c: Context, err: ApiError) {
  for (const [k, v] of Object.entries(err.headers)) c.header(k, v);
  return c.json(localizedBody(err, err.toBody(), new URL(c.req.url).pathname, requestLocale({ url: c.req.url, header: (n) => c.req.header(n) })), err.status);
}

export const ok = <T>(data: T, message = "Success") => ({ status: 200, message, data });
export const created = <T>(data: T, message = "Created") => ({ status: 201, message, data });

export interface PaginationInfo {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export const paginated = <T>(items: T[], info: PaginationInfo, message = "Success") => ({ status: 200, message, items, paginationInfo: info });

export const MAX_PAGE_SIZE = 100;

/** `page` (1-based) and `pageSize` (default 100, max 100) from the query string. */
export function parsePagination(q: { page?: string; pageSize?: string }): { page: number; pageSize: number; offset: number } {
  const int = (raw: string | undefined, fallback: number, field: string) => {
    if (raw === undefined) return fallback;
    if (!/^\d{1,9}$/.test(raw) || Number(raw) < 1) throw badRequest(`${field} must be a positive integer`, [{ code: "invalid_parameter", field }]);
    return Number(raw);
  };
  const page = int(q.page, 1, "page");
  const pageSize = Math.min(int(q.pageSize, MAX_PAGE_SIZE, "pageSize"), MAX_PAGE_SIZE);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export const pageInfo = (page: number, pageSize: number, totalItems: number): PaginationInfo => ({
  page,
  pageSize,
  totalItems,
  totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
});
