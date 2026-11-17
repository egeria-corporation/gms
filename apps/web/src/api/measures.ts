// SPDX-License-Identifier: AGPL-3.0-only
// The growth measures for OpenGrants' operators (F3, api/measures.tsp, docs/measures.md): nine
// counts with their 90-day targets, deals lost by reason, and Google Search Console (read only).
// A signed-in person who is an operator only; the server refuses everyone else, agents included.
//
// `createHttpMeasuresApi` calls the GMS Worker; `createMockMeasuresApi` (mocks/measures.ts)
// implements the same interface in the browser.
import { ApiError } from "./client.ts";
import type { components } from "./schema.d.ts";

type S = components["schemas"];
export type OperatorMeasures = S["Models.OperatorMeasures"];
export type LostDealReason = S["Models.LostDealReason"];
export type LostDealInput = S["Models.LostDealInput"];
export type LostDealRecorded = S["Models.LostDealRecorded"];
export type SearchConsoleState = S["Models.SearchConsoleState"];
export type SearchConsoleConnect = S["Models.SearchConsoleConnect"];
export type SearchConsoleDisconnected = S["Models.SearchConsoleDisconnected"];
export type SearchConsoleSiteChosen = S["Models.SearchConsoleSiteChosen"];
export type SearchConsoleReport = S["Models.SearchConsoleReport"];
export type PageKind = S["Models.PageKind"];
export type OrganicSource = S["Models.OrganicSource"];

/** The order the reasons are offered and counted in (the server's LOST_DEAL_REASONS). */
export const LOST_DEAL_REASONS: readonly LostDealReason[] = ["forms", "reviews", "reporting", "payments", "procurement", "languages", "integrations", "data_migration", "support", "went_elsewhere", "timing", "no_decision", "other"];

/** The page Composio returns the browser to after the Google sign-in (the server's MEASURES_PAGE). */
export const MEASURES_PATH = "/operator/measures";

export interface MeasuresApi {
  isOperator(): Promise<boolean>;
  measures(): Promise<OperatorMeasures>;
  recordLostDeal(input: LostDealInput): Promise<LostDealRecorded>;
  searchConsole(): Promise<SearchConsoleState>;
  /** Start (or finish) connecting: a Composio-hosted Google sign-in URL until connected. */
  connectSearchConsole(): Promise<SearchConsoleConnect>;
  disconnectSearchConsole(): Promise<SearchConsoleDisconnected>;
  chooseSite(siteUrl: string): Promise<SearchConsoleSiteChosen>;
  searchConsoleReport(): Promise<SearchConsoleReport>;
}

export interface HttpMeasuresOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  fetch?: typeof fetch;
}

export function createHttpMeasuresApi(opts: HttpMeasuresOptions): MeasuresApi {
  async function data<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await opts.token();
    const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as { message?: string; errors?: unknown[]; data?: T };
    if (!res.ok) throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, json.errors ?? []);
    return json.data as T;
  }
  return {
    isOperator: async () => (await data<{ operator: boolean }>("GET", "/gms/operator/me")).operator,
    measures: () => data("GET", "/gms/operator/measures"),
    recordLostDeal: (input) => data("POST", "/gms/operator/lost-deals", input),
    searchConsole: () => data("GET", "/gms/operator/search-console"),
    connectSearchConsole: () => data("POST", "/gms/operator/search-console/connect", {}),
    disconnectSearchConsole: () => data("DELETE", "/gms/operator/search-console"),
    chooseSite: (siteUrl) => data("PUT", "/gms/operator/search-console/site", { siteUrl }),
    searchConsoleReport: () => data("GET", "/gms/operator/search-console/report"),
  };
}
