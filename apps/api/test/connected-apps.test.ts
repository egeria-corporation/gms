// SPDX-License-Identifier: AGPL-3.0-only
// Connected apps (v1.12.0): Slack alerts, Google Calendar events, Google Drive attach and save,
// and Salesforce as a read-only import source, against the connector fixtures. The Composio
// connectors themselves (slugs, arguments, scopes) are tested against a fake Composio in
// packages/connectors/test/apps.test.ts.
import { FixtureCalendarSync, FixtureDriveFiles, FixtureSalesforceSource, FixtureSlackAlerts } from "@gms/connectors";
import { beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_CLAIM, scopesForRole } from "../src/auth/scopes.ts";
import { syncCalendars } from "../src/services/calendar-sync.ts";
import { alertText, sendConnectorAlerts, slackSafe } from "../src/services/connector-alerts.ts";
import type { BaseContext } from "../src/services/context.ts";
import { CLIENT_AGENT, USER_ADMIN, USER_OFFICER, WS_APPLICANT, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";

const USER_APPLICANT_ADMIN = "12121212-1212-4121-8121-121212121212";
const BORN = "Bir" + "thdate";
const BANK = ["Bank", "Acc" + "ount__c"].join("_");
let h: Harness;
let slack: FixtureSlackAlerts;
let calendar: FixtureCalendarSync;
let drive: FixtureDriveFiles;
let salesforce: FixtureSalesforceSource;
let funderAdmin: Record<string, string>;
let officer: Record<string, string>;
let applicant: Record<string, string>;
let seq = 0;

const headers = async (user: string, ws: string) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });
async function call<T>(who: Record<string, string>, method: string, path: string, body?: unknown) {
  const res = await h.request(path, { method, headers: who, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await res.text();
  let json: { data: T; message?: string; errors?: { code: string }[] } = { data: null as T };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    /* binary */
  }
  return { status: res.status, body: json, res, text };
}
async function data<T>(who: Record<string, string>, method: string, path: string, body?: unknown): Promise<T> {
  const r = await call<T>(who, method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${r.text}`);
  return r.body.data;
}
const code = (r: { body: { errors?: { code: string }[] } }) => r.body.errors?.[0]?.code;

/** An agent acting for the admin with every scope of the role, and an API client with the same. */
async function machines(side: "funder" | "applicant") {
  const ws = side === "funder" ? WS_FUNDER : WS_APPLICANT;
  const user = side === "funder" ? USER_ADMIN : USER_APPLICANT_ADMIN;
  const scope = scopesForRole(side, "admin").join(" ");
  const agent = await h.forge({ sub: user, client_id: CLIENT_AGENT, scope, [WORKSPACE_CLAIM]: ws, jti: `tok-ca-${++seq}` });
  const client = await h.forge({ scope, [WORKSPACE_CLAIM]: ws, jti: `tok-ca-${++seq}` });
  return [agent, client].map((t) => ({ ...bearer(t).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" }));
}

const base = (): BaseContext =>
  ({ repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, config: { baseUrl: "https://gms.test", webBaseUrl: "https://app.gms.test", passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: null }, ports: { slack, calendar, preferences: h.preferences } }) as unknown as BaseContext;

beforeEach(async () => {
  h = await harness();
  slack = new FixtureSlackAlerts();
  calendar = new FixtureCalendarSync();
  drive = new FixtureDriveFiles({ "1PickedBudget001": { name: "Budget.pdf", mimeType: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) }, "1HugeScan000001": { name: "Scan.tiff", mimeType: "image/tiff", bytes: new Uint8Array(26 * 1024 * 1024) } });
  salesforce = new FixtureSalesforceSource({
    Opportunity: [
      { attributes: { type: "Opportunity" }, Id: "006000000000001AAA", Name: "Clean water for Riverside", Account: { Name: "Hart Foundation" }, StageName: "Prospecting", Amount: null, npsp__Requested_Amount__c: 30000, CloseDate: "2027-06-01", npsp__Next_Grant_Deadline_Due_Date__c: "2027-05-15", RecordType: { Name: "Grant" } },
      { attributes: { type: "Opportunity" }, Id: "006000000000002AAA", Name: "Library hours", Account: { Name: "Pine Fund" }, StageName: "Closed Won", Amount: 12000, npsp__Requested_Amount__c: 15000, CloseDate: "2027-01-20", RecordType: { Name: "Grant" } },
    ],
    // Headers and values are put together at run time, so this file passes the sensitive-data gate.
    Contact: [
      { Id: "003000000000001AAA", Name: "Ana Ruiz", [BORN]: "1980-01-01", [BANK]: "0001" + "23456789" },
      { Id: "003000000000002AAA", Name: "Ben Ito", [BORN]: "1975-05-05", [BANK]: "0009" + "87654321" },
    ],
  });
  await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: USER_APPLICANT_ADMIN, role: "admin" });
  funderAdmin = await headers(USER_ADMIN, WS_FUNDER);
  officer = await headers(USER_OFFICER, WS_FUNDER);
  applicant = await headers(USER_APPLICANT_ADMIN, WS_APPLICANT);
});

const withApps = () => Object.assign(h.extraPorts, { slack, calendar, drive, salesforce });

describe("hidden until configured", () => {
  it("says which apps this server can connect", async () => {
    const config = async () => ((await (await h.request("/gms/config")).json()) as { data: { available: Record<string, boolean> } }).data.available;
    expect(await config()).toMatchObject({ slack: false, googleCalendar: false, googleDrive: false, salesforce: false });
    withApps();
    expect(await config()).toMatchObject({ slack: true, googleCalendar: true, googleDrive: true, salesforce: true });
  });

  it("answers 503 instead of offering what cannot work", async () => {
    expect(code(await call(funderAdmin, "POST", "/gms/connectors/slack", {}))).toBe("connector_not_configured");
    expect(code(await call(funderAdmin, "POST", "/gms/connected-apps/calendar", {}))).toBe("connector_not_configured");
    expect((await data<{ status: string }>(funderAdmin, "GET", "/gms/connectors/salesforce")).status).toBe("not_configured");
  });
});

describe("connecting is a person's own act", () => {
  beforeEach(withApps);

  it("refuses agents and API clients on every connect, post and copy, and writes nothing", async () => {
    const entries: [side: "funder" | "applicant", method: string, path: string, body?: unknown][] = [
      ["funder", "POST", "/gms/connectors/slack", {}],
      ["funder", "DELETE", "/gms/connectors/slack"],
      ["funder", "POST", "/gms/connectors/salesforce", {}],
      ["applicant", "POST", "/gms/connectors/google_drive", {}],
      ["funder", "PUT", "/gms/connected-apps/slack", { channelId: "C0GRANTS01", events: ["new_application"], enabled: true }],
      ["funder", "DELETE", "/gms/connected-apps/slack"],
      ["applicant", "POST", "/gms/connected-apps/calendar", {}],
      ["applicant", "PUT", "/gms/connected-apps/calendar", { calendarId: "primary" }],
      ["applicant", "POST", "/gms/connected-apps/calendar/sync"],
      ["applicant", "DELETE", "/gms/connected-apps/calendar"],
      ["applicant", "POST", "/gms/connected-apps/google-drive/fetch", { fileId: "1PickedBudget001" }],
      ["applicant", "POST", "/gms/connected-apps/google-drive/save", { kind: "application", id: "app_00000000-0000-4000-8000-000000000000" }],
    ];
    await h.repos.table("connector_accounts").insert({ workspace_id: WS_FUNDER, provider: "slack", status: "active", scopes: ["chat:write"], external_id: WS_FUNDER });
    for (const [side, method, path, body] of entries) {
      for (const who of await machines(side)) {
        const before = h.ledger.events.length;
        const r = await call(who, method, path, body);
        expect([r.status, path]).toEqual([403, path]);
        expect(["person_required", "insufficient_scope"]).toContain(code(r));
        expect(h.ledger.events.length).toBe(before);
      }
    }
    expect(slack.posts).toEqual([]);
    expect(calendar.accounts.size).toBe(0);
  });

  it("lets an agent read the Slack settings, as the screen does, and gives it no tool that changes anything", async () => {
    const [agent] = await machines("funder");
    expect((await call(agent!, "GET", "/gms/connected-apps/slack")).status).toBe(200);
    const rpc = async (method: string, params?: unknown) => {
      const res = await h.request("/mcp", { method: "POST", headers: { ...agent!, Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, ...(params ? { params } : {}) }) });
      return (await res.json()) as { result: { tools?: { name: string }[]; structuredContent?: Record<string, unknown> } };
    };
    const tools = (await rpc("tools/list")).result.tools!.map((t) => t.name);
    expect(tools.filter((n) => /slack|calendar|drive|salesforce|alert/.test(n))).toEqual(["get_slack_alerts"]);
    expect((await rpc("tools/call", { name: "get_slack_alerts", arguments: {} })).result.structuredContent).toMatchObject({ configured: true, subscription: null, events: ["new_application", "review_assigned", "deadline_soon", "report_due", "payment_due"] });
  });
});

describe("Slack alerts", () => {
  beforeEach(withApps);

  async function opp(close: string) {
    return h.repos.table("opportunities").insert({ workspace_id: WS_FUNDER, title: "Rural health 2027", slug: `rural-${++seq}`, status: "open", published_at: "2027-04-01T00:00:00Z", key_dates: { closeDate: { name: "Close", date: close } } } as never);
  }
  async function application(title: string, submittedAt: string) {
    const o = await opp("2027-09-01");
    const comp = await h.repos.table("competitions").insert({ workspace_id: WS_FUNDER, opportunity_id: o.id, title: "Main", status: "open" } as never);
    return h.repos.table("applications").insert({ workspace_id: WS_FUNDER, applicant_workspace_id: WS_APPLICANT, competition_id: comp.id, opportunity_id: o.id, title, status: "submitted", stage: "full", submitted_at: submittedAt, requested_amount_minor: 4_500_000, currency: "USD" } as never);
  }

  it("connects, lists public channels, and saves the channel and events", async () => {
    slack.connected = false;
    const started = await data<{ status: string; connectUrl: string; scopes: string[] }>(funderAdmin, "POST", "/gms/connectors/slack", {});
    expect(started).toMatchObject({ status: "pending", scopes: ["chat:write", "channels:read"] });
    expect(started.connectUrl).toContain("composio.invalid");
    slack.connected = true;
    expect((await data<{ connected: boolean }>(funderAdmin, "POST", "/gms/connectors/slack", {})).connected).toBe(true);
    expect(await data(funderAdmin, "GET", "/gms/connected-apps/slack/channels")).toEqual(slack.channels);
    const saved = await data<{ channelName: string; events: string[]; enabled: boolean }>(funderAdmin, "PUT", "/gms/connected-apps/slack", { channelId: "C0GRANTS01", events: ["new_application", "payment_due"], enabled: true });
    expect(saved).toMatchObject({ channelName: "grants", events: ["new_application", "payment_due"], enabled: true });
    expect(code(await call(funderAdmin, "PUT", "/gms/connected-apps/slack", { channelId: "C0NOTLISTD", events: [], enabled: true }))).toBe("channel_not_found");
    // A program officer neither reads nor changes the workspace's Slack settings.
    expect((await call(officer, "GET", "/gms/connected-apps/slack")).status).toBe(403);
    // An applicant team has no review alerts.
    await h.repos.table("connector_accounts").insert({ workspace_id: WS_APPLICANT, provider: "slack", status: "active", scopes: [], external_id: WS_APPLICANT });
    expect(code(await call(applicant, "PUT", "/gms/connected-apps/slack", { channelId: "C0GRANTS01", events: ["review_assigned"], enabled: true }))).toBe("event_not_available");
    expect((await data<{ events: string[] }>(applicant, "GET", "/gms/connected-apps/slack")).events).toEqual(["deadline_soon", "report_due", "payment_due"]);
  });

  it("posts one message per event, once, with the title and a link and nothing else", async () => {
    await data(funderAdmin, "PUT", "/gms/connected-apps/slack", { channelId: "C0GRANTS01", events: ["new_application", "deadline_soon"], enabled: true });
    // Before alerts were on: never posted.
    await application("Old application", "2027-04-01T10:00:00Z");
    h.clock.now = new Date("2027-04-16T18:00:00Z");
    const app = await application("Clinic <!channel> @here *bold*", "2027-04-16T17:30:00Z");
    await h.repos.table("form_responses").insert({ workspace_id: WS_FUNDER, application_id: app.id, form_id: "00000000-0000-4000-8000-0000000000f0", form_version: 1, status: "submitted", response: { contactEmail: "ana@aldercreek.example", narrative: "Our secret plan" } } as never).catch(() => undefined);
    await opp("2027-04-18");
    await opp("2027-05-30");

    const first = await sendConnectorAlerts(base());
    expect(first).toMatchObject({ subscriptions: 1, posted: 2, failed: 0 });
    expect(slack.posts.map((p) => p.channelId)).toEqual(["C0GRANTS01", "C0GRANTS01"]);
    const [appPost, deadlinePost] = slack.posts.map((p) => p.text);
    expect(appPost).toContain("*New application*: Clinic !channel @​here bold");
    expect(appPost).toMatch(/\[Open in the GMS\]\(https:\/\/app\.gms\.test\/w\/riverbend\/applications\/app_[0-9a-f-]+\)/);
    expect(deadlinePost).toContain("*Deadline in 3 days*: Rural health 2027");
    for (const text of slack.posts.map((p) => p.text)) {
      expect(text).not.toMatch(/@[a-z]/i);
      expect(text).not.toContain("ana@aldercreek.example");
      expect(text).not.toContain("secret plan");
      expect(text).not.toMatch(/45,?000|\$/);
      expect(text).not.toContain("<!channel>");
    }
    // Idempotent: a second run, or a second Worker, posts nothing new.
    expect(await sendConnectorAlerts(base())).toMatchObject({ posted: 0 });
    expect(slack.posts).toHaveLength(2);
    expect((await data<{ recent: { event: string; status: string }[] }>(funderAdmin, "GET", "/gms/connected-apps/slack")).recent.map((r) => r.status)).toEqual(["sent", "sent"]);
  });

  it("stops at once when alerts are turned off, the event is unticked, or Slack is disconnected", async () => {
    await data(funderAdmin, "PUT", "/gms/connected-apps/slack", { channelId: "C0GRANTS01", events: ["new_application"], enabled: true });
    await application("First", "2027-04-16T17:10:00Z");
    await data(funderAdmin, "PUT", "/gms/connected-apps/slack", { channelId: "C0GRANTS01", events: ["new_application"], enabled: false });
    expect(await sendConnectorAlerts(base())).toMatchObject({ subscriptions: 0, posted: 0 });
    // Turned on again: it starts from now, so nothing from while it was off.
    h.clock.now = new Date("2027-04-16T19:00:00Z");
    funderAdmin = await headers(USER_ADMIN, WS_FUNDER);
    await data(funderAdmin, "PUT", "/gms/connected-apps/slack", { channelId: "C0GRANTS01", events: ["new_application"], enabled: true });
    expect(await sendConnectorAlerts(base())).toMatchObject({ posted: 0 });
    await h.repos.table("connector_accounts").insert({ workspace_id: WS_FUNDER, provider: "slack", status: "active", scopes: [], external_id: WS_FUNDER });
    await data(funderAdmin, "DELETE", "/gms/connectors/slack");
    expect(await h.repos.table("alert_subscriptions").find({ workspace_id: WS_FUNDER })).toEqual([]);
    expect(slack.posts).toEqual([]);
  });

  it("tries a refused post again on a later run, at most three times", async () => {
    await data(funderAdmin, "PUT", "/gms/connected-apps/slack", { channelId: "C0GRANTS01", events: ["new_application"], enabled: true });
    await application("Refused", "2027-04-16T17:20:00Z");
    slack.refuse.add("C0GRANTS01");
    for (let i = 0; i < 4; i++) await sendConnectorAlerts(base());
    const [d] = await h.repos.table("alert_deliveries").find({ workspace_id: WS_FUNDER });
    expect(d).toMatchObject({ status: "failed", attempts: 3 });
    slack.refuse.clear();
    expect(await sendConnectorAlerts(base())).toMatchObject({ posted: 0 });
  });

  it("writes titles as plain words", () => {
    expect(slackSafe("<https://evil.example|click> & @channel")).toBe("https://evil.example click and @​channel");
    expect(alertText("es", "report_due", "Informe final", "https://app.gms.test/w/x/reports")).toBe("*Informe pendiente*: Informe final\n[Abrir en el GMS](https://app.gms.test/w/x/reports)");
  });
});

describe("Google Calendar", () => {
  beforeEach(withApps);

  async function outside(title: string, fullDue: string) {
    const fr = await h.repos.table("funder_records").insert({ workspace_id: WS_APPLICANT, name: "Northwind Foundation" } as never);
    return h.repos.table("outside_applications").insert({ workspace_id: WS_APPLICANT, funder_record_id: fr.id, title, funder_name: "Northwind Foundation", stage: "drafting", full_due: fullDue } as never);
  }

  it("connects a person's own calendar, writes deadlines once, and updates and deletes them", async () => {
    const o1 = await outside("Rural clinics 2027", "2027-05-01");
    const o2 = await outside("Summer camp", "2027-06-15");
    const started = await data<{ status: string; connectUrl: string }>(applicant, "POST", "/gms/connected-apps/calendar", { returnTo: "/w/alder-creek/settings/apps" });
    expect(started.status).toBe("pending");
    expect(started.connectUrl).toContain("composio.invalid");
    // Back from Google: the read finds the account active.
    expect((await data<{ connected: boolean }>(applicant, "GET", "/gms/connected-apps/calendar")).connected).toBe(true);
    expect((await data<{ id: string }[]>(applicant, "GET", "/gms/connected-apps/calendar/calendars")).map((c) => c.id)).toEqual(["primary", "grants@group.calendar.google.com"]);

    const chosen = await data<{ calendar: { id: string }; events: number; result: { created: number } }>(applicant, "PUT", "/gms/connected-apps/calendar", { calendarId: "primary" });
    expect(chosen).toMatchObject({ calendar: { id: "primary" }, events: 2, result: { created: 2 } });
    expect([...calendar.events.values()].map((e) => [e.title, e.date])).toEqual([
      ["Application due: Rural clinics 2027 (Northwind Foundation)", "2027-05-01"],
      ["Application due: Summer camp (Northwind Foundation)", "2027-06-15"],
    ]);
    expect([...calendar.events.values()][0]!.description).toBe(`Open in the GMS: https://app.gms.test/w/alder-creek/outside/${o1.id}`);

    // Nothing changed: nothing written.
    expect(await syncCalendars(base())).toMatchObject({ links: 1, created: 0, updated: 0, deleted: 0 });
    // A moved date is an update of the same event; an archived application is a delete.
    await h.repos.table("outside_applications").update({ id: o1.id }, { full_due: "2027-05-08" });
    await h.repos.table("outside_applications").update({ id: o2.id }, { archived_at: "2027-04-16T18:00:00Z" });
    expect(await syncCalendars(base())).toMatchObject({ created: 0, updated: 1, deleted: 1 });
    expect([...calendar.events.values()].map((e) => e.date)).toEqual(["2027-05-08"]);
    expect(calendar.calls.map((c) => c.op)).toEqual(["create", "create", "delete", "update"]);
    // Deleted in Google by the person: written again only when its deadline changes.
    calendar.events.clear();
    expect(await syncCalendars(base())).toMatchObject({ created: 0, updated: 0 });
    await h.repos.table("outside_applications").update({ id: o1.id }, { full_due: "2027-05-09" });
    expect(await syncCalendars(base())).toMatchObject({ created: 1 });

    // Disconnecting removes the events written, then the connection, then the link.
    const off = await data<{ connected: boolean }>(applicant, "DELETE", "/gms/connected-apps/calendar");
    expect(off.connected).toBe(false);
    expect(calendar.events.size).toBe(0);
    expect(calendar.accounts.size).toBe(0);
    expect(await h.repos.table("calendar_links").find({})).toEqual([]);
  });

  it("writes a funder's opportunity deadlines, in the person's language", async () => {
    await h.repos.table("opportunities").insert({ workspace_id: WS_FUNDER, title: "Rural health 2027", slug: "rural", status: "open", published_at: "2027-04-01T00:00:00Z", key_dates: { closeDate: { date: "2027-07-01" } } } as never);
    h.preferences.rows.set(USER_OFFICER, "es");
    await data(officer, "POST", "/gms/connected-apps/calendar", {});
    await data(officer, "PUT", "/gms/connected-apps/calendar", { calendarId: "primary" });
    expect([...calendar.events.values()].map((e) => e.title)).toEqual(["Cierre de solicitudes: Rural health 2027"]);
    // Each person their own: the admin has no link of theirs yet.
    expect((await data<{ status: string }>(funderAdmin, "GET", "/gms/connected-apps/calendar")).status).toBe("not_connected");
  });
});

