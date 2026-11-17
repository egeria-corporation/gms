// SPDX-License-Identifier: AGPL-3.0-only
// Slack, Google Calendar, Google Drive and Salesforce over the real ComposioClient, against a fake
// Composio (an in-process fetch answering in the shapes of Composio's REST API v3.1). Each test
// checks the tool slug and the exact arguments the GMS would send. Nothing here calls Composio.
import { beforeEach, describe, expect, it } from "vitest";
import {
  APP_TOOLS,
  ComposioCalendarSync,
  ComposioClient,
  ComposioDriveFiles,
  ComposioSalesforceSource,
  ComposioSlackAlerts,
  ConnectorAuthError,
  ConnectorScopeError,
  ConnectorScopeUnverifiedError,
  DriveFileRefusedError,
  GOOGLE_CALENDAR_EVENTS_OWNED,
  GOOGLE_CALENDARLIST_READONLY,
  GOOGLE_DRIVE_FILE,
  SourceReadError,
  checkAppScopes,
  calendarEventArgs,
  type FetchLike,
} from "../src/index.ts";

const KEY = "composio-test-key";
const ENTITY = "44444444-4444-4444-8444-444444444444";
const CONFIG = "ac_test_app";

interface Seen {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}
interface Account {
  id: string;
  status: string;
  scope: string;
  userId?: string;
  authConfig?: string;
}

const state = {
  seen: [] as Seen[],
  accounts: [] as Account[],
  tools: {} as Record<string, (args: Record<string, unknown>) => { successful?: boolean; data: unknown }>,
  proxy: null as null | ((body: Record<string, unknown>) => { status: number; data: unknown }),
  files: {} as Record<string, Uint8Array>,
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const fakeFetch: FetchLike = async (input, init) => {
  const url = new URL(input);
  if (url.hostname === "files.composio.example") {
    const bytes = state.files[url.pathname];
    return bytes ? new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]), { status: 200 }) : new Response("", { status: 404 });
  }
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
  state.seen.push({ method: init?.method ?? "GET", path: url.pathname, body });
  if ((init?.headers as Record<string, string>)["x-api-key"] !== KEY) return json(401, { error: { message: "bad key" } });
  if (url.pathname === "/api/v3.1/connected_accounts") return json(200, { items: state.accounts.filter((a) => (a.userId ?? ENTITY) === url.searchParams.get("user_ids")).map((a) => ({ id: a.id, status: a.status })) });
  if (url.pathname === "/api/v3.1/connected_accounts/link") return json(201, { connected_account_id: "ca_new_person", redirect_url: "https://connect.composio.example/start", expires_at: null });
  const one = /^\/api\/v3\.1\/connected_accounts\/([^/]+)$/.exec(url.pathname);
  if (one && init?.method === "DELETE") {
    state.accounts = state.accounts.filter((a) => a.id !== one[1]);
    return json(200, { success: true });
  }
  if (one) {
    const a = state.accounts.find((x) => x.id === one[1]);
    return a ? json(200, { id: a.id, status: a.status, user_id: a.userId ?? ENTITY, auth_config: { id: a.authConfig ?? CONFIG }, state: { val: { scope: a.scope, access_token: "never-kept" } } }) : json(404, { error: { message: "not found" } });
  }
  if (url.pathname === "/api/v3.1/tools/execute/proxy") return json(200, state.proxy ? state.proxy(body!) : { status: 500, data: null });
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
const cfg = () => ({ client: client(), authConfigId: CONFIG, callbackUrl: (_e: string, back?: string) => `https://gms.test${back ?? "/"}?connected=x` });
const toolCalls = (slug: string) => state.seen.filter((s) => s.path === `/api/v3.1/tools/execute/${slug}`);

beforeEach(() => {
  state.seen = [];
  state.accounts = [];
  state.tools = {};
  state.proxy = null;
  state.files = {};
});

