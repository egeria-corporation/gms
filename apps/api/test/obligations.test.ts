// SPDX-License-Identifier: AGPL-3.0-only
// Win and keep it (v1.7.0) through the real routes: an outside award's obligations and series,
// reports written in the same editor (with reuse from an earlier report and an "as submitted"
// PDF), payments received against the amount awarded, the closeout, Awarded funding and the
// daily reminders.
import { sha256Hex } from "@gms/documents";
import { beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_CLAIM } from "../src/auth/scopes.ts";
import { sendObligationReminders } from "../src/jobs.ts";
import { CLIENT_AGENT, WS_APPLICANT, bearer, harness, type Harness } from "./helpers.ts";
import { USER_APPLICANT, USER_APPLICANT_EDITOR, scenario, type Scenario } from "./scenario.ts";

let h: Harness;
let s: Scenario;
type Data<T> = { data: T };
type Err = { message: string; errors: { code: string }[] };
type Ob = { id: string; kind: string; title: string; dueOn: string | null; amount: { amount: string; currency: string } | null; status: string; seriesId: string | null; customized: boolean; overdue: boolean; allowedStatuses: string[]; snapshot: { documentId: string; sha256: string } | null; submittedAt: string | null; completedOn: string | null; questionCount: number };
type List = { obligations: Ob[]; series: { id: string; instances: number; everyMonths: number }[]; payments: { awarded: { amount: string }; received: { amount: string }; expected: { amount: string }; outstanding: { amount: string } }; closeout: { eligible: boolean; openCount: number; closedOutAt: string | null } };

