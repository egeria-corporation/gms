// SPDX-License-Identifier: AGPL-3.0-only
// The Composio client and the Google Workspace connector, against response shapes recorded from
// Composio's REST API v3.1 reference (docs/connectors.md lists the pages). Nothing here calls Composio.
import { describe, expect, it } from "vitest";
import {
  COMPOSIO_API_BASE,
  ComposioClient,
  ComposioError,
  ConnectorAuthError,
  ConnectorScopeError,
  ConnectorUnavailableError,
  GOOGLE_DIRECTORY_USER_READONLY,
  GOOGLE_DRIVE_FILE,
  GoogleWorkspaceConnector,
  checkGoogleScopes,
  driveMultipart,
  mapConnectedAccount,
  type FetchLike,
} from "../src/index.ts";

const KEY = "composio-test-key";
const AUTH_CONFIG = "ac_test_google";
const ENTITY = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "ca_test_account_1";
const FOLDER = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456";
const GOOD_SCOPES = `${GOOGLE_DRIVE_FILE} ${GOOGLE_DIRECTORY_USER_READONLY} openid email profile`;

interface Call {
  method: string;
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown> | null;
  apiKey: string | null;
}

/** A fake Composio: records every call and answers from a route table. */
function composio(routes: (call: Call) => { status?: number; body: unknown } | undefined) {
  const calls: Call[] = [];
  const fetchLike: FetchLike = async (input, init) => {
    const url = new URL(input);
    const call: Call = {
      method: init?.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      apiKey: new Headers(init?.headers).get("x-api-key"),
    };
    calls.push(call);
    const answer = routes(call) ?? { status: 404, body: { error: { message: "Not found", slug: "NOT_FOUND", status: 404 } } };
    return Response.json(answer.body, { status: answer.status ?? 200 });
  };
  return { calls, client: new ComposioClient({ apiKey: KEY, fetch: fetchLike }) };
}

const account = (over: Record<string, unknown> = {}) => ({
  id: ACCOUNT,
  status: "ACTIVE",
  toolkit: { slug: "googlesuper" },
  auth_config: { id: AUTH_CONFIG, auth_scheme: "OAUTH2", is_composio_managed: false, is_disabled: false },
  requested_scopes: GOOD_SCOPES.split(" "),
  state: { authScheme: "OAUTH2", val: { status: "ACTIVE", scope: GOOD_SCOPES, access_token: "never-kept", refresh_token: "never-kept" } },
  ...over,
});

/** A connected workspace: list → one ACTIVE account, GET → that account, plus whatever the proxy answers. */
function connected(proxy: (body: Record<string, unknown>) => { status: number; data: unknown }, over: Record<string, unknown> = {}) {
  return composio((c) => {
    if (c.method === "GET" && c.path === "/api/v3.1/connected_accounts") return { body: { items: [{ id: ACCOUNT, status: "ACTIVE" }], next_cursor: null, total_pages: 1, current_page: 1, total_items: 1 } };
    if (c.method === "GET" && c.path === `/api/v3.1/connected_accounts/${ACCOUNT}`) return { body: account(over) };
    if (c.method === "DELETE" && c.path === `/api/v3.1/connected_accounts/${ACCOUNT}`) return { body: { success: true } };
    if (c.method === "POST" && c.path === "/api/v3.1/tools/execute/proxy") return { body: { ...proxy(c.body!), headers: {} } };
    return undefined;
  });
}

const connector = (client: ComposioClient) => new GoogleWorkspaceConnector({ client, authConfigId: AUTH_CONFIG, callbackUrl: (id) => `https://gms.test/workspaces?connected=google_workspace&ws=${id}` });

