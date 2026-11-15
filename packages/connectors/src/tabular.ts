// SPDX-License-Identifier: AGPL-3.0-only
// Import sources in connected apps: a Google Sheets spreadsheet and an Airtable base, both through
// Composio, read-only. One Composio auth config per toolkit (COMPOSIO_GOOGLE_SHEETS_AUTH_CONFIG_ID,
// COMPOSIO_AIRTABLE_AUTH_CONFIG_ID), one entity per GMS workspace (the Composio `user_id` is the
// workspace id). Composio holds the provider's token; the GMS stores none.
//
// Only predefined read tools are executed, and only these four:
//   GOOGLESHEETS_GET_SHEET_NAMES   the tabs of the spreadsheet the person pasted the link to;
//   GOOGLESHEETS_VALUES_GET        one bounded range of one tab (header + up to 5,000 rows);
//   AIRTABLE_GET_BASE_SCHEMA       the tables and fields of the base the person pasted the link to;
//   AIRTABLE_LIST_RECORDS          the records of one table, 100 a page.
// Each connection's scopes are read from Composio and checked before every use, as for Google
// Workspace (./composio.ts): anything beyond read access deletes the connection.
//
// Request shapes were checked against docs.composio.dev on 2026-11-15 (docs/connectors.md lists the
// pages and what is still unverified). Nothing here has run against Composio.
import { ComposioError, ConnectorScopeError, ConnectorScopeUnverifiedError, normalizeScopes, type ComposioClient, type ConnectedAccount } from "./composio.ts";
import { ConnectorAuthError, ConnectorUnavailableError } from "./index.ts";

export type TabularProvider = "google_sheets" | "airtable";
export const TABULAR_PROVIDERS: readonly TabularProvider[] = ["google_sheets", "airtable"];

export const GOOGLE_SHEETS_READONLY = "https://www.googleapis.com/auth/spreadsheets.readonly";
export const AIRTABLE_RECORDS_READ = "data.records:read";
export const AIRTABLE_SCHEMA_READ = "schema.bases:read";

/** The tools a tabular connector may execute. Nothing else is ever sent to Composio's tool endpoint. */
export const TABULAR_TOOLS = {
  sheetNames: "GOOGLESHEETS_GET_SHEET_NAMES",
  valuesGet: "GOOGLESHEETS_VALUES_GET",
  baseSchema: "AIRTABLE_GET_BASE_SCHEMA",
  listRecords: "AIRTABLE_LIST_RECORDS",
} as const;

interface ScopeRules {
  label: string;
  allowed: ReadonlySet<string>;
  /** Never allowed, even if the allow-list were edited by mistake. */
  forbidden: readonly RegExp[];
  /** Every one of these must be granted for the connection to be usable. */
  required: readonly string[];
}

const RULES: Record<TabularProvider, ScopeRules> = {
  google_sheets: {
    label: "Google Sheets",
    allowed: new Set([GOOGLE_SHEETS_READONLY, "openid", "email", "profile", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"]),
    forbidden: [/\/auth\/spreadsheets$/, /\/auth\/drive/],
    required: [GOOGLE_SHEETS_READONLY],
  },
  airtable: {
    label: "Airtable",
    allowed: new Set([AIRTABLE_RECORDS_READ, AIRTABLE_SCHEMA_READ, "user.email:read"]),
    forbidden: [/:write$/, /:manage$/],
    required: [AIRTABLE_RECORDS_READ, AIRTABLE_SCHEMA_READ],
  },
};

export interface TabularScopeCheck {
  ok: boolean;
  excess: string[];
  /** Required scopes that were not granted. */
  missing: string[];
}

/** A connection passes only when every scope it holds is on the provider's read-only allow-list. */
export function checkTabularScopes(provider: TabularProvider, scopes: unknown): TabularScopeCheck {
  const r = RULES[provider];
  const list = normalizeScopes(scopes);
  const excess = list.filter((s) => !r.allowed.has(s) || r.forbidden.some((re) => re.test(s)));
  return { ok: excess.length === 0, excess, missing: r.required.filter((s) => !list.includes(s)) };
}

/** The provider read the request but refused it or found nothing (a wrong link, no access). */
export class SourceReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceReadError";
  }
}

