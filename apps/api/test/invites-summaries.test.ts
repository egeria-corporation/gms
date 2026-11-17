// SPDX-License-Identifier: AGPL-3.0-only
// v1.7.0: invite someone into a draft (scope and role on accepted invites, the daily limit, no
// reminders, masked addresses, agents refused) and the AI summary in funder review (kept per
// application and response version, the quota spent once, hidden when the assistant is off,
// never a score).
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import { evaluateRequirements, sendDocumentExpiryWarnings, sendNextCycleReminders, sendObligationReminders, sendOutsideReminders } from "../src/jobs.ts";
import { AGENT_REDIRECT, CLIENT_AGENT, SESSION_SECRET, USER_ADMIN, USER_OFFICER, VERIFIER, WS_APPLICANT, WS_FUNDER, authorizeAs, bearer, form, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, scenario, type Scenario } from "./scenario.ts";
import { signCoiPolicy } from "./coi.ts";

const COWRITER = "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0";
const COWRITER_EMAIL = "lena@fischergrants.example";
const REVIEWER = "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2";

let h: Harness;
let s: Scenario;

/** A Supabase-style session for `userId` signed in as `email`. */
async function sessionAs(userId: string, email: string, ws = WS_APPLICANT) {
  const iat = Math.floor(h.clock.now.getTime() / 1000);
  const token = await new SignJWT({ aal: "aal2", email, role: "authenticated" }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(userId).setAudience("authenticated").setIssuedAt(iat).setExpirationTime(iat + 3600).sign(new TextEncoder().encode(SESSION_SECRET));
  return { ...bearer(token).headers, "X-GMS-Workspace": ws, "Content-Type": "application/json" };
}
const tokenOf = (url: string) => new URL(url).searchParams.get("token")!;
const lastMailTo = (to: string) => [...h.mailer.sent].reverse().find((m) => m.to.includes(to));

async function outsideDraft() {
  const oa = (await s.call<{ data: { id: string } }>(s.applicant, "POST", "/gms/outside-applications", { title: "Rural clinics 2027", funderName: "Northwind Family Foundation", fullDue: "2027-06-01", stage: "drafting" })).body.data;
  const qs = (await s.call<{ data: { id: string }[] }>(s.applicant, "POST", `/gms/outside-applications/${oa.id}/questions`, { questions: [{ prompt: "Describe the need your project addresses." }, { prompt: "How will you measure success?" }] })).body.data;
  return { oaId: oa.id, q1: qs[0]!.id, q2: qs[1]!.id };
}

async function builtInDraft() {
  const started = await s.call<{ data: { id: string } }>(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
  return started.body.data.id;
}

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  h.mailer.sent.length = 0;
});

