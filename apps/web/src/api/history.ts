// SPDX-License-Identifier: AGPL-3.0-only
// Imported history (v1.12.0): a funder's past applications, reviews and reports from the system it
// used before, read-only. `createHttpHistoryApi` calls the GMS Worker (/gms/history);
// `createMockHistoryApi` (mocks/history.ts) answers from the page's import store in mock mode.
import { ApiError } from "./client.ts";
import type { components } from "./schema.d.ts";

type S = components["schemas"];

export type HistoryList = S["Models.HistoryList"];
export type HistoryApplication = S["Models.HistoryApplication"];
export type HistoryApplicationDetail = S["Models.HistoryApplicationDetail"];
export type HistoryReview = S["Models.HistoryReview"];
export type HistoryReport = S["Models.HistoryReport"];
export type HistoryOutcome = S["Models.HistoryOutcome"];
export type HistoryReportState = S["Models.HistoryReportState"];

export type HistoryQuery = { organization: string } | { award: string };

export interface HistoryApi {
  /** Imported history about one organization (its workspace id) or one award (its `awd_` id). */
  list(query: HistoryQuery): Promise<HistoryList>;
  /** One past application with its answers and reviews. */
  application(id: string): Promise<HistoryApplicationDetail>;
  /** A file imported with a past report or a past application. */
  file(kind: "report" | "application", id: string, docId: string): Promise<Blob>;
}

export interface HttpHistoryOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  workspaceId: () => string | null;
  fetch?: typeof fetch;
}

export function createHttpHistoryApi(opts: HttpHistoryOptions): HistoryApi {
  async function get(path: string): Promise<Response> {
    const token = await opts.token();
    const workspaceId = opts.workspaceId();
    const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}${path}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(workspaceId ? { "X-GMS-Workspace": workspaceId } : {}) } });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { message?: string; errors?: unknown[] };
      throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, (json.errors ?? []) as never);
    }
    return res;
  }
  const json = async <T>(path: string) => ((await (await get(path)).json()) as { data: T }).data;
  const e = encodeURIComponent;
  return {
    list: (q) => json("organization" in q ? `/gms/history?organization=${e(q.organization)}` : `/gms/history?award=${e(q.award)}`),
    application: (id) => json(`/gms/history/applications/${e(id)}`),
    file: async (kind, id, docId) => (await get(`/gms/history/${kind === "report" ? "reports" : "applications"}/${e(id)}/files/${e(docId)}`)).blob(),
  };
}
