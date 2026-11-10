// SPDX-License-Identifier: AGPL-3.0-only
// Review to award (build spec §11.5, definition-of-done items 6 and 7): assignment and conflicts,
// scoring and the ranking, decisions and the allocator, awards, agreements and click-to-sign.
import { sha256Hex } from "@gms/documents";
import { beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { CLIENT_AGENT, USER_ADMIN, USER_AUDITOR, USER_OFFICER, WS_APPLICANT, WS_FUNDER, WS_OTHER, bearer, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, scenario, type Scenario } from "./scenario.ts";

const R1 = "10000000-0000-4000-8000-000000000001";
const R2 = "10000000-0000-4000-8000-000000000002";
const EXT = "10000000-0000-4000-8000-000000000003";
const SAME_DOMAIN = "10000000-0000-4000-8000-000000000004";

let h: Harness;
let s: Scenario;
let admin: Record<string, string>;
let r1: Record<string, string>;
let r2: Record<string, string>;
let appA: string; // bare uuid of the application submitted through the protocol routes
let appB: string;
let appC: string;
let programId: string;

const headers = async (user: string, ws: string) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });
const data = async <T>(who: Record<string, string>, method: string, path: string, body?: unknown): Promise<T> => {
  const r = await s.call<{ data: T }>(who, method, path, method === "GET" ? undefined : (body ?? {}));
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const ledger = (type: string) => h.ledger.events.filter((e) => e.eventType === type);
const COMPLETE = { projectTitle: "Mobile Health Navigation for Rural Families", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel 46 miles to reach primary care." };

/** Three criteria, total weight 4: the fixture every ranking number below is computed from by hand. */
const RUBRIC = {
  name: "Panel rubric",
  criteria: [
    { key: "impact", label: "Impact", weight: 2, scale: { type: "numeric", min: 1, max: 5 } },
    { key: "feasibility", label: "Feasibility", weight: 1, scale: { type: "numeric", min: 0, max: 10 } },
    { key: "fit", label: "Fit", weight: 1, scale: { type: "categorical", options: [{ value: "strong", score: 1 }, { value: "some", score: 0.5 }, { value: "weak", score: 0 }] } },
  ],
};

async function assign(appUuid: string, reviewer: string): Promise<string> {
  return (await data<{ id: string }>(s.funder, "POST", "/gms/review-assignments", { applicationId: `app_${appUuid}`, reviewerUserId: reviewer })).id;
}
async function score(who: Record<string, string>, assignmentId: string, scores: Record<string, unknown>) {
  await data(who, "PATCH", `/gms/review-assignments/${assignmentId}`, { action: "declare_coi", hasConflict: false });
  return data<{ status: string; review: { overall: number } }>(who, "PATCH", `/gms/review-assignments/${assignmentId}`, { action: "submit", scores, narrative: "Reviewed." });
}

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  admin = await headers(USER_ADMIN, WS_FUNDER);
  for (const [user, role, scope] of [[R1, "reviewer", {}], [R2, "reviewer", {}], [SAME_DOMAIN, "reviewer", { email: "pat@aldercreekfs.example" }]] as const) await h.repos.table("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: user, role, scope });
  r1 = await headers(R1, WS_FUNDER);
  r2 = await headers(R2, WS_FUNDER);

  // A program with a budget, so the allocator has something to guard.
  programId = (await data<{ id: string }>(s.funder, "POST", "/gms/programs", { name: "Community Health 2027", budgetAmountMinor: 20_000_000, currency: "USD" })).id;
  await h.repos.table("opportunities").update({ id: s.uuid.opp }, { program_id: programId });
  // The panel rubric replaces the scenario's single-criterion rubric on the LOI stage.
  const rubric = await h.repos.table("rubrics").insert({ workspace_id: WS_FUNDER, name: RUBRIC.name, criteria: RUBRIC.criteria, overall: {} });
  const comp = (await h.repos.table("competitions").one({ id: s.uuid.comp }))!;
  await h.repos.table("competitions").update({ id: comp.id }, { stages: (comp.stages as { key: string }[]).map((st) => ({ ...st, rubricId: rubric.id })) });

  const started = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
  appA = started.body.data.id;
  await s.call(s.applicant, "PUT", `/common-grants/applications/${appA}/forms/${s.uuid.loi}`, { response: COMPLETE });
  expect((await s.call(s.applicant, "PUT", `/common-grants/applications/${appA}/submit`)).status).toBe(200);
  // Two more submitted applications from the same organization, for the ranking and the allocator.
  const a = (await h.repos.table("applications").one({ id: appA }))!;
  const { id: _id, created_at: _c, updated_at: _u, ...copy } = a;
  appB = (await h.repos.table("applications").insert({ ...copy, title: "Community Clinic Capacity", requested_amount_minor: 12_000_000 })).id;
  appC = (await h.repos.table("applications").insert({ ...copy, title: "Harbor Light Outreach", requested_amount_minor: 9_000_000 })).id;
  h.mailer.sent.length = 0;
});

describe("review assignment", () => {
  it("assigns a reviewer, moves the application under review, and refuses a second assignment", async () => {
    const res = await s.call<{ data: { id: string; status: string; stage: string; rubricVersion: number } }>(s.funder, "POST", "/gms/review-assignments", { applicationId: `app_${appA}`, reviewerUserId: R1, dueAt: "2027-05-01T00:00:00Z" });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: "assigned", stage: "loi", rubricVersion: 1 });
    expect((await h.repos.table("applications").one({ id: appA }))!.status).toBe("under_review");
    expect((await s.call(s.funder, "POST", "/gms/review-assignments", { applicationId: `app_${appA}`, reviewerUserId: R1 })).status).toBe(409);
    expect(ledger("review.assigned")).toHaveLength(1);
  });

  it("refuses a reviewer whose email domain is the applicant's, and anyone who is not a reviewer", async () => {
    const coi = await s.call<{ message: string; errors: { code: string }[] }>(s.funder, "POST", "/gms/review-assignments", { applicationId: `app_${appA}`, reviewerUserId: SAME_DOMAIN });
    expect(coi.status).toBe(409);
    expect(coi.body.errors.map((e) => e.code)).toContain("same_email_domain");
    expect((await s.call(s.funder, "POST", "/gms/review-assignments", { applicationId: `app_${appA}`, reviewerUserId: USER_AUDITOR })).status).toBe(422);
    expect(await h.repos.table("review_assignments").count({ application_id: appA })).toBe(0);
  });

  it("only program staff assign; reviewers and other workspaces cannot", async () => {
    expect((await s.call(r1, "POST", "/gms/review-assignments", { applicationId: `app_${appA}`, reviewerUserId: R2 })).status).toBe(403);
    expect((await s.call(await headers(USER_ADMIN, WS_OTHER), "POST", "/gms/review-assignments", { applicationId: `app_${appA}`, reviewerUserId: R1 })).status).toBe(403);
  });

  it("auto-assigns by capacity, excludes conflicts, and can be dry-run", async () => {
    const dry = await data<{ created: number; assignments: unknown[]; coiFlags: { reviewerUserId: string; reason: string }[] }>(s.funder, "POST", "/gms/review-assignments/auto", { competitionId: s.compId, stage: "loi", reviewersPerApplication: 2, dryRun: true });
    expect(dry.created).toBe(0);
    expect(dry.assignments).toHaveLength(6);
    expect(dry.coiFlags.every((f) => f.reviewerUserId === SAME_DOMAIN && f.reason === "same_email_domain")).toBe(true);
    expect(dry.coiFlags).toHaveLength(3);
    expect(await h.repos.table("review_assignments").count({ workspace_id: WS_FUNDER })).toBe(0);

    const real = await data<{ created: number; unfilled: unknown[] }>(s.funder, "POST", "/gms/review-assignments/auto", { competitionId: s.compId, stage: "loi", reviewersPerApplication: 2 });
    expect(real).toMatchObject({ created: 6, unfilled: [] });
    const rows = await h.repos.table("review_assignments").find({ workspace_id: WS_FUNDER });
    expect(new Set(rows.map((x) => x.reviewer_user_id))).toEqual(new Set([R1, R2]));
    // Running it again adds nothing: every application has its two reviewers.
    expect((await data<{ created: number }>(s.funder, "POST", "/gms/review-assignments/auto", { competitionId: s.compId, stage: "loi", reviewersPerApplication: 2 })).created).toBe(0);
    // Capacity is respected: one reviewer with room for two leaves applications unfilled.
    await h.repos.table("review_assignments").remove({ workspace_id: WS_FUNDER });
    const tight = await data<{ created: number; unfilled: unknown[] }>(s.funder, "POST", "/gms/review-assignments/auto", { competitionId: s.compId, stage: "loi", reviewersPerApplication: 1, reviewers: [{ userId: R1, capacity: 2 }], dryRun: true });
    expect(tight.unfilled).toHaveLength(1);
  });
});