// ------------------------------------------------------------------------------------- links

const SPREADSHEET_ID = /^[A-Za-z0-9_-]{20,128}$/;
const AIRTABLE_BASE = /^app[A-Za-z0-9]{14}$/;
const AIRTABLE_TABLE = /^tbl[A-Za-z0-9]{14}$/;

/** The spreadsheet id from a Google Sheets link (or the bare id). */
export function spreadsheetIdFrom(input: string): string | null {
  const v = input.trim();
  if (SPREADSHEET_ID.test(v)) return v;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.hostname !== "docs.google.com") return null;
    const m = /^\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,128})(?:\/|$)/.exec(u.pathname);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

/** The base (and table, when the link names one) from an Airtable link, or a bare base id. */
export function airtableRefFrom(input: string): { baseId: string; tableId: string | null } | null {
  const v = input.trim();
  if (AIRTABLE_BASE.test(v)) return { baseId: v, tableId: null };
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.hostname !== "airtable.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const baseId = parts.find((p) => AIRTABLE_BASE.test(p));
    if (!baseId) return null;
    return { baseId, tableId: parts.find((p) => AIRTABLE_TABLE.test(p)) ?? null };
  } catch {
    return null;
  }
}

export const isAirtableTableId = (v: string): boolean => AIRTABLE_TABLE.test(v);

// ------------------------------------------------------------------------------------- ports

export interface TabularConnection {
  readonly provider: TabularProvider;
  /** Whether the workspace is connected. With `link`, one that is not gets a Composio-hosted sign-in link. */
  status(entityId: string, opts?: { link?: boolean; returnTo?: string }): Promise<{ connected: boolean; connectUrl: string | null }>;
  disconnect(entityId: string): Promise<void>;
}

export interface SheetsSource extends TabularConnection {
  readonly provider: "google_sheets";
  /** The tabs of a spreadsheet, in order. */
  listSheets(entityId: string, spreadsheetId: string): Promise<string[]>;
  /** One tab as a grid of text, header first: at most `maxRows` rows after the header, plus one to tell when there are more. */
  readSheet(entityId: string, spreadsheetId: string, sheet: string, maxRows: number): Promise<string[][]>;
}

export interface AirtableTable {
  id: string;
  name: string;
  fields: string[];
}

export interface AirtableSource extends TabularConnection {
  readonly provider: "airtable";
  listTables(entityId: string, baseId: string): Promise<AirtableTable[]>;
  /** Records of one table, at most `maxRecords` plus one to tell when there are more. */
  listRecords(entityId: string, baseId: string, tableId: string, maxRecords: number): Promise<{ id: string; fields: Record<string, unknown> }[]>;
}

// ------------------------------------------------------------------------------- data shapes

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : Array.isArray(v) ? v.map(text).filter(Boolean).join(", ") : "");

/**
 * The value under `key`, looked for in the tool's `data` and in the objects Composio is known to
 * wrap a provider's answer in (`response_data`, `data`), up to three levels down. The tool reference
 * documents `data` only as an object, so the reader does not assume one nesting.
 */
export function dig(data: unknown, key: string): unknown {
  let level: Record<string, unknown>[] = [rec(data)];
  for (let depth = 0; depth < 4 && level.length; depth++) {
    for (const o of level) if (key in o) return o[key];
    level = level.flatMap((o) => Object.values(o).filter((v) => v && typeof v === "object" && !Array.isArray(v)).map(rec));
  }
  return undefined;
}

