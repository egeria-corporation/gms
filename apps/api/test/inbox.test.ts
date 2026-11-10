// SPDX-License-Identifier: AGPL-3.0-only
// The funder's inbox and the applicant-side extras around an application.
import { beforeEach, describe, expect, it } from "vitest";
import { clearDiscoveryCache } from "../src/services/applicant.ts";
import { USER_ADMIN, USER_AUDITOR, USER_OFFICER, WS_APPLICANT, WS_FUNDER, WS_OTHER, bearer, harness, type Harness } from "./helpers.ts";
import { scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;
let appId: string; // app_<uuid>
let appUuid: string;

const COMPLETE = { projectTitle: "Mobile Health Navigation for Rural Families", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel 46 miles to reach primary care." };

async function submitted(sc: Scenario): Promise<string> {
  const started = await sc.call<{ data: { id: string } }>(sc.applicant, "POST", "/common-grants/applications/start", { competitionId: sc.uuid.comp });
  const id = started.body.data.id;
  await sc.call(sc.applicant, "PUT", `/common-grants/applications/${id}/forms/${sc.uuid.loi}`, { response: COMPLETE });
  const done = await sc.call(sc.applicant, "PUT", `/common-grants/applications/${id}/submit`);
  expect(done.status).toBe(200);
  return id;
}

beforeEach(async () => {
  clearDiscoveryCache();
  h = await harness();
  s = await scenario(h);
  appUuid = await submitted(s);
  appId = `app_${appUuid}`;
  h.mailer.sent.length = 0;
});

describe("inbox list", () => {
  it("lists submitted applications with the applicant's level while consent stands", async () => {
    const r = await s.call<{ items: { id: string; status: string; eligibility: unknown; applicant: { name: string; level: string | null }; requestedAmountMinor: number }[]; counts: Record<string, number>; paginationInfo: { totalItems: number } }>(s.funder, "GET", "/gms/applications");
    expect(r.status).toBe(200);
    expect(r.body.paginationInfo.totalItems).toBe(1);
    expect(r.body.items[0]).toMatchObject({ id: appId, status: "submitted", eligibility: true, requestedAmountMinor: 15_000_000, applicant: { name: "Alder Creek Family Services", level: "L3" } });
    expect(r.body.counts).toEqual({ submitted: 1 });
    // Revoking consent hides the live level; the level stamped at submit stays on the application.
    await h.repos.table("consents").update({ applicant_workspace_id: WS_APPLICANT }, { revoked_at: "2027-04-16T17:30:00Z" });
    const after = await s.call<{ items: { applicant: { level: string | null }; verificationLevelAtSubmit: string }[] }>(s.funder, "GET", "/gms/applications");
    expect(after.body.items[0]).toMatchObject({ applicant: { level: null }, verificationLevelAtSubmit: "L3" });
  });

  it("filters by eligibility, Passport level, stage, status and tag", async () => {
    const count = async (q: string) => (await s.call<{ paginationInfo: { totalItems: number } }>(s.funder, "GET", `/gms/applications?${q}`)).body.paginationInfo.totalItems;
    expect(await count("eligibility=true")).toBe(1);
    expect(await count("eligibility=false")).toBe(0);
    expect(await count("level=L3")).toBe(1);
    expect(await count("level=L1")).toBe(0);
    expect(await count("stage=loi&status=submitted,screening")).toBe(1);
    expect(await count("stage=full")).toBe(0);
    expect(await count("tag=rural")).toBe(0);
    await s.call(s.funder, "POST", `/gms/applications/${appId}/tags`, { add: ["rural"] });
    expect(await count("tag=rural")).toBe(1);
    expect(await count("assignee=unassigned")).toBe(1);
  });

  it("is invisible to another funder and to applicants", async () => {
    const other = { ...bearer(await h.session(USER_ADMIN)).headers, "X-GMS-Workspace": WS_OTHER };
    await h.repos.table("workspace_members").insert({ workspace_id: WS_OTHER, user_id: USER_ADMIN, role: "admin" });
    expect((await s.call<{ items: unknown[] }>(other, "GET", "/gms/applications")).body.items).toEqual([]);
    expect((await s.call(other, "GET", `/gms/applications/${appId}`)).status).toBe(404);
    expect((await s.call(s.applicant, "GET", "/gms/applications")).status).toBe(403);
  });
});

describe("application detail", () => {
  it("shows responses with provenance, eligibility results and the consented record", async () => {
    const r = await s.call<{ data: { formResponses: { formTitle: string; response: Record<string, unknown>; provenance: Record<string, string>; lockedAt: string | null }[]; eligibilityResults: { eligible: boolean; results: unknown[] }; organization: { projection: { name: string }; level: string; levelChangedSinceSubmit: boolean } | null; attestationUrl: string; timeline: { type: string }[] } }>(s.funder, "GET", `/gms/applications/${appId}`);
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.formResponses[0]).toMatchObject({ formTitle: "Letter of intent", provenance: { "/legalName": "passport", "/projectTitle": "user" } });
    expect(d.formResponses[0]!.lockedAt).toBeTruthy();
    expect(d.eligibilityResults.results).toHaveLength(3);
    expect(d.organization).toMatchObject({ projection: { name: "Alder Creek Family Services" }, level: "L3", levelChangedSinceSubmit: false });
    expect(d.attestationUrl).toContain("/attestation");
    expect(d.timeline.map((t) => t.type)).toEqual(["started", "submit"]);
  });

  it("masks PII and hides the organization from an external reviewer, who sees only assigned applications", async () => {
    const reviewer = "77777777-7777-4777-8777-777777777777";
    await h.repos.table("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: reviewer, role: "external_reviewer" });
    const who = { ...bearer(await h.session(reviewer)).headers, "X-GMS-Workspace": WS_FUNDER };
    expect((await s.call(who, "GET", `/gms/applications/${appId}`)).status).toBe(404);
    await h.repos.table("review_assignments").insert({ workspace_id: WS_FUNDER, application_id: appUuid, stage: "loi", reviewer_user_id: reviewer, rubric_id: "0190a000-0000-7000-8000-000000000aaa", rubric_version: 1 });
    const r = await s.call<{ data: { organization: unknown; formResponses: { response: Record<string, unknown>; masked: string[]; provenance: object }[] } }>(who, "GET", `/gms/applications/${appId}`);
    expect(r.status).toBe(200);
    expect(r.body.data.organization).toBeNull();
    expect(r.body.data.formResponses[0]!.response.need).not.toBe(COMPLETE.need);
    expect(r.body.data.formResponses[0]!.masked).toContain("/need");
    expect(r.body.data.formResponses[0]!.response.projectTitle).toBe(COMPLETE.projectTitle);
  });
});

describe("actions", () => {
  it("advances to the next stage: locks the old responses and prefills the new form", async () => {
    const r = await s.call<{ data: { stage: string; status: string } }>(s.funder, "POST", `/gms/applications/${appId}/advance`, { toStage: "full" });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ stage: "full", status: "draft" });
    const app = await s.call<{ data: { status: { value: string }; formResponses: Record<string, { response: Record<string, unknown>; customFields: { gms: { value: { lockedAt?: string } } } }> } }>(s.applicant, "GET", `/common-grants/applications/${appUuid}`);
    expect(app.body.data.status.value).toBe("inProgress");
    expect(app.body.data.formResponses[s.uuid.full]!.response).toEqual({ legalName: "Alder Creek Family Services" });
    expect(app.body.data.formResponses[s.uuid.loi]!.customFields.gms.value.lockedAt).toBeTruthy();
    // The earlier stage stays read-only; the new one is editable.
    expect((await s.call(s.applicant, "PUT", `/common-grants/applications/${appUuid}/forms/${s.uuid.loi}`, { response: { need: "x" } })).status).toBe(409);
    expect((await s.call(s.applicant, "PUT", `/common-grants/applications/${appUuid}/forms/${s.uuid.full}`, { response: { approach: "Two navigators cover a weekly route." } })).status).toBe(200);
    expect((await s.call(s.applicant, "PUT", `/common-grants/applications/${appUuid}/submit`)).status).toBe(200);
  });

  it("refuses a stage that cannot be entered from here", async () => {
    const r = await s.call<{ message: string }>(s.funder, "POST", `/gms/applications/${appId}/advance`, { toStage: "loi" });
    expect(r.status).toBe(409);
    expect(r.body.message).toContain("can be entered from");
    expect((await s.call(s.funder, "POST", `/gms/applications/${appId}/advance`, { toStage: "nope" })).status).toBe(422);
  });

  it("requests a revision: unlocks the stage, emails the applicant, and the applicant resubmits", async () => {
    const r = await s.call<{ data: { status: string; letter: { sent: boolean } } }>(s.funder, "POST", `/gms/applications/${appId}/request-revision`, { message: "Please add the county assessment as a source.", dueAt: "2027-04-25T23:59:00Z" });
    expect(r.body.data).toMatchObject({ status: "revision_requested", letter: { sent: true } });
    expect(h.mailer.sent[0]!.subject).toBe("Revision requested: Mobile Health Navigation for Rural Families");
    expect(h.mailer.sent[0]!.text).toContain("county assessment");
    const status = await s.call<{ data: { status: string; timeline: { type: string; message: string | null }[] } }>(s.applicant, "GET", `/gms/my/applications/${appId}/status`);
    expect(status.body.data.timeline.at(-1)).toMatchObject({ type: "request_revision", message: "Please add the county assessment as a source." });
    expect((await s.call(s.applicant, "PUT", `/common-grants/applications/${appUuid}/forms/${s.uuid.loi}`, { response: { need: "Per the 2026 county assessment, families travel 46 miles." } })).status).toBe(200);
    const again = await s.call<{ data: { status: { value: string } } }>(s.applicant, "PUT", `/common-grants/applications/${appUuid}/submit`);
    expect(again.body.data.status.value).toBe("submitted");
  });

  it("declines with a committed decision and a letter", async () => {
    const r = await s.call<{ data: { status: string; decisionId: string; letter: { sent: boolean } } }>(s.funder, "POST", `/gms/applications/${appId}/decline`, { rationale: "Outside this cycle's geographic focus." });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: "declined", letter: { sent: true } });
    const decision = await h.repos.table("decisions").one({ id: r.body.data.decisionId });
    expect(decision).toMatchObject({ outcome: "decline", application_id: appUuid, committed_at: "2027-04-16T17:00:00.000Z" });
    expect(h.mailer.sent[0]!.text).toContain("geographic focus");
    const cg = await s.call<{ data: { status: { value: string } } }>(s.applicant, "GET", `/common-grants/applications/${appUuid}`);
    expect(cg.body.data.status.value).toBe("rejected");
    // Declining twice is refused and leaves no second decision behind.
    expect((await s.call(s.funder, "POST", `/gms/applications/${appId}/decline`, {})).status).toBe(409);
    expect(await h.repos.table("decisions").count({ application_id: appUuid })).toBe(1);
  });

  it("keeps declining away from roles that cannot decide", async () => {
    const auditor = { ...bearer(await h.session(USER_AUDITOR)).headers, "X-GMS-Workspace": WS_FUNDER, "Content-Type": "application/json" };
    expect((await s.call(auditor, "POST", `/gms/applications/${appId}/decline`, {})).status).toBe(403);
    expect((await s.call(auditor, "GET", `/gms/applications/${appId}`)).status).toBe(200);
  });

  it("bulk-declines with letters and reports each application on its own", async () => {
    const missing = "app_0190a000-0000-7000-8000-00000000ffff";
    const r = await s.call<{ data: { succeeded: string[]; failed: { id: string; message: string }[]; lettersSent: number } }>(s.funder, "POST", "/gms/applications/bulk", { action: "decline", applicationIds: [appId, missing], params: { rationale: "Not advancing to the full proposal stage." } });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ succeeded: [appId], failed: [{ id: missing, message: "Application not found" }], lettersSent: 1 });
    // Params are checked against the action before anything runs.
    expect((await s.call(s.funder, "POST", "/gms/applications/bulk", { action: "advance", applicationIds: [appId], params: {} })).status).toBe(400);
    expect(h.mailer.sent).toHaveLength(1);
    const ledger = (await h.ledger.list({ workspaceId: WS_FUNDER })).map((e) => e.eventType);
    expect(ledger).toEqual(expect.arrayContaining(["application.decline", "decision.committed", "communication.sent", "applications.bulk"]));
  });

  it("assigns to a member only", async () => {
    expect((await s.call(s.funder, "POST", `/gms/applications/${appId}/assign`, { userId: USER_OFFICER })).status).toBe(200);
    expect((await s.call(s.funder, "POST", `/gms/applications/${appId}/assign`, { userId: "0190a000-0000-7000-8000-00000000ffff" })).status).toBe(422);
    expect((await s.call<{ paginationInfo: { totalItems: number } }>(s.funder, "GET", `/gms/applications?assignee=${USER_OFFICER}`)).body.paginationInfo.totalItems).toBe(1);
  });
});

