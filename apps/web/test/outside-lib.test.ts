// SPDX-License-Identifier: AGPL-3.0-only
// Apply anywhere, without a screen: live counts against a limit, the deterministic question
// splitter the paste flow previews, the stage moves the screens offer, the pipeline lanes, the
// client's request paths and response shaping, and the mock's rules (dedupe, guards, limits).
import { describe, expect, it } from "vitest";
import { createHttpOutsideApi, isAccepting, toDetail, toListItem, type DiscoverItem } from "../src/api/outside.ts";
import { parseCsv } from "../src/lib/csv.ts";
import { canMarkSubmitted, canReopen, countText, decisionOutcomes, detectLimit, gmsOpportunityOf, isOverLimit, parseQuestions, plainMoves } from "../src/lib/outside.ts";
import { createMockApplicantApi, seedApplicantStore } from "../src/mocks/applicant.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { CONSULTING_REQUEST_TO, createMockOutsideApi, OUTSIDE_IDS, textPdf } from "../src/mocks/outside.ts";
import { laneOf, matchesDeadline, rowsOf } from "../src/screens/applicant/Applications.tsx";
import { isAlertRow } from "../src/screens/applicant/FindFunding.tsx";
import { guessMapping } from "../src/screens/applicant/outside/ImportDialog.tsx";
import { plainText } from "../src/screens/applicant/outside/QuestionsTab.tsx";
import { nextDeadline, orgFacts } from "../src/screens/applicant/outside/shared.tsx";

describe("counts", () => {
  it("counts words, characters and characters without spaces", () => {
    expect(countText("")).toEqual({ words: 0, chars: 0, charsNoSpaces: 0 });
    expect(countText("  Rural families  travel far.\n")).toEqual({ words: 4, chars: 30, charsNoSpaces: 23 });
    // A character is a code point: an accent or an emoji counts once.
    expect(countText("café 👍")).toEqual({ words: 2, chars: 6, charsNoSpaces: 5 });
  });

  it("is over the limit only past it, in the limit's own unit", () => {
    const c = countText("one two three");
    expect(isOverLimit(c, "words", 3)).toBe(false);
    expect(isOverLimit(c, "words", 2)).toBe(true);
    expect(isOverLimit(c, "chars", 13)).toBe(false);
    expect(isOverLimit(c, "chars_no_spaces", 10)).toBe(true);
    expect(isOverLimit(c, null, 1)).toBe(false);
  });
});

describe("the paste flow's splitter", () => {
  it("finds limits written into a question", () => {
    expect(detectLimit("Describe the need. (250 words)")).toEqual({ limitKind: "words", limitValue: 250 });
    expect(detectLimit("A 250-word summary of the project")).toEqual({ limitKind: "words", limitValue: 250 });
    expect(detectLimit("Up to 1,500 characters")).toEqual({ limitKind: "chars", limitValue: 1500 });
    expect(detectLimit("Maximum 2,000 characters including spaces")).toEqual({ limitKind: "chars", limitValue: 2000 });
    expect(detectLimit("Your plan (2,000 characters excluding spaces)")).toEqual({ limitKind: "chars_no_spaces", limitValue: 2000 });
    expect(detectLimit("1000 characters, not including spaces")).toEqual({ limitKind: "chars_no_spaces", limitValue: 1000 });
    expect(detectLimit("max 500 chars")).toEqual({ limitKind: "chars", limitValue: 500 });
    expect(detectLimit("Tell us about your board.")).toBeNull();
  });

  it("splits on numbering and blank lines; headings set the part", () => {
    const text = [
      "Letter of Inquiry",
      "",
      "1. Describe your organization. (250 words)",
      "2) What will the grant make possible?",
      "   Include numbers where you can.",
      "",
      "Full proposal:",
      "Q3: Evaluation plan, max 3,000 characters",
      "",
      "Attach your budget.",
    ].join("\n");
    expect(parseQuestions(text)).toEqual([
      { prompt: "Describe your organization. (250 words)", phase: "loi", limitKind: "words", limitValue: 250 },
      { prompt: "What will the grant make possible? Include numbers where you can.", phase: "loi" },
      { prompt: "Evaluation plan, max 3,000 characters", phase: "full", limitKind: "chars", limitValue: 3000 },
      { prompt: "Attach your budget.", phase: "full" },
    ]);
    expect(parseQuestions("   \n\n")).toEqual([]);
  });
});

