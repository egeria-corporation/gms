// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// The write-and-keep client: every call's method, path and body as the screens make it (the
// results file lists them for the API track), the normalizers' tolerance, and the in-browser mock's
// rules: drafts save nothing and spend the quota, guideline reading needs the assistant, the vault
// refuses bank-like names, go/no-go moves by the machine, approval is for an admin or the owner,
// series stop at 60 and re-plan only future untouched ones, closeout needs everything settled.
import { describe, expect, it } from "vitest";
import { createHttpOutsideApi } from "../src/api/outside.ts";
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
  it("sends each call to its route with its body, as the screens make it", async () => {
    const { calls, fetch } = recorder((method, path) => (path.startsWith("/gms/threads?") ? [{ id: "thr_1", fieldRef: "oqn_1", messages: [] }] : method === "POST" && path.includes("/obligations") ? [{ id: "obl_1" }] : { id: "x" }));
    const api = createHttpWriteKeepApi({ baseUrl: "https://api.test", token: async () => "t", workspaceId: () => "ws_1", fetch });
    await api.draftAnswer("oqn_1");
    await api.readGuidelines("oap_1", "Guidelines");
    await api.uploadGuidelines("oap_1", { name: "g.pdf", mime: "application/pdf", contentBase64: "JVBERg==" });
    await api.verifyAnswer("ans_1");
    await api.updateAnswerMeta("ans_1", { variants: { short: "S" }, tags: ["health"] });
    await api.uploadVault({ name: "Audit.pdf", mime: "application/pdf", contentBase64: "JVBERg==", docType: "audit", expiresOn: "2027-06-30" });
    await api.updateVault("vdc_1", { expiresOn: null });
    await api.saveSettings({ goNoGoEnabled: true });
    await api.decideGoNoGo("oap_1", { eligibility: "pass", scores: { fit: 5, capacity: 4, effort: 3, relationship: 2 }, decision: "go", nextStage: "drafting" });
    await api.addComment("oap_1", "oqn_1", "Looks good");
    await api.createObligation("oap_1", { kind: "report", title: "Report", series: { everyMonths: 6, from: "2027-01-01", until: "2028-01-01" } });
    await api.updateObligation("obl_1", { title: "Report", scope: "series" });
    await api.submitObligation("obl_1", { submittedAt: "2027-07-01", confirmationRef: "R1" });
    await api.closeOut("oap_1");
    await api.createAlert("Community Clinics");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /gms/outside-questions/oqn_1/draft",
      "POST /gms/outside-applications/oap_1/questions/parse",
      "POST /gms/outside-applications/oap_1/guidelines",
      "POST /gms/my/answers/ans_1/verify",
      "PATCH /gms/my/answers/ans_1",
      "POST /gms/vault/documents",
      "PATCH /gms/vault/documents/vdc_1",
      "PATCH /gms/my/grant-settings",
      "POST /gms/outside-applications/oap_1/go-no-go",
      "GET /gms/threads?subjectType=outside_application&subjectId=oap_1",
      "POST /gms/threads/thr_1/messages",
      "POST /gms/outside-applications/oap_1/obligations",
      "PATCH /gms/outside-obligations/obl_1",
      "POST /gms/outside-obligations/obl_1/submit",
      "POST /gms/outside-applications/oap_1/close-out",
      "POST /gms/discover/alerts",
    ]);
    expect(calls[1]!.body).toEqual({ text: "Guidelines", mode: "ai" });
    expect(calls[8]!.body).toEqual({ eligibility: "pass", scores: { fit: 5, capacity: 4, effort: 3, relationship: 2 }, decision: "go", nextStage: "drafting" });
    expect(calls[11]!.body).toEqual({ kind: "report", title: "Report", series: { everyMonths: 6, from: "2027-01-01", until: "2028-01-01" } });
    expect(calls[15]!.body).toEqual({ name: "Community Clinics", query: "Community Clinics" });
  });

  it("opens a question's comment thread only when the first comment is posted", async () => {
    const { calls, fetch } = recorder((method, path) => (path.startsWith("/gms/threads?") ? [] : { id: "thr_9", body: "Hi", author: "user:u1", createdAt: "2027-01-01T00:00:00Z" }));
    const api = createHttpWriteKeepApi({ baseUrl: "https://api.test", token: async () => null, workspaceId: () => null, fetch });
    expect(await api.comments("oap_1", "oqn_1")).toEqual([]);
    const c = await api.addComment("oap_1", "oqn_1", "Hi");
    expect(c.authorUserId).toBe("u1");
    expect(calls.map((x) => `${x.method} ${x.path}`)).toEqual(["GET /gms/threads?subjectType=outside_application&subjectId=oap_1", "GET /gms/threads?subjectType=outside_application&subjectId=oap_1", "POST /gms/threads", "POST /gms/threads/thr_9/messages"]);
    expect(calls[2]!.body).toEqual({ subjectType: "outside_application", subjectId: "oap_1", fieldRef: "oqn_1", visibility: "internal" });
  });

  it("saves accepted AI text and reused report text with their provenance", async () => {
    const { calls, fetch } = recorder(() => ({ id: "v1", version: 1, body: "x", provenance: "assist", counts: { words: 1, chars: 1, charsNoSpaces: 1 } }));
    const api = createHttpOutsideApi({ baseUrl: "https://api.test", token: async () => "t", workspaceId: () => "ws", fetch });
    await api.putAnswer("oqn_1", { body: "x", provenance: "assist" });
    await api.putAnswer("oqn_1", { body: "y", provenance: "prior_submission", sourceAnswerId: "v0" });
    await api.update("oap_1", { requiredDocuments: [{ label: "Audit", documentId: "vdc_1", status: "attached" }], awardLetterDocumentId: "doc_1" });
    expect(calls.map((c) => c.body)).toEqual([
      { body: "x", provenance: "assist" },
      { body: "y", provenance: "prior_submission", sourceAnswerId: "v0" },
      { requiredDocuments: [{ label: "Audit", documentId: "vdc_1", status: "attached" }], awardLetterDocumentId: "doc_1" },
    ]);
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
    await expect(m.wk.uploadGuidelines(OUTSIDE_IDS.meadow, { name: "rfp.docx", mime: "application/msword", contentBase64: "AA==" })).rejects.toMatchObject({ status: 422 });
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
    await expect(m.wk.decideGoNoGo(OUTSIDE_IDS.meadow, { eligibility: "pass", scores, decision: "go", nextStage: "drafting" })).rejects.toMatchObject({ status: 409 });
    await m.wk.saveSettings({ goNoGoEnabled: true });
    await expect(m.wk.decideGoNoGo(OUTSIDE_IDS.meadow, { eligibility: "fail", scores, decision: "go", nextStage: "drafting" })).rejects.toMatchObject({ status: 422 });
    await expect(m.wk.decideGoNoGo(OUTSIDE_IDS.northwind, { eligibility: "pass", scores, decision: "go", nextStage: "drafting" })).rejects.toMatchObject({ status: 409 });
    const a = await m.wk.decideGoNoGo(OUTSIDE_IDS.meadow, { eligibility: "pass", scores, decision: "no_go", reason: "Too small" });
    expect(a).toMatchObject({ stage: "not_pursuing", goNoGo: { decision: "no_go", total: 32, max: 40, reason: "Too small" } });
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
    await expect(m.wk.createObligation(OUTSIDE_IDS.cedar, { kind: "report", title: "Monthly", series: { everyMonths: 1, from: day(0), until: day(2000) } })).rejects.toMatchObject({ status: 422 });
    await expect(m.wk.createObligation(OUTSIDE_IDS.northwind, { kind: "report", title: "Report", dueOn: day(10) })).rejects.toMatchObject({ status: 409 });
    const before = await m.wk.obligations(OUTSIDE_IDS.cedar);
    const series = before.filter((o) => o.seriesId === WK_IDS.seriesReports);
    expect(series.map((o) => o.status)).toEqual(["submitted", "upcoming", "upcoming"]);
    const changed = await m.wk.updateObligation(WK_IDS.oblReport2, { title: "Annual report", scope: "series" });
    expect(changed.map((o) => o.title)).toEqual(["Progress report", "Annual report", "Annual report"]);
    // Re-planned every 3 months: the submitted one stays, the future ones are replaced.
    const replanned = await m.wk.updateObligation(WK_IDS.oblReport2, { scope: "series", series: { everyMonths: 3, from: day(0), until: day(200) } });
    expect(replanned[0]!.id).toBe(WK_IDS.oblReport1);
    expect(replanned.slice(1).map((o) => o.title).every((t) => t === "Annual report")).toBe(true);
    expect(replanned).toHaveLength(1 + 2);
  });

  it("records a report as submitted with its PDF and fingerprint, offers its answers for reuse, and closes out only when everything is settled", async () => {
    const m = mocks();
    await expect(m.wk.closeOut(OUTSIDE_IDS.cedar)).rejects.toMatchObject({ status: 409 });
    const prior = await m.wk.priorReportAnswers("school clinics");
    expect(prior.map((p) => p.prompt)).toEqual(["Describe the progress made in the first six months."]);
    await expect(m.wk.submitObligation(WK_IDS.oblReport2, { submittedAt: day(1) })).rejects.toMatchObject({ status: 422 });
    const r = await m.wk.submitObligation(WK_IDS.oblReport2, { submittedAt: day(0), confirmationRef: "R2" });
    expect(r).toMatchObject({ status: "submitted", confirmationRef: "R2" });
    expect(r.snapshotSha256).toMatch(/^[0-9a-f]{64}$/);
    for (const o of await m.wk.obligations(OUTSIDE_IDS.cedar)) {
      if (o.kind === "payment_expected") await m.wk.updateObligation(o.id, { status: "received" });
      else if (o.kind !== "payment_received") await m.wk.updateObligation(o.id, { status: "done" });
    }
    const awards = await m.wk.outsideAwards();
    expect(awards.find((a) => a.id === OUTSIDE_IDS.cedar)).toMatchObject({ receivedAmount: { amount: "60000.00" }, nextDue: null });
    expect((await m.wk.closeOut(OUTSIDE_IDS.cedar)).closedOutAt).toBeTruthy();
  });

  it("counts the funding summary by fiscal year, with the win rate", async () => {
    const m = mocks();
    const s = await m.wk.fundingSummary();
    const total = s.years.reduce((n, y) => ({ decided: n.decided + y.decided, awarded: n.awarded + y.awarded }), { decided: 0, awarded: 0 });
    expect(total.awarded).toBeGreaterThan(0);
    for (const y of s.years) expect(y.winRate).toBe(y.decided ? y.awarded / y.decided : null);
    await m.wk.saveSettings({ fiscalYearStartMonth: 7 });
    expect((await m.wk.fundingSummary()).years[0]!.label).toMatch(/^FY\d{4} \(Jul \d{4} – Jun \d{4}\)$/);
    const csv = await (await m.wk.exportSummary("csv")).blob.text();
    expect(csv.split("\r\n")[0]).toBe("Fiscal year,Submitted,Decided,Awarded,Declined,Win rate,Asked,Awarded amount");
  });
});
