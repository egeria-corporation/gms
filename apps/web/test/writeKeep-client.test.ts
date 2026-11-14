// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// The write-and-keep client: every call's method, path and body as the screens make it (the
// results file lists them for the API track), the normalizers' tolerance, and the in-browser mock's
// rules: drafts save nothing and spend the quota, guideline reading needs the assistant, the vault
// refuses bank-like names, go/no-go moves by the machine, approval is for an admin or the owner,
// series stop at 60 and re-plan only future untouched ones, closeout needs everything settled.
import { describe, expect, it } from "vitest";
import { createHttpOutsideApi, toApplication } from "../src/api/outside.ts";
import { createHttpWriteKeepApi, libraryWithMeta, toDraft, toObligation, toSummary } from "../src/api/writeKeep.ts";
import { seedApplicantStore, APPLICANT_IDS } from "../src/mocks/applicant.ts";
import { seedFullStore } from "../src/mocks/applicantFull.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { createMockOutsideApi, day, OUTSIDE_IDS, seedOutsideStore } from "../src/mocks/outside.ts";
import { createMockWriteKeepApi, seedWriteKeepStore, WK_IDS } from "../src/mocks/writeKeep.ts";

function recorder(reply: (method: string, path: string) => unknown = () => ({})) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const path = url.replace("https://api.test", "");
    calls.push({ method: init.method ?? "GET", path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ data: reply(init.method ?? "GET", path) }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

describe("the HTTP client", () => {
  it("sends each call to the API document's route with its body, as the screens make it", async () => {
    const { calls, fetch } = recorder((method, path) =>
      path === "/gms/my/awarded-funding"
        ? { items: [{ kind: "gms_award", id: "awd_1" }, { kind: "outside_award", id: "oap_9", title: "Clinics", funderName: "Cedar", currency: "USD", awardedAmount: { amount: "60000.00", currency: "USD" } }] }
        : path === "/gms/outside-awards/oap_9"
          ? { obligations: [{ id: "o1", kind: "report", title: "Report (1 of 2)", dueOn: "2027-06-01", status: "upcoming" }], payments: { received: { amount: "30000.00", currency: "USD" } } }
          : path.endsWith("/obligations") && method === "POST"
            ? { series: { id: "s1" }, obligations: [{ id: "o1" }, { id: "o2" }] }
            : path.endsWith("/obligations")
              ? { obligations: [{ id: "o1", snapshot: { documentId: "doc_1", sha256: "a".repeat(64) }, allowedStatuses: ["done", "due"] }], series: [], payments: {}, closeout: {} }
              : path === "/gms/vault"
                ? { documents: [{ id: "v1", name: "Audit.pdf", docType: "audit", expiry: { expiresOn: "2027-06-30" } }], types: [], never: "" }
                : path === "/gms/workspaces/ws_1"
                  ? method === "GET"
                    ? { settings: { goNoGoEnabled: true, fiscalYearStartMonth: 7 } }
                    : { workspace: { settings: { goNoGoEnabled: true, goNoGoWeights: { fit: 4, capacity: 2, effort: 2, relationship: 1 } } }, warnings: [] }
                  : path.includes("required-documents")
                    ? [{ label: "Audit", docType: "audit", status: "attached", document: { id: "v1" }, matches: [] }]
                    : { id: "x" },
    );
    const api = createHttpWriteKeepApi({ baseUrl: "https://api.test", token: async () => "t", workspaceId: () => "ws_1", fetch });
    await api.draftAnswer("oqn_1");
    await api.readGuidelines("oap_1", "Guidelines");
    await api.uploadGuidelines("oap_1", { name: "g.pdf", mime: "application/pdf", contentBase64: "JVBERg==" });
    await api.verifyAnswer("ans_1");
    await api.updateAnswerMeta("ans_1", { variants: { short: "S" }, tags: ["health"] });
    expect(await api.vault()).toMatchObject([{ id: "v1", docType: "audit", expiresOn: "2027-06-30" }]);
    await api.uploadVault({ name: "Audit.pdf", mime: "application/pdf", contentBase64: "JVBERg==", docType: "audit", expiresOn: "2027-06-30" });
    await api.updateVault("vdc_1", { expiresOn: null });
    expect(await api.setRequiredDocuments("oap_1", [{ label: "Audit", documentId: "v1", status: "attached" }, { label: "Budget", documentId: null, status: "not_needed" }])).toEqual([{ label: "Audit", documentId: "v1", status: "attached" }]);
    await api.useFromVault("oap_1", "Audit", "v1");
    await api.createMilestones("oap_1", [{ title: "First draft due", dueOn: "2027-02-15" }]);
    expect(await api.settings()).toMatchObject({ goNoGoEnabled: true, fiscalYearStartMonth: 7, goNoGoWeights: { fit: 3 } });
    expect(await api.saveSettings({ goNoGoEnabled: true })).toMatchObject({ goNoGoWeights: { fit: 4 } });
    await api.decideGoNoGo("oap_1", { eligibility: "pass", scores: { fit: 5, capacity: 4, effort: 3, relationship: 2 }, decision: "go", to: "drafting" });
    await api.comments("oap_1", "oqn_1");
    await api.addComment("oqn_1", "Looks good");
    expect(await api.createObligation("oap_1", { kind: "report", title: "Report", series: { everyMonths: 6, startOn: "2027-01-01", endOn: "2028-01-01" } })).toHaveLength(2);
    expect((await api.obligations("oap_1"))[0]).toMatchObject({ documentId: "doc_1", snapshotSha256: "a".repeat(64), allowedStatuses: ["done", "due"] });
    await api.updateObligation("obl_1", { title: "Report" });
    await api.setObligationStatus("obl_1", { to: "received", completedOn: "2027-03-01", amount: { amount: "100.00", currency: "USD" } });
    await api.updateSeries("srs_1", { everyMonths: 3 });
    await api.submitObligation("obl_1", { submittedAt: "2027-07-01", confirmationRef: "R1" });
    await api.reportQuestions("obl_1");
    await api.addReportQuestions("obl_1", [{ prompt: "Progress?" }]);
    await api.priorReportAnswers("obl_1", { questionId: "oqn_2", q: "clinics" });
    await api.closeOut("oap_1");
    await api.nextCycleAlert("oap_1");
    expect(await api.outsideAwards()).toEqual([{ id: "oap_9", title: "Clinics", funderName: "Cedar", awardedAmount: { amount: "60000.00", currency: "USD" }, receivedAmount: { amount: "30000.00", currency: "USD" }, grantStart: null, grantEnd: null, closedOutAt: null, nextDue: { title: "Report (1 of 2)", dueOn: "2027-06-01" } }]);
    await api.fundingSummary();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /gms/outside-questions/oqn_1/draft",
      "POST /gms/outside-applications/oap_1/questions/parse",
      "POST /gms/outside-applications/oap_1/guidelines",
      "POST /gms/my/answers/ans_1/verify",
      "PATCH /gms/my/answers/ans_1",
      "GET /gms/vault",
      "POST /gms/vault",
      "PATCH /gms/vault/vdc_1",
      "PUT /gms/outside-applications/oap_1/required-documents",
      "POST /gms/outside-applications/oap_1/required-documents/use-from-vault",
      "POST /gms/outside-applications/oap_1/milestones",
      "GET /gms/workspaces/ws_1",
      "PATCH /gms/workspaces/ws_1",
      "POST /gms/outside-applications/oap_1/go-no-go",
      "GET /gms/outside-applications/oap_1/comments?questionId=oqn_1",
      "POST /gms/outside-questions/oqn_1/comments",
      "POST /gms/outside-applications/oap_1/obligations",
      "GET /gms/outside-applications/oap_1/obligations",
      "PATCH /gms/outside-obligations/obl_1",
      "POST /gms/outside-obligations/obl_1/status",
      "PATCH /gms/outside-obligation-series/srs_1",
      "POST /gms/outside-obligations/obl_1/submit",
      "GET /gms/outside-obligations/obl_1/questions",
      "POST /gms/outside-obligations/obl_1/questions",
      "GET /gms/outside-obligations/obl_1/reuse?questionId=oqn_2&q=clinics",
      "POST /gms/outside-applications/oap_1/close-out",
      "POST /gms/outside-applications/oap_1/next-cycle-alert",
      "GET /gms/my/awarded-funding",
      "GET /gms/outside-awards/oap_9",
      "GET /gms/funding-summary",
    ]);
    const body = (i: number) => calls[i]!.body;
    expect(body(1)).toEqual({ text: "Guidelines", mode: "ai" });
    expect(body(8)).toEqual({ items: [{ label: "Audit", documentId: "v1" }, { label: "Budget", status: "not_needed", documentId: null }] });
    expect(body(9)).toEqual({ label: "Audit", documentId: "v1" });
    expect(body(10)).toEqual({ tasks: [{ title: "First draft due", dueOn: "2027-02-15" }] });
    expect(body(12)).toEqual({ settings: { goNoGoEnabled: true } });
    expect(body(13)).toEqual({ eligibility: "pass", scores: { fit: 5, capacity: 4, effort: 3, relationship: 2 }, decision: "go", to: "drafting" });
    expect(body(15)).toEqual({ body: "Looks good" });
    expect(body(16)).toEqual({ kind: "report", title: "Report", series: { everyMonths: 6, startOn: "2027-01-01", endOn: "2028-01-01" } });
    expect(body(19)).toEqual({ to: "received", completedOn: "2027-03-01", amount: { amount: "100.00", currency: "USD" } });
    expect(body(23)).toEqual({ questions: [{ prompt: "Progress?" }] });
  });

  it("reads the funding summary's per-currency amounts and fetches its exports", async () => {
    const { calls, fetch } = recorder(() => ({ fiscalYearStartMonth: 7, years: [{ fiscalYear: 2027, label: "FY 2027 (Jul 2026 to Jun 2027)", submitted: 3, decided: 2, awarded: 1, declined: 1, winRate: 0.5, asked: [{ amount: "10.00", currency: "CAD" }, { amount: "90000.00", currency: "USD" }], awardedAmount: [{ amount: "40000.00", currency: "USD" }] }] }));
    const api = createHttpWriteKeepApi({ baseUrl: "https://api.test", token: async () => "t", workspaceId: () => "ws_1", fetch });
    expect((await api.fundingSummary()).years[0]).toMatchObject({ label: "FY 2027 (Jul 2026 to Jun 2027)", winRate: 0.5, asked: { amount: "90000.00", currency: "USD" }, awardedAmount: { amount: "40000.00" } });
    await api.exportSummary("pdf").catch(() => undefined);
    expect(calls[1]!.path).toBe("/gms/funding-summary/export?format=pdf");
  });

  it("saves accepted AI text, reused report text and the award letter with their marks", async () => {
    const { calls, fetch } = recorder(() => ({ id: "v1", version: 1, body: "x", provenance: "assist", counts: { words: 1, chars: 1, charsNoSpaces: 1 } }));
    const api = createHttpOutsideApi({ baseUrl: "https://api.test", token: async () => "t", workspaceId: () => "ws", fetch });
    await api.putAnswer("oqn_1", { body: "x", provenance: "assist" });
    await api.putAnswer("oqn_1", { body: "y", provenance: "prior_submission", sourceAnswerId: "v0" });
    await api.uploadDocument("oap_1", { name: "Award.pdf", mime: "application/pdf", contentBase64: "JVBERg==", docType: "award_letter" });
    expect(calls.map((c) => c.body)).toEqual([
      { body: "x", provenance: "assist" },
      { body: "y", provenance: "prior_submission", sourceAnswerId: "v0" },
      { name: "Award.pdf", mime: "application/pdf", contentBase64: "JVBERg==", docType: "award_letter" },
    ]);
  });

  it("reads the API's go/no-go and required documents on an outside application", () => {
    const a = toApplication({ id: "oap_1", goNoGo: { enabled: true, weights: { fit: 3 }, labels: {}, scorecard: { scores: { eligibility: "pass", fit: 4, capacity: 4, effort: 4, relationship: 4 }, weights: { fit: 3, capacity: 2, effort: 2, relationship: 1 }, total: 4, decision: "go", decidedBy: "u1", decidedAt: "2027-01-01T00:00:00Z", reason: null, to: "drafting" } }, requiredDocuments: [{ label: "Audit", status: "attached", document: { id: "v1" } }, { label: "Budget", status: "needed", document: null }] });
    expect(a.goNoGo).toMatchObject({ eligibility: "pass", scores: { fit: 4 }, total: 4, decision: "go" });
    expect(a.requiredDocuments).toEqual([
      { label: "Audit", documentId: "v1", status: "attached" },
      { label: "Budget", documentId: null, status: "needed" },
    ]);
    expect(toApplication({ id: "oap_2", goNoGo: { enabled: false, weights: {}, labels: {}, scorecard: null } }).goNoGo).toBeNull();
  });

  it("reads the small variations a first server could answer with", () => {
    expect(toDraft({ text: "A [b]", staleFlags: ["312 families", { answerId: "a1", figure: "46 miles", lastVerifiedAt: null }], unknowns: [{ label: "b" }] })).toMatchObject({ draft: "A [b]", unknowns: ["b"], staleFlags: [{ answerId: null, figure: "312 families" }, { answerId: "a1", figure: "46 miles" }] });
    expect(toObligation({ id: "o", kind: "payment_expected", amountMinor: 250000, status: "weird", dueOn: "2027-01-01T00:00:00Z" })).toMatchObject({ amount: { amount: "2500.00", currency: "USD" }, status: "upcoming", dueOn: "2027-01-01" });
    expect(toSummary({ years: [{ fiscalYear: 2027, decided: 4, awarded: 1, askedMinor: 100, awardedMinor: 50 }] }).years[0]).toMatchObject({ winRate: 0.25, asked: { amount: "1.00" }, awardedAmount: { amount: "0.50" } });
  });

  it("joins the library's freshness by key when the answers come without it", async () => {
    const answers = [{ id: "a2", key: "need", title: "Need", body: "x", version: 2, words: 1, updatedAt: "" }];
    const lib = await libraryWithMeta(async () => answers, { library: async () => [{ ...answers[0]!, id: "a1", lastVerifiedAt: "2026-01-01T00:00:00Z", variants: { short: "s" }, tags: ["t"] }] });
    expect(lib[0]).toMatchObject({ id: "a2", lastVerifiedAt: "2026-01-01T00:00:00Z", variants: { short: "s" }, tags: ["t"] });
  });
});