describe("stage moves", () => {
  it("offers plain moves, and keeps submission and decisions for their own dialogs", () => {
    expect(plainMoves("prospect")).toEqual(["deciding", "loi", "drafting", "not_pursuing"]);
    expect(plainMoves("drafting")).toEqual(["withdrawn", "not_pursuing"]);
    expect(plainMoves("submitted")).toEqual([]);
    expect(plainMoves("awarded")).toEqual([]);
    expect(canMarkSubmitted("drafting")).toBe(true);
    expect(canMarkSubmitted("loi")).toBe(false);
    expect(decisionOutcomes("submitted")).toEqual(["awarded", "declined", "withdrawn"]);
    expect(decisionOutcomes("loi")).toEqual(["declined"]);
    expect(decisionOutcomes("drafting")).toEqual([]);
    expect(canReopen("declined")).toBe(true);
    expect(canReopen("submitted")).toBe(false);
  });
});

describe("links, files and facts", () => {
  it("recognises an opportunity page on this GMS and nothing else", () => {
    expect(gmsOpportunityOf("https://gms.opengrants.io/f/riverbend/o/community-health-2027", ["gms.opengrants.io"])).toEqual({ handle: "riverbend", slug: "community-health-2027" });
    expect(gmsOpportunityOf("https://evil.example/f/riverbend/o/community-health-2027", ["gms.opengrants.io"])).toBeNull();
    expect(gmsOpportunityOf("https://gms.opengrants.io/f/riverbend", ["gms.opengrants.io"])).toBeNull();
    expect(gmsOpportunityOf("javascript:alert(1)", ["gms.opengrants.io"])).toBeNull();
  });

  it("reads quoted CSV and guesses the column mapping", () => {
    expect(parseCsv('Title,Funder,Ask\r\n"Food, shelter",Larkspur Foundation,"25,000"\n"Say ""hi""",X,1\n')).toEqual([
      ["Title", "Funder", "Ask"],
      ["Food, shelter", "Larkspur Foundation", "25,000"],
      ['Say "hi"', "X", "1"],
    ]);
    expect(guessMapping(["Grant", "Foundation", "Internal deadline", "Due", "Amount requested", "Portal"])).toEqual({ title: "Grant", funderName: "Foundation", internalDue: "Internal deadline", fullDue: "Due", askAmount: "Amount requested", portalUrl: "Portal" });
  });

  it("lists organization facts from Passport, or from the self-declared profile", () => {
    const org = seedApplicantStore().organization;
    const facts = orgFacts(org);
    expect(facts.map((f) => f.label)).toEqual(["Legal name", "EIN", "Mission", "Address", "Year founded", "Annual operating budget"]);
    expect(facts.find((f) => f.key === "ein")?.value).toBe("93-0000418");
    expect(facts.find((f) => f.key === "budget")?.value).toBe("$2,400,000");
    expect(facts.every((f) => f.from === "From Passport")).toBe(true);
    const own = orgFacts({ ...org, linked: false, organization: null, selfDeclared: { legalName: "Pine Ridge Youth Alliance", mission: "Youth sports." } });
    expect(own).toEqual([
      { key: "legalName", label: "Legal name", value: "Pine Ridge Youth Alliance", from: "Entered by your organization" },
      { key: "mission", label: "Mission", value: "Youth sports.", from: "Entered by your organization" },
    ]);
  });

  it("writes a real PDF for the as-submitted copy", () => {
    const text = new TextDecoder().decode(textPdf(["Title", "“Quoted” (text)"]));
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain('("Quoted" \\(text\\)) Tj');
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });
});

