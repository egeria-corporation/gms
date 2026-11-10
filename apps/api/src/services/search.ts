// SPDX-License-Identifier: AGPL-3.0-only
// POST /common-grants/opportunities/search: filters, sorting and pagination over the published
// set. The set is small enough to evaluate in memory with the protocol package's evaluator.
import { filtered, matchesFilter, parseSearchRequest, readPath, sortByPath, type OpportunityBase } from "@gms/protocol";
import { cgListOpportunities, type PublicContext } from "./public.ts";

const FILTER_PATHS: Record<string, string> = {
  status: "status.value",
  closeDateRange: "keyDates.closeDate.date",
  totalFundingAvailableRange: "funding.totalAmountAvailable",
  minAwardAmountRange: "funding.minAwardAmount",
  maxAwardAmountRange: "funding.maxAwardAmount",
};

const SORT_PATHS: Record<string, string> = {
  lastModifiedAt: "lastModifiedAt",
  createdAt: "createdAt",
  title: "title",
  "status.value": "status.value",
  "keyDates.closeDate": "keyDates.closeDate.date",
  "funding.maxAwardAmount": "funding.maxAwardAmount",
  "funding.minAwardAmount": "funding.minAwardAmount",
  "funding.totalAmountAvailable": "funding.totalAmountAvailable",
  "funding.estimatedAwardCount": "funding.estimatedAwardCount",
};

/** The most published opportunities one search evaluates. */
const SEARCH_WINDOW = 2000;

export async function cgSearchOpportunities(ctx: PublicContext, body: unknown) {
  const req = parseSearchRequest("opportunities", body);
  const { items: all } = await cgListOpportunities(ctx, { limit: SEARCH_WINDOW });
  const needle = req.search?.toLowerCase();
  let hits = all.filter((o: OpportunityBase) => {
    if (needle && !`${o.title} ${o.description ?? ""}`.toLowerCase().includes(needle)) return false;
    return req.parsedFilters.every((f) => matchesFilter(readPath(o, f.custom ? `customFields.${f.name}.value` : (FILTER_PATHS[f.name] ?? f.name)), f.operator, f.value));
  });
  const sortPath = req.sortInfo.sortBy === "custom" ? `customFields.${req.sortInfo.customSortBy}.value` : (SORT_PATHS[req.sortInfo.sortBy] ?? req.sortInfo.sortBy);
  hits = sortByPath(hits, sortPath, req.sortInfo.sortOrder);
  return filtered(hits.slice(req.page.offset, req.page.offset + req.page.pageSize), req.page, hits.length, req.sortInfo, req.filters);
}