function mocks(opts: { assist?: boolean; actor?: { userId: string; name: string } } = {}) {
  const applicant = seedApplicantStore();
  const full = seedFullStore(applicant);
  full.assist = opts.assist ? { enabled: true, quota: { used: 0, limit: 2, remaining: 2 } } : { enabled: false, quota: null };
  const outsideStore = seedOutsideStore();
  const session = async () => demoSession();
  const outside = createMockOutsideApi({ session, applicant, store: outsideStore, ...(opts.actor ? { actor: opts.actor } : {}) });
  const wk = createMockWriteKeepApi({ session, applicant, outside: outsideStore, full, store: seedWriteKeepStore(), ...(opts.actor ? { actor: opts.actor } : {}) });
  return { applicant, full, outside, wk, outsideStore };
}
const NW_Q1 = "oqn_d3000000-0000-7000-8000-000000000001";

describe("the mock follows the contract", () => {
  it("drafts from the library only when the assistant is on, saves nothing, and spends the quota", async () => {
    const off = mocks();
    await expect(off.wk.draftAnswer(NW_Q1)).rejects.toMatchObject({ status: 404 });
    const m = mocks({ assist: true });
    const before = m.outsideStore.applications[0]!.questions[0]!.versions.length;
    const d = await m.wk.draftAnswer(NW_Q1);
    expect(d.usedAnswerIds[0]).toBe("12000000-0000-7000-8000-000000000001");
    expect(d.draft).toMatch(/\[what this grant would pay for\]/);
    expect(d.unknowns).toContain("what this grant would pay for");
    expect(d.staleFlags.map((f) => f.figure)).toContain("46 miles");
    expect(d.counts.words).toBeLessThanOrEqual(250);
    expect(m.outsideStore.applications[0]!.questions[0]!.versions).toHaveLength(before);
    expect(m.full.assist.quota).toMatchObject({ used: 1, remaining: 1 });
    await m.wk.draftAnswer(NW_Q1);
    await expect(m.wk.draftAnswer(NW_Q1)).rejects.toMatchObject({ status: 429 });
  });

  it("reads pasted guidelines up to 60,000 characters, and an uploaded file kept as the funder's guidelines", async () => {
    const m = mocks({ assist: true });
    await expect(m.wk.readGuidelines(OUTSIDE_IDS.meadow, "x".repeat(60_001))).rejects.toMatchObject({ status: 422 });
    const r = await m.wk.readGuidelines(OUTSIDE_IDS.meadow, "Senior Rides\n\n1. Describe the need. (150 words)\n\nInclude your IRS determination letter.");
    expect(r.questions).toEqual([{ prompt: "Describe the need. (150 words)", phase: "full", limitKind: "words", limitValue: 150 }]);
    expect(r.requiredDocuments).toEqual(["IRS determination letter"]);
    const up = await m.wk.uploadGuidelines(OUTSIDE_IDS.meadow, { name: "rfp.txt", mime: "text/plain", contentBase64: btoa("1. How will you measure success?") });
    expect(up.questions.map((q) => q.prompt)).toEqual(["How will you measure success?"]);
    expect(m.outsideStore.applications.find((a) => a.id === OUTSIDE_IDS.meadow)!.documents.map((d) => (d as { docType?: string }).docType)).toEqual(["funder_guidelines"]);
    await expect(m.wk.uploadGuidelines(OUTSIDE_IDS.meadow, { name: "rfp.docx", mime: "application/msword" as never, contentBase64: "AA==" })).rejects.toMatchObject({ status: 422 });
    const off = mocks();
    await expect(off.wk.readGuidelines(OUTSIDE_IDS.meadow, "1. Why?")).rejects.toMatchObject({ status: 404 });
  });

  it("keeps bank paperwork out of the vault", async () => {
    const m = mocks();
    await expect(m.wk.uploadVault({ name: "voided-check.pdf", mime: "application/pdf", contentBase64: "JVBERg==", docType: "other" })).rejects.toMatchObject({ status: 422 });
    const v = await m.wk.uploadVault({ name: "Annual report.pdf", mime: "application/pdf", contentBase64: "JVBERg==", docType: "annual_report", expiresOn: "2027-12-31" });
    expect(v).toMatchObject({ docType: "annual_report", expiresOn: "2027-12-31" });
    await expect(m.wk.updateVault(v.id, { name: "ACH form.pdf" })).rejects.toMatchObject({ status: 422 });
  });

  it("decides go/no-go at Deciding only, when switched on, through the machine", async () => {
    const m = mocks();
    const scores = { fit: 4, capacity: 4, effort: 4, relationship: 4 };
    await expect(m.wk.decideGoNoGo(OUTSIDE_IDS.meadow, { eligibility: "pass", scores, decision: "go", to: "drafting" })).rejects.toMatchObject({ status: 409 });
    await m.wk.saveSettings({ goNoGoEnabled: true });
    await expect(m.wk.saveSettings({ goNoGoWeights: { fit: 0, capacity: 0, effort: 0, relationship: 0 } })).rejects.toMatchObject({ status: 422 });
    await expect(m.wk.decideGoNoGo(OUTSIDE_IDS.meadow, { eligibility: "fail", scores, decision: "go", to: "drafting" })).rejects.toMatchObject({ status: 422 });
    await expect(m.wk.decideGoNoGo(OUTSIDE_IDS.meadow, { eligibility: "pass", scores, decision: "go" })).rejects.toMatchObject({ status: 422 });
    await expect(m.wk.decideGoNoGo(OUTSIDE_IDS.northwind, { eligibility: "pass", scores, decision: "go", to: "drafting" })).rejects.toMatchObject({ status: 409 });
    const a = await m.wk.decideGoNoGo(OUTSIDE_IDS.meadow, { eligibility: "pass", scores: { fit: 5, capacity: 4, effort: 3, relationship: 2 }, decision: "no_go", reason: "Too small" });
    // As the API: the weighted mean of the scores, 1 to 5, to two decimals.
    expect(a).toMatchObject({ stage: "not_pursuing", goNoGo: { decision: "no_go", total: 3.88, reason: "Too small" } });
  });

  it("lets only an admin or the owner approve an answer, and ledgers every status change", async () => {
    const jamal = mocks({ actor: { userId: APPLICANT_IDS.jamal, name: "Jamal Reed" } });
    await expect(jamal.outside.updateQuestion(NW_Q1, { status: "approved" })).rejects.toMatchObject({ status: 403 });
    await jamal.outside.updateQuestion(NW_Q1, { status: "ready" });
    // Jamal owns Pinecrest, so he approves there.
    const pine = await jamal.outside.addQuestions(OUTSIDE_IDS.pinecrest, [{ prompt: "Budget?" }]);
    expect((await jamal.outside.updateQuestion(pine[0]!.id, { status: "approved" })).status).toBe("approved");
    const events = jamal.outsideStore.applications[0]!.activity.filter((e) => e.type === "outside_application.question_status_changed");
    expect(events.map((e) => e.data)).toEqual([{ questionId: NW_Q1, from: "draft", to: "ready" }]);
    await expect(jamal.wk.saveSettings({ fiscalYearStartMonth: 7 })).rejects.toMatchObject({ status: 403 });
  });

  it("makes at most 60 in a series, and a series edit re-plans only future untouched ones", async () => {
    const m = mocks();
    await expect(m.wk.createObligation(OUTSIDE_IDS.cedar, { kind: "report", title: "Monthly", series: { everyMonths: 1, startOn: day(0), endOn: day(2000) } })).rejects.toMatchObject({ status: 422 });
    await expect(m.wk.createObligation(OUTSIDE_IDS.northwind, { kind: "report", title: "Report", dueOn: day(10) })).rejects.toMatchObject({ status: 409 });
    const made = await m.wk.createObligation(OUTSIDE_IDS.cedar, { kind: "condition", title: "Site visit", series: { everyMonths: 12, startOn: day(30), endOn: day(400) } });
    expect(made.map((o) => o.title)).toEqual(["Site visit (1 of 2)", "Site visit (2 of 2)"]);
    const series = (await m.wk.obligations(OUTSIDE_IDS.cedar)).filter((o) => o.seriesId === WK_IDS.seriesReports);
    expect(series.map((o) => o.status)).toEqual(["submitted", "upcoming", "upcoming"]);
    // An edited instance is kept as it is.
    await m.wk.updateObligation(WK_IDS.oblReport3, { notes: "Ask for an extension" });
    expect(await m.wk.updateSeries(WK_IDS.seriesReports, { title: "Annual report" })).toEqual({ replaced: 1, added: 2, kept: 2 });
    const after = (await m.wk.obligations(OUTSIDE_IDS.cedar)).filter((o) => o.seriesId === WK_IDS.seriesReports);
    expect(after.find((o) => o.id === WK_IDS.oblReport1)!.title).toBe("Progress report");
    expect(after.find((o) => o.id === WK_IDS.oblReport3)!.title).toBe("Progress report");
    expect(after.filter((o) => o.title === "Annual report")).toHaveLength(2);
    expect(await m.wk.updateSeries(WK_IDS.seriesReports, { everyMonths: 3, startOn: day(0), endOn: day(200) })).toEqual({ replaced: 2, added: 3, kept: 2 });
  });

  it("moves an obligation only along its kind's edges", async () => {
    const m = mocks();
    await expect(m.wk.setObligationStatus(WK_IDS.oblReport2, { to: "done" })).rejects.toMatchObject({ status: 409 });
    await expect(m.wk.setObligationStatus(WK_IDS.oblReport2, { to: "submitted" })).rejects.toMatchObject({ status: 409 });
    const paid = await m.wk.setObligationStatus(WK_IDS.oblExpected2, { to: "received", completedOn: day(-1), amount: { amount: "29500.00", currency: "USD" } });
    expect(paid).toMatchObject({ status: "received", completedOn: day(-1), amount: { amount: "29500.00" }, allowedStatuses: ["due"] });
    expect((await m.wk.obligations(OUTSIDE_IDS.cedar)).find((o) => o.id === WK_IDS.oblReport1)!.allowedStatuses).toEqual(["done", "due"]);
  });

  it("keeps report questions on the report, offers other reports' answers, records the submission, and closes out only when everything is settled", async () => {
    const m = mocks();
    // The application's own question list leaves report questions out, as the API does.
    expect((await m.outside.get(OUTSIDE_IDS.cedar)).questions).toEqual([]);
    expect((await m.wk.reportQuestions(WK_IDS.oblReport1)).map((q) => q.prompt)).toEqual(["Describe the progress made in the first six months.", "What challenges did you meet, and how did you respond?"]);
    const [q] = await m.wk.addReportQuestions(WK_IDS.oblReport2, [{ prompt: "Describe the progress made this year." }]);
    expect(q).toMatchObject({ phase: "report", obligationId: WK_IDS.oblReport2 });
    await expect(m.wk.closeOut(OUTSIDE_IDS.cedar)).rejects.toMatchObject({ status: 409 });
    const prior = await m.wk.priorReportAnswers(WK_IDS.oblReport2, { q: "school clinics" });
    expect(prior.map((p) => p.prompt)).toEqual(["Describe the progress made in the first six months."]);
    expect(await m.wk.priorReportAnswers(WK_IDS.oblReport1)).toEqual([]);
    await m.outside.putAnswer(q!.id, { body: prior[0]!.body, provenance: "prior_submission", sourceAnswerId: prior[0]!.answerId });
    await expect(m.wk.submitObligation(WK_IDS.oblReport2, { submittedAt: day(1) })).rejects.toMatchObject({ status: 422 });
    const r = await m.wk.submitObligation(WK_IDS.oblReport2, { submittedAt: day(0), confirmationRef: "R2" });
    expect(r).toMatchObject({ status: "submitted", confirmationRef: "R2" });
    expect(r.snapshotSha256).toMatch(/^[0-9a-f]{64}$/);
    for (const o of await m.wk.obligations(OUTSIDE_IDS.cedar)) {
      if (o.kind === "payment_expected") await m.wk.setObligationStatus(o.id, { to: "received" });
      else if (o.kind === "report" && o.status !== "submitted") await m.wk.deleteObligation(o.id);
      else if (o.kind !== "payment_received") await m.wk.setObligationStatus(o.id, { to: "done" });
    }
    const awards = await m.wk.outsideAwards();
    expect(awards.find((a) => a.id === OUTSIDE_IDS.cedar)).toMatchObject({ receivedAmount: { amount: "60000.00" }, nextDue: null });
    expect((await m.wk.closeOut(OUTSIDE_IDS.cedar)).closedOutAt).toBeTruthy();
  });

  it("keeps the checklist, the milestones, comments and the next-cycle alert", async () => {
    const m = mocks();
    await m.wk.setRequiredDocuments(OUTSIDE_IDS.meadow, [{ label: "Audit", documentId: null, status: "needed" }, { label: "Budget", documentId: null, status: "not_needed" }]);
    await expect(m.wk.setRequiredDocuments(OUTSIDE_IDS.meadow, [{ label: "Audit", documentId: null, status: "needed" }, { label: "audit", documentId: null, status: "needed" }])).rejects.toMatchObject({ status: 422 });
    expect(await m.wk.useFromVault(OUTSIDE_IDS.meadow, "audit", WK_IDS.vaultAudit)).toEqual([
      { label: "Audit", documentId: WK_IDS.vaultAudit, status: "attached" },
      { label: "Budget", documentId: null, status: "not_needed" },
    ]);
    await m.wk.deleteVault(WK_IDS.vaultAudit);
    expect(m.outsideStore.applications.find((a) => a.id === OUTSIDE_IDS.meadow)!.requiredDocuments[0]).toMatchObject({ status: "needed", documentId: null });
    expect(await m.wk.createMilestones(OUTSIDE_IDS.meadow, [{ title: "First draft due", dueOn: day(31) }])).toBe(1);
    expect((await m.outside.get(OUTSIDE_IDS.meadow)).tasks.map((t) => t.title)).toEqual(["First draft due"]);
    await m.wk.addComment(NW_Q1, "Check the figure");
    expect((await m.wk.comments(OUTSIDE_IDS.northwind, NW_Q1)).map((c) => c.body)).toEqual(["Check the figure"]);
    await expect(m.wk.nextCycleAlert(OUTSIDE_IDS.northwind)).rejects.toMatchObject({ status: 422 });
    const alert = await m.wk.nextCycleAlert(OUTSIDE_IDS.lakeshore);
    expect(alert.query).toBe("Community Clinics");
    expect((await m.wk.nextCycleAlert(OUTSIDE_IDS.lakeshore)).id).toBe(alert.id);
  });

  it("counts the funding summary by fiscal year, with the win rate", async () => {
    const m = mocks();
    const s = await m.wk.fundingSummary();
    const total = s.years.reduce((n, y) => ({ decided: n.decided + y.decided, awarded: n.awarded + y.awarded }), { decided: 0, awarded: 0 });
    expect(total.awarded).toBeGreaterThan(0);
    for (const y of s.years) expect(y.winRate).toBe(y.decided ? y.awarded / y.decided : null);
    await m.wk.saveSettings({ fiscalYearStartMonth: 7 });
    expect((await m.wk.fundingSummary()).years[0]!.label).toMatch(/^FY \d{4} \(Jul \d{4} to Jun \d{4}\)$/);
    const csv = await (await m.wk.exportSummary("csv")).blob.text();
    expect(csv.split("\r\n")[0]).toBe("Fiscal year,Submitted,Decided,Awarded,Declined,Win rate,Asked,Awarded amount");
  });
});
