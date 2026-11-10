// SPDX-License-Identifier: AGPL-3.0-only
// Grantee directory and organization changes, CommonGrants /orgs, integrations, analytics,
// exports and imports, the Resend webhook and the ledger archive (build spec §9, §10.10, §10.13, §11.8).
import { verifyArchive } from "@gms/ledger";
import { encryptSecret, fixtureFetch, type Fixture } from "@gms/passport-client";
import { beforeEach, describe, expect, it } from "vitest";
import { archiveLedger, deliverWebhooks, pollBanks, syncPassport } from "../src/jobs.ts";
import type { BaseContext } from "../src/services/context.ts";
import { BASE, ORG_RIVERBEND, PASSPORT, RESEND_WEBHOOK_SECRET, TEST_CREDENTIALS_KEY, USER_ADMIN, USER_OFFICER, WEB, WS_APPLICANT, WS_FUNDER, WS_OTHER, bearer, harness, type Harness } from "./helpers.ts";
import type { ALDER_ORG} from "./scenario.ts";
import { ORG_ALDER, scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;
let admin: Record<string, string>;
let app: string;

const headers = async (user: string, ws: string) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });
const data = async <T>(who: Record<string, string>, method: string, path: string, body?: unknown): Promise<T> => {
  const r = await s.call<{ data: T }>(who, method, path, method === "GET" || method === "DELETE" ? undefined : (body ?? {}));
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const base = (): BaseContext => ({ repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, ports: { mailer: h.mailer, storage: h.storage, bank: h.bank }, config: { baseUrl: BASE, webBaseUrl: WEB, passportBaseUrl: PASSPORT, credentialsKey: TEST_CREDENTIALS_KEY, passportClient: null, mailFrom: "OpenGrants GMS <notices@gms.test>", webhookSecretKey: TEST_CREDENTIALS_KEY, ...(h.passport.fetch ? { passportFetch: h.passport.fetch } : {}) } });
const TOKEN: Fixture = { method: "POST", path: "/oauth/token", status: 200, body: { access_token: "passport-access-token-for-tests", token_type: "Bearer", expires_in: 3600, scope: "org:read" } };
const linkFunder = async () => h.repos.table("passport_links").insert({ workspace_id: WS_FUNDER, mode: "funder_client", client_id: "pc_riverbend_gms", client_secret_enc: await encryptSecret("passport-client-secret-for-tests", TEST_CREDENTIALS_KEY), scopes: ["org:read"], linked_at: h.clock.now.toISOString(), last_ok_at: h.clock.now.toISOString() });

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  admin = await headers(USER_ADMIN, WS_FUNDER);
  const started = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
  app = started.body.data.id;
  await s.call(s.applicant, "PUT", `/common-grants/applications/${app}/forms/${s.uuid.loi}`, { response: { projectTitle: "Mobile Health Navigation for Rural Families", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel 46 miles to reach primary care." } });
  expect((await s.call(s.applicant, "PUT", `/common-grants/applications/${app}/submit`)).status).toBe(200);
});

describe("grantee directory", () => {
  it("lists organizations the funder has a relationship with, and keeps the funder's own notes", async () => {
    const list = await s.call<{ items: { workspaceId: string; name: string; verificationLevel: string; applications: number }[] }>(s.funder, "GET", "/gms/grantees");
    expect(list.body.items).toMatchObject([{ workspaceId: WS_APPLICANT, name: "Alder Creek Family Services", verificationLevel: "L3", applications: 1 }]);
    const detail = await data<{ consent: boolean; organization: { name: string } | null; applicationList: unknown[] }>(s.funder, "GET", `/gms/grantees/${WS_APPLICANT}`);
    // Applying is the consent that lets this funder read the cached record.
    expect(detail).toMatchObject({ consent: true, organization: { name: "Alder Creek Family Services" } });
    const saved = await data<{ tags: string[]; notes: string }>(s.funder, "PATCH", `/gms/grantees/${WS_APPLICANT}`, { tags: ["rural", "health"], notes: "Met at the March convening." });
    expect(saved).toMatchObject({ tags: ["rural", "health"], notes: "Met at the March convening." });
    // Profile fields are not editable here.
    expect((await s.call(s.funder, "PATCH", `/gms/grantees/${WS_APPLICANT}`, { legalName: "Something Else" })).status).toBe(400);
    // Another funder has no relationship and sees nothing.
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: USER_OFFICER, role: "program_officer" });
    const other = await headers(USER_OFFICER, WS_OTHER);
    expect((await s.call<{ items: unknown[] }>(other, "GET", "/gms/grantees")).body.items).toEqual([]);
    expect((await s.call(other, "GET", `/gms/grantees/${WS_APPLICANT}`)).status).toBe(404);
  });

  it("files changes polled from Passport as pending, and a person accepts or dismisses them", async () => {
    await linkFunder();
    h.passport.fetch = fixtureFetch([TOKEN, { method: "GET", path: `/common-grants/orgs/${ORG_ALDER}/changes`, status: 200, body: { status: 200, message: "Success", items: [{ id: "chg_1", status: "accepted", patch: { addresses: { primary: { city: "Pine Hollow" } } } }, { id: "chg_2", status: "accepted", patch: { mission: "Updated mission." } }], paginationInfo: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 } } }]).fetch;
    const out = await syncPassport(base(), { orgChanges: true });
    expect(out).toMatchObject({ funders: 1, orgChanges: 2 });
    // Running the poll again adds nothing.
    expect((await syncPassport(base(), { orgChanges: true })).orgChanges).toBe(0);
    const inbox = await s.call<{ items: { id: string; changeId: string; status: string; grantee: { name: string } }[] }>(s.funder, "GET", "/gms/org-changes?status=pending");
    expect(inbox.body.items).toHaveLength(2);
    expect(inbox.body.items[0]!.grantee.name).toBe("Alder Creek Family Services");
    const [a, b] = inbox.body.items;
    expect(await data<{ status: string }>(s.funder, "POST", `/gms/org-changes/${a!.id}/accept`)).toMatchObject({ status: "accepted" });
    expect(await data<{ status: string }>(s.funder, "POST", `/gms/org-changes/${b!.id}/dismiss`)).toMatchObject({ status: "dismissed" });
    expect((await s.call(s.funder, "POST", `/gms/org-changes/${a!.id}/dismiss`)).status).toBe(409);
    expect((await data<{ pendingChanges: number }>(s.funder, "GET", `/gms/grantees/${WS_APPLICANT}`)).pendingChanges).toBe(0);
  });

  it("proposes a change to Passport as pending, explains a missing consent, and never forwards bank details", async () => {
    expect((await s.call(s.funder, "POST", `/gms/grantees/${WS_APPLICANT}/propose-change`, { patch: { mission: "x" } })).status).toBe(409);
    await linkFunder();
    const fx = fixtureFetch([TOKEN, { method: "POST", path: `/common-grants/orgs/${ORG_ALDER}/changes`, status: 202, body: { status: 202, message: "Accepted", data: { id: "chg_9", status: "pending" } }, headers: { Location: `/common-grants/orgs/${ORG_ALDER}/changes/chg_9` } }]);
    h.passport.fetch = fx.fetch;
    const res = await s.call<{ data: { status: string; changeId: string } }>(s.funder, "POST", `/gms/grantees/${WS_APPLICANT}/propose-change`, { patch: { addresses: { primary: { postalCode: "97001" } } } });
    expect(res.status).toBe(202);
    expect(res.body.data).toMatchObject({ status: "pending" });
    expect(fx.calls.find((c) => c.method === "POST" && c.path.endsWith("/changes"))!.body).toMatchObject({ addresses: { primary: { postalCode: "97001" } } });
    // The cached projection is not edited locally.
    expect(((await h.repos.table("workspaces").one({ id: WS_APPLICANT }))!.org_projection as typeof ALDER_ORG).addresses.primary.postalCode).toBe("97000");

    const sensitive = await s.call(s.funder, "POST", `/gms/grantees/${WS_APPLICANT}/propose-change`, { patch: { bankDetails: { name: "Harbor Bank" } } });
    expect(sensitive.status).toBe(422);
    h.passport.fetch = fixtureFetch([TOKEN, { method: "POST", path: `/common-grants/orgs/${ORG_ALDER}/changes`, status: 403, body: { status: 403, message: "Forbidden", errors: [{ code: "consent_required" }] } }]).fetch;
    const noConsent = await s.call<{ message: string; errors: { code: string }[] }>(s.funder, "POST", `/gms/grantees/${WS_APPLICANT}/propose-change`, { patch: { mission: "x" } });
    expect(noConsent.status).toBe(403);
    expect(noConsent.body.errors[0]!.code).toBe("consent_required");
    expect(noConsent.body.message).toContain("org.changes:write");
  });
});