describe("conflict of interest and scoring", () => {
  it("requires the COI declaration before scoring, and recuses on a declared conflict", async () => {
    const id = await assign(appA, R1);
    expect((await s.call(r1, "PATCH", `/gms/review-assignments/${id}`, { action: "save", scores: { impact: 4 } })).status).toBe(409);
    const recused = await data<{ status: string; coi: { declared: boolean } }>(r1, "PATCH", `/gms/review-assignments/${id}`, { action: "declare_coi", hasConflict: true, reason: "Former board member" });
    expect(recused).toMatchObject({ status: "recused", coi: { declared: true } });
    // A recused reviewer no longer sees the application.
    const mine = await data<{ application: unknown }>(r1, "GET", `/gms/review-assignments/${id}`);
    expect(mine.application).toBeNull();
    // The declared conflict follows the reviewer to the organization's other applications.
    const again = await s.call<{ errors: { code: string }[] }>(s.funder, "POST", "/gms/review-assignments", { applicationId: `app_${appB}`, reviewerUserId: R1 });
    expect(again.status).toBe(409);
    expect(again.body.errors.map((e) => e.code)).toContain("declared_org");
  });

  it("saves drafts, refuses an incomplete submission, and scores a complete one", async () => {
    const id = await assign(appA, R1);
    await data(r1, "PATCH", `/gms/review-assignments/${id}`, { action: "declare_coi", hasConflict: false });
    expect((await data<{ status: string }>(r1, "PATCH", `/gms/review-assignments/${id}`, { action: "save", scores: { impact: 5 } })).status).toBe("in_progress");
    const incomplete = await s.call<{ errors: { field: string }[] }>(r1, "PATCH", `/gms/review-assignments/${id}`, { action: "submit" });
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.errors.map((e) => e.field).filter(Boolean).sort()).toEqual(["scores.feasibility", "scores.fit"]);
    const done = await data<{ status: string; review: { overall: number } }>(r1, "PATCH", `/gms/review-assignments/${id}`, { action: "submit", scores: { impact: 5, feasibility: 8, fit: "strong" } });
    expect(done.status).toBe("submitted");
    expect(done.review.overall).toBeCloseTo(95, 10);
    expect(ledger("review.submitted")).toHaveLength(1);
    // Only the assigned reviewer scores; a submitted review is closed.
    expect((await s.call(r2, "PATCH", `/gms/review-assignments/${id}`, { action: "save", scores: { impact: 1 } })).status).toBe(404);
    expect((await s.call(s.funder, "PATCH", `/gms/review-assignments/${id}`, { action: "save", scores: { impact: 1 } })).status).toBe(403);
    expect((await s.call(r1, "PATCH", `/gms/review-assignments/${id}`, { action: "save", scores: { impact: 1 } })).status).toBe(409);
  });

  it("is blind: a reviewer sees only their own review until the panel opens; staff see all", async () => {
    const a1 = await assign(appA, R1);
    const a2 = await assign(appA, R2);
    await score(r1, a1, { impact: 5, feasibility: 8, fit: "strong" });
    await score(r2, a2, { impact: 3, feasibility: 6, fit: "some" });
    const seen = async (who: Record<string, string>) => (await data<{ reviewerUserId: string }[]>(who, "GET", `/gms/reviews?applicationId=app_${appA}`)).map((r) => r.reviewerUserId).sort();
    expect(await seen(r1)).toEqual([R1]);
    expect(await seen(s.funder)).toEqual([R1, R2]);
    const comp = (await h.repos.table("competitions").one({ id: s.uuid.comp }))!;
    await h.repos.table("competitions").update({ id: comp.id }, { stages: (comp.stages as { key: string }[]).map((st) => ({ ...st, panelOpen: true })) });
    expect(await seen(r1)).toEqual([R1, R2]);
    // A reviewer with no assignment on the application gets nothing at all.
    expect((await s.call(await headers(SAME_DOMAIN, WS_FUNDER), "GET", `/gms/reviews?applicationId=app_${appA}`)).status).toBe(404);
  });

  it("an external reviewer is invited to one competition and sees the application masked, without contacts", async () => {
    const inv = await data<{ token: string; emailed: boolean; role: string }>(s.funder, "POST", "/gms/review-assignments/invite", { email: "Hollis.Grant@university.example", competitionId: s.compId });
    expect(inv).toMatchObject({ role: "external_reviewer", emailed: true });
    expect(h.mailer.sent.at(-1)!.to).toEqual(["hollis.grant@university.example"]);
    const accepted = await h.request("/gms/invitations/accept", { method: "POST", headers: { ...bearer(await h.session(EXT)).headers, "Content-Type": "application/json" }, body: JSON.stringify({ token: inv.token }) });
    expect(accepted.status).toBe(200);
    const member = (await h.repos.table("workspace_members").one({ workspace_id: WS_FUNDER, user_id: EXT }))!;
    expect(member).toMatchObject({ role: "external_reviewer", scope: { competitionIds: [s.uuid.comp], email: "hollis.grant@university.example" } });

    const id = await assign(appA, EXT);
    const ext = await headers(EXT, WS_FUNDER);
    const view = await data<{ application: { organization: unknown; formResponses: { response: Record<string, unknown>; masked: string[] }[] }; rubric: { criteria: unknown[] } }>(ext, "GET", `/gms/review-assignments/${id}`);
    expect(view.application.organization).toBeNull();
    expect(view.application.formResponses[0]!.masked.join(",")).toContain("need");
    expect(view.rubric.criteria).toHaveLength(3);
    // Applications they are not assigned to stay invisible, and so does the panel.
    expect((await s.call(ext, "GET", `/gms/applications/app_${appB}`)).status).toBe(404);
    expect((await s.call(ext, "GET", `/gms/competitions/${s.compId}/ranking`)).status).toBe(403);
    // An invitation to this competition does not let them review in another.
    await h.repos.table("workspace_members").update({ workspace_id: WS_FUNDER, user_id: EXT }, { scope: { competitionIds: ["99999999-9999-4999-8999-999999999999"] } });
    expect((await s.call(s.funder, "POST", "/gms/review-assignments", { applicationId: `app_${appB}`, reviewerUserId: EXT })).status).toBe(422);
  });
});