describe("ComposioClient", () => {
  it("creates a connect link for (auth config, entity) and returns Composio's hosted URL", async () => {
    const { calls, client } = composio((c) =>
      c.path === "/api/v3.1/connected_accounts/link" ? { status: 201, body: { link_token: "lt_test", redirect_url: "https://connect.composio.dev/link/lt_test", expires_at: "2027-04-20T13:00:00Z", connected_account_id: ACCOUNT } } : undefined,
    );
    const link = await client.createConnectLink({ authConfigId: AUTH_CONFIG, userId: ENTITY, callbackUrl: "https://gms.test/back" });
    expect(link).toEqual({ connectedAccountId: ACCOUNT, redirectUrl: "https://connect.composio.dev/link/lt_test", expiresAt: "2027-04-20T13:00:00Z" });
    expect(calls[0]).toMatchObject({ method: "POST", apiKey: KEY, body: { auth_config_id: AUTH_CONFIG, user_id: ENTITY, callback_url: "https://gms.test/back" } });
    expect(COMPOSIO_API_BASE).toBe("https://backend.composio.dev");
  });

  it("lists an entity's accounts on one auth config", async () => {
    const { calls, client } = composio((c) => (c.path === "/api/v3.1/connected_accounts" ? { body: { items: [{ id: ACCOUNT, status: "ACTIVE" }, { status: "FAILED" }] } } : undefined));
    expect(await client.listConnectedAccounts({ authConfigId: AUTH_CONFIG, userId: ENTITY })).toEqual([{ id: ACCOUNT, status: "ACTIVE" }]);
    expect(calls[0]!.query).toEqual({ user_ids: ENTITY, auth_config_ids: AUTH_CONFIG, order_by: "created_at", order_direction: "desc", limit: "25" });
  });

  it("keeps ids, status and scopes from a connected account and drops the credential", () => {
    const mapped = mapConnectedAccount(account());
    expect(mapped).toEqual({ id: ACCOUNT, status: "ACTIVE", authConfigId: AUTH_CONFIG, grantedScopes: GOOD_SCOPES.split(" "), requestedScopes: GOOD_SCOPES.split(" ") });
    expect(JSON.stringify(mapped)).not.toContain("never-kept");
    expect(() => mapConnectedAccount({ status: "ACTIVE" })).toThrow(ComposioError);
  });

  it("deletes a connected account, and treats one that is already gone as deleted", async () => {
    const { calls, client } = composio((c) => (c.method === "DELETE" && c.path.endsWith(ACCOUNT) ? { body: { success: true } } : undefined));
    await client.deleteConnectedAccount(ACCOUNT);
    await client.deleteConnectedAccount("ca_already_gone");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`DELETE /api/v3.1/connected_accounts/${ACCOUNT}`, "DELETE /api/v3.1/connected_accounts/ca_already_gone"]);
    await expect(client.deleteConnectedAccount("../etc")).rejects.toMatchObject({ status: 400 });
  });

  it("executes a predefined tool for an entity", async () => {
    const { calls, client } = composio((c) => (c.path === "/api/v3.1/tools/execute/EXAMPLE_TOOL" ? { body: { successful: true, error: null, data: { ok: 1 } } } : undefined));
    expect(await client.executeTool("EXAMPLE_TOOL", { connectedAccountId: ACCOUNT, userId: ENTITY, arguments: { a: 1 } })).toEqual({ successful: true, error: null, data: { ok: 1 } });
    expect(calls[0]!.body).toEqual({ connected_account_id: ACCOUNT, user_id: ENTITY, arguments: { a: 1 } });
    await expect(client.executeTool("not a slug", { connectedAccountId: ACCOUNT, userId: ENTITY, arguments: {} })).rejects.toMatchObject({ status: 400 });
  });

  it("proxies a provider call with query parameters and an optional binary body", async () => {
    const { calls, client } = composio((c) => (c.path === "/api/v3.1/tools/execute/proxy" ? { body: { status: 200, data: { id: "x" }, headers: {} } } : undefined));
    const res = await client.proxy({ connectedAccountId: ACCOUNT, userId: ENTITY, endpoint: "https://www.googleapis.com/upload/drive/v3/files", method: "POST", query: { uploadType: "multipart", skipped: undefined }, binary: { base64: "QUJD", contentType: "multipart/related; boundary=b" } });
    expect(res).toEqual({ status: 200, data: { id: "x" } });
    expect(calls[0]!.body).toEqual({
      connected_account_id: ACCOUNT,
      user_id: ENTITY,
      endpoint: "https://www.googleapis.com/upload/drive/v3/files",
      method: "POST",
      parameters: [{ name: "uploadType", value: "multipart", type: "query" }],
      binary_body: { base64: "QUJD", content_type: "multipart/related; boundary=b" },
    });
  });

  it("turns Composio's error body and network failures into ComposioError without echoing the key", async () => {
    const denied = composio(() => ({ status: 401, body: { error: { message: "Invalid API key", code: 10401, slug: "AUTH_INVALID_API_KEY", status: 401 } } }));
    await expect(denied.client.getConnectedAccount(ACCOUNT)).rejects.toMatchObject({ name: "ComposioError", status: 401, slug: "AUTH_INVALID_API_KEY", message: "Invalid API key" });
    const down = new ComposioClient({ apiKey: KEY, fetch: async () => Promise.reject(new TypeError("fetch failed")) });
    const err = (await down.getConnectedAccount(ACCOUNT).catch((e: unknown) => e)) as ComposioError;
    expect(err).toMatchObject({ status: 502 });
    expect(err.message).not.toContain(KEY);
    expect(() => new ComposioClient({ apiKey: "" })).toThrow("COMPOSIO_API_KEY");
  });
});