describe("scope checks", () => {
  it("allows exactly the narrow scopes and refuses anything broader", () => {
    expect(checkAppScopes("slack", "chat:write,channels:read")).toEqual({ ok: true, excess: [], missing: [] });
    expect(checkAppScopes("slack", "chat:write channels:read channels:history").excess).toEqual(["channels:history"]);
    expect(checkAppScopes("slack", "chat:write channels:read users:read.email groups:read").excess).toEqual(["users:read.email", "groups:read"]);
    expect(checkAppScopes("slack", "chat:write").missing).toEqual(["channels:read"]);
    expect(checkAppScopes("google_calendar", `${GOOGLE_CALENDARLIST_READONLY} ${GOOGLE_CALENDAR_EVENTS_OWNED} openid email`).ok).toBe(true);
    expect(checkAppScopes("google_calendar", `${GOOGLE_CALENDARLIST_READONLY} https://www.googleapis.com/auth/calendar`).excess).toEqual(["https://www.googleapis.com/auth/calendar"]);
    expect(checkAppScopes("google_calendar", "https://www.googleapis.com/auth/calendar.events").ok).toBe(false);
    expect(checkAppScopes("salesforce", "api refresh_token id").ok).toBe(true);
    expect(checkAppScopes("salesforce", "api full").excess).toEqual(["full"]);
  });

  it("holds Google Drive to drive.file: drive and drive.readonly are refused", () => {
    expect(checkAppScopes("google_drive", `${GOOGLE_DRIVE_FILE} openid`)).toEqual({ ok: true, excess: [], missing: [] });
    for (const broad of ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.metadata.readonly"]) {
      expect(checkAppScopes("google_drive", `${GOOGLE_DRIVE_FILE} ${broad}`).excess).toEqual([broad]);
    }
  });

  it("deletes a connection holding more than allowed, and does not use one that reports no scopes", async () => {
    state.accounts = [{ id: "ca_slack", status: "ACTIVE", scope: "chat:write,channels:read,channels:history" }];
    const slack = new ComposioSlackAlerts(cfg());
    await expect(slack.listChannels(ENTITY)).rejects.toBeInstanceOf(ConnectorScopeError);
    expect(state.accounts).toEqual([]);
    expect(toolCalls(APP_TOOLS.slackChannels)).toHaveLength(0);
    state.accounts = [{ id: "ca_slack2", status: "ACTIVE", scope: "" }];
    await expect(slack.status(ENTITY)).rejects.toBeInstanceOf(ConnectorScopeUnverifiedError);
    expect(state.accounts).toHaveLength(1);
  });

  it("ignores an account on another auth config or another entity", async () => {
    state.accounts = [{ id: "ca_other", status: "ACTIVE", scope: "chat:write channels:read", authConfig: "ac_someone_else" }];
    expect(await new ComposioSlackAlerts(cfg()).status(ENTITY)).toEqual({ connected: false, connectUrl: null });
  });
});

