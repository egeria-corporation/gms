// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// The funder's money and compliance routes (api/funderMoney.ts), one scenario on two backends: the
// web HTTP client against the real API Worker in-process (with recorded Passport answers), and the
// in-browser mock. The assertions are the fields the screens read, so a path, verb, body field or
// response shape that drifts fails here.
import { beforeAll, describe, expect, it } from "vitest";
import { ApiError, type GmsApi } from "../src/api/client.ts";
import { createMockApi } from "../src/mocks/api.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_IDS, USERS } from "../src/mocks/funder.ts";
import { MONEY_IDS, type MockMoneyControls } from "../src/mocks/funderMoney.ts";
import { IDS, seedStore } from "../src/mocks/store.ts";
import { httpApiFor, loadApi, type ApiHarness } from "./api-harness.ts";

interface Backend {
  /** A funder admin with the finance role's rights. */
  api: GmsApi;
  awardId: string;
  /** Due, with every readiness check passing. */
  t1: string;
  /** Scheduled; becomes due when the report is accepted. */
  t2: string;
  submissionId: string;
  applicationId: string;
  competitionId: string;
  granteeWorkspaceId: string;
  memberUserId: string;
  workspaceId: string;
  /** Passport reports the disbursement for `t1` as settled. */
  settle(): Promise<void>;
}

const ISO = /^\d{4}-\d{2}-\d{2}T/;
async function failure(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error("Expected the call to be refused");
}

type Call = (who: Record<string, string>, method: string, path: string, body?: unknown) => Promise<{ status: number; body: { data: Record<string, unknown> } }>;
interface Scenario {
  applicant: Record<string, string>;
  funder: Record<string, string>;
  compId: string;
  uuid: { comp: string; loi: string; opp: string };
  call: Call;
}
interface Fixture {
  method: string;
  path: string;
  status: number;
  body: unknown;
}
interface PassportKit {
  encryptSecret(secret: string, key: string): Promise<string>;
  fixtureFetch(fixtures: Fixture[]): { fetch: NonNullable<ApiHarness["passport"]["fetch"]> };
  signPassportPayload(secret: string, ts: number, body: string): Promise<string>;
}

