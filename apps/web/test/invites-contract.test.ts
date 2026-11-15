// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// Invite someone into a draft and the AI summary (v1.7.0), one scenario on two backends: the web
// HTTP clients (api/invites.ts, and the funder's AI summary calls) against the real API Worker
// in-process, and the in-browser mock. The same assertions run on both, on the fields the screens
// read, so the e2e flow in mock mode proves what a real install does.
import { beforeAll, describe, expect, it } from "vitest";
import { ApiError, type GmsApi } from "../src/api/client.ts";
import { createHttpInvitesApi, type InvitesApi } from "../src/api/invites.ts";
import { seedApplicantStore } from "../src/mocks/applicant.ts";
import { createMockApi } from "../src/mocks/api.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { MOCK_IDS } from "../src/mocks/funder.ts";
import { MOCK_USER } from "../src/mocks/fixtures.ts";
import { createMockInvitesApi, seedInvitesStore } from "../src/mocks/invites.ts";
import { OUTSIDE_IDS, seedOutsideStore } from "../src/mocks/outside.ts";
import { seedStore } from "../src/mocks/store.ts";
import { httpApiFor, loadApi, type ApiHarness } from "./api-harness.ts";

async function failure(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error("Expected the call to be refused");
}

interface Backend {
  /** The admin who invites. */
  admin: InvitesApi;
  /** The invited person, signed in with the invited address. */
  invitee: InvitesApi;
  inviteeEmail: string;
  draftId: string;
  questionId: string;
  /** The waiting invitation's link token, as the email would carry it. */
  tokenFor: (email: string) => Promise<string>;
  assigneeOf: () => Promise<string | null>;
  inviteeUserId: string;
}
type Scenario = { applicant: Record<string, string>; call: (who: Record<string, string>, method: string, path: string, body?: unknown) => Promise<{ status: number; body: { data: unknown } }> };
type Mailbox = { mailer: { sent: { to: string[]; text: string }[] } };

const WS_APPLICANT = "33333333-3333-4333-8333-333333333333";
const USER_APPLICANT = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const INVITEE = "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0";

function inProcess(h: ApiHarness): typeof fetch {
  return async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const u = new URL(req.url);
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
    return h.request(u.pathname + u.search, { method: req.method, headers: req.headers, ...(body !== undefined ? { body } : {}) });
  };
}

async function realBackend(): Promise<Backend> {
  const helpers = await loadApi();
  const { scenario } = (await import(/* @vite-ignore */ new URL("../../api/test/scenario.ts", import.meta.url).href)) as { scenario: (h: ApiHarness) => Promise<Scenario> };
  const h = await helpers.harness();
  const s = await scenario(h);
  const oa = (await s.call(s.applicant, "POST", "/gms/outside-applications", { title: "Rural clinics 2027", funderName: "Northwind Family Foundation", stage: "drafting" })).body.data as { id: string };
  const qs = (await s.call(s.applicant, "POST", `/gms/outside-applications/${oa.id}/questions`, { prompt: "Describe the need your project addresses." })).body.data as { id: string }[];
  const client = (userId: string) => createHttpInvitesApi({ baseUrl: helpers.BASE, token: () => h.session(userId), workspaceId: () => WS_APPLICANT, fetch: inProcess(h) });
  const mailbox = h as unknown as Mailbox;
  return {
    admin: client(USER_APPLICANT),
    invitee: client(INVITEE),
    // The harness signs every session with this address.
    inviteeEmail: "person@riverbendcf.example",
    draftId: oa.id,
    questionId: qs[0]!.id,
    tokenFor: async (email) => new URL(mailbox.mailer.sent.filter((m) => m.to.includes(email)).at(-1)!.text.match(/https:\/\/\S+/)![0]).searchParams.get("token")!,
    assigneeOf: async () => ((await h.repos.table("outside_questions").find({ id: qs[0]!.id }))[0]?.assignee_user_id as string | null) ?? null,
    inviteeUserId: INVITEE,
  };
}

async function mockBackend(): Promise<Backend> {
  const applicant = seedApplicantStore();
  const outside = seedOutsideStore();
  const store = seedInvitesStore();
  const api = createMockInvitesApi({ session: async () => demoSession(), applicant, outside, store });
  const questionId = outside.applications.find((a) => a.id === OUTSIDE_IDS.northwind)!.questions[2]!.id;
  // The seeded invitation is for the demo person; this scenario sends its own.
  store.invitations.length = 0;
  return {
    admin: api,
    invitee: api,
    inviteeEmail: MOCK_USER.email,
    draftId: OUTSIDE_IDS.northwind,
    questionId,
    tokenFor: async (email) => store.invitations.find((i) => i.email === email)!.token,
    assigneeOf: async () => outside.applications.find((a) => a.id === OUTSIDE_IDS.northwind)!.questions[2]!.assigneeUserId,
    inviteeUserId: "10000000-0000-4000-8000-0000000000aa",
  };
}