describe("threads", () => {
  it("shares one thread and keeps each side's internal thread to itself", async () => {
    const shared = await s.call<{ data: { id: string; visibility: string } }>(s.funder, "POST", "/gms/threads", { subjectId: appId });
    expect(shared.body.data.visibility).toBe("shared");
    await s.call(s.funder, "POST", `/gms/threads/${shared.body.data.id}/messages`, { body: "Thanks for the LOI. Interview slots open May 3." });
    await s.call(s.applicant, "POST", `/gms/threads/${shared.body.data.id}/messages`, { body: "Thank you, we will pick a slot." });
    const internal = await s.call<{ data: { id: string; visibility: string } }>(s.funder, "POST", "/gms/threads", { subjectId: appId, visibility: "internal" });
    expect(internal.body.data.visibility).toBe("funder_internal");
    await s.call(s.funder, "POST", `/gms/threads/${internal.body.data.id}/messages`, { body: "Budget looks high for the route described." });

    const funderView = await s.call<{ data: { visibility: string; messages: unknown[] }[] }>(s.funder, "GET", `/gms/threads?subjectId=${appId}`);
    expect(funderView.body.data.map((t) => [t.visibility, t.messages.length])).toEqual([["shared", 2], ["funder_internal", 1]]);
    const applicantView = await s.call<{ data: { visibility: string }[] }>(s.applicant, "GET", `/gms/threads?subjectId=${appId}`);
    expect(applicantView.body.data.map((t) => t.visibility)).toEqual(["shared"]);
    expect((await s.call(s.applicant, "POST", `/gms/threads/${internal.body.data.id}/messages`, { body: "hello" })).status).toBe(404);
  });

  it("creates and completes tasks within the workspace", async () => {
    const t = await s.call<{ data: { id: string } }>(s.funder, "POST", "/gms/tasks", { title: "Screen 4 applications", assigneeUserId: USER_OFFICER, subjectType: "application", subjectId: appUuid });
    expect(t.status).toBe(201);
    expect((await s.call(s.funder, "PATCH", `/gms/tasks/${t.body.data.id}`, { done: true })).status).toBe(200);
    expect((await s.call<{ data: unknown[] }>(s.funder, "GET", "/gms/tasks?open=true")).body.data).toEqual([]);
    expect((await s.call(s.applicant, "PATCH", `/gms/tasks/${t.body.data.id}`, { done: false })).status).toBe(404);
  });
});