/** The tab names from GOOGLESHEETS_GET_SHEET_NAMES (`sheet_names`, or Google's `sheets[].properties.title`). */
export function sheetNamesOf(data: unknown): string[] {
  const named = dig(data, "sheet_names") ?? dig(data, "sheetNames");
  if (Array.isArray(named)) return named.map(text).filter(Boolean);
  const sheets = dig(data, "sheets");
  if (Array.isArray(sheets)) return sheets.map((s) => (typeof s === "string" ? s : text(rec(rec(s).properties).title) || text(rec(s).title))).filter(Boolean);
  return [];
}

/** The grid from GOOGLESHEETS_VALUES_GET (`values`, or the first of `valueRanges`). */
export function valuesOf(data: unknown): string[][] {
  let values = dig(data, "values");
  if (!Array.isArray(values)) {
    const ranges = dig(data, "valueRanges");
    values = Array.isArray(ranges) ? rec(ranges[0]).values : undefined;
  }
  return Array.isArray(values) ? values.map((row) => (Array.isArray(row) ? row.map(text) : [])) : [];
}

export function airtableTablesOf(data: unknown): AirtableTable[] {
  const tables = dig(data, "tables");
  return (Array.isArray(tables) ? tables : [])
    .map(rec)
    .flatMap((t) => {
      const id = text(t.id);
      if (!AIRTABLE_TABLE.test(id)) return [];
      return [{ id, name: text(t.name) || id, fields: (Array.isArray(t.fields) ? t.fields : []).map((f) => text(rec(f).name)).filter(Boolean) }];
    });
}

export function airtableRecordsOf(data: unknown): { records: { id: string; fields: Record<string, unknown> }[]; offset: string | null } {
  const records = dig(data, "records");
  const offset = dig(data, "offset");
  return {
    records: (Array.isArray(records) ? records : []).map(rec).flatMap((r) => (typeof r.id === "string" && r.id ? [{ id: r.id, fields: rec(r.fields) }] : [])),
    offset: typeof offset === "string" && offset ? offset : null,
  };
}

/** `'Tab name'!A1:GR5002`: header plus `maxRows` plus one, at most 200 columns. */
export function sheetRange(sheet: string, maxRows: number): string {
  return `'${sheet.replace(/'/g, "''")}'!A1:GR${maxRows + 2}`;
}

// ---------------------------------------------------------------------------- the connectors

export interface TabularConfig {
  client: ComposioClient;
  /** The auth config created for this toolkit with read-only scopes. */
  authConfigId: string;
  callbackUrl: (entityId: string, returnTo?: string) => string;
}

const AIRTABLE_PAGES = 60;

abstract class ComposioTabular implements TabularConnection {
  abstract readonly provider: TabularProvider;
  constructor(protected readonly cfg: TabularConfig) {
    if (!cfg.authConfigId) throw new Error("The Composio auth config id is not set");
  }

  protected get rules(): ScopeRules {
    return RULES[this.provider];
  }

