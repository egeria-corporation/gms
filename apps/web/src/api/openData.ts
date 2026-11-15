// SPDX-License-Identifier: AGPL-3.0-only
// The open data port (api/open-data.tsp, docs/open-data.md): the export summary for the Reporting
// panel, the 360Giving and CommonGrants downloads, the funder's 360Giving prefix and public feed
// switch, and the per-award confidential mark. `createHttpOpenDataApi` calls the GMS Worker;
// `createMockOpenDataApi` (mocks/openData.ts) implements the same interface in the browser.
import { ApiError } from "./client.ts";
import type { Money } from "./types.ts";

export type OpenDataReason = "not_accepted" | "cancelled" | "individual" | "no_organization" | "confidential" | "unlisted" | "no_amount";

/** Award dates, inclusive; null for no bound. */
export interface OpenDataRange {
  from: string | null;
  to: string | null;
}

export interface OpenDataAwardRow {
  awardId: string;
  title: string;
  /** "An individual" for an award to a person: the panel never shows a person's name. */
  recipientName: string;
  awardedAmount: Money | null;
  awardDate: string;
  status: string;
  exported: boolean;
  reason: OpenDataReason | null;
  reasonLabel: string | null;
  /** Exported by name only: the recipient is not verified with Passport or does not share its record. */
  nameOnly: boolean;
  confidential: boolean;
}

export interface OpenDataSettings {
  threeSixtyGivingPrefix: string | null;
  publishFeed: boolean;
}

export interface OpenDataSummary {
  range: OpenDataRange;
  /** Every year the funder has awards in, newest first. */
  years: number[];
  settings: OpenDataSettings;
  /** No registered prefix: the 360Giving file is a draft. */
  draft: boolean;
  registerUrl: string;
  feedUrl: string | null;
  license: { name: string; url: string };
  counts: { inRange: number; exported: number; leftOut: number; nameOnly: number };
  leftOut: { reason: OpenDataReason; label: string; count: number }[];
  commonGrants: { opportunities: number; awards: number };
  awards: OpenDataAwardRow[];
  awardsShown: number;
}

export type OpenDataFormat = "360giving-json" | "360giving-csv" | "commongrants-json";
export interface OpenDataFile {
  filename: string;
  blob: Blob;
}

export interface OpenDataApi {
  summary(range: OpenDataRange): Promise<OpenDataSummary>;
  /** `draft`: what the summary said, for the file name (a browser cannot always read the draft header across origins). */
  download(format: OpenDataFormat, range: OpenDataRange, draft?: boolean): Promise<OpenDataFile>;
  /** A workspace admin, signed in. Publishing needs a prefix. */
  saveSettings(patch: Partial<OpenDataSettings>): Promise<OpenDataSettings & { feedUrl: string | null }>;
  setConfidential(awardId: string, confidential: boolean): Promise<{ awardId: string; confidential: boolean }>;
}

export const FORMAT_PATHS: Record<OpenDataFormat, string> = {
  "360giving-json": "/gms/open-data/360giving.json",
  "360giving-csv": "/gms/open-data/360giving.csv",
  "commongrants-json": "/gms/open-data/commongrants.json",
};

/** `?from=&to=`, or `?year=` when the range is one whole calendar year. */
export function rangeQuery(r: OpenDataRange): string {
  const year = r.from && r.to && r.from.slice(0, 4) === r.to.slice(0, 4) && r.from.endsWith("-01-01") && r.to.endsWith("-12-31") ? r.from.slice(0, 4) : null;
  const q = new URLSearchParams(year ? { year } : { ...(r.from ? { from: r.from } : {}), ...(r.to ? { to: r.to } : {}) });
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** A stable file name, the way the server names it (the browser cannot read Content-Disposition across origins). */
export function fileNameFor(format: OpenDataFormat, handle: string, range: OpenDataRange, draft: boolean): string {
  const stem = `${handle.replace(/[^A-Za-z0-9_-]+/g, "_")}-${range.from || range.to ? `${range.from ?? "start"}-to-${range.to ?? "latest"}` : "all"}`;
  if (format === "commongrants-json") return `commongrants-${stem}.json`;
  return `360giving-${stem}${draft ? "-DRAFT" : ""}.${format === "360giving-csv" ? "csv" : "json"}`;
}

export interface HttpOpenDataOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  workspaceId: () => string | null;
  handle: () => string | null;
  fetch?: typeof fetch;
}

export function createHttpOpenDataApi(opts: HttpOpenDataOptions): OpenDataApi {
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
  const data = async <T>(method: string, path: string, body?: unknown): Promise<T> => ((await (await send(method, path, body)).json()) as { data: T }).data;
  return {
    summary: (range) => data<OpenDataSummary>("GET", `/gms/open-data/summary${rangeQuery(range)}`),
    download: async (format, range, hint = false) => {
      const res = await send("GET", `${FORMAT_PATHS[format]}${rangeQuery(range)}`);
      const draft = hint || res.headers.get("X-Open-Data-Draft") === "true";
      return { filename: fileNameFor(format, opts.handle() ?? "funder", range, draft), blob: await res.blob() };
    },
    saveSettings: (patch) => data("PUT", "/gms/open-data/settings", patch),
    setConfidential: (awardId, confidential) => data("PUT", `/gms/open-data/awards/${encodeURIComponent(awardId)}/confidential`, { confidential }),
  };
}