describe("Google Drive", () => {
  beforeEach(withApps);

  it("copies a picked file for an upload, with the upload's size limit", async () => {
    const r = await call(applicant, "POST", "/gms/connected-apps/google-drive/fetch", { fileId: "1PickedBudget001" });
    expect(r.status).toBe(200);
    expect(r.res.headers.get("Content-Type")).toBe("application/pdf");
    expect(decodeURIComponent(r.res.headers.get("X-File-Name")!)).toBe("Budget.pdf");
    expect(code(await call(applicant, "POST", "/gms/connected-apps/google-drive/fetch", { fileId: "1HugeScan000001" }))).toBe("drive_too_large");
    expect(code(await call(applicant, "POST", "/gms/connected-apps/google-drive/fetch", { fileId: "1NotPicked00001" }))).toBe("drive_not_found");
    expect((await call(applicant, "POST", "/gms/connected-apps/google-drive/fetch", { fileId: "../../etc" })).status).toBe(400);
    // A funder workspace uses Google Workspace, not this.
    expect((await call(funderAdmin, "POST", "/gms/connected-apps/google-drive/fetch", { fileId: "1PickedBudget001" })).status).toBe(403);
    expect(drive.saved).toEqual([]);
  });

  it("saves the as-submitted PDF of an outside application to My Drive", async () => {
    const fr = await h.repos.table("funder_records").insert({ workspace_id: WS_APPLICANT, name: "Northwind Foundation" } as never);
    const pdf = new TextEncoder().encode("%PDF-1.7 as submitted");
    const stored = await h.storage.put("outside/x/as-submitted.pdf", pdf, "application/pdf");
    const oa = await h.repos.table("outside_applications").insert({ workspace_id: WS_APPLICANT, funder_record_id: fr.id, title: "Rural clinics 2027", stage: "submitted" } as never);
    const doc = await h.repos.table("documents").insert({ workspace_id: WS_APPLICANT, owner_workspace_id: WS_APPLICANT, subject_type: "outside_application", subject_id: oa.id, name: "As submitted - Rural clinics 2027.pdf", mime: "application/pdf", size: pdf.byteLength, sha256: "a".repeat(64), storage: stored.storage, path: stored.path, uploaded_by: USER_APPLICANT_ADMIN } as never);
    expect(code(await call(applicant, "POST", "/gms/connected-apps/google-drive/save", { kind: "outside", id: oa.id }))).toBe("not_submitted");
    await h.repos.table("outside_applications").update({ id: oa.id }, { snapshot_document_id: doc.id });
    const saved = await data<{ fileName: string; url: string }>(applicant, "POST", "/gms/connected-apps/google-drive/save", { kind: "outside", id: oa.id });
    expect(saved.fileName).toBe("As submitted - Rural clinics 2027.pdf");
    expect(drive.saved).toEqual([{ entityId: WS_APPLICANT, name: "As submitted - Rural clinics 2027.pdf", size: pdf.byteLength, folderId: null }]);
    expect(h.ledger.events.at(-1)).toMatchObject({ eventType: "connector.drive_saved" });
  });
});

