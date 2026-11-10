// SPDX-License-Identifier: AGPL-3.0-only
// Read models behind the workspace screens (rollups, panel detail, award activity and closeout,
// upcoming payments, breakdowns, who-has-access, interviews, alerts), plus the two fixes that ship
// with them: workspace-added gates hold over REST, and a funder can read a shared report's form.
import { beforeEach, describe, expect, it } from "vitest";
import { restTool } from "../src/auth/rest-gates.ts";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { CLIENT_AGENT, USER_ADMIN, USER_OFFICER, WS_APPLICANT, WS_FUNDER, WS_OTHER, bearer, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, scenario, type Scenario } from "./scenario.ts";

const R1 = "10000000-0000-4000-8000-000000000001";
let h: Harness;
let s: Scenario;
let admin: Record<string, string>;
let appA: string;
let awardId: string;
let trancheId: string;
let requirementId: string;

const headers = async (user: string, ws: string) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });
const get = async <T>(who: Record<string, string>, path: string): Promise<T> => {
  const r = await s.call<{ data: T }>(who, "GET", path);
  if (r.status !== 200) throw new Error(`GET ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const COMPLETE = { projectTitle: "Mobile Health Navigation for Rural Families", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel 46 miles to reach primary care." };

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  admin = await headers(USER_ADMIN, WS_FUNDER);
  await h.repos.table("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: R1, role: "reviewer", scope: { tags: ["health"], capacity: 5 } });
  const program = await h.repos.table("programs").insert({ workspace_id: WS_FUNDER, name: "Community Health 2027", budget_amount_minor: 20_000_000, currency: "USD" });
  await h.repos.table("opportunities").update({ id: s.uuid.opp }, { program_id: program.id });
  const started = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
  appA = started.body.data.id;
  await s.call(s.applicant, "PUT", `/common-grants/applications/${appA}/forms/${s.uuid.loi}`, { response: COMPLETE });
  expect((await s.call(s.applicant, "PUT", `/common-grants/applications/${appA}/submit`)).status).toBe(200);

  // An active award with one tranche due in ten days and one report requirement.
  const award = await h.repos.table("awards").insert({ workspace_id: WS_FUNDER, recipient_workspace_id: WS_APPLICANT, application_id: appA, opportunity_id: s.uuid.opp, program_id: program.id, title: "Mobile Health Navigation", status: "active", funding: { awardedAmount: { amount: "150000.00", currency: "USD" }, disbursedAmount: { amount: "75000.00", currency: "USD" } }, key_dates: { awardDate: { name: "Award date", eventType: "singleDate", date: "2027-05-18" }, periodOfPerformance: { startDate: "2027-07-01", endDate: "2028-06-30" } } });
  awardId = award.id;
  const schedule = await h.repos.table("payment_schedules").insert({ workspace_id: WS_FUNDER, award_id: award.id });
  trancheId = (await h.repos.table("tranches").insert({ workspace_id: WS_FUNDER, award_id: award.id, schedule_id: schedule.id, seq: 2, amount_minor: 6_000_000, status: "due", due_at: "2027-04-26T00:00:00Z" })).id;
  requirementId = (await h.repos.table("requirements").insert({ workspace_id: WS_FUNDER, award_id: award.id, type: "report", title: "Interim report", status: "due", due_at: "2027-12-15T00:00:00Z" })).id;
  await h.repos.table("agreements").insert({ workspace_id: WS_FUNDER, award_id: award.id, status: "executed", document_sha256: "ab".repeat(32), executed_at: "2027-05-24T00:00:00Z", grantee_signature: { name: "Maria Santos", userId: USER_APPLICANT, ip: "203.0.113.7", at: "2027-05-21T18:00:00Z", hash: "ab".repeat(32) }, funder_signature: { name: "Dana Ortiz", userId: USER_OFFICER, ip: "203.0.113.9", at: "2027-05-24T18:00:00Z", hash: "ab".repeat(32) } });
});

describe("gates a workspace adds hold over REST", () => {
  it("maps mutating routes to the tool they stand for", () => {
    expect(restTool("POST", "/gms/applications/app_1/tags")).toBe("tag_application");
    expect(restTool("PUT", "/common-grants/applications/1/forms/2")).toBe("fill_form_response");
    expect(restTool("GET", "/gms/applications")).toBeNull();
  });

  it("refuses an agent token on a tool the workspace gated, and still lets a person through", async () => {
    const agent = { ...bearer(await h.forge({ sub: USER_OFFICER, client_id: CLIENT_AGENT, scope: "applications:read applications:write", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-gate-rest" })).headers, "Content-Type": "application/json" };
    const tag = (who: Record<string, string>) => s.call<{ errors?: { code: string }[] }>(who, "POST", `/gms/applications/app_${appA}/tags`, { add: ["rural"] });
    expect((await tag(agent)).status).toBe(200);
    await h.repos.table("workspaces").update({ id: WS_FUNDER }, { settings: { gatedTools: ["tag_application"] } });
    const refused = await tag(agent);
    expect(refused.status).toBe(403);
    expect(refused.body.errors?.[0]?.code).toBe("approval_required");
    expect((await tag(s.funder)).status).toBe(200);
  });
});

describe("a report shared with another funder", () => {
  it("lets the receiving funder read the form the answers were given on, and nobody else", async () => {
    const form = await h.repos.table("forms").insert({ workspace_id: WS_FUNDER, title: "Interim report", purpose: "report", version: 1, json_schema: { type: "object", properties: { progress: { type: "string" } } }, ui_schema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/progress" }] }, published_at: "2027-01-01T00:00:00Z" });
    const original = await h.repos.table("submissions").insert({ workspace_id: WS_FUNDER, award_id: awardId, requirement_id: requirementId, status: "accepted" });
    const shared = await h.repos.table("submissions").insert({ workspace_id: WS_OTHER, status: "submitted", shared_from_submission_id: original.id });
    await h.repos.table("form_responses").insert({ workspace_id: WS_OTHER, submission_id: shared.id, form_id: form.id, form_version: 1, response: { progress: "On track" } });
    const receiver = await headers(USER_ADMIN, WS_OTHER);
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: USER_ADMIN, role: "admin" });
    expect((await s.call(receiver, "GET", `/common-grants/forms/${form.id}`)).status).toBe(200);
    expect((await h.request(`/common-grants/forms/${form.id}`)).status).toBe(404);
  });
});

describe("public pages", () => {
  it("shows past awards only when the funder turned transparency on, and the FAQ a builder wrote", async () => {
    const page = async () => ((await (await h.request("/gms/public/funders/riverbend")).json()) as { data: { pastAwards: unknown; open: unknown[]; forecasted: unknown[] } }).data;
    expect((await page()).pastAwards).toBeNull();
    await h.repos.table("workspaces").update({ id: WS_FUNDER }, { settings: { transparency: true } });
    const after = await page();
    expect(after.pastAwards).toEqual([{ recipient: "Alder Creek Family Services", title: "Mobile Health Navigation", awardedAmount: { amount: "150000.00", currency: "USD" }, year: 2027 }]);
    expect(after.open.length + after.forecasted.length).toBeGreaterThan(0);

    const patched = await s.call(s.funder, "PATCH", `/gms/opportunities/${s.oppId}`, { publish: { faq: [{ question: "Can fiscally sponsored projects apply?", answer: "Yes." }], documents: [{ name: "Guidelines", url: "https://riverbendcf.example/guidelines.pdf" }] } });
    expect(patched.status).toBe(200);
    const opp = (await h.repos.table("opportunities").one({ id: s.uuid.opp }))!;
    const detail = ((await (await h.request(`/gms/public/funders/riverbend/opportunities/${opp.slug}`)).json()) as { data: { opportunity: { faq: unknown[]; documents: unknown[] } } }).data;
    expect(detail.opportunity.faq).toHaveLength(1);
    expect(detail.opportunity.documents).toEqual([{ name: "Guidelines", url: "https://riverbendcf.example/guidelines.pdf" }]);
    expect((await s.call(s.funder, "PATCH", `/gms/opportunities/${s.oppId}`, { publish: { documents: [{ name: "x", url: "http://insecure.example/a.pdf" }] } })).status).toBe(400);
  });
});

describe("applications list and detail", () => {
  it("carries score, review progress and days in stage, and filters by named view", async () => {
    const rubric = await h.repos.table("rubrics").insert({ workspace_id: WS_FUNDER, name: "One", criteria: [{ key: "fit", label: "Fit", weight: 1, scale: { type: "numeric", min: 0, max: 10 } }], overall: {} });
    const a = await h.repos.table("review_assignments").insert({ workspace_id: WS_FUNDER, application_id: appA, stage: "loi", reviewer_user_id: R1, rubric_id: rubric.id, rubric_version: rubric.version, status: "submitted" });
    await h.repos.table("reviews").insert({ workspace_id: WS_FUNDER, assignment_id: a.id, scores: { fit: { value: 8 } }, submitted_at: "2027-04-16T10:00:00Z" });
    h.clock.now = new Date("2027-04-19T17:00:00Z");
    const officer = await headers(USER_OFFICER, WS_FUNDER); // a fresh session: the clock moved
    const list = async (qs: string) => ((await (await h.request(`/gms/applications${qs}`, { headers: officer })).json()) as { items: { id: string; score: number | null; daysInStage: number; reviews: { complete: boolean }; flagged: boolean }[] }).items;
    const [row] = await list("");
    expect(row).toMatchObject({ score: 80, daysInStage: 3, reviews: { complete: true }, flagged: false });
    expect(await list("?view=review_complete")).toHaveLength(1);
    expect(await list("?view=flagged")).toHaveLength(0);
    await s.call(officer, "POST", `/gms/applications/app_${appA}/tags`, { add: ["flagged"] });
    expect(await list("?view=flagged")).toHaveLength(1);
  });

  it("returns the proposed budget and attached documents with their source", async () => {
    await h.repos.table("budgets").insert({ workspace_id: WS_FUNDER, application_id: appA, kind: "proposed", lines: [{ category: "Personnel", amountMinor: 9_600_000 }, { category: "Travel", amountMinor: 2_800_000 }] });
    await h.repos.table("documents").insert({ workspace_id: WS_FUNDER, owner_workspace_id: WS_APPLICANT, subject_type: "application", subject_id: appA, name: "IRS determination letter.pdf", mime: "application/pdf", size: 412_000, sha256: "cd".repeat(32), storage: "supabase", path: "ignored", passport_document_id: "doc-1" });
    const out = await get<{ budget: { totalMinor: number; lines: unknown[] }; documents: { source: string; sha256: string }[] }>(s.funder, `/gms/applications/app_${appA}/budget`);
    expect(out.budget.totalMinor).toBe(12_400_000);
    expect(out.documents).toMatchObject([{ source: "passport_locker", sha256: "cd".repeat(32) }]);
    expect((await s.call(await headers(USER_ADMIN, WS_OTHER), "GET", `/gms/applications/app_${appA}/budget`)).status).toBeGreaterThanOrEqual(403);
  });

  it("schedules an interview: the funder offers times, the applicant confirms one of them", async () => {
    const slots = ["2027-05-03T17:00:00Z", "2027-05-04T17:00:00Z"];
    expect((await s.call(s.applicant, "POST", `/gms/applications/app_${appA}/interview`, { slots })).status).toBe(403);
    expect((await s.call(s.funder, "POST", `/gms/applications/app_${appA}/interview`, { slots, location: "Video call" })).status).toBe(201);
    expect((await s.call(s.applicant, "POST", `/gms/my/applications/app_${appA}/interview/confirm`, { slot: "2027-06-01T17:00:00Z" })).status).toBe(422);
    expect((await s.call(s.applicant, "POST", `/gms/my/applications/app_${appA}/interview/confirm`, { slot: slots[1] })).status).toBe(200);
    const mine = await get<{ interview: { proposed: { slots: string[] }; confirmed: { slot: string } }; decision: unknown; revisionRequests: unknown[] }>(s.applicant, `/gms/my/applications/app_${appA}/follow-ups`);
    expect(mine.interview.confirmed.slot).toBe(slots[1]);
    expect(mine.decision).toBeNull();
  });
});

describe("programs, competitions and the panel", () => {
  it("rolls a program up against its budget", async () => {
    const program = (await h.repos.table("programs").find({ workspace_id: WS_FUNDER }))[0]!;
    const out = await get<{ committedMinor: number; paidMinor: number; remainingMinor: number; committedByStatus: Record<string, { count: number }> }>(s.funder, `/gms/programs/${program.id}/rollup`);
    expect(out).toMatchObject({ committedMinor: 15_000_000, paidMinor: 7_500_000, remainingMinor: 5_000_000, committedByStatus: { active: { count: 1 } } });
  });

  it("lists the reviewer pool with load, and per-criterion means with a decision summary", async () => {
    const rubric = await h.repos.table("rubrics").insert({ workspace_id: WS_FUNDER, name: "Two", criteria: [{ key: "impact", label: "Impact", weight: 1, scale: { type: "numeric", min: 0, max: 10 } }, { key: "fit", label: "Fit", weight: 1, scale: { type: "numeric", min: 0, max: 10 } }], overall: {} });
    const a = await h.repos.table("review_assignments").insert({ workspace_id: WS_FUNDER, application_id: appA, stage: "loi", reviewer_user_id: R1, rubric_id: rubric.id, rubric_version: rubric.version, status: "submitted" });
    await h.repos.table("reviews").insert({ workspace_id: WS_FUNDER, assignment_id: a.id, scores: { impact: { value: 9 }, fit: { value: 6 } }, submitted_at: "2027-04-16T10:00:00Z" });
    const pool = await get<{ reviewers: { userId: string; assigned: number; submitted: number; capacity: number | null; expertiseTags: string[] }[] }>(admin, `/gms/competitions/${s.compId}/reviewers`);
    expect(pool.reviewers.find((r) => r.userId === R1)).toMatchObject({ assigned: 1, submitted: 1, capacity: 5, expertiseTags: ["health"] });
    const panel = await get<{ items: { criteria: Record<string, number> }[]; decisions: { undecided: number } }>(admin, `/gms/competitions/${s.compId}/panel-summary?stage=loi`);
    expect(panel.items[0]!.criteria).toEqual({ impact: 90, fit: 60 });
    expect(panel.decisions.undecided).toBe(1);
  });

  it("keeps panel notes internal to the funder", async () => {
    expect((await s.call(admin, "POST", `/gms/competitions/${s.compId}/notes`, { body: "Strong need statement; budget is tight." })).status).toBe(201);
    expect(await get<unknown[]>(admin, `/gms/competitions/${s.compId}/notes`)).toHaveLength(1);
    expect((await s.call(s.applicant, "GET", `/gms/competitions/${s.compId}/notes`)).status).toBe(403);
    expect(h.ledger.events.some((e) => e.eventType === "panel.note_added")).toBe(true);
  });
});

describe("awards", () => {
  it("shows signatures, a closeout checklist and a reproducible closeout PDF", async () => {
    const sigs = await get<{ party: string; name: string; documentSha256: string }[]>(admin, `/gms/awards/awd_${awardId}/signatures`);
    expect(sigs.map((x) => [x.party, x.name])).toEqual([["grantee", "Maria Santos"], ["funder", "Dana Ortiz"]]);
    const closeout = await get<{ ready: boolean; disbursedMinor: number; checks: { key: string; state: string }[] }>(admin, `/gms/awards/awd_${awardId}/closeout`);
    expect(closeout.ready).toBe(false);
    expect(closeout.disbursedMinor).toBe(7_500_000);
    expect(Object.fromEntries(closeout.checks.map((c) => [c.key, c.state]))).toEqual({ payments: "fail", requirements: "fail", amendments: "pass", period: "fail" });
    const one = await h.request(`/gms/awards/awd_${awardId}/closeout.pdf`, { headers: admin });
    const two = await h.request(`/gms/awards/awd_${awardId}/closeout.pdf`, { headers: admin });
    expect(one.headers.get("Content-Type")).toBe("application/pdf");
    expect(one.headers.get("ETag")).toBe(two.headers.get("ETag"));
  });

  it("reads an award's ledger activity, and nothing for another funder", async () => {
    await s.call(admin, "POST", `/gms/tranches/trn_${trancheId}/hold`, { reason: "Waiting on the interim report" });
    const activity = await get<{ eventType: string; label: string }[]>(admin, `/gms/awards/awd_${awardId}/activity`);
    expect(activity.length).toBeGreaterThan(0);
    expect(activity.every((e) => e.label.length > 0)).toBe(true);
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: USER_ADMIN, role: "admin" });
    expect((await s.call(await headers(USER_ADMIN, WS_OTHER), "GET", `/gms/awards/awd_${awardId}/activity`)).status).toBe(404);
  });

  it("gives both parties the award's documents and one shared message thread", async () => {
    const docs = await get<{ kind: string; status: string }[]>(s.applicant, `/gms/my/awards/awd_${awardId}/documents`);
    expect(docs).toMatchObject([{ kind: "agreement", status: "executed" }]);
    expect((await s.call(s.applicant, "POST", `/gms/my/awards/awd_${awardId}/messages`, { body: "When is tranche 2 expected?" })).status).toBe(201);
    const seenByFunder = await get<{ body: string; own: boolean }[]>(s.funder, `/gms/awards/awd_${awardId}/messages`);
    expect(seenByFunder).toMatchObject([{ body: "When is tranche 2 expected?", own: false }]);
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: USER_ADMIN, role: "admin" });
    expect((await s.call(await headers(USER_ADMIN, WS_OTHER), "GET", `/gms/awards/awd_${awardId}/messages`)).status).toBe(404);
  });
});

describe("payments, grantees, analytics, dashboard", () => {
  it("lists tranches due in the next 30 days and the money ledger", async () => {
    const up = await get<{ totalMinor: number; items: { trancheId: string; recipient: string }[] }>(admin, "/gms/payments/upcoming");
    expect(up).toMatchObject({ totalMinor: 6_000_000, items: [{ trancheId: `trn_${trancheId}`, recipient: "Alder Creek Family Services" }] });
    expect((await get<{ items: unknown[] }>(admin, "/gms/payments/upcoming?days=5")).items).toHaveLength(0);
    await s.call(admin, "POST", `/gms/tranches/trn_${trancheId}/hold`, { reason: "Manual hold" });
    const ledger = (await (await h.request("/gms/payments/ledger", { headers: admin })).json()) as { items: { subjectType: string }[] };
    expect(ledger.items.length).toBeGreaterThan(0);
    expect(ledger.items.every((e) => e.subjectType === "tranche")).toBe(true);
  });

  it("adds total awarded to the grantee directory and lists a grantee's reports", async () => {
    const list = (await (await h.request("/gms/grantees", { headers: s.funder })).json()) as { items: { workspaceId: string; totalAwardedMinor: number }[] };
    expect(list.items.find((g) => g.workspaceId === WS_APPLICANT)?.totalAwardedMinor).toBe(15_000_000);
    const reports = await get<{ requirementId: string; status: string }[]>(s.funder, `/gms/grantees/${WS_APPLICANT}/reports`);
    expect(reports).toMatchObject([{ requirementId: `req_${requirementId}`, status: "due" }]);
  });

  it("breaks awards down only by what the organization shared", async () => {
    const out = await get<{ awardsByRegion: { key: string; awardedMinor: number }[]; equity: { byTaxStatus: { key: string }[]; byBudgetBand: { key: string }[] }; reviewerLoad: unknown[] }>(admin, "/gms/analytics/breakdowns");
    expect(out.awardsByRegion).toEqual([{ key: "OR", awards: 1, awardedMinor: 15_000_000 }]);
    expect(out.equity.byTaxStatus[0]!.key).toBe("501(c)(3)");
    expect(out.equity.byBudgetBand[0]!.key).toBe("$1M – $5M");
    // Consent withdrawn: the same award is counted, but nothing about the organization is.
    await h.repos.table("consents").update({ applicant_workspace_id: WS_APPLICANT, funder_workspace_id: WS_FUNDER }, { revoked_at: "2027-04-17T00:00:00Z" });
    expect((await get<{ awardsByRegion: { key: string }[] }>(admin, "/gms/analytics/breakdowns")).awardsByRegion[0]!.key).toBe("Not shared");
  });

  it("previews a bulk send to a view, sends it for a person, and refuses an agent", async () => {
    const tpl = await s.call<{ data: { id: string } }>(admin, "POST", "/gms/templates", { kind: "email", name: "Update", subject: "An update on {{application.title}}", body: "Dear {{recipient.name}}, thank you." });
    expect(tpl.status).toBe(201);
    const body = { templateId: tpl.body.data.id, view: { stage: "loi" } };
    const dry = await s.call<{ data: { dryRun: boolean; requested: number } }>(admin, "POST", "/gms/communications/bulk", { ...body, dryRun: true });
    expect(dry.body.data).toMatchObject({ dryRun: true, requested: 1 });
    const before = h.mailer.sent.length;
    const sent = await s.call<{ data: { sent: number } }>(admin, "POST", "/gms/communications/bulk", body);
    expect(sent.body.data.sent).toBe(1);
    expect(h.mailer.sent.length).toBe(before + 1);
    const usage = await get<{ templateId: string; sent: number; lastUsedAt: string }[]>(admin, "/gms/templates/usage");
    expect(usage.find((u) => u.templateId === tpl.body.data.id)).toMatchObject({ sent: 1, channel: "email" });
    const agent = { ...bearer(await h.forge({ sub: USER_ADMIN, client_id: CLIENT_AGENT, scope: "communications:write applications:read", [WORKSPACE_CLAIM]: WS_FUNDER, jti: "tok-bulk-agent" })).headers, "Content-Type": "application/json" };
    expect((await s.call(agent, "POST", "/gms/communications/bulk", body)).status).toBe(403);
  });

  it("feeds the dashboard with recent activity for staff only", async () => {
    const feed = await get<{ label: string; at: string }[]>(s.funder, "/gms/activity?limit=5");
    expect(feed.length).toBeGreaterThan(0);
    expect(feed.length).toBeLessThanOrEqual(5);
    expect((await s.call(await headers(R1, WS_FUNDER), "GET", "/gms/activity")).status).toBe(403);
  });
});

describe("the applicant's side", () => {
  it("answers who has access in one read", async () => {
    await h.repos.table("mcp_connections").insert({ workspace_id: WS_APPLICANT, client_id: CLIENT_AGENT, user_id: USER_APPLICANT, scopes: ["applications:read"] });
    const out = await get<{ funders: { funder: { name: string }; basis: string }[]; agents: { clientId: string }[]; team: { userId: string }[] }>(s.applicant, "/gms/me/access");
    expect(out.funders).toMatchObject([{ funder: { name: "Riverbend Community Foundation" }, basis: "application" }]);
    expect(out.agents).toMatchObject([{ clientId: CLIENT_AGENT }]);
    expect(out.team.length).toBeGreaterThan(0);
    expect((await s.call(s.funder, "GET", "/gms/me/access")).status).toBe(403);
  });

  it("lists each funder with open items, documents and a public contact", async () => {
    const out = await get<{ name: string; openItems: { kind: string }[]; documents: { kind: string }[]; contact: { page: string } }[]>(s.applicant, "/gms/my/funders/detail");
    expect(out).toHaveLength(1);
    expect(out[0]!.openItems.map((i) => i.kind)).toEqual(["report_due"]);
    expect(out[0]!.documents).toMatchObject([{ kind: "agreement" }]);
    expect(out[0]!.contact.page).toContain("/f/riverbend");
  });

  it("saves, lists and deletes funding alerts", async () => {
    const created = await s.call<{ data: { id: string; frequency: string } }>(s.applicant, "POST", "/gms/discover/alerts", { name: "Rural health", query: "rural health navigation", frequency: "daily" });
    expect(created.status).toBe(201);
    expect(await get<unknown[]>(s.applicant, "/gms/discover/alerts")).toHaveLength(1);
    expect((await s.call(s.applicant, "DELETE", `/gms/discover/alerts/${created.body.data.id}`)).status).toBe(200);
    expect(await get<unknown[]>(s.applicant, "/gms/discover/alerts")).toHaveLength(0);
    expect((await s.call(s.funder, "POST", "/gms/discover/alerts", { name: "x" })).status).toBe(403);
  });
});

describe("approval preview", () => {
  it("renders the decline letter each affected application would receive", async () => {
    const row = await h.repos.table("approvals").insert({ workspace_id: WS_FUNDER, tool: "decline_application", input: { applicationId: `app_${appA}`, rationale: "Outside this cycle's focus." }, requested_by: `user:${USER_OFFICER}/client:${CLIENT_AGENT}`, side: "funder" });
    const out = await get<{ affected: number; letters: { title: string; text: string }[] }>(admin, `/gms/approvals/apr_${row.id}/preview`);
    expect(out.affected).toBe(1);
    expect(out.letters[0]!.title).toBe(COMPLETE.projectTitle);
    expect(out.letters[0]!.text).toContain("Outside this cycle's focus.");
    expect(h.mailer.sent.filter((m) => m.subject.includes("decision"))).toHaveLength(0);
  });
});

describe("applicant consent scopes", () => {
  it("asks for payee:read unless the install turned it off", async () => {
    const start = async () => {
      const res = await h.request("/gms/passport/consent/start", { method: "POST", headers: { ...bearer(await h.session(USER_APPLICANT)).headers, "Content-Type": "application/json" }, body: "{}" });
      return new URL(((await res.json()) as { data: { authorizeUrl: string } }).data.authorizeUrl).searchParams.get("scope");
    };
    expect(await start()).toBe("org:read org.changes:read org.changes:write payee:read");
    h.env.PASSPORT_APPLICANT_PAYEE_READ = "false";
    expect(await start()).toBe("org:read org.changes:read org.changes:write");
  });
});