describe.each([
  ["the API Worker over HTTP", realBackend],
  ["the mock API", mockBackend],
])("InvitesApi contract: %s", (name, make) => {
  let b: Backend;
  beforeAll(async () => {
    b = await make();
  });

  it("invites into a question once, lists it masked, refuses a second email and lands the person on the draft", async () => {
    const sent = await b.admin.inviteToDraft({ email: b.inviteeEmail.toUpperCase(), draft: { kind: "outside_application", id: b.draftId, questionId: b.questionId } });
    expect(sent).toMatchObject({ role: "consultant", emailed: true, acceptUrl: null, draft: { kind: "outside_application", id: b.draftId, questionId: b.questionId } });
    expect(sent.email).toMatch(/^.…@/);
    expect(sent.email).not.toContain(b.inviteeEmail.split("@")[0]!);

    const list = await b.admin.draftInvitations("outside_application", b.draftId);
    expect(list).toMatchObject({ canInvite: true, perDay: 20, remainingToday: 19 });
    expect(list.invitations).toEqual([expect.objectContaining({ email: sent.email, draft: expect.objectContaining({ questionId: b.questionId }) })]);

    const again = await failure(b.admin.inviteToDraft({ email: b.inviteeEmail, draft: { kind: "outside_application", id: b.draftId } }));
    expect(again.status).toBe(409);
    expect(again.message).toMatch(/already has an invitation waiting/);
    expect((await failure(b.admin.inviteToDraft({ email: "not an address", draft: { kind: "outside_application", id: b.draftId } }))).status).toBeGreaterThanOrEqual(400);

    const accepted = await b.invitee.acceptDraftInvitation(await b.tokenFor(b.inviteeEmail));
    expect(accepted.workspace.handle).toBe("alder-creek");
    expect(accepted.draft).toMatchObject({ kind: "outside_application", id: b.draftId, questionId: b.questionId, assigned: true });
    expect(await b.assigneeOf()).not.toBeNull();
    // The link works once.
    expect((await failure(b.invitee.acceptDraftInvitation(await b.tokenFor(b.inviteeEmail)))).status).toBe(404);
    expect((await b.admin.draftInvitations("outside_application", b.draftId)).invitations).toEqual([]);
    void name;
  });

  it("keeps the one-time note dismissed", async () => {
    expect(await b.admin.dismissedNotes()).toEqual([]);
    expect(await b.admin.dismissNote("invite_teammate")).toEqual(["invite_teammate"]);
    expect(await b.admin.dismissedNotes()).toEqual(["invite_teammate"]);
  });
});

// ------------------------------------------------------------------------------------ AI summary

interface SummaryBackend {
  api: GmsApi;
  applicationId: string;
  /** Switches the assistant off (the server's env, or the mock's switch). */
  off: () => void;
}
type LlmHarness = ApiHarness & { env: Record<string, string | undefined>; llmAnswer: { value: unknown } };

async function realSummaries(): Promise<SummaryBackend> {
  const helpers = await loadApi();
  const { scenario } = (await import(/* @vite-ignore */ new URL("../../api/test/scenario.ts", import.meta.url).href)) as { scenario: (h: ApiHarness) => Promise<Scenario & { uuid: { comp: string; loi: string } }> };
  const h = (await helpers.harness()) as LlmHarness;
  const s = await scenario(h);
  const started = (await s.call(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp })).body.data as { id: string };
  await s.call(s.applicant, "PUT", `/common-grants/applications/${started.id}/forms/${s.uuid.loi}`, { response: { projectTitle: "Mobile Health Navigation", requestedAmount: { amount: "150000.00", currency: "USD" }, need: "Families travel 46 miles." } });
  await s.call(s.applicant, "PUT", `/common-grants/applications/${started.id}/submit`);
  h.env.ASSISTANT_ENABLED = "true";
  h.llmAnswer.value = { summary: "Asks for mobile health navigation.", strengths: ["Clear need"], openQuestions: [], quotes: [{ field: "need", text: "Families travel 46 miles." }], fromExternalSystems: [], cautions: [] };
  const api = httpApiFor(helpers, h, helpers.USER_ADMIN);
  await api.workspace("riverbend");
  return { api, applicationId: `app_${started.id}`, off: () => (h.env.ASSISTANT_ENABLED = "false") };
}

async function mockSummaries(): Promise<SummaryBackend> {
  const api = createMockApi({ session: async () => demoSession(), store: seedStore() });
  await api.workspace("riverbend");
  return { api, applicationId: MOCK_IDS.copper, off: () => ((globalThis as { __GMS_MOCK_ASSIST__?: unknown }).__GMS_MOCK_ASSIST__ = false) };
}

describe.each([
  ["the API Worker over HTTP", realSummaries],
  ["the mock API", mockSummaries],
])("AI summary contract: %s", (_name, make) => {
  it("is written on the first request, kept for every reviewer without spending again, and gone when the assistant is off", async () => {
    const b = await make();
    try {
      const before = await b.api.aiSummary(b.applicationId);
      expect(before).toMatchObject({ draft: true, label: "Review before relying on it", cached: false, summary: null, generatedAt: null });
      const written = await b.api.writeAiSummary(b.applicationId);
      expect(written).toMatchObject({ cached: false, responseVersion: before.responseVersion, summary: { summary: expect.any(String), strengths: expect.any(Array), openQuestions: expect.any(Array), quotes: expect.any(Array), cautions: expect.any(Array) } });
      expect(written.quota.used).toBe(before.quota.used + 1);
      const again = await b.api.writeAiSummary(b.applicationId);
      expect(again).toMatchObject({ cached: true, summary: written.summary, quota: { used: written.quota.used } });
      expect((await b.api.aiSummary(b.applicationId)).summary).toEqual(written.summary);
      for (const k of ["score", "scores", "recommendation", "decision"]) expect(Object.keys(written.summary!)).not.toContain(k);
      b.off();
      expect((await b.api.assistStatus()).enabled).toBe(false);
      expect((await failure(b.api.aiSummary(b.applicationId))).status).toBe(404);
      expect((await failure(b.api.writeAiSummary(b.applicationId))).status).toBe(404);
    } finally {
      delete (globalThis as { __GMS_MOCK_ASSIST__?: unknown }).__GMS_MOCK_ASSIST__;
    }
  });
});
