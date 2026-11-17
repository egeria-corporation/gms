// SPDX-License-Identifier: AGPL-3.0-only
// Human only (v1.9.0 integration): every action the brief names as a person's own is refused to an
// agent (a delegated token carrying every scope of the person's role) and to an API client (a
// workspace token carrying every scope), with a valid body. Driven from one list, so an entry is
// one line; each refusal must be a 403 that says a person is needed (or, for a gated MCP action,
// that a person must approve it; or, for a route that takes only a person's session, the 401 that
// says so), never a 400, 404 or success, and nothing is written.
import { FixtureCalendarSync, FixtureDriveFiles, FixtureQuickBooksBooks, FixtureSalesforceSource, FixtureSearchConsole, FixtureSlackAlerts } from "@gms/connectors";
import { beforeEach, describe, expect, it } from "vitest";
import { SCOPES, WORKSPACE_CLAIM, scopesForRole } from "../src/auth/scopes.ts";
import { CLIENT_AGENT, USER_ADMIN, WS_APPLICANT, WS_FUNDER, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, scenario, type Scenario } from "./scenario.ts";

const NOWHERE = "00000000-0000-4000-8000-00000000dead";
/** The refusals that say a signed-in person is needed. */
const PERSON_CODES = ["human_only", "person_required", "person_only", "approval_required"];

interface Entry {
  what: string;
  side: "funder" | "applicant";
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: (x: Fixture) => string;
  body?: (x: Fixture) => unknown;
  /** A route that takes a signed-in person's session only (moderation): any token is refused before the route, 401 session_required. */
  sessionOnly?: true;
}
interface Fixture {
  s: Scenario;
  outside: string;
  run: string;
  /** v1.12.0: a Salesforce import's dry run, the funder's program, a listing waiting for a moderator, a "Two weeks left" prompt, a form and a call carrying Spanish (the call published). */
  salesforceRun: string;
  program: string;
  listing: string;
  reminder: string;
  bilingualForm: string;
  bilingualOpp: string;
}