describe("invite someone into an outside draft", () => {
  it("invites as a consultant scoped to that draft, emails once, ledgers the address masked", async () => {
    const { oaId, q1 } = await outsideDraft();
    const r = await s.call<{ data: { id: string; email: string; role: string; emailed: boolean; acceptUrl: string | null; draft: { kind: string; id: string; questionId: string } } }>(s.applicant, "POST", "/gms/draft-invitations", { email: "Lena@FischerGrants.example", draft: { kind: "outside_application", id: oaId, questionId: q1 } });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ email: "l…@fischergrants.example", role: "consultant", emailed: true, acceptUrl: null, draft: { kind: "outside_application", id: oaId, questionId: q1 } });

    const [stored] = await h.repos.table("invitations").find({ workspace_id: WS_APPLICANT });
    expect(stored).toMatchObject({ email: COWRITER_EMAIL, role: "consultant", scope: { draft: { kind: "outside_application", id: oaId, questionId: q1 }, outsideApplicationIds: [oaId] } });

    const mails = h.mailer.sent.filter((m) => m.to.includes(COWRITER_EMAIL));
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toBe("Help write Rural clinics 2027");
    expect(mails[0]!.text).toContain("They would like you to write: Describe the need your project addresses.");
    expect(mails[0]!.text).toContain("https://app.gms.test/invitations/draft?token=gms_inv_");

    const events = await h.ledger.list({ workspaceId: WS_APPLICANT, eventType: "invitation.created" });
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toMatchObject({ email: "l…@fischergrants.example", role: "consultant", draft: { kind: "outside_application", id: oaId, questionId: q1 } });
    // The full address is nowhere in the ledger.
    expect(JSON.stringify(await h.ledger.list({ workspaceId: WS_APPLICANT }))).not.toContain("lena@");
  });

  it("on acceptance the person is a scoped consultant, assigned the question, and lands on the draft", async () => {
    const { oaId, q1 } = await outsideDraft();
    await s.call(s.applicant, "POST", "/gms/draft-invitations", { email: COWRITER_EMAIL, draft: { kind: "outside_application", id: oaId, questionId: q1 } });
    const token = tokenOf(lastMailTo(COWRITER_EMAIL)!.text.match(/https:\/\/\S+/)![0]);

    // Someone signed in with another address cannot use it.
    const wrong = await s.call<{ errors: { code: string }[] }>(await sessionAs(COWRITER, "someone.else@example.org"), "POST", "/gms/invitations/accept", { token });
    expect(wrong.status).toBe(403);
    expect(wrong.body.errors[0]!.code).toBe("email_mismatch");
    expect(await h.repos.table("workspace_members").one({ workspace_id: WS_APPLICANT, user_id: COWRITER })).toBeNull();

    const me = await sessionAs(COWRITER, "LENA@fischergrants.example");
    const accepted = await s.call<{ data: { role: string; workspace: { handle: string }; draft: { kind: string; id: string; questionId: string; assigned: boolean } } }>(me, "POST", "/gms/invitations/accept", { token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data).toMatchObject({ role: "consultant", workspace: { handle: "alder-creek" }, draft: { kind: "outside_application", id: oaId, questionId: q1, assigned: true } });

    const member = (await h.repos.table("workspace_members").one({ workspace_id: WS_APPLICANT, user_id: COWRITER }))!;
    expect(member.role).toBe("consultant");
    expect(member.scope).toEqual({ outsideApplicationIds: [oaId], email: COWRITER_EMAIL });
    expect((await h.repos.table("outside_questions").one({ id: q1 }))!.assignee_user_id).toBe(COWRITER);
    const ev = (await h.ledger.list({ workspaceId: WS_APPLICANT, eventType: "invitation.accepted" }))[0]!;
    expect(ev.data).toMatchObject({ userId: COWRITER, role: "consultant", email: "l…@fischergrants.example" });
    // Used once.
    expect((await s.call(me, "POST", "/gms/invitations/accept", { token })).status).toBe(404);
  });

  it("a cowriter opens that draft and writes its answers, and nothing else", async () => {
    const { oaId, q1, q2 } = await outsideDraft();
    const other = (await s.call<{ data: { id: string } }>(s.applicant, "POST", "/gms/outside-applications", { title: "Another draft", funderName: "Elm Fund", stage: "drafting" })).body.data.id;
    await h.repos.table("documents").insert({ workspace_id: WS_APPLICANT, owner_workspace_id: WS_APPLICANT, subject_type: "outside_application", subject_id: oaId, name: "Budget.pdf", mime: "application/pdf", size: 1, sha256: "a".repeat(64), storage: "r2", path: "p" });
    await s.call(s.applicant, "POST", "/gms/draft-invitations", { email: COWRITER_EMAIL, draft: { kind: "outside_application", id: oaId, questionId: q1 } });
    const me = await sessionAs(COWRITER, COWRITER_EMAIL);
    await s.call(me, "POST", "/gms/invitations/accept", { token: tokenOf(lastMailTo(COWRITER_EMAIL)!.text.match(/https:\/\/\S+/)![0]) });

    const detail = await s.call<{ data: { cowriter: boolean; title: string; questions: { id: string }[]; documents: unknown[]; activity: unknown[]; allowedMoves: unknown[] } }>(me, "GET", `/gms/outside-applications/${oaId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ cowriter: true, title: "Rural clinics 2027", documents: [], activity: [], allowedMoves: [] });
    expect(detail.body.data.questions.map((q) => q.id)).toEqual([q1, q2]);
    expect((await s.call(me, "GET", `/gms/outside-applications/${oaId}/questions`)).status).toBe(200);
    expect((await s.call(me, "PUT", `/gms/outside-questions/${q1}/answer`, { body: "Families travel 46 miles to reach care." })).status).toBe(200);
    expect((await s.call(me, "PATCH", `/gms/outside-questions/${q1}`, { status: "ready" })).status).toBe(200);
    expect((await s.call(me, "GET", `/gms/outside-questions/${q1}/answers`)).status).toBe(200);
    expect((await s.call(me, "POST", `/gms/outside-questions/${q1}/comments`, { body: "First pass done." })).status).toBe(201);

    // Not: approving, editing the question, reassigning, other drafts, lists, stages, documents, invitations.
    expect((await s.call(me, "PATCH", `/gms/outside-questions/${q1}`, { status: "approved" })).status).toBe(403);
    expect((await s.call(me, "PATCH", `/gms/outside-questions/${q1}`, { prompt: "Changed" })).status).toBe(403);
    expect((await s.call(me, "PATCH", `/gms/outside-questions/${q2}`, { assigneeUserId: COWRITER })).status).toBe(403);
    expect((await s.call(me, "GET", `/gms/outside-applications/${other}`)).status).toBe(404);
    expect((await s.call(me, "GET", "/gms/outside-applications")).status).toBe(403);
    expect((await s.call(me, "POST", `/gms/outside-applications/${oaId}/stage`, { to: "submitted" })).status).toBe(403);
    expect((await s.call(me, "GET", `/gms/outside-applications/${oaId}/documents`)).status).toBe(403);
    expect((await s.call(me, "POST", `/gms/outside-applications/${oaId}/questions`, { prompt: "New" })).status).toBe(403);
    expect((await s.call(me, "DELETE", `/gms/outside-questions/${q2}`)).status).toBe(403);
    expect((await s.call(me, "POST", "/gms/draft-invitations", { email: "friend@example.org", draft: { kind: "outside_application", id: oaId } })).status).toBe(403);
    expect((await s.call(me, "GET", `/gms/draft-invitations?kind=outside_application&id=${oaId}`)).status).toBe(403);
  });

  it("an existing consultant invited into a second draft keeps the first", async () => {
    const a = await outsideDraft();
    const b = await outsideDraft();
    await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: COWRITER, role: "consultant", scope: { outsideApplicationIds: [a.oaId], email: COWRITER_EMAIL } as never });
    // Already a member by address: offered from the list, not invited again.
    expect((await s.call(s.applicant, "POST", "/gms/draft-invitations", { email: COWRITER_EMAIL, draft: { kind: "outside_application", id: b.oaId } })).status).toBe(409);
    await h.repos.table("workspace_members").update({ workspace_id: WS_APPLICANT, user_id: COWRITER }, { scope: { outsideApplicationIds: [a.oaId] } as never });
    expect((await s.call(s.applicant, "POST", "/gms/draft-invitations", { email: COWRITER_EMAIL, draft: { kind: "outside_application", id: b.oaId, questionId: b.q2 } })).status).toBe(201);
    const me = await sessionAs(COWRITER, COWRITER_EMAIL);
    await s.call(me, "POST", "/gms/invitations/accept", { token: tokenOf(lastMailTo(COWRITER_EMAIL)!.text.match(/https:\/\/\S+/)![0]) });
    expect((await h.repos.table("workspace_members").one({ workspace_id: WS_APPLICANT, user_id: COWRITER }))!.scope).toEqual({ outsideApplicationIds: [a.oaId, b.oaId] });
    expect((await s.call(me, "GET", `/gms/outside-applications/${a.oaId}`)).status).toBe(200);
    expect((await s.call(me, "GET", `/gms/outside-applications/${b.oaId}`)).status).toBe(200);
  });

  it("leaves a question assigned to someone else as it is", async () => {
    const { oaId, q1 } = await outsideDraft();
    await s.call(s.applicant, "POST", "/gms/draft-invitations", { email: COWRITER_EMAIL, draft: { kind: "outside_application", id: oaId, questionId: q1 } });
    await s.call(s.applicant, "PATCH", `/gms/outside-questions/${q1}`, { assigneeUserId: USER_APPLICANT });
    const r = await s.call<{ data: { draft: { assigned: boolean } } }>(await sessionAs(COWRITER, COWRITER_EMAIL), "POST", "/gms/invitations/accept", { token: tokenOf(lastMailTo(COWRITER_EMAIL)!.text.match(/https:\/\/\S+/)![0]) });
    expect(r.body.data.draft.assigned).toBe(false);
    expect((await h.repos.table("outside_questions").one({ id: q1 }))!.assignee_user_id).toBe(USER_APPLICANT);
  });
});

describe("invite someone into a built-in application's section", () => {
  it("scopes the consultant to that application and assigns the section", async () => {
    const appUuid = await builtInDraft();
    const r = await s.call<{ data: { draft: { kind: string; id: string; formId: string; section: string } } }>(s.applicant, "POST", "/gms/draft-invitations", { email: COWRITER_EMAIL, draft: { kind: "application", id: `app_${appUuid}`, formId: s.loiFormId, section: "Project" } });
    expect(r.status).toBe(201);
    expect(r.body.data.draft).toMatchObject({ kind: "application", id: `app_${appUuid}`, formId: s.loiFormId, section: "Project" });
    const pending = await s.call<{ data: { invitations: { email: string; draft: { section: string } }[]; canInvite: boolean; perDay: number; remainingToday: number } }>(s.applicant, "GET", `/gms/draft-invitations?kind=application&id=app_${appUuid}`);
    expect(pending.body.data).toMatchObject({ canInvite: true, perDay: 20, remainingToday: 19, invitations: [{ email: "l…@fischergrants.example", draft: { section: "Project" } }] });
    // Editors see who is invited but do not invite (DRAFT_INVITER_ROLES).
    expect((await s.call<{ data: { canInvite: boolean } }>(s.editor, "GET", `/gms/draft-invitations?kind=application&id=app_${appUuid}`)).body.data.canInvite).toBe(false);

    const me = await sessionAs(COWRITER, COWRITER_EMAIL);
    const accepted = await s.call<{ data: { draft: { kind: string; id: string; section: string; assigned: boolean } } }>(me, "POST", "/gms/invitations/accept", { token: tokenOf(lastMailTo(COWRITER_EMAIL)!.text.match(/https:\/\/\S+/)![0]) });
    expect(accepted.body.data.draft).toMatchObject({ kind: "application", id: `app_${appUuid}`, section: "Project", assigned: true });
    expect((await h.repos.table("workspace_members").one({ workspace_id: WS_APPLICANT, user_id: COWRITER }))!.scope).toEqual({ applicationIds: [appUuid], email: COWRITER_EMAIL });
    const response = await h.repos.table("form_responses").one({ application_id: appUuid, form_id: s.uuid.loi });
    expect(response!.section_assignments).toEqual({ Project: COWRITER });

    // They write that application and see no other.
    expect((await s.call(me, "PUT", `/common-grants/applications/${appUuid}/forms/${s.uuid.loi}`, { response: { projectTitle: "Mobile Health Navigation" } })).status).toBe(200);
    expect((await s.call(me, "PUT", `/common-grants/applications/${appUuid}/submit`)).status).toBe(403);
    const otherApp = (await h.repos.table("applications").insert({ workspace_id: WS_FUNDER, applicant_workspace_id: WS_APPLICANT, competition_id: s.uuid.comp, opportunity_id: s.uuid.opp, title: "Another draft", stage: "loi", status: "draft", cg_status: "draft" })).id;
    expect((await s.call(me, "GET", `/common-grants/applications/${otherApp}`)).status).toBe(404);
    const mine = await s.call<{ data: { id: string }[] }>(me, "GET", "/gms/my/applications");
    expect(mine.body.data.map((a) => a.id)).toEqual([`app_${appUuid}`]);
  });

  it("refuses an application that is no longer a draft", async () => {
    const appUuid = await builtInDraft();
    await h.repos.table("applications").update({ id: appUuid }, { status: "submitted", submitted_at: h.clock.now.toISOString() });
    const r = await s.call<{ errors: { code: string }[] }>(s.applicant, "POST", "/gms/draft-invitations", { email: COWRITER_EMAIL, draft: { kind: "application", id: appUuid } });
    expect(r.status).toBe(409);
    expect(r.body.errors[0]!.code).toBe("application_locked");
  });
});

describe("who may invite, how often, and never again", () => {
  it("is a workspace admin's own click: editors, agents and API clients are refused", async () => {
    const { oaId } = await outsideDraft();
    const body = { email: COWRITER_EMAIL, draft: { kind: "outside_application", id: oaId } };
    expect((await s.call(s.editor, "POST", "/gms/draft-invitations", body)).status).toBe(403);
    // An agent the admin connected, holding applications:write, still cannot send it.
    const { decision } = await authorizeAs(h, USER_APPLICANT, { workspaceId: WS_APPLICANT, scope: "applications:read applications:write" });
    const code = new URL(((await decision.json()) as { data: { redirectTo: string } }).data.redirectTo).searchParams.get("code")!;
    const tokenRes = await h.request("/oauth/token", form({ grant_type: "authorization_code", client_id: CLIENT_AGENT, code, redirect_uri: AGENT_REDIRECT, code_verifier: VERIFIER }));
    const agent = { ...bearer(((await tokenRes.json()) as { access_token: string }).access_token).headers, "Content-Type": "application/json" };
    const refused = await s.call<{ errors: { code: string }[] }>(agent, "POST", "/gms/draft-invitations", body);
    expect(refused.status).toBe(403);
    expect(refused.body.errors[0]!.code).toBe("human_only");
    expect(await h.repos.table("invitations").find({ workspace_id: WS_APPLICANT })).toHaveLength(0);
    expect(h.mailer.sent).toHaveLength(0);
  });

  it("allows 20 invitations per workspace per rolling day, across both screens", async () => {
    const { oaId } = await outsideDraft();
    for (let i = 0; i < 12; i++) expect((await s.call(s.applicant, "POST", "/gms/draft-invitations", { email: `writer${i}@team.example`, draft: { kind: "outside_application", id: oaId } })).status).toBe(201);
    for (let i = 0; i < 8; i++) expect((await s.call(s.applicant, "POST", `/gms/workspaces/${WS_APPLICANT}/invitations`, { email: `teammate${i}@team.example`, role: "editor" })).status).toBe(201);
    const over = await s.call<{ errors: { code: string }[] }>(s.applicant, "POST", "/gms/draft-invitations", { email: "one.more@team.example", draft: { kind: "outside_application", id: oaId } });
    expect(over.status).toBe(429);
    expect(over.body.errors[0]!.code).toBe("invitation_limit");
    expect((await s.call(s.applicant, "POST", `/gms/workspaces/${WS_APPLICANT}/invitations`, { email: "one.more@team.example", role: "viewer" })).status).toBe(429);
    expect((await s.call<{ data: { remainingToday: number } }>(s.applicant, "GET", `/gms/draft-invitations?kind=outside_application&id=${oaId}`)).body.data.remainingToday).toBe(0);
    // Another workspace has its own count.
    expect((await s.call(await sessionAs(USER_ADMIN, "helen.ortiz@riverbendcf.example", WS_FUNDER), "POST", `/gms/workspaces/${WS_FUNDER}/invitations`, { email: "reviewer@pool.example", role: "reviewer" })).status).toBe(201);
    h.clock.now = new Date(h.clock.now.getTime() + 24 * 3_600_000 + 1000);
    expect((await s.call(await sessionAs(USER_APPLICANT, "rosa@aldercreekfs.example"), "POST", "/gms/draft-invitations", { email: "one.more@team.example", draft: { kind: "outside_application", id: oaId } })).status).toBe(201);
  });

  it("sends no reminders: a waiting invitation is not sent again, and no job writes to the invited address", async () => {
    const { oaId, q1 } = await outsideDraft();
    expect((await s.call(s.applicant, "POST", "/gms/draft-invitations", { email: COWRITER_EMAIL, draft: { kind: "outside_application", id: oaId, questionId: q1 } })).status).toBe(201);
    const again = await s.call<{ errors: { code: string; message?: string }[] }>(s.applicant, "POST", "/gms/draft-invitations", { email: COWRITER_EMAIL, draft: { kind: "outside_application", id: oaId } });
    expect(again.status).toBe(409);
    expect(again.body.errors[0]!.code).toBe("already_invited");
    const base = () => ({ repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, config: { baseUrl: "https://gms.test", webBaseUrl: "https://app.gms.test", passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: "OpenGrants GMS <notices@gms.test>" }, ports: { mailer: h.mailer, directory: h.directory } });
    for (let day = 0; day < 20; day++) {
      h.clock.now = new Date(h.clock.now.getTime() + 86_400_000);
      for (const job of [sendOutsideReminders, sendDocumentExpiryWarnings, sendObligationReminders, sendNextCycleReminders, evaluateRequirements]) await job(base());
    }
    expect(h.mailer.sent.filter((m) => m.to.includes(COWRITER_EMAIL))).toHaveLength(1);
    // And no scheduled job reads invitations at all.
    for (const file of ["../src/jobs.ts", "../../jobs/src/index.ts"]) expect(readFileSync(new URL(file, import.meta.url), "utf8")).not.toMatch(/table\("invitations"\)|from\("invitations"\)/);
  });

  it("returns the link for the admin to pass on when the email cannot be sent", async () => {
    const { oaId } = await outsideDraft();
    h.withoutPorts.add("mailer");
    const r = await s.call<{ data: { emailed: boolean; acceptUrl: string } }>(s.applicant, "POST", "/gms/draft-invitations", { email: COWRITER_EMAIL, draft: { kind: "outside_application", id: oaId } });
    expect(r.body.data.emailed).toBe(false);
    expect(r.body.data.acceptUrl).toMatch(/^https:\/\/app\.gms\.test\/invitations\/draft\?token=gms_inv_/);
  });
});

describe("the one-time note", () => {
  it("is dismissed once per person and workspace", async () => {
    expect((await s.call<{ data: { dismissed: string[] } }>(s.applicant, "GET", "/gms/me/notes")).body.data.dismissed).toEqual([]);
    expect((await s.call<{ data: { dismissed: string[] } }>(s.applicant, "POST", "/gms/me/notes/dismiss", { note: "invite_teammate" })).body.data.dismissed).toEqual(["invite_teammate"]);
    expect((await s.call<{ data: { dismissed: string[] } }>(s.applicant, "GET", "/gms/me/notes")).body.data.dismissed).toEqual(["invite_teammate"]);
    expect((await s.call<{ data: { dismissed: string[] } }>(s.editor, "GET", "/gms/me/notes")).body.data.dismissed).toEqual([]);
    expect((await s.call(s.applicant, "POST", "/gms/me/notes/dismiss", { note: "anything_else" })).status).toBe(400);
  });
});

// ------------------------------------------------------------------------------------ AI summary

const SUMMARY = { summary: "Alder Creek asks for $150,000 for mobile health navigation.", strengths: ["Clear need"], openQuestions: ["How many families?"], quotes: [{ field: "need", text: "Families travel 46 miles" }], fromExternalSystems: [], cautions: [] };

describe("the AI summary on the review screen", () => {
  let appId: string;
  let uuid: string;
  beforeEach(async () => {
    uuid = await builtInDraft();
    await s.call(s.applicant, "PUT", `/common-grants/applications/${uuid}/forms/${s.uuid.loi}`, { response: { projectTitle: "Mobile Health Navigation for Rural Families", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel 46 miles to reach primary care." } });
    expect((await s.call(s.applicant, "PUT", `/common-grants/applications/${uuid}/submit`)).status).toBe(200);
    appId = `app_${uuid}`;
    h.llmAnswer.value = SUMMARY;
  });
  type View = { data: { draft: boolean; label: string; cached: boolean; responseVersion: string; summary: typeof SUMMARY | null; quota: { used: number; remaining: number } } };

  it("is not there when the assistant is off", async () => {
    for (const [method, path, body] of [["GET", `/gms/assist/summary?applicationId=${appId}`, undefined], ["POST", "/gms/assist/summary", { applicationId: appId }]] as const) {
      const r = await s.call<{ errors: { code: string }[] }>(s.funder, method, path, body);
      expect(r.status).toBe(404);
      expect(r.body.errors[0]!.code).toBe("assistant_disabled");
    }
    expect(h.llm.requests).toHaveLength(0);
    expect(await h.repos.table("application_summaries").find({ workspace_id: WS_FUNDER })).toHaveLength(0);
  });

  it("is written on the first request, kept, and read by every reviewer after that without spending the quota", async () => {
    h.env.ASSISTANT_ENABLED = "true";
    const before = await s.call<View>(s.funder, "GET", `/gms/assist/summary?applicationId=${appId}`);
    expect(before.body.data).toMatchObject({ draft: true, label: "Review before relying on it", cached: false, summary: null, quota: { used: 0 } });
    expect(h.llm.requests).toHaveLength(0);

    const first = await s.call<View>(s.funder, "POST", "/gms/assist/summary", { applicationId: appId });
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ cached: false, summary: SUMMARY, quota: { used: 1 } });
    expect(first.body.data.responseVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(first.body.data.responseVersion).toBe(before.body.data.responseVersion);

    // Another member of the funder's team, and the same one again: the kept summary, no new call.
    const admin = { ...(await sessionAs(USER_ADMIN, "helen.ortiz@riverbendcf.example", WS_FUNDER)) };
    const second = await s.call<View>(admin, "POST", "/gms/assist/summary", { applicationId: appId });
    expect(second.body.data).toMatchObject({ cached: true, summary: SUMMARY, quota: { used: 1 } });
    expect((await s.call<View>(s.funder, "GET", `/gms/assist/summary?applicationId=${appId}`)).body.data).toMatchObject({ cached: true, summary: SUMMARY });
    expect(h.llm.requests).toHaveLength(1);
    expect(await h.repos.table("assist_calls").find({ workspace_id: WS_FUNDER })).toHaveLength(1);
    expect(await h.repos.table("application_summaries").find({ workspace_id: WS_FUNDER })).toHaveLength(1);
  });

  it("is written again for a new response version, and a kept one is shown even when the month is spent", async () => {
    h.env.ASSISTANT_ENABLED = "true";
    await h.repos.table("workspaces").update({ id: WS_FUNDER }, { settings: { assistMonthlyQuota: 1 } });
    const first = await s.call<View>(s.funder, "POST", "/gms/assist/summary", { applicationId: appId });
    expect(first.body.data.quota.remaining).toBe(0);
    expect((await s.call<View>(s.funder, "POST", "/gms/assist/summary", { applicationId: appId })).body.data).toMatchObject({ cached: true, summary: SUMMARY });

    // The applicant's answers change (a revision): a new version, and the month is spent.
    const response = (await h.repos.table("form_responses").one({ application_id: uuid, form_id: s.uuid.loi }))!;
    await h.repos.table("form_responses").update({ id: response.id }, { response: { ...(response.response as object), need: "Families now travel 52 miles." } as never });
    const fresh = await s.call<View>(s.funder, "GET", `/gms/assist/summary?applicationId=${appId}`);
    expect(fresh.body.data.responseVersion).not.toBe(first.body.data.responseVersion);
    expect(fresh.body.data.summary).toBeNull();
    const over = await s.call<{ errors: { code: string }[] }>(s.funder, "POST", "/gms/assist/summary", { applicationId: appId });
    expect(over.status).toBe(429);
    expect(over.body.errors[0]!.code).toBe("assist_quota_exhausted");
    await h.repos.table("workspaces").update({ id: WS_FUNDER }, { settings: { assistMonthlyQuota: 5 } });
    expect((await s.call<View>(s.funder, "POST", "/gms/assist/summary", { applicationId: appId })).body.data).toMatchObject({ cached: false, quota: { used: 2 } });
    expect(await h.repos.table("application_summaries").find({ workspace_id: WS_FUNDER })).toHaveLength(2);
  });

  it("never scores or decides, and a masked reviewer gets a summary of what they may see", async () => {
    h.env.ASSISTANT_ENABLED = "true";
    await h.repos.table("forms").update({ id: s.uuid.loi }, { field_meta: { "/need": { reviewerVisible: false } } as never });
    const staff = await s.call<View>(s.funder, "POST", "/gms/assist/summary", { applicationId: appId });
    expect(Object.keys(staff.body.data.summary!).sort()).toEqual(["cautions", "fromExternalSystems", "openQuestions", "quotes", "strengths", "summary"]);
    expect(JSON.stringify(staff.body.data)).not.toMatch(/"(score|scores|rating|recommendation|outcome|decision)"/);
    expect(await h.repos.table("reviews").find({})).toHaveLength(0);
    expect(await h.repos.table("decisions").find({ workspace_id: WS_FUNDER })).toHaveLength(0);
    expect((await s.call<{ data: { status: string } }>(s.funder, "GET", `/gms/applications/${appId}`)).body.data.status).toBe("submitted");

    // A reviewer not assigned to it sees nothing; one assigned reads their own version.
    await h.repos.table("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: REVIEWER, role: "reviewer" });
    const reviewer = await sessionAs(REVIEWER, "reviewer@riverbendcf.example", WS_FUNDER);
    expect((await s.call(reviewer, "GET", `/gms/assist/summary?applicationId=${appId}`)).status).toBe(404);
    const rubric = (await h.repos.table("rubrics").find({ workspace_id: WS_FUNDER }))[0]!;
    await h.repos.table("review_assignments").insert({ workspace_id: WS_FUNDER, application_id: uuid, stage: "loi", reviewer_user_id: REVIEWER, rubric_id: rubric.id, rubric_version: rubric.version, status: "assigned" });
    // Not before they sign the competition's conflict-of-interest policy (v1.8.0).
    expect((await s.call(reviewer, "GET", `/gms/assist/summary?applicationId=${appId}`)).status).toBe(404);
    expect((await s.call(reviewer, "POST", "/gms/assist/summary", { applicationId: appId })).status).toBe(404);
    await signCoiPolicy(h, WS_FUNDER, s.uuid.comp, [REVIEWER]);
    const theirs = await s.call<View>(reviewer, "GET", `/gms/assist/summary?applicationId=${appId}`);
    expect(theirs.status).toBe(200);
    expect(theirs.body.data.responseVersion).not.toBe(staff.body.data.responseVersion);
    expect(theirs.body.data.summary).toBeNull();
    await s.call(reviewer, "POST", "/gms/assist/summary", { applicationId: appId });
    expect(h.llm.requests[1]!.user).not.toContain("46 miles");
    // An applicant cannot read the funder's summary.
    expect((await s.call(s.applicant, "GET", `/gms/assist/summary?applicationId=${appId}`)).status).toBe(403);
    void USER_OFFICER;
  });
});