describe("CommonGrants /orgs", () => {
  it("serves cached projections by consent, with Passport as the source", async () => {
    const funder = await s.call<{ items: { id: string; source: string }[] }>(s.funder, "GET", "/common-grants/orgs");
    expect(funder.body.items).toMatchObject([{ id: ORG_ALDER, source: `${PASSPORT}/common-grants/orgs/${ORG_ALDER}` }]);
    expect((await data<{ name: string }>(s.applicant, "GET", `/common-grants/orgs/${ORG_ALDER}`)).name).toBe("Alder Creek Family Services");
    const byEin = await s.call<{ items: unknown[] }>(s.funder, "GET", "/common-grants/orgs?registry=org:us:ein&id=001234567");
    expect(byEin.body.items).toHaveLength(1);
    expect((await s.call<{ items: unknown[] }>(s.funder, "GET", "/common-grants/orgs?registry=org:us:ein&id=999999999")).body.items).toHaveLength(0);
    // A funder with no consent sees nothing, and a guess answers 404.
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: USER_OFFICER, role: "program_officer" });
    const other = await headers(USER_OFFICER, WS_OTHER);
    expect((await s.call<{ items: unknown[] }>(other, "GET", "/common-grants/orgs")).body.items).toEqual([]);
    expect((await s.call(other, "GET", `/common-grants/orgs/${ORG_ALDER}`)).status).toBe(404);
    // PATCH is refused for anyone but the organization itself.
    expect((await s.call(s.funder, "PATCH", `/common-grants/orgs/${ORG_ALDER}`, { mission: "x" })).status).toBe(403);
  });
});