describe("Slack", () => {
  beforeEach(() => {
    state.accounts = [{ id: "ca_slack", status: "ACTIVE", scope: "chat:write,channels:read" }];
  });

  it("lists public channels only, through SLACK_LIST_ALL_CHANNELS with pagination", async () => {
    let page = 0;
    state.tools[APP_TOOLS.slackChannels] = () =>
      page++ === 0
        ? { data: { ok: true, channels: [{ id: "C0GRANTS01", name: "grants", is_member: true }, { id: "C0ARCHIVE1", name: "old", is_archived: true }, { id: "D0DIRECT01", name: "dm", is_im: true }], response_metadata: { next_cursor: "page2" } } }
        : { data: { ok: true, channels: [{ id: "C0ALERTS01", name: "alerts", is_member: false }, { id: "G0PRIVATE1", name: "board", is_private: true }], response_metadata: { next_cursor: "" } } };
    const channels = await new ComposioSlackAlerts(cfg()).listChannels(ENTITY);
    expect(channels).toEqual([
      { id: "C0ALERTS01", name: "alerts", member: false },
      { id: "C0GRANTS01", name: "grants", member: true },
    ]);
    const calls = toolCalls(APP_TOOLS.slackChannels);
    expect(calls[0]!.body).toEqual({ connected_account_id: "ca_slack", user_id: ENTITY, arguments: { types: "public_channel", exclude_archived: true, limit: 200 } });
    expect(calls[1]!.body!.arguments).toEqual({ types: "public_channel", exclude_archived: true, limit: 200, cursor: "page2" });
  });

  it("posts one message with SLACK_SEND_MESSAGE, no link previews", async () => {
    state.tools[APP_TOOLS.slackPost] = () => ({ data: { ok: true, ts: "1700000000.000100", channel: "C0GRANTS01" } });
    expect(await new ComposioSlackAlerts(cfg()).post(ENTITY, "C0GRANTS01", "New application: *Clean water*")).toEqual({ ts: "1700000000.000100" });
    expect(toolCalls(APP_TOOLS.slackPost)[0]!.body).toEqual({ connected_account_id: "ca_slack", user_id: ENTITY, arguments: { channel: "C0GRANTS01", markdown_text: "New application: *Clean water*", unfurl_links: false, unfurl_media: false } });
  });

  it("says one plain sentence when Slack refuses, never the provider's text", async () => {
    state.tools[APP_TOOLS.slackPost] = () => ({ successful: false, data: null });
    const err = await new ComposioSlackAlerts(cfg()).post(ENTITY, "C0GRANTS01", "x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceReadError);
    expect((err as Error).message).not.toContain("provider error text");
    await expect(new ComposioSlackAlerts(cfg()).post(ENTITY, "#general", "x")).rejects.toBeInstanceOf(SourceReadError);
  });

  it("refuses without a connection", async () => {
    state.accounts = [];
    await expect(new ComposioSlackAlerts(cfg()).listChannels(ENTITY)).rejects.toBeInstanceOf(ConnectorAuthError);
  });
});

describe("Google Calendar", () => {
  const scope = `${GOOGLE_CALENDARLIST_READONLY} ${GOOGLE_CALENDAR_EVENTS_OWNED}`;
  beforeEach(() => {
    state.accounts = [
      { id: "ca_me", status: "ACTIVE", scope },
      { id: "ca_colleague", status: "ACTIVE", scope },
    ];
  });

  it("starts a person's own connection and keeps its account id", async () => {
    expect(await new ComposioCalendarSync(cfg()).connectLink(ENTITY, "/w/acme/settings/connected-apps")).toEqual({ accountId: "ca_new_person", url: "https://connect.composio.example/start" });
    expect(state.seen.at(-1)!.body).toEqual({ auth_config_id: CONFIG, user_id: ENTITY, callback_url: "https://gms.test/w/acme/settings/connected-apps?connected=x" });
  });

  it("lists only calendars the person owns, and acts only on their own account", async () => {
    state.tools[APP_TOOLS.calendarList] = () => ({ data: { calendars: [{ id: "me@example.org", summary: "Me", primary: true, accessRole: "owner" }, { id: "team@group.calendar.google.com", summary: "Team", accessRole: "reader" }] } });
    expect(await new ComposioCalendarSync(cfg()).listCalendars(ENTITY, "ca_me")).toEqual([{ id: "me@example.org", name: "Me", primary: true }]);
    expect(toolCalls(APP_TOOLS.calendarList)[0]!.body).toEqual({ connected_account_id: "ca_me", user_id: ENTITY, arguments: { min_access_role: "owner", max_results: 100 } });
    state.accounts.push({ id: "ca_elsewhere", status: "ACTIVE", scope, userId: "55555555-5555-4555-8555-555555555555" });
    await expect(new ComposioCalendarSync(cfg()).listCalendars(ENTITY, "ca_elsewhere")).rejects.toBeInstanceOf(ConnectorAuthError);
  });

  it("creates, patches and deletes all-day events with no guests, no Meet link and no emails", async () => {
    state.tools[APP_TOOLS.calendarCreate] = () => ({ data: { response_data: { id: "abc123def456", status: "confirmed" } } });
    state.tools[APP_TOOLS.calendarPatch] = () => ({ data: { response_data: { id: "abc123def456" } } });
    state.tools[APP_TOOLS.calendarDelete] = () => ({ data: {} });
    const cal = new ComposioCalendarSync(cfg());
    const event = { title: "Application due: Clean water", date: "2026-12-01", description: "Open in the GMS: https://gms.test/w/acme/outside/1" };
    expect(await cal.createEvent(ENTITY, "ca_me", "primary", event)).toEqual({ eventId: "abc123def456" });
    expect(toolCalls(APP_TOOLS.calendarCreate)[0]!.body!.arguments).toEqual({ calendar_id: "primary", summary: event.title, description: event.description, start_date: "2026-12-01", end_date: "2026-12-02", create_meeting_room: false, send_updates: "none", exclude_organizer: true, transparency: "transparent" });
    await cal.updateEvent(ENTITY, "ca_me", "primary", "abc123def456", { ...event, date: "2026-12-31" });
    expect(toolCalls(APP_TOOLS.calendarPatch)[0]!.body!.arguments).toEqual({ calendar_id: "primary", event_id: "abc123def456", summary: event.title, description: event.description, start_time: "2026-12-31", end_time: "2027-01-01", send_updates: "none" });
    await cal.deleteEvent(ENTITY, "ca_me", "primary", "abc123def456");
    expect(toolCalls(APP_TOOLS.calendarDelete)[0]!.body!.arguments).toEqual({ calendar_id: "primary", event_id: "abc123def456", send_updates: "none" });
    expect(() => calendarEventArgs("primary", { ...event, date: "next week" })).toThrow(SourceReadError);
  });
});

describe("Google Drive", () => {
  beforeEach(() => {
    state.accounts = [{ id: "ca_drive", status: "ACTIVE", scope: `${GOOGLE_DRIVE_FILE} openid email profile` }];
  });

  it("copies a picked file: metadata, then download, then the bytes from Composio's file store", async () => {
    state.tools[APP_TOOLS.driveMetadata] = () => ({ data: { id: "1PickedFile0001", name: "Budget.pdf", mimeType: "application/pdf", size: "5" } });
    state.tools[APP_TOOLS.driveDownload] = () => ({ data: { id: "1PickedFile0001", name: "Budget.pdf", mimeType: "application/pdf", downloaded_file_content: { name: "Budget.pdf", mimetype: "application/pdf", s3url: "https://files.composio.example/f/1" } } });
    state.files["/f/1"] = new Uint8Array([37, 80, 68, 70, 45]);
    const f = await new ComposioDriveFiles({ ...cfg(), fetch: fakeFetch }).download(ENTITY, "1PickedFile0001", 1024);
    expect(f).toEqual({ name: "Budget.pdf", mimeType: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70, 45]) });
    expect(toolCalls(APP_TOOLS.driveMetadata)[0]!.body!.arguments).toEqual({ fileId: "1PickedFile0001", fields: "id,name,mimeType,size", supportsAllDrives: true });
    expect(toolCalls(APP_TOOLS.driveDownload)[0]!.body!.arguments).toEqual({ fileId: "1PickedFile0001" });
  });

  it("exports a Google Doc as PDF, and refuses folders and files over the limit", async () => {
    state.tools[APP_TOOLS.driveMetadata] = (a) => ({ data: a.fileId === "1FolderFile0001" ? { name: "Folder", mimeType: "application/vnd.google-apps.folder" } : a.fileId === "1HugeFile000001" ? { name: "Big.zip", mimeType: "application/zip", size: "99999999" } : { name: "Narrative", mimeType: "application/vnd.google-apps.document" } });
    state.tools[APP_TOOLS.driveDownload] = () => ({ data: { downloaded_file_content: { name: "Narrative", mimetype: "application/pdf", s3url: "https://files.composio.example/f/2" } } });
    state.files["/f/2"] = new Uint8Array([1, 2, 3]);
    const drive = new ComposioDriveFiles({ ...cfg(), fetch: fakeFetch });
    expect(await drive.download(ENTITY, "1GoogleDoc00001", 1024)).toMatchObject({ name: "Narrative.pdf", mimeType: "application/pdf" });
    expect(toolCalls(APP_TOOLS.driveDownload)[0]!.body!.arguments).toEqual({ fileId: "1GoogleDoc00001", mime_type: "application/pdf" });
    await expect(drive.download(ENTITY, "1FolderFile0001", 1024)).rejects.toMatchObject({ reason: "folder" });
    await expect(drive.download(ENTITY, "1HugeFile000001", 1024)).rejects.toMatchObject({ reason: "too_large" });
    await expect(drive.download(ENTITY, "../etc/passwd", 1024)).rejects.toBeInstanceOf(DriveFileRefusedError);
  });

  it("stops reading bytes past the limit even when Google's size was not given", async () => {
    state.tools[APP_TOOLS.driveMetadata] = () => ({ data: { name: "scan.png", mimeType: "image/png" } });
    state.tools[APP_TOOLS.driveDownload] = () => ({ data: { downloaded_file_content: { name: "scan.png", mimetype: "image/png", s3url: "https://files.composio.example/f/3" } } });
    state.files["/f/3"] = new Uint8Array(2048);
    await expect(new ComposioDriveFiles({ ...cfg(), fetch: fakeFetch }).download(ENTITY, "1ScanImage00001", 1024)).rejects.toMatchObject({ reason: "too_large" });
  });

  it("refuses a file link that is not HTTPS on a public host", async () => {
    state.tools[APP_TOOLS.driveMetadata] = () => ({ data: { name: "a.pdf", mimeType: "application/pdf" } });
    state.tools[APP_TOOLS.driveDownload] = () => ({ data: { downloaded_file_content: { name: "a.pdf", mimetype: "application/pdf", s3url: "http://169.254.169.254/latest" } } });
    await expect(new ComposioDriveFiles({ ...cfg(), fetch: fakeFetch }).download(ENTITY, "1PickedFile0002", 1024)).rejects.toThrow();
  });

  it("saves a PDF to My Drive through the proxy, as a multipart upload with drive.file", async () => {
    let sent: Record<string, unknown> | null = null;
    state.proxy = (b) => {
      sent = b;
      return { status: 200, data: { id: "1NewDriveFile01", webViewLink: "https://drive.google.com/file/d/1NewDriveFile01/view" } };
    };
    const out = await new ComposioDriveFiles({ ...cfg(), fetch: fakeFetch }).savePdf(ENTITY, { name: "Application as submitted.pdf", bytes: new Uint8Array([1, 2]) });
    expect(out).toEqual({ id: "1NewDriveFile01", url: "https://drive.google.com/file/d/1NewDriveFile01/view" });
    expect(sent).toMatchObject({ connected_account_id: "ca_drive", user_id: ENTITY, endpoint: "https://www.googleapis.com/upload/drive/v3/files", method: "POST" });
    const decoded = atob((sent as unknown as { binary_body: { base64: string } }).binary_body.base64);
    expect(decoded).toContain('{"name":"Application as submitted.pdf"}');
  });
});