const data = async <T>(who: Record<string, string>, method: string, path: string, body?: unknown) => {
  const r = await s.call<Data<T>>(who, method, path, method === "GET" ? undefined : (body ?? {}));
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const ledgerOf = (type: string) => h.ledger.events.filter((e) => e.eventType === type);
const base = () => ({ repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, config: { baseUrl: "https://gms.test", webBaseUrl: "https://app.gms.test", passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: "OpenGrants GMS <notices@gms.test>" }, ports: { mailer: h.mailer, directory: h.directory } });
const inDays = (n: number) => new Date(h.clock.now.getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** An outside application, submitted and awarded USD 60,000 for 2027-2028 (the clock is 2027-04-16). */
async function award(title = "Clinic grant") {
  const oa = await data<{ id: string }>(s.applicant, "POST", "/gms/outside-applications", { title, funderName: "Northwind" });
  await data(s.applicant, "POST", `/gms/outside-applications/${oa.id}/submit`, { submittedAt: "2027-01-10", method: "portal" });
  await data(s.applicant, "POST", `/gms/outside-applications/${oa.id}/decision`, { outcome: "awarded", awardedAmount: { amount: "60000.00", currency: "USD" }, grantStart: "2027-01-01", grantEnd: "2028-12-31", awardByYear: [{ year: 2027, amountMinor: 3_000_000 }, { year: 2028, amountMinor: 3_000_000 }] });
  return oa.id;
}

let id: string;
beforeEach(async () => {
  h = await harness();
  s = await scenario(h);
  id = await award();
});

describe("obligations", () => {
  it("records reports, conditions and payments; totals what was received against what was awarded", async () => {
    await data(s.applicant, "POST", `/gms/outside-applications/${id}/obligations`, { kind: "report", title: "Final report", dueOn: "2029-01-31" });
    await data(s.applicant, "POST", `/gms/outside-applications/${id}/obligations`, { kind: "condition", title: "Name the funder on signage" });
    await data(s.applicant, "POST", `/gms/outside-applications/${id}/obligations`, { kind: "payment_received", title: "First payment", dueOn: "2027-01-15", amount: { amount: "30000.00", currency: "USD" } });
    const expected = await data<Ob>(s.applicant, "POST", `/gms/outside-applications/${id}/obligations`, { kind: "payment_expected", title: "Second payment", dueOn: "2028-01-15", amount: { amount: "30000.00", currency: "USD" } });
    let list = await data<List>(s.applicant, "GET", `/gms/outside-applications/${id}/obligations`);
    expect(list.obligations.map((o) => [o.kind, o.status])).toEqual([["payment_received", "received"], ["payment_expected", "upcoming"], ["report", "upcoming"], ["condition", "upcoming"]]);
    expect(list.payments).toMatchObject({ awarded: { amount: "60000.00" }, received: { amount: "30000.00" }, expected: { amount: "30000.00" }, outstanding: { amount: "30000.00" } });
    // The second payment arrives, a little less than expected.
    await data(s.applicant, "POST", `/gms/outside-obligations/${expected.id}/status`, { to: "received", completedOn: "2028-01-20", amount: { amount: "29500.00", currency: "USD" } });
    list = await data<List>(s.applicant, "GET", `/gms/outside-applications/${id}/obligations`);
    expect(list.payments).toMatchObject({ received: { amount: "59500.00" }, expected: { amount: "0.00" }, outstanding: { amount: "500.00" } });
    expect(ledgerOf("outside_obligation.status_changed").map((e) => e.data)).toEqual([{ from: "upcoming", to: "received", outsideApplicationId: id, kind: "payment_expected" }]);
  });

  it("refuses what an obligation cannot hold, and anything on an application that is not awarded", async () => {
    const post = (body: Record<string, unknown>, to = id) => s.call<Err>(s.applicant, "POST", `/gms/outside-applications/${to}/obligations`, body);
    expect((await post({ kind: "report", title: "Report with money", dueOn: "2027-07-01", amount: { amount: "5.00", currency: "USD" } })).status).toBe(400);
    expect((await post({ kind: "payment_received", title: "No amount", dueOn: "2027-07-01" })).status).toBe(400);
    expect((await post({ kind: "report", title: "No date" })).status).toBe(400);
    expect((await post({ kind: "payment_received", title: "In euros", dueOn: "2027-07-01", amount: { amount: "5.00", currency: "EUR" } })).body.errors[0]!.code).toBe("currency_mismatch");
    // No bank or destination fields exist on an obligation.
    expect((await post({ kind: "payment_received", title: "Paid", dueOn: "2027-07-01", amount: { amount: "5.00", currency: "USD" }, destination: "x" })).status).toBe(400);
    const drafting = await data<{ id: string }>(s.applicant, "POST", "/gms/outside-applications", { title: "Draft", funderName: "F" });
    expect((await post({ kind: "condition", title: "Too early" }, drafting.id)).body.errors[0]!.code).toBe("not_awarded");
    // Statuses follow the workflow's edges; submitted only through the report's own route.
    const cond = await data<Ob>(s.applicant, "POST", `/gms/outside-applications/${id}/obligations`, { kind: "condition", title: "Signage" });
    expect(cond.allowedStatuses).toEqual(["due", "done", "missed"]);
    expect((await s.call<Err>(s.applicant, "POST", `/gms/outside-obligations/${cond.id}/status`, { to: "received" })).body.errors[0]!.code).toBe("guard_failed");
    expect((await s.call<Err>(s.applicant, "POST", `/gms/outside-obligations/${cond.id}/status`, { to: "submitted" })).body.errors[0]!.code).toBe("use_submit");
    // Private: a funder cannot read it, another workspace's member gets 404.
    expect((await s.call(s.funder, "GET", `/gms/outside-applications/${id}/obligations`)).status).toBe(403);
    expect((await s.call(s.funder, "PATCH", `/gms/outside-obligations/${cond.id}`, { title: "x" })).status).toBe(403);
  });
});

describe("series", () => {
  it("generates every N months from start until grant end, at most 60", async () => {
    const made = await data<{ series: { id: string; instances: number; endOn: string }; obligations: Ob[] }>(s.applicant, "POST", `/gms/outside-applications/${id}/obligations`, { kind: "report", title: "Progress report", series: { everyMonths: 6, startOn: "2027-07-01" } });
    expect(made.series).toMatchObject({ instances: 3, endOn: "2028-12-31" });
    expect(made.obligations.map((o) => [o.title, o.dueOn])).toEqual([["Progress report (1 of 3)", "2027-07-01"], ["Progress report (2 of 3)", "2028-01-01"], ["Progress report (3 of 3)", "2028-07-01"]]);
    const tooMany = await s.call<Err>(s.applicant, "POST", `/gms/outside-applications/${id}/obligations`, { kind: "condition", title: "Monthly check-in", series: { everyMonths: 1, startOn: "2027-01-01", endOn: "2032-01-01" } });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.errors[0]!.code).toBe("series_out_of_bounds");
    const sixty = await data<{ obligations: Ob[] }>(s.applicant, "POST", `/gms/outside-applications/${id}/obligations`, { kind: "condition", title: "Monthly check-in", series: { everyMonths: 1, startOn: "2027-01-01", endOn: "2031-12-31" } });
    expect(sixty.obligations).toHaveLength(60);
    expect((await s.call(s.applicant, "POST", `/gms/outside-applications/${id}/obligations`, { kind: "payment_received", title: "x", dueOn: "2027-01-01", amount: { amount: "1.00", currency: "USD" }, series: { everyMonths: 1, startOn: "2027-01-01" } })).status).toBe(400);
  });

  it("regenerates only future, untouched instances when the series changes", async () => {
    const made = await data<{ series: { id: string }; obligations: Ob[] }>(s.applicant, "POST", `/gms/outside-applications/${id}/obligations`, { kind: "report", title: "Quarterly report", series: { everyMonths: 3, startOn: "2027-01-01", endOn: "2027-12-31" } });
    const [past, apr, jul, oct] = made.obligations as [Ob, Ob, Ob, Ob];
    expect([past.dueOn, apr.dueOn, jul.dueOn, oct.dueOn]).toEqual(["2027-01-01", "2027-04-01", "2027-07-01", "2027-10-01"]);
    // July is edited on its own; October gets a question.
    await data(s.applicant, "PATCH", `/gms/outside-obligations/${jul.id}`, { dueOn: "2027-07-15" });
    await data(s.applicant, "POST", `/gms/outside-obligations/${oct.id}/questions`, { prompt: "What changed?" });
    const changed = await data<{ replaced: number; added: number; kept: number }>(s.applicant, "PATCH", `/gms/outside-obligation-series/${made.series.id}`, { everyMonths: 2, title: "Bi-monthly report" });
    const list = (await data<List>(s.applicant, "GET", `/gms/outside-applications/${id}/obligations`)).obligations.filter((o) => o.seriesId === made.series.id);
    // Past (January, April) stay; July (customized) and October (has a question) stay; the rest is regenerated.
    expect(changed).toMatchObject({ replaced: 0, added: 4, kept: 4 });
    expect(list.map((o) => o.dueOn)).toEqual(["2027-01-01", "2027-04-01", "2027-05-01", "2027-07-15", "2027-07-01", "2027-09-01", "2027-10-01", "2027-11-01"].sort());
    expect(list.find((o) => o.id === jul.id)!.title).toBe("Quarterly report (3 of 4)");
    // A second change replaces the new untouched ones only.
    const again = await data<{ replaced: number; added: number }>(s.applicant, "PATCH", `/gms/outside-obligation-series/${made.series.id}`, { everyMonths: 6 });
    expect(again).toMatchObject({ replaced: 4, added: 1 });
    // Removing the series keeps the touched and past instances as one-offs.
    const removed = await data<{ removed: number; kept: number }>(s.applicant, "DELETE", `/gms/outside-obligation-series/${made.series.id}`);
    expect(removed.kept).toBe(4);
    expect((await data<List>(s.applicant, "GET", `/gms/outside-applications/${id}/obligations`)).obligations.filter((o) => o.kind === "report").every((o) => o.seriesId === null)).toBe(true);
  });
});

describe("reports", () => {
  it("are written in the same editor, reuse earlier report answers, and are marked submitted with an as-submitted PDF", async () => {
    const r1 = await data<Ob>(s.applicant, "POST", `/gms/outside-applications/${id}/obligations`, { kind: "report", title: "Interim report", dueOn: "2027-03-01" });
    const r2 = await data<Ob>(s.applicant, "POST", `/gms/outside-applications/${id}/obligations`, { kind: "report", title: "Final report", dueOn: "2028-12-31" });
    const [q1] = await data<{ id: string; phase: string }[]>(s.applicant, "POST", `/gms/outside-obligations/${r1.id}/questions`, { prompt: "How many families did you serve?", limitKind: "words", limitValue: 100 });
    expect(q1!.phase).toBe("report");
    await data(s.applicant, "PUT", `/gms/outside-questions/${q1!.id}/answer`, { body: "We served 1,240 families across three counties." });
    // Report questions are not the application's questions.
    expect((await data<{ questions: unknown[] }>(s.applicant, "GET", `/gms/outside-applications/${id}`)).questions).toHaveLength(0);
    const [q2] = await data<{ id: string }[]>(s.applicant, "POST", `/gms/outside-obligations/${r2.id}/questions`, { prompt: "How many families did you serve this year?" });
    const reuse = await data<{ answerId: string; body: string; obligationTitle: string; relevance: number }[]>(s.applicant, "GET", `/gms/outside-obligations/${r2.id}/reuse?questionId=${q2!.id}`);
    expect(reuse).toEqual([expect.objectContaining({ body: "We served 1,240 families across three counties.", obligationTitle: "Interim report" })]);
    expect(reuse[0]!.relevance).toBeGreaterThan(0);
    const reused = await data<{ provenance: string }>(s.applicant, "PUT", `/gms/outside-questions/${q2!.id}/answer`, { body: reuse[0]!.body, provenance: "prior_submission", sourceAnswerId: reuse[0]!.answerId });
    expect(reused.provenance).toBe("prior_submission");
    // Reusing from the same report, or into a question that is not a report's, is refused.
    expect((await s.call(s.applicant, "PUT", `/gms/outside-questions/${q1!.id}/answer`, { body: "x", provenance: "prior_submission", sourceAnswerId: reuse[0]!.answerId })).status).toBe(422);
    expect((await s.call(s.applicant, "PUT", `/gms/outside-questions/${q2!.id}/answer`, { body: "x", provenance: "prior_submission" })).status).toBe(400);

    const submitted = await data<Ob>(s.applicant, "POST", `/gms/outside-obligations/${r1.id}/submit`, { submittedAt: "2027-03-02", confirmationRef: "NW-77" });
    expect(submitted).toMatchObject({ status: "submitted", submittedAt: "2027-03-02T12:00:00.000Z", questionCount: 1 });
    const pdf = await h.request(`/gms/outside-applications/${id}/documents/${submitted.snapshot!.documentId}/file`, { headers: s.applicant });
    expect(pdf.status).toBe(200);
    expect(await sha256Hex(new Uint8Array(await pdf.arrayBuffer()))).toBe(submitted.snapshot!.sha256);
    expect(ledgerOf("outside_obligation.submitted")).toHaveLength(1);
    // A submitted report is kept, and gets no new questions until moved back.
    expect((await s.call<Err>(s.applicant, "DELETE", `/gms/outside-obligations/${r1.id}`)).body.errors[0]!.code).toBe("kept_record");
    expect((await s.call<Err>(s.applicant, "POST", `/gms/outside-obligations/${r1.id}/questions`, { prompt: "More?" })).body.errors[0]!.code).toBe("report_submitted");
    // An agent cannot mark a report submitted.
    const agent = { ...bearer(await h.forge({ sub: USER_APPLICANT, client_id: CLIENT_AGENT, scope: "applications:write", [WORKSPACE_CLAIM]: WS_APPLICANT, jti: "tok-agent" })).headers, "Content-Type": "application/json" };
    expect((await s.call<Err>(agent, "POST", `/gms/outside-obligations/${r2.id}/submit`, { submittedAt: "2027-03-02" })).status).toBe(403);
  });
});

describe("closeout, the award page and Awarded funding", () => {
  it("offers closeout only when every obligation is done or received, then keeps the stage awarded", async () => {
    const cond = await data<Ob>(s.applicant, "POST", `/gms/outside-applications/${id}/obligations`, { kind: "condition", title: "Signage" });
    await data(s.applicant, "POST", `/gms/outside-applications/${id}/obligations`, { kind: "payment_received", title: "All of it", dueOn: "2027-02-01", amount: { amount: "60000.00", currency: "USD" } });
    let page = await data<{ closeout: { eligible: boolean; openCount: number } }>(s.applicant, "GET", `/gms/outside-awards/${id}`);
    expect(page.closeout).toMatchObject({ eligible: false, openCount: 1 });
    expect((await s.call<Err>(s.applicant, "POST", `/gms/outside-applications/${id}/close-out`)).body.errors[0]!.code).toBe("guard_failed");
    await data(s.applicant, "POST", `/gms/outside-obligations/${cond.id}/status`, { to: "done" });
    page = await data<{ closeout: { eligible: boolean; openCount: number } }>(s.applicant, "GET", `/gms/outside-awards/${id}`);
    expect(page.closeout).toMatchObject({ eligible: true, openCount: 0 });
    const closed = await data<{ stage: string; closedOutAt: string }>(s.applicant, "POST", `/gms/outside-applications/${id}/close-out`);
    expect(closed).toMatchObject({ stage: "awarded", closedOutAt: h.clock.now.toISOString() });
    expect(ledgerOf("outside_application.closed_out")).toEqual([expect.objectContaining({ subjectId: id, data: { stage: "awarded", closedOutAt: h.clock.now.toISOString(), obligations: 2 } })]);
    // Closed out: read-only, until reopened.
    expect((await s.call<Err>(s.applicant, "POST", `/gms/outside-applications/${id}/obligations`, { kind: "condition", title: "Late" })).body.errors[0]!.code).toBe("closed_out");
    expect((await s.call<Err>(s.applicant, "POST", `/gms/outside-applications/${id}/close-out`)).body.errors[0]!.code).toBe("guard_failed");
  });

  it("shows the award page with amount per year, grant period, award letter, obligations and payments", async () => {
    const letter = await data<{ id: string }>(s.applicant, "POST", `/gms/outside-applications/${id}/documents`, { name: "Award letter.pdf", mime: "application/pdf", contentBase64: btoa("%PDF-1.4 letter"), docType: "award_letter" });
    const page = await data<{ label: string; awardedAmount: { amount: string }; awardByYear: { year: number; amount: { amount: string } }[]; grantStart: string; grantEnd: string; awardLetter: { id: string; docType: string } | null; obligations: unknown[]; payments: { received: { amount: string } } }>(s.applicant, "GET", `/gms/outside-awards/${id}`);
    expect(page).toMatchObject({ label: "Outside award", awardedAmount: { amount: "60000.00" }, grantStart: "2027-01-01", grantEnd: "2028-12-31", awardLetter: { id: letter.id, docType: "award_letter" }, obligations: [], payments: { received: { amount: "0.00" } } });
    expect(page.awardByYear.map((y) => [y.year, y.amount.amount])).toEqual([[2027, "30000.00"], [2028, "30000.00"]]);
    const drafting = await data<{ id: string }>(s.applicant, "POST", "/gms/outside-applications", { title: "Draft", funderName: "F" });
    expect((await s.call(s.applicant, "GET", `/gms/outside-awards/${drafting.id}`)).status).toBe(404);
  });

  it("lists outside awards next to built-in awards, each labelled", async () => {
    const list = await data<{ items: { kind: string; label: string; id: string; awardedAmount: { amount: string } | null; statusLabel: string }[] }>(s.applicant, "GET", "/gms/my/awarded-funding");
    expect(list.items.filter((i) => i.kind === "outside_award")).toEqual([expect.objectContaining({ id, label: "Outside award", awardedAmount: expect.objectContaining({ amount: "60000.00" }), statusLabel: "Awarded" })]);
    expect(list.items.every((i) => i.label === (i.kind === "gms_award" ? "On this GMS" : "Outside award"))).toBe(true);
    expect((await s.call(s.funder, "GET", "/gms/my/awarded-funding")).status).toBe(403);
  });
});

describe("reminders", () => {
  it("makes due obligations due, and reminds the owner and the report's assignees before and after, once", async () => {
    h.directory.users.set(USER_APPLICANT, { email: "maria.santos@aldercreek.example", name: "Maria Santos" });
    h.directory.users.set(USER_APPLICANT_EDITOR, { email: "jamal.reed@aldercreek.example", name: "Jamal Reed" });
    const soon = await data<Ob>(s.applicant, "POST", `/gms/outside-applications/${id}/obligations`, { kind: "report", title: "Interim report", dueOn: inDays(7) });
    await data(s.applicant, "POST", `/gms/outside-obligations/${soon.id}/questions`, { prompt: "Progress?", assigneeUserId: USER_APPLICANT_EDITOR });
    const late = await data<Ob>(s.applicant, "POST", `/gms/outside-applications/${id}/obligations`, { kind: "condition", title: "Signage", dueOn: inDays(-3) });
    await data(s.applicant, "POST", `/gms/outside-applications/${id}/obligations`, { kind: "condition", title: "Not today", dueOn: inDays(5) });
    await data(s.applicant, "POST", `/gms/outside-applications/${id}/obligations`, { kind: "payment_expected", title: "Payment", dueOn: inDays(7), amount: { amount: "1.00", currency: "USD" } });
    h.mailer.sent.length = 0;
    const out = await sendObligationReminders(base());
    expect(out).toMatchObject({ madeDue: 1, checked: 2, reminded: 2, failed: 0 });
    expect((await h.repos.table("outside_obligations").one({ id: late.id }))!.status).toBe("due");
    expect(ledgerOf("outside_obligation.status_changed").at(-1)).toMatchObject({ actor: "system:keep-reminders", data: { from: "upcoming", to: "due" } });
    expect(h.mailer.sent.map((m) => `${m.to[0]} ${m.subject}`).sort()).toEqual([
      "jamal.reed@aldercreek.example Report due in 7 days: Interim report",
      "maria.santos@aldercreek.example Overdue condition: Signage",
      "maria.santos@aldercreek.example Report due in 7 days: Interim report",
    ]);
    const n = h.mailer.sent.length;
    await sendObligationReminders(base());
    expect(h.mailer.sent).toHaveLength(n);
    // A submitted report is not reminded.
    await data(s.applicant, "POST", `/gms/outside-obligations/${soon.id}/submit`, { submittedAt: inDays(0) });
    h.mailer.sent.length = 0;
    const after = await sendObligationReminders(base());
    expect(after.checked).toBe(1);
  });
});