  protected async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ComposioError) {
        if (e.status === 401 || e.status === 403 || e.status === 422) throw new ConnectorAuthError("composio");
        throw new ConnectorUnavailableError("composio", "Composio could not be reached");
      }
      throw e;
    }
  }

  /** The live connection, after the scope check; a connection holding more than read access is deleted. */
  protected async active(entityId: string): Promise<ConnectedAccount | null> {
    const listed = await this.cfg.client.listConnectedAccounts({ authConfigId: this.cfg.authConfigId, userId: entityId });
    const candidate = listed.find((a) => a.status === "ACTIVE");
    if (!candidate) return null;
    const account = await this.cfg.client.getConnectedAccount(candidate.id);
    if (account.status !== "ACTIVE" || account.authConfigId !== this.cfg.authConfigId) return null;
    if (!account.grantedScopes.length && !account.requestedScopes.length) throw new ConnectorScopeUnverifiedError(`The permissions of the ${this.rules.label} connection could not be read, so it is not being used. Disconnect and connect again.`);
    const scopes = checkTabularScopes(this.provider, [...account.grantedScopes, ...account.requestedScopes]);
    if (!scopes.ok) {
      await this.cfg.client.deleteConnectedAccount(account.id);
      throw new ConnectorScopeError(scopes.excess, `The ${this.rules.label} connection was given more than read access, so it was removed. Connect again; the GMS only ever reads.`);
    }
    if (scopes.missing.length) throw new ConnectorScopeUnverifiedError(`The ${this.rules.label} connection does not include read access to your data. Disconnect and connect again, and keep the permissions asked for.`);
    return account;
  }

  async status(entityId: string, opts: { link?: boolean; returnTo?: string } = {}): Promise<{ connected: boolean; connectUrl: string | null }> {
    return this.wrap(async () => {
      if (await this.active(entityId)) return { connected: true, connectUrl: null };
      if (!opts.link) return { connected: false, connectUrl: null };
      const link = await this.cfg.client.createConnectLink({ authConfigId: this.cfg.authConfigId, userId: entityId, callbackUrl: this.cfg.callbackUrl(entityId, opts.returnTo) });
      return { connected: false, connectUrl: link.redirectUrl };
    });
  }

  async disconnect(entityId: string): Promise<void> {
    await this.wrap(async () => {
      for (const a of await this.cfg.client.listConnectedAccounts({ authConfigId: this.cfg.authConfigId, userId: entityId })) await this.cfg.client.deleteConnectedAccount(a.id);
    });
  }

  /** Execute one read tool on the workspace's live connection. A tool that did not succeed is a {@link SourceReadError}. */
  protected async run(entityId: string, slug: (typeof TABULAR_TOOLS)[keyof typeof TABULAR_TOOLS], args: Record<string, unknown>, notReadable: string): Promise<unknown> {
    return this.wrap(async () => {
      const account = await this.active(entityId);
      if (!account) throw new ConnectorAuthError("composio");
      const r = await this.cfg.client.executeTool(slug, { connectedAccountId: account.id, userId: entityId, arguments: args });
      // The provider's own error text is not passed on: it can name internals. The person gets one plain sentence.
      if (!r.successful) throw new SourceReadError(notReadable);
      return r.data;
    });
  }
}

export class ComposioSheetsSource extends ComposioTabular implements SheetsSource {
  readonly provider = "google_sheets" as const;

  async listSheets(entityId: string, spreadsheetId: string): Promise<string[]> {
    if (!SPREADSHEET_ID.test(spreadsheetId)) throw new SourceReadError("That is not a Google Sheets link");
    const data = await this.run(entityId, TABULAR_TOOLS.sheetNames, { spreadsheet_id: spreadsheetId }, "Google Sheets could not open that spreadsheet. Check the link, and that the Google account you connected can open it");
    const names = sheetNamesOf(data);
    if (!names.length) throw new SourceReadError("The spreadsheet has no sheets to read");
    return names;
  }

  async readSheet(entityId: string, spreadsheetId: string, sheet: string, maxRows: number): Promise<string[][]> {
    if (!SPREADSHEET_ID.test(spreadsheetId)) throw new SourceReadError("That is not a Google Sheets link");
    const data = await this.run(entityId, TABULAR_TOOLS.valuesGet, { spreadsheet_id: spreadsheetId, range: sheetRange(sheet, maxRows), value_render_option: "FORMATTED_VALUE", major_dimension: "ROWS" }, `Google Sheets could not read the sheet "${sheet}"`);
    return valuesOf(data);
  }
}

export class ComposioAirtableSource extends ComposioTabular implements AirtableSource {
  readonly provider = "airtable" as const;

  async listTables(entityId: string, baseId: string): Promise<AirtableTable[]> {
    if (!AIRTABLE_BASE.test(baseId)) throw new SourceReadError("That is not an Airtable base link");
    const tables = airtableTablesOf(await this.run(entityId, TABULAR_TOOLS.baseSchema, { baseId }, "Airtable could not open that base. Check the link, and that the Airtable account you connected can open it"));
    if (!tables.length) throw new SourceReadError("The base has no tables to read");
    return tables;
  }

