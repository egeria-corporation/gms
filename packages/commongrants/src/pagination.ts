// SPDX-License-Identifier: AGPL-3.0-only
// Pagination, sorting and filter parsing plus the CommonGrants response envelopes.
// Shapes follow @common-grants/core 0.4 (pagination.tsp, sorting.tsp, responses/success.tsp).
import type { FieldIssue } from '@gms/domain';
import { z } from 'zod';
import { badRequest } from './http';
import { AppFiltersSchema, AppSortingSchema, AwdFiltersSchema, AwdSortingSchema, OppFiltersSchema, OppSortingSchema } from './schemas';
import type { CgPaginationInfo, CgSortInfo } from './types';

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 100;

export interface Pagination {
  page: number;
  pageSize: number;
}

function parseIntStrict(raw: unknown, name: string, min: number, max: number): number {
  let n: number;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && /^\s*-?\d+\s*$/.test(raw)) n = Number(raw);
  else throw badRequest(`"${name}" must be an integer.`, [{ pointer: `/${name}`, message: 'Must be an integer.' }]);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw badRequest(`"${name}" must be between ${min} and ${max}.`, [{ pointer: `/${name}`, message: `Must be between ${min} and ${max}.` }]);
  }
  return n;
}

/**
 * Parses `page` / `pageSize` from a query string or a request-body `pagination` object.
 * Defaults 1 / 100; pageSize is capped at 100. Anything invalid is a 400 problem.
 */
export function parsePagination(input: URLSearchParams | { page?: unknown; pageSize?: unknown } | null | undefined): Pagination {
  let page: unknown;
  let pageSize: unknown;
  if (input instanceof URLSearchParams) {
    page = input.get('page') ?? undefined;
    pageSize = input.get('pageSize') ?? undefined;
  } else if (input) {
    page = input.page;
    pageSize = input.pageSize;
  }
  return {
    page: page === undefined || page === null || page === '' ? DEFAULT_PAGE : parseIntStrict(page, 'page', 1, 1_000_000),
    pageSize: pageSize === undefined || pageSize === null || pageSize === '' ? DEFAULT_PAGE_SIZE : parseIntStrict(pageSize, 'pageSize', 1, MAX_PAGE_SIZE),
  };
}

export function paginationInfo(p: Pagination, totalItems: number): CgPaginationInfo {
  return { page: p.page, pageSize: p.pageSize, totalItems, totalPages: Math.ceil(totalItems / p.pageSize) };
}

export function offsetOf(p: Pagination): number {
  return (p.page - 1) * p.pageSize;
}

// ---------------------------------------------------------------------------------------
// Envelopes

export function okEnvelope<T>(data: T, message = 'Success', status = 200): { status: number; message: string; data: T } {
  return { status, message, data };
}

export function paginatedEnvelope<T>(items: T[], info: CgPaginationInfo, message = 'Success') {
  return { status: 200, message, items, paginationInfo: info };
}

export function filteredEnvelope<T, F>(items: T[], info: CgPaginationInfo, sortInfo: CgSortInfo, filters: F, errors: string[], message = 'Success') {
  return {
    status: 200,
    message,
    items,
    paginationInfo: info,
    sortInfo,
    filterInfo: { filters, ...(errors.length ? { errors } : {}) },
  };
}

// ---------------------------------------------------------------------------------------
// Search request parsing

