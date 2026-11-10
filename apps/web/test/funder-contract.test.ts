// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// The funder working routes (api/funder.ts), one scenario on two backends: the web HTTP client
// against the real API Worker in-process, and the in-browser mock. The assertions are the fields
// the funder screens read, so a path, verb, body field or response shape that drifts fails here.
import { beforeAll, describe, expect, it } from "vitest";
import { ApiError, type GmsApi } from "../src/api/client.ts";
import type { ReviewAssignment } from "../src/api/funder.ts";
import type { RubricCriterion } from "../src/api/types.ts";
import { createMockApi } from "../src/mocks/api.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_IDS, USERS } from "../src/mocks/funder.ts";
import { IDS, seedStore } from "../src/mocks/store.ts";
import { httpApiFor, loadApi, type ApiHarness } from "./api-harness.ts";

interface Backend {
  /** A funder admin. */
  api: GmsApi;
  /** The reviewer who will score (the same person in the mock). */
  reviewer: GmsApi;
  reviewerUserId: string;
  adminUserId: string;
  competitionId: string;
  stage: string;
  applicationId: string;
  applicantName: string;
}

const HEX = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const prefixed = (prefix: string) => new RegExp(`^${prefix}_${HEX}$`);
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

interface Scenario {
  applicant: Record<string, string>;
  compId: string;
  uuid: { comp: string; loi: string };
  call: (who: Record<string, string>, method: string, path: string, body?: unknown) => Promise<{ status: number; body: { data: { id: string } } }>;
}