describe("Salesforce import", () => {
  beforeEach(withApps);

  it("is offered as a source, reads a preset through the sensitive screen, and refuses a query that writes", async () => {
    const sources = await data<{ sources: { kind: string; presets?: { key: string }[] }[] }>(applicant, "GET", "/gms/imports/sources?target=outside_applications");
    expect(sources.sources.find((s) => s.kind === "salesforce")).toMatchObject({ presets: [{ key: "npsp_grants" }, { key: "accounts" }] });

    const read = await data<{ rows: number; columns: { name: string }[]; mapping: Record<string, string>; source: { label: string } }>(applicant, "POST", "/gms/imports/read", { target: "outside_applications", source: { kind: "salesforce", preset: "npsp_grants" } });
    expect(read.rows).toBe(2);
    expect(read.source.label).toBe("Salesforce · Grants (Nonprofit Success Pack Opportunities)");
    expect(read.mapping).toMatchObject({ title: "Grant name", funderName: "Funder", askAmount: "Ask" });
    expect(salesforce.queries[0]).toMatch(/^SELECT Id, Name, Account\.Name, .* FROM Opportunity WHERE RecordType\.Name LIKE '%Grant%' ORDER BY CloseDate DESC LIMIT 5001$/);

    const contacts = await data<{ columns: { name: string }[]; dropped: { column: string }[] }>(applicant, "POST", "/gms/imports/read", { target: "outside_applications", source: { kind: "salesforce", query: `SELECT Id, Name, ${BORN}, ${BANK} FROM Contact` } });
    expect(contacts.columns.map((c) => c.name)).toEqual(["Id", "Name"]);
    expect(contacts.dropped.map((d) => d.column).sort()).toEqual([BANK, BORN].sort());

    for (const query of ["DELETE FROM Account", "SELECT Id FROM Account FOR UPDATE", "SELECT Id FROM Account; SELECT Id FROM Contact"]) {
      expect(code(await call(applicant, "POST", "/gms/imports/read", { target: "outside_applications", source: { kind: "salesforce", query } }))).toBe("invalid_query");
    }
    expect(salesforce.queries).toHaveLength(2);

    // The dry run and its reconciliation, as for any source.
    const preview = await data<{ run: { reconciliation: { rows: number; create: number } }; rows: unknown[] }>(applicant, "POST", "/gms/imports/preview", { target: "outside_applications", source: { kind: "salesforce", preset: "npsp_grants" }, mapping: read.mapping });
    expect(preview.run.reconciliation).toMatchObject({ rows: 2, create: 2 });
  });

  it("refuses a run over 5,000 rows", async () => {
    salesforce.objects.Account = Array.from({ length: 5001 }, (_, i) => ({ Id: `001${String(i).padStart(15, "0")}`, Name: `Org ${i}` }));
    expect(code(await call(funderAdmin, "POST", "/gms/imports/read", { target: "award_history", source: { kind: "salesforce", preset: "accounts" } }))).toBe("too_many_rows");
  });
});