describe("applicant extras", () => {
  it("lists my applications with the funder, stage and progress", async () => {
    const r = await s.call<{ data: { id: string; status: string; stage: { key: string; label: string }; funder: { name: string; brand: { accent?: string } }; forms: { total: number; complete: number } }[] }>(s.applicant, "GET", "/gms/my/applications");
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0]).toMatchObject({ id: appId, status: "submitted", stage: { key: "loi", label: "Letter of intent" }, funder: { name: "Riverbend Community Foundation", brand: { accent: "#1F6F8B" } }, forms: { total: 1, complete: 1 } });
  });

  it("keeps field comments inside the applicant team and resolves them", async () => {
    const c = await s.call<{ data: { id: string; formId: string; fieldPath: string } }>(s.editor, "POST", `/gms/my/applications/${appId}/comments`, { body: "Can we cite the county assessment?", formId: s.loiFormId, fieldPath: "/need" });
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ formId: s.loiFormId, fieldPath: "/need" });
    const done = await s.call<{ data: { resolvedAt: string } }>(s.applicant, "POST", `/gms/my/applications/${appId}/comments/${c.body.data.id}/resolve`);
    expect(done.body.data.resolvedAt).toBeTruthy();
    expect((await s.call<{ data: unknown[] }>(s.applicant, "GET", `/gms/my/applications/${appId}/comments`)).body.data).toHaveLength(1);
    // Not a thread the funder can list, and not a route the funder can use.
    expect((await s.call<{ data: unknown[] }>(s.funder, "GET", `/gms/threads?subjectId=${appId}`)).body.data).toEqual([]);
    expect((await s.call(s.funder, "GET", `/gms/my/applications/${appId}/comments`)).status).toBe(403);
  });

  it("stores an upload with its SHA-256, and a Passport locker file by reference only", async () => {
    const draft = await h.repos.table("applications").update({ id: appUuid }, { status: "draft" });
    expect(draft).toHaveLength(1);
    const up = await s.call<{ data: { sha256: string; size: number; source: string } }>(s.applicant, "POST", `/gms/my/applications/${appId}/attachments`, { name: "letter-of-support.txt", mime: "text/plain", contentBase64: btoa("hello") });
    expect(up.status).toBe(201);
    expect(up.body.data).toMatchObject({ sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", size: 5, source: "upload" });
    expect(h.storage.files.size).toBe(1);
    const ref = await s.call<{ data: { source: string; passportDocumentId: string } }>(s.applicant, "POST", `/gms/my/applications/${appId}/attachments`, { name: "IRS determination letter.pdf", mime: "application/pdf", passportDocumentId: "doc_irs_letter", size: 412_000, sha256: "3f9a".padEnd(64, "0") });
    expect(ref.body.data).toMatchObject({ source: "passport_locker", passportDocumentId: "doc_irs_letter" });
    expect(h.storage.files.size).toBe(1);
    expect((await s.call<{ data: unknown[] }>(s.applicant, "GET", `/gms/my/applications/${appId}/attachments`)).body.data).toHaveLength(2);
  });

  it("assigns a section to a teammate and withdraws", async () => {
    const { USER_APPLICANT_EDITOR } = await import("./scenario.ts");
    const a = await s.call<{ data: { sections: Record<string, string> } }>(s.applicant, "POST", `/gms/my/applications/${appId}/sections/assign`, { formId: s.loiFormId, sections: { Budget: USER_APPLICANT_EDITOR, Narrative: null } });
    expect(a.body.data.sections).toEqual({ Budget: USER_APPLICANT_EDITOR });
    const w = await s.call<{ data: { status: string } }>(s.applicant, "POST", `/gms/my/applications/${appId}/withdraw`);
    expect(w.body.data.status).toBe("withdrawn");
    expect((await s.call<{ items: { status: string }[] }>(s.funder, "GET", "/gms/applications")).body.items[0]!.status).toBe("withdrawn");
  });

  it("versions answers in the library", async () => {
    const a = await s.call<{ data: { id: string; key: string; version: number; words: number } }>(s.applicant, "POST", "/gms/my/answers", { title: "Need statement", body: "Families travel 46 miles." });
    expect(a.body.data).toMatchObject({ key: "need-statement", version: 1, words: 4 });
    const b = await s.call<{ data: { version: number } }>(s.editor, "PATCH", `/gms/my/answers/${a.body.data.id}`, { body: "Families in the valley travel an average of 46 miles." });
    expect(b.body.data.version).toBe(2);
    const list = await s.call<{ data: { version: number }[] }>(s.applicant, "GET", "/gms/my/answers");
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]!.version).toBe(2);
    expect((await s.call(s.funder, "GET", "/gms/my/answers")).status).toBe(403);
  });
});

