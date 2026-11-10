// SPDX-License-Identifier: AGPL-3.0-only
import { ErrorSchema, FilteredSchema, OkSchema, OpportunityBaseSchema, OppFiltersSchema, PaginatedSchema } from "@common-grants/sdk/schemas";
import { describe, expect, it } from "vitest";
import {
  error,
  filtered,
  matchesFilter,
  ok,
  paginated,
  PaginationError,
  parsePage,
  parseSearchRequest,
  projectOpportunity,
  SearchRequestError,
  sortByPath,
} from "../src/index.ts";
import { funder, opportunity } from "./fixtures.ts";

const cg = projectOpportunity({ opportunity, funder }, { baseUrl: "https://gms.opengrants.io" });

describe("envelopes", () => {
  it("builds CommonGrants success and error bodies", () => {
    expect(OkSchema(OpportunityBaseSchema).safeParse(ok(cg)).success).toBe(true);
    const page = parsePage({ page: "2", pageSize: "10" });
    const body = paginated([cg], page, 11);
    expect(PaginatedSchema(OpportunityBaseSchema).safeParse(body).success).toBe(true);
    expect(body.paginationInfo).toEqual({ page: 2, pageSize: 10, totalItems: 11, totalPages: 2 });
    expect(ErrorSchema.safeParse(error(404, "Opportunity not found")).success).toBe(true);
  });

  it("defaults to page 1 of 100, clamps the size and refuses nonsense", () => {
    expect(parsePage(undefined)).toEqual({ page: 1, pageSize: 100, offset: 0 });
    expect(parsePage({ pageSize: 500 }).pageSize).toBe(100);
    expect(parsePage({ page: 3, pageSize: 25 }).offset).toBe(50);
    expect(() => parsePage({ page: 0 })).toThrow(PaginationError);
    expect(() => parsePage({ pageSize: "many" })).toThrow(PaginationError);
  });
});

describe("search requests", () => {
  it("parses filters, sorting and pagination for opportunities", () => {
    const req = parseSearchRequest("opportunities", {
      filters: {
        status: { operator: "in", value: ["open"] },
        closeDateRange: { operator: "between", value: { min: "2027-01-01", max: "2027-12-31" } },
        customFilters: { "customFields.gms.value.funderHandle": { operator: "eq", value: "riverbend" } },
      },
      sorting: { sortBy: "keyDates.closeDate", sortOrder: "asc" },
      pagination: { page: 2, pageSize: 20 },
      search: " rural ",
    });
    expect(req.parsedFilters).toEqual([
      { name: "status", custom: false, operator: "in", value: ["open"] },
      { name: "closeDateRange", custom: false, operator: "between", value: { min: "2027-01-01", max: "2027-12-31" } },
      { name: "customFields.gms.value.funderHandle", custom: true, operator: "eq", value: "riverbend" },
    ]);
    expect(req.sortInfo).toEqual({ sortBy: "keyDates.closeDate", sortOrder: "asc" });
    expect(req.page).toEqual({ page: 2, pageSize: 20, offset: 20 });
    expect(req.search).toBe("rural");
    const body = filtered([cg], req.page, 21, req.sortInfo, req.filters);
    expect(FilteredSchema(OpportunityBaseSchema, OppFiltersSchema).safeParse(body).success).toBe(true);
  });

  it("defaults to newest first with no filters", () => {
    const req = parseSearchRequest("awards", undefined);
    expect(req.parsedFilters).toEqual([]);
    expect(req.sortInfo).toEqual({ sortBy: "lastModifiedAt", sortOrder: "desc" });
  });

  it("accepts JSON-encoded filters and sorting for the application search", () => {
    const req = parseSearchRequest("applications", {
      filters: JSON.stringify({ status: { operator: "in", value: ["submitted", "underReview"] } }),
      sorting: JSON.stringify({ sortBy: "submittedAt", sortOrder: "desc" }),
    });
    expect(req.parsedFilters[0]).toMatchObject({ name: "status", operator: "in" });
    expect(req.sortInfo.sortBy).toBe("submittedAt");
  });

  it("reports every problem with field paths", () => {
    try {
      parseSearchRequest("awards", { filters: { status: { operator: "near", value: "x" } }, sorting: { sortBy: "amount" }, pagination: { page: -1 } });
      throw new Error("expected SearchRequestError");
    } catch (e) {
      expect(e).toBeInstanceOf(SearchRequestError);
      const fields = (e as SearchRequestError).errors.map((x) => x.field);
      expect(fields.some((f) => f.startsWith("filters.status"))).toBe(true);
      expect(fields).toContain("sorting.sortBy");
      expect(fields).toContain("pagination");
    }
    expect(() => parseSearchRequest("opportunities", { sorting: { sortBy: "custom" } })).toThrow(SearchRequestError);
  });
});

describe("filter operators and sorting", () => {
  it("evaluates each operator", () => {
    expect(matchesFilter("open", "eq", "open")).toBe(true);
    expect(matchesFilter("open", "neq", "closed")).toBe(true);
    expect(matchesFilter("open", "in", ["open", "closed"])).toBe(true);
    expect(matchesFilter("draft", "notIn", ["open", "closed"])).toBe(true);
    expect(matchesFilter("Rural Health Access", "like", "health")).toBe(true);
    expect(matchesFilter("Rural Health Access", "notLike", "arts")).toBe(true);
    expect(matchesFilter({ amount: "150000.00", currency: "USD" }, "gte", { amount: "100000", currency: "USD" })).toBe(true);
    expect(matchesFilter("2027-04-30", "between", { min: "2027-01-01", max: "2027-12-31" })).toBe(true);
    expect(matchesFilter("2028-04-30", "outside", { min: "2027-01-01", max: "2027-12-31" })).toBe(true);
    expect(matchesFilter(undefined, "gt", 1)).toBe(false);
    expect(matchesFilter("open", "near", "open")).toBe(false);
  });

  it("sorts by a dotted path with missing values last", () => {
    const rows = [{ k: { v: 2 } }, { k: {} }, { k: { v: 1 } }, { k: { v: 3 } }];
    expect(sortByPath(rows, "k.v", "asc").map((r) => r.k.v)).toEqual([1, 2, 3, undefined]);
    expect(sortByPath(rows, "k.v", "desc").map((r) => r.k.v)).toEqual([3, 2, 1, undefined]);
  });
});