function zodIssues(err: z.ZodError, prefix = ''): FieldIssue[] {
  return err.issues.map((i) => ({
    pointer: prefix + '/' + i.path.map((p) => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/'),
    message: i.message,
  }));
}

export interface SearchRequest<F, S extends string> {
  search: string | null;
  filters: F;
  sorting: { sortBy: S; customSortBy?: string; sortOrder: 'asc' | 'desc' };
  pagination: Pagination;
  /** Non-fatal errors reported back in filterInfo.errors. */
  filterErrors: string[];
  /** Non-fatal errors reported back in sortInfo.errors. */
  sortErrors: string[];
}

function parseSearch<FS extends z.ZodType, SS extends z.ZodType<{ sortBy: string; customSortBy?: string | null; sortOrder?: 'asc' | 'desc' | null }>>(
  body: unknown,
  filtersSchema: FS,
  sortingSchema: SS,
  opts: { sortable: readonly string[]; defaultSort: { sortBy: string; sortOrder: 'asc' | 'desc' }; knownCustomFilters: readonly string[] },
): SearchRequest<z.output<FS>, string> {
  if (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body))) throw badRequest('The request body must be a JSON object.');
  const shape = z.object({
    search: z.string().max(500).nullish(),
    filters: filtersSchema.nullish(),
    sorting: sortingSchema.nullish(),
    pagination: z.object({ page: z.unknown().optional(), pageSize: z.unknown().optional() }).nullish(),
  });
  const parsed = shape.safeParse(body ?? {});
  if (!parsed.success) throw badRequest('The search request is not valid.', zodIssues(parsed.error));
  const { search, filters, sorting, pagination } = parsed.data;

  const sortErrors: string[] = [];
  let sortBy = opts.defaultSort.sortBy;
  let customSortBy: string | undefined;
  const sortOrder = sorting?.sortOrder ?? (sorting ? 'asc' : opts.defaultSort.sortOrder);
  if (sorting) {
    if (sorting.sortBy === 'custom') {
      sortErrors.push(`Custom sort key "${sorting.customSortBy ?? ''}" is not supported; sorted by ${opts.defaultSort.sortBy} instead.`);
      customSortBy = undefined;
    } else if (opts.sortable.includes(sorting.sortBy)) {
      sortBy = sorting.sortBy;
    } else {
      sortErrors.push(`Sorting by "${sorting.sortBy}" is not supported; sorted by ${opts.defaultSort.sortBy} instead.`);
    }
  }

  const filterErrors: string[] = [];
  const f = (filters ?? {}) as Record<string, unknown> & { customFilters?: Record<string, unknown> | null };
  for (const key of Object.keys(f.customFilters ?? {})) {
    if (!opts.knownCustomFilters.includes(key)) filterErrors.push(`Custom filter "${key}" is not supported and was ignored.`);
  }

  const trimmed = search?.trim();
  return {
    search: trimmed ? trimmed : null,
    filters: (filters ?? {}) as z.output<FS>,
    sorting: { sortBy, ...(customSortBy ? { customSortBy } : {}), sortOrder },
    pagination: parsePagination(pagination ?? undefined),
    filterErrors,
    sortErrors,
  };
}

/** GMS custom filters on opportunity search (declared in the plugin). */
export const OPP_CUSTOM_FILTERS = ['causeAreas', 'geography'] as const;

export const OPP_SORTABLE = [
  'lastModifiedAt',
  'createdAt',
  'title',
  'status.value',
  'keyDates.closeDate',
  'funding.maxAwardAmount',
  'funding.minAwardAmount',
  'funding.totalAmountAvailable',
  'funding.estimatedAwardCount',
] as const;

export type OppSearchRequest = SearchRequest<z.output<typeof OppFiltersSchema>, string>;

export function parseOpportunitySearch(body: unknown): OppSearchRequest {
  return parseSearch(body, OppFiltersSchema, OppSortingSchema, {
    sortable: OPP_SORTABLE,
    defaultSort: { sortBy: 'lastModifiedAt', sortOrder: 'desc' },
    knownCustomFilters: OPP_CUSTOM_FILTERS,
  });
}

export const AWD_SORTABLE = ['lastModifiedAt', 'createdAt', 'title', 'status.value', 'keyDates.awardDate', 'funding.awardedAmount'] as const;
export type AwdSearchRequest = SearchRequest<z.output<typeof AwdFiltersSchema>, string>;

export function parseAwardSearch(body: unknown): AwdSearchRequest {
  return parseSearch(body, AwdFiltersSchema, AwdSortingSchema, {
    sortable: AWD_SORTABLE,
    defaultSort: { sortBy: 'lastModifiedAt', sortOrder: 'desc' },
    knownCustomFilters: [],
  });
}

export const APP_SORTABLE = ['lastModifiedAt', 'createdAt', 'submittedAt', 'status.value', 'opportunityId', 'competitionId'] as const;
export type AppSearchRequest = SearchRequest<z.output<typeof AppFiltersSchema>, string>;

export function parseApplicationSearch(body: unknown): AppSearchRequest {
  return parseSearch(body, AppFiltersSchema, AppSortingSchema, {
    sortable: APP_SORTABLE,
    defaultSort: { sortBy: 'lastModifiedAt', sortOrder: 'desc' },
    knownCustomFilters: [],
  });
}

export function sortInfoOf(req: Pick<SearchRequest<unknown, string>, 'sorting' | 'sortErrors'>): CgSortInfo {
  return {
    sortBy: req.sorting.sortBy,
    ...(req.sorting.customSortBy ? { customSortBy: req.sorting.customSortBy } : {}),
    sortOrder: req.sorting.sortOrder,
    ...(req.sortErrors.length ? { errors: req.sortErrors } : {}),
  };
}

/**
 * A CG date filter bound (YYYY-MM-DD or ISO datetime) -> UTC instant. A date-only upper bound
 * covers the whole workspace day, so it becomes an exclusive bound at the next local midnight.
 */
export function dateBound(value: string, tz: string, edge: 'start' | 'end', toUtc: (local: string, tz: string) => Date): { at: string; inclusive: boolean } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (edge === 'start') return { at: toUtc(`${value}T00:00:00`, tz).toISOString(), inclusive: true };
    const [y, m, d] = value.split('-').map(Number);
    const next = new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
    return { at: toUtc(`${next}T00:00:00`, tz).toISOString(), inclusive: false };
  }
  return { at: new Date(value).toISOString(), inclusive: true };
}
