// SPDX-License-Identifier: AGPL-3.0-only
// Google Search Console for the operators' measures, over the real ComposioClient against a fake
// Composio (an in-process fetch answering in the shapes of Composio's REST API v3.1). Each test
// checks the tool slug and the exact arguments the GMS would send. Nothing here calls Composio.
import { beforeEach, describe, expect, it } from "vitest";
import {
  ComposioClient,
  ComposioSearchConsole,
  ConnectorAuthError,
  ConnectorScopeError,
  ConnectorScopeUnverifiedError,
  FixtureSearchConsole,
  SEARCH_CONSOLE_ENTITY,
  SEARCH_CONSOLE_TOOLS,
  SourceReadError,
  WEBMASTERS_READONLY,
  analyticsRowsOf,
  checkSearchConsoleScopes,
  searchAnalyticsArgs,
  searchConsolePort,
  sitesOf,
  type FetchLike,
} from "../src/index.ts";

const KEY = "composio-test-key";
const CONFIG = "ac_test_search_console";

interface Account {
  id: string;
  status: string;
  scope: string;
  userId?: string;
  authConfig?: string;
}
const state = {
  seen: [] as { method: string; path: string; query: string; body: Record<string, unknown> | null }[],
  accounts: [] as Account[],
  tools: {} as Record<string, (args: Record<string, unknown>) => { successful?: boolean; data: unknown }>,
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fakeFetch: FetchLike = async (input, init) => {
  const url = new URL(input);
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
  state.seen.push({ method: init?.method ?? "GET", path: url.pathname, query: url.search, body });
  if ((init?.headers as Record<string, string>)["x-api-key"] !== KEY) return json(401, { error: { message: "bad key" } });
  if (url.pathname === "/api/v3.1/connected_accounts") return json(200, { items: state.accounts.filter((a) => (a.userId ?? SEARCH_CONSOLE_ENTITY) === url.searchParams.get("user_ids")).map((a) => ({ id: a.id, status: a.status })) });
  if (url.pathname === "/api/v3.1/connected_accounts/link") return json(201, { connected_account_id: "ca_new", redirect_url: "https://connect.composio.example/start", expires_at: null });
  const one = /^\/api\/v3\.1\/connected_accounts\/([^/]+)$/.exec(url.pathname);
  if (one && init?.method === "DELETE") {
    state.accounts = state.accounts.filter((a) => a.id !== one[1]);
    return json(200, { success: true });
  }
  if (one) {
    const a = state.accounts.find((x) => x.id === one[1]);
    return a ? json(200, { id: a.id, status: a.status, user_id: a.userId ?? SEARCH_CONSOLE_ENTITY, auth_config: { id: a.authConfig ?? CONFIG }, state: { val: { scope: a.scope, access_token: "never-kept" } } }) : json(404, { error: { message: "not found" } });
  }
  const tool = /^\/api\/v3\.1\/tools\/execute\/([A-Z0-9_]+)$/.exec(url.pathname);
  if (tool) {
    const handler = state.tools[tool[1]!];
    if (!handler) return json(200, { successful: false, error: "no such tool in the fake", data: null });
    const r = handler((body?.arguments ?? {}) as Record<string, unknown>);
    return json(200, { successful: r.successful ?? true, error: r.successful === false ? "provider error text" : null, data: r.data });
  }
  return json(404, { error: { message: "unknown" } });
};
const client = () => new ComposioClient({ apiKey: KEY, baseUrl: "https://composio.example", fetch: fakeFetch });
const gsc = () => new ComposioSearchConsole({ client: client(), authConfigId: CONFIG, callbackUrl: (back) => `https://gms.test${back ?? "/"}?connected=google_search_console` });
const toolCalls = (slug: string) => state.seen.filter((s) => s.path === `/api/v3.1/tools/execute/${slug}`);

const QUERY = { siteUrl: "sc-domain:opengrants.io", startDate: "2026-10-15", endDate: "2026-11-13", dimensions: ["page"] as const, pageRegex: "^https://gms\\.opengrants\\.io/", rowLimit: 5000 };

beforeEach(() => {
  state.seen = [];
  state.accounts = [{ id: "ca_gsc", status: "ACTIVE", scope: `${WEBMASTERS_READONLY} openid email` }];
  state.tools = {};
});

describe("scopes", () => {
  it("allows read-only Search Console and sign-in identity, and nothing broader", () => {
    expect(checkSearchConsoleScopes(`${WEBMASTERS_READONLY} openid email profile`)).toEqual({ ok: true, excess: [], missing: [] });
    const full = "https://www.googleapis.com/auth/webmasters";
    expect(checkSearchConsoleScopes(`${WEBMASTERS_READONLY} ${full}`).excess).toEqual([full]);
    expect(checkSearchConsoleScopes(`${full}`)).toMatchObject({ ok: false, missing: [WEBMASTERS_READONLY] });
    for (const other of ["https://www.googleapis.com/auth/siteverification", "https://www.googleapis.com/auth/indexing", "https://www.googleapis.com/auth/analytics.readonly", "https://www.googleapis.com/auth/drive.readonly"]) {
      expect(checkSearchConsoleScopes(`${WEBMASTERS_READONLY} ${other}`).excess).toEqual([other]);
    }
  });

  it("deletes a connection holding more than read-only access before anything is read", async () => {
    state.accounts = [{ id: "ca_gsc", status: "ACTIVE", scope: `${WEBMASTERS_READONLY} https://www.googleapis.com/auth/webmasters` }];
    await expect(gsc().listSites()).rejects.toBeInstanceOf(ConnectorScopeError);
    expect(state.accounts).toEqual([]);
    expect(toolCalls(SEARCH_CONSOLE_TOOLS.listSites)).toHaveLength(0);
  });

  it("does not use a connection that reports no scopes, or lacks read-only access", async () => {
    state.accounts = [{ id: "ca_gsc", status: "ACTIVE", scope: "" }];
    await expect(gsc().status()).rejects.toBeInstanceOf(ConnectorScopeUnverifiedError);
    state.accounts = [{ id: "ca_gsc", status: "ACTIVE", scope: "openid email" }];
    await expect(gsc().status()).rejects.toBeInstanceOf(ConnectorScopeUnverifiedError);
    expect(state.accounts).toHaveLength(1);
  });

  it("only looks at the operators' entity on its own auth config, never a workspace's", async () => {
    state.accounts = [
      { id: "ca_ws", status: "ACTIVE", scope: WEBMASTERS_READONLY, userId: "44444444-4444-4444-8444-444444444444" },
      { id: "ca_other", status: "ACTIVE", scope: WEBMASTERS_READONLY, authConfig: "ac_someone_else" },
    ];
    expect(await gsc().status()).toEqual({ connected: false, connectUrl: null });
    expect(state.seen.filter((s) => s.path === "/api/v3.1/connected_accounts").every((s) => new URLSearchParams(s.query).get("user_ids") === SEARCH_CONSOLE_ENTITY)).toBe(true);
    expect(SEARCH_CONSOLE_ENTITY).not.toMatch(/^[0-9a-f]{8}-/);
  });
});

describe("connecting", () => {
  it("answers connected, or a Composio-hosted Google sign-in that returns to the measures page", async () => {
    expect(await gsc().status({ link: true })).toEqual({ connected: true, connectUrl: null });
    state.accounts = [];
    expect(await gsc().status({ link: true, returnTo: "/operator/measures" })).toEqual({ connected: false, connectUrl: "https://connect.composio.example/start" });
    const link = state.seen.find((s) => s.path === "/api/v3.1/connected_accounts/link")!;
    expect(link.body).toMatchObject({ auth_config_id: CONFIG, user_id: SEARCH_CONSOLE_ENTITY, callback_url: "https://gms.test/operator/measures?connected=google_search_console" });
  });

  it("disconnects every account of the operators' entity at Composio", async () => {
    await gsc().disconnect();
    expect(state.accounts).toEqual([]);
    await expect(gsc().listSites()).rejects.toBeInstanceOf(ConnectorAuthError);
  });
});

describe("reading", () => {
  it("lists properties through GOOGLE_SEARCH_CONSOLE_LIST_SITES with no arguments", async () => {
    state.tools[SEARCH_CONSOLE_TOOLS.listSites] = () => ({ data: { siteEntry: [{ siteUrl: "sc-domain:opengrants.io", permissionLevel: "siteOwner" }, { siteUrl: "https://gms.opengrants.io/", permissionLevel: "siteFullUser" }, { siteUrl: "not a property" }] } });
    expect(await gsc().listSites()).toEqual([
      { siteUrl: "sc-domain:opengrants.io", permissionLevel: "siteOwner" },
      { siteUrl: "https://gms.opengrants.io/", permissionLevel: "siteFullUser" },
    ]);
    expect(toolCalls(SEARCH_CONSOLE_TOOLS.listSites)[0]!.body).toMatchObject({ connected_account_id: "ca_gsc", user_id: SEARCH_CONSOLE_ENTITY, arguments: {} });
  });

  it("queries search analytics with exactly these arguments, always held to the GMS's pages", async () => {
    state.tools[SEARCH_CONSOLE_TOOLS.query] = () => ({ data: { rows: [{ keys: ["https://gms.opengrants.io/f/riverbend"], clicks: 12, impressions: 340, ctr: 0.03, position: 8.1 }], responseAggregationType: "byPage" } });
    expect(await gsc().query(QUERY)).toEqual([{ keys: ["https://gms.opengrants.io/f/riverbend"], clicks: 12, impressions: 340 }]);
    expect(toolCalls(SEARCH_CONSOLE_TOOLS.query)[0]!.body!.arguments).toEqual({
      site_url: "sc-domain:opengrants.io",
      start_date: "2026-10-15",
      end_date: "2026-11-13",
      dimensions: ["page"],
      search_type: "web",
      data_state: "final",
      row_limit: 5000,
      dimension_filter_groups: [{ filters: [{ dimension: "page", operator: "includingRegex", expression: "^https://gms\\.opengrants\\.io/" }] }],
    });
  });

  it("refuses a bad property, bad dates or an unfiltered query before anything is sent", () => {
    expect(() => searchAnalyticsArgs({ ...QUERY, siteUrl: "javascript:alert(1)" })).toThrow(SourceReadError);
    expect(() => searchAnalyticsArgs({ ...QUERY, startDate: "2026-11-14" })).toThrow(SourceReadError);
    expect(() => searchAnalyticsArgs({ ...QUERY, pageRegex: "" })).toThrow(SourceReadError);
    expect(searchAnalyticsArgs({ ...QUERY, rowLimit: 99_999 }).row_limit).toBe(5000);
    expect(toolCalls(SEARCH_CONSOLE_TOOLS.query)).toHaveLength(0);
  });

  it("does not pass on Google's error text", async () => {
    state.tools[SEARCH_CONSOLE_TOOLS.query] = () => ({ successful: false, data: null });
    await expect(gsc().query(QUERY)).rejects.toThrow("Search Console did not answer. Try again in a few minutes");
  });

  it("reads Composio's answer shapes, nested or not", () => {
    expect(sitesOf({ response_data: { siteEntry: [{ siteUrl: "https://gms.opengrants.io/", permissionLevel: "siteOwner" }] } })).toHaveLength(1);
    expect(sitesOf({})).toEqual([]);
    expect(analyticsRowsOf({ rows: [{ keys: [], clicks: "3", impressions: -1 }] })).toEqual([{ keys: [], clicks: 3, impressions: 0 }]);
  });
});

describe("wiring", () => {
  it("is absent until both the Composio key and its own auth config are set", () => {
    expect(searchConsolePort({}, () => "/")).toEqual({});
    expect(searchConsolePort({ COMPOSIO_API_KEY: KEY }, () => "/")).toEqual({});
    expect(searchConsolePort({ COMPOSIO_SEARCH_CONSOLE_AUTH_CONFIG_ID: CONFIG }, () => "/")).toEqual({});
    expect(searchConsolePort({ COMPOSIO_API_KEY: KEY, COMPOSIO_SEARCH_CONSOLE_AUTH_CONFIG_ID: CONFIG }, () => "/").searchConsole).toBeInstanceOf(ComposioSearchConsole);
  });

  it("has a fixture with the same port for tests and mock mode", async () => {
    const f = new FixtureSearchConsole(undefined, () => [{ keys: [], clicks: 1, impressions: 2 }]);
    expect(await f.query(QUERY)).toEqual([{ keys: [], clicks: 1, impressions: 2 }]);
    await f.disconnect();
    expect(await f.status({ link: true })).toMatchObject({ connected: false });
  });
});