describe("Google scope rule", () => {
  it("allows drive.file, directory read-only and identity, and nothing else", () => {
    expect(checkGoogleScopes(GOOD_SCOPES)).toEqual({ ok: true, excess: [], drive: true, directory: true });
    expect(checkGoogleScopes([GOOGLE_DRIVE_FILE, "https://www.googleapis.com/auth/userinfo.email"])).toMatchObject({ ok: true, drive: true, directory: false });
    for (const bad of ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.metadata.readonly", "https://www.googleapis.com/auth/admin.directory.user", "https://www.googleapis.com/auth/gmail.readonly"]) {
      expect(checkGoogleScopes(`${GOOD_SCOPES},${bad}`)).toMatchObject({ ok: false, excess: [bad] });
    }
  });
});

describe("GoogleWorkspaceConnector", () => {
  it("reports a live connection without creating anything", async () => {
    const { calls, client } = connected(() => ({ status: 200, data: {} }));
    expect(await connector(client).status(ENTITY)).toEqual({ connected: true, connectUrl: null });
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET"]);
  });

  it("starts a connection only when asked to, with the entity as Composio's user id", async () => {
    const { calls, client } = composio((c) => {
      if (c.method === "GET" && c.path === "/api/v3.1/connected_accounts") return { body: { items: [{ id: "ca_half_started", status: "INITIATED" }] } };
      if (c.path === "/api/v3.1/connected_accounts/link") return { status: 201, body: { link_token: "lt", redirect_url: "https://connect.composio.dev/link/lt", expires_at: "2027-04-20T13:00:00Z", connected_account_id: "ca_new" } };
      return undefined;
    });
    const gw = connector(client);
    expect(await gw.status(ENTITY)).toEqual({ connected: false, connectUrl: null });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(await gw.status(ENTITY, { link: true })).toEqual({ connected: false, connectUrl: "https://connect.composio.dev/link/lt" });
    expect(calls.at(-1)!.body).toEqual({ auth_config_id: AUTH_CONFIG, user_id: ENTITY, callback_url: `https://gms.test/workspaces?connected=google_workspace&ws=${ENTITY}` });
  });

  it("refuses and deletes a connection that holds full Drive access", async () => {
    for (const scope of ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/drive.readonly"]) {
      const { calls, client } = connected(() => ({ status: 200, data: {} }), { state: { val: { scope: `${GOOD_SCOPES} ${scope}` } } });
      const err = await connector(client)
        .status(ENTITY)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConnectorScopeError);
      expect((err as ConnectorScopeError).excess).toEqual([scope]);
      expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: `/api/v3.1/connected_accounts/${ACCOUNT}` });
    }
  });

  it("refuses a connection whose requested scopes were widened even if the grant looks clean", async () => {
    const { client } = connected(() => ({ status: 200, data: {} }), { requested_scopes: [...GOOD_SCOPES.split(" "), "https://www.googleapis.com/auth/drive"] });
    await expect(connector(client).listDirectory(ENTITY, "")).rejects.toBeInstanceOf(ConnectorScopeError);
  });

  it("ignores an account that sits on another auth config", async () => {
    const { client } = connected(() => ({ status: 200, data: {} }), { auth_config: { id: "ac_someone_else" } });
    expect(await connector(client).status(ENTITY)).toEqual({ connected: false, connectUrl: null });
  });

  it("lists active directory people read-only and filters them by the query", async () => {
    const { calls, client } = connected((body) => {
      const params = Object.fromEntries((body.parameters as { name: string; value: string }[]).map((p) => [p.name, p.value]));
      return params.pageToken
        ? { status: 200, data: { users: [{ primaryEmail: "Marcus.Lee@riverbendcf.example", name: { fullName: "Marcus Lee" } }] } }
        : {
            status: 200,
            data: {
              nextPageToken: "page-2",
              users: [
                { primaryEmail: "dana.ortiz@riverbendcf.example", name: { fullName: "Dana Ortiz" } },
                { primaryEmail: "gone@riverbendcf.example", name: { fullName: "Marcus Former" }, suspended: true },
                { primaryEmail: "archived@riverbendcf.example", name: { fullName: "Marcus Archived" }, archived: true },
                { primaryEmail: "not-an-email", name: { fullName: "Marcus Broken" } },
              ],
            },
          };
    });
    expect(await connector(client).listDirectory(ENTITY, "marcus")).toEqual([{ email: "marcus.lee@riverbendcf.example", name: "Marcus Lee" }]);
    const first = calls.find((c) => c.path.endsWith("/proxy"))!.body!;
    expect(first).toMatchObject({ connected_account_id: ACCOUNT, user_id: ENTITY, method: "GET", endpoint: "https://www.googleapis.com/admin/directory/v1/users" });
    expect(Object.fromEntries((first.parameters as { name: string; value: string }[]).map((p) => [p.name, p.value]))).toMatchObject({ customer: "my_customer", viewType: "admin_view", maxResults: "200" });
    expect(calls.every((c) => !c.path.endsWith("/proxy") || c.body!.method === "GET")).toBe(true);
  });

  it("returns no suggestions when the account may not read the directory or the scope was declined", async () => {
    const forbidden = connected(() => ({ status: 403, data: { error: { message: "Not Authorized to access this resource/api" } } }));
    expect(await connector(forbidden.client).listDirectory(ENTITY, "")).toEqual([]);
    const declined = connected(() => ({ status: 200, data: {} }), { requested_scopes: [GOOGLE_DRIVE_FILE], state: { val: { scope: `${GOOGLE_DRIVE_FILE} openid email` } } });
    expect(await connector(declined.client).listDirectory(ENTITY, "")).toEqual([]);
    expect(declined.calls.some((c) => c.path.endsWith("/proxy"))).toBe(false);
  });

  it("uploads a PDF into the picked folder as one multipart request", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7 test");
    const { calls, client } = connected(() => ({ status: 200, data: { id: "1NewFileIdAbCdEfGhIjKlMnOpQrStUv", webViewLink: "https://drive.google.com/file/d/1NewFileIdAbCdEfGhIjKlMnOpQrStUv/view?usp=drivesdk" } }));
    const out = await connector(client).exportToDrive(ENTITY, { name: "Award letter / Alder Creek.pdf", bytes: pdf, folderId: FOLDER });
    expect(out.url).toBe("https://drive.google.com/file/d/1NewFileIdAbCdEfGhIjKlMnOpQrStUv/view?usp=drivesdk");
    const body = calls.find((c) => c.path.endsWith("/proxy"))!.body!;
    expect(body).toMatchObject({ method: "POST", endpoint: "https://www.googleapis.com/upload/drive/v3/files", connected_account_id: ACCOUNT, user_id: ENTITY });
    expect(Object.fromEntries((body.parameters as { name: string; value: string }[]).map((p) => [p.name, p.value]))).toEqual({ uploadType: "multipart", supportsAllDrives: "true", fields: "id,webViewLink" });
    const binary = body.binary_body as { base64: string; content_type: string };
    const boundary = /^multipart\/related; boundary=(gms-[0-9a-f-]+)$/.exec(binary.content_type)![1]!;
    const sent = atob(binary.base64);
    expect(sent).toContain(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"Award letter Alder Creek.pdf","parents":["${FOLDER}"]}`);
    expect(sent).toContain("Content-Type: application/pdf\r\n\r\n%PDF-1.7 test\r\n");
    expect(sent.endsWith(`--${boundary}--`)).toBe(true);
  });

  it("builds a multipart body whose bytes survive unchanged", () => {
    const bytes = new Uint8Array([0, 255, 13, 10, 37]);
    const out = driveMultipart({ name: "a.pdf", parents: ["folder"] }, bytes, "application/pdf", "b");
    const tail = new TextEncoder().encode("\r\n--b--");
    expect([...out.slice(out.length - tail.length - bytes.length, out.length - tail.length)]).toEqual([...bytes]);
  });

  it("explains a folder that was not picked, a missing Drive scope and a workspace that is not connected", async () => {
    const pdf = new Uint8Array([1, 2, 3]);
    const notPicked = connected(() => ({ status: 404, data: { error: { message: "File not found" } } }));
    await expect(connector(notPicked.client).exportToDrive(ENTITY, { name: "a.pdf", bytes: pdf, folderId: FOLDER })).rejects.toThrow(/Google Picker/);
    const noDrive = connected(() => ({ status: 200, data: {} }), { requested_scopes: [GOOGLE_DIRECTORY_USER_READONLY], state: { val: { scope: GOOGLE_DIRECTORY_USER_READONLY } } });
    await expect(connector(noDrive.client).exportToDrive(ENTITY, { name: "a.pdf", bytes: pdf, folderId: FOLDER })).rejects.toBeInstanceOf(ConnectorAuthError);
    const none = composio((c) => (c.path === "/api/v3.1/connected_accounts" ? { body: { items: [] } } : undefined));
    await expect(connector(none.client).exportToDrive(ENTITY, { name: "a.pdf", bytes: pdf, folderId: FOLDER })).rejects.toBeInstanceOf(ConnectorAuthError);
    await expect(connector(none.client).exportToDrive(ENTITY, { name: "a.pdf", bytes: pdf, folderId: "../x" })).rejects.toThrow("Invalid Drive folder id");
    await expect(connector(none.client).exportToDrive(ENTITY, { name: "a.pdf", bytes: new Uint8Array(), folderId: FOLDER })).rejects.toThrow(/empty/);
  });

  it("disconnects by deleting every account the entity has on the auth config", async () => {
    const { calls, client } = composio((c) => {
      if (c.method === "GET") return { body: { items: [{ id: ACCOUNT, status: "ACTIVE" }, { id: "ca_half_started", status: "INITIATED" }] } };
      if (c.method === "DELETE") return { body: { success: true } };
      return undefined;
    });
    await connector(client).disconnect(ENTITY);
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual([`/api/v3.1/connected_accounts/${ACCOUNT}`, "/api/v3.1/connected_accounts/ca_half_started"]);
  });

  it("maps Composio failures to the connector errors the API understands", async () => {
    const denied = composio(() => ({ status: 401, body: { error: { message: "Invalid API key", slug: "AUTH", status: 401 } } }));
    await expect(connector(denied.client).status(ENTITY)).rejects.toBeInstanceOf(ConnectorAuthError);
    const down = composio(() => ({ status: 500, body: { error: { message: "Internal", slug: "INTERNAL", status: 500 } } }));
    await expect(connector(down.client).status(ENTITY)).rejects.toBeInstanceOf(ConnectorUnavailableError);
    expect(() => new GoogleWorkspaceConnector({ client: denied.client, authConfigId: "", callbackUrl: () => "https://gms.test" })).toThrow("COMPOSIO_GOOGLE_AUTH_CONFIG_ID");
  });
});