  async listRecords(entityId: string, baseId: string, tableId: string, maxRecords: number): Promise<{ id: string; fields: Record<string, unknown> }[]> {
    if (!AIRTABLE_BASE.test(baseId) || !AIRTABLE_TABLE.test(tableId)) throw new SourceReadError("That is not an Airtable table");
    const out: { id: string; fields: Record<string, unknown> }[] = [];
    let offset: string | null = null;
    for (let page = 0; page < AIRTABLE_PAGES; page++) {
      const data = await this.run(
        entityId,
        TABULAR_TOOLS.listRecords,
        // Text as Airtable shows it (linked records, selects and dates as words), in UTC.
        { baseId, tableIdOrName: tableId, pageSize: 100, maxRecords: maxRecords + 1, cellFormat: "string", timeZone: "utc", userLocale: "en-us", ...(offset ? { offset } : {}) },
        "Airtable could not read that table",
      );
      const r = airtableRecordsOf(data);
      out.push(...r.records);
      offset = r.offset;
      if (!offset || out.length > maxRecords) break;
    }
    return out.slice(0, maxRecords + 1);
  }
}

// ------------------------------------------------------------------------------------ fixtures

/** Stands in for Google Sheets in tests and local runs: spreadsheets by id, tabs by name. */
export class FixtureSheetsSource implements SheetsSource {
  readonly provider = "google_sheets" as const;
  connected = true;
  readonly reads: { entityId: string; spreadsheetId: string; sheet: string }[] = [];
  constructor(public spreadsheets: Record<string, Record<string, string[][]>> = {}) {}
  async status(entityId: string, opts: { link?: boolean } = {}) {
    if (this.connected) return { connected: true, connectUrl: null };
    return { connected: false, connectUrl: opts.link ? `https://composio.invalid/connect/google_sheets?entity=${encodeURIComponent(entityId)}` : null };
  }
  async disconnect() {
    this.connected = false;
  }
  async listSheets(_entityId: string, spreadsheetId: string) {
    if (!this.connected) throw new ConnectorAuthError("composio");
    const s = this.spreadsheets[spreadsheetId];
    if (!s) throw new SourceReadError("Google Sheets could not open that spreadsheet. Check the link, and that the Google account you connected can open it");
    return Object.keys(s);
  }
  async readSheet(entityId: string, spreadsheetId: string, sheet: string, maxRows: number) {
    if (!this.connected) throw new ConnectorAuthError("composio");
    this.reads.push({ entityId, spreadsheetId, sheet });
    const grid = this.spreadsheets[spreadsheetId]?.[sheet];
    if (!grid) throw new SourceReadError(`Google Sheets could not read the sheet "${sheet}"`);
    return grid.slice(0, maxRows + 2);
  }
}

/** Stands in for Airtable in tests and local runs. */
export class FixtureAirtableSource implements AirtableSource {
  readonly provider = "airtable" as const;
  connected = true;
  constructor(public bases: Record<string, { tables: AirtableTable[]; records: Record<string, { id: string; fields: Record<string, unknown> }[]> }> = {}) {}
  async status(entityId: string, opts: { link?: boolean } = {}) {
    if (this.connected) return { connected: true, connectUrl: null };
    return { connected: false, connectUrl: opts.link ? `https://composio.invalid/connect/airtable?entity=${encodeURIComponent(entityId)}` : null };
  }
  async disconnect() {
    this.connected = false;
  }
  async listTables(_entityId: string, baseId: string) {
    if (!this.connected) throw new ConnectorAuthError("composio");
    const b = this.bases[baseId];
    if (!b) throw new SourceReadError("Airtable could not open that base. Check the link, and that the Airtable account you connected can open it");
    return b.tables;
  }
  async listRecords(_entityId: string, baseId: string, tableId: string, maxRecords: number) {
    if (!this.connected) throw new ConnectorAuthError("composio");
    const r = this.bases[baseId]?.records[tableId];
    if (!r) throw new SourceReadError("Airtable could not read that table");
    return r.slice(0, maxRecords + 1);
  }
}