const ENTRIES: Entry[] = [
  { what: "social preview", side: "funder", method: "POST", path: () => "/gms/social/posts/preview", body: (x) => ({ subject: { type: "opportunity", id: x.s.uuid.opp }, content: "Applications are open.", accountIds: [NOWHERE] }) },
  { what: "social post", side: "funder", method: "POST", path: () => "/gms/social/posts", body: (x) => ({ subject: { type: "opportunity", id: x.s.uuid.opp }, content: "Applications are open.", accountIds: [NOWHERE], previewToken: "x".repeat(20) }) },
  { what: "social connect", side: "funder", method: "POST", path: () => "/gms/social/connect", body: () => ({ platform: "linkedin" }) },
  { what: "social connect callback", side: "funder", method: "POST", path: () => "/gms/social/connect/callback", body: () => ({ state: "x".repeat(20), profileId: "prof_1", accountId: "acc_1" }) },
  { what: "social disconnect", side: "funder", method: "DELETE", path: () => `/gms/social/accounts/${NOWHERE}` },
  { what: "send-package email preview", side: "applicant", method: "POST", path: (x) => `/gms/outside-applications/${x.outside}/package/email/preview`, body: () => ({ to: "grants@northwind.example", message: "Hello" }) },
  { what: "send-package email", side: "applicant", method: "POST", path: (x) => `/gms/outside-applications/${x.outside}/package/email`, body: () => ({ to: "grants@northwind.example", message: "Hello", previewDigest: "a".repeat(64) }) },
  { what: "digest on", side: "applicant", method: "PUT", path: () => "/gms/digests", body: () => ({ new_matches: true }) },
  { what: "digest off", side: "funder", method: "PUT", path: () => "/gms/digests", body: () => ({ funder_activity: false }) },
  { what: "Fluxx connect", side: "funder", method: "POST", path: () => "/gms/imports/connections/fluxx", body: () => ({ instanceUrl: "https://acme.fluxx.io", clientId: "made-up-id", clientSecret: "made-up-secret" }) },
  { what: "Zengine connect", side: "funder", method: "POST", path: () => "/gms/imports/connections/zengine", body: () => ({ token: "made-up-token" }) },
  { what: "import commit", side: "funder", method: "POST", path: (x) => `/gms/imports/runs/${x.run}/commit` },
  { what: "gallery share", side: "funder", method: "POST", path: () => `/gms/workspaces/${WS_FUNDER}/gallery/submissions`, body: () => ({ source: { type: "rubric", id: NOWHERE }, title: "A rubric", summary: "A rubric to share.", tags: { fieldOfWork: [], grantSize: [], audience: [] }, licence: "CC-BY-4.0" }) },
  { what: "COI signature", side: "funder", method: "POST", path: (x) => `/gms/competitions/${x.s.compId}/coi-policy/sign`, body: () => ({ policyVersion: 1, signedName: "Dana Ortiz", agree: true, conflicts: [] }) },
  { what: "SSO requirement", side: "funder", method: "PUT", path: () => "/gms/sso/requirement", body: () => ({ require: true }) },
  { what: "migration request", side: "funder", method: "POST", path: () => "/gms/migration-requests", body: () => ({ name: "Ana Ruiz", email: "ana@riverbendcf.example", organization: "Riverbend Community Foundation", system: "fluxx", programs: "2-5", pastAwards: "100-999", timing: "asap", formToken: "x".repeat(40) }) },
  // v1.12.0 (Wave E): connecting apps, posting to Slack, copying to Drive, a Salesforce import, sending to PND, inviting peers, listing in the directory, Meet our grantees, publishing a second language.
  { what: "Slack connect", side: "funder", method: "POST", path: () => "/gms/connectors/slack", body: () => ({}) },
  { what: "Slack alerts on", side: "funder", method: "PUT", path: () => "/gms/connected-apps/slack", body: () => ({ channelId: "C0GRANTS01", events: ["new_application"], enabled: true }) },
  { what: "Calendar connect", side: "applicant", method: "POST", path: () => "/gms/connected-apps/calendar", body: () => ({}) },
  { what: "Drive connect", side: "applicant", method: "POST", path: () => "/gms/connectors/google_drive", body: () => ({}) },
  { what: "Drive save", side: "applicant", method: "POST", path: () => "/gms/connected-apps/google-drive/save", body: (x) => ({ kind: "outside_application", id: x.outside }) },
  { what: "Salesforce connect", side: "funder", method: "POST", path: () => "/gms/connectors/salesforce", body: () => ({}) },
  { what: "Salesforce import commit", side: "funder", method: "POST", path: (x) => `/gms/imports/runs/${x.salesforceRun}/commit` },
  { what: "PND preview", side: "funder", method: "POST", path: (x) => `/gms/opportunities/opp_${x.s.uuid.opp}/syndication/pnd/preview`, body: () => ({}) },
  { what: "PND send", side: "funder", method: "POST", path: (x) => `/gms/opportunities/opp_${x.s.uuid.opp}/syndication/pnd`, body: () => ({ digest: "a".repeat(64) }) },
  { what: "peer invitation preview", side: "funder", method: "POST", path: () => "/gms/peer-invitations/preview", body: () => ({ email: "peer@northwind.example", note: "We moved our whole cycle here." }) },
  { what: "peer invitation", side: "funder", method: "POST", path: () => "/gms/peer-invitations", body: () => ({ email: "peer@northwind.example", note: "We moved our whole cycle here.", token: "x".repeat(20), digest: "a".repeat(64) }) },
  { what: "directory listing", side: "funder", method: "PUT", path: () => "/gms/partner-settings/listing", body: () => ({ region: "Oregon" }) },
  { what: "directory approval", side: "funder", method: "POST", path: (x) => `/gms/partners/moderation/listings/${x.listing}/approve`, body: () => ({}), sessionOnly: true },
  { what: "Meet our grantees post", side: "funder", method: "POST", path: () => "/gms/social/posts", body: (x) => ({ subject: { type: "program", id: x.program }, content: "Meet our grantees.", accountIds: [NOWHERE], previewToken: "x".repeat(20) }) },
  { what: "share-kit tagging consent", side: "funder", method: "PUT", path: () => "/gms/share-kit/profile", body: () => ({ pageUrl: "https://www.linkedin.com/company/riverbend-cf", tagConsent: true }) },
  { what: "reminder dismiss", side: "funder", method: "POST", path: (x) => `/gms/social/reminders/${x.reminder}/dismiss` },
  { what: "bilingual form publish", side: "funder", method: "POST", path: (x) => `/gms/forms/frm_${x.bilingualForm}/publish` },
  { what: "bilingual call publish", side: "funder", method: "POST", path: (x) => `/gms/opportunities/opp_${x.bilingualOpp}/publish`, body: () => ({}) },
  { what: "published call's Spanish", side: "funder", method: "PATCH", path: (x) => `/gms/opportunities/opp_${x.s.uuid.opp}`, body: () => ({ translations: { es: { title: { text: "Subvenciones de salud comunitaria", source: "Community Health Grants 2027" } } } }) },
  // v1.13.0 (Wave F): joining a draft's live channel, connecting QuickBooks and every write to the books' settings, the operators' writes.
  { what: "presence pass", side: "applicant", method: "POST", path: () => "/gms/presence/passes", body: (x) => ({ draft: { kind: "outside_application", id: x.outside } }) },
  { what: "QuickBooks connect", side: "funder", method: "POST", path: () => "/gms/connectors/quickbooks", body: () => ({}) },
  { what: "QuickBooks disconnect", side: "funder", method: "DELETE", path: () => "/gms/connectors/quickbooks" },
  { what: "accounting settings", side: "funder", method: "PUT", path: () => "/gms/accounting/settings", body: () => ({ expenseId: "61", paidFromId: "35", tracking: "class", programs: {}, vendorPolicy: "create", syncEnabled: true }) },
  { what: "accounting vendors", side: "funder", method: "PUT", path: () => "/gms/accounting/vendors", body: () => ({ vendors: [{ granteeId: WS_APPLICANT, vendorId: "56" }] }) },
  { what: "accounting entry handled", side: "funder", method: "POST", path: () => `/gms/accounting/entries/${NOWHERE}/handled` },
  { what: "accounting entry retry", side: "funder", method: "POST", path: () => `/gms/accounting/entries/${NOWHERE}/retry` },
  { what: "lost deal", side: "funder", method: "POST", path: () => "/gms/operator/lost-deals", body: () => ({ reason: "forms" }), sessionOnly: true },
  { what: "Search Console connect", side: "funder", method: "POST", path: () => "/gms/operator/search-console/connect", body: () => ({}), sessionOnly: true },
  { what: "Search Console property", side: "funder", method: "PUT", path: () => "/gms/operator/search-console/site", body: () => ({ siteUrl: "https://app.gms.test/" }), sessionOnly: true },
  { what: "Search Console disconnect", side: "funder", method: "DELETE", path: () => "/gms/operator/search-console", sessionOnly: true },
  { what: "share-kit use", side: "funder", method: "POST", path: () => `/gms/awards/awd_${NOWHERE}/sharing/uses`, body: () => ({ kind: "portrait" }) },
];

