// SPDX-License-Identifier: AGPL-3.0-only
// The Google Workspace connector routes over the real GoogleWorkspaceConnector, with Composio
// replaced by recorded response shapes (build spec §10.10). Nothing here calls Composio or Google.
import { ComposioClient, GOOGLE_DIRECTORY_USER_READONLY, GOOGLE_DRIVE_FILE, GoogleWorkspaceConnector, type FetchLike } from "@gms/connectors";
import { beforeEach, describe, expect, it } from "vitest";
import { USER_ADMIN, USER_AUDITOR, USER_OFFICER, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";
import { scenario } from "./scenario.ts";

const AUTH_CONFIG = "ac_test_google";
const ACCOUNT = "ca_test_account_1";
const FOLDER = "drive-folder-id-0001";
const GOOD = `${GOOGLE_DRIVE_FILE} ${GOOGLE_DIRECTORY_USER_READONLY} openid email profile`;

interface Fake {
  /** Accounts Composio holds for the workspace's entity. */
  accounts: { id: string; status: string; scope: string }[];
  calls: { method: string; path: string; body: Record<string, unknown> | null }[];
  down: boolean;
  /** Composio's account read names no scopes at all. */
  noScopes: boolean;
}

let h: Harness;
let fake: Fake;
let admin: Record<string, string>;

const headers = async (user: string) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" });
const call = async <T>(who: Record<string, string>, method: string, path: string, body?: unknown) => {
  const res = await h.request(path, { method, headers: who, ...(method === "GET" || method === "DELETE" ? {} : { body: JSON.stringify(body ?? {}) }) });
  return { status: res.status, body: (await res.json()) as { data: T; errors?: { code: string }[] } };
};

function fakeComposio(): FetchLike {
  return async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    fake.calls.push({ method, path: url.pathname, body });
    if (fake.down) return Response.json({ error: { message: "Internal error", slug: "INTERNAL", status: 500 } }, { status: 500 });
    if (method === "GET" && url.pathname === "/api/v3.1/connected_accounts") {
      expect(url.searchParams.get("user_ids")).toBe(WS_FUNDER);
      return Response.json({ items: fake.accounts.map((a) => ({ id: a.id, status: a.status })) });
    }
    const one = /^\/api\/v3\.1\/connected_accounts\/([\w-]+)$/.exec(url.pathname);
    if (one && method === "GET") {
      const a = fake.accounts.find((x) => x.id === one[1]);
      if (a && fake.noScopes) return Response.json({ id: a.id, status: a.status, auth_config: { id: AUTH_CONFIG }, state: { val: {} } });
      return a ? Response.json({ id: a.id, status: a.status, auth_config: { id: AUTH_CONFIG }, requested_scopes: GOOD.split(" "), state: { val: { scope: a.scope } } }) : Response.json({ error: { message: "Not found", status: 404 } }, { status: 404 });
    }
    if (one && method === "DELETE") {
      fake.accounts = fake.accounts.filter((x) => x.id !== one[1]);
      return Response.json({ success: true });
    }
    if (method === "POST" && url.pathname === "/api/v3.1/connected_accounts/link") return Response.json({ link_token: "lt_test", redirect_url: "https://connect.composio.dev/link/lt_test", expires_at: "2027-04-20T13:00:00Z", connected_account_id: "ca_new" }, { status: 201 });
    if (method === "POST" && url.pathname === "/api/v3.1/tools/execute/proxy" && String(body?.endpoint).includes("/upload/drive/v3/files")) return Response.json({ status: 200, headers: {}, data: { id: "drive-file-id-0001", webViewLink: "https://drive.google.com/file/d/drive-file-id-0001/view" } });
    if (method === "POST" && url.pathname === "/api/v3.1/tools/execute/proxy") return Response.json({ status: 200, headers: {}, data: { users: [{ primaryEmail: "marcus.lee@riverbendcf.example", name: { fullName: "Marcus Lee" } }, { primaryEmail: "dana.ortiz@riverbendcf.example", name: { fullName: "Dana Ortiz" } }] } });
    return Response.json({ error: { message: "Not found", status: 404 } }, { status: 404 });
  };
}

beforeEach(async () => {
  h = await harness();
  fake = { accounts: [], calls: [], down: false, noScopes: false };
  // The harness hands every request the same port object, so the real connector takes its place.
  const real = new GoogleWorkspaceConnector({ client: new ComposioClient({ apiKey: "composio-test-key", fetch: fakeComposio() }), authConfigId: AUTH_CONFIG, callbackUrl: (_entity, returnTo) => `https://app.gms.test${returnTo ?? "/workspaces"}?connected=google_workspace` });
  Object.assign(h.workspaceApps, { status: real.status.bind(real), disconnect: real.disconnect.bind(real), listDirectory: real.listDirectory.bind(real), exportToDrive: real.exportToDrive.bind(real) });
  admin = await headers(USER_ADMIN);
});