describe("Salesforce", () => {
  beforeEach(() => {
    state.accounts = [{ id: "ca_sf", status: "ACTIVE", scope: "api refresh_token" }];
  });

  it("runs SALESFORCE_RUN_SOQL_QUERY, then follows SALESFORCE_QUERY_MORE", async () => {
    state.tools[APP_TOOLS.salesforceQuery] = () => ({ data: { totalSize: 3, done: false, nextRecordsUrl: "/services/data/v61.0/query/01gXX0000000001-2000", records: [{ attributes: { type: "Opportunity" }, Id: "006A" }, { attributes: { type: "Opportunity" }, Id: "006B" }] } });
    state.tools[APP_TOOLS.salesforceMore] = () => ({ data: { totalSize: 3, done: true, records: [{ attributes: { type: "Opportunity" }, Id: "006C" }] } });
    const rows = await new ComposioSalesforceSource(cfg()).query(ENTITY, "SELECT Id FROM Opportunity", 5000);
    expect(rows.map((r) => r.Id)).toEqual(["006A", "006B", "006C"]);
    expect(toolCalls(APP_TOOLS.salesforceQuery)[0]!.body!.arguments).toEqual({ query: "SELECT Id FROM Opportunity" });
    expect(toolCalls(APP_TOOLS.salesforceMore)[0]!.body!.arguments).toEqual({ next_records_url: "/services/data/v61.0/query/01gXX0000000001-2000" });
  });

  it("never runs anything but a SELECT, and stops one row past the limit", async () => {
    await expect(new ComposioSalesforceSource(cfg()).query(ENTITY, "DELETE FROM Account", 10)).rejects.toBeInstanceOf(SourceReadError);
    expect(state.seen.filter((s) => s.path.includes("/tools/execute/"))).toHaveLength(0);
    state.tools[APP_TOOLS.salesforceQuery] = () => ({ data: { done: false, nextRecordsUrl: "/services/data/v61.0/query/01gXX0000000001-2000", records: [{ Id: "1" }, { Id: "2" }, { Id: "3" }] } });
    expect(await new ComposioSalesforceSource(cfg()).query(ENTITY, "SELECT Id FROM Account", 2)).toHaveLength(3);
    expect(toolCalls(APP_TOOLS.salesforceMore)).toHaveLength(0);
  });

  it("does not follow a next-page link that is not Salesforce's own query path", async () => {
    state.tools[APP_TOOLS.salesforceQuery] = () => ({ data: { done: false, nextRecordsUrl: "https://evil.example/steal", records: [{ Id: "1" }] } });
    expect(await new ComposioSalesforceSource(cfg()).query(ENTITY, "SELECT Id FROM Account", 10)).toHaveLength(1);
    expect(toolCalls(APP_TOOLS.salesforceMore)).toHaveLength(0);
  });
});
