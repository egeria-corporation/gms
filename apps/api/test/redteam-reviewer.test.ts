// SPDX-License-Identifier: AGPL-3.0-only
// Red team (2026-11): "reviewers see the applications assigned to them, masked" lived only in the
// inbox. The CommonGrants application routes, the side reads (budget, follow-ups, attachments,
// threads) and the eligibility dry-run let any reviewer, also an external one with no assignment,
// read every submitted application in full. The rule now sits in the one function every read of an
// application passes through.
import { PII_MASK } from "@gms/forms";
import { beforeEach, describe, expect, it } from "vitest";
import { WS_APPLICANT, WS_FUNDER, bearer, harness, type Harness } from "./helpers.ts";
import { scenario, type Scenario } from "./scenario.ts";

const EXT = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1";
const REV = "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2";
const CONSULTANT = "e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3";
let h: Harness;
let s: Scenario;
let app: string;
let other: string;
const headers = async (user: string, ws: string) => ({ ...bearer(await h.session(user)).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" });

type Cg = { id: string; formResponses: Record<string, { response: Record<string, unknown> }>; customFields: { gms: { value: { applicantWorkspaceId?: string; eligibility?: { results?: { actual?: unknown; explain?: string }[] } } } } };

async function submit(need: string) {
  const started = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
  const id = started.body.data.id;
  await s.call(s.applicant, "PUT", `/common-grants/applications/${id}/forms/${s.uuid.loi}`, { response: { projectTitle: "Mobile Health Navigation", requestedAmount: { amount: "150000.00", currency: "USD" }, need } });
  expect((await s.call(s.applicant, "PUT", `/common-grants/applications/${id}/submit`)).status).toBe(200);
  return id;
}
const assign = async (appId: string, reviewer: string, status = "assigned") => {
  const rubric = (await h.repos.table("rubrics").find({ workspace_id: WS_FUNDER }))[0]!;
  return h.repos.table("review_assignments").insert({ workspace_id: WS_FUNDER, application_id: appId, stage: "loi", reviewer_user_id: reviewer, rubric_id: rubric.id, rubric_version: rubric.version, status });
};
/** Every read of one application a funder-side caller can make outside the inbox. */
const sideReads = (id: string) =>
  [
    ["GET", `/common-grants/applications/${id}`],
    ["GET", `/common-grants/applications/${id}/forms/${s.uuid.loi}`],
    ["GET", `/gms/applications/app_${id}`],
    ["GET", `/gms/applications/app_${id}/budget`],
    ["GET", `/gms/applications/app_${id}/follow-ups`],
    ["GET", `/gms/my/applications/app_${id}/attachments`],
    ["GET", `/gms/threads?subjectType=application&subjectId=${id}`],
  ] as const;

/** 404 everywhere; on threads an external reviewer, who holds no message scope at all, is refused with 403 before the application is looked at. */
const refused = (status: number, path: string) => status === 404 || (status === 403 && path.startsWith("/gms/threads"));

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  // The form marks `need` as personal data and `projectTitle` as hidden from reviewers.
  await h.repos.table("forms").update({ id: s.uuid.loi }, { field_meta: { "/need": { pii: true }, "/projectTitle": { reviewerVisible: false } } as never });
  app = await submit("PII: families of named clients travel 46 miles.");
  // A second applicant's application in the same competition, which no reviewer here is assigned to.
  const second = await h.repos.table("applications").insert({ workspace_id: WS_FUNDER, applicant_workspace_id: WS_APPLICANT, competition_id: s.uuid.comp, opportunity_id: s.uuid.opp, title: "Another application", stage: "loi", status: "submitted", cg_status: "submitted", submitted_at: h.clock.now.toISOString() });
  other = second.id;
  await h.repos.table("form_responses").insert({ workspace_id: WS_FUNDER, application_id: other, form_id: s.uuid.loi, form_version: 1, stage: "loi", response: { projectTitle: "Other", need: "Other applicant's personal details" } as never, status: "complete" });
  await h.repos.table("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: EXT, role: "external_reviewer", scope: { competitionIds: [s.uuid.comp] } as never });
  await h.repos.table("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: REV, role: "reviewer" });
});

describe("a reviewer with no assignment", () => {
  it("reads no application, on any route", async () => {
    for (const user of [EXT, REV]) {
      const who = await headers(user, WS_FUNDER);
      for (const [method, path] of sideReads(app)) expect(refused((await s.call(who, method, path)).status, path), `${user} ${path}`).toBe(true);
      const all = await s.call<{ items: { id: string }[] }>(who, "POST", "/common-grants/applications/search", {});
      expect(all.status).toBe(200);
      expect(all.body.items).toEqual([]);
      expect((await s.call<{ items: unknown[] }>(who, "GET", "/gms/applications")).body.items).toEqual([]);
    }
  });

  it("is refused the eligibility dry-run, which never shows another organization's record to anyone", async () => {
    const probe = { rules: { all: [{ path: "org.emails", op: "exists" }, { path: "profile.commonApp", op: "exists" }] }, applicantWorkspaceId: WS_APPLICANT };
    for (const user of [EXT, REV]) expect((await s.call(await headers(user, WS_FUNDER), "POST", "/gms/eligibility/evaluate", probe)).status, user).toBe(403);
    // Staff may run it, and get outcomes; the values found in the applicant's record stay out of the answer.
    const staff = await s.call<{ data: { eligible: unknown; results: { outcome: string; actual?: unknown; explain?: string }[] } }>(s.funder, "POST", "/gms/eligibility/evaluate", probe);
    expect(staff.status).toBe(200);
    expect(staff.body.data.results.map((r) => r.outcome)).toEqual(["pass", "pass"]);
    for (const r of staff.body.data.results) {
      expect(r.actual).toBeUndefined();
      expect(JSON.stringify(r)).not.toContain("aldercreekfs.example");
      expect(JSON.stringify(r)).not.toContain("2310000");
    }
    // An organization dry-running rules against its own record still sees what was found.
    const own = await s.call<{ data: { results: { actual?: unknown }[] } }>(s.applicant, "POST", "/gms/eligibility/evaluate", { rules: { path: "org.name", op: "exists" }, applicantWorkspaceId: WS_APPLICANT });
    expect(own.body.data.results[0]!.actual).toBe("Alder Creek Family Services");
  });
});

describe("a reviewer with an assignment", () => {
  it("reads that application masked on the CommonGrants routes, and no other", async () => {
    await assign(app, EXT);
    await assign(app, REV);
    for (const [user, external] of [[EXT, true], [REV, false]] as const) {
      const who = await headers(user, WS_FUNDER);
      const one = await s.call<{ data: Cg }>(who, "GET", `/common-grants/applications/${app}`);
      expect(one.status, user).toBe(200);
      const response = one.body.data.formResponses[s.uuid.loi]!.response;
      // Hidden from reviewers: removed. Personal data: masked for the external reviewer only.
      expect(response.projectTitle).toBeUndefined();
      expect(response.need).toBe(external ? PII_MASK : "PII: families of named clients travel 46 miles.");
      // Who the applicant is, and what the rules found in its record, stay with staff.
      expect(one.body.data.customFields.gms.value.applicantWorkspaceId).toBeUndefined();
      expect(JSON.stringify(one.body.data.customFields.gms.value.eligibility ?? {})).not.toContain("actual");
      const form = await s.call<{ data: { response: Record<string, unknown> } }>(who, "GET", `/common-grants/applications/${app}/forms/${s.uuid.loi}`);
      expect(form.body.data.response).toEqual(response);
      // The masked answers are the inbox's own.
      const inbox = await s.call<{ data: { formResponses: { response: Record<string, unknown> }[] } }>(who, "GET", `/gms/applications/app_${app}`);
      expect(inbox.body.data.formResponses[0]!.response).toEqual(response);
      // Search returns the assigned application only, masked the same way.
      const all = await s.call<{ items: Cg[] }>(who, "POST", "/common-grants/applications/search", {});
      expect(all.body.items.map((a) => a.id)).toEqual([app]);
      expect(all.body.items[0]!.formResponses[s.uuid.loi]!.response).toEqual(response);
      // The other application stays out of reach everywhere.
      for (const [method, path] of sideReads(other)) expect(refused((await s.call(who, method, path)).status, path), `${user} ${path}`).toBe(true);
      // Deliberations and the decision are not a reviewer's to read, assigned or not.
      expect((await s.call(who, "GET", `/gms/applications/app_${app}/follow-ups`)).status).toBe(404);
      expect(refused((await s.call(who, "GET", `/gms/threads?subjectType=application&subjectId=${app}`)).status, "/gms/threads")).toBe(true);
      // The MCP resource gms://application/{id} is served by the same `getApplication` (mcp-layer.ts),
      // so an agent acting for a reviewer reads the same masked record.
    }
  });

  it("loses the application again by recusing, and an external reviewer never reaches outside their competitions", async () => {
    const a = await assign(app, REV);
    const rev = await headers(REV, WS_FUNDER);
    expect((await s.call(rev, "GET", `/common-grants/applications/${app}`)).status).toBe(200);
    await h.repos.table("review_assignments").update({ id: a.id }, { status: "recused" });
    expect((await s.call(rev, "GET", `/common-grants/applications/${app}`)).status).toBe(404);
    expect((await s.call<{ items: unknown[] }>(rev, "POST", "/common-grants/applications/search", {})).body.items).toEqual([]);
    expect((await s.call(rev, "GET", `/gms/applications/app_${app}`)).status).toBe(404);

    // An external reviewer whose invitation names another competition, with a stray assignment row here.
    await h.repos.table("workspace_members").update({ workspace_id: WS_FUNDER, user_id: EXT }, { scope: { competitionIds: ["00000000-0000-4000-8000-000000000000"] } as never });
    await assign(app, EXT);
    const ext = await headers(EXT, WS_FUNDER);
    expect((await s.call(ext, "GET", `/common-grants/applications/${app}`)).status).toBe(404);
    expect((await s.call<{ items: unknown[] }>(ext, "POST", "/common-grants/applications/search", {})).body.items).toEqual([]);
  });
});

describe("staff and applicants", () => {
  it("staff still read every submitted application in full", async () => {
    const one = await s.call<{ data: Cg }>(s.funder, "GET", `/common-grants/applications/${app}`);
    expect(one.status).toBe(200);
    expect(one.body.data.formResponses[s.uuid.loi]!.response).toMatchObject({ projectTitle: "Mobile Health Navigation", need: "PII: families of named clients travel 46 miles." });
    expect(one.body.data.customFields.gms.value.applicantWorkspaceId).toBe(WS_APPLICANT);
    const all = await s.call<{ items: Cg[] }>(s.funder, "POST", "/common-grants/applications/search", {});
    expect(all.body.items.map((a) => a.id).sort()).toEqual([app, other].sort());
    for (const [method, path] of sideReads(app)) expect((await s.call(s.funder, method, path)).status, path).toBe(200);
  });

  it("a consultant's search returns only the applications in their scope", async () => {
    await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: CONSULTANT, role: "consultant", scope: { applicationIds: [] } as never });
    const c = await headers(CONSULTANT, WS_APPLICANT);
    expect((await s.call(c, "GET", `/common-grants/applications/${app}`)).status).toBe(404);
    expect((await s.call<{ items: unknown[] }>(c, "POST", "/common-grants/applications/search", {})).body.items).toEqual([]);
    await h.repos.table("workspace_members").update({ workspace_id: WS_APPLICANT, user_id: CONSULTANT }, { scope: { applicationIds: [app] } as never });
    const scoped = await s.call<{ items: { id: string }[] }>(await headers(CONSULTANT, WS_APPLICANT), "POST", "/common-grants/applications/search", {});
    expect(scoped.body.items.map((a) => a.id)).toEqual([app]);
  });
});