describe("discovery", () => {
  it("lists open competitions with eligibility for the caller's organization", async () => {
    const r = await s.call<{ data: { competitionId: string; eligibility: { eligible: unknown }; application: { status: string } | null; url: string }[] }>(s.applicant, "GET", "/gms/discover/competitions");
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0]).toMatchObject({ competitionId: s.uuid.comp, eligibility: { eligible: true }, application: { status: "submitted" }, url: "https://app.gms.test/f/riverbend/o/community-health-grants-2027" });
  });

  it("proxies OpenGrants with the organization's context, caches for 15 minutes, and links listings that live here", async () => {
    const first = await s.call<{ data: { results: { id: string; gms: { opportunityId: string } | null }[]; cached: boolean } }>(s.applicant, "POST", "/gms/discover/opengrants/search", { query: "health" });
    expect(first.status).toBe(200);
    expect(first.body.data.cached).toBe(false);
    expect(h.openGrants.calls[0]!.org).toEqual({ orgType: "EA000000", region: "OR", mission: expect.stringContaining("Health navigation"), revenueBand: "1m_5m" });
    const again = await s.call<{ data: { cached: boolean } }>(s.applicant, "POST", "/gms/discover/opengrants/search", { query: "health" });
    expect(again.body.data.cached).toBe(true);
    expect(h.openGrants.calls).toHaveLength(1);
    h.clock.now = new Date(h.clock.now.getTime() + 16 * 60 * 1000);
    const who = { ...bearer(await h.session((await import("./scenario.ts")).USER_APPLICANT)).headers, "X-GMS-Workspace": WS_APPLICANT, "Content-Type": "application/json" };
    await s.call(who, "POST", "/gms/discover/opengrants/search", { query: "health" });
    expect(h.openGrants.calls).toHaveLength(2);
    expect((await s.call(s.funder, "POST", "/gms/discover/opengrants/search", {})).status).toBe(403);
  });

  it("saves a listing once", async () => {
    const body = { source: "opengrants", externalId: "og-1", title: "Rural Health Access Fund", url: "https://opengrants.example/grants/og-1" };
    const a = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/gms/discover/saved", body);
    const b = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/gms/discover/saved", body);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect((await s.call<{ data: unknown[] }>(s.applicant, "GET", "/gms/discover/saved")).body.data).toHaveLength(1);
  });
});
