// SPDX-License-Identifier: AGPL-3.0-only
// Red team (2026-11), money path. Setup as in money.test.ts: recorded Passport fixtures, no network.
import { beforeEach, describe, expect, it } from "vitest";
import { encryptSecret, fixtureFetch, type Fixture } from "@gms/passport-client";
import { reconcileStuckReleases } from "../src/jobs.ts";
import type { BaseContext } from "../src/services/context.ts";
import { ORG_RIVERBEND, PASSPORT, TEST_CREDENTIALS_KEY, USER_ADMIN, WEB, BASE, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";
import { ORG_ALDER, scenario, type Scenario } from "./scenario.ts";

const FINANCE = "70000000-0000-4000-8000-000000000001";
const PASSPORT_AWARD = "0193a1c0-0000-7000-8000-00000000aa01";
const DSB = "dsb_01JFIXTURE0000000000000000";
let h: Harness, s: Scenario, admin: Record<string, string>, finance: Record<string, string>, awardId: string, award: string, t1: string, t2: string;
let fx: ReturnType<typeof fixtureFetch>;
const headers = async (user: string, ws: string) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });
const data = async <T>(who: Record<string, string>, method: string, path: string, body?: unknown): Promise<T> => {
  const r = await s.call<{ data: T }>(who, method, path, method === "GET" ? undefined : (body ?? {}));
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const tranche = async (id: string) => (await h.repos.table("tranches").one({ id: id.slice(4) }))!;
const base = (): BaseContext => ({ repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, ports: { mailer: h.mailer, storage: h.storage }, config: { baseUrl: BASE, webBaseUrl: WEB, passportBaseUrl: PASSPORT, credentialsKey: TEST_CREDENTIALS_KEY, passportClient: null, mailFrom: "OpenGrants GMS <notices@gms.test>", webhookSecretKey: TEST_CREDENTIALS_KEY, facilitatedPayments: true, ...(h.passport.fetch ? { passportFetch: h.passport.fetch } : {}) } });
const env = (body: unknown, status = 200) => ({ status, message: "Success", data: body });
const TOKEN: Fixture = { method: "POST", path: "/oauth/token", status: 200, body: { access_token: "passport-access-token-for-tests", token_type: "Bearer", expires_in: 3600, scope: "org:read payee:read award:write disbursement:read disbursement:write" } };
const SOURCES: Fixture = { method: "GET", path: `/passport/funders/${ORG_RIVERBEND}/sources`, status: 200, body: { status: 200, message: "Success", items: [{ id: "src_1", orgId: ORG_RIVERBEND, provider: "stripe", status: "verified", statusReason: null, bankName: "First Fictional Bank", last4: "5520", canDebit: true, verifiedAt: "2027-01-12T00:00:00Z", createdAt: "2027-01-10T00:00:00Z" }], paginationInfo: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 } } };
const credential = (over: Record<string, unknown> = {}) => ({ id: "pc_01JALDERCREEK0000000000000", version: 4, organization: { id: ORG_ALDER, name: "Alder Creek Family Services", identifiers: {} }, level: "L3", payoutDestination: { provider: "stripe", token: "tok_fixture_standard", tokensByRail: { standard: "tok_fixture_standard" }, bankName: "River City Credit Union", last4: "4821", holderType: "company", holderNameMatch: "match", validations: [], verifiedAt: "2027-01-12T17:00:00Z", status: "active" }, changeControl: { pendingChange: null, freezeUntil: null, lastChangedAt: "2027-01-12T17:00:00Z" }, warranty: { cap: { amount: "250000.00", currency: "USD" }, termsUrl: "https://passport.example/warranty" }, attestation: "fixture.attestation.jws", issuedAt: "2027-05-24T16:00:00Z", ...over });
const PAYEE = (over: Record<string, unknown> = {}): Fixture => ({ method: "GET", path: `/passport/payees/${ORG_ALDER}`, status: 200, body: env(credential(over)) });
const PASSPORT_AWARD_FX = (disbursed = "0.00"): Fixture => ({ method: "GET", path: `/common-grants/awards/${PASSPORT_AWARD}`, status: 200, body: env({ id: PASSPORT_AWARD, title: "T", status: { value: "awarded" }, funding: { awardedAmount: { amount: "150000.00", currency: "USD" }, disbursedAmount: { amount: disbursed, currency: "USD" } } }) });
const disbursement = (status: string, over: Record<string, unknown> = {}) => ({ id: DSB, awardId: PASSPORT_AWARD, funderOrgId: ORG_RIVERBEND, recipientOrgId: ORG_ALDER, credentialId: "pc_01JALDERCREEK0000000000000", credentialVersion: 4, amount: { amount: "75000.00", currency: "USD" }, requestedRail: "auto", rail: "standard", mode: "facilitated", status, memo: "tranche 1", fee: null, warrantyEligible: true, checks: [], timeline: [], createdAt: "2027-05-24T16:05:00Z", lastModifiedAt: "2027-05-24T16:05:00Z", ...over });
const DISBURSE = (status = "initiated", over: Record<string, unknown> = {}): Fixture => ({ method: "POST", path: "/passport/disbursements", status: 201, body: { status: 201, message: "Created", data: disbursement(status, over) } });
function passport(...fixtures: Fixture[]) {
  fx = fixtureFetch([TOKEN, SOURCES, ...fixtures]);
  h.passport.fetch = fx.fetch;
}

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  admin = await headers(USER_ADMIN, WS_FUNDER);
  await h.repos.table("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: FINANCE, role: "finance" });
  finance = await headers(FINANCE, WS_FUNDER);
  const form = await data<{ id: string }>(s.funder, "POST", "/gms/forms", { title: "Interim report", purpose: "report", jsonSchema: { type: "object", properties: { legalName: { type: "string" }, progress: { type: "string", minLength: 5 } }, required: ["progress"] }, uiSchema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/legalName" }, { type: "Control", scope: "#/properties/progress" }] }, mappingFromCommonGrants: { legalName: { field: "name" } } });
  await data(s.funder, "POST", `/gms/forms/${form.id}/publish`);
  const program = await data<{ id: string }>(s.funder, "POST", "/gms/programs", { name: "Community Health 2027", budgetAmountMinor: 120_000_000, fiscalYear: 2027, defaults: { awardPeriod: { startDate: "2027-07-01", endDate: "2028-06-30" }, schedule: [{ percent: 50, condition: { type: "onExecution" } }, { percent: 50, condition: { type: "onReportAccepted", requirementKey: "interim" } }], requirements: [{ key: "interim", type: "report", title: "Interim report", formId: form.id.slice(4), formVersion: 1, dueAt: "2027-12-15T00:00:00Z" }] } });
  await h.repos.table("opportunities").update({ id: s.uuid.opp }, { program_id: program.id });
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
  await h.repos.table("passport_links").insert({ workspace_id: WS_FUNDER, mode: "funder_client", client_id: "pc_riverbend_gms", client_secret_enc: await encryptSecret("passport-client-secret-for-tests", TEST_CREDENTIALS_KEY), scopes: ["payee:read"], linked_at: h.clock.now.toISOString(), last_ok_at: h.clock.now.toISOString() });
  await h.repos.table("awards").update({ id: award }, { passport_award_id: PASSPORT_AWARD });
  passport(PAYEE(), PASSPORT_AWARD_FX(), DISBURSE());
});


type RowsOf = { rows: Record<string, unknown>[] };
const GRANTEE = "ffffffff-ffff-4fff-8fff-ffffffffffff"; // admin of the applicant workspace (the award's recipient)
const posts = () => fx.calls.filter((c) => c.method === "POST" && c.path === "/passport/disbursements");

/** A funder workspace the grantee made for itself, with an award and schedule of its own. */
async function shell() {
  const me = { ...bearer(await h.session(GRANTEE)).headers, "Content-Type": "application/json" };
  let ws = await h.repos.table("workspaces").one({ handle: "shell-funder" });
  if (!ws) {
    await h.request("/gms/workspaces", { method: "POST", headers: me, body: JSON.stringify({ kind: "funder", handle: "shell-funder", displayName: "Shell Funder" }) });
    ws = (await h.repos.table("workspaces").one({ handle: "shell-funder" }))!;
  }
  const own = (await h.repos.table("awards").one({ workspace_id: ws.id })) ?? (await h.repos.table("awards").insert({ workspace_id: ws.id, recipient_individual: { name: "seed" } as never, title: "seed", status: "active", funding: { awardedAmount: { amount: "1.00", currency: "USD" } } as never }));
  const schedule = (await h.repos.table("payment_schedules").one({ workspace_id: ws.id })) ?? (await h.repos.table("payment_schedules").insert({ workspace_id: ws.id, award_id: own.id }));
  return { evil: { ...me, "X-GMS-Workspace": ws.id }, evilWs: ws.id, own, schedule };
}

/** A tranche in that workspace that names the victim funder's award: the row a cross-tenant write would leave behind. */
async function plantedTranche(status: string = "due") {
  const { evil, evilWs, own, schedule } = await shell();
  const seq = 99 + (await h.repos.table("tranches").count({ workspace_id: evilWs }));
  const t = await h.repos.table("tranches").insert({ workspace_id: evilWs, schedule_id: schedule.id, award_id: own.id, seq, amount_minor: 7_500_000, currency: "USD", status, due_at: h.clock.now.toISOString(), ...(status === "held" ? { hold_reason: "manual" } : {}), ...(status === "releasing" ? { mode: "facilitated" } : {}) });
  await h.repos.table("tranches").update({ id: t.id }, { idempotency_key: `trn_${t.id}` });
  // The repository refuses this row (as the database does), so it is put there by hand: the
  // services must not trust it either.
  (h.repos.table("tranches") as unknown as RowsOf).rows.find((r) => r.id === t.id)!.award_id = award;
  return { evil, evilWs, id: `trn_${t.id}` };
}

describe("a tranche whose award belongs to another workspace", () => {
  it("is not found on any payment route, and nothing reaches Passport", async () => {
    const calls = fx.calls.length;
    for (const status of ["due", "held", "releasing"]) {
      const { evil, id } = await plantedTranche(status);
      const before = await tranche(id);
      for (const [method, path, body] of [
        ["GET", `/gms/tranches/${id}/readiness`, undefined],
        ["POST", `/gms/tranches/${id}/release`, {}],
        ["POST", `/gms/tranches/${id}/reconcile`, {}],
        ["POST", `/gms/tranches/${id}/record-external`, { reference: "x", paidAt: "2027-05-01", destinationLast4: "4821" }],
        ["POST", `/gms/tranches/${id}/hold`, { reason: "x" }],
        ["POST", `/gms/tranches/${id}/release-hold`, {}],
        ["POST", `/gms/tranches/${id}/cancel`, { reason: "x" }],
      ] as const) {
        const res = await s.call(evil, method, path, body);
        expect(res.status, `${status}: ${method} ${path}`).toBe(404);
      }
      expect((await tranche(id)).status).toBe(before.status);
    }
    expect(fx.calls.length).toBe(calls);
    expect(posts()).toHaveLength(0);
    // The victim funder's own tranches are where they were.
    expect((await tranche(t1)).status).toBe("due");
    expect((await tranche(t2)).status).toBe("scheduled");
    // And the funder's own people still see and work their own payments.
    expect((await s.call(finance, "GET", `/gms/tranches/${t1}/readiness`)).status).toBe(200);
    const center = await data<{ items: { tranche: { id: string } }[] }>(admin, "GET", "/gms/payments/readiness");
    expect(center.items.map((i) => i.tranche.id)).toEqual([t1]);
  });

  it("is skipped by the reconcile job and by the Payments center", async () => {
    const { evil, id } = await plantedTranche("releasing");
    h.clock.now = new Date(h.clock.now.getTime() + 16 * 60 * 1000);
    const out = await reconcileStuckReleases({ ...base(), config: { ...base().config, passportFetch: h.passport.fetch! } });
    expect(posts()).toHaveLength(0);
    expect(out.resolved).toBe(0);
    expect((await tranche(id)).status).toBe("releasing");
    const center = await s.call<{ data: { items: unknown[] } }>(evil, "GET", "/gms/payments/readiness");
    expect(center.status).toBe(200);
    expect(center.body.data.items).toHaveLength(0);
  });

  it("the same holds for a planted report, amendment and agreement: none of them moves the victim's records", async () => {
    const { evil, evilWs, own } = await shell();
    const rowsOf = (t: Parameters<typeof h.repos.table>[0]) => (h.repos.table(t) as unknown as RowsOf).rows;
    // A requirement and submitted report in the shell workspace, re-pointed at the victim's award and gated tranche.
    const req = await h.repos.table("requirements").insert({ workspace_id: evilWs, award_id: own.id, type: "report", title: "x", status: "submitted" });
    const sub = await h.repos.table("submissions").insert({ workspace_id: evilWs, requirement_id: req.id, award_id: own.id, status: "submitted", submitted_at: h.clock.now.toISOString() });
    Object.assign(rowsOf("requirements").find((r) => r.id === req.id)!, { award_id: award, releases_tranche_id: t2.slice(4) });
    rowsOf("submissions").find((r) => r.id === sub.id)!.award_id = award;
    expect((await s.call(evil, "POST", `/gms/submissions/sub_${sub.id}/accept`, {})).status).toBe(404);
    expect((await s.call(evil, "POST", `/gms/requirements/req_${req.id}/waive`, { reason: "x" })).status).toBe(404);
    expect((await tranche(t2)).status).toBe("scheduled");
    // An amendment in the shell workspace on the victim's award.
    const before = await h.repos.table("awards").count({ workspace_id: WS_FUNDER });
    const sup = await h.repos.table("amendments").insert({ workspace_id: evilWs, award_id: own.id, type: "supplemental", request: { amountMinor: 90_000_000, title: "Supplement" } as never });
    const ext = await h.repos.table("amendments").insert({ workspace_id: evilWs, award_id: own.id, type: "extension", request: { newEndDate: "2035-12-31" } as never });
    for (const m of [sup, ext]) rowsOf("amendments").find((r) => r.id === m.id)!.award_id = award;
    expect((await s.call(evil, "PATCH", `/gms/amendments/${sup.id}`, { status: "approved" })).status).toBe(404);
    expect((await s.call(evil, "PATCH", `/gms/amendments/${ext.id}`, { status: "approved" })).status).toBe(404);
    expect(await h.repos.table("awards").count({ workspace_id: WS_FUNDER })).toBe(before);
    expect(((await h.repos.table("awards").one({ id: award }))!.key_dates as { periodOfPerformance: { endDate: string } }).periodOfPerformance.endDate).toBe("2028-06-30");
    // A forged executed agreement in the shell workspace that names the victim's award is not the award's agreement.
    const forged = await h.repos.table("agreements").insert({ workspace_id: evilWs, award_id: own.id, version: 99, status: "executed", document_sha256: "a".repeat(64), grantee_signature: { name: "x" } as never, funder_signature: { name: "y" } as never, executed_at: h.clock.now.toISOString() });
    rowsOf("agreements").find((r) => r.id === forged.id)!.award_id = award;
    const seen = await data<{ agreement: { id: string; version: number } }>(s.funder, "GET", `/gms/awards/${awardId}`);
    expect(seen.agreement.id).not.toBe(`agr_${forged.id}`);
    expect(seen.agreement.version).toBe(1);
    expect((await s.call(evil, "GET", `/gms/agreements/agr_${forged.id}`)).status).toBe(404);
  });

  it("cannot be written at all: the repository refuses a child row in another workspace than its parent", async () => {
    const { evilWs } = await plantedTranche();
    const schedule = (await h.repos.table("payment_schedules").one({ workspace_id: evilWs }))!;
    await expect(h.repos.table("tranches").insert({ workspace_id: evilWs, schedule_id: schedule.id, award_id: award, seq: 50, amount_minor: 100, currency: "USD" })).rejects.toMatchObject({ kind: "invalid" });
    await expect(h.repos.table("agreements").insert({ workspace_id: evilWs, award_id: award, version: 99 })).rejects.toMatchObject({ kind: "invalid" });
    await expect(h.repos.table("requirements").insert({ workspace_id: evilWs, award_id: award, type: "report", title: "x" })).rejects.toMatchObject({ kind: "invalid" });
    const own = (await h.repos.table("tranches").find({ workspace_id: evilWs }))[0]!;
    await expect(h.repos.table("tranches").update({ id: own.id }, { award_id: award })).rejects.toMatchObject({ kind: "invalid" });
  });
});
