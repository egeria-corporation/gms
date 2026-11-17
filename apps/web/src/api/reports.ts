// SPDX-License-Identifier: AGPL-3.0-only
// The report builder for a funder workspace (api/reports.tsp): data sets and their whitelisted
// columns, previews and CSV downloads of a definition, saved and starter views, schedules to
// members of the workspace, and the scheduled files sent to the signed-in person.
//
// `createHttpReportsApi` calls the GMS Worker; `createMockReportsApi` (mocks/reports.ts)
// implements the same interface in the browser.
import { LOCALE_QUERY } from "@gms/i18n";
import { ApiError } from "./client.ts";
import { getLocale } from "../i18n/current.ts";
import type { ExportFile } from "./outside.ts";

export type DataSetKey = "applications" | "awards" | "payments" | "requirements" | "organizations" | "history";
export type ColumnType = "text" | "number" | "money" | "date" | "status";
export type StatusKind = "application" | "award" | "tranche" | "requirement";
export type Cell = string | number | null;

export interface ColumnInfo {
  key: string;
  label: string;
  type: ColumnType;
  source: string;
  aggregatable: boolean;
  values?: string[];
  statusKind?: StatusKind;
  note?: string;
}
export interface DataSet {
  key: DataSetKey;
  label: string;
  description: string;
  available: boolean;
  columns: ColumnInfo[];
}

export type Filter = { column: string; op: "eq"; value: string | number | null } | { column: string; op: "in"; values: (string | number)[] } | { column: string; op: "between"; from?: string | number; to?: string | number };
export interface Aggregate {
  fn: "count" | "sum" | "avg";
  column?: string;
}
export interface SortSpec {
  column: string;
  dir: "asc" | "desc";
}
export interface Definition {
  dataSet: DataSetKey;
  columns: string[];
  filters: Filter[];
  groupBy: string[];
  aggregates: Aggregate[];
  sort: SortSpec[];
}

export interface OutColumn {
  key: string;
  label: string;
  type: ColumnType;
  statusKind?: StatusKind;
  note?: string;
}
export interface ReportResult {
  dataSet: DataSetKey;
  columns: OutColumn[];
  rows: Cell[][];
  total: number;
  truncated: boolean;
  warnings: string[];
  asOf: string;
  limit: number;
}

export interface Person {
  userId: string;
  name: string;
}
export interface Schedule {
  cadence: "weekly" | "monthly";
  weekday: number | null;
  dayOfMonth: number | null;
  recipients: Person[];
  active: boolean;
  stoppedReason: string | null;
  lastSentAt: string | null;
  nextSendAt: string | null;
}
export interface ReportView {
  id: string;
  name: string;
  description: string | null;
  dataSet: DataSetKey;
  definition: Definition;
  visibility: "private" | "workspace";
  starter: boolean;
  owner: Person | null;
  mine: boolean;
  schedule: Schedule | null;
  createdAt: string | null;
  updatedAt: string | null;
}
export interface ViewList {
  starters: ReportView[];
  saved: ReportView[];
}
export interface ViewInput {
  name: string;
  description?: string | null;
  visibility: "private" | "workspace";
  definition: Definition;
}
export interface ScheduleInput {
  cadence: "weekly" | "monthly";
  weekday?: number;
  dayOfMonth?: number;
  recipientUserIds: string[];
}
export interface Recipient extends Person {
  role: string;
}
export interface ReportFile {
  id: string;
  viewId: string;
  viewName: string;
  period: string;
  rows: number;
  truncated: boolean;
  createdAt: string;
  expiresAt: string;
}

export interface ReportsApi {
  dataSets(): Promise<DataSet[]>;
  preview(definition: Definition): Promise<ReportResult>;
  exportCsv(definition: Definition, name?: string): Promise<ExportFile>;
  listViews(): Promise<ViewList>;
  getView(id: string): Promise<ReportView>;
  createView(input: ViewInput): Promise<ReportView>;
  updateView(id: string, patch: Partial<ViewInput>): Promise<ReportView>;
  deleteView(id: string): Promise<{ id: string; deleted: true }>;
  runView(id: string): Promise<ReportResult & { viewId: string; name: string }>;
  exportView(id: string): Promise<ExportFile>;
  recipients(id: string): Promise<Recipient[]>;
  setSchedule(id: string, input: ScheduleInput): Promise<ReportView>;
  stopSchedule(id: string): Promise<ReportView>;
  listFiles(): Promise<ReportFile[]>;
  downloadFile(id: string): Promise<ExportFile>;
}

export interface HttpReportsOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  workspaceId: () => string | null;
  fetch?: typeof fetch;
}

export function createHttpReportsApi(opts: HttpReportsOptions): ReportsApi {
  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    const token = await opts.token();
    const workspaceId = opts.workspaceId();
    const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(workspaceId ? { "X-GMS-Workspace": workspaceId } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { message?: string; errors?: unknown[] };
      throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, json.errors ?? []);
    }
    return res;
  }
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const json = (await (await send(method, path, body)).json().catch(() => ({}))) as { data?: T };
    return json.data as T;
  }
  async function file(method: string, path: string, fallback: string, body?: unknown): Promise<ExportFile> {
    // The page's language, so the server writes the CSV's header row in it (the browser's rewrite in
    // screens/funder/reportWords.ts stays as a fallback for a server that does not).
    const res = await send(method, `${path}${path.includes("?") ? "&" : "?"}${LOCALE_QUERY}=${getLocale()}`, body);
    const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get("Content-Disposition") ?? "")?.[1];
    return { filename: named ?? fallback, blob: await res.blob() };
  }
  const v = (id: string) => `/gms/report-views/${encodeURIComponent(id)}`;
  return {
    dataSets: () => call("GET", "/gms/reports/data-sets"),
    preview: (definition) => call("POST", "/gms/reports/preview", definition),
    exportCsv: (definition, name) => file("POST", "/gms/reports/export", "report.csv", { definition, ...(name ? { name } : {}) }),
    listViews: () => call("GET", "/gms/report-views"),
    getView: (id) => call("GET", v(id)),
    createView: (input) => call("POST", "/gms/report-views", input),
    updateView: (id, patch) => call("PATCH", v(id), patch),
    deleteView: (id) => call("DELETE", v(id)),
    runView: (id) => call("POST", `${v(id)}/run`),
    exportView: (id) => file("GET", `${v(id)}/export`, "report.csv"),
    recipients: (id) => call("GET", `${v(id)}/recipients`),
    setSchedule: (id, input) => call("PUT", `${v(id)}/schedule`, input),
    stopSchedule: (id) => call("DELETE", `${v(id)}/schedule`),
    listFiles: () => call("GET", "/gms/report-files"),
    downloadFile: (id) => file("GET", `/gms/report-files/${encodeURIComponent(id)}/download`, "report.csv"),
  };
}