let h: Harness;
let x: Fixture;
let seq = 0;

beforeEach(async () => {
  h = await harness();
  const s = await scenario(h);
  h.env.ZERNIO_API_KEY = "zk_test_made_up";
  h.env.ZERNIO_WEBHOOK_SECRET = "zernio-webhook-secret-for-unit-tests";
  const fr = await h.repos.table("funder_records").insert({ workspace_id: WS_APPLICANT, name: "Northwind Foundation" } as never);
  const outside = await h.repos.table("outside_applications").insert({ workspace_id: WS_APPLICANT, funder_record_id: fr.id, title: "Rural clinics 2027", stage: "drafting" } as never);
  const run = await h.repos.table("import_runs").insert({ workspace_id: WS_FUNDER, target: "award_history", source: "csv", source_label: "history.csv", mapping: {} as never, rows_total: 1 } as never);
  // v1.12.0: the connected apps configured, so a refusal is about who calls, not what is set up.
  Object.assign(h.extraPorts, { slack: new FixtureSlackAlerts(), calendar: new FixtureCalendarSync(), drive: new FixtureDriveFiles({}), salesforce: new FixtureSalesforceSource({ Opportunity: [] }) });
  // v1.13.0: QuickBooks and Search Console configured, and the admin an operator, so a refusal is about who calls.
  Object.assign(h.extraPorts, { quickbooks: new FixtureQuickBooksBooks(), searchConsole: new FixtureSearchConsole() });
  h.env.OPERATORS = USER_ADMIN;
  const salesforceRun = await h.repos.table("import_runs").insert({ workspace_id: WS_FUNDER, target: "award_history", source: "salesforce", source_label: "Salesforce · Grants", mapping: {} as never, rows_total: 1 } as never);
  const program = (await h.repos.table("programs").find({ workspace_id: WS_FUNDER }, { limit: 1 }))[0] ?? (await h.repos.table("programs").insert({ workspace_id: WS_FUNDER, name: "Community Health 2027", fiscal_year: 2027, currency: "USD" } as never));
  const listing = await h.repos.table("directory_listings").insert({ workspace_id: WS_FUNDER, region: "Oregon" } as never);
  const reminder = await h.repos.table("social_reminder_prompts").insert({ workspace_id: WS_FUNDER, opportunity_id: s.uuid.opp, deadline: "2027-06-30" } as never);
  const spanish = { es: { title: { text: "Carta de intención", source: "Letter of intent" } } };
  const bilingualForm = await h.repos.table("forms").insert({ workspace_id: WS_FUNDER, version: 1, title: "Letter of intent", purpose: "loi", json_schema: { type: "object", properties: { projectTitle: { type: "string" } } } as never, ui_schema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/projectTitle" }] } as never, translations: spanish as never } as never);
  const bilingualOpp = await h.repos.table("opportunities").insert({ workspace_id: WS_FUNDER, program_id: program.id, slug: "bilingual-call", title: "Bilingual call", description: "A call in two languages.", status: "forecasted", custom_fields: { translations: { name: "translations", fieldType: "object", value: { es: { title: { text: "Convocatoria bilingüe", source: "Bilingual call" } } } } } as never } as never);
  await h.repos.table("opportunities").update({ id: s.uuid.opp }, { published_at: "2027-04-01T12:00:00.000Z" });
  x = { s, outside: outside.id, run: run.id, salesforceRun: salesforceRun.id, program: program.id, listing: listing.id, reminder: reminder.id, bilingualForm: bilingualForm.id, bilingualOpp: bilingualOpp.id };
});

/** An agent acting for the workspace's admin, with every scope of that role; and an API client with every scope. */
async function tokens(side: Entry["side"]) {
  const ws = side === "funder" ? WS_FUNDER : WS_APPLICANT;
  const user = side === "funder" ? USER_ADMIN : USER_APPLICANT;
  const agent = await h.forge({ sub: user, client_id: CLIENT_AGENT, scope: scopesForRole(side, "admin").join(" "), [WORKSPACE_CLAIM]: ws, jti: `tok-human-${++seq}` });
  const client = await h.forge({ scope: SCOPES.join(" "), [WORKSPACE_CLAIM]: ws, jti: `tok-client-${++seq}` });
  return { ws, as: { agent, client } };
}

describe("a person's own actions refuse agents and API clients", () => {
  it("lists every action the brief names", () => {
    expect(ENTRIES.map((e) => e.what)).toEqual([
      "social preview", "social post", "social connect", "social connect callback", "social disconnect", "send-package email preview", "send-package email", "digest on", "digest off", "Fluxx connect", "Zengine connect", "import commit", "gallery share", "COI signature", "SSO requirement", "migration request",
      "Slack connect", "Slack alerts on", "Calendar connect", "Drive connect", "Drive save", "Salesforce connect", "Salesforce import commit", "PND preview", "PND send", "peer invitation preview", "peer invitation", "directory listing", "directory approval", "Meet our grantees post", "share-kit tagging consent", "reminder dismiss", "bilingual form publish", "bilingual call publish", "published call's Spanish",
      "presence pass", "QuickBooks connect", "QuickBooks disconnect", "accounting settings", "accounting vendors", "accounting entry handled", "accounting entry retry", "lost deal", "Search Console connect", "Search Console property", "Search Console disconnect", "share-kit use",
    ]);
  });

  it.each(ENTRIES.map((e) => [e.what, e] as const))("%s", async (_what, e) => {
    const { ws, as } = await tokens(e.side);
    const writesBefore = h.ledger.events.length;
    for (const [kind, token] of Object.entries(as)) {
      const body = e.body?.(x);
      const res = await h.request(e.path(x), { method: e.method, headers: { Authorization: `Bearer ${token}`, "X-GMS-Workspace": ws, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await res.text();
      const code = (JSON.parse(text) as { errors?: { code?: string }[]; code?: string }).errors?.[0]?.code ?? "";
      expect([e.what, kind, res.status], text.slice(0, 300)).toEqual([e.what, kind, e.sessionOnly ? 401 : 403]);
      expect(e.sessionOnly ? ["session_required"] : PERSON_CODES, `${e.what} as ${kind}: ${text.slice(0, 200)}`).toContain(code);
    }
    // Nothing happened: no ledger event, no post, account, subscription, connection, submission or signature.
    expect(h.ledger.events.length).toBe(writesBefore);
    expect(await h.repos.table("social_posts").count({})).toBe(0);
    expect(await h.repos.table("package_sends").count({})).toBe(0);
    expect(await h.repos.table("digest_subscriptions").count({})).toBe(0);
    expect(await h.repos.table("connector_accounts").count({ provider: ["fluxx", "zengine"] })).toBe(0);
    expect(await h.repos.table("gallery_submissions").count({})).toBe(0);
    expect(await h.repos.table("coi_signatures").count({})).toBe(0);
    expect(h.mailer.sent).toEqual([]);
    // v1.12.0: no app connected, alert set, calendar linked, PND send, invitation, listing decision, prompt dismissed, form or call published, Spanish changed.
    expect(await h.repos.table("connector_accounts").count({ provider: ["slack", "google_drive", "salesforce"] })).toBe(0);
    expect(await h.repos.table("alert_subscriptions").count({})).toBe(0);
    expect(await h.repos.table("calendar_links").count({})).toBe(0);
    expect(await h.repos.table("syndication_sends").count({})).toBe(0);
    expect(await h.repos.table("peer_invitations").count({})).toBe(0);
    expect(await h.repos.table("share_kit_profiles").count({})).toBe(0);
    expect((await h.repos.table("directory_listings").one({ id: x.listing }))!.status).toBe("pending");
    expect((await h.repos.table("social_reminder_prompts").one({ id: x.reminder }))!.dismissed_at).toBeNull();
    expect((await h.repos.table("forms").one({ id: x.bilingualForm }))!.published_at).toBeNull();
    expect((await h.repos.table("opportunities").one({ id: x.bilingualOpp }))!.published_at).toBeNull();
    expect(JSON.stringify((await h.repos.table("opportunities").one({ id: x.s.uuid.opp }))!.custom_fields ?? {})).not.toContain("Subvenciones");
    // v1.13.0: no pass, QuickBooks connection or setting, lost deal or Search Console property.
    expect(await h.repos.table("presence_passes").count({})).toBe(0);
    expect(await h.repos.table("connector_accounts").count({ provider: "quickbooks" })).toBe(0);
    expect(await h.repos.table("accounting_links").count({})).toBe(0);
    expect(await h.repos.table("lost_deals").count({})).toBe(0);
    expect(await h.repos.table("operator_settings").count({})).toBe(0);
    expect(await h.repos.table("share_kit_uses").count({})).toBe(0);
  });

  it("lets an agent publish a form in one language as before, and a person publish the Spanish one", async () => {
    const { ws, as } = await tokens("funder");
    const headers = { Authorization: `Bearer ${as.agent}`, "X-GMS-Workspace": ws, "Content-Type": "application/json" };
    const one = await h.repos.table("forms").insert({ workspace_id: WS_FUNDER, version: 1, title: "One language", purpose: "loi", json_schema: { type: "object", properties: { projectTitle: { type: "string" } } } as never, ui_schema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/projectTitle" }] } as never } as never);
    expect((await h.request(`/gms/forms/frm_${one.id}/publish`, { method: "POST", headers })).status).toBe(200);
    // A person publishes the Spanish one.
    const person = { ...(await import("./helpers.ts")).bearer(await h.session(USER_ADMIN)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" };
    expect((await h.request(`/gms/forms/frm_${x.bilingualForm}/publish`, { method: "POST", headers: person })).status).toBe(200);
  });
});