describe("pipeline", () => {
  const base = "/w/alder-creek";
  it("puts built-in and outside applications in the same lanes", () => {
    expect(laneOf({ kind: "gms_application", status: "under_review" })).toBe("submitted");
    expect(laneOf({ kind: "gms_application", status: "accepted" })).toBe("awarded");
    expect(laneOf({ kind: "outside_application", stage: "not_pursuing" })).toBe("closed");
    expect(laneOf({ kind: "saved_gms", status: "saved" })).toBe("prospect");
    const rows = rowsOf(
      base,
      [
        { kind: "outside_application", id: "oap_1", title: "A", funderName: "F", stage: "drafting", nextDeadline: null, url: null },
        { kind: "gms_application", id: "app_2", title: "B", funderName: "G", status: "draft", nextDeadline: "2027-04-30", url: null },
        { kind: "saved_gms", id: "s3", title: "C", funderName: null, status: "saved", nextDeadline: null, url: "/f/riverbend/o/x" },
      ],
      [toListItem({ id: "oap_1", title: "A", funderName: "F", stage: "drafting", deadlines: { fullDue: "2099-01-01" }, owner: { userId: "u1", name: "Maria" } })],
    );
    expect(rows.map((r) => [r.href, r.lane, r.deadline, r.owner?.name ?? null])).toEqual([
      ["/w/alder-creek/outside/oap_1", "drafting", "2099-01-01", "Maria"],
      ["/w/alder-creek/applications/app_2/edit", "drafting", "2027-04-30", null],
      ["/f/riverbend/o/x", "prospect", null, null],
    ]);
  });

  it("filters by deadline window", () => {
    const now = new Date("2026-11-14T12:00:00Z");
    expect(matchesDeadline("2026-11-20", "7", now)).toBe(true);
    expect(matchesDeadline("2026-12-20", "7", now)).toBe(false);
    expect(matchesDeadline("2026-12-10", "30", now)).toBe(true);
    expect(matchesDeadline("2026-11-01", "overdue", now)).toBe(true);
    expect(matchesDeadline(null, "none", now)).toBe(true);
    expect(matchesDeadline(null, "7", now)).toBe(false);
    expect(nextDeadline({ loiDue: "2026-10-01", fullDue: "2026-12-01", internalDue: "2026-11-20", rolling: false }, now)).toEqual({ key: "internalDue", date: "2026-11-20" });
  });

  it("keeps funding alerts out of Saved", () => {
    const row = { id: "x", externalId: "og_1", title: "t", url: null, savedAt: "" };
    expect(isAlertRow({ ...row, source: "opengrants" })).toBe(false);
    expect(isAlertRow({ ...row, source: "alert" as "gms" })).toBe(true);
    expect(isAlertRow({ ...row, source: "opengrants", externalId: "alert:rural" })).toBe(true);
  });
});