async function realBackend(): Promise<Backend> {
  const load = async <T>(rel: string) => (await import(/* @vite-ignore */ new URL(rel, import.meta.url).href)) as T;
  const helpers = await loadApi();
  const more = await load<{ USER_OFFICER: string; TEST_CREDENTIALS_KEY: string; PASSPORT_WEBHOOK_SECRET: string }>("../../api/test/helpers.ts");
  const { scenario, ORG_ALDER } = await load<{ scenario: (h: ApiHarness) => Promise<Scenario>; ORG_ALDER: string }>("../../api/test/scenario.ts");
  const kit = await load<PassportKit>("../../../packages/passport-client/src/index.ts");
  const h = await helpers.harness();
  const s = await scenario(h);
  const ok = async (who: Record<string, string>, method: string, path: string, body?: unknown) => {
    const r = await s.call(who, method, path, method === "GET" ? undefined : (body ?? {}));
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data;
  };

  // A report form and a program whose defaults give the award two tranches and one report.
  const form = await ok(s.funder, "POST", "/gms/forms", {
    title: "Interim report",
    purpose: "report",
    jsonSchema: { type: "object", properties: { progress: { type: "string", minLength: 5 } }, required: ["progress"] },
    uiSchema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/progress" }] },
  });
  await ok(s.funder, "POST", `/gms/forms/${form.id as string}/publish`);
  const program = await ok(s.funder, "POST", "/gms/programs", {
    name: "Community Health 2027",
    budgetAmountMinor: 120_000_000,
    fiscalYear: 2027,
    defaults: {
      awardPeriod: { startDate: "2027-07-01", endDate: "2028-06-30" },
      schedule: [{ percent: 50, condition: { type: "onExecution" } }, { percent: 50, condition: { type: "onReportAccepted", requirementKey: "interim" } }],
      requirements: [{ key: "interim", type: "report", title: "Interim report", formId: (form.id as string).slice(4), formVersion: 1, dueAt: "2027-12-15T00:00:00Z" }],
    },
  });
  await (h.repos.table("opportunities") as unknown as { update(where: object, patch: object): Promise<unknown> }).update({ id: s.uuid.opp }, { program_id: program.id });

  // Apply, decide, accept, sign and countersign: the award is active and tranche 1 is due.
  const app = (await ok(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp })).id as string;
  await ok(s.applicant, "PUT", `/common-grants/applications/${app}/forms/${s.uuid.loi}`, { response: { projectTitle: "Mobile Health Navigation for Rural Families", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel 46 miles to reach primary care." } });
  await ok(s.applicant, "PUT", `/common-grants/applications/${app}/submit`);
  const proposed = (await ok(s.funder, "POST", "/gms/decisions/propose", { competitionId: s.compId, decisions: [{ applicationId: `app_${app}`, outcome: "approve", amountMinor: 15_000_000 }] })) as { decisions: { id: string }[] };
  const committed = (await ok(s.funder, "POST", "/gms/decisions/commit", { competitionId: s.compId, decisionIds: [proposed.decisions[0]!.id] })) as { results: { awardId: string; agreementId: string }[] };
  const { awardId, agreementId } = committed.results[0]!;
  const sent = await ok(s.funder, "POST", `/gms/agreements/${agreementId}/send`);
  await ok(s.applicant, "POST", `/gms/my/awards/${awardId}/accept`);
  await ok(s.applicant, "POST", `/gms/agreements/${agreementId}/sign`, { name: "Maria Santos", attest: true, documentSha256: sent.documentSha256 });
  await ok(s.funder, "POST", `/gms/agreements/${agreementId}/countersign`, { name: "Dana Ortiz", attest: true });

  // The funder is linked to Passport and the award is mirrored there.
  const PASSPORT_AWARD = "0193a1c0-0000-7000-8000-00000000aa01";
  const tables = h.repos as unknown as { table(name: string): { insert(row: object): Promise<unknown>; update(where: object, patch: object): Promise<unknown>; find(where: object, opts?: object): Promise<Record<string, unknown>[]> } };
  await tables.table("passport_links").insert({ workspace_id: helpers.WS_FUNDER, mode: "funder_client", client_id: "pc_riverbend_gms", client_secret_enc: await kit.encryptSecret("test-secret", more.TEST_CREDENTIALS_KEY), scopes: ["payee:read"], linked_at: h.clock.now.toISOString(), last_ok_at: h.clock.now.toISOString() });
  await tables.table("awards").update({ id: awardId.slice(4) }, { passport_award_id: PASSPORT_AWARD });
  const env = (body: unknown) => ({ status: 200, message: "Success", data: body });
  const credential = { id: "pc_test_alder", version: 4, organization: { id: ORG_ALDER, name: "Alder Creek Family Services", identifiers: {} }, level: "L3", payoutDestination: { provider: "stripe", token: "test-token", tokensByRail: { standard: "test-token" }, bankName: "River City Credit Union", last4: "4821", holderType: "company", holderNameMatch: "match", validations: [], verifiedAt: "2027-01-12T17:00:00Z", status: "active" }, changeControl: { pendingChange: null, freezeUntil: null, lastChangedAt: "2027-01-12T17:00:00Z" }, warranty: { cap: { amount: "250000.00", currency: "USD" }, termsUrl: "https://passport.example/warranty" }, attestation: "test.attestation", issuedAt: "2027-05-24T16:00:00Z" };
  const DSB = "dsb_test_1";
  const passport = (disbursed: string) => {
    h.passport.fetch = kit.fixtureFetch([
      { method: "POST", path: "/oauth/token", status: 200, body: { access_token: "test-access-token", token_type: "Bearer", expires_in: 3600, scope: "org:read payee:read award:write disbursement:read disbursement:write" } },
      { method: "GET", path: `/passport/funders/${helpers.ORG_RIVERBEND}/sources`, status: 200, body: { status: 200, message: "Success", items: [{ id: "src_1", orgId: helpers.ORG_RIVERBEND, provider: "stripe", status: "verified", statusReason: null, bankName: "First Fictional Bank", last4: "5520", canDebit: true, verifiedAt: "2027-01-12T00:00:00Z", createdAt: "2027-01-10T00:00:00Z" }], paginationInfo: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 } } },
      { method: "GET", path: `/passport/payees/${ORG_ALDER}`, status: 200, body: env(credential) },
      { method: "GET", path: `/common-grants/awards/${PASSPORT_AWARD}`, status: 200, body: env({ id: PASSPORT_AWARD, title: "Mobile Health Navigation for Rural Families", status: { value: "awarded" }, funding: { awardedAmount: { amount: "150000.00", currency: "USD" }, disbursedAmount: { amount: disbursed, currency: "USD" } } }) },
      { method: "POST", path: "/passport/disbursements", status: 201, body: { status: 201, message: "Created", data: { id: DSB, awardId: PASSPORT_AWARD, funderOrgId: helpers.ORG_RIVERBEND, recipientOrgId: ORG_ALDER, credentialId: credential.id, credentialVersion: 4, amount: { amount: "75000.00", currency: "USD" }, requestedRail: "auto", rail: "standard", mode: "facilitated", status: "initiated", memo: "tranche 1", fee: null, warrantyEligible: true, checks: [], timeline: [], createdAt: "2027-05-24T16:05:00Z", lastModifiedAt: "2027-05-24T16:05:00Z" } } },
    ]).fetch;
  };
  passport("0.00");

  const rows = await tables.table("tranches").find({ award_id: awardId.slice(4) }, { orderBy: "seq" });
  const t1 = `trn_${rows[0]!.id as string}`;
  const t2 = `trn_${rows[1]!.id as string}`;

  // The grantee writes and submits the interim report.
  const requirement = (await ok(s.applicant, "GET", "/gms/my/requirements")) as unknown as { id: string }[];
  const started = await ok(s.applicant, "POST", `/gms/my/requirements/${requirement[0]!.id}/start`);
  await ok(s.applicant, "PUT", `/gms/my/submissions/${started.id as string}/forms/${form.id as string}`, { response: { progress: "412 families enrolled in the first five months." } });
  await ok(s.applicant, "POST", `/gms/my/submissions/${started.id as string}/submit`);

  const api = httpApiFor(helpers, h, helpers.USER_ADMIN);
  const ws = await api.workspace("riverbend");
  const granteeRow = (await tables.table("awards").find({ id: awardId.slice(4) }))[0]!;
  return {
    api,
    awardId,
    t1,
    t2,
    submissionId: started.id as string,
    applicationId: `app_${app}`,
    competitionId: s.compId,
    granteeWorkspaceId: granteeRow.recipient_workspace_id as string,
    memberUserId: more.USER_OFFICER,
    workspaceId: ws.id,
    async settle() {
      passport("75000.00");
      const body = JSON.stringify({ id: "evt_test_settled", type: "disbursement.status.changed", orgId: ORG_ALDER, occurredAt: h.clock.now.toISOString(), data: { id: DSB, status: "settled", awardId: PASSPORT_AWARD } });
      const ts = Math.floor(h.clock.now.getTime() / 1000);
      const res = await h.request("/webhooks/passport", { method: "POST", headers: { "Content-Type": "application/json", "X-Passport-Timestamp": String(ts), "X-Passport-Signature": await kit.signPassportPayload(more.PASSPORT_WEBHOOK_SECRET, ts, body) }, body });
      if (res.status >= 300) throw new Error(`Passport webhook -> ${res.status} ${await res.text()}`);
    },
  };
}

async function mockBackend(): Promise<Backend> {
  const api = createMockApi({ session: async () => demoSession(), store: seedStore() });
  const ws = await api.workspace("riverbend");
  return {
    api,
    awardId: MONEY_IDS.awardAlder,
    t1: MONEY_IDS.alderT1,
    t2: MONEY_IDS.alderT2,
    submissionId: MONEY_IDS.subAlderInterim,
    applicationId: MOCK_IDS.alder,
    competitionId: IDS.compHealth27,
    granteeWorkspaceId: MONEY_IDS.wsAlder,
    memberUserId: USERS.marcus,
    workspaceId: ws.id,
    settle: () => (api as unknown as MockMoneyControls).simulatePassport({ type: "disbursement.settled", trancheId: MONEY_IDS.alderT1 }),
  };
}

describe.each([
  ["the real API", realBackend],
  ["the mock", mockBackend],
])("funder money routes against %s", (_name, build) => {
  let b: Backend;
  beforeAll(async () => {
    b = await build();
  });

  it("reads the schedule and lists tranches with their award and recipient", async () => {
    const schedule = await b.api.getSchedule(b.awardId);
    expect(schedule).toMatchObject({ awardId: b.awardId, currency: "USD", awardedAmountMinor: 15_000_000 });
    expect(schedule.tranches.length).toBeGreaterThanOrEqual(2);
    expect(schedule.tranches[0]).toMatchObject({ id: b.t1, seq: 1, status: "due", condition: { type: "onExecution" } });
    expect(schedule.tranches.find((t) => t.id === b.t2)).toMatchObject({ status: "scheduled", condition: { type: "onReportAccepted" } });
    const due = await b.api.listTranches({ view: "due" });
    expect(due.find((t) => t.id === b.t1)).toMatchObject({ award: { id: b.awardId, title: "Mobile Health Navigation for Rural Families" }, recipient: { name: "Alder Creek Family Services", verificationLevel: "L3", pendingDestinationChange: false } });
    expect((await b.api.listTranches({ awardId: b.awardId })).map((t) => t.id)).toEqual(expect.arrayContaining([b.t1, b.t2]));
  });

  it("answers readiness as seven checks with a destination that is a bank name and four digits", async () => {
    const r = await b.api.trancheReadiness(b.t1);
    expect(r.checks.map((c) => c.key)).toEqual(["agreement", "condition", "funder_link", "payee_credential", "award_headroom", "no_duplicate", "recipient_standing"]);
    for (const c of r.checks) expect(c).toMatchObject({ state: "pass", label: expect.any(String), reason: expect.any(String) });
    expect(r).toMatchObject({ releasable: true, passed: 7, failed: 0, unknown: 0, total: 7, banner: null, destination: { bankName: "River City Credit Union", last4: "4821" }, tranche: { id: b.t1 } });
    expect(Object.keys(r.destination ?? {}).sort()).toEqual(["bankName", "last4", "status"]);
    // A tranche whose condition is not met is not releasable, and releasing it is refused.
    const second = await b.api.trancheReadiness(b.t2);
    expect(second.releasable).toBe(false);
    expect(second.checks.find((c) => c.key === "condition")?.state).toBe("fail");
    expect((await failure(b.api.releaseTranche(b.t2))).status).toBe(409);

    const center = await b.api.paymentsReadiness();
    expect(center.items.find((i) => i.tranche.id === b.t1)).toMatchObject({ releasable: true, award: { id: b.awardId, title: expect.any(String) } });
    expect(center.totals).toMatchObject({ dueMinor: expect.any(Number), releasable: expect.any(Number), blocked: expect.any(Number) });
    for (const a of await b.api.paymentAlerts()) expect(a).toMatchObject({ kind: expect.any(String), title: expect.any(String), detail: expect.any(String) });
    expect(Array.isArray(await b.api.listBankTransactions({ matched: false }))).toBe(true);
  });

  it("reviews a report: accepting it makes the tranche it releases due", async () => {
    const requirements = await b.api.listRequirements(b.awardId);
    const interim = requirements.find((r) => r.releasesTrancheId === b.t2)!;
    expect(interim).toMatchObject({ awardId: b.awardId, type: "report", title: "Interim report", status: "submitted", submissionId: b.submissionId });
    expect(interim.dueAt).toMatch(ISO);
    const owed = await b.api.listDueRequirements();
    expect(owed.find((r) => r.id === interim.id)).toMatchObject({ award: { id: b.awardId }, recipient: { name: "Alder Creek Family Services" } });

    const received = await b.api.listSubmissions();
    expect(received.find((s) => s.id === b.submissionId)).toMatchObject({ status: "submitted", shared: false, requirement: { title: "Interim report" } });
    const sub = await b.api.getSubmission(b.submissionId);
    expect(sub.formResponses[0]).toMatchObject({ formId: expect.stringMatching(/^frm_/), formVersion: 1, response: expect.any(Object), provenance: expect.any(Object) });

    const accepted = await b.api.acceptSubmission(b.submissionId);
    expect(accepted).toMatchObject({ status: "accepted", trancheDue: b.t2 });
    expect((await b.api.listTranches({ awardId: b.awardId })).find((t) => t.id === b.t2)?.status).toBe("due");
    expect((await failure(b.api.acceptSubmission(b.submissionId))).status).toBe(409);
  });

  it("holds, lifts and cancels a tranche through the machine", async () => {
    expect(await b.api.holdTranche(b.t2, "Waiting on the site visit")).toMatchObject({ id: b.t2, status: "held", holdReason: "manual" });
    expect(await b.api.releaseHold(b.t2)).toMatchObject({ status: "due", holdReason: null });
    expect(await b.api.cancelTranche(b.t2, "Scope reduced")).toMatchObject({ status: "cancelled" });
  });

  it("releases a tranche through Passport and reads the disbursed amount back", async () => {
    const out = await b.api.releaseTranche(b.t1, { rail: "auto" });
    expect(out).toMatchObject({ result: "accepted", tranche: { id: b.t1, status: "initiated", mode: "facilitated" } });
    expect(out.tranche.passportDisbursementId).toEqual(expect.any(String));
    expect((await b.api.listTranches({ view: "in-flight" })).map((t) => t.id)).toContain(b.t1);
    await b.settle();
    const schedule = await b.api.getSchedule(b.awardId);
    expect(schedule.tranches.find((t) => t.id === b.t1)?.status).toBe("settled");
    expect(schedule.disbursedAmountMinor).toBe(7_500_000);
    expect(schedule.disbursedAsOf).toMatch(ISO);
  });

  it("reads budgets and variance", async () => {
    const book = await b.api.getBudget(b.awardId);
    expect(book).toMatchObject({ awardId: b.awardId, currency: "USD", awardedAmountMinor: 15_000_000 });
    const put = await b.api.putBudget(b.awardId, { kind: "approved", lines: [{ category: "personnel", label: "Personnel", amountMinor: 9_600_000 }, { category: "travel", label: "Travel", amountMinor: 5_400_000 }] });
    expect(put).toMatchObject({ kind: "approved", totalMinor: 15_000_000, lines: [{ category: "personnel", label: "Personnel", amountMinor: 9_600_000 }, { category: "travel" }] });
    expect((await b.api.getBudget(b.awardId)).approved).toMatchObject({ totalMinor: 15_000_000 });
    expect((await failure(b.api.putBudget(b.awardId, { kind: "actual", lines: [{ category: "personnel", label: "Personnel", amountMinor: 100 }], periodStart: "2027-07-01", periodEnd: "2027-09-30" }))).status).toBe(403);
    const variance = await b.api.getVariance(b.awardId);
    expect(variance).toMatchObject({ hasApprovedBudget: true, totals: { approvedMinor: 15_000_000, actualMinor: expect.any(Number), over: expect.any(Boolean) } });
    expect(variance.categories[0]).toMatchObject({ category: expect.any(String), approvedMinor: expect.any(Number), varianceMinor: expect.any(Number) });
  });

  it("keeps a grantee directory with the funder's own notes and tags", async () => {
    const list = await b.api.listGrantees();
    const alder = list.find((g) => g.workspaceId === b.granteeWorkspaceId)!;
    expect(alder).toMatchObject({ name: "Alder Creek Family Services", handle: expect.any(String), payee: { active: expect.any(Boolean), pendingDestinationChange: false }, awards: expect.any(Number), pendingChanges: expect.any(Number) });
    expect((await b.api.listGrantees({ q: "alder" })).map((g) => g.workspaceId)).toContain(b.granteeWorkspaceId);
    const detail = await b.api.getGrantee(b.granteeWorkspaceId);
    expect(detail).toMatchObject({ workspaceId: b.granteeWorkspaceId, consent: expect.any(Boolean), awardList: expect.any(Array), applicationList: expect.any(Array), orgChanges: expect.any(Array) });
    expect(detail.awardList[0]).toMatchObject({ id: expect.stringMatching(/^awd_/), title: expect.any(String), status: expect.any(String) });
    const updated = await b.api.updateGrantee(b.granteeWorkspaceId, { tags: ["rural health"], notes: "Ask about the van route." });
    expect(updated).toMatchObject({ tags: ["rural health"], notes: "Ask about the van route." });
    for (const c of await b.api.listOrgChanges()) expect(c).toMatchObject({ id: expect.any(String), status: expect.any(String), receivedAt: expect.stringMatching(ISO) });
  });

  it("reports the portfolio, a cycle, the 990-PF list and a CSV dry run", async () => {
    const p = await b.api.portfolio();
    expect(p).toMatchObject({ asOf: expect.stringMatching(ISO), totals: { committedMinor: expect.any(Number), paidMinor: expect.any(Number), awards: expect.any(Number) }, programs: expect.any(Array), applications: expect.any(Object), reporting: expect.any(Object), payments: expect.any(Object) });
    expect(p.programs[0]).toMatchObject({ name: expect.any(String), committedMinor: expect.any(Number), paidMinor: expect.any(Number), committedNotPaidMinor: expect.any(Number), overBudgetMinor: expect.any(Number) });
    const cycle = await b.api.cycleReport(b.competitionId);
    expect(cycle).toMatchObject({ competitionId: b.competitionId, title: expect.any(String), started: expect.any(Number), submitted: expect.any(Number), stages: expect.any(Array), byStatus: expect.any(Object), eligibility: expect.any(Object), byLevel: expect.any(Object), requestedMinor: expect.any(Number), awardedMinor: expect.any(Number) });
    const list = await b.api.grantList990(2027);
    expect(list).toMatchObject({ year: 2027, totals: { paidMinor: expect.any(Number), approvedForFuturePaymentMinor: expect.any(Number) } });
    expect(list.items.find((i) => i.awardId === b.awardId)).toMatchObject({ recipientName: "Alder Creek Family Services", purpose: expect.any(String), paidMinor: expect.any(Number) });
    expect((await b.api.grantList990Csv(2027)).size).toBeGreaterThan(0);
    const dry = await b.api.importAwardsCsv({ csv: "Org,Grant,Amount\nAlder Creek Family Services,Van route,50000", mapping: { recipientName: "Org", title: "Grant", awardedAmount: "Amount" }, dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, rows: 1, created: 0, failed: 0 });
    expect(dry.results[0]).toMatchObject({ row: expect.any(Number), ok: true });
    expect(await b.api.exportBundle()).toMatchObject({ files: expect.any(Array), counts: expect.any(Object) });
  });

  it("administers webhooks, API clients, MCP servers, connectors and the ledger", async () => {
    const hook = await b.api.createWebhook({ url: "https://hooks.example/gms", events: ["tranche.due"] });
    expect(hook).toMatchObject({ url: "https://hooks.example/gms", events: ["tranche.due"], active: true, secret: expect.any(String) });
    const listed = (await b.api.listWebhooks()).find((w) => w.id === hook.id)!;
    expect(listed).not.toHaveProperty("secret");
    expect(Array.isArray(await b.api.listWebhookDeliveries(hook.id))).toBe(true);
    await b.api.deleteWebhook(hook.id);
    expect((await b.api.listWebhooks()).map((w) => w.id)).not.toContain(hook.id);

    const client = await b.api.createApiClient({ name: "Finance export", scopes: ["awards:read"] });
    expect(client).toMatchObject({ name: "Finance export", scopes: ["awards:read"], clientId: expect.any(String), clientSecret: expect.any(String), revokedAt: null });
    expect((await b.api.listApiClients()).find((c) => c.id === client.id)).not.toHaveProperty("clientSecret");
    await b.api.revokeApiClient(client.id);
    expect((await b.api.listApiClients()).find((c) => c.id === client.id)?.revokedAt ?? "revoked-and-hidden").toEqual(expect.any(String));

    for (const c of await b.api.listMcpConnections()) expect(c).toMatchObject({ clientId: expect.any(String), scopes: expect.any(Array), mine: expect.any(Boolean) });
    for (const s of await b.api.listMcpServers()) expect(s).toMatchObject({ name: expect.any(String), url: expect.any(String), allowedTools: expect.any(Array), readOnly: true });
    expect(await b.api.getConnector("mercury")).toMatchObject({ provider: "mercury", connected: expect.any(Boolean), status: expect.any(String) });
    // Whether Google Workspace is configured is a property of the installation; the shape is what the screen reads.
    expect(await b.api.getConnector("google_workspace")).toMatchObject({ provider: "google_workspace", connected: expect.any(Boolean), status: expect.any(String), scopes: expect.any(Array) });

    const ledger = await b.api.listLedger({ pageSize: 10 });
    expect(ledger.total).toBeGreaterThan(0);
    expect(ledger.items[0]).toMatchObject({ actor: expect.any(String), eventType: expect.any(String), subjectType: expect.any(String), subjectId: expect.any(String), occurredAt: expect.stringMatching(ISO) });
    expect((await b.api.listLedger({ subjectType: "tranche" })).items.every((e) => e.subjectType === "tranche")).toBe(true);

    expect(await b.api.updateMemberRole(b.workspaceId, b.memberUserId, "finance")).toMatchObject({ userId: b.memberUserId, role: "finance" });
    expect((await b.api.listMembers(b.workspaceId)).find((m) => m.userId === b.memberUserId)?.role).toBe("finance");
  });

  it("reads who holds each section of an application", async () => {
    for (const f of await b.api.applicationSections(b.applicationId)) expect(f).toMatchObject({ formId: expect.stringMatching(/^frm_/), stage: expect.any(String), sections: expect.any(Object) });
  });
});
