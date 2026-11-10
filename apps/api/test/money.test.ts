// SPDX-License-Identifier: AGPL-3.0-only
// Payments, requirements, budgets and Passport events (build spec §10.7, §10.8, §11.6, §11.7;
// definition-of-done items 8 and 9), against recorded Passport fixtures.
import { encryptSecret, fixtureFetch, signPassportPayload, type Fixture } from "@gms/passport-client";
import { beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { evaluateRequirements, evaluateTranchesDue, reconcileStuckReleases } from "../src/jobs.ts";
import type { BaseContext } from "../src/services/context.ts";
import { CLIENT_AGENT, ORG_RIVERBEND, PASSPORT, PASSPORT_WEBHOOK_SECRET, TEST_CREDENTIALS_KEY, USER_ADMIN, USER_OFFICER, WEB, BASE, WS_APPLICANT, WS_FUNDER, WS_OTHER, bearer, harness, type Harness } from "./helpers.ts";
import { ORG_ALDER, USER_APPLICANT, USER_APPLICANT_EDITOR, scenario, type Scenario } from "./scenario.ts";

const FINANCE = "70000000-0000-4000-8000-000000000001";
const PASSPORT_AWARD = "0193a1c0-0000-7000-8000-00000000aa01";
const DSB = "dsb_01JFIXTURE0000000000000000";

let h: Harness;
let s: Scenario;
let admin: Record<string, string>;
let finance: Record<string, string>;
let awardId: string; // awd_<uuid>
let award: string; // bare uuid
let t1: string; // trn_<uuid> of the first tranche (on execution)
let t2: string; // second tranche (on report accepted)
let reportFormId: string;
let fx: ReturnType<typeof fixtureFetch>;

const headers = async (user: string, ws: string) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });
const data = async <T>(who: Record<string, string>, method: string, path: string, body?: unknown): Promise<T> => {
  const r = await s.call<{ data: T }>(who, method, path, method === "GET" ? undefined : (body ?? {}));
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const ledger = (type: string) => h.ledger.events.filter((e) => e.eventType === type);
const tranche = async (id: string) => (await h.repos.table("tranches").one({ id: id.slice(4) }))!;
const base = (): BaseContext => ({ repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, ports: { mailer: h.mailer, storage: h.storage }, config: { baseUrl: BASE, webBaseUrl: WEB, passportBaseUrl: PASSPORT, credentialsKey: TEST_CREDENTIALS_KEY, passportClient: null, mailFrom: "OpenGrants GMS <notices@gms.test>", webhookSecretKey: TEST_CREDENTIALS_KEY, ...(h.passport.fetch ? { passportFetch: h.passport.fetch } : {}) } });

const env = (body: unknown, status = 200) => ({ status, message: "Success", data: body });
const TOKEN: Fixture = { method: "POST", path: "/oauth/token", status: 200, body: { access_token: "passport-access-token-for-tests", token_type: "Bearer", expires_in: 3600, scope: "org:read payee:read award:write disbursement:read disbursement:write" } };
const SOURCES: Fixture = { method: "GET", path: `/passport/funders/${ORG_RIVERBEND}/sources`, status: 200, body: { status: 200, message: "Success", items: [{ id: "src_1", orgId: ORG_RIVERBEND, provider: "stripe", status: "verified", statusReason: null, bankName: "First Fictional Bank", last4: "5520", canDebit: true, verifiedAt: "2027-01-12T00:00:00Z", createdAt: "2027-01-10T00:00:00Z" }], paginationInfo: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 } } };
const credential = (over: Record<string, unknown> = {}) => ({
  id: "pc_01JALDERCREEK0000000000000",
  version: 4,
  organization: { id: ORG_ALDER, name: "Alder Creek Family Services", identifiers: {} },
  level: "L3",
  payoutDestination: { provider: "stripe", token: "tok_fixture_standard", tokensByRail: { standard: "tok_fixture_standard" }, bankName: "River City Credit Union", last4: "4821", holderType: "company", holderNameMatch: "match", validations: [], verifiedAt: "2027-01-12T17:00:00Z", status: "active" },
  changeControl: { pendingChange: null, freezeUntil: null, lastChangedAt: "2027-01-12T17:00:00Z" },
  warranty: { cap: { amount: "250000.00", currency: "USD" }, termsUrl: "https://passport.example/warranty" },
  attestation: "fixture.attestation.jws",
  issuedAt: "2027-05-24T16:00:00Z",
  ...over,
});
const PAYEE = (over: Record<string, unknown> = {}): Fixture => ({ method: "GET", path: `/passport/payees/${ORG_ALDER}`, status: 200, body: env(credential(over)) });
const PASSPORT_AWARD_FX = (disbursed = "0.00"): Fixture => ({ method: "GET", path: `/common-grants/awards/${PASSPORT_AWARD}`, status: 200, body: env({ id: PASSPORT_AWARD, title: "Mobile Health Navigation for Rural Families", status: { value: "awarded" }, funding: { awardedAmount: { amount: "150000.00", currency: "USD" }, disbursedAmount: { amount: disbursed, currency: "USD" } } }) });
const disbursement = (status: string, over: Record<string, unknown> = {}) => ({ id: DSB, awardId: PASSPORT_AWARD, funderOrgId: ORG_RIVERBEND, recipientOrgId: ORG_ALDER, credentialId: "pc_01JALDERCREEK0000000000000", credentialVersion: 4, amount: { amount: "75000.00", currency: "USD" }, requestedRail: "auto", rail: "standard", mode: "facilitated", status, memo: "tranche 1", fee: null, warrantyEligible: true, checks: [], timeline: [], createdAt: "2027-05-24T16:05:00Z", lastModifiedAt: "2027-05-24T16:05:00Z", ...over });
const DISBURSE = (status = "initiated", over: Record<string, unknown> = {}): Fixture => ({ method: "POST", path: "/passport/disbursements", status: 201, body: { status: 201, message: "Created", data: disbursement(status, over) } });

function passport(...fixtures: Fixture[]) {
  fx = fixtureFetch([TOKEN, SOURCES, ...fixtures]);
  h.passport.fetch = fx.fetch;
}