describe("integrations", () => {
  it("creates a webhook with a secret shown once, delivers signed events, and lists deliveries", async () => {
    const created = await s.call<{ data: { id: string; secret: string; events: string[] } }>(admin, "POST", "/gms/webhooks", { url: "https://hooks.example/gms", events: ["tranche.status.changed", "application.submitted"] });
    expect(created.status).toBe(201);
    expect(created.body.data.secret).toMatch(/^whsec_/);
    expect(JSON.stringify(await data(admin, "GET", "/gms/webhooks"))).not.toContain(created.body.data.secret);
    expect((await s.call(admin, "POST", "/gms/webhooks", { url: "http://plain.example/hook" })).status).toBe(422);
    expect((await s.call(s.funder, "GET", "/gms/webhooks")).status).toBe(403);

    // A second application submitted after the subscription exists fans out one delivery.
    await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: USER_ADMIN, role: "admin" });
    await h.webhooks.insertDelivery({ id: crypto.randomUUID(), subscriptionId: created.body.data.id, eventId: "evt_1", eventType: "application.submitted", payload: JSON.stringify({ id: "evt_1", type: "application.submitted" }), status: "pending", attempts: 0, nextAttemptAt: h.clock.now.toISOString(), lastStatusCode: null, lastError: null, deliveredAt: null, createdAt: h.clock.now.toISOString() });
    const seen: { url: string; headers: Headers; body: string }[] = [];
    const out = await deliverWebhooks(base(), (async (url: string, init?: RequestInit) => {
      seen.push({ url, headers: new Headers(init?.headers), body: String(init?.body) });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch);
    expect(out).toMatchObject({ attempted: 1, delivered: 1 });
    expect(seen[0]!.headers.get("X-GMS-Signature")).toMatch(/^v1=/);
    const deliveries = await data<{ status: string; eventType: string }[]>(admin, "GET", `/gms/webhooks/${created.body.data.id}/deliveries`);
    expect(deliveries).toMatchObject([{ status: "delivered", eventType: "application.submitted" }]);
    expect(await data<{ deleted: boolean }>(admin, "DELETE", `/gms/webhooks/${created.body.data.id}`)).toEqual({ deleted: true });
    expect((await s.call(admin, "DELETE", `/gms/webhooks/${created.body.data.id}`)).status).toBe(404);
  });

  it("issues an API client whose secret is shown once, and revokes it", async () => {
    const c = await s.call<{ data: { id: string; clientSecret: string; scopes: string[] } }>(admin, "POST", "/gms/api-clients", { name: "Board dashboard sync", scopes: ["awards:read", "analytics:read"] });
    expect(c.status).toBe(201);
    expect(c.body.data.clientSecret).toMatch(/^gms_cs_/);
    expect((await h.repos.table("api_clients").one({ id: c.body.data.id }))!.client_secret_hash).not.toContain(c.body.data.clientSecret);
    expect(JSON.stringify(await data(admin, "GET", "/gms/api-clients"))).not.toContain("gms_cs_");
    expect((await s.call(admin, "POST", "/gms/api-clients", { name: "Too powerful", scopes: ["approvals:bypass"] })).status).toBe(422);
    expect((await data<{ revokedAt: string }>(admin, "DELETE", `/gms/api-clients/${c.body.data.id}`)).revokedAt).not.toBeNull();
  });

  it("registers an MCP server and allow-lists read tools only", async () => {
    h.mcpDirectory.tools["https://crm.example/mcp"] = [{ name: "lookup_relationship", description: "Prior relationship", readOnly: true }, { name: "update_contact", description: "Write", readOnly: false }];
    expect((await s.call(admin, "POST", "/gms/custom-mcp-servers", { name: "CRM", url: "http://10.0.0.5/mcp" })).status).toBe(422);
    expect((await s.call(admin, "POST", "/gms/custom-mcp-servers", { name: "CRM", url: "https://crm.example/mcp", allowedTools: ["update_contact"] })).status).toBe(422);
    const reg = await s.call<{ data: { id: string; hasAuth: boolean; readOnly: boolean; tools: unknown[] } }>(admin, "POST", "/gms/custom-mcp-servers", { name: "CRM", url: "https://crm.example/mcp", authHeader: "Bearer crm-token-for-tests", allowedTools: ["lookup_relationship"] });
    expect(reg.status).toBe(201);
    expect(reg.body.data).toMatchObject({ hasAuth: true, readOnly: true });
    expect(JSON.stringify(await h.repos.table("custom_mcp_servers").find({}))).not.toContain("crm-token-for-tests");
    const tools = await data<{ name: string; allowed: boolean }[]>(admin, "GET", `/gms/custom-mcp-servers/${reg.body.data.id}/tools`);
    expect(tools).toMatchObject([{ name: "lookup_relationship", allowed: true }, { name: "update_contact", allowed: false }]);
    expect((await s.call(admin, "PATCH", `/gms/custom-mcp-servers/${reg.body.data.id}`, { allowedTools: ["update_contact"] })).status).toBe(422);
  });

  it("connects Mercury with a read-only token stored encrypted, and polls it from the job", async () => {
    const res = await data<{ connected: boolean; scopes: string[] }>(admin, "POST", "/gms/connectors/mercury", { token: "mercury-read-only-token-for-tests" });
    expect(res).toMatchObject({ connected: true, scopes: ["transactions:read"] });
    const row = (await h.repos.table("connector_accounts").one({ workspace_id: WS_FUNDER, provider: "mercury" }))!;
    expect(row.secret_enc).not.toContain("mercury-read-only-token");
    h.bank.transactions = [{ externalId: "mtx_9", amountMinor: 500_000, currency: "USD", postedAt: h.clock.now.toISOString(), counterpartyName: "Harbor Light Shelter", memo: null }];
    expect(await pollBanks(base())).toMatchObject({ workspaces: 1, added: 1, failed: 0 });
    expect(await pollBanks(base())).toMatchObject({ added: 0 });
    expect(await data<{ connected: boolean }>(admin, "DELETE", "/gms/connectors/mercury")).toMatchObject({ connected: false });
    expect((await h.repos.table("connector_accounts").one({ id: row.id }))!.secret_enc).toBeNull();
    expect((await s.call(admin, "GET", "/gms/connectors/stripe")).status).toBe(404);
    // Google Workspace lives at Composio; the GMS stores no credential for it.
    h.workspaceApps.people = [{ email: "marcus.lee@riverbendcf.example", name: "Marcus Lee" }];
    expect(await data<{ connected: boolean }>(admin, "POST", "/gms/connectors/google_workspace")).toMatchObject({ connected: true });
    expect(await data<{ email: string }[]>(admin, "GET", "/gms/directory/suggest?q=marcus")).toMatchObject([{ email: "marcus.lee@riverbendcf.example" }]);
  });
});