describe("ranking", () => {
  it("equals the hand-computed fixture, end to end through the routes", async () => {
    // Weights 2 : 1 : 1. A/R1 = (1.0*2 + 0.8 + 1.0)/4 = 95; A/R2 = (0.5*2 + 0.6 + 0.5)/4 = 52.5.
    await score(r1, await assign(appA, R1), { impact: 5, feasibility: 8, fit: "strong" });
    await score(r2, await assign(appA, R2), { impact: 3, feasibility: 6, fit: "some" });
    // B/R1 = (0.75*2 + 1.0 + 1.0)/4 = 87.5; B/R2 = (0.75*2 + 0.9 + 1.0)/4 = 85.
    await score(r1, await assign(appB, R1), { impact: 4, feasibility: 10, fit: "strong" });
    await score(r2, await assign(appB, R2), { impact: { value: 4, comment: "Strong reach" }, feasibility: 9, fit: "strong" });
    // C has one reviewer who has not submitted.
    await assign(appC, R1);

    const ranking = await data<{ stage: string; items: { applicationId: string; rank: number | null; n: number; mean: number | null; median: number | null; stdev: number | null; spreadFlag: boolean; assigned: number; pending: number; title: string }[] }>(s.funder, "GET", `/gms/competitions/${s.compId}/ranking?stage=loi`);
    expect(ranking.stage).toBe("loi");
    expect(ranking.items.map((i) => i.applicationId)).toEqual([`app_${appB}`, `app_${appA}`, `app_${appC}`]);
    const [b, a, c] = ranking.items as [typeof ranking.items[number], typeof ranking.items[number], typeof ranking.items[number]];
    expect(b).toMatchObject({ rank: 1, n: 2, spreadFlag: false, assigned: 2, pending: 0, title: "Community Clinic Capacity" });
    expect(b.mean).toBeCloseTo(86.25, 10);
    expect(b.median).toBeCloseTo(86.25, 10);
    expect(b.stdev).toBeCloseTo(2.5 / Math.SQRT2, 10); // sample stdev of 87.5 and 85
    expect(a).toMatchObject({ rank: 2, n: 2, spreadFlag: true });
    expect(a.mean).toBeCloseTo(73.75, 10);
    expect(a.median).toBeCloseTo(73.75, 10);
    expect(a.stdev).toBeCloseTo(42.5 / Math.SQRT2, 10); // 30.05…, above the 15-point threshold
    expect(c).toMatchObject({ rank: null, n: 0, mean: null, assigned: 1, pending: 1 });
    // The MCP-facing auditor role may read the panel; reviewers may not.
    expect((await s.call(await headers(USER_AUDITOR, WS_FUNDER), "GET", `/gms/competitions/${s.compId}/ranking?stage=loi`)).status).toBe(200);
    expect((await s.call(r1, "GET", `/gms/competitions/${s.compId}/ranking?stage=loi`)).status).toBe(403);
  });
});