async function passportEvent(id: string, type: string, eventData: Record<string, unknown>, opts: { secret?: string } = {}) {
  const body = JSON.stringify({ id, type, orgId: ORG_ALDER, occurredAt: h.clock.now.toISOString(), data: eventData });
  const ts = Math.floor(h.clock.now.getTime() / 1000);
  return h.request("/webhooks/passport", { method: "POST", headers: { "Content-Type": "application/json", "X-Passport-Timestamp": String(ts), "X-Passport-Signature": await signPassportPayload(opts.secret ?? PASSPORT_WEBHOOK_SECRET, ts, body) }, body });
}

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  admin = await headers(USER_ADMIN, WS_FUNDER);
  await h.repos.table("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: FINANCE, role: "finance" });
  finance = await headers(FINANCE, WS_FUNDER);

  // A report form, and a program whose defaults give every award two tranches and one report.
  const form = await data<{ id: string }>(s.funder, "POST", "/gms/forms", {
    title: "Interim report",
    purpose: "report",
    jsonSchema: { type: "object", properties: { legalName: { type: "string" }, progress: { type: "string", minLength: 5 }, peopleServed: { type: "number" } }, required: ["progress"] },
    uiSchema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/legalName" }, { type: "Control", scope: "#/properties/progress" }, { type: "Control", scope: "#/properties/peopleServed" }] },
    mappingFromCommonGrants: { legalName: { field: "name" } },
  });
  await data(s.funder, "POST", `/gms/forms/${form.id}/publish`);
  reportFormId = form.id;
  const program = await data<{ id: string }>(s.funder, "POST", "/gms/programs", {
    name: "Community Health 2027",
    budgetAmountMinor: 120_000_000,
    fiscalYear: 2027,
    defaults: {
      awardPeriod: { startDate: "2027-07-01", endDate: "2028-06-30" },
      schedule: [{ percent: 50, condition: { type: "onExecution" } }, { percent: 50, condition: { type: "onReportAccepted", requirementKey: "interim" } }],
      requirements: [{ key: "interim", type: "report", title: "Interim report", formId: form.id.slice(4), formVersion: 1, dueAt: "2027-12-15T00:00:00Z" }],
    },
  });
  await h.repos.table("opportunities").update({ id: s.uuid.opp }, { program_id: program.id });

  // Apply, decide, accept, sign, countersign: the award is active and tranche 1 is due.
  const started = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
  const app = started.body.data.id;
  await s.call(s.applicant, "PUT", `/common-grants/applications/${app}/forms/${s.uuid.loi}`, { response: { projectTitle: "Mobile Health Navigation for Rural Families", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel 46 miles to reach primary care." } });
  expect((await s.call(s.applicant, "PUT", `/common-grants/applications/${app}/submit`)).status).toBe(200);
  const p = await data<{ decisions: { id: string }[] }>(s.funder, "POST", "/gms/decisions/propose", { competitionId: s.compId, decisions: [{ applicationId: `app_${app}`, outcome: "approve", amountMinor: 15_000_000 }] });
  const res = await data<{ results: { awardId: string; agreementId: string }[] }>(s.funder, "POST", "/gms/decisions/commit", { competitionId: s.compId, decisionIds: [p.decisions[0]!.id] });
  awardId = res.results[0]!.awardId;
  award = awardId.slice(4);
  const agreementId = res.results[0]!.agreementId;
  const sent = await data<{ documentSha256: string }>(s.funder, "POST", `/gms/agreements/${agreementId}/send`);
  await data(s.applicant, "POST", `/gms/my/awards/${awardId}/accept`);
  await data(s.applicant, "POST", `/gms/agreements/${agreementId}/sign`, { name: "Maria Santos", attest: true, documentSha256: sent.documentSha256 });
  await data(s.funder, "POST", `/gms/agreements/${agreementId}/countersign`, { name: "Dana Ortiz", attest: true });

  const rows = await h.repos.table("tranches").find({ award_id: award }, { orderBy: "seq" });
  t1 = `trn_${rows[0]!.id}`;
  t2 = `trn_${rows[1]!.id}`;
  // The funder is linked to Passport and the award is mirrored there.
  await h.repos.table("passport_links").insert({ workspace_id: WS_FUNDER, mode: "funder_client", client_id: "pc_riverbend_gms", client_secret_enc: await encryptSecret("passport-client-secret-for-tests", TEST_CREDENTIALS_KEY), scopes: ["payee:read"], linked_at: h.clock.now.toISOString(), last_ok_at: h.clock.now.toISOString() });
  await h.repos.table("awards").update({ id: award }, { passport_award_id: PASSPORT_AWARD });
  h.mailer.sent.length = 0;
  passport(PAYEE(), PASSPORT_AWARD_FX(), DISBURSE());
});

describe("schedule", () => {
  it("starts from the program defaults and shows both sides the same tranches", async () => {
    const funder = await data<{ awardedAmountMinor: number; disbursedAmountMinor: number | null; tranches: { seq: number; amountMinor: number; status: string; condition: { type: string } }[] }>(s.funder, "GET", `/gms/awards/${awardId}/schedule`);
    expect(funder.awardedAmountMinor).toBe(15_000_000);
    expect(funder.disbursedAmountMinor).toBeNull();
    expect(funder.tranches.map((t) => [t.seq, t.amountMinor, t.status, t.condition.type])).toEqual([[1, 7_500_000, "due", "onExecution"], [2, 7_500_000, "scheduled", "onReportAccepted"]]);
    const grantee = await data<{ seq: number }[]>(s.applicant, "GET", `/gms/my/awards/${awardId}/schedule`);
    expect(grantee).toHaveLength(2);
  });

  it("replaces only what has not started, cancels the old tranches through the machine, and must add up", async () => {
    const bad = await s.call(finance, "PUT", `/gms/awards/${awardId}/schedule`, { tranches: [{ amountMinor: 1_000_000, condition: { type: "manual" } }] });
    expect(bad.status).toBe(422);
    const out = await data<{ tranches: { seq: number; amountMinor: number; status: string }[] }>(finance, "PUT", `/gms/awards/${awardId}/schedule`, { tranches: [{ amountMinor: 10_000_000, condition: { type: "manual" } }, { amountMinor: 5_000_000, condition: { type: "onDate", date: "2027-09-01" } }] });
    expect(out.tranches.map((t) => [t.seq, t.amountMinor, t.status])).toEqual([[1, 7_500_000, "cancelled"], [2, 7_500_000, "cancelled"], [3, 10_000_000, "scheduled"], [4, 5_000_000, "scheduled"]]);
    expect(ledger("tranche.cancel")).toHaveLength(2);
    // Program staff without the finance role cannot change a schedule.
    expect((await s.call(s.funder, "PUT", `/gms/awards/${awardId}/schedule`, { tranches: [{ percent: 100, condition: { type: "manual" } }] })).status).toBe(403);
  });
});

describe("readiness", () => {
  type Check = { key: string; state: string; reason: string; fixHref: string | null };
  const readiness = () => data<{ checks: Check[]; releasable: boolean; passed: number; failed: number; unknown: number; banner: { cause: string; clears: string } | null; destination: { bankName: string; last4: string } | null }>(finance, "GET", `/gms/tranches/${t1}/readiness`);
  const state = (r: { checks: Check[] }, key: string) => r.checks.find((c) => c.key === key)!.state;

  it("passes all seven checks for a verified payee, and shows only the bank name and last four digits", async () => {
    const r = await readiness();
    expect(r.checks.map((c) => c.key)).toEqual(["agreement", "condition", "funder_link", "payee_credential", "award_headroom", "no_duplicate", "recipient_standing"]);
    expect(r).toMatchObject({ releasable: true, passed: 7, failed: 0, unknown: 0, banner: null, destination: { bankName: "River City Credit Union", last4: "4821" } });
    expect(JSON.stringify(r)).not.toMatch(/tok_fixture|tokensByRail/);
  });

  it("is a matrix: each failing fact fails its own line and blocks the release", async () => {
    // Level below L3.
    passport(PAYEE({ level: "L2" }), PASSPORT_AWARD_FX());
    let r = await readiness();
    expect(state(r, "payee_credential")).toBe("fail");
    expect(r.releasable).toBe(false);
    expect(r.banner?.cause).toBe("level_below_l3");
    // Pending destination change.
    passport(PAYEE({ changeControl: { pendingChange: { destinationId: "d2", state: "cooling_off", bankName: "Harbor Bank", last4: "9911", requestedAt: "2027-04-10T00:00:00Z", coolingOffUntil: "2027-04-21T00:00:00Z" }, freezeUntil: null, lastChangedAt: null } }), PASSPORT_AWARD_FX());
    r = await readiness();
    expect(state(r, "payee_credential")).toBe("fail");
    expect(r.banner).toMatchObject({ cause: "pending_destination_change" });
    expect(r.banner!.clears).toContain("Apr 21, 2027");
    // Freeze window.
    passport(PAYEE({ changeControl: { pendingChange: null, freezeUntil: "2027-04-20T00:00:00Z", lastChangedAt: null } }), PASSPORT_AWARD_FX());
    r = await readiness();
    expect(r.banner?.cause).toBe("freeze_window");
    // No headroom left at Passport.
    passport(PAYEE(), PASSPORT_AWARD_FX("120000.00"));
    r = await readiness();
    expect(state(r, "award_headroom")).toBe("fail");
    // Funder cannot debit.
    fx = fixtureFetch([TOKEN, { ...SOURCES, body: { ...(SOURCES.body as object), items: [] } }, PAYEE(), PASSPORT_AWARD_FX()]);
    h.passport.fetch = fx.fetch;
    r = await readiness();
    expect(state(r, "funder_link")).toBe("fail");
    // A tranche whose condition is not met.
    const second = await data<{ checks: Check[]; releasable: boolean }>(finance, "GET", `/gms/tranches/${t2}/readiness`);
    expect(state(second, "condition")).toBe("fail");
    expect(second.releasable).toBe(false);
  });

  it("reports unknown, never pass or fail, when Passport cannot be reached", async () => {
    h.passport.fetch = () => Promise.reject(new Error("network down"));
    const r = await readiness();
    expect(r.unknown).toBeGreaterThan(0);
    expect(state(r, "payee_credential")).toBe("unknown");
    expect(state(r, "agreement")).toBe("pass");
    expect(r.releasable).toBe(false);
    expect(r.banner?.cause).toBe("passport_unavailable");
    const refused = await s.call<{ errors: { code: string }[] }>(finance, "POST", `/gms/tranches/${t1}/release`);
    expect(refused.status).toBe(409);
    expect((await tranche(t1)).status).toBe("due");
  });

  it("lists every due tranche with its readiness in the Payments center", async () => {
    const out = await data<{ items: { tranche: { id: string }; releasable: boolean }[]; totals: { dueMinor: number; releasable: number } }>(finance, "GET", "/gms/payments/readiness");
    expect(out.items.map((i) => i.tranche.id)).toEqual([t1]);
    expect(out.totals).toMatchObject({ dueMinor: 7_500_000, releasable: 1 });
    const list = await s.call<{ items: { id: string; recipient: { name: string } }[] }>(finance, "GET", "/gms/tranches?view=due");
    expect(list.body.items).toMatchObject([{ id: t1, recipient: { name: "Alder Creek Family Services" } }]);
  });
});

describe("release", () => {
  it("releases through Passport once, with the tranche id as the Idempotency-Key", async () => {
    const out = await data<{ result: string; tranche: { status: string; passportDisbursementId: string; mode: string } }>(finance, "POST", `/gms/tranches/${t1}/release`);
    expect(out).toMatchObject({ result: "accepted", tranche: { status: "initiated", passportDisbursementId: DSB, mode: "facilitated" } });
    const posts = fx.calls.filter((c) => c.method === "POST" && c.path === "/passport/disbursements");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.headers["idempotency-key"]).toBe(t1);
    expect(posts[0]!.body).toMatchObject({ awardId: PASSPORT_AWARD, recipientOrgId: ORG_ALDER, credentialId: "pc_01JALDERCREEK0000000000000", credentialVersion: 4, amount: { amount: "75000.00", currency: "USD" }, mode: "facilitated", rail: "auto", feePaidBy: "source" });
    expect(JSON.stringify(posts[0]!.body)).not.toMatch(/last4|bankName/);
    const row = await tranche(t1);
    expect(row).toMatchObject({ status: "initiated", released_by: FINANCE, idempotency_key: t1 });
    expect(ledger("tranche.release").length + ledger("tranche.initiated").length).toBe(2);

    // A second click cannot pay twice: an initiated tranche is not releasable, and Passport is not asked again.
    const again = await s.call(finance, "POST", `/gms/tranches/${t1}/release`);
    expect(again.status).toBe(409);
    expect(fx.calls.filter((c) => c.method === "POST" && c.path === "/passport/disbursements")).toHaveLength(1);
  });

  it("is safe to repeat when Passport did not answer: the same key is sent again", async () => {
    let calls = 0;
    const inner = fx.fetch;
    h.passport.fetch = (input, init) => {
      if (String(input).endsWith("/passport/disbursements") && ++calls === 1) return Promise.reject(new Error("timeout"));
      return inner(input, init);
    };
    const first = await data<{ result: string; tranche: { status: string } }>(finance, "POST", `/gms/tranches/${t1}/release`);
    expect(first).toMatchObject({ result: "unconfirmed", tranche: { status: "releasing" } });
    const second = await data<{ result: string; tranche: { status: string } }>(finance, "POST", `/gms/tranches/${t1}/release`);
    expect(second).toMatchObject({ result: "accepted", tranche: { status: "initiated" } });
    const keys = fx.calls.filter((c) => c.method === "POST" && c.path === "/passport/disbursements").map((c) => c.headers["idempotency-key"]);
    expect(new Set(keys)).toEqual(new Set([t1]));
  });

  it("refuses any agent or API-client token, whatever its scopes", async () => {
    const agent = await h.forge({ sub: USER_ADMIN, client_id: CLIENT_AGENT, scope: "payments:read payments:release approvals:bypass", [WORKSPACE_CLAIM]: WS_FUNDER });
    const viaAgent = await h.request(`/gms/tranches/${t1}/release`, { method: "POST", headers: { ...bearer(agent).headers, "Content-Type": "application/json" }, body: "{}" });
    expect(viaAgent.status).toBe(403);
    expect(((await viaAgent.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe("human_only");
    const client = await h.forge({ scope: "payments:release" });
    expect((await h.request(`/gms/tranches/${t1}/release`, { method: "POST", headers: bearer(client).headers })).status).toBe(403);
    expect(fx.calls.some((c) => c.path === "/passport/disbursements")).toBe(false);
    expect((await tranche(t1)).status).toBe("due");
  });

  it("only finance and admins release; program officers and other workspaces cannot", async () => {
    expect((await s.call(s.funder, "POST", `/gms/tranches/${t1}/release`)).status).toBe(403);
    expect((await s.call(await headers(USER_ADMIN, WS_OTHER), "POST", `/gms/tranches/${t1}/release`)).status).toBe(403);
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: FINANCE, role: "finance" });
    expect((await s.call(await headers(FINANCE, WS_OTHER), "GET", `/gms/tranches/${t1}/readiness`)).status).toBe(404);
    expect((await s.call(admin, "POST", `/gms/tranches/${t1}/release`)).status).toBe(200);
  });

  it("holds the tranche when Passport parks the disbursement itself, and resumes it on release", async () => {
    passport(PAYEE(), PASSPORT_AWARD_FX(), DISBURSE("held", { statusReason: "destination_change_in_flight" }), { method: "POST", path: `/passport/disbursements/${DSB}/release`, status: 200, body: env(disbursement("initiated")) });
    const out = await data<{ result: string; tranche: { status: string; holdReason: string; passportDisbursementId: string } }>(finance, "POST", `/gms/tranches/${t1}/release`);
    expect(out.tranche).toMatchObject({ status: "held", holdReason: "destination_change_in_flight", passportDisbursementId: DSB });
    const resumed = await data<{ status: string; holdReason: string | null }>(finance, "POST", `/gms/tranches/${t1}/release-hold`);
    expect(resumed).toMatchObject({ status: "initiated", holdReason: null });
  });

  it("re-resolves a stale credential once, then holds with the reason", async () => {
    const stale: Fixture = { method: "POST", path: "/passport/disbursements", status: 409, body: { status: 409, message: "The credential version is stale", errors: [{ code: "credential_version_stale" }] } };
    passport(PAYEE(), PASSPORT_AWARD_FX(), stale);
    const out = await data<{ result: string; code: string; tranche: { status: string; holdReason: string } }>(finance, "POST", `/gms/tranches/${t1}/release`);
    expect(out).toMatchObject({ result: "refused", code: "credential_version_stale", tranche: { status: "held", holdReason: "credential_version_stale" } });
    expect(fx.calls.filter((c) => c.path === "/passport/disbursements")).toHaveLength(2);
  });

  it("holds and cancels by hand, with a reason", async () => {
    expect((await s.call(finance, "POST", `/gms/tranches/${t1}/hold`, {})).status).toBe(400);
    expect(await data<{ status: string }>(finance, "POST", `/gms/tranches/${t1}/hold`, { reason: "Waiting on the site visit" })).toMatchObject({ status: "held" });
    expect((await s.call(finance, "POST", `/gms/tranches/${t1}/release`)).status).toBe(409);
    expect(await data<{ status: string }>(finance, "POST", `/gms/tranches/${t1}/release-hold`)).toMatchObject({ status: "due" });
    expect(await data<{ status: string }>(finance, "POST", `/gms/tranches/${t2}/cancel`, { reason: "Scope reduced" })).toMatchObject({ status: "cancelled" });
  });
});

describe("resolve mode", () => {
  const EXTERNAL = { reference: "Check 10482", paidAt: "2027-04-15", destinationLast4: "4821" };

  it("records a payment made elsewhere and tells Passport", async () => {
    passport(PAYEE(), PASSPORT_AWARD_FX(), DISBURSE("settled", { mode: "resolve" }));
    const out = await data<{ result: string; tranche: { status: string; mode: string; external: { last4: string } } }>(finance, "POST", `/gms/tranches/${t1}/record-external`, EXTERNAL);
    expect(out).toMatchObject({ result: "recorded", tranche: { status: "settled", mode: "resolve", external: { last4: "4821" } } });
    const post = fx.calls.find((c) => c.method === "POST" && c.path === "/passport/disbursements")!;
    expect(post.body).toMatchObject({ mode: "resolve", external: { reference: "Check 10482", destinationLast4: "4821" } });
  });

  it("settles locally as unverified when Passport cannot verify the last four digits (422)", async () => {
    passport(PAYEE(), PASSPORT_AWARD_FX(), { method: "POST", path: "/passport/disbursements", status: 422, body: { status: 422, message: "The destination does not match", errors: [{ code: "destination_mismatch" }] } });
    const out = await data<{ result: string; tranche: { status: string; passportStatus: string } }>(finance, "POST", `/gms/tranches/${t1}/record-external`, { ...EXTERNAL, destinationLast4: "0000" });
    expect(out).toMatchObject({ result: "unverified", tranche: { status: "settled", passportStatus: "unverified" } });
    const alerts = await data<{ kind: string }[]>(finance, "GET", "/gms/payments/alerts");
    expect(alerts.map((a) => a.kind)).toContain("unverified");
  });

  it("accepts only four digits and never more of an account", async () => {
    expect((await s.call(finance, "POST", `/gms/tranches/${t1}/record-external`, { ...EXTERNAL, destinationLast4: "123456789" })).status).toBe(400);
  });

  it("matches a Mercury transaction to a tranche by amount and name, and a person confirms it", async () => {
    await h.repos.table("connector_accounts").insert({ workspace_id: WS_FUNDER, provider: "mercury", status: "active", secret_enc: await encryptSecret("mercury-read-only-token-for-tests", TEST_CREDENTIALS_KEY), scopes: ["transactions:read"] });
    h.bank.transactions = [
      { externalId: "mtx_1", amountMinor: 7_500_000, currency: "USD", postedAt: "2027-04-15T18:00:00Z", counterpartyName: "Alder Creek Family Services", memo: "Grant payment" },
      { externalId: "mtx_2", amountMinor: 120_000, currency: "USD", postedAt: "2027-04-15T19:00:00Z", counterpartyName: "Office Supply Depot", memo: null },
    ];
    const synced = await data<{ fetched: number; added: number }>(finance, "POST", "/gms/connectors/mercury/sync");
    expect(synced).toMatchObject({ fetched: 2, added: 2 });
    expect((await data<{ added: number }>(finance, "POST", "/gms/connectors/mercury/sync")).added).toBe(0);
    const txns = await s.call<{ items: { id: string; counterpartyName: string; proposals: { trancheId: string; score: number }[] }[] }>(finance, "GET", "/gms/bank-transactions?matched=false");
    const match = txns.body.items.find((t) => t.counterpartyName === "Alder Creek Family Services")!;
    expect(match.proposals).toMatchObject([{ trancheId: t1 }]);
    expect(txns.body.items.find((t) => t.counterpartyName === "Office Supply Depot")!.proposals).toEqual([]);
    expect(Object.keys(txns.body.items[0]!).join(",")).not.toMatch(/account|routing/i);

    passport(PAYEE(), PASSPORT_AWARD_FX(), DISBURSE("settled", { mode: "resolve" }));
    const done = await data<{ result: string; transaction: { matchedTrancheId: string }; tranche: { status: string } }>(finance, "POST", `/gms/bank-transactions/${match.id}/match`, { trancheId: t1, destinationLast4: "4821" });
    expect(done).toMatchObject({ result: "recorded", transaction: { matchedTrancheId: t1 }, tranche: { status: "settled" } });
    expect((await s.call(finance, "POST", `/gms/bank-transactions/${match.id}/match`, { trancheId: t1, destinationLast4: "4821" })).status).toBe(409);
  });
});

describe("Passport webhooks", () => {
  it("rejects a bad signature and stores nothing", async () => {
    const res = await passportEvent("evt_bad", "payee.level.changed", { orgId: ORG_ALDER, handle: null, from: "L3", to: "L2", reason: "x" }, { secret: "wrong-secret" });
    expect(res.status).toBe(401);
    expect(await h.repos.table("inbound_events").count({})).toBe(0);
  });

  it("blocks release while a destination change is pending and clears on payee.destination.changed", async () => {
    const pending = await passportEvent("evt_1", "payee.destination.change_pending", { orgId: ORG_ALDER, handle: "alder-creek", destinationId: "d2", state: "cooling_off", bankName: "Harbor Bank", last4: "9911", requestedAt: "2027-04-16T10:00:00Z" });
    expect(pending.status).toBe(200);
    // The credential Passport serves still looks clean (a stale read): the event alone must block.
    const blocked = await data<{ releasable: boolean; banner: { cause: string; detail: string } }>(finance, "GET", `/gms/tranches/${t1}/readiness`);
    expect(blocked.releasable).toBe(false);
    expect(blocked.banner).toMatchObject({ cause: "pending_destination_change" });
    expect(blocked.banner.detail).toContain("Harbor Bank •••• 9911");
    expect((await s.call(finance, "POST", `/gms/tranches/${t1}/release`)).status).toBe(409);
    expect(fx.calls.some((c) => c.path === "/passport/disbursements")).toBe(false);
    const alerts = await data<{ kind: string; title: string }[]>(finance, "GET", "/gms/payments/alerts");
    expect(alerts.find((a) => a.kind === "destination_change_pending")?.title).toContain("Alder Creek");

    // The same event delivered again is a duplicate.
    expect(((await (await passportEvent("evt_1", "payee.destination.change_pending", { orgId: ORG_ALDER, handle: null, destinationId: "d2", state: "cooling_off", bankName: "Harbor Bank", last4: "9911", requestedAt: "2027-04-16T10:00:00Z" })).json()) as { message: string }).message).toBe("duplicate");

    expect((await passportEvent("evt_2", "payee.destination.changed", { orgId: ORG_ALDER, handle: "alder-creek", destinationId: "d2", previousDestinationId: "d1", bankName: "Harbor Bank", last4: "9911" })).status).toBe(200);
    const clear = await data<{ releasable: boolean; banner: unknown }>(finance, "GET", `/gms/tranches/${t1}/readiness`);
    expect(clear).toMatchObject({ releasable: true, banner: null });
    expect((await data<{ tranche: { status: string } }>(finance, "POST", `/gms/tranches/${t1}/release`)).tranche.status).toBe("initiated");
  });

  it("drives an initiated tranche to settled and reads the disbursed amount back from Passport", async () => {
    await data(finance, "POST", `/gms/tranches/${t1}/release`);
    passport(PAYEE(), PASSPORT_AWARD_FX("75000.00"));
    await h.webhooks.createSubscription({ id: "11111111-2222-4333-8444-555555555555", workspaceId: WS_FUNDER, url: "https://hooks.example/gms", eventTypes: [], secretEnc: "unused", active: true });
    const res = await passportEvent("evt_s", "disbursement.status.changed", { disbursementId: DSB, awardId: PASSPORT_AWARD, funderOrgId: ORG_RIVERBEND, recipientOrgId: ORG_ALDER, status: "settled", previousStatus: "initiated", reason: null, amount: { amount: "75000.00", currency: "USD" }, fee: null, rail: "standard", mode: "facilitated" });
    expect(res.status).toBe(200);
    expect(await tranche(t1)).toMatchObject({ status: "settled", passport_status: "settled" });
    const row = (await h.repos.table("awards").one({ id: award }))!;
    expect((row.funding as { disbursedAmount: { amount: string } }).disbursedAmount.amount).toBe("75000.00");
    expect(row.disbursed_at).not.toBeNull();
    expect(h.ledger.events.find((e) => e.eventType === "tranche.settle")!.actor).toBe("passport");
    const types = h.webhooks.deliveries.map((d) => d.eventType);
    expect(types).toContain("tranche.status.changed");
    expect(types).toContain("disbursement.status.changed");
    // A late, out-of-order event never moves the tranche backwards.
    await passportEvent("evt_late", "disbursement.status.changed", { disbursementId: DSB, awardId: PASSPORT_AWARD, funderOrgId: ORG_RIVERBEND, recipientOrgId: ORG_ALDER, status: "initiated", previousStatus: "validated", reason: null, amount: { amount: "75000.00", currency: "USD" }, fee: null, rail: "standard", mode: "facilitated" });
    expect((await tranche(t1)).status).toBe("settled");
  });

  it("records a level drop and an inactive organization, and holds what is not yet with Passport", async () => {
    await passportEvent("evt_l", "payee.level.changed", { orgId: ORG_ALDER, handle: null, from: "L3", to: "L2", reason: "attestation_expired" });
    expect((await h.repos.table("workspaces").one({ id: WS_APPLICANT }))!.verification_level).toBe("L2");
    await passportEvent("evt_i", "payee.organization.inactive", { orgId: ORG_ALDER, handle: null, reason: ["irs_revoked"] });
    expect(await tranche(t1)).toMatchObject({ status: "held", hold_reason: "organization_inactive" });
    const alerts = (await data<{ kind: string }[]>(finance, "GET", "/gms/payments/alerts")).map((a) => a.kind);
    expect(alerts).toEqual(expect.arrayContaining(["organization_inactive", "level_below_l3", "held"]));
  });
});

describe("requirements and reports", () => {
  let reqId: string;
  beforeEach(async () => {
    reqId = `req_${(await h.repos.table("requirements").one({ award_id: award }))!.id}`;
  });
  const startReport = () => data<{ id: string; status: string; formResponses: { formId: string; response: Record<string, unknown>; provenance: Record<string, string> }[] }>(s.applicant, "POST", `/gms/my/requirements/${reqId}/start`);

  it("accept → the tranche that waits on the report becomes due", async () => {
    const mine = await data<{ id: string; status: string; funder: { name: string }; releasesTrancheId: string }[]>(s.applicant, "GET", "/gms/my/requirements");
    expect(mine).toMatchObject([{ id: reqId, status: "scheduled", funder: { name: "Riverbend Community Foundation" }, releasesTrancheId: t2 }]);
    const sub = await startReport();
    // Prefilled from Passport, and marked as such.
    expect(sub.formResponses[0]).toMatchObject({ formId: reportFormId, response: { legalName: "Alder Creek Family Services" }, provenance: { "/legalName": "passport" } });
    expect((await startReport()).id).toBe(sub.id);
    // An incomplete report cannot be submitted.
    expect((await s.call(s.applicant, "POST", `/gms/my/submissions/${sub.id}/submit`)).status).toBe(422);
    await data(s.applicant, "PUT", `/gms/my/submissions/${sub.id}/forms/${reportFormId}`, { response: { progress: "Two navigators hired; van route running.", peopleServed: 212 } });
    // The funder does not see a draft.
    expect((await s.call(s.funder, "GET", `/gms/submissions/${sub.id}`)).status).toBe(404);
    const submitted = await data<{ status: string; requirementStatus: string }>(s.applicant, "POST", `/gms/my/submissions/${sub.id}/submit`);
    expect(submitted).toMatchObject({ status: "submitted", requirementStatus: "submitted" });
    expect((await s.call(s.applicant, "PUT", `/gms/my/submissions/${sub.id}/forms/${reportFormId}`, { response: { progress: "edited after submit" } })).status).toBe(409);

    const queue = await s.call<{ items: { id: string; status: string; submissionId: string; recipient: { name: string } }[] }>(s.funder, "GET", "/gms/requirements/due");
    expect(queue.body.items).toMatchObject([{ id: reqId, status: "submitted", submissionId: sub.id, recipient: { name: "Alder Creek Family Services" } }]);
    expect((await tranche(t2)).status).toBe("scheduled");
    // The grantee cannot accept their own report.
    expect((await s.call(s.applicant, "POST", `/gms/submissions/${sub.id}/accept`)).status).toBe(403);
    const accepted = await data<{ status: string; requirementStatus: string; trancheDue: string }>(s.funder, "POST", `/gms/submissions/${sub.id}/accept`, { note: "Thank you." });
    expect(accepted).toMatchObject({ status: "accepted", requirementStatus: "accepted", trancheDue: t2 });
    expect(await tranche(t2)).toMatchObject({ status: "due" });
    expect((await h.repos.table("requirements").one({ id: reqId.slice(4) }))!.status).toBe("accepted");
    expect(ledger("requirement.accept")).toHaveLength(1);
    expect(ledger("tranche.mark_due").some((e) => e.subjectId === t2.slice(4))).toBe(true);
  });

  it("returns a report with a note; the grantee revises and the next report is prefilled from the last accepted one", async () => {
    const sub = await startReport();
    await data(s.applicant, "PUT", `/gms/my/submissions/${sub.id}/forms/${reportFormId}`, { response: { progress: "Navigators hired.", peopleServed: 90 } });
    await data(s.applicant, "POST", `/gms/my/submissions/${sub.id}/submit`);
    expect((await s.call(s.funder, "POST", `/gms/submissions/${sub.id}/return`, {})).status).toBe(400);
    const returned = await data<{ status: string; reviewNote: string; requirementStatus: string }>(s.funder, "POST", `/gms/submissions/${sub.id}/return`, { note: "Please add the number of visits." });
    expect(returned).toMatchObject({ status: "returned", reviewNote: "Please add the number of visits.", requirementStatus: "due" });
    await data(s.applicant, "PUT", `/gms/my/submissions/${sub.id}/forms/${reportFormId}`, { response: { progress: "Navigators hired; 340 visits." } });
    await data(s.applicant, "POST", `/gms/my/submissions/${sub.id}/submit`);
    await data(s.funder, "POST", `/gms/submissions/${sub.id}/accept`);

    // A later requirement with the same form starts from the accepted answers.
    const next = await data<{ id: string }>(s.funder, "POST", `/gms/awards/${awardId}/requirements`, { type: "report", title: "Final report", formId: reportFormId, dueAt: "2028-07-31" });
    const second = await data<{ formResponses: { response: Record<string, unknown>; provenance: Record<string, string> }[] }>(s.applicant, "POST", `/gms/my/requirements/${next.id}/start`);
    expect(second.formResponses[0]!.response).toMatchObject({ legalName: "Alder Creek Family Services", progress: "Navigators hired; 340 visits.", peopleServed: 90 });
    expect(second.formResponses[0]!.provenance).toMatchObject({ "/legalName": "passport", "/progress": "prior_submission", "/peopleServed": "prior_submission" });
  });

  it("shares an accepted report with a second funder by the grantee's consent", async () => {
    const sub = await startReport();
    await data(s.applicant, "PUT", `/gms/my/submissions/${sub.id}/forms/${reportFormId}`, { response: { progress: "Navigators hired.", peopleServed: 90 } });
    expect((await s.call(s.applicant, "POST", `/gms/my/submissions/${sub.id}/share`, { funderHandle: "cascade-county" })).status).toBe(409);
    await data(s.applicant, "POST", `/gms/my/submissions/${sub.id}/submit`);
    await data(s.funder, "POST", `/gms/submissions/${sub.id}/accept`);

    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: USER_OFFICER, role: "program_officer" });
    const other = await headers(USER_OFFICER, WS_OTHER);
    expect((await s.call(other, "GET", `/gms/submissions/${sub.id}`)).status).toBe(404);
    // Only the grantee shares; the funder cannot push a report to another funder.
    expect((await s.call(s.funder, "POST", `/gms/my/submissions/${sub.id}/share`, { funderHandle: "cascade-county" })).status).toBe(403);
    const shared = await s.call<{ data: { sharedSubmissionId: string; funder: { name: string } } }>(s.applicant, "POST", `/gms/my/submissions/${sub.id}/share`, { funderHandle: "cascade-county", fields: ["progress"] });
    expect(shared.status).toBe(201);
    expect(shared.body.data.funder.name).toBe("Cascade County Health Department");
    expect(await h.repos.table("consents").one({ applicant_workspace_id: WS_APPLICANT, funder_workspace_id: WS_OTHER, basis: "shared_submission" })).not.toBeNull();
    const received = await s.call<{ items: { id: string; shared: boolean; formResponses: { response: Record<string, unknown> }[] }[] }>(other, "GET", "/gms/submissions?shared=true");
    expect(received.body.items).toHaveLength(1);
    expect(received.body.items[0]).toMatchObject({ id: shared.body.data.sharedSubmissionId, shared: true });
    // Only the fields the grantee chose travel.
    expect(received.body.items[0]!.formResponses[0]!.response).toEqual({ progress: "Navigators hired." });
    expect((await s.call(s.applicant, "POST", `/gms/my/submissions/${sub.id}/share`, { funderHandle: "cascade-county" })).status).toBe(409);
    expect((await s.call(other, "POST", `/gms/submissions/${shared.body.data.sharedSubmissionId}/accept`)).status).toBe(409);
  });

  it("opens and closes the reporting window, and sends each reminder exactly once across job retries", async () => {
    // 30 days before the due date the window opens and the first reminder goes out.
    h.clock.now = new Date("2027-11-16T09:00:00Z");
    const first = await evaluateRequirements(base());
    expect(first).toMatchObject({ due: 1, reminders: 1, failed: 0 });
    expect(h.mailer.sent).toHaveLength(1);
    expect(h.mailer.sent[0]!.subject).toBe("Interim report is due Dec 15, 2027");
    expect(h.mailer.sent[0]!.to).toEqual(["info@aldercreekfs.example"]);
    // The job runs again (a retry, or the next tick the same day): nothing more is sent.
    const retry = await evaluateRequirements(base());
    expect(retry.reminders).toBe(0);
    expect(h.mailer.sent).toHaveLength(1);
    expect(ledger("requirement.reminder_sent")).toHaveLength(1);

    // An outage skipped -14: at -7 one email goes out, not two.
    h.clock.now = new Date("2027-12-08T09:00:00Z");
    await evaluateRequirements(base());
    await evaluateRequirements(base());
    expect(h.mailer.sent).toHaveLength(2);
    expect(await h.repos.table("reminder_sends").count({ requirement_id: reqId.slice(4) })).toBe(3);

    // Past the due date the requirement is overdue.
    h.clock.now = new Date("2027-12-16T09:00:00Z");
    expect((await evaluateRequirements(base())).overdue).toBe(1);
    expect((await h.repos.table("requirements").one({ id: reqId.slice(4) }))!.status).toBe("overdue");

    // A person can also send one by hand; a waived requirement gets none. (Months have passed: a fresh session.)
    const officer = await headers(USER_OFFICER, WS_FUNDER);
    expect((await data<{ sent: boolean }>(officer, "POST", `/gms/requirements/${reqId}/remind`)).sent).toBe(true);
    expect((await s.call(officer, "POST", `/gms/requirements/${reqId}/waive`, {})).status).toBe(400);
    expect(await data<{ status: string }>(officer, "POST", `/gms/requirements/${reqId}/waive`, { reason: "Covered by the site visit" })).toMatchObject({ status: "waived" });
    expect((await s.call(officer, "POST", `/gms/requirements/${reqId}/remind`)).status).toBe(409);
    const before = h.mailer.sent.length;
    h.clock.now = new Date("2027-12-30T09:00:00Z");
    await evaluateRequirements(base());
    expect(h.mailer.sent).toHaveLength(before);
  });

  it("makes an onDate tranche due when its date arrives", async () => {
    await data(finance, "PUT", `/gms/awards/${awardId}/schedule`, { tranches: [{ percent: 100, condition: { type: "onDate", date: "2027-09-01" } }] });
    expect((await evaluateTranchesDue(base())).due).toBe(0);
    h.clock.now = new Date("2027-09-01T06:00:00Z");
    const out = await evaluateTranchesDue(base());
    expect(out).toMatchObject({ due: 1, failed: 0 });
    const rows = await h.repos.table("tranches").find({ award_id: award, status: "due" });
    expect(rows).toHaveLength(1);
    expect(h.ledger.events.filter((e) => e.eventType === "tranche.mark_due").pop()!.actor).toBe("system:tranche-due");
  });
});

