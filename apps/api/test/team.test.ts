// SPDX-License-Identifier: AGPL-3.0-only
// Deciding and writing as a team (v1.6.0) through the real routes: the go/no-go scorecard and its
// workflow moves, who may approve an answer, comments per question, milestones and the calendar.
import { beforeEach, describe, expect, it } from "vitest";
import { scoreTotal } from "../src/services/team.ts";
import { WS_APPLICANT, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, USER_APPLICANT_EDITOR, scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;
type Data<T> = { data: T };
type Err = { message: string; errors: { code: string }[] };

const data = async <T>(who: Record<string, string>, method: string, path: string, body?: unknown) => {
  const r = await s.call<Data<T>>(who, method, path, method === "GET" ? undefined : (body ?? {}));
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const create = (who: Record<string, string>, body: Record<string, unknown> = {}) => data<{ id: string; stage: string }>(who, "POST", "/gms/outside-applications", { title: "Rural clinics 2027", funderName: "Northwind", fullDue: "2027-06-01", ...body });
const ledgerOf = (type: string) => h.ledger.events.filter((e) => e.eventType === type);
const CARD = { eligibility: "pass", scores: { fit: 5, capacity: 4, effort: 3, relationship: 1 } };

beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
});

describe("go/no-go", () => {
  const deciding = async () => {
    const oa = await create(s.applicant, { stage: "prospect" });
    await data(s.applicant, "POST", `/gms/outside-applications/${oa.id}/stage`, { to: "deciding" });
    return oa.id;
  };

  it("is off by default, and an admin switches it on with its weights", async () => {
    const id = await deciding();
    const off = await s.call<Err>(s.applicant, "POST", `/gms/outside-applications/${id}/go-no-go`, { ...CARD, decision: "go", to: "drafting" });
    expect(off.status).toBe(409);
    expect(off.body.errors[0]!.code).toBe("go_no_go_off");
    expect((await data<{ goNoGo: { enabled: boolean; weights: Record<string, number> } }>(s.applicant, "GET", `/gms/outside-applications/${id}`)).goNoGo).toMatchObject({ enabled: false, weights: { fit: 3, capacity: 2, effort: 2, relationship: 1 } });
    await data(s.applicant, "PATCH", `/gms/workspaces/${WS_APPLICANT}`, { settings: { goNoGoEnabled: true, goNoGoWeights: { fit: 4, capacity: 2, effort: 2, relationship: 2 } } });
    expect((await data<{ goNoGo: { enabled: boolean; weights: Record<string, number> } }>(s.applicant, "GET", `/gms/outside-applications/${id}`)).goNoGo).toMatchObject({ enabled: true, weights: { fit: 4, relationship: 2 } });
    expect((await s.call(s.applicant, "PATCH", `/gms/workspaces/${WS_APPLICANT}`, { settings: { goNoGoWeights: { fit: 0, capacity: 0, effort: 0, relationship: 0 } } })).status).toBe(422);
  });

  it("go moves to the stage the person picks, no-go to not pursuing, through the workflow, with the scorecard kept", async () => {
    await data(s.applicant, "PATCH", `/gms/workspaces/${WS_APPLICANT}`, { settings: { goNoGoEnabled: true } });
    const a = await deciding();
    const went = await data<{ stage: string; goNoGo: { scorecard: { decision: string; total: number; scores: Record<string, unknown>; decidedBy: string; to: string } } }>(s.applicant, "POST", `/gms/outside-applications/${a}/go-no-go`, { ...CARD, decision: "go", to: "loi", reason: "Strong fit." });
    expect(went.stage).toBe("loi");
    expect(went.goNoGo.scorecard).toMatchObject({ decision: "go", total: scoreTotal({ fit: 5, capacity: 4, effort: 3, relationship: 1 }, { fit: 3, capacity: 2, effort: 2, relationship: 1 }), scores: { eligibility: "pass", fit: 5 }, decidedBy: USER_APPLICANT, to: "loi" });
    expect(went.goNoGo.scorecard.total).toBe(3.75);
    const b = await deciding();
    const stopped = await data<{ stage: string }>(s.applicant, "POST", `/gms/outside-applications/${b}/go-no-go`, { ...CARD, eligibility: "fail", decision: "no_go" });
    expect(stopped.stage).toBe("not_pursuing");
    expect(ledgerOf("outside_application.go_no_go_decided").map((e) => e.data)).toEqual([
      { from: "deciding", to: "loi", decision: "go", total: 3.75 },
      { from: "deciding", to: "not_pursuing", decision: "no_go", total: 3.75 },
    ]);
    // Not eligible cannot go; a go needs its target; the decision is made while deciding.
    const c = await deciding();
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${c}/go-no-go`, { ...CARD, eligibility: "fail", decision: "go", to: "drafting" })).status).toBe(400);
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${c}/go-no-go`, { ...CARD, decision: "go" })).status).toBe(400);
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${c}/go-no-go`, { ...CARD, scores: { ...CARD.scores, fit: 6 }, decision: "no_go" })).status).toBe(400);
    const drafting = await create(s.applicant);
    expect((await s.call<Err>(s.applicant, "POST", `/gms/outside-applications/${drafting.id}/go-no-go`, { ...CARD, decision: "no_go" })).body.errors[0]!.code).toBe("invalid_transition");
  });
});

describe("approving answers", () => {
  it("lets only a workspace admin or the application's owner approve, and ledgers every status change", async () => {
    // The editor owns this one; the admin owns the other.
    const own = await create(s.editor);
    const other = await create(s.applicant, { title: "Admin's application" });
    const q = async (id: string) => (await data<{ id: string }[]>(s.applicant, "POST", `/gms/outside-applications/${id}/questions`, { prompt: "Need?" }))[0]!.id;
    const q1 = await q(own.id);
    const q2 = await q(other.id);
    for (const qid of [q1, q2]) await data(s.editor, "PUT", `/gms/outside-questions/${qid}/answer`, { body: "Families travel far." });
    // The editor approves on their own application, not on the admin's.
    expect((await data<{ status: string }>(s.editor, "PATCH", `/gms/outside-questions/${q1}`, { status: "approved" })).status).toBe("approved");
    const refused = await s.call<Err>(s.editor, "PATCH", `/gms/outside-questions/${q2}`, { status: "approved", prompt: "Changed?" });
    expect(refused.status).toBe(403);
    expect(refused.body.errors[0]!.code).toBe("approver_required");
    // Nothing else in the refused request was written.
    expect((await h.repos.table("outside_questions").one({ id: q2 }))!.prompt).toBe("Need?");
    // The editor may still mark it ready; the admin approves anything.
    expect((await data<{ status: string }>(s.editor, "PATCH", `/gms/outside-questions/${q2}`, { status: "ready" })).status).toBe("ready");
    expect((await data<{ status: string }>(s.applicant, "PATCH", `/gms/outside-questions/${q2}`, { status: "approved" })).status).toBe("approved");
    expect(ledgerOf("outside_question.status_changed").map((e) => `${e.subjectId === q1 ? "q1" : "q2"}:${(e.data as { from: string }).from}>${(e.data as { to: string }).to}`)).toEqual(["q1:empty>draft", "q2:empty>draft", "q1:draft>approved", "q2:draft>ready", "q2:ready>approved"]);
  });
});

describe("comments per question", () => {
  it("keeps a team thread per application, comments by question, private to the workspace", async () => {
    const oa = await create(s.applicant);
    const [q1, q2] = await data<{ id: string }[]>(s.applicant, "POST", `/gms/outside-applications/${oa.id}/questions`, { questions: [{ prompt: "Need?" }, { prompt: "Budget?" }] });
    const c1 = await data<{ id: string; questionId: string; body: string }>(s.editor, "POST", `/gms/outside-questions/${q1!.id}/comments`, { body: "Can we cite the county numbers?" });
    await data(s.applicant, "POST", `/gms/outside-questions/${q2!.id}/comments`, { body: "Use the FY27 budget." });
    expect(c1).toMatchObject({ questionId: q1!.id, body: "Can we cite the county numbers?" });
    expect(await data<unknown[]>(s.applicant, "GET", `/gms/outside-applications/${oa.id}/comments`)).toHaveLength(2);
    expect((await data<{ id: string }[]>(s.applicant, "GET", `/gms/outside-applications/${oa.id}/comments?questionId=${q1!.id}`)).map((c) => c.id)).toEqual([c1.id]);
    const resolved = await data<{ resolvedAt: string | null; resolvedBy: string }>(s.applicant, "POST", `/gms/outside-applications/${oa.id}/comments/${c1.id}/resolve`);
    expect(resolved).toMatchObject({ resolvedAt: h.clock.now.toISOString(), resolvedBy: USER_APPLICANT });
    const thread = (await h.repos.table("threads").find({ subject_type: "outside_application", subject_id: oa.id }))[0]!;
    expect(thread).toMatchObject({ workspace_id: WS_APPLICANT, applicant_workspace_id: WS_APPLICANT, funder_workspace_id: null, visibility: "applicant_internal" });
    expect((await s.call(s.funder, "GET", `/gms/outside-applications/${oa.id}/comments`)).status).toBe(403);
    expect(ledgerOf("outside_question.commented")).toHaveLength(2);
    // Comment text never reaches the ledger.
    expect(JSON.stringify(ledgerOf("outside_question.commented"))).not.toContain("county numbers");
  });
});

describe("milestones and the calendar", () => {
  it("offers draft, review and final tasks from the full deadline, and creates what the person confirms", async () => {
    const oa = await create(s.applicant, { fullDue: "2027-06-01" });
    const offer = await data<{ fullDue: string; tasks: { key: string; title: string; dueOn: string; assigneeUserId: string }[] }>(s.applicant, "GET", `/gms/outside-applications/${oa.id}/milestones`);
    expect(offer.tasks.map((t) => [t.key, t.dueOn])).toEqual([["draft", "2027-05-18"], ["review", "2027-05-25"], ["final", "2027-05-30"]]);
    expect(offer.tasks[0]!.assigneeUserId).toBe(USER_APPLICANT);
    expect(await h.repos.table("tasks").count({ subject_id: oa.id })).toBe(0);
    const made = await data<{ id: string; dueAt: string; assigneeUserId: string | null }[]>(s.applicant, "POST", `/gms/outside-applications/${oa.id}/milestones`, { tasks: [{ title: "Draft due", dueOn: "2027-05-17", assigneeUserId: USER_APPLICANT_EDITOR }, { title: "Final", dueOn: "2027-05-30" }] });
    expect(made.map((t) => t.dueAt)).toEqual(["2027-05-17T17:00:00.000Z", "2027-05-30T17:00:00.000Z"]);
    expect((await data<{ tasks: { title: string }[] }>(s.applicant, "GET", `/gms/outside-applications/${oa.id}`)).tasks.map((t) => t.title)).toEqual(["Draft due", "Final"]);
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${oa.id}/milestones`, { tasks: [{ title: "X", dueOn: "2027-05-17", assigneeUserId: crypto.randomUUID() }] })).status).toBe(422);
    const none = await create(s.applicant, { fullDue: undefined, title: "No deadline" });
    expect(await data(s.applicant, "GET", `/gms/outside-applications/${none.id}/milestones`)).toEqual({ fullDue: null, tasks: [] });
  });

  it("lays the month's deadlines out by day", async () => {
    const a = await create(s.applicant, { fullDue: "2027-06-01", internalDue: "2027-05-20", loiDue: "2027-04-02" });
    const cal = await data<{ month: string; firstWeekday: number; days: { date: string; events: { kind: string; outsideApplicationId: string }[] }[] }>(s.applicant, "GET", "/gms/pipeline/calendar?month=2027-05");
    expect(cal.days).toHaveLength(31);
    expect(cal.firstWeekday).toBe(6);
    expect(cal.days.filter((d) => d.events.length).map((d) => [d.date, d.events.map((e) => e.kind)])).toEqual([["2027-05-20", ["internal"]]]);
    expect(cal.days[19]!.events[0]!.outsideApplicationId).toBe(a.id);
    expect((await s.call(s.applicant, "GET", "/gms/pipeline/calendar?month=2027-13")).status).toBe(400);
  });
});