describe("analytics, exports and imports", () => {
  it("reports the portfolio and the cycle, with paid amounts only as Passport stated them", async () => {
    const program = await data<{ id: string }>(s.funder, "POST", "/gms/programs", { name: "Community Health 2027", budgetAmountMinor: 120_000_000, fiscalYear: 2027 });
    await h.repos.table("opportunities").update({ id: s.uuid.opp }, { program_id: program.id });
    const p = await data<{ decisions: { id: string }[] }>(s.funder, "POST", "/gms/decisions/propose", { competitionId: s.compId, decisions: [{ applicationId: `app_${app}`, outcome: "approve", amountMinor: 15_000_000 }] });
    const res = await data<{ results: { awardId: string }[] }>(s.funder, "POST", "/gms/decisions/commit", { competitionId: s.compId, decisionIds: [p.decisions[0]!.id] });
    const award = res.results[0]!.awardId.slice(4);
    await data(s.applicant, "POST", `/gms/my/awards/awd_${award}/accept`);
    let folio = await data<{ totals: { committedMinor: number; paidMinor: number }; programs: { name: string; committedMinor: number; paidMinor: number; budgetMinor: number }[] }>(s.funder, "GET", "/gms/analytics/portfolio?fy=2027");
    expect(folio.programs).toMatchObject([{ name: "Community Health 2027", budgetMinor: 120_000_000, committedMinor: 15_000_000, paidMinor: 0 }]);
    // A settled tranche alone does not change "paid": only the value read back from Passport does.
    const row = (await h.repos.table("awards").one({ id: award }))!;
    await h.repos.table("awards").update({ id: award }, { funding: { ...(row.funding as object), disbursedAmount: { amount: "75000.00", currency: "USD" } }, disbursed_at: "2027-05-25T17:00:00Z" });
    folio = await data(s.funder, "GET", "/gms/analytics/portfolio");
    expect(folio.totals).toMatchObject({ committedMinor: 15_000_000, paidMinor: 7_500_000 });

    const cycle = await data<{ submitted: number; decisions: Record<string, number>; awardedMinor: number; byLevel: Record<string, number>; medianDaysToDecision: number }>(s.funder, "GET", `/gms/analytics/cycle/${s.compId}`);
    expect(cycle).toMatchObject({ submitted: 1, decisions: { approve: 1 }, awardedMinor: 15_000_000, byLevel: { L3: 1 }, medianDaysToDecision: 0 });

    const pf = await data<{ items: { recipientName: string; paidMinor: number; approvedForFuturePaymentMinor: number }[]; totals: { paidMinor: number } }>(s.funder, "GET", "/gms/exports/990pf?year=2027");
    expect(pf.items).toMatchObject([{ recipientName: "Alder Creek Family Services", paidMinor: 7_500_000, approvedForFuturePaymentMinor: 7_500_000 }]);
    const csv = await h.request("/gms/exports/990pf?year=2027&format=csv", { headers: s.funder });
    expect(csv.headers.get("Content-Type")).toContain("text/csv");
    expect(await csv.text()).toContain('Alder Creek Family Services,"418 Mill Road, Alder Creek, OR, 97000",None,PC,Mobile Health Navigation for Rural Families,75000.00,75000.00');
  });

  it("exports a CommonGrants bundle with the GMS records and an attachments manifest", async () => {
    expect((await s.call(s.funder, "POST", "/gms/exports/bundle")).status).toBe(403);
    const out = await data<{ written: boolean; prefix: string; files: string[]; counts: { opportunities: number; forms: number; applications: number } }>(admin, "POST", "/gms/exports/bundle");
    expect(out).toMatchObject({ written: true, files: ["commongrants.json", "gms.json", "attachments/manifest.json"], counts: { opportunities: 1, forms: 2, applications: 1 } });
    const cg = JSON.parse(h.exported.get(`${out.prefix}/commongrants.json`)!) as { protocol: string; opportunities: { title: string }[]; orgs: { passportOrgId: string }[] };
    expect(cg.protocol).toBe("CommonGrants v0.5.0");
    expect(cg.opportunities[0]!.title).toBe("Community Health Grants 2027");
    expect(cg.orgs[0]!.passportOrgId).toBe(ORG_ALDER);
    expect(h.exported.has(`${out.prefix}/gms.json`)).toBe(true);
  });

  it("imports awards from a CSV with a column mapping, as a dry run first", async () => {
    const csv = 'Organization,EIN,Grant,Amount,Approved,Status\r\n"Alder Creek Family Services",00-1234567,"2025 General Operating","$40,000.00",2025-03-01,Closed\r\nNorthgate Housing Trust,,Roof repair,25000,2026-01-15,Active\r\nBroken Row,,No amount,,2026-01-15,Active\r\n';
    const mapping = { recipientName: "Organization", recipientEin: "EIN", title: "Grant", awardedAmount: "Amount", awardDate: "Approved", status: "Status" };
    expect((await s.call(admin, "POST", "/gms/imports/csv", { csv, mapping: { title: "Grant" } })).status).toBe(422);
    await h.repos.table("workspaces").update({ id: WS_APPLICANT }, { ein: "001234567" });
    const dry = await data<{ dryRun: boolean; rows: number; created: number; failed: number; unmatchedRecipients: number }>(admin, "POST", "/gms/imports/csv", { csv, mapping, dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, rows: 3, created: 0, failed: 1, unmatchedRecipients: 1 });
    const real = await data<{ created: number; results: { ok: boolean; awardId?: string; matchedRecipient?: boolean }[] }>(admin, "POST", "/gms/imports/csv", { csv, mapping });
    expect(real.created).toBe(2);
    const imported = (await h.repos.table("awards").find({ workspace_id: WS_FUNDER })).sort((a, b) => a.title.localeCompare(b.title));
    expect(imported.map((a) => [a.title, a.status, a.recipient_workspace_id])).toEqual([["2025 General Operating", "completed", WS_APPLICANT], ["Roof repair", "active", null]]);
    // Nothing imported can be paid: imported awards have no schedule.
    expect(await h.repos.table("tranches").count({ workspace_id: WS_FUNDER })).toBe(0);
  });
});

