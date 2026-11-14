// SPDX-License-Identifier: AGPL-3.0-only
// Apply anywhere (v1.5.0): outside applications through the real routes over in-memory stores.
// Creating, editing, every stage change and its refusals, the human-only submission and decision
// (with the "as submitted" PDF and its stable hash), questions, the deterministic parse, answers
// with versions, counts and provenance, export, and the pipeline.
import { sha256Hex } from "@gms/documents";
import { beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { renderSnapshot } from "../src/services/outside.ts";
import { makeActor, type ServiceContext } from "../src/services/context.ts";
import { CLIENT_AGENT, WS_APPLICANT, bearer, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, USER_APPLICANT_EDITOR, scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;

type Data<T> = { data: T };
type Oa = { id: string; title: string; stage: string; funderName: string; funderRecordId: string | null; allowedMoves: string[]; askAmount: { amount: string; currency: string } | null; submission: { submittedAt: string; method: string; confirmationRef: string | null; snapshot: { documentId: string; sha256: string } | null } | null; decision: { decidedAt: string | null; awardedAmount: { amount: string } | null; notes: string | null; nextCycleOn: string | null } | null; questions: Q[]; questionCounts: { total: number; approved: number }; previousStage: string | null; archived: boolean };
type Q = { id: string; prompt: string; limit: { kind: string; value: number } | null; status: string; answer: { version: number; body: string; provenance: string; counts: { words: number; chars: number; charsNoSpaces: number }; overLimit: boolean } | null };

const data = async <T>(who: Record<string, string>, method: string, path: string, body?: unknown) => {
  const r = await s.call<Data<T>>(who, method, path, method === "GET" ? undefined : (body ?? {}));
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const create = (body: Record<string, unknown> = {}) => data<Oa>(s.applicant, "POST", "/gms/outside-applications", { title: "Rural clinics 2027", funderName: "Northwind Family Foundation", fullDue: "2027-05-01", askAmount: { amount: "50000.00", currency: "USD" }, ...body });
const agentHeaders = async (scope: string, extra: Record<string, unknown> = {}) => ({ ...bearer(await h.forge({ sub: USER_APPLICANT, client_id: CLIENT_AGENT, scope, [WORKSPACE_CLAIM]: WS_APPLICANT, jti: `tok-${Math.random()}`, ...extra })).headers, "Content-Type": "application/json" });
const ledgerOf = (type: string) => h.ledger.events.filter((e) => e.eventType === type);

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
});

describe("create, read, edit", () => {
  it("creates an outside application as drafting by default, owned by its creator", async () => {
    const oa = await create();
    expect(oa).toMatchObject({ title: "Rural clinics 2027", funderName: "Northwind Family Foundation", stage: "drafting", askAmount: { amount: "50000.00", currency: "USD" }, allowedMoves: ["withdrawn", "not_pursuing"], questionCounts: { total: 0, approved: 0 } });
    const list = await data<{ id: string; nextDeadline: { kind: string; date: string } | null; owner: { userId: string } | null }[]>(s.applicant, "GET", "/gms/outside-applications");
    expect(list).toEqual([expect.objectContaining({ id: oa.id, nextDeadline: { kind: "full", date: "2027-05-01" }, owner: expect.objectContaining({ userId: USER_APPLICANT }) })]);
    expect(ledgerOf("outside_application.created")).toEqual([expect.objectContaining({ workspaceId: WS_APPLICANT, subjectType: "outside_application", subjectId: oa.id, data: { source: "manual", stage: "drafting" } })]);
  });

  it("returns the existing prospect for the same OpenGrants listing (200, no duplicate)", async () => {
    const first = await s.call<Data<Oa>>(s.applicant, "POST", "/gms/outside-applications", { source: "opengrants", sourceRef: "og-1", title: "Rural Health Access Fund", funderName: "Northwind", stage: "prospect", listing: { funder: "Northwind", amount: "$25,000", url: "https://opengrants.example/grants/og-1" } });
    expect(first.status).toBe(201);
    const again = await s.call<Data<Oa>>(s.applicant, "POST", "/gms/outside-applications", { source: "opengrants", sourceRef: "og-1", title: "Something else", funderName: "Northwind" });
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(first.body.data.id);
    expect(await h.repos.table("outside_applications").count({ workspace_id: WS_APPLICANT })).toBe(1);
  });

  it("refuses an OpenGrants listing without its id, a stage other than prospect or drafting, and unknown fields", async () => {
    expect((await s.call(s.applicant, "POST", "/gms/outside-applications", { source: "opengrants", title: "X", funderName: "Y" })).status).toBe(400);
    expect((await s.call(s.applicant, "POST", "/gms/outside-applications", { title: "X", funderName: "Y", stage: "submitted" })).status).toBe(400);
    expect((await s.call(s.applicant, "POST", "/gms/outside-applications", { title: "X", funderName: "Y", workspaceId: "other" })).status).toBe(400);
    expect((await s.call(s.applicant, "POST", "/gms/outside-applications", { title: "X", funderName: "Y", listingUrl: "javascript:alert(1)" })).status).toBe(400);
  });

  it("sends a link to an opportunity open on this GMS to the built-in application", async () => {
    const res = await s.call<{ errors: { code: string; detail?: string }[] }>(s.applicant, "POST", "/gms/outside-applications", { source: "link", title: "Community Health Grants 2027", funderName: "Riverbend", listingUrl: "https://app.gms.test/f/riverbend/o/community-health-grants-2027" });
    expect(res.status).toBe(409);
    expect(res.body.errors[0]!.code).toBe("apply_here");
    // Tracking it as a prospect is fine.
    expect((await s.call(s.applicant, "POST", "/gms/outside-applications", { source: "link", title: "Community Health Grants 2027", funderName: "Riverbend", listingUrl: "https://app.gms.test/f/riverbend/o/community-health-grants-2027", stage: "prospect" })).status).toBe(201);
  });

  it("edits ordinary fields but never the stage, the submission or the decision", async () => {
    const oa = await create();
    const edited = await data<Oa & { askByYear: unknown[]; customFields: Record<string, unknown> }>(s.applicant, "PATCH", `/gms/outside-applications/${oa.id}`, { title: "Rural clinics 2027-28", askByYear: [{ year: 2027, amount: { amount: "25000.00", currency: "USD" } }, { year: 2028, amount: { amount: "25000.00", currency: "USD" } }], customFields: { region: "Valley", priority: 2 }, ownerUserId: USER_APPLICANT_EDITOR });
    expect(edited).toMatchObject({ title: "Rural clinics 2027-28", askByYear: [{ year: 2027, amount: { amount: "25000.00" } }, { year: 2028, amount: { amount: "25000.00" } }], customFields: { region: "Valley", priority: 2 } });
    for (const body of [{ stage: "submitted" }, { submittedAt: "2027-04-01" }, { awardedAmount: { amount: "1.00", currency: "USD" } }, { decisionNotes: "x" }]) expect((await s.call(s.applicant, "PATCH", `/gms/outside-applications/${oa.id}`, body)).status).toBe(400);
    expect((await s.call(s.applicant, "PATCH", `/gms/outside-applications/${oa.id}`, { ownerUserId: "00000000-0000-4000-8000-000000000000" })).status).toBe(422);
  });

  it("refuses custom fields that would hold bank, identity or password details", async () => {
    const oa = await create();
    const key = ["S", "SN"].join("");
    expect((await s.call(s.applicant, "PATCH", `/gms/outside-applications/${oa.id}`, { customFields: { [key]: "x" } })).status).toBe(400);
    expect((await s.call(s.applicant, "PATCH", `/gms/outside-applications/${oa.id}`, { customFields: { "portal password": "x" } })).status).toBe(400);
    expect((await s.call(s.applicant, "PATCH", `/gms/outside-applications/${oa.id}`, { customFields: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`k${i}`, i])) })).status).toBe(400);
  });

  it("links a funder record by name, and lists by stage, search and archive", async () => {
    const record = await data<{ id: string }>(s.applicant, "POST", "/gms/funder-records", { name: "Northwind Family Foundation" });
    const oa = await create({ funderName: "northwind family foundation" });
    expect(oa.funderRecordId).toBe(record.id);
    const other = await create({ title: "Capacity building", funderName: "Cascade Trust", stage: "prospect" });
    expect((await data<unknown[]>(s.applicant, "GET", "/gms/outside-applications?stage=prospect")).map((x) => (x as { id: string }).id)).toEqual([other.id]);
    expect((await data<unknown[]>(s.applicant, "GET", "/gms/outside-applications?q=cascade")).length).toBe(1);
    await data(s.applicant, "POST", `/gms/outside-applications/${other.id}/archive`);
    expect((await data<unknown[]>(s.applicant, "GET", "/gms/outside-applications")).length).toBe(1);
    expect((await data<unknown[]>(s.applicant, "GET", "/gms/outside-applications?archived=true")).length).toBe(1);
    expect((await s.call(s.applicant, "GET", "/gms/outside-applications?stage=paid")).status).toBe(400);
  });
});