async function realBackend(): Promise<Backend> {
  const helpers = await loadApi();
  const more = (await import(/* @vite-ignore */ new URL("../../api/test/helpers.ts", import.meta.url).href)) as { USER_OFFICER: string };
  const { scenario } = (await import(/* @vite-ignore */ new URL("../../api/test/scenario.ts", import.meta.url).href)) as { scenario: (h: ApiHarness) => Promise<Scenario> };
  const h = await helpers.harness();
  const s = await scenario(h);
  // The applicant starts, fills and submits the letter of intent through the protocol routes.
  const started = await s.call(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
  const id = started.body.data.id;
  await s.call(s.applicant, "PUT", `/common-grants/applications/${id}/forms/${s.uuid.loi}`, { response: { projectTitle: "Mobile Health Navigation for Rural Families", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel 46 miles to reach primary care." } });
  const done = await s.call(s.applicant, "PUT", `/common-grants/applications/${id}/submit`);
  expect(done.status).toBe(200);
  const api = httpApiFor(helpers, h, helpers.USER_ADMIN);
  const reviewer = httpApiFor(helpers, h, more.USER_OFFICER, "officer@riverbendcf.example");
  await api.workspace("riverbend");
  await reviewer.workspace("riverbend");
  return { api, reviewer, reviewerUserId: more.USER_OFFICER, adminUserId: helpers.USER_ADMIN, competitionId: s.compId, stage: "loi", applicationId: `app_${id}`, applicantName: "Alder Creek Family Services" };
}

async function mockBackend(): Promise<Backend> {
  const api = createMockApi({ session: async () => demoSession(), store: seedStore() });
  await api.workspace("riverbend");
  return { api, reviewer: api, reviewerUserId: USERS.dana, adminUserId: USERS.dana, competitionId: IDS.compHealth27, stage: "full", applicationId: MOCK_IDS.copper, applicantName: "Copper Valley Clinic" };
}

describe.each([
  ["the API Worker over HTTP", realBackend],
  ["the mock API", mockBackend],
])("FunderApi contract: %s", (_name, make) => {
  let b: Backend;
  let assignment: ReviewAssignment;
  let awardId: string;
  let agreementId: string;

  beforeAll(async () => {
    b = await make();
  });

  it("lists the inbox with counts and filters", async () => {
    const page = await b.api.listApplications({ competitionId: b.competitionId, sortBy: "title", sortOrder: "asc", page: 1, pageSize: 25 });
    expect(page.total).toBeGreaterThan(0);
    const row = page.items.find((a) => a.id === b.applicationId)!;
    expect(row.id).toMatch(prefixed("app"));
    expect(row.competitionId).toMatch(prefixed("cmp"));
    expect(row.applicant.name).toBe(b.applicantName);
    expect(row.stage).toBe(b.stage);
    expect(typeof row.requestedAmountMinor).toBe("number");
    expect([true, false, "unknown"]).toContain(row.eligibility);
    expect(Array.isArray(row.tags)).toBe(true);
    expect(page.counts[row.status]).toBeGreaterThan(0);
    expect((await b.api.listApplications({ status: "withdrawn" })).items).toEqual([]);
    expect((await b.api.listApplications({ stage: b.stage, eligibility: String(row.eligibility) })).items.some((a) => a.id === b.applicationId)).toBe(true);
  });

  it("reads one application with responses, eligibility and the timeline", async () => {
    const a = await b.api.getApplication(b.applicationId);
    expect(a.title.length).toBeGreaterThan(0);
    const r = a.formResponses![0]!;
    expect(r.formId).toMatch(prefixed("frm"));
    expect(typeof r.formVersion).toBe("number");
    expect(typeof r.response).toBe("object");
    expect(typeof r.provenance).toBe("object");
    expect(Array.isArray(r.masked)).toBe(true);
    expect(Array.isArray(a.eligibilityResults!.results)).toBe(true);
    expect(a.timeline!.length).toBeGreaterThan(0);
    expect(a.timeline![0]!.at).toMatch(ISO);
    expect(a.organization === null || typeof a.organization === "object").toBe(true);
    const rerun = await b.api.rerunEligibility(b.applicationId);
    expect([true, false, "unknown"]).toContain(rerun.eligible);
  });

  it("tags, assigns and bulk-tags", async () => {
    expect((await b.api.tagApplication(b.applicationId, { add: ["contract"] })).tags).toContain("contract");
    expect((await b.api.assignApplication(b.applicationId, b.adminUserId)).assignedToUserId).toBe(b.adminUserId);
    const bulk = await b.api.bulkApplications({ applicationIds: [b.applicationId], action: "tag", params: { add: ["bulk"] } });
    expect(bulk).toMatchObject({ action: "tag", requested: 1, failed: [] });
    expect(bulk.succeeded).toHaveLength(1);
    expect((await b.api.getApplication(b.applicationId)).tags).toEqual(expect.arrayContaining(["contract", "bulk"]));
    expect((await b.api.tagApplication(b.applicationId, { remove: ["bulk"] })).tags).not.toContain("bulk");
  });

  it("refuses an advance to a stage that does not follow, and an empty revision request", async () => {
    expect([409, 422]).toContain((await failure(b.api.advanceApplication(b.applicationId, { toStage: "no-such-stage" }))).status);
    expect([400, 422]).toContain((await failure(b.api.requestRevision(b.applicationId, { message: " " }))).status);
  });

  it("keeps a shared thread and an internal one", async () => {
    const shared = await b.api.openThread(b.applicationId, "shared");
    const internal = await b.api.openThread(b.applicationId, "internal");
    expect(shared.visibility).toBe("shared");
    expect(internal.visibility).toBe("funder_internal");
    expect(typeof (await b.api.postMessage(shared.id, "A question about the budget.")).id).toBe("string");
    const threads = await b.api.listThreads(b.applicationId);
    const mine = threads.find((t) => t.id === shared.id)!;
    expect(mine.messages.at(-1)).toMatchObject({ body: "A question about the budget." });
    expect(typeof mine.messages.at(-1)!.author).toBe("string");
    expect(Array.isArray(await b.api.listTasks({ open: true, mine: true }))).toBe(true);
  });

  it("assigns a reviewer, who declares no conflict and scores", async () => {
    assignment = await b.api.createAssignment({ applicationId: b.applicationId, reviewerUserId: b.reviewerUserId, stage: b.stage });
    expect(assignment).toMatchObject({ applicationId: b.applicationId, reviewerUserId: b.reviewerUserId, status: "assigned", stage: b.stage, review: null });
    expect((await failure(b.api.createAssignment({ applicationId: b.applicationId, reviewerUserId: b.reviewerUserId }))).status).toBe(409);
    expect((await b.api.listAssignments({ applicationId: b.applicationId })).map((a) => a.id)).toContain(assignment.id);
    expect((await b.api.listAssignments({ reviewerUserId: b.reviewerUserId })).map((a) => a.id)).toContain(assignment.id);

    // Scoring before the declaration is refused.
    expect((await failure(b.reviewer.updateAssignment(assignment.id, { action: "save", scores: {} }))).status).toBe(409);
    expect((await b.reviewer.updateAssignment(assignment.id, { action: "declare_coi", hasConflict: false })).status).toBe("coi_declared");
    const detail = await b.reviewer.getAssignment(assignment.id);
    const criteria = detail.rubric.criteria as RubricCriterion[];
    expect(criteria.length).toBeGreaterThan(0);
    expect(detail.application).not.toBeNull();
    expect(detail.myReview).toBeNull();
    const incomplete = await failure(b.reviewer.updateAssignment(assignment.id, { action: "submit" }));
    expect(incomplete.status).toBe(422);
    const scores = Object.fromEntries(criteria.map((c) => [c.key, c.scale.type === "numeric" ? c.scale.max : c.scale.options[0]!.value]));
    expect((await b.reviewer.updateAssignment(assignment.id, { action: "save", scores })).status).toBe("in_progress");
    const done = await b.reviewer.updateAssignment(assignment.id, { action: "submit", scores, narrative: "Reviewed.", recommendation: "Fund" });
    expect(done.status).toBe("submitted");
    expect(done.review!.overall).toBe(100);
    expect((await b.reviewer.getAssignment(assignment.id)).myReview).toMatchObject({ narrative: "Reviewed." });
  });

  it("lists reviews and ranks the stage", async () => {
    const reviews = await b.api.listReviews(b.applicationId, b.stage);
    expect(reviews.find((r) => r.assignmentId === assignment.id)).toMatchObject({ reviewerUserId: b.reviewerUserId, overall: 100 });
    const ranking = await b.api.getRanking(b.competitionId, b.stage);
    expect(ranking.stage).toBe(b.stage);
    expect(typeof ranking.rubric.name).toBe("string");
    const row = ranking.items.find((r) => r.applicationId === b.applicationId)!;
    expect(row).toMatchObject({ n: 1, mean: 100, median: 100, spreadFlag: false, applicant: b.applicantName, pending: 0 });
    expect(typeof row.rank).toBe("number");
    expect(row.decision).toBeNull();
  });

  it("meters the allocation, proposes and commits a decision", async () => {
    const before = await b.api.getAllocation(b.competitionId);
    expect(typeof before.committedMinor).toBe("number");
    expect(typeof before.over).toBe("boolean");
    expect(before.budgetMinor === null || typeof before.budgetMinor === "number").toBe(true);
    const proposed = await b.api.proposeDecisions(b.competitionId, [{ applicationId: b.applicationId, outcome: "approve", amountMinor: 9_000_000 }]);
    expect(proposed.decisions[0]).toMatchObject({ applicationId: b.applicationId, outcome: "approve", amountMinor: 9_000_000, committedAt: null });
    expect(proposed.allocation.proposedMinor).toBe(before.proposedMinor + 9_000_000);
    expect((await b.api.listDecisions({ competitionId: b.competitionId, committed: false })).map((d) => d.id)).toContain(proposed.decisions[0]!.id);
    expect((await b.api.getRanking(b.competitionId, b.stage)).items.find((r) => r.applicationId === b.applicationId)!.decision).toMatchObject({ outcome: "approve", committed: false });

    const committed = await b.api.commitDecisions({ competitionId: b.competitionId, decisionIds: [proposed.decisions[0]!.id] });
    expect(committed.committed).toBe(1);
    const result = committed.results[0]!;
    expect(result).toMatchObject({ ok: true, outcome: "approve", applicationId: b.applicationId });
    expect(result.awardId).toMatch(prefixed("awd"));
    expect(result.agreementId).toMatch(prefixed("agr"));
    awardId = result.awardId!;
    agreementId = result.agreementId!;
    expect((await b.api.getApplication(b.applicationId)).status).toBe("accepted");
    expect((await failure(b.api.declineApplication(b.applicationId, { sendLetter: false }))).status).toBe(409);
  });

  it("reads the award and walks the agreement to sent", async () => {
    const awards = await b.api.listAwards();
    expect(awards.find((a) => a.id === awardId)).toMatchObject({ status: "offered", awardedAmountMinor: 9_000_000 });
    const award = await b.api.getAward(awardId);
    expect(award.recipient!.name).toBe(b.applicantName);
    expect(award.agreement).toMatchObject({ id: agreementId, status: "draft" });
    expect(Array.isArray(award.tranches)).toBe(true);
    expect(Array.isArray(award.amendments)).toBe(true);
    expect(["synced", "pending", "not_applicable", "disabled"]).toContain(award.passport.mirror);
    expect((await failure(b.api.createAgreement(awardId))).status).toBe(409);

    const sent = await b.api.sendAgreement(agreementId);
    expect(sent.status).toBe("sent");
    expect(sent.documentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof sent.letter.sent).toBe("boolean");
    const agreement = await b.api.getAgreement(agreementId);
    expect(agreement).toMatchObject({ status: "sent", granteeSignature: null, funderSignature: null, hasStoredPdf: true });
    const pdf = await b.api.agreementPdf(agreementId);
    expect(pdf.size).toBeGreaterThan(0);
    expect(new TextDecoder().decode(await pdf.slice(0, 4).arrayBuffer())).toBe("%PDF");
    // The funder cannot countersign before the grantee has signed.
    expect((await failure(b.api.countersignAgreement(agreementId, { name: "Dana Ortiz", attest: true }))).status).toBe(409);
  });

  it("lists, creates and renders templates, and reads the send log", async () => {
    const list = await b.api.listTemplates();
    expect(list.builtIn.map((t) => t.id)).toEqual(expect.arrayContaining(["builtin:decline", "builtin:agreement", "builtin:award_letter"]));
    expect(list.builtIn.find((t) => t.id === "builtin:decline")!.fields).toContain("decision.message");
    expect((await b.api.listTemplates("agreement")).builtIn.every((t) => t.kind === "agreement")).toBe(true);
    const created = await b.api.createTemplate({ kind: "email", name: "Contract note", subject: "About {{application.title}}", body: "Dear {{recipient.name}},\n\n{{funder.name}} has a note about “{{application.title}}”." });
    expect(created).toMatchObject({ kind: "email", name: "Contract note", version: 1 });
    expect(created.fields).toEqual(expect.arrayContaining(["recipient.name", "funder.name", "application.title"]));
    const rendered = await b.api.renderTemplate(created.id, { applicationId: b.applicationId });
    expect(rendered.text).toContain(`Dear ${b.applicantName},`);
    expect(rendered.text).toContain("Riverbend Community Foundation has a note");
    expect(rendered.subject).toContain("About ");
    const broken = await b.api.createTemplate({ kind: "email", name: "Contract broken", subject: "Broken", body: "{{no.such.field}}" });
    expect([400, 422]).toContain((await failure(b.api.createTemplate({ kind: "email", name: "No subject", body: "Text" }))).status);
    const decline = await b.api.renderTemplate("builtin:decline", { applicationId: b.applicationId, fields: { decision: { message: "Outside the service area." } } });
    expect(decline.text).toContain("Outside the service area.");
    const refused = await failure(b.api.renderTemplate(broken.id, { applicationId: b.applicationId }));
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.errors)).toContain("no.such.field");
    const log = await b.api.listCommunications();
    expect(Array.isArray(log)).toBe(true);
    for (const c of log) expect(["sent", "failed"]).toContain(c.status);
  });

  it("lists approvals and refuses to decide one that does not exist", async () => {
    const all = await b.api.listApprovals();
    expect(Array.isArray(all)).toBe(true);
    expect(Array.isArray(await b.api.listApprovals("pending"))).toBe(true);
    expect((await failure(b.api.decideApproval("apr_00000000-0000-7000-8000-00000000dead", { approve: true }))).status).toBe(404);
  });

  it("refuses a consent request that carries no signed request", async () => {
    expect((await failure(b.api.consentRequest(""))).status).toBe(400);
  });
});