describe("Resend webhook", () => {
  const post = async (id: string, event: unknown, secret = RESEND_WEBHOOK_SECRET) => {
    const body = JSON.stringify(event);
    const ts = String(Math.floor(h.clock.now.getTime() / 1000));
    const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)))));
    return h.request("/webhooks/resend", { method: "POST", headers: { "Content-Type": "application/json", "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}` }, body });
  };

  it("verifies the signature, posts a reply into its thread, and refuses a stranger", async () => {
    const thread = await h.repos.table("threads").insert({ workspace_id: WS_FUNDER, funder_workspace_id: WS_FUNDER, applicant_workspace_id: WS_APPLICANT, subject_type: "application", subject_id: app, visibility: "shared" });
    const reply = (from: string) => ({ type: "email.received", data: { from, to: [`thread+${thread.id}@gms.test`], subject: "Re: Revision requested", text: "The revised budget is attached.\n\nOn Apr 16, Dana Ortiz wrote:\n> Please revise the budget." } });
    expect((await post("msg_1", reply("Maria <info@aldercreekfs.example>"), "whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")).status).toBe(401);
    expect((await post("msg_1", reply("Maria <info@aldercreekfs.example>"))).status).toBe(200);
    const messages = await h.repos.table("messages").find({ thread_id: thread.id });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ author: "email:info@aldercreekfs.example", body: "The revised budget is attached." });
    // The same delivery again is a duplicate; a sender who is not a party is refused and ledgered.
    expect(((await (await post("msg_1", reply("Maria <info@aldercreekfs.example>"))).json()) as { message: string }).message).toBe("duplicate");
    await post("msg_2", reply("someone@elsewhere.example"));
    expect(await h.repos.table("messages").count({ thread_id: thread.id })).toBe(1);
    expect(h.ledger.events.some((e) => e.eventType === "message.inbound_rejected")).toBe(true);
  });
});

