// SPDX-License-Identifier: AGPL-3.0-only
// The Google Sheets and Airtable import sources over the real ComposioClient and the real `fetch`,
// against a fake Composio served over HTTP on 127.0.0.1. The fake answers in the shapes of
// Composio's REST API v3.1 reference and records every request, so the tests check what the GMS
// would send. Nothing here calls Composio, Google or Airtable.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AIRTABLE_RECORDS_READ,
  AIRTABLE_SCHEMA_READ,
  ComposioAirtableSource,
  ComposioClient,
  ComposioError,
  ComposioSheetsSource,
  ConnectorAuthError,
  ConnectorScopeError,
  ConnectorScopeUnverifiedError,
  ConnectorUnavailableError,
  GOOGLE_SHEETS_READONLY,
  SourceReadError,
  TABULAR_TOOLS,
  airtableRefFrom,
  checkTabularScopes,
  sheetRange,
  spreadsheetIdFrom,
} from "../src/index.ts";

const KEY = "composio-test-key";
const ENTITY = "33333333-3333-4333-8333-333333333333";
const SHEETS_CONFIG = "ac_test_sheets";
const AIRTABLE_CONFIG = "ac_test_airtable";
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd";
const BASE = "appAbCdEfGhIjKlMn";
const TABLE = "tblAbCdEfGhIjKlMn";

interface Seen {
  method: string;
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown> | null;
  apiKey: string | undefined;
}
interface Account {
  id: string;
  status: string;
  authConfig: string;
  scope: string;
}

const state = {
  seen: [] as Seen[],
  accounts: [] as Account[],
  /** Tool slug → what the tool answers (status 200 unless `httpStatus`). */
  tools: {} as Record<string, (args: Record<string, unknown>) => { httpStatus?: number; body: unknown }>,
};

let server: Server;
let base: string;

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let s = "";
    req.on("data", (c: Buffer) => (s += c.toString("utf8")));
    req.on("end", () => resolve(s));
  });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const raw = await read(req);
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    state.seen.push({ method: req.method ?? "GET", path: url.pathname, query: Object.fromEntries(url.searchParams), body, apiKey: req.headers["x-api-key"] as string | undefined });
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.headers["x-api-key"] !== KEY) return send(401, { error: { message: "Invalid API key", code: 401, slug: "UNAUTHORIZED", status: 401 } });
    if (req.method === "GET" && url.pathname === "/api/v3.1/connected_accounts") {
      const cfg = url.searchParams.get("auth_config_ids");
      const user = url.searchParams.get("user_ids");
      return send(200, { items: state.accounts.filter((a) => a.authConfig === cfg && user === ENTITY).map((a) => ({ id: a.id, status: a.status })), next_cursor: null, total_pages: 1 });
    }
    const one = /^\/api\/v3\.1\/connected_accounts\/([\w-]+)$/.exec(url.pathname);
    if (one && req.method === "GET") {
      const a = state.accounts.find((x) => x.id === one[1]);
      if (!a) return send(404, { error: { message: "Connected account not found", code: 404, slug: "NOT_FOUND", status: 404 } });
      // The provider's token sits in state.val; the client must drop it.
      return send(200, { id: a.id, status: a.status, auth_config: { id: a.authConfig }, state: { authScheme: "OAUTH2", val: { status: a.status, access_token: "provider-token-never-kept", scope: a.scope } } });
    }
    if (one && req.method === "DELETE") {
      state.accounts = state.accounts.filter((x) => x.id !== one[1]);
      return send(200, { success: true });
    }
    if (req.method === "POST" && url.pathname === "/api/v3.1/connected_accounts/link") return send(201, { link_token: "lt_1", redirect_url: "https://connect.composio.dev/link/lt_1", expires_at: "2026-11-15T13:00:00Z", connected_account_id: "ca_pending" });
    const tool = /^\/api\/v3\.1\/tools\/execute\/([A-Z0-9_]+)$/.exec(url.pathname);
    if (tool && req.method === "POST") {
      const answer = state.tools[tool[1]!];
      if (!answer) return send(404, { error: { message: "Tool not found", code: 404, slug: "TOOL_NOT_FOUND", status: 404 } });
      const a = answer((body?.arguments ?? {}) as Record<string, unknown>);
      return send(a.httpStatus ?? 200, a.body);
    }
    return send(404, { error: { message: "Not found", code: 404, slug: "NOT_FOUND", status: 404 } });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  state.seen = [];
  state.accounts = [];
  state.tools = {};
});