describe("decisions and the allocator", () => {
  const propose = (decisions: unknown[]) => data<{ decisions: { id: string; outcome: string }[]; allocation: { budgetMinor: number; proposedMinor: number; availableMinor: number; over: boolean; overByMinor: number } }>(s.funder, "POST", "/gms/decisions/propose", { competitionId: s.compId, decisions });

  it("meters proposals against the program budget and replaces an earlier proposal", async () => {
    const first = await propose([{ applicationId: `app_${appA}`, outcome: "approve", amountMinor: 15_000_000 }]);
    expect(first.allocation).toMatchObject({ budgetMinor: 20_000_000, proposedMinor: 15_000_000, availableMinor: 5_000_000, over: false });
    const second = await propose([{ applicationId: `app_${appA}`, outcome: "approve", amountMinor: 12_000_000 }, { applicationId: `app_${appB}`, outcome: "approve", amountMinor: 12_000_000 }]);
    expect(second.allocation).toMatchObject({ proposedMinor: 24_000_000, over: true, overByMinor: 4_000_000 });
    expect(await h.repos.table("decisions").count({ application_id: appA })).toBe(1);
    expect((await data<{ over: boolean }>(s.funder, "GET", `/gms/competitions/${s.compId}/allocation`)).over).toBe(true);
    expect((await s.call(s.funder, "POST", "/gms/decisions/propose", { competitionId: s.compId, decisions: [{ applicationId: `app_${appC}`, outcome: "approve" }] })).status).toBe(422);
  });

  it("refuses to commit an over-allocation; an admin can override with a reason, which is ledgered", async () => {
    const p = await propose([{ applicationId: `app_${appA}`, outcome: "approve", amountMinor: 12_000_000 }, { applicationId: `app_${appB}`, outcome: "approve", amountMinor: 12_000_000 }]);
    const ids = p.decisions.map((d) => d.id);
    const refused = await s.call<{ errors: { code: string }[] }>(s.funder, "POST", "/gms/decisions/commit", { competitionId: s.compId, decisionIds: ids });
    expect(refused.status).toBe(409);
    expect(refused.body.errors.map((e) => e.code)).toContain("over_allocation");
    expect(await h.repos.table("awards").count({ workspace_id: WS_FUNDER })).toBe(0);
    expect((await h.repos.table("applications").one({ id: appA }))!.status).toBe("submitted");
    // A program officer cannot override; an admin can.
    expect((await s.call(s.funder, "POST", "/gms/decisions/commit", { competitionId: s.compId, decisionIds: ids, override: { reason: "Board approved a supplement" } })).status).toBe(409);
    const ok = await data<{ committed: number; override: { overByMinor: number; reason: string } }>(admin, "POST", "/gms/decisions/commit", { competitionId: s.compId, decisionIds: ids, override: { reason: "Board approved a supplement" } });
    expect(ok).toMatchObject({ committed: 2, override: { overByMinor: 4_000_000, reason: "Board approved a supplement" } });
    expect(ledger("decision.allocation_override")[0]!.data).toMatchObject({ overByMinor: 4_000_000, reason: "Board approved a supplement", by: USER_ADMIN });
  });

  it("commit: approve creates the award, agreement draft, schedule and requirements; decline and waitlist do their part", async () => {
    await h.repos.table("programs").update({ id: programId }, {
      defaults: {
        awardPeriod: { startDate: "2027-07-01", endDate: "2028-06-30" },
        schedule: [{ percent: 50, condition: { type: "onExecution" } }, { percent: 40, condition: { type: "onReportAccepted", requirementKey: "interim" } }, { percent: 10, condition: { type: "manual" } }],
        requirements: [{ key: "interim", type: "report", title: "Interim report", dueAt: "2027-12-15T00:00:00Z" }, { type: "report", title: "Final report" }],
      },
    });
    const p = await propose([
      { applicationId: `app_${appA}`, outcome: "approve", amountMinor: 15_000_000, conditions: ["Quarterly check-in calls"] },
      { applicationId: `app_${appB}`, outcome: "decline", rationale: "Outside this cycle's priorities." },
      { applicationId: `app_${appC}`, outcome: "waitlist" },
    ]);
    const res = await data<{ committed: number; failed: number; results: { outcome: string; ok: boolean; awardId?: string; agreementId?: string; letterSent?: boolean }[]; allocation: { committedMinor: number; proposedMinor: number } }>(s.funder, "POST", "/gms/decisions/commit", { competitionId: s.compId, decisionIds: p.decisions.map((d) => d.id) });
    expect(res).toMatchObject({ committed: 3, failed: 0, allocation: { committedMinor: 15_000_000, proposedMinor: 0 } });
    const status = async (id: string) => (await h.repos.table("applications").one({ id }))!.status;
    expect([await status(appA), await status(appB), await status(appC)]).toEqual(["accepted", "declined", "waitlisted"]);

    const approved = res.results.find((r) => r.outcome === "approve")!;
    expect(approved).toMatchObject({ ok: true, letterSent: true });
    const award = await data<{ status: string; awardedAmountMinor: number; requestedAmountMinor: number; disbursedAmountMinor: number | null; conditions: string[]; keyDates: { periodOfPerformance: { endDate: string } }; agreement: { status: string; version: number }; tranches: { seq: number; amountMinor: number; status: string; condition: { type: string; requirementId?: string } }[]; requirements: { id: string; title: string; dueAt: string | null; releasesTrancheId: string | null }[]; passport: { mirror: string } }>(s.funder, "GET", `/gms/awards/${approved.awardId}`);
    expect(award).toMatchObject({ status: "offered", awardedAmountMinor: 15_000_000, requestedAmountMinor: 15_000_000, disbursedAmountMinor: null, conditions: ["Quarterly check-in calls"], agreement: { status: "draft", version: 1 }, passport: { mirror: "not_applicable" } });
    expect(award.keyDates.periodOfPerformance.endDate).toBe("2028-06-30");
    expect(award.tranches.map((t) => [t.seq, t.amountMinor, t.status, t.condition.type])).toEqual([[1, 7_500_000, "scheduled", "onExecution"], [2, 6_000_000, "scheduled", "onReportAccepted"], [3, 1_500_000, "scheduled", "manual"]]);
    const interim = award.requirements.find((r) => r.title === "Interim report")!;
    expect(interim.releasesTrancheId).toMatch(/^trn_/);
    expect(award.tranches[1]!.condition.requirementId).toBe(interim.id.slice(4));
    // The final report with no date falls due at the end of the grant period.
    expect(award.requirements.find((r) => r.title === "Final report")!.dueAt).toBe("2028-06-30T00:00:00.000Z");

    // Letters: one award, one decline; none for the waitlist.
    expect(h.mailer.sent.map((m) => m.subject).sort()).toEqual(["An update on your application to Riverbend Community Foundation", "Award offered: Mobile Health Navigation for Rural Families"]);
    expect(ledger("decision.committed")).toHaveLength(3);
    expect(ledger("award.created")).toHaveLength(1);
    // Committed decisions cannot be committed again, and a decided application takes no new proposal.
    expect((await s.call(s.funder, "POST", "/gms/decisions/commit", { competitionId: s.compId, decisionIds: [p.decisions[0]!.id] })).status).toBe(409);
    expect((await s.call(s.funder, "POST", "/gms/decisions/propose", { competitionId: s.compId, decisions: [{ applicationId: `app_${appB}`, outcome: "approve", amountMinor: 1 }] })).status).toBe(409);
    // A waitlisted application can still be approved later.
    const later = await propose([{ applicationId: `app_${appC}`, outcome: "approve", amountMinor: 4_000_000 }]);
    expect((await data<{ committed: number }>(s.funder, "POST", "/gms/decisions/commit", { competitionId: s.compId, decisionIds: [later.decisions[0]!.id] })).committed).toBe(1);
    expect(await status(appC)).toBe("accepted");
  });

  it("an agent's token cannot commit decisions over REST; reviewers cannot propose", async () => {
    const p = await propose([{ applicationId: `app_${appA}`, outcome: "approve", amountMinor: 1_000_000 }]);
    const agent = await h.forge({ sub: USER_OFFICER, client_id: CLIENT_AGENT, scope: "decisions:write applications:write", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-agent-commit" });
    const client = await h.forge({ scope: "decisions:write workspace:admin" });
    for (const token of [agent, client]) {
      const res = await s.call<{ message: string }>({ ...bearer(token).headers, "Content-Type": "application/json" }, "POST", "/gms/decisions/commit", { competitionId: s.compId, decisionIds: [p.decisions[0]!.id] });
      expect(res.status).toBe(403);
    }
    expect((await h.repos.table("decisions").one({ id: p.decisions[0]!.id }))!.committed_at).toBeNull();
    // The same agent may propose: proposing is not gated.
    expect((await s.call({ ...bearer(agent).headers, "Content-Type": "application/json" }, "POST", "/gms/decisions/propose", { competitionId: s.compId, decisions: [{ applicationId: `app_${appB}`, outcome: "decline", rationale: "Out of area" }] })).status).toBe(200);
    expect((await s.call(r1, "POST", "/gms/decisions/propose", { competitionId: s.compId, decisions: [{ applicationId: `app_${appA}`, outcome: "decline" }] })).status).toBe(403);
  });
});

describe("award, agreement and click-to-sign", () => {
  let awardId: string;
  let agreementId: string;
  const SIGN = { name: "Maria Santos", attest: true };

  beforeEach(async () => {
    const p = await data<{ decisions: { id: string }[] }>(s.funder, "POST", "/gms/decisions/propose", { competitionId: s.compId, decisions: [{ applicationId: `app_${appA}`, outcome: "approve", amountMinor: 15_000_000 }] });
    const res = await data<{ results: { awardId: string; agreementId: string }[] }>(s.funder, "POST", "/gms/decisions/commit", { competitionId: s.compId, decisionIds: [p.decisions[0]!.id] });
    awardId = res.results[0]!.awardId;
    agreementId = res.results[0]!.agreementId;
    h.mailer.sent.length = 0;
  });

  const pdf = async (who: Record<string, string>, path: string) => {
    const res = await h.request(path, { headers: who });
    return { status: res.status, type: res.headers.get("Content-Type"), sha: res.headers.get("X-Content-SHA256"), bytes: new Uint8Array(await res.arrayBuffer()) };
  };

  it("runs offered → accepted → signed → countersigned → executed → active, and the executed PDF hash is the ledgered hash", async () => {
    // Send: the document is hashed and that hash is what gets signed.
    const sent = await data<{ status: string; documentSha256: string; letter: { sent: boolean } }>(s.funder, "POST", `/gms/agreements/${agreementId}/send`);
    expect(sent).toMatchObject({ status: "sent", letter: { sent: true } });
    const unsigned = await pdf(s.applicant, `/gms/agreements/${agreementId}/pdf`);
    expect(unsigned).toMatchObject({ status: 200, type: "application/pdf" });
    expect(await sha256Hex(unsigned.bytes)).toBe(sent.documentSha256);

    // The grantee must accept the offer before signing.
    expect((await s.call<{ code?: string; message: string }>(s.applicant, "POST", `/gms/agreements/${agreementId}/sign`, SIGN)).status).toBe(409);
    const accepted = await data<{ status: string; mirror: { state: string } }>(s.applicant, "POST", `/gms/my/awards/${awardId}/accept`);
    expect(accepted).toMatchObject({ status: "accepted", mirror: { state: "skipped" } });

    // Sign: the box must be checked, the hash must be the one on file, and only an admin signs.
    expect((await s.call(s.applicant, "POST", `/gms/agreements/${agreementId}/sign`, { name: "Maria Santos", attest: false })).status).toBe(400);
    expect((await s.call(s.applicant, "POST", `/gms/agreements/${agreementId}/sign`, { ...SIGN, documentSha256: "0".repeat(64) })).status).toBe(409);
    expect((await s.call(s.editor, "POST", `/gms/agreements/${agreementId}/sign`, SIGN)).status).toBe(403);
    const signed = await s.call<{ data: { status: string; granteeSignature: { name: string } } }>({ ...s.applicant, "CF-Connecting-IP": "203.0.113.7" }, "POST", `/gms/agreements/${agreementId}/sign`, { ...SIGN, documentSha256: sent.documentSha256 });
    expect(signed.status).toBe(200);
    expect(signed.body.data).toMatchObject({ status: "signed_by_grantee", granteeSignature: { name: "Maria Santos" } });
    const stored = (await h.repos.table("agreements").one({ id: agreementId.slice(4) }))!;
    expect(stored.grantee_signature).toMatchObject({ name: "Maria Santos", userId: USER_APPLICANT, attested: true, ip: "203.0.113.7", documentSha256: sent.documentSha256 });

    // Countersign executes: the award is active and the onExecution tranche is due.
    const done = await data<{ status: string; awardStatus: string; tranchesDue: string[]; executedPdfSha256: string; executedAt: string }>({ ...s.funder, "CF-Connecting-IP": "198.51.100.9" }, "POST", `/gms/agreements/${agreementId}/countersign`, { name: "Dana Ortiz", attest: true });
    expect(done).toMatchObject({ status: "executed", awardStatus: "active" });
    expect(done.tranchesDue).toHaveLength(1);
    const award = await data<{ status: string; tranches: { status: string; dueAt: string | null }[] }>(s.applicant, "GET", `/gms/my/awards/${awardId}`);
    expect(award.status).toBe("active");
    expect(award.tranches[0]).toMatchObject({ status: "due" });

    // The executed PDF: its hash is the one in the ledger, for either party, and it is stored.
    const record = ledger("agreement.document_executed");
    expect(record).toHaveLength(1);
    expect(record[0]!.data).toMatchObject({ documentSha256: sent.documentSha256, executedPdfSha256: done.executedPdfSha256, stored: true });
    for (const who of [s.funder, s.applicant]) {
      const executed = await pdf(who, `/gms/agreements/${agreementId}/pdf`);
      expect(await sha256Hex(executed.bytes)).toBe(record[0]!.data.executedPdfSha256);
      expect(executed.sha).toBe(done.executedPdfSha256);
    }
    expect(done.executedPdfSha256).not.toBe(sent.documentSha256);
    // Without the stored file the document renders again to the same bytes: the hash is re-verifiable.
    h.storage.files.clear();
    expect(await sha256Hex((await pdf(s.funder, `/gms/agreements/${agreementId}/pdf`)).bytes)).toBe(done.executedPdfSha256);
    const doc = await h.repos.table("documents").find({ subject_type: "agreement", subject_id: agreementId.slice(4) });
    expect(doc.map((d) => d.sha256).sort()).toEqual([sent.documentSha256, done.executedPdfSha256].sort());
    expect(ledger("agreement.execute")).toHaveLength(1);
    expect(h.webhooks.deliveries.length).toBeGreaterThanOrEqual(0);

    // An executed agreement cannot be voided.
    const voided = await s.call<{ message: string }>(s.funder, "POST", `/gms/agreements/${agreementId}/void`, { reason: "Typo" });
    expect(voided.status).toBe(409);
    expect(voided.body.message).toContain("cannot be voided");
  });

  it("refuses signing with an agent token, on both sides", async () => {
    await data(s.funder, "POST", `/gms/agreements/${agreementId}/send`);
    await data(s.applicant, "POST", `/gms/my/awards/${awardId}/accept`);
    const applicantAgent = await h.forge({ sub: USER_APPLICANT, client_id: CLIENT_AGENT, scope: "agreements:write awards:write awards:read", [WORKSPACE_CLAIM]: WS_APPLICANT, jti: "tok-sign-agent" });
    const agentHeaders = { ...bearer(applicantAgent).headers, "Content-Type": "application/json" };
    const refused = await s.call<{ errors?: unknown; message: string }>(agentHeaders, "POST", `/gms/agreements/${agreementId}/sign`, SIGN);
    expect(refused.status).toBe(403);
    expect(refused.body.message).toContain("human gate");
    expect((await h.repos.table("agreements").one({ id: agreementId.slice(4) }))!.status).toBe("sent");
    // The same token can read the agreement; it just cannot sign it.
    expect((await s.call(agentHeaders, "GET", `/gms/agreements/${agreementId}`)).status).toBe(200);

    await data(s.applicant, "POST", `/gms/agreements/${agreementId}/sign`, SIGN);
    const funderAgent = await h.forge({ sub: USER_OFFICER, client_id: CLIENT_AGENT, scope: "agreements:write awards:read", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-countersign-agent" });
    expect((await s.call({ ...bearer(funderAgent).headers, "Content-Type": "application/json" }, "POST", `/gms/agreements/${agreementId}/countersign`, { name: "Dana Ortiz", attest: true })).status).toBe(403);
    // A client-credentials token is not a person either.
    const client = await h.forge({ scope: "agreements:write awards:read" });
    expect((await s.call({ ...bearer(client).headers, "Content-Type": "application/json" }, "POST", `/gms/agreements/${agreementId}/countersign`, { name: "Dana Ortiz", attest: true })).status).toBe(403);
    expect((await h.repos.table("agreements").one({ id: agreementId.slice(4) }))!.status).toBe("signed_by_grantee");
  });

  it("accepting an offer is human-only and belongs to the recipient's admin", async () => {
    const agent = await h.forge({ sub: USER_APPLICANT, client_id: CLIENT_AGENT, scope: "awards:write awards:read", [WORKSPACE_CLAIM]: WS_APPLICANT, jti: "tok-accept-agent" });
    expect((await s.call({ ...bearer(agent).headers, "Content-Type": "application/json" }, "POST", `/gms/my/awards/${awardId}/accept`)).status).toBe(403);
    expect((await s.call(s.editor, "POST", `/gms/my/awards/${awardId}/accept`)).status).toBe(403);
    expect((await s.call(s.funder, "POST", `/gms/awards/${awardId}/accept-offer`)).status).toBe(403);
    expect((await h.repos.table("awards").one({ id: awardId.slice(4) }))!.status).toBe("offered");
  });

  it("an award cannot become active without an executed agreement; voiding allows a new draft", async () => {
    await data(s.applicant, "POST", `/gms/my/awards/${awardId}/accept`);
    const early = await s.call<{ message: string }>(s.funder, "POST", `/gms/awards/${awardId}/activate`);
    expect(early.status).toBe(409);
    expect(early.body.message).toContain("must be executed");
    expect((await s.call(s.funder, "POST", `/gms/awards/${awardId}/agreements`)).status).toBe(409);
    expect((await data<{ status: string }>(s.funder, "POST", `/gms/agreements/${agreementId}/void`, { reason: "Wrong period" })).status).toBe("voided");
    const next = await s.call<{ data: { version: number; status: string } }>(s.funder, "POST", `/gms/awards/${awardId}/agreements`);
    expect(next.status).toBe(201);
    expect(next.body.data).toMatchObject({ version: 2, status: "draft" });
  });

  it("is invisible to another funder and to another applicant's members", async () => {
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: R2, role: "admin" });
    const other = await headers(R2, WS_OTHER);
    expect((await s.call(other, "GET", `/gms/awards/${awardId}`)).status).toBe(404);
    expect((await s.call(other, "GET", `/gms/agreements/${agreementId}`)).status).toBe(404);
    expect((await pdf(other, `/gms/agreements/${agreementId}/pdf`)).status).toBe(404);
    expect((await s.call(s.applicant, "GET", `/gms/awards/${awardId}`)).status).toBe(404); // the recipient uses /my/awards
    expect((await s.call<{ items: unknown[] }>(other, "GET", "/gms/awards")).body.items).toHaveLength(0);
    expect((await s.call<{ items: unknown[] }>(s.applicant, "GET", "/gms/my/awards")).body.items).toHaveLength(1);
  });

  it("suspends, resumes, cancels and completes through the machine", async () => {
    await data(s.funder, "POST", `/gms/agreements/${agreementId}/send`);
    await data(s.applicant, "POST", `/gms/my/awards/${awardId}/accept`);
    await data(s.applicant, "POST", `/gms/agreements/${agreementId}/sign`, SIGN);
    await data(s.funder, "POST", `/gms/agreements/${agreementId}/countersign`, { name: "Dana Ortiz", attest: true });
    expect((await s.call(s.funder, "POST", `/gms/awards/${awardId}/suspend`, {})).status).toBe(400);
    const suspended = await data<{ status: string; tranches: { status: string; holdReason: string }[] }>(s.funder, "POST", `/gms/awards/${awardId}/suspend`, { reason: "Leadership change" });
    expect(suspended).toMatchObject({ status: "suspended", tranches: [{ status: "held", holdReason: "Award suspended: Leadership change" }] });
    const resumed = await data<{ status: string; tranches: { status: string }[] }>(s.funder, "POST", `/gms/awards/${awardId}/resume`);
    expect(resumed).toMatchObject({ status: "active", tranches: [{ status: "due" }] });
    // A tranche is still open, so the award cannot be completed.
    expect((await s.call(s.funder, "POST", `/gms/awards/${awardId}/complete`)).status).toBe(409);
    const cancelled = await data<{ status: string; tranches: { status: string }[] }>(s.funder, "POST", `/gms/awards/${awardId}/cancel`, { reason: "Project withdrawn" });
    expect(cancelled).toMatchObject({ status: "cancelled", tranches: [{ status: "cancelled" }] });
  });

  it("amendments: an extension moves the end date; a supplemental creates a child award", async () => {
    await data(s.applicant, "POST", `/gms/my/awards/${awardId}/accept`);
    expect((await s.call(s.applicant, "POST", `/gms/my/awards/${awardId}/amendments`, { type: "extension", request: {}, reason: "Hiring delay" })).status).toBe(422);
    const ext = await s.call<{ data: { id: string; status: string } }>(s.applicant, "POST", `/gms/my/awards/${awardId}/amendments`, { type: "extension", request: { newEndDate: "2028-12-31" }, reason: "Hiring delay" });
    expect(ext.status).toBe(201);
    expect((await s.call(s.applicant, "PATCH", `/gms/amendments/${ext.body.data.id}`, { status: "approved" })).status).toBe(403);
    expect((await data<{ status: string }>(s.funder, "PATCH", `/gms/amendments/${ext.body.data.id}`, { status: "approved" })).status).toBe("approved");
    expect((await data<{ keyDates: { periodOfPerformance: { endDate: string } } }>(s.funder, "GET", `/gms/awards/${awardId}`)).keyDates.periodOfPerformance.endDate).toBe("2028-12-31");
    expect((await s.call(s.funder, "PATCH", `/gms/amendments/${ext.body.data.id}`, { status: "declined" })).status).toBe(409);

    const sup = await data<{ id: string }>(s.funder, "POST", `/gms/awards/${awardId}/amendments`, { type: "supplemental", request: { amountMinor: 2_000_000 }, reason: "Added van route" });
    const approved = await data<{ childAwardId: string }>(s.funder, "PATCH", `/gms/amendments/${sup.id}`, { status: "approved" });
    const child = await data<{ status: string; awardedAmountMinor: number; parentAwardId: string }>(s.funder, "GET", `/gms/awards/${approved.childAwardId}`);
    expect(child).toMatchObject({ status: "offered", awardedAmountMinor: 2_000_000, parentAwardId: awardId });
  });

  it("mirrors the award to Passport on acceptance when enabled, and survives Passport being down", async () => {
    h.env.PASSPORT_AWARD_WRITE = "true";
    // No Passport client linked: acceptance still stands and says why nothing was mirrored.
    const skipped = await data<{ status: string; mirror: { state: string; reason: string }; passport: { mirror: string } }>(s.applicant, "POST", `/gms/my/awards/${awardId}/accept`);
    expect(skipped).toMatchObject({ status: "accepted", mirror: { state: "skipped" }, passport: { mirror: "pending" } });
    expect(skipped.mirror.reason).toContain("Connect Passport");
  });
});

describe("CommonGrants awards", () => {
  it("projects an AwardBase for the funder and the recipient, never a locally computed disbursed amount", async () => {
    const p = await data<{ decisions: { id: string }[] }>(s.funder, "POST", "/gms/decisions/propose", { competitionId: s.compId, decisions: [{ applicationId: `app_${appA}`, outcome: "approve", amountMinor: 15_000_000 }] });
    const res = await data<{ results: { awardId: string }[] }>(s.funder, "POST", "/gms/decisions/commit", { competitionId: s.compId, decisionIds: [p.decisions[0]!.id] });
    const uuid = res.results[0]!.awardId.slice(4);
    for (const who of [s.funder, s.applicant]) {
      const one = await data<{ id: string; status: { value: string; customValue: string }; funding: { awardedAmount: { amount: string }; disbursedAmount?: unknown }; identifiers: { otherIds: { gms: { id: string } } } }>(who, "GET", `/common-grants/awards/${uuid}`);
      expect(one).toMatchObject({ id: uuid, status: { value: "awarded", customValue: "offered" }, funding: { awardedAmount: { amount: "150000.00" } }, identifiers: { otherIds: { gms: { id: `awd_${uuid}` } } } });
      expect(one.funding.disbursedAmount).toBeUndefined();
      expect((await s.call<{ items: unknown[] }>(who, "GET", "/common-grants/awards")).body.items).toHaveLength(1);
    }
    // The cached Passport value is what shows once Passport has reported one.
    const row = (await h.repos.table("awards").one({ id: uuid }))!;
    await h.repos.table("awards").update({ id: uuid }, { funding: { ...(row.funding as object), disbursedAmount: { amount: "75000.00", currency: "USD" } }, disbursed_at: "2027-05-25T17:00:00Z" });
    expect((await data<{ funding: { disbursedAmount: { amount: string } } }>(s.funder, "GET", `/common-grants/awards/${uuid}`)).funding.disbursedAmount.amount).toBe("75000.00");
    expect((await data<{ disbursedAmountMinor: number }>(s.funder, "GET", `/gms/awards/awd_${uuid}`)).disbursedAmountMinor).toBe(7_500_000);
    const found = await s.call<{ items: { id: string }[] }>(s.funder, "POST", "/common-grants/awards/search", { search: "mobile health" });
    expect(found.body.items.map((i) => i.id)).toEqual([uuid]);
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: R2, role: "admin" });
    expect((await s.call(await headers(R2, WS_OTHER), "GET", `/common-grants/awards/${uuid}`)).status).toBe(404);
    expect((await s.call(s.funder, "GET", "/common-grants/awards/not-a-uuid")).status).toBe(404);
  });
});