describe("reconciling a payment stuck in releasing", () => {
  const stick = async () => {
    const inner = fx.fetch;
    let calls = 0;
    h.passport.fetch = (input, init) => {
      if (String(input).endsWith("/passport/disbursements") && ++calls === 1) return Promise.reject(new Error("timeout"));
      return inner(input, init);
    };
    const first = await data<{ result: string }>(finance, "POST", `/gms/tranches/${t1}/release`, { rail: "instant" });
    expect(first.result).toBe("unconfirmed");
    expect((await tranche(t1)).status).toBe("releasing");
  };

  it("repeats the identical request under the same key and follows Passport's answer", async () => {
    await stick();
    expect((await tranche(t1)).release_request).toEqual({ rail: "instant", credentialId: "pc_01JALDERCREEK0000000000000", credentialVersion: 4 });
    const out = await data<{ result: string; tranche: { status: string; passportDisbursementId: string } }>(finance, "POST", `/gms/tranches/${t1}/reconcile`);
    expect(out).toMatchObject({ result: "accepted", tranche: { status: "initiated", passportDisbursementId: DSB } });
    const posts = fx.calls.filter((c) => c.method === "POST" && c.path === "/passport/disbursements");
    // One recorded call (the first never reached the fixture): same key, and the rail the person chose.
    expect(posts.map((c) => [c.headers["idempotency-key"], (c.body as { rail: string }).rail])).toEqual([[t1, "instant"]]);
    expect(ledger("tranche.reconciled")).toHaveLength(1);
    // Nothing left to reconcile.
    expect((await s.call(finance, "POST", `/gms/tranches/${t1}/reconcile`)).status).toBe(409);
  });

  it("changes nothing while Passport still cannot confirm, and is a human gate", async () => {
    await stick();
    h.passport.fetch = () => Promise.reject(new Error("down"));
    const still = await data<{ result: string; tranche: { status: string } }>(finance, "POST", `/gms/tranches/${t1}/reconcile`);
    expect(still).toMatchObject({ result: "unconfirmed", tranche: { status: "releasing" } });
    const agent = await h.forge({ sub: FINANCE, client_id: CLIENT_AGENT, scope: "payments:read payments:release approvals:bypass", [WORKSPACE_CLAIM]: WS_FUNDER });
    const viaAgent = await h.request(`/gms/tranches/${t1}/reconcile`, { method: "POST", headers: bearer(agent).headers });
    expect(viaAgent.status).toBe(403);
    expect(((await viaAgent.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe("human_only");
    expect((await s.call(s.funder, "POST", `/gms/tranches/${t1}/reconcile`)).status).toBe(403);
  });

  it("is resolved by the job once the release has been stuck past the threshold", async () => {
    await stick();
    h.passport.fetch = fx.fetch;
    const job = (): BaseContext => ({ ...base(), config: { ...base().config, passportFetch: h.passport.fetch } });
    // Still fresh: the person may be retrying, so the job leaves it.
    expect(await reconcileStuckReleases(job())).toMatchObject({ stuck: 0, resolved: 0 });
    h.clock.now = new Date(h.clock.now.getTime() + 16 * 60 * 1000);
    expect(await reconcileStuckReleases(job())).toMatchObject({ stuck: 1, resolved: 1, unconfirmed: 0, failed: 0 });
    expect((await tranche(t1)).status).toBe("initiated");
    expect(ledger("tranche.reconciled").at(-1)!.actor).toBe("system:tranche-reconcile");
    expect(await reconcileStuckReleases(job())).toMatchObject({ stuck: 0 });
  });
});

describe("what the grantee sees of the destination and the report form", () => {
  const consentToken: Fixture = { method: "POST", path: "/oauth/token", status: 200, body: { access_token: "passport-consented-token-for-tests", refresh_token: "rt-next", token_type: "Bearer", expires_in: 600, scope: "org:read payee:read" } };
  const linkApplicant = async () => {
    await h.repos.table("passport_links").insert({ workspace_id: WS_APPLICANT, mode: "applicant_consent", client_id: "gms-test-client", refresh_token_enc: await encryptSecret("rt-first", TEST_CREDENTIALS_KEY), scopes: ["org:read", "payee:read"], linked_by_user_id: USER_APPLICANT, linked_at: "2027-02-03T00:00:00Z", last_ok_at: "2027-02-03T00:00:00Z" });
  };
  type Dest = { state: string; bankName: string | null; last4: string | null; status: string | null; pendingChange: { bankName: string | null; last4: string | null } | null; freezeUntil: string | null };

  it("shows bank name and last four read live from Passport, and nothing else about the bank", async () => {
    await linkApplicant();
    h.passport.fetch = fixtureFetch([consentToken, PAYEE({ changeControl: { pendingChange: { destinationId: "d2", state: "cooling_off", bankName: "Harbor Bank", last4: "9911", requestedAt: "2027-04-10T00:00:00Z", coolingOffUntil: "2027-04-17T00:00:00Z" }, freezeUntil: "2027-04-20T00:00:00Z", lastChangedAt: null } })]).fetch;
    const d = await data<Dest>(s.applicant, "GET", `/gms/my/awards/${awardId}/payout-destination`);
    expect(d).toMatchObject({ state: "ok", bankName: "River City Credit Union", last4: "4821", status: "active", pendingChange: { bankName: "Harbor Bank", last4: "9911" }, freezeUntil: "2027-04-20T00:00:00Z" });
    expect(JSON.stringify(d)).not.toMatch(/tok_|token|holder/i);
    const detail = await data<{ payoutDestination: Dest; tranches: unknown[] }>(s.applicant, "GET", `/gms/my/awards/${awardId}`);
    expect(detail.payoutDestination.state).toBe("ok");
    expect(detail.tranches).toHaveLength(2);
    // Read, never kept: no row of the GMS holds it.
    expect(JSON.stringify(await h.repos.table("workspaces").one({ id: WS_APPLICANT }))).not.toContain("River City");
    expect(JSON.stringify(await h.repos.table("awards").one({ id: award }))).not.toContain("4821");
    // The funder has no such route for someone else's grant.
    expect((await s.call(s.funder, "GET", `/gms/my/awards/${awardId}/payout-destination`)).status).toBeGreaterThanOrEqual(403);
  });

  it("says unknown when Passport is unreachable, not-shared when the consent lacks it, and not-linked without a link", async () => {
    expect((await data<Dest>(s.applicant, "GET", `/gms/my/awards/${awardId}/payout-destination`)).state).toBe("not_linked");
    await linkApplicant();
    h.passport.fetch = () => Promise.reject(new Error("down"));
    expect(await data<Dest>(s.applicant, "GET", `/gms/my/awards/${awardId}/payout-destination`)).toMatchObject({ state: "unknown", bankName: null, last4: null });
    h.passport.fetch = fixtureFetch([consentToken, { method: "GET", path: `/passport/payees/${ORG_ALDER}`, status: 403, body: { status: 403, message: "Insufficient scope", errors: [{ code: "insufficient_scope" }] } }]).fetch;
    expect((await data<Dest>(s.applicant, "GET", `/gms/my/awards/${awardId}/payout-destination`)).state).toBe("not_shared");
    // The grant itself still loads when the destination cannot be read.
    expect((await data<{ payoutDestination: Dest }>(s.applicant, "GET", `/gms/my/awards/${awardId}`)).payoutDestination.state).toBe("not_shared");
  });

  it("lets the grantee and the funder read a report form pinned by a requirement, and nobody else", async () => {
    const form = reportFormId.slice(4);
    const mine = await s.call<{ data: { id: string; jsonSchema: { properties: Record<string, unknown> } } }>(s.applicant, "GET", `/common-grants/forms/${form}`);
    expect(mine.status).toBe(200);
    expect(Object.keys(mine.body.data.jsonSchema.properties)).toContain("progress");
    expect((await s.call(s.applicant, "GET", `/common-grants/forms/${form}?version=1`)).status).toBe(200);
    expect((await s.call(s.applicant, "GET", `/common-grants/forms/${form}?version=7`)).status).toBe(404);
    expect((await s.call(s.funder, "GET", `/common-grants/forms/${form}`)).status).toBe(200);
    // Not public, and not for a workspace with no award that asks for it.
    expect((await h.request(`/common-grants/forms/${form}`)).status).toBe(404);
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: FINANCE, role: "observer" });
    expect((await s.call(await headers(FINANCE, WS_OTHER), "GET", `/common-grants/forms/${form}`)).status).toBe(404);
  });
});

describe("report reminders follow each member's preferences", () => {
  const withDirectory = (): BaseContext => ({ ...base(), ports: { ...base().ports, directory: h.directory } });
  const prefs = (user: string, p: Record<string, unknown>) => h.repos.table("workspace_members").update({ workspace_id: WS_APPLICANT, user_id: user }, { notification_preferences: p as never });

  it("mails members who want it now, leaves digest members to their digest, and never mails members who turned it off", async () => {
    h.directory.users.set(USER_APPLICANT, { email: "maria.santos@aldercreekfs.example", name: "Maria Santos" });
    h.directory.users.set(USER_APPLICANT_EDITOR, { email: "jamal.reed@aldercreekfs.example", name: "Jamal Reed" });
    // The harness's third member of the applicant workspace turns report email off; Jamal is on a daily digest.
    await prefs(USER_OFFICER, { digest: "immediate", channels: { requirement: { inApp: true, email: false } } });
    await prefs(USER_APPLICANT_EDITOR, { digest: "daily", channels: {} });
    h.clock.now = new Date("2027-11-16T09:00:00Z");
    expect(await evaluateRequirements(withDirectory())).toMatchObject({ reminders: 1, failed: 0 });
    expect(h.mailer.sent.map((m) => m.to)).toEqual([["maria.santos@aldercreekfs.example"]]);
    // The grantee's own ledger carries the reminder, which is what the digest and the bell read.
    const own = h.ledger.events.filter((e) => e.eventType === "requirement.reminder" && e.workspaceId === WS_APPLICANT);
    expect(own).toHaveLength(1);
    // A retry sends nothing more.
    expect((await evaluateRequirements(withDirectory())).reminders).toBe(0);
    expect(h.mailer.sent).toHaveLength(1);
  });

  it("sends nothing at once when everyone who wants it is on a digest, and falls back to the organization only when nobody opted in", async () => {
    h.directory.users.set(USER_APPLICANT, { email: "maria.santos@aldercreekfs.example", name: "Maria Santos" });
    await prefs(USER_APPLICANT, { digest: "weekly", channels: {} });
    await prefs(USER_OFFICER, { digest: "immediate", channels: { requirement: { inApp: true, email: false } } });
    h.clock.now = new Date("2027-11-16T09:00:00Z");
    expect((await evaluateRequirements(withDirectory())).reminders).toBe(1);
    expect(h.mailer.sent).toHaveLength(0);

    // Next offset: every member has now turned report email off, so the organization's address gets it.
    await prefs(USER_APPLICANT, { digest: "immediate", channels: { requirement: { inApp: true, email: false } } });
    h.clock.now = new Date("2027-12-02T09:00:00Z");
    expect((await evaluateRequirements(withDirectory())).reminders).toBe(1);
    expect(h.mailer.sent.map((m) => m.to)).toEqual([["info@aldercreekfs.example"]]);
  });
});

describe("budgets", () => {
  const APPROVED = { kind: "approved", lines: [{ category: "Personnel", label: "Navigators (2 FTE)", amountMinor: 9_600_000 }, { category: "Travel", label: "Van route", amountMinor: 2_800_000 }, { category: "Indirect", label: "Indirect (10%)", amountMinor: 1_500_000 }] };

  it("the funder approves a budget, the grantee reports actuals, and variance is by category", async () => {
    expect((await s.call(s.applicant, "PUT", `/gms/my/awards/${awardId}/budget`, APPROVED)).status).toBe(403);
    expect((await s.call(s.funder, "PUT", `/gms/awards/${awardId}/budget`, { kind: "approved", lines: [{ category: "Personnel", label: "Too much", amountMinor: 20_000_000 }] })).status).toBe(422);
    const approved = await data<{ totalMinor: number }>(s.funder, "PUT", `/gms/awards/${awardId}/budget`, APPROVED);
    expect(approved.totalMinor).toBe(13_900_000);
    expect((await s.call(s.applicant, "PUT", `/gms/my/awards/${awardId}/budget`, { kind: "actual", lines: [{ category: "Personnel", label: "Q1", amountMinor: 1 }] })).status).toBe(400);
    await data(s.applicant, "PUT", `/gms/my/awards/${awardId}/budget`, { kind: "actual", periodStart: "2027-07-01", periodEnd: "2027-09-30", lines: [{ category: "Personnel", label: "Q1 salaries", amountMinor: 2_400_000 }, { category: "Travel", label: "Q1 fuel and lease", amountMinor: 3_000_000 }] });
    const v = await data<{ categories: { category: string; approvedMinor: number; actualMinor: number; varianceMinor: number; over: boolean }[]; totals: { approvedMinor: number; actualMinor: number; over: boolean } }>(s.funder, "GET", `/gms/awards/${awardId}/variance`);
    expect(v.categories).toEqual([
      { category: "Personnel", approvedMinor: 9_600_000, actualMinor: 2_400_000, varianceMinor: 7_200_000, percentSpent: 25, over: false },
      { category: "Travel", approvedMinor: 2_800_000, actualMinor: 3_000_000, varianceMinor: -200_000, percentSpent: 107.1, over: true },
      { category: "Indirect", approvedMinor: 1_500_000, actualMinor: 0, varianceMinor: 1_500_000, percentSpent: 0, over: false },
    ]);
    expect(v.totals).toMatchObject({ approvedMinor: 13_900_000, actualMinor: 5_400_000, over: false });
    const both = await data<{ approved: { lines: unknown[] }; actuals: unknown[] }>(s.applicant, "GET", `/gms/my/awards/${awardId}/budget`);
    expect(both.approved.lines).toHaveLength(3);
    expect(both.actuals).toHaveLength(1);
  });
});

describe("the same services through MCP", () => {
  interface ToolOut {
    structuredContent: Record<string, unknown>;
    isError: boolean;
    content: { text: string }[];
  }
  let seq = 0;
  const tool = async (token: string, name: string, args: Record<string, unknown> = {}): Promise<ToolOut> => {
    const res = await h.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method: "tools/call", params: { name, arguments: args } }) });
    return ((await res.json()) as { result: ToolOut }).result;
  };

  it("an agent checks readiness and asks to release; the money moves only when a finance person approves", async () => {
    const agent = await h.forge({ sub: FINANCE, client_id: CLIENT_AGENT, scope: "payments:read payments:release requirements:read analytics:read grantees:read", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-finance-agent" });
    const ready = await tool(agent, "check_payment_readiness", { trancheId: t1 });
    expect(ready.structuredContent).toMatchObject({ releasable: true, destination: { last4: "4821" } });
    const listed = await tool(agent, "list_tranches", { status: ["due"] });
    expect(listed.isError).toBe(false);

    const asked = await tool(agent, "release_tranche", { trancheId: t1 });
    expect(asked.structuredContent).toMatchObject({ status: "pending_approval" });
    expect(fx.calls.some((c) => c.path === "/passport/disbursements")).toBe(false);
    expect((await tranche(t1)).status).toBe("due");
    // A program officer cannot approve a payment; finance can.
    const approvalId = asked.structuredContent.approvalId as string;
    const byOfficer = await s.call<{ data?: { status: string } }>(s.funder, "POST", `/gms/approvals/${approvalId}/decision`, { approve: true });
    expect(byOfficer.body.data?.status).not.toBe("executed");
    expect((await tranche(t1)).status).toBe("due");
  });

  it("an agent cannot record an external payment, and reads reporting and portfolio data", async () => {
    const agent = await h.forge({ sub: FINANCE, client_id: CLIENT_AGENT, scope: "payments:read payments:release requirements:read analytics:read grantees:read", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-finance-agent-2" });
    const recorded = await tool(agent, "record_external_payment", { trancheId: t1, reference: "Check 10482", paidAt: "2027-04-15T00:00:00Z", destinationLast4: "4821" });
    expect(recorded.isError).toBe(true);
    expect((await tranche(t1)).status).toBe("due");
    expect((await tool(agent, "list_requirements", { awardId })).isError).toBe(false);
    const folio = await tool(agent, "portfolio_summary", {});
    expect((folio.structuredContent.totals as { committedMinor: number }).committedMinor).toBe(15_000_000);
    const g = await tool(agent, "get_passport_status", { applicantWorkspaceId: WS_APPLICANT });
    expect(g.structuredContent).toMatchObject({ verificationLevel: "L3", payeeStatus: { active: true } });
  });
});