describe("ledger archive", () => {
  it("archives a day as a hash-chained JSONL object and chains the next day to it", async () => {
    const objects = new Map<string, string>();
    const bucket = { put: async (key: string, value: string) => void objects.set(key, value) };
    const first = await archiveLedger(base(), bucket, "2027-04-16");
    if ("skipped" in first) throw new Error("expected an archive");
    expect(first.key).toBe("ledger/2027/04/16.jsonl");
    expect(first.events).toBeGreaterThan(0);
    const check = await verifyArchive(objects.get(first.key)!);
    expect(check).toMatchObject({ ok: true, lastHash: first.sha256, count: first.events });
    expect(await archiveLedger(base(), bucket, "2027-04-16")).toEqual({ day: "2027-04-16", skipped: true });
    // The next day starts from the previous day's last hash.
    h.clock.now = new Date("2027-04-18T02:00:00Z");
    const second = await archiveLedger(base(), bucket);
    if ("skipped" in second) throw new Error("expected an archive");
    expect(second.day).toBe("2027-04-17");
    expect((await h.repos.table("ledger_archives").one({ day: "2027-04-17" }))!.prev_sha256).toBe(first.sha256);
    // The ledger itself was not changed by archiving.
    expect((await verifyArchive(objects.get(first.key)!.replace("application.submit", "application.tampered"))).ok).toBe(false);
    void ORG_RIVERBEND;
  });
});