describe("stage changes", () => {
  it("moves along plain edges and refuses the rest with a reason", async () => {
    const oa = await create({ stage: "prospect" });
    const moved = await data<Oa>(s.applicant, "POST", `/gms/outside-applications/${oa.id}/stage`, { to: "loi" });
    expect(moved).toMatchObject({ stage: "loi", previousStage: "prospect", allowedMoves: ["invited", "withdrawn", "not_pursuing"] });
    const refused = await s.call<{ errors: { code: string }[]; message: string }>(s.applicant, "POST", `/gms/outside-applications/${oa.id}/stage`, { to: "submitted" });
    expect(refused.status).toBe(409);
    expect(refused.body.errors[0]!.code).toBe("guard_failed");
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${oa.id}/stage`, { to: "awarded" })).status).toBe(409);
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${oa.id}/stage`, { to: "drafting" })).status).toBe(409);
    await data(s.applicant, "POST", `/gms/outside-applications/${oa.id}/stage`, { to: "invited" });
    await data(s.applicant, "POST", `/gms/outside-applications/${oa.id}/stage`, { to: "drafting" });
    expect(ledgerOf("outside_application.stage_changed").map((e) => e.data)).toEqual([{ from: "prospect", to: "loi" }, { from: "loi", to: "invited" }, { from: "invited", to: "drafting" }]);
  });

  it("nothing moves while archived; reopen returns to the stage before", async () => {
    const oa = await create();
    await data(s.applicant, "POST", `/gms/outside-applications/${oa.id}/stage`, { to: "not_pursuing" });
    await data(s.applicant, "POST", `/gms/outside-applications/${oa.id}/archive`);
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${oa.id}/reopen`)).status).toBe(409);
    expect((await s.call(s.applicant, "PATCH", `/gms/outside-applications/${oa.id}`, { title: "Edited" })).status).toBe(409);
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${oa.id}/questions`, { prompt: "Q?" })).status).toBe(409);
    await data(s.applicant, "POST", `/gms/outside-applications/${oa.id}/unarchive`);
    expect(await data<Oa>(s.applicant, "POST", `/gms/outside-applications/${oa.id}/reopen`)).toMatchObject({ stage: "drafting", previousStage: "not_pursuing" });
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${oa.id}/reopen`)).status).toBe(409);
    expect(ledgerOf("outside_application.archived").map((e) => e.data.archived)).toEqual([true, false]);
    expect(ledgerOf("outside_application.reopened")).toHaveLength(1);
  });

  it("is refused to people who only read, and to another workspace", async () => {
    const oa = await create();
    await h.repos.table("workspace_members").insert({ workspace_id: WS_APPLICANT, user_id: "77777777-7777-4777-8777-777777777777", role: "viewer" });
    const viewer = { ...bearer(await h.session("77777777-7777-4777-8777-777777777777")).headers, "X-GMS-Workspace": WS_APPLICANT, "Content-Type": "application/json" };
    expect((await s.call(viewer, "GET", `/gms/outside-applications/${oa.id}`)).status).toBe(200);
    expect((await s.call(viewer, "POST", `/gms/outside-applications/${oa.id}/stage`, { to: "withdrawn" })).status).toBe(403);
  });
});

describe("submission and decision (human only)", () => {
  const submit = (id: string, who = s.applicant, body: Record<string, unknown> = { submittedAt: "2027-04-15T12:00:00Z", method: "portal", confirmationRef: "NW-0412" }) => s.call<Data<Oa>>(who, "POST", `/gms/outside-applications/${id}/submit`, body);

  it("records the submission with an as-submitted PDF whose hash is stable", async () => {
    const oa = await create();
    const [q] = await data<Q[]>(s.applicant, "POST", `/gms/outside-applications/${oa.id}/questions`, { questions: [{ prompt: "Describe the need.", limitKind: "words", limitValue: 250 }] });
    await data(s.applicant, "PUT", `/gms/outside-questions/${q!.id}/answer`, { body: "Families travel 46 miles to reach a clinic." });
    const res = await submit(oa.id);
    expect(res.status).toBe(200);
    const sub = res.body.data.submission!;
    expect(sub).toMatchObject({ submittedAt: "2027-04-15T12:00:00.000Z", method: "portal", confirmationRef: "NW-0412" });
    expect(sub.snapshot!.sha256).toMatch(/^[0-9a-f]{64}$/);
    // The stored bytes hash to the recorded value, and rendering the same answers again gives the same hash.
    const pdf = await h.request(`/gms/outside-applications/${oa.id}/snapshot.pdf`, { headers: s.applicant });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(await sha256Hex(bytes)).toBe(sub.snapshot!.sha256);
    const row = (await h.repos.table("outside_applications").one({ id: oa.id }))!;
    const ctx = { repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, config: { baseUrl: "", webBaseUrl: "", passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: null }, ports: {}, actor: makeActor("user", USER_APPLICANT, null), workspace: null, scopes: [] } as ServiceContext;
    expect(await sha256Hex(await renderSnapshot(ctx, row, "2027-04-15T12:00:00.000Z", "portal", "NW-0412"))).toBe(sub.snapshot!.sha256);
    // The ledger holds stages, dates and ids; never the answer text or the confirmation.
    const e = ledgerOf("outside_application.submitted")[0]!;
    expect(e.data).toEqual({ from: "drafting", to: "submitted", submittedAt: "2027-04-15T12:00:00.000Z", snapshotDocumentId: sub.snapshot!.documentId });
    expect(JSON.stringify(h.ledger.events)).not.toContain("46 miles");
  });

  it("refuses a submission without the date or method, from the wrong stage, or in the future", async () => {
    const oa = await create({ stage: "prospect" });
    expect((await submit(oa.id)).status).toBe(409);
    await data(s.applicant, "POST", `/gms/outside-applications/${oa.id}/stage`, { to: "drafting" });
    expect((await submit(oa.id, s.applicant, { method: "portal" })).status).toBe(400);
    expect((await submit(oa.id, s.applicant, { submittedAt: "2027-04-15", method: "fax" })).status).toBe(400);
    expect((await submit(oa.id, s.applicant, { submittedAt: "2030-01-01", method: "portal" })).status).toBe(422);
    expect(await h.repos.table("documents").count({ subject_type: "outside_application" })).toBe(0);
  });

  it("refuses an agent, even one holding approvals:bypass, for the submission and the decision", async () => {
    const oa = await create();
    for (const scope of ["applications:read applications:write", "applications:read applications:write approvals:bypass"]) {
      const agent = await agentHeaders(scope);
      const r = await s.call<{ errors: { code: string }[] }>(agent, "POST", `/gms/outside-applications/${oa.id}/submit`, { submittedAt: "2027-04-15", method: "portal" });
      expect(r.status).toBe(403);
      expect(r.body.errors[0]!.code).toBe("approval_required");
      expect((await s.call(agent, "POST", `/gms/outside-applications/${oa.id}/decision`, { outcome: "withdrawn" })).status).toBe(403);
    }
    // An agent still moves plain stages: the UI's capabilities.
    expect((await s.call(await agentHeaders("applications:read applications:write"), "POST", `/gms/outside-applications/${oa.id}/stage`, { to: "not_pursuing" })).status).toBe(200);
  });

  it("records a decision: awarded needs an amount; reopening clears it", async () => {
    const oa = await create();
    await submit(oa.id);
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${oa.id}/decision`, { outcome: "awarded" })).status).toBe(400);
    const won = await data<Oa>(s.applicant, "POST", `/gms/outside-applications/${oa.id}/decision`, { outcome: "awarded", awardedAmount: { amount: "40000.00", currency: "USD" }, awardByYear: [{ year: 2027, amount: { amount: "40000.00", currency: "USD" } }], grantStart: "2027-07-01", grantEnd: "2028-06-30", notes: "Funded at 80%." });
    expect(won).toMatchObject({ stage: "awarded", decision: { awardedAmount: { amount: "40000.00" }, notes: "Funded at 80%." } });
    expect(ledgerOf("outside_application.decided")[0]!.data).toEqual({ from: "submitted", to: "awarded", decidedAt: h.clock.now.toISOString() });
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${oa.id}/decision`, { outcome: "declined" })).status).toBe(409);
    const reopened = await data<Oa>(s.applicant, "POST", `/gms/outside-applications/${oa.id}/reopen`);
    expect(reopened).toMatchObject({ stage: "submitted" });
    expect(reopened.decision).toMatchObject({ decidedAt: null, awardedAmount: null });
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${oa.id}/decision`, { outcome: "declined", nextCycleOn: "2028-01-15" })).status).toBe(200);
  });

  it("declines straight from a letter of inquiry and refuses an award there", async () => {
    const oa = await create({ stage: "prospect" });
    await data(s.applicant, "POST", `/gms/outside-applications/${oa.id}/stage`, { to: "loi" });
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${oa.id}/decision`, { outcome: "awarded", awardedAmount: { amount: "1.00", currency: "USD" } })).status).toBe(409);
    expect(await data<Oa>(s.applicant, "POST", `/gms/outside-applications/${oa.id}/decision`, { outcome: "declined" })).toMatchObject({ stage: "declined" });
  });
});

describe("questions and answers", () => {
  it("parses pasted text deterministically, saves nothing, and reserves the assistant mode", async () => {
    const oa = await create();
    const parsed = await data<{ questions: { prompt: string; limitKind?: string; limitValue?: number; phase: string }[] }>(s.applicant, "POST", `/gms/outside-applications/${oa.id}/questions/parse`, { text: "1. Describe the need. (250 words)\n2. Budget narrative, max 1,500 characters\n3. Partners? 2,000 characters excluding spaces" });
    expect(parsed.questions).toEqual([
      { prompt: "Describe the need.", limitKind: "words", limitValue: 250, phase: "full" },
      { prompt: "Budget narrative, max 1,500 characters", limitKind: "chars", limitValue: 1500, phase: "full" },
      { prompt: "Partners? 2,000 characters excluding spaces", limitKind: "chars_no_spaces", limitValue: 2000, phase: "full" },
    ]);
    expect(await h.repos.table("outside_questions").count({})).toBe(0);
    const ai = await s.call<{ errors: { code: string }[] }>(s.applicant, "POST", `/gms/outside-applications/${oa.id}/questions/parse`, { text: "x", mode: "ai" });
    expect(ai.status).toBe(501);
    expect(ai.body.errors[0]!.code).toBe("not_available_yet");
  });

  it("saves every answer as a version with counts, the over-limit flag and provenance", async () => {
    const oa = await create();
    const [q] = await data<Q[]>(s.applicant, "POST", `/gms/outside-applications/${oa.id}/questions`, { questions: [{ prompt: "In ten words?", limitKind: "words", limitValue: 3 }] });
    const first = await data<{ version: number; counts: { words: number; chars: number; charsNoSpaces: number }; overLimit: boolean; provenance: string; question: Q }>(s.applicant, "PUT", `/gms/outside-questions/${q!.id}/answer`, { body: "Families travel far." });
    expect(first).toMatchObject({ version: 1, counts: { words: 3, chars: 20, charsNoSpaces: 18 }, overLimit: false, provenance: "user", question: { status: "draft" } });
    const second = await data<{ version: number; overLimit: boolean }>(s.applicant, "PUT", `/gms/outside-questions/${q!.id}/answer`, { body: "Families travel 46 miles." });
    expect(second).toMatchObject({ version: 2, overLimit: true });
    const agent = await data<{ version: number; provenance: string }>(await agentHeaders("applications:read applications:write"), "PUT", `/gms/outside-questions/${q!.id}/answer`, { body: "Too far." });
    expect(agent).toMatchObject({ version: 3, provenance: `agent:${CLIENT_AGENT}` });
    const history = await data<{ version: number; body: string }[]>(s.applicant, "GET", `/gms/outside-questions/${q!.id}/answers`);
    expect(history.map((v) => v.version)).toEqual([3, 2, 1]);
    const detail = await data<Oa>(s.applicant, "GET", `/gms/outside-applications/${oa.id}`);
    expect(detail.questions[0]!.answer).toMatchObject({ version: 3, body: "Too far." });
  });

  it("records a library answer's use and marks it as from the library", async () => {
    const oa = await create();
    const [q] = await data<Q[]>(s.applicant, "POST", `/gms/outside-applications/${oa.id}/questions`, { prompt: "Need?" });
    const lib = await data<{ id: string }>(s.applicant, "POST", "/gms/my/answers", { title: "Need statement", body: "Families travel 46 miles." });
    const saved = await data<{ provenance: string; libraryAnswerId: string }>(s.applicant, "PUT", `/gms/outside-questions/${q!.id}/answer`, { body: "Families travel 46 miles.", libraryAnswerId: lib.id });
    expect(saved).toMatchObject({ provenance: "library", libraryAnswerId: lib.id });
    const answers = await data<{ id: string; usedIn: { outsideApplicationId?: string; questionId?: string; applicationTitle: string; funderName: string }[] }[]>(s.applicant, "GET", "/gms/my/answers");
    expect(answers.find((a) => a.id === lib.id)!.usedIn).toEqual([expect.objectContaining({ outsideApplicationId: oa.id, questionId: q!.id, applicationTitle: "Rural clinics 2027", funderName: "Northwind Family Foundation" })]);
    expect((await s.call(s.applicant, "PUT", `/gms/outside-questions/${q!.id}/answer`, { body: "x", libraryAnswerId: "0193a1c0-0000-7000-8000-00000000dead" })).status).toBe(404);
  });

  it("edits, approves and deletes questions; approval needs an answer and an edit sends it back to draft", async () => {
    const oa = await create();
    const [q] = await data<Q[]>(s.applicant, "POST", `/gms/outside-applications/${oa.id}/questions`, { prompt: "Need?" });
    expect((await s.call(s.applicant, "PATCH", `/gms/outside-questions/${q!.id}`, { status: "approved" })).status).toBe(422);
    await data(s.applicant, "PUT", `/gms/outside-questions/${q!.id}/answer`, { body: "Because." });
    expect(await data<Q>(s.applicant, "PATCH", `/gms/outside-questions/${q!.id}`, { status: "approved", limitKind: "chars", limitValue: 500, prompt: "What is the need?" })).toMatchObject({ status: "approved", prompt: "What is the need?", limit: { kind: "chars", value: 500 } });
    expect((await data<Oa>(s.applicant, "GET", `/gms/outside-applications/${oa.id}`)).questionCounts).toEqual({ total: 1, approved: 1 });
    expect((await data<{ question: Q }>(s.applicant, "PUT", `/gms/outside-questions/${q!.id}/answer`, { body: "Because, again." })).question.status).toBe("draft");
    expect(ledgerOf("outside_question.status_changed").map((e) => `${e.data.from}>${e.data.to}`)).toEqual(["empty>draft", "draft>approved", "approved>draft"]);
    expect(await data<Q>(s.applicant, "PATCH", `/gms/outside-questions/${q!.id}`, { limitKind: null })).toMatchObject({ limit: null });
    await data(s.applicant, "DELETE", `/gms/outside-questions/${q!.id}`);
    expect(await h.repos.table("outside_answers").count({ question_id: q!.id })).toBe(0);
    expect((await s.call(s.applicant, "PATCH", `/gms/outside-questions/${q!.id}`, { prompt: "x" })).status).toBe(404);
  });

  it("exports questions and latest answers as text, Markdown and PDF", async () => {
    const oa = await create();
    const [q] = await data<Q[]>(s.applicant, "POST", `/gms/outside-applications/${oa.id}/questions`, { prompt: "Describe the need.", limitKind: "words", limitValue: 250 });
    await data(s.applicant, "PUT", `/gms/outside-questions/${q!.id}/answer`, { body: "Families travel 46 miles." });
    const txt = await h.request(`/gms/outside-applications/${oa.id}/export?format=txt`, { headers: s.applicant });
    expect(await txt.text()).toBe("Rural clinics 2027\n\nFunder: Northwind Family Foundation\n\n1. Describe the need. (limit: 250 words)\n\nFamilies travel 46 miles.\n");
    const md = await (await h.request(`/gms/outside-applications/${oa.id}/export?format=md`, { headers: s.applicant })).text();
    expect(md).toContain("# Rural clinics 2027\n\n**Funder:** Northwind Family Foundation\n\n## 1. Describe the need.\n\n_Limit: 250 words_\n\nFamilies travel 46 miles.");
    const pdf = await h.request(`/gms/outside-applications/${oa.id}/export?format=pdf`, { headers: s.applicant });
    expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
    expect((await s.call(s.applicant, "GET", `/gms/outside-applications/${oa.id}/export?format=docx`)).status).toBe(400);
  });
});

describe("pipeline", () => {
  it("lists built-in applications, outside applications and saved GMS opportunities in one list", async () => {
    await s.call(s.applicant, "POST", "/common-grants/applications/start", { competitionId: s.uuid.comp });
    const oa = await create();
    await data(s.applicant, "POST", "/gms/discover/saved", { source: "gms", externalId: s.oppId, title: "Community Health Grants 2027", url: "https://app.gms.test/f/riverbend/o/community-health-grants-2027" });
    const items = await data<{ kind: string; id: string; title: string; funderName: string | null; stage: string | null; status: string | null; nextDeadline: string | null; url: string }[]>(s.applicant, "GET", "/gms/pipeline");
    expect(items.map((i) => i.kind).sort()).toEqual(["gms_application", "outside_application", "saved_gms"]);
    expect(items.find((i) => i.kind === "gms_application")).toMatchObject({ funderName: "Riverbend Community Foundation", status: "draft", nextDeadline: "2027-04-30" });
    expect(items.find((i) => i.kind === "outside_application")).toMatchObject({ id: oa.id, stage: "drafting", nextDeadline: "2027-05-01", url: `https://app.gms.test/w/alder-creek/outside/${oa.id}` });
    expect(items.find((i) => i.kind === "saved_gms")).toMatchObject({ funderName: "Riverbend Community Foundation", status: "saved" });
  });
});