describe("Google Workspace through Composio", () => {
  it("starts a connection with a Composio-hosted link, and a read never starts one", async () => {
    const read = await call<{ connected: boolean; connectUrl: string | null }>(admin, "GET", "/gms/connectors/google_workspace");
    expect(read.body.data).toMatchObject({ connected: false, connectUrl: null, status: "not_connected" });
    expect(fake.calls.some((c) => c.method === "POST")).toBe(false);

    const started = await call<{ connected: boolean; connectUrl: string | null; status: string }>(admin, "POST", "/gms/connectors/google_workspace");
    expect(started.status).toBe(200);
    expect(started.body.data).toMatchObject({ connected: false, status: "pending", connectUrl: "https://connect.composio.dev/link/lt_test" });
    expect(fake.calls.find((c) => c.path.endsWith("/link"))!.body).toEqual({ auth_config_id: AUTH_CONFIG, user_id: WS_FUNDER, callback_url: `https://app.gms.test/w/${(await h.repos.table("workspaces").one({ id: WS_FUNDER }))!.handle}/settings/connectors?connected=google_workspace` });

    // The person finishes Google sign-in at Composio; the next call sees the live connection.
    fake.accounts = [{ id: ACCOUNT, status: "ACTIVE", scope: GOOD }];
    const done = await call<{ connected: boolean; status: string; scopes: string[] }>(admin, "POST", "/gms/connectors/google_workspace");
    expect(done.body.data).toMatchObject({ connected: true, status: "active", scopes: ["drive.file", "admin.directory.user.readonly"] });
    const row = await h.repos.table("connector_accounts").one({ workspace_id: WS_FUNDER, provider: "google_workspace" });
    expect(row).toMatchObject({ status: "active", external_id: WS_FUNDER, secret_enc: null });
  });

  it("suggests people from the directory once connected, and none before", async () => {
    expect((await call<unknown[]>(admin, "GET", "/gms/directory/suggest?q=marcus")).body.data).toEqual([]);
    fake.accounts = [{ id: ACCOUNT, status: "ACTIVE", scope: GOOD }];
    expect((await call<{ email: string }[]>(admin, "GET", "/gms/directory/suggest?q=marcus")).body.data).toEqual([{ email: "marcus.lee@riverbendcf.example", name: "Marcus Lee" }]);
  });

  it("refuses a connection that was granted full Drive access and removes it at Composio", async () => {
    fake.accounts = [{ id: ACCOUNT, status: "ACTIVE", scope: `${GOOD} https://www.googleapis.com/auth/drive` }];
    const res = await call(admin, "POST", "/gms/connectors/google_workspace");
    expect(res.status).toBe(422);
    expect(res.body.errors?.[0]?.code).toBe("connector_scope_rejected");
    expect(fake.accounts).toEqual([]);
    // Suggestions simply stay empty rather than failing the invite screen.
    fake.accounts = [{ id: ACCOUNT, status: "ACTIVE", scope: `${GOOD} https://www.googleapis.com/auth/drive.readonly` }];
    expect((await call<unknown[]>(admin, "GET", "/gms/directory/suggest?q=")).body.data).toEqual([]);
    expect(fake.accounts).toEqual([]);
  });

  it("disconnects at Composio and marks the stored row revoked", async () => {
    fake.accounts = [{ id: ACCOUNT, status: "ACTIVE", scope: GOOD }];
    await call(admin, "POST", "/gms/connectors/google_workspace");
    const out = await call<{ connected: boolean; status: string }>(admin, "DELETE", "/gms/connectors/google_workspace");
    expect(out.body.data).toMatchObject({ connected: false, status: "revoked" });
    expect(fake.accounts).toEqual([]);
    expect(fake.calls.some((c) => c.method === "DELETE" && c.path.endsWith(ACCOUNT))).toBe(true);
  });

  it("says so when Composio cannot be reached, and shows the connector as not connected on a read", async () => {
    fake.down = true;
    const res = await call(admin, "POST", "/gms/connectors/google_workspace");
    expect(res.status).toBe(503);
    expect(res.body.errors?.[0]?.code).toBe("connector_unavailable");
    expect((await call<{ connected: boolean }>(admin, "GET", "/gms/connectors/google_workspace")).body.data).toMatchObject({ connected: false });
  });

  it("refuses to use a connection whose scopes Composio does not report", async () => {
    fake.accounts = [{ id: ACCOUNT, status: "ACTIVE", scope: GOOD }];
    fake.noScopes = true;
    const res = await call(admin, "POST", "/gms/connectors/google_workspace");
    expect(res.status).toBe(422);
    expect(res.body.errors?.[0]?.code).toBe("connector_scope_unverified");
    // Unknown is not proof of excess: the connection is left at Composio, just never used.
    expect(fake.accounts).toHaveLength(1);
    expect((await call<{ connected: boolean }>(admin, "GET", "/gms/connectors/google_workspace")).body.data).toMatchObject({ connected: false });
    const dir = await call(admin, "GET", "/gms/connectors/google_workspace/directory?q=marcus");
    expect([dir.status, dir.body.errors?.[0]?.code]).toEqual([422, "connector_scope_unverified"]);
    const out = await call(admin, "POST", "/gms/connectors/google_workspace/export", { documentKind: "snapshot", subjectId: "app_00000000-0000-4000-8000-000000000000", folderId: FOLDER });
    expect(out.status).not.toBe(201);
    expect(fake.calls.some((c) => c.path.endsWith("/tools/execute/proxy"))).toBe(false);
    expect((await call<unknown[]>(admin, "GET", "/gms/directory/suggest?q=marcus")).body.data).toEqual([]);
  });

  it("searches the directory for admins only, and says when Google is not connected", async () => {
    const none = await call(admin, "GET", "/gms/connectors/google_workspace/directory?q=marcus");
    expect([none.status, none.body.errors?.[0]?.code]).toEqual([409, "connector_not_connected"]);
    fake.accounts = [{ id: ACCOUNT, status: "ACTIVE", scope: GOOD }];
    expect((await call<{ email: string }[]>(admin, "GET", "/gms/connectors/google_workspace/directory?q=marcus")).body.data).toEqual([{ email: "marcus.lee@riverbendcf.example", name: "Marcus Lee" }]);
    expect((await call(await headers(USER_OFFICER), "GET", "/gms/connectors/google_workspace/directory?q=marcus")).status).toBe(403);
  });

  it("saves an application snapshot to the picked Drive folder and puts it on the ledger", async () => {
    const s = await scenario(h);
    const started = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
    const app = started.body.data.id;
    await s.call(s.applicant, "PUT", `/common-grants/applications/${app}/forms/${s.uuid.loi}`, { response: { projectTitle: "Mobile Health Navigation for Rural Families", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel 46 miles to reach primary care." } });
    await s.call(s.applicant, "PUT", `/common-grants/applications/${app}/submit`);
    fake.accounts = [{ id: ACCOUNT, status: "ACTIVE", scope: GOOD }];

    const officer = await headers(USER_OFFICER);
    const out = await call<{ fileId: string; fileName: string; url: string; documentKind: string }>(officer, "POST", "/gms/connectors/google_workspace/export", { documentKind: "snapshot", subjectId: `app_${app}`, folderId: FOLDER });
    expect(out.status).toBe(201);
    expect(out.body.data).toMatchObject({ documentKind: "snapshot", fileId: "drive-file-id-0001", fileName: `application-app_${app}.pdf`, url: "https://drive.google.com/file/d/drive-file-id-0001/view" });
    const upload = fake.calls.find((c) => String(c.body?.endpoint).includes("/upload/drive/v3/files"))!;
    expect((upload.body!.binary_body as { content_type: string }).content_type).toMatch(/^multipart\/related/);
    expect(h.ledger.events.filter((e) => e.eventType === "connector.drive_export").at(-1)!.data).toMatchObject({ documentKind: "snapshot", driveFileId: "drive-file-id-0001" });

    // Bad folder ids, unknown kinds and other workspaces' records go nowhere.
    expect((await call(officer, "POST", "/gms/connectors/google_workspace/export", { documentKind: "snapshot", subjectId: `app_${app}`, folderId: "../x" })).status).toBe(400);
    expect((await call(officer, "POST", "/gms/connectors/google_workspace/export", { documentKind: "ledger", subjectId: `app_${app}`, folderId: FOLDER })).status).toBe(400);
    expect((await call(officer, "POST", "/gms/connectors/google_workspace/export", { documentKind: "agreement", subjectId: "agr_00000000-0000-4000-8000-000000000000", folderId: FOLDER })).status).toBe(404);
    expect((await call(await headers(USER_AUDITOR), "POST", "/gms/connectors/google_workspace/export", { documentKind: "snapshot", subjectId: `app_${app}`, folderId: FOLDER })).status).toBe(403);
  });

  it("lets only a workspace admin connect", async () => {
    expect((await call(await headers(USER_OFFICER), "POST", "/gms/connectors/google_workspace")).status).toBe(403);
  });
});
