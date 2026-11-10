// SPDX-License-Identifier: AGPL-3.0-only
// CommonGrants response envelopes and pagination (build spec §9): `{status, message, data}`,
// `{status, message, items, paginationInfo}`, and the error shape `{status, message, errors}`.

export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 100;

export interface Success {
  status: number;
  message: string;
}
export interface Ok<T> extends Success {
  data: T;
}
export interface PaginationInfo {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}
export interface Paginated<T> extends Success {
  items: T[];
  paginationInfo: PaginationInfo;
}
export interface SortInfo {
  sortBy: string;
  customSortBy?: string;
  sortOrder: "asc" | "desc";
  errors?: string[];
}
export interface Filtered<T, F> extends Paginated<T> {
  sortInfo: SortInfo;
  filterInfo: { filters: F; errors?: string[] };
}
export interface ErrorBody {
  status: number;
  message: string;
  errors: unknown[];
}
/** One entry of CommonGrants `validationErrors`. */
export interface ValidationError {
  field: string;
  message: string;
  type?: string;
}

export const ok = <T>(data: T, message = "Success"): Ok<T> => ({ status: 200, message, data });
export const created = <T>(data: T, message = "Created"): Ok<T> => ({ status: 201, message, data });
export const accepted = <T>(data: T, message = "Accepted"): Ok<T> => ({ status: 202, message, data });
export const error = (status: number, message: string, errors: unknown[] = []): ErrorBody => ({ status, message, errors });

export interface Page {
  page: number;
  pageSize: number;
  /** Row offset for the query */
  offset: number;
}

export class PaginationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaginationError";
  }
}

function int(value: unknown, name: string, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) throw new PaginationError(`${name} must be a positive integer`);
  return n;
}

/** Reads `page` / `pageSize` from query or body params. `pageSize` above 100 is clamped to 100. */
export function parsePage(params: { page?: unknown; pageSize?: unknown } | null | undefined): Page {
  const page = int(params?.page, "page", 1);
  const pageSize = Math.min(int(params?.pageSize, "pageSize", DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function paginationInfo(page: Page, totalItems: number): PaginationInfo {
  return { page: page.page, pageSize: page.pageSize, totalItems, totalPages: Math.ceil(totalItems / page.pageSize) };
}

export const paginated = <T>(items: T[], page: Page, totalItems: number, message = "Success"): Paginated<T> => ({
  status: 200,
  message,
  items,
  paginationInfo: paginationInfo(page, totalItems),
});

export const filtered = <T, F>(items: T[], page: Page, totalItems: number, sortInfo: SortInfo, filters: F, filterErrors?: string[]): Filtered<T, F> => ({
  ...paginated(items, page, totalItems),
  sortInfo,
  filterInfo: filterErrors?.length ? { filters, errors: filterErrors } : { filters },
});