const client = (apiKey = KEY) => new ComposioClient({ apiKey, baseUrl: base });
const sheets = (apiKey = KEY) => new ComposioSheetsSource({ client: client(apiKey), authConfigId: SHEETS_CONFIG, callbackUrl: (_e, returnTo) => `https://app.gms.test${returnTo ?? "/"}?connected=google_sheets` });
const airtable = () => new ComposioAirtableSource({ client: client(), authConfigId: AIRTABLE_CONFIG, callbackUrl: () => "https://app.gms.test/?connected=airtable" });
const ok = (data: unknown) => () => ({ body: { data, error: null, successful: true, log_id: "log_1" } });
const toolCalls = () => state.seen.filter((s) => s.path.startsWith("/api/v3.1/tools/execute/"));

describe("links the person pastes", () => {
  it("reads the spreadsheet id from a Google Sheets link", () => {
    expect(spreadsheetIdFrom(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`)).toBe(SHEET_ID);
    expect(spreadsheetIdFrom(`https://docs.google.com/spreadsheets/u/1/d/${SHEET_ID}/edit`)).toBe(SHEET_ID);
    expect(spreadsheetIdFrom(SHEET_ID)).toBe(SHEET_ID);
    expect(spreadsheetIdFrom(`https://evil.example/spreadsheets/d/${SHEET_ID}/edit`)).toBeNull();
    expect(spreadsheetIdFrom("http://docs.google.com/spreadsheets/d/" + SHEET_ID)).toBeNull();
  });
  it("reads the base and table from an Airtable link", () => {
    expect(airtableRefFrom(`https://airtable.com/${BASE}/${TABLE}/viwAbCdEfGhIjKlMn?blocks=hide`)).toEqual({ baseId: BASE, tableId: TABLE });
    expect(airtableRefFrom(`https://airtable.com/${BASE}`)).toEqual({ baseId: BASE, tableId: null });
    expect(airtableRefFrom(BASE)).toEqual({ baseId: BASE, tableId: null });
    expect(airtableRefFrom("https://airtable.example/appAbCdEfGhIjKlMn")).toBeNull();
  });
  it("bounds the Sheets range to the header, 5,000 rows and one more", () => {
    expect(sheetRange("Grants 2024", 5000)).toBe("'Grants 2024'!A1:GR5002");
    expect(sheetRange("Bob's", 10)).toBe("'Bob''s'!A1:GR12");
  });
});

describe("scope checks", () => {
  it("allows read access only", () => {
    expect(checkTabularScopes("google_sheets", `${GOOGLE_SHEETS_READONLY} openid email`)).toEqual({ ok: true, excess: [], missing: [] });
    expect(checkTabularScopes("google_sheets", "https://www.googleapis.com/auth/spreadsheets").ok).toBe(false);
    expect(checkTabularScopes("google_sheets", `${GOOGLE_SHEETS_READONLY} https://www.googleapis.com/auth/drive.readonly`).excess).toEqual(["https://www.googleapis.com/auth/drive.readonly"]);
    expect(checkTabularScopes("airtable", `${AIRTABLE_RECORDS_READ} ${AIRTABLE_SCHEMA_READ}`).ok).toBe(true);
    expect(checkTabularScopes("airtable", `${AIRTABLE_RECORDS_READ} data.records:write`).excess).toEqual(["data.records:write"]);
    expect(checkTabularScopes("airtable", AIRTABLE_RECORDS_READ).missing).toEqual([AIRTABLE_SCHEMA_READ]);
  });
});

describe("Google Sheets through Composio", () => {
  it("is not connected without an account, and makes a connect link only when asked", async () => {
    expect(await sheets().status(ENTITY)).toEqual({ connected: false, connectUrl: null });
    expect(state.seen.some((s) => s.path.endsWith("/link"))).toBe(false);
    const linked = await sheets().status(ENTITY, { link: true, returnTo: "/w/alder-creek/import" });
    expect(linked).toEqual({ connected: false, connectUrl: "https://connect.composio.dev/link/lt_1" });
    const link = state.seen.find((s) => s.path === "/api/v3.1/connected_accounts/link")!;
    expect(link.body).toEqual({ auth_config_id: SHEETS_CONFIG, user_id: ENTITY, callback_url: "https://app.gms.test/w/alder-creek/import?connected=google_sheets" });
    expect(state.seen.find((s) => s.path === "/api/v3.1/connected_accounts")!.query).toMatchObject({ user_ids: ENTITY, auth_config_ids: SHEETS_CONFIG });
    expect(state.seen.every((s) => s.apiKey === KEY)).toBe(true);
  });

  it("lists the tabs and reads one bounded range with the read tools only", async () => {
    state.accounts = [{ id: "ca_sheets_1", status: "ACTIVE", authConfig: SHEETS_CONFIG, scope: `${GOOGLE_SHEETS_READONLY} openid` }];
    state.tools[TABULAR_TOOLS.sheetNames] = ok({ sheet_names: ["Grants 2024", "Notes"] });
    state.tools[TABULAR_TOOLS.valuesGet] = ok({ range: "'Grants 2024'!A1:GR5002", majorDimension: "ROWS", values: [["Organization", "Amount"], ["Alder Creek", 50000], ["Pine Valley"]] });
    expect(await sheets().listSheets(ENTITY, SHEET_ID)).toEqual(["Grants 2024", "Notes"]);
    expect(await sheets().readSheet(ENTITY, SHEET_ID, "Grants 2024", 5000)).toEqual([["Organization", "Amount"], ["Alder Creek", "50000"], ["Pine Valley"]]);
    const calls = toolCalls();
    expect(calls.map((c) => c.path)).toEqual([`/api/v3.1/tools/execute/${TABULAR_TOOLS.sheetNames}`, `/api/v3.1/tools/execute/${TABULAR_TOOLS.valuesGet}`]);
    expect(calls[0]!.body).toEqual({ connected_account_id: "ca_sheets_1", user_id: ENTITY, arguments: { spreadsheet_id: SHEET_ID } });
    expect(calls[1]!.body).toEqual({ connected_account_id: "ca_sheets_1", user_id: ENTITY, arguments: { spreadsheet_id: SHEET_ID, range: "'Grants 2024'!A1:GR5002", value_render_option: "FORMATTED_VALUE", major_dimension: "ROWS" } });
  });

  it("reads the values wherever Composio nests them", async () => {
    state.accounts = [{ id: "ca_sheets_1", status: "ACTIVE", authConfig: SHEETS_CONFIG, scope: GOOGLE_SHEETS_READONLY }];
    state.tools[TABULAR_TOOLS.valuesGet] = ok({ response_data: { valueRanges: [{ values: [["A"], ["1"]] }] } });
    expect(await sheets().readSheet(ENTITY, SHEET_ID, "Sheet1", 10)).toEqual([["A"], ["1"]]);
  });

  it("deletes a connection holding write access, and refuses one whose scopes are unknown", async () => {
    state.accounts = [{ id: "ca_sheets_1", status: "ACTIVE", authConfig: SHEETS_CONFIG, scope: "https://www.googleapis.com/auth/spreadsheets" }];
    await expect(sheets().listSheets(ENTITY, SHEET_ID)).rejects.toBeInstanceOf(ConnectorScopeError);
    expect(state.accounts).toEqual([]);
    expect(toolCalls()).toEqual([]);
    state.accounts = [{ id: "ca_sheets_2", status: "ACTIVE", authConfig: SHEETS_CONFIG, scope: "" }];
    await expect(sheets().listSheets(ENTITY, SHEET_ID)).rejects.toBeInstanceOf(ConnectorScopeUnverifiedError);
    expect(state.accounts).toHaveLength(1);
  });

  it("ignores an account on another auth config", async () => {
    state.accounts = [{ id: "ca_other", status: "ACTIVE", authConfig: "ac_somebody_else", scope: GOOGLE_SHEETS_READONLY }];
    await expect(sheets().listSheets(ENTITY, SHEET_ID)).rejects.toBeInstanceOf(ConnectorAuthError);
    expect(toolCalls()).toEqual([]);
  });

  it("turns a failed tool into one plain sentence, and a refused key into an auth error", async () => {
    state.accounts = [{ id: "ca_sheets_1", status: "ACTIVE", authConfig: SHEETS_CONFIG, scope: GOOGLE_SHEETS_READONLY }];
    state.tools[TABULAR_TOOLS.sheetNames] = () => ({ body: { data: {}, error: "Requested entity was not found. (internal detail)", successful: false } });
    const err = await sheets().listSheets(ENTITY, SHEET_ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceReadError);
    expect((err as Error).message).not.toContain("internal detail");
    await expect(sheets("wrong-key").listSheets(ENTITY, SHEET_ID)).rejects.toBeInstanceOf(ConnectorAuthError);
    state.tools[TABULAR_TOOLS.sheetNames] = () => ({ httpStatus: 500, body: { error: { message: "boom", code: 500, slug: "INTERNAL", status: 500 } } });
    await expect(sheets().listSheets(ENTITY, SHEET_ID)).rejects.toBeInstanceOf(ConnectorUnavailableError);
  });

  it("never sends a spreadsheet id that is not one", async () => {
    await expect(sheets().readSheet(ENTITY, "../../etc", "Sheet1", 10)).rejects.toBeInstanceOf(SourceReadError);
    expect(state.seen).toEqual([]);
  });

  it("disconnects every account the workspace has on the auth config", async () => {
    state.accounts = [
      { id: "ca_a", status: "ACTIVE", authConfig: SHEETS_CONFIG, scope: GOOGLE_SHEETS_READONLY },
      { id: "ca_b", status: "INITIALIZING", authConfig: SHEETS_CONFIG, scope: "" },
      { id: "ca_c", status: "ACTIVE", authConfig: AIRTABLE_CONFIG, scope: AIRTABLE_RECORDS_READ },
    ];
    await sheets().disconnect(ENTITY);
    expect(state.accounts.map((a) => a.id)).toEqual(["ca_c"]);
  });
});

describe("Airtable through Composio", () => {
  beforeEach(() => {
    state.accounts = [{ id: "ca_air_1", status: "ACTIVE", authConfig: AIRTABLE_CONFIG, scope: `${AIRTABLE_RECORDS_READ} ${AIRTABLE_SCHEMA_READ}` }];
  });

  it("reads the base schema, then the records page by page", async () => {
    state.tools[TABULAR_TOOLS.baseSchema] = ok({ tables: [{ id: TABLE, name: "Grants", primaryFieldId: "fld1", fields: [{ id: "fld1", name: "Organization", type: "singleLineText" }, { id: "fld2", name: "Amount", type: "currency" }] }, { id: "not-a-table", name: "x" }] });
    let page = 0;
    state.tools[TABULAR_TOOLS.listRecords] = (args) => {
      page++;
      return args.offset ? ok({ records: [{ id: "rec3", createdTime: "2026-01-01T00:00:00.000Z", fields: { Organization: "River" } }] })() : ok({ records: [{ id: "rec1", fields: { Organization: "Alder", Amount: "$50,000.00" } }, { id: "rec2", fields: { Organization: "Pine" } }], offset: "itrNext/rec2" })();
    };
    expect(await airtable().listTables(ENTITY, BASE)).toEqual([{ id: TABLE, name: "Grants", fields: ["Organization", "Amount"] }]);
    const records = await airtable().listRecords(ENTITY, BASE, TABLE, 5000);
    expect(records.map((r) => r.id)).toEqual(["rec1", "rec2", "rec3"]);
    expect(page).toBe(2);
    const calls = toolCalls();
    expect(calls[0]!.body).toEqual({ connected_account_id: "ca_air_1", user_id: ENTITY, arguments: { baseId: BASE } });
    expect(calls[1]!.body!.arguments).toEqual({ baseId: BASE, tableIdOrName: TABLE, pageSize: 100, maxRecords: 5001, cellFormat: "string", timeZone: "utc", userLocale: "en-us" });
    expect((calls[2]!.body!.arguments as Record<string, unknown>).offset).toBe("itrNext/rec2");
  });

  it("stops one record past the limit, so the caller can say there are too many", async () => {
    state.tools[TABULAR_TOOLS.listRecords] = ok({ records: Array.from({ length: 100 }, (_, i) => ({ id: `rec${i}`, fields: { N: String(i) } })), offset: "more" });
    expect(await airtable().listRecords(ENTITY, BASE, TABLE, 150)).toHaveLength(151);
    expect(toolCalls()).toHaveLength(2);
  });

  it("needs both read scopes", async () => {
    state.accounts = [{ id: "ca_air_1", status: "ACTIVE", authConfig: AIRTABLE_CONFIG, scope: AIRTABLE_RECORDS_READ }];
    await expect(airtable().listTables(ENTITY, BASE)).rejects.toBeInstanceOf(ConnectorScopeUnverifiedError);
    expect(toolCalls()).toEqual([]);
  });
});

describe("the client", () => {
  it("never runs a tool on Composio's shared instant account", async () => {
    await expect(client().executeTool(TABULAR_TOOLS.valuesGet, { connectedAccountId: "instant_account", userId: ENTITY, arguments: {} })).rejects.toBeInstanceOf(ComposioError);
    expect(state.seen).toEqual([]);
  });
});
