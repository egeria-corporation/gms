// SPDX-License-Identifier: AGPL-3.0-only
// Import from a spreadsheet: the port behind the import wizard. A funder imports its grant history,
// an applicant its applications; from a CSV or Excel file, Google Sheets or Airtable. Sensitive
// columns are dropped by the server before anything comes back. `createHttpImportsApi` calls the GMS
// Worker (/gms/imports); `createMockImportsApi` (mocks/imports.ts) implements the same interface in
// the browser with the same framework (@gms/importers). v1.8.0 adds importer adapters: a grants
// system's export with its preset mapping, Fluxx and Zengine read with the funder's own
// credentials, and the files of a system's zip attached to the imported awards.
import { ApiError } from "./client.ts";
import type { components } from "./schema.d.ts";

type S = components["schemas"];

export type ImportTarget = S["Models.ImportTarget"];
export type ImportSourceKind = S["Models.ImportSourceKind"];
export type ImportSourceInput = S["Models.ImportSource"];
export type ImportSources = S["Models.ImportSources"];
export type ImportField = S["Models.ImportField"];
export type ImportRead = S["Models.ImportRead"];
export type ImportPreview = S["Models.ImportPreview"];
export type ImportPreviewRow = S["Models.ImportPreviewRow"];
export type ImportRun = S["Models.ImportRun"];
export type ImportRunDetail = S["Models.ImportRunDetail"];
export type ImportCommitted = S["Models.ImportCommitted"];
export type ImportTotal = S["Models.ImportTotal"];
export type DroppedColumn = S["Models.DroppedColumn"];
export type ConnectedApp = "google_sheets" | "airtable";
export type ImportAdapter = S["Models.ImportAdapter"];
export type ImportAdapterKey = S["Models.ImportAdapterKey"];
export type ImportPuller = S["Models.ImportPuller"];
export type ImportPullerConnection = S["Models.ImportPullerConnection"];
export type ZengineForm = S["Models.ZengineForm"];
export type ImportFilesMatch = S["Models.ImportFilesMatch"];
export type ImportFile = S["Models.ImportFile"];
export type ImportFileAttached = S["Models.ImportFileAttached"];
export type PullerCredentials = S["Models.FluxxConnectInput"] | S["Models.ZengineConnectInput"];

export interface ImportsApi {
  sources(target: ImportTarget): Promise<ImportSources>;
  /** `adapter`: the grants system the export is from; left out, the file is recognised by its header row when it can be. */
  read(target: ImportTarget, source: ImportSourceInput, adapter?: ImportAdapterKey): Promise<ImportRead>;
  preview(input: { target: ImportTarget; source: ImportSourceInput; mapping: Record<string, string>; saveMapping: boolean; adapter?: ImportAdapterKey }): Promise<ImportPreview>;
  /** One batch; call again until `done`. */
  commit(runId: string): Promise<ImportCommitted>;
  run(runId: string): Promise<ImportRunDetail>;
  /** Start connecting Google Sheets or Airtable: the link to Composio's sign-in, or none when already connected. */
  connect(app: ConnectedApp, returnTo: string): Promise<{ connected: boolean; connectUrl: string | null }>;
  /** Connect Fluxx or Zengine with the funder's own credentials (checked, stored encrypted, never returned). */
  connectPuller(provider: ImportPuller, credentials: PullerCredentials): Promise<ImportPullerConnection>;
  disconnectPuller(provider: ImportPuller): Promise<ImportPullerConnection>;
  zengineForms(): Promise<ZengineForm[]>;
  /** Match a zip's paths (never its files) to the awards a finished import created. */
  matchFiles(runId: string, paths: string[]): Promise<ImportFilesMatch>;
  /** Attach one matched file to its award. */
  attachFile(runId: string, input: { path: string; contentBase64: string }): Promise<ImportFileAttached>;
  files(runId: string): Promise<ImportFile[]>;
}

export interface HttpImportsOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  workspaceId: () => string | null;
  fetch?: typeof fetch;
}

export function createHttpImportsApi(opts: HttpImportsOptions): ImportsApi {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
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
    const json = (await res.json().catch(() => ({}))) as { data?: T; message?: string; errors?: unknown[] };
    if (!res.ok) throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, (json.errors ?? []) as never);
    return json.data as T;
  }
  const e = encodeURIComponent;
  return {
    sources: (target) => call("GET", `/gms/imports/sources?target=${e(target)}`),
    read: (target, source, adapter) => call("POST", "/gms/imports/read", { target, source, ...(adapter ? { adapter } : {}) }),
    preview: (input) => call("POST", "/gms/imports/preview", input),
    commit: (runId) => call("POST", `/gms/imports/runs/${e(runId)}/commit`, {}),
    run: (runId) => call("GET", `/gms/imports/runs/${e(runId)}`),
    connect: async (app, returnTo) => {
      const r = await call<{ connected: boolean; connectUrl?: string | null }>("POST", `/gms/connectors/${e(app)}`, { returnTo });
      return { connected: r.connected, connectUrl: r.connectUrl ?? null };
    },
    connectPuller: (provider, credentials) => call("POST", `/gms/imports/connections/${e(provider)}`, credentials),
    disconnectPuller: (provider) => call("DELETE", `/gms/imports/connections/${e(provider)}`),
    zengineForms: () => call("GET", "/gms/imports/zengine/forms"),
    matchFiles: (runId, paths) => call("POST", `/gms/imports/runs/${e(runId)}/files/match`, { paths }),
    attachFile: (runId, input) => call("POST", `/gms/imports/runs/${e(runId)}/files`, input),
    files: (runId) => call("GET", `/gms/imports/runs/${e(runId)}/files`),
  };
}

/** The target a workspace imports into: a funder's grant history, an applicant's applications. */
export const targetFor = (kind: "funder" | "applicant"): ImportTarget => (kind === "funder" ? "award_history" : "outside_applications");

/** Bytes as base64, in chunks (a large file would overflow one call's arguments). */
export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A file as the API takes it. CSV and a JSON export are read as text; an Excel workbook is sent base64. */
export async function fileSource(file: File): Promise<ImportSourceInput> {
  if (/\.json$/i.test(file.name) || file.type === "application/json") return { kind: "json", text: await file.text(), fileName: file.name };
  if (/\.xlsx$/i.test(file.name) || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { kind: "xlsx", base64: btoa(bin), fileName: file.name };
  }
  return { kind: "csv", text: await file.text(), fileName: file.name };
}