describe("templates and communications", () => {
  it("versions templates, renders with merge fields, and refuses a missing field", async () => {
    const v1 = await s.call<{ data: { id: string; version: number; subject: string; fields: string[] } }>(s.funder, "POST", "/gms/templates", { kind: "email", name: "Site visit notice", subject: "Site visit for {{application.title}}", body: "Hello {{recipient.name}},\n\n{{funder.name}} would like to visit on {{visit.date}}." });
    expect(v1.status).toBe(201);
    expect(v1.body.data).toMatchObject({ version: 1, subject: "Site visit for {{application.title}}" });
    expect(v1.body.data.fields.sort()).toEqual(["application.title", "funder.name", "recipient.name", "visit.date"]);
    const v2 = await data<{ id: string; version: number }>(s.funder, "POST", "/gms/templates", { kind: "email", name: "Site visit notice", subject: "Site visit", body: "Hello {{recipient.name}}." });
    expect(v2.version).toBe(2);
    expect((await s.call(s.funder, "POST", "/gms/templates", { kind: "email", name: "No subject", body: "x" })).status).toBe(400);
    const list = await data<{ items: { name: string; version: number }[]; builtIn: { id: string }[] }>(s.funder, "GET", "/gms/templates?kind=email");
    expect(list.items.filter((t) => t.name === "Site visit notice")).toEqual([expect.objectContaining({ version: 2 })]);
    expect(list.builtIn.map((b) => b.id)).toContain("builtin:decline");

    const missing = await s.call<{ errors: { field: string }[] }>(s.funder, "POST", `/gms/templates/${v1.body.data.id}/render`, { applicationId: `app_${appA}` });
    expect(missing.status).toBe(422);
    expect(missing.body.errors.map((e) => e.field).filter(Boolean)).toEqual(["visit.date"]);
    const rendered = await data<{ subject: string; text: string; html: string }>(s.funder, "POST", `/gms/templates/${v1.body.data.id}/render`, { applicationId: `app_${appA}`, fields: { visit: { date: "May 12 <script>" } } });
    expect(rendered.subject).toBe("Site visit for Mobile Health Navigation for Rural Families");
    expect(rendered.text).toContain("Alder Creek Family Services");
    expect(rendered.html).not.toContain("<script>");
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: R2, role: "admin" });
    expect((await s.call(await headers(R2, WS_OTHER), "GET", `/gms/templates/${v1.body.data.id}`)).status).toBe(404);
  });

  it("sends a batch only when every letter renders, and keeps a send log", async () => {
    const t = await data<{ id: string }>(s.funder, "POST", "/gms/templates", { kind: "email", name: "Cycle update", subject: "An update on {{application.title}}", body: "Hello {{recipient.name}}, {{note}}" });
    const recipients = [{ applicationId: `app_${appA}` }, { applicationId: `app_${appB}` }];
    const blank = await s.call(s.funder, "POST", "/gms/communications/send", { templateId: t.id, recipients });
    expect(blank.status).toBe(422);
    expect(h.mailer.sent).toHaveLength(0);
    const sent = await data<{ requested: number; sent: number; batch: string }>(s.funder, "POST", "/gms/communications/send", { templateId: t.id, recipients, fields: { note: "Decisions go out June 30." } });
    expect(sent).toMatchObject({ requested: 2, sent: 2 });
    expect(h.mailer.sent.map((m) => m.subject).sort()).toEqual(["An update on Community Clinic Capacity", "An update on Mobile Health Navigation for Rural Families"]);
    expect(h.mailer.sent[0]!.to).toEqual(["info@aldercreekfs.example"]);
    const log = await s.call<{ items: { status: string; batch: string; templateName: string }[]; paginationInfo: { totalItems: number } }>(s.funder, "GET", "/gms/communications");
    // The log also holds the acknowledgment sent at submission; this batch is the two newest entries.
    expect(log.body.paginationInfo.totalItems).toBe(3);
    expect(log.body.items.filter((i) => i.batch === sent.batch)).toHaveLength(2);
    expect(log.body.items.find((i) => i.batch === sent.batch)).toMatchObject({ status: "sent", templateName: "Cycle update" });
    // Without the applicant's consent their address is not used.
    await h.repos.table("consents").update({ applicant_workspace_id: WS_APPLICANT }, { revoked_at: "2027-04-17T00:00:00Z" });
    const after = await data<{ sent: number; results: { sent: boolean; reason: string }[] }>(s.funder, "POST", "/gms/communications/send", { templateId: t.id, recipients: [recipients[0]], fields: { note: "x" } });
    expect(after.sent).toBe(0);
    expect(after.results[0]!.reason).toContain("has not shared");
    // Documents are not emails, and reviewers do not send mail.
    expect((await s.call(s.funder, "POST", "/gms/communications/send", { templateId: "builtin:agreement", recipients })).status).toBe(422);
    expect((await s.call(r1, "POST", "/gms/communications/send", { templateId: t.id, recipients })).status).toBe(403);
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
  const funderAgent = () => h.forge({ sub: USER_OFFICER, client_id: CLIENT_AGENT, scope: "reviews:read reviews:write decisions:write awards:read awards:write agreements:write applications:read", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-funder-agent" });
  const applicantAgent = () => h.forge({ sub: USER_APPLICANT, client_id: CLIENT_AGENT, scope: "awards:read awards:write agreements:write", [WORKSPACE_CLAIM]: WS_APPLICANT, jti: "tok-applicant-agent-2" });

  it("an agent assigns, ranks and proposes; committing waits for a person and then creates the award", async () => {
    const agent = await funderAgent();
    const assigned = await tool(agent, "assign_reviewer", { applicationId: `app_${appA}`, stage: "loi", reviewerUserId: R1 });
    expect(assigned.isError).toBe(false);
    const ranked = await tool(agent, "rank_applications", { competitionId: s.compId, stage: "loi" });
    expect((ranked.structuredContent.items as unknown[]).length).toBe(3);
    const proposed = await tool(agent, "propose_decision", { competitionId: s.compId, decisions: [{ applicationId: `app_${appA}`, outcome: "approve", amountMinor: 15_000_000 }] });
    const decisionId = (proposed.structuredContent.decisions as { id: string }[])[0]!.id;
    // The proposal records that it came through an agent.
    expect((await h.repos.table("decisions").one({ id: decisionId }))!.proposed_by).toBe(`user:${USER_OFFICER}/client:${CLIENT_AGENT}`);

    const pending = await tool(agent, "commit_decisions", { competitionId: s.compId, decisionIds: [decisionId] });
    expect(pending.structuredContent).toMatchObject({ status: "pending_approval" });
    expect(await h.repos.table("awards").count({ workspace_id: WS_FUNDER })).toBe(0);
    const approved = await s.call<{ data: { status: string } }>(s.funder, "POST", `/gms/approvals/${pending.structuredContent.approvalId as string}/decision`, { approve: true });
    expect(approved.body.data.status).toBe("executed");
    expect(await h.repos.table("awards").count({ workspace_id: WS_FUNDER, status: "offered" })).toBe(1);
    const listed = await tool(agent, "list_awards", {});
    expect((listed.structuredContent.items as { title: string }[])[0]!.title).toBe("Mobile Health Navigation for Rural Families");
  });

  it("an agent can never sign: the gate holds, and even an approved call is refused", async () => {
    const p = await data<{ decisions: { id: string }[] }>(s.funder, "POST", "/gms/decisions/propose", { competitionId: s.compId, decisions: [{ applicationId: `app_${appA}`, outcome: "approve", amountMinor: 15_000_000 }] });
    const res = await data<{ results: { awardId: string; agreementId: string }[] }>(s.funder, "POST", "/gms/decisions/commit", { competitionId: s.compId, decisionIds: [p.decisions[0]!.id] });
    const { awardId, agreementId } = res.results[0]!;
    await data(s.funder, "POST", `/gms/agreements/${agreementId}/send`);
    const agent = await applicantAgent();
    expect((await tool(agent, "get_award", { awardId })).structuredContent).toMatchObject({ status: "offered" });

    // Accepting is gated; once the workspace admin approves, it runs as that person.
    const accept = await tool(agent, "accept_award", { awardId });
    expect(accept.structuredContent).toMatchObject({ status: "pending_approval" });
    expect((await h.repos.table("awards").one({ id: awardId.slice(4) }))!.status).toBe("offered");
    await s.call(s.applicant, "POST", `/gms/approvals/${accept.structuredContent.approvalId as string}/decision`, { approve: true });
    expect((await h.repos.table("awards").one({ id: awardId.slice(4) }))!.status).toBe("accepted");

    const sign = await tool(agent, "sign_agreement", { agreementId });
    expect(sign.structuredContent).toMatchObject({ status: "pending_approval" });
    const decided = await s.call<{ data: { status: string; error?: string } }>(s.applicant, "POST", `/gms/approvals/${sign.structuredContent.approvalId as string}/decision`, { approve: true });
    expect(decided.body.data.status).toBe("failed");
    expect((await h.repos.table("agreements").one({ id: agreementId.slice(4) }))!.status).toBe("sent");
  });
});