describe("the HTTP client", () => {
  it("calls the contract's routes with the workspace header", async () => {
    const calls: string[] = [];
    let workspace = "";
    const api = createHttpOutsideApi({
      baseUrl: "http://api.test",
      token: async () => "tok",
      workspaceId: () => "ws_1",
      fetch: async (input, init) => {
        calls.push(`${init?.method} ${String(input).replace("http://api.test", "")}`);
        workspace = new Headers(init?.headers).get("X-GMS-Workspace") ?? "";
        const path = String(input);
        const data = path.endsWith(".csv") ? "a,b" : path.includes("/questions/parse") ? { questions: [{ prompt: "Q", phase: "full" }] } : path.endsWith("/answer") ? { id: "v1", version: 1, body: "x", counts: { words: 1, chars: 1, charsNoSpaces: 1 }, overLimit: false } : { id: "oap_1" };
        if (path.endsWith(".csv")) return new Response(data as string, { status: 200, headers: { "Content-Disposition": 'attachment; filename="apps.csv"' } });
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        return Response.json(path.includes("?") && init?.method === "GET" ? { items: [] } : { data });
      },
    });
    await api.list({ stage: "drafting", q: "rural" });
    await api.create({ source: "manual", title: "T", funderName: "F" });
    await api.get("oap_1");
    await api.update("oap_1", { title: "U" });
    await api.move("oap_1", "loi");
    await api.submit("oap_1", { submittedAt: "2026-11-01", method: "portal" });
    await api.decide("oap_1", { outcome: "declined" });
    await api.reopen("oap_1");
    await api.archive("oap_1");
    await api.unarchive("oap_1");
    await api.addQuestions("oap_1", [{ prompt: "Q" }]);
    await api.updateQuestion("oqn_1", { status: "ready" });
    await api.deleteQuestion("oqn_1");
    expect(await api.parseQuestions("oap_1", "1. Q")).toEqual([{ prompt: "Q", phase: "full" }]);
    expect((await api.putAnswer("oqn_1", { body: "x" })).counts.words).toBe(1);
    await api.answerHistory("oqn_1");
    await api.pipeline();
    await api.funderRecords();
    await api.createFunderRecord({ name: "N" });
    await api.updateFunderRecord("fdr_1", { notes: "n" });
    await api.deleteFunderRecord("fdr_1");
    await api.createCalendarFeed();
    await api.deleteCalendarFeed();
    await api.importCsv({ csv: "a", mapping: {}, dryRun: true });
    expect((await api.exportAll("csv")).filename).toBe("apps.csv");
    await api.consultingPreview("oap_1", { contactName: "M", contactEmail: "m@x.org" });
    await api.sendConsulting("oap_1", { contactName: "M", contactEmail: "m@x.org" });
    await api.openGrantsListing("og 1");
    await api.createTask("oap_1", { title: "Letters" });
    expect(workspace).toBe("ws_1");
    expect(calls).toEqual([
      "GET /gms/outside-applications?stage=drafting&q=rural",
      "POST /gms/outside-applications",
      "GET /gms/outside-applications/oap_1",
      "PATCH /gms/outside-applications/oap_1",
      "POST /gms/outside-applications/oap_1/stage",
      "POST /gms/outside-applications/oap_1/submit",
      "POST /gms/outside-applications/oap_1/decision",
      "POST /gms/outside-applications/oap_1/reopen",
      "POST /gms/outside-applications/oap_1/archive",
      "POST /gms/outside-applications/oap_1/unarchive",
      "POST /gms/outside-applications/oap_1/questions",
      "PATCH /gms/outside-questions/oqn_1",
      "DELETE /gms/outside-questions/oqn_1",
      "POST /gms/outside-applications/oap_1/questions/parse",
      "PUT /gms/outside-questions/oqn_1/answer",
      "GET /gms/outside-questions/oqn_1/answers",
      "GET /gms/pipeline",
      "GET /gms/funder-records",
      "POST /gms/funder-records",
      "PATCH /gms/funder-records/fdr_1",
      "DELETE /gms/funder-records/fdr_1",
      "POST /gms/calendar-feed",
      "DELETE /gms/calendar-feed",
      "POST /gms/outside-applications/import",
      "GET /gms/outside-applications/export.csv",
      "POST /gms/outside-applications/oap_1/consulting-request/preview",
      "POST /gms/outside-applications/oap_1/consulting-request",
      "GET /gms/discover/opengrants/og%201",
      "POST /gms/tasks",
    ]);
  });

  it("shapes a detail answered with separate answers, nested deadlines and minor units", () => {
    const d = toDetail({
      application: { id: "oap_1", title: "T", funderName: "F", stage: "drafting", deadlines: { loiDue: "2027-01-02T00:00:00Z", rolling: true }, askAmountMinor: 1250000, ownerUserId: "u1" },
      questions: [
        { id: "q2", position: 2, prompt: "Second" },
        { id: "q1", position: 1, prompt: "First", limitKind: "words", limitValue: 100 },
      ],
      answers: [
        { id: "a1", questionId: "q1", version: 1, body: "old" },
        { id: "a2", questionId: "q1", version: 2, body: "new", provenance: "library" },
      ],
    });
    expect(d.loiDue).toBe("2027-01-02");
    expect(d.rolling).toBe(true);
    expect(d.askAmount).toEqual({ amount: "12500.00", currency: "USD" });
    expect(d.owner).toEqual({ userId: "u1", name: null });
    expect(d.questions.map((q) => [q.prompt, q.answer?.body ?? null, q.answer?.provenance ?? null])).toEqual([
      ["First", "new", "library"],
      ["Second", null, null],
    ]);
    expect(plainText(d.questions)).toBe("1. First\n\nnew\n\n2. Second\n\n(no answer yet)");
  });
});

