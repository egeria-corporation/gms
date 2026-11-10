// SPDX-License-Identifier: AGPL-3.0-only
// Parsing of the CommonGrants `filters` / `sorting` / `pagination` search body for the three search
// routes, plus an in-memory evaluator for the filter operators (used by tests and small result sets;
// stores translate the same parsed filters to SQL).
import { AwdFiltersSchema, AwdSortingSchema, OppFiltersSchema, OppSortingSchema } from "@common-grants/sdk/schemas";
import type { z } from "zod";
import { parsePage, PaginationError, type Page, type SortInfo } from "./envelope.ts";
import { AppFiltersSchema, AppSortingSchema } from "./schemas.ts";

export type SearchKind = "opportunities" | "applications" | "awards";

const SCHEMAS = {
  opportunities: { filters: OppFiltersSchema, sorting: OppSortingSchema },
  applications: { filters: AppFiltersSchema, sorting: AppSortingSchema },
  awards: { filters: AwdFiltersSchema, sorting: AwdSortingSchema },
} satisfies Record<SearchKind, { filters: z.ZodType; sorting: z.ZodType }>;

export class SearchRequestError extends Error {
  readonly errors: { field: string; message: string }[];
  constructor(errors: { field: string; message: string }[]) {
    super(`Invalid search request: ${errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`);
    this.name = "SearchRequestError";
    this.errors = errors;
  }
}

export interface ParsedFilter {
  /** Named filter (`status`, `closeDateRange`, …) or the key under `customFilters` */
  name: string;
  custom: boolean;
  operator: string;
  value: unknown;
}

export interface SearchRequest {
  /** The filters as the client sent them, echoed in `filterInfo.filters`. */
  filters: Record<string, unknown>;
  parsedFilters: ParsedFilter[];
  sortInfo: SortInfo;
  page: Page;
  /** Free-text search, when the body carried one */
  search?: string;
}

const issues = (prefix: string, err: z.ZodError) => err.issues.map((i) => ({ field: [prefix, ...i.path.map(String)].join("."), message: i.message }));

function unpack(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Accepts the JSON body `{ filters?, sorting?, pagination?, search? }`. `filters` and `sorting` may
 * also arrive as JSON-encoded strings, which is how the v0.5.0 application search declares them
 * (query parameters).
 */
export function parseSearchRequest(kind: SearchKind, body: unknown): SearchRequest {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const schemas = SCHEMAS[kind];
  const errors: { field: string; message: string }[] = [];

  const rawFilters = unpack(input.filters) ?? {};
  const f = schemas.filters.safeParse(rawFilters);
  if (!f.success) errors.push(...issues("filters", f.error));

  const rawSorting = unpack(input.sorting) ?? { sortBy: "lastModifiedAt" };
  const s = schemas.sorting.safeParse(rawSorting);
  if (!s.success) errors.push(...issues("sorting", s.error));

  let page: Page = { page: 1, pageSize: 100, offset: 0 };
  try {
    page = parsePage((unpack(input.pagination) ?? {}) as { page?: unknown; pageSize?: unknown });
  } catch (e) {
    if (!(e instanceof PaginationError)) throw e;
    errors.push({ field: "pagination", message: e.message });
  }
  if (input.search !== undefined && input.search !== null && typeof input.search !== "string") errors.push({ field: "search", message: "must be a string" });

  const sorting = rawSorting as { sortBy: string; customSortBy?: string | null; sortOrder?: "asc" | "desc" | null };
  if (s.success && sorting.sortBy === "custom" && !sorting.customSortBy) errors.push({ field: "sorting.customSortBy", message: "required when sortBy is custom" });
  if (errors.length) throw new SearchRequestError(errors);

  const filters = rawFilters as Record<string, unknown>;
  const parsedFilters: ParsedFilter[] = [];
  for (const [name, filter] of Object.entries(filters)) {
    if (filter === null || filter === undefined) continue;
    if (name === "customFilters") {
      for (const [key, custom] of Object.entries(filter as Record<string, { operator: string; value: unknown }>)) {
        parsedFilters.push({ name: key, custom: true, operator: custom.operator, value: custom.value });
      }
    } else {
      const named = filter as { operator: string; value: unknown };
      parsedFilters.push({ name, custom: false, operator: named.operator, value: named.value });
    }
  }
  return {
    filters,
    parsedFilters,
    sortInfo: {
      sortBy: sorting.sortBy,
      ...(sorting.customSortBy ? { customSortBy: sorting.customSortBy } : {}),
      sortOrder: sorting.sortOrder ?? "desc",
    },
    page,
    ...(typeof input.search === "string" && input.search.trim() ? { search: input.search.trim() } : {}),
  };
}

const comparable = (v: unknown): number | string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "object" && "amount" in (v as object)) return Number((v as { amount: string }).amount);
  if (typeof v === "boolean") return v ? 1 : 0;
  const s = String(v);
  return /^-?[0-9]+(\.[0-9]+)?$/.test(s) ? Number(s) : s;
};

/** Evaluate one CommonGrants filter operator against a value. Unknown operators never match. */
export function matchesFilter(actual: unknown, operator: string, expected: unknown): boolean {
  const a = comparable(actual);
  switch (operator) {
    case "eq":
      return a === comparable(expected);
    case "neq":
      return a !== comparable(expected);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const e = comparable(expected);
      if (a === null || e === null || typeof a !== typeof e) return false;
      return operator === "gt" ? a > e : operator === "gte" ? a >= e : operator === "lt" ? a < e : a <= e;
    }
    case "like":
      return typeof actual === "string" && typeof expected === "string" && actual.toLowerCase().includes(expected.toLowerCase());
    case "notLike":
      return !(typeof actual === "string" && typeof expected === "string" && actual.toLowerCase().includes(expected.toLowerCase()));
    case "in":
      return Array.isArray(expected) && expected.some((e) => comparable(e) === a);
    case "notIn":
      return Array.isArray(expected) && !expected.some((e) => comparable(e) === a);
    case "between":
    case "outside": {
      const range = (expected ?? {}) as { min?: unknown; max?: unknown };
      const min = comparable(range.min);
      const max = comparable(range.max);
      if (a === null || min === null || max === null || typeof a !== typeof min || typeof a !== typeof max) return false;
      const inside = a >= min && a <= max;
      return operator === "between" ? inside : !inside;
    }
    default:
      return false;
  }
}

/** Read a dotted path (`funding.awardedAmount`) from a record. */
export function readPath(record: unknown, path: string): unknown {
  let cur: unknown = record;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Stable in-memory sort by a dotted path; missing values sort last in either direction. */
export function sortByPath<T>(items: readonly T[], path: string, order: "asc" | "desc"): T[] {
  const dir = order === "asc" ? 1 : -1;
  return items
    .map((item, index) => ({ item, index, key: comparable(readPath(item, path)) }))
    .sort((x, y) => {
      if (x.key === null || y.key === null) return x.key === y.key ? x.index - y.index : x.key === null ? 1 : -1;
      if (x.key < y.key) return -dir;
      if (x.key > y.key) return dir;
      return x.index - y.index;
    })
    .map((x) => x.item);
}