describe("the mock follows the contract's rules", () => {
  const make = () => createMockOutsideApi({ session: async () => demoSession(), applicant: seedApplicantStore() });

  it("answers the existing application for a listing already started", async () => {
    const api = make();
    const first = await api.create({ source: "opengrants", sourceRef: "og_x", title: "X", funderName: "F", stage: "prospect" });
    const again = await api.create({ source: "opengrants", sourceRef: "og_x", title: "X", funderName: "F" });
    expect(again.id).toBe(first.id);
    expect(again.stage).toBe("prospect");
  });

  it("guards submission, decisions, archived records and plain moves", async () => {
    const api = make();
    await expect(api.move(OUTSIDE_IDS.northwind, "awarded")).rejects.toMatchObject({ status: 409 });
    await expect(api.submit(OUTSIDE_IDS.northwind, { submittedAt: "", method: "portal" })).rejects.toMatchObject({ status: 422 });
    await expect(api.decide(OUTSIDE_IDS.northwind, { outcome: "awarded", awardedAmount: { amount: "1", currency: "USD" } })).rejects.toMatchObject({ status: 409 });
    const sub = await api.submit(OUTSIDE_IDS.northwind, { submittedAt: "2026-11-10", method: "email" });
    expect(sub.stage).toBe("submitted");
    expect(sub.snapshotSha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(api.decide(OUTSIDE_IDS.northwind, { outcome: "awarded" })).rejects.toMatchObject({ status: 422 });
    expect((await api.decide(OUTSIDE_IDS.northwind, { outcome: "awarded", awardedAmount: { amount: "90000.00", currency: "USD" } })).stage).toBe("awarded");
    expect((await api.reopen(OUTSIDE_IDS.northwind)).stage).toBe("submitted");
    await api.archive(OUTSIDE_IDS.larkspur);
    await expect(api.move(OUTSIDE_IDS.larkspur, "deciding")).rejects.toMatchObject({ status: 409 });
    expect((await api.list()).some((a) => a.id === OUTSIDE_IDS.larkspur)).toBe(false);
    expect((await api.list({ archived: true })).map((a) => a.id)).toEqual([OUTSIDE_IDS.larkspur]);
  });

  it("limits consulting requests and never sends answers unless asked", async () => {
    const api = make();
    const who = { contactName: "Maria Santos", contactEmail: "maria@aldercreek.example" };
    const plain = await api.consultingPreview(OUTSIDE_IDS.northwind, who);
    expect(plain).toMatchObject({ to: CONSULTING_REQUEST_TO, replyTo: who.contactEmail, subject: "Consulting request: Family Navigation Expansion (Alder Creek Family Services)", answers: null, questionCount: 3 });
    const withAnswers = await api.consultingPreview(OUTSIDE_IDS.northwind, { ...who, includeAnswers: true });
    expect(withAnswers.answers?.length).toBe(2);
    for (let i = 0; i < 3; i++) await api.sendConsulting(OUTSIDE_IDS.northwind, who);
    await expect(api.sendConsulting(OUTSIDE_IDS.northwind, who)).rejects.toMatchObject({ status: 429 });
    expect(api.store.consulting).toHaveLength(3);
  });

  it("records a library answer's use and returns counts with each version", async () => {
    const applicant = seedApplicantStore();
    const api = createMockOutsideApi({ session: async () => demoSession(), applicant });
    const lib = applicant.answers[1]!;
    const before = (lib.usedIn as unknown[]).length;
    const v = await api.putAnswer("oqn_d3000000-0000-7000-8000-000000000002", { body: lib.body, libraryAnswerId: lib.id });
    expect(v).toMatchObject({ version: 1, provenance: "library", libraryAnswerId: lib.id, overLimit: false });
    expect(v.counts.words).toBe(22);
    expect((lib.usedIn as unknown[]).length).toBe(before + 1);
  });

  it("offers Start only for a discovery item with a competition and an eligibility result", async () => {
    const applicant = seedApplicantStore();
    const items = await createMockApplicantApi({ session: async () => demoSession(), store: applicant }).discover();
    const open = items.filter((d) => d.acceptingApplications);
    const notOpen = items.filter((d) => !d.acceptingApplications);
    expect(open.length).toBeGreaterThan(0);
    expect(notOpen.length).toBeGreaterThan(0);
    for (const d of open) expect(isAccepting(d)).toBe(true);
    // Not taking applications yet: no competition to start and no eligibility run, as the API sends it.
    for (const d of notOpen) expect(d).toMatchObject({ competitionId: null, eligibility: null, stage: null });
    for (const d of notOpen) expect(isAccepting(d)).toBe(false);
    const half = { ...open[0]!, eligibility: null } as DiscoverItem;
    expect(isAccepting(half)).toBe(false);
    expect(isAccepting({ ...open[0]!, acceptingApplications: false })).toBe(false);
  });
});
