// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// Apply anywhere, one scenario on two backends: (a) the web HTTP clients (api/outside.ts and the
// discovery and saved calls of api/applicant.ts) against the real API Worker in-process over its
// in-memory repositories, with the in-memory mail port and file storage, and (b) the in-browser
// mock. The same assertions run on both, on the fields the screens read, so the e2e flows (mock
// mode) prove what a real install does. Each call goes the way the screens make it.
import { beforeAll, describe, expect, it } from "vitest";
import { createHttpApplicantApi, type ApplicantApi, type OpenGrantsListing } from "../src/api/applicant.ts";
import { ApiError } from "../src/api/client.ts";
import { createHttpOutsideApi, isAccepting, type OutsideApi, type OutsideQuestion } from "../src/api/outside.ts";
import { countText } from "../src/lib/outside.ts";
import { createMockApplicantApi, seedApplicantStore } from "../src/mocks/applicant.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { createMockOutsideApi } from "../src/mocks/outside.ts";
import { loadApi, type ApiHarness } from "./api-harness.ts";

interface Mail {
  to: string[];
  replyTo?: string;
  subject: string;
  text: string;
}
interface Backend {
  applicant: ApplicantApi;
  outside: OutsideApi;
  /** Messages the mail port was given (the real backend only). */
  mail: () => Mail[];
  /** Fetches a calendar feed URL the API handed out (the real backend only). */
  feed: ((url: string) => Promise<Response>) | null;
  /** "METHOD /path" for every call the HTTP clients made (the real backend only). */
  calls: string[];
  /** The OpenGrants search to run, and the listing in it for a funder outside this GMS. */
  search: { query: string; title: string };
  real: boolean;
}

const HEX = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ID = new RegExp(`^(?:[a-z]{3}_)?${HEX}$`);
const SHA = /^[0-9a-f]{64}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/** The in-process API's clock (apps/api/test/helpers.ts). */
const CLOCK = new Date("2027-04-16T17:00:00Z");

const PASTED = `1. Describe the community you serve and the need this project meets. (250 words)

2. How will you measure success? Maximum 1,500 characters including spaces.

3. Attach a one-page budget narrative.`;

async function realBackend(): Promise<Backend> {
  const helpers = await loadApi();
  const h = (await helpers.harness()) as ApiHarness & { env: Record<string, string>; mailer: { sent: Mail[] } };
  const scn = (await import(/* @vite-ignore */ new URL("../../api/test/scenario.ts", import.meta.url).href)) as {
    scenario(h: ApiHarness): Promise<{ funder: Record<string, string> }>;
    USER_APPLICANT: string;
  };
  const s = await scn.scenario(h);
  // OpenGrants answers from the harness's fixture listings once a key is set, as on a real install.
  h.env.OPENGRANTS_API_KEY = "test-key-not-real";
  // A published opportunity with no competition: Find funding lists it as not taking applications.
  const opp = await h.request("/gms/opportunities", { method: "POST", headers: s.funder, body: JSON.stringify({ title: "Fall cycle 2027", description: "Opens in September." }) });
  const oppId = ((await opp.json()) as { data: { id: string } }).data.id;
  expect((await h.request(`/gms/opportunities/${oppId}/publish`, { method: "POST", headers: s.funder, body: "{}" })).status).toBe(200);

  const ws = (helpers as unknown as { WS_APPLICANT: string }).WS_APPLICANT;
  const calls: string[] = [];
  const fetchInProcess: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const u = new URL(req.url);
    calls.push(`${req.method} ${u.pathname}`);
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
    return h.request(u.pathname + u.search, { method: req.method, headers: req.headers, ...(body !== undefined ? { body } : {}) });
  };
  const opts = { baseUrl: helpers.BASE, token: () => h.session(scn.USER_APPLICANT, { aal: "aal2" }), workspaceId: () => ws, fetch: fetchInProcess };
  return {
    applicant: createHttpApplicantApi(opts),
    outside: createHttpOutsideApi(opts),
    mail: () => h.mailer.sent,
    // The feed is public: no bearer, no workspace header, only the link.
    feed: (url) => {
      const u = new URL(url);
      return h.request(u.pathname + u.search);
    },
    calls,
    search: { query: "rural", title: "Rural Health Access Fund" },
    real: true,
  };
}

async function mockBackend(): Promise<Backend> {
  const store = seedApplicantStore();
  const session = async () => demoSession();
  return {
    applicant: createMockApplicantApi({ session, store }),
    // The same clock as the in-process API, so dates "in the future" mean the same on both.
    outside: createMockOutsideApi({ session, applicant: store, origin: "https://gms.test", now: () => CLOCK }),
    mail: () => [],
    feed: null,
    calls: [],
    search: { query: "rural", title: "Rural Health Network Development Planning" },
    real: false,
  };
}

const status = async (p: Promise<unknown>): Promise<number> => {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof ApiError ? e.status : -1;
  }
};
const text = (b: Blob) => b.text();

describe.each([
  ["the real API in-process", realBackend],
  ["the mock", mockBackend],
])("apply anywhere against %s", (_name, make) => {
  let b: Backend;
  let listing: OpenGrantsListing;
  let id = "";
  let questions: OutsideQuestion[] = [];
  let receiptId = "";
  beforeAll(async () => {
    b = await make();
  });

  it("discovery: open competitions carry eligibility; published ones not taking applications carry none", async () => {
    const items = await b.applicant.discover();
    const open = items.filter((d) => d.acceptingApplications);
    const notOpen = items.filter((d) => !d.acceptingApplications);
    expect(open.length).toBeGreaterThan(0);
    for (const d of open) {
      expect(isAccepting(d)).toBe(true);
      expect(d.competitionId).toMatch(ID);
      expect([true, false, "unknown"]).toContain(d.eligibility!.eligible);
    }
    expect(notOpen.length).toBeGreaterThan(0);
    for (const d of notOpen) {
      expect(d).toMatchObject({ competitionId: null, eligibility: null, stage: null, application: null });
      expect(isAccepting(d)).toBe(false);
      expect(d.opportunity.title).toBeTruthy();
    }
    // Saving one keeps it under Saved as this GMS's item.
    const target = notOpen[0]!;
    const saved = await b.applicant.save({ source: "gms", externalId: target.opportunity.id, title: target.opportunity.title, ...(target.url ? { url: target.url } : {}) });
    expect(saved).toMatchObject({ source: "gms", title: target.opportunity.title });
    expect((await b.applicant.saved()).some((x) => x.id === saved.id)).toBe(true);
  });

  it("an OpenGrants listing: search, details, then start it as an outside application (once)", async () => {
    const found = await b.applicant.openGrants("search", { query: b.search.query });
    listing = found.results.find((l) => l.title === b.search.title)!;
    expect(listing).toBeDefined();
    expect(listing.id).toBeTruthy();
    expect(listing.gms ?? null).toBeNull();
    // Details: the server reads the one listing when the OpenGrants API can; otherwise the web keeps the result it has.
    const one = await b.outside.openGrantsListing(listing.id).catch((e: unknown) => e);
    if (one instanceof ApiError) expect(one.status).toBe(404);
    else expect(one).toMatchObject({ id: listing.id, title: listing.title });

    // As FindFunding's outsideFromListing makes it.
    const input = {
      source: "opengrants" as const,
      sourceRef: listing.id,
      listing: { ...(listing.funder ? { funder: listing.funder } : {}), ...(listing.summary ? { summary: listing.summary } : {}), ...(listing.url ? { url: listing.url } : {}) },
      title: listing.title,
      funderName: listing.funder?.trim() || "Funder not named in the listing",
      ...(listing.url ? { listingUrl: listing.url } : {}),
      fullDue: "2027-06-15",
      stage: "prospect" as const,
    };
    const made = await b.outside.create(input);
    expect(made).toMatchObject({ title: listing.title, stage: "prospect", source: "opengrants", sourceRef: listing.id, fullDue: "2027-06-15", archivedAt: null });
    expect(made.id).toMatch(ID);
    expect(made.listing).toMatchObject({ url: listing.url });
    id = made.id;
    // The same listing again answers the one already tracked.
    expect((await b.outside.create({ ...input, title: "Something else" })).id).toBe(id);
    const mine = (await b.outside.list()).filter((o) => o.sourceRef === listing.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id, stage: "prospect", source: "opengrants", deadlines: { fullDue: "2027-06-15", rolling: false }, questionCounts: { total: 0, approved: 0 } });
    // Start application on a prospect moves it to drafting.
    expect((await b.outside.move(id, "drafting")).stage).toBe("drafting");
    expect((await b.outside.list({ stage: "drafting" })).map((o) => o.id)).toContain(id);
    // Only plain moves go through stage; submitted is its own call.
    expect(await status(b.outside.move(id, "submitted"))).toBe(409);
  });

  it("paste: parse proposes questions with their limits and saves nothing; the bulk add saves them", async () => {
    const parsed = await b.outside.parseQuestions(id, PASTED);
    expect(parsed.map((q) => [q.limitKind ?? null, q.limitValue ?? null])).toEqual([
      ["words", 250],
      ["chars", 1500],
      [null, null],
    ]);
    expect(parsed[0]!.prompt).toMatch(/^Describe the community you serve/);
    expect(parsed.every((q) => q.phase === "full")).toBe(true);
    expect((await b.outside.get(id)).questions).toHaveLength(0);

    questions = await b.outside.addQuestions(
      id,
      parsed.map((q) => ({ prompt: q.prompt, phase: q.phase, limitKind: q.limitKind ?? null, limitValue: q.limitValue ?? null })),
    );
    expect(questions).toHaveLength(3);
    expect(questions.map((q) => [q.limitKind, q.limitValue, q.status, q.answer])).toEqual([
      ["words", 250, "empty", null],
      ["chars", 1500, "empty", null],
      [null, null, "empty", null],
    ]);
    for (const q of questions) expect(q.id).toMatch(ID);
    const edited = await b.outside.updateQuestion(questions[2]!.id, { guidance: "One page", required: true });
    expect(edited).toMatchObject({ id: questions[2]!.id, guidance: "One page", required: true });
  });

  it("answers: each save is a version with counts; a library insert is marked; over the limit says so", async () => {
    const [q1, q2] = questions as [OutsideQuestion, OutsideQuestion];
    const body = "We serve 1,200 families across three rural counties.";
    const v1 = await b.outside.putAnswer(q1.id, { body });
    expect(v1).toMatchObject({ questionId: q1.id, version: 1, body, provenance: "user", libraryAnswerId: null, overLimit: false });
    expect(v1.counts).toEqual(countText(body));

    const library = (await b.applicant.answers())[0] ?? (await b.applicant.createAnswer({ title: "Mission", body: "Alder Creek Family Services helps families stay together." }));
    const v2 = await b.outside.putAnswer(q1.id, { body: library.body, libraryAnswerId: library.id });
    expect(v2).toMatchObject({ version: 2, provenance: "library", libraryAnswerId: library.id });
    expect(v2.counts.words).toBe(countText(library.body).words);

    const long = "word ".repeat(300).trim();
    const over = await b.outside.putAnswer(q1.id, { body: long });
    expect(over).toMatchObject({ version: 3, overLimit: true, counts: { words: 300 } });
    await b.outside.putAnswer(q1.id, { body });

    const history = await b.outside.answerHistory(q1.id);
    expect(history.map((a) => a.version)).toEqual([4, 3, 2, 1]);
    expect(history[2]).toMatchObject({ provenance: "library", libraryAnswerId: library.id });

    const chars = await b.outside.putAnswer(q2.id, { body: "Quarterly surveys and intake records." });
    expect(chars).toMatchObject({ version: 1, overLimit: false, counts: { chars: 37, charsNoSpaces: 33 } });
    expect((await b.outside.updateQuestion(q2.id, { status: "approved" })).status).toBe("approved");

    const detail = await b.outside.get(id);
    expect(detail.questions.map((q) => q.answer?.version ?? null)).toEqual([4, 1, null]);
    expect(detail.questions[0]!.answer!.body).toBe(body);
    expect((await b.outside.list()).find((o) => o.id === id)!.questionCounts).toEqual({ total: 3, approved: 1 });
  });

  it("documents: an upload is listed on the application and can be opened", async () => {
    const doc = await b.outside.uploadDocument(id, { name: "receipt.txt", mime: "text/plain", contentBase64: btoa("Confirmation NW-0412") });
    expect(doc).toMatchObject({ name: "receipt.txt" });
    expect(doc.id).toMatch(ID);
    receiptId = doc.id;
    const detail = await b.outside.get(id);
    expect(detail.documents.map((d) => d.id)).toContain(doc.id);
    const listed = detail.documents.find((d) => d.id === doc.id)!;
    expect(listed.name).toBe("receipt.txt");
    expect(typeof listed.size).toBe("number");
    expect(listed.uploadedAt).toMatch(ISO_DAY);
    const file = await b.outside.documentFile(id, doc.id);
    expect(await text(file.blob)).toBe("Confirmation NW-0412");
    expect(file.filename).toContain("receipt");
  });

  it("tasks: one on the outside application shows on its checklist", async () => {
    const task = await b.outside.createTask(id, { title: "Collect the audit", dueAt: "2027-06-01T17:00:00Z" });
    expect(task).toMatchObject({ title: "Collect the audit", subjectType: "outside_application", doneAt: null });
    expect(task.dueAt).toMatch(/^2027-06-01/);
    const detail = await b.outside.get(id);
    expect(detail.tasks.map((t) => t.id)).toContain(task.id);
    const done = await b.applicant.updateTask(task.id, { done: true });
    expect(done.doneAt).toBeTruthy();
  });

  it("submit: records the submission made elsewhere and keeps an as-submitted PDF with its hash", async () => {
    const sub = await b.outside.submit(id, { submittedAt: "2027-04-10", method: "portal", confirmationRef: "NW-0412", receiptDocumentId: receiptId });
    expect(sub).toMatchObject({ stage: "submitted", submissionMethod: "portal", confirmationRef: "NW-0412", receiptDocumentId: receiptId });
    expect(sub.submittedAt).toMatch(/^2027-04-10/);
    expect(sub.snapshotDocumentId).toMatch(ID);
    expect(sub.snapshotSha256).toMatch(SHA);
    const pdf = await b.outside.documentFile(id, sub.snapshotDocumentId!);
    const bytes = new Uint8Array(await pdf.blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
    expect(hash).toBe(sub.snapshotSha256);
    expect((await b.outside.get(id)).documents.map((d) => d.id)).toContain(sub.snapshotDocumentId);
    const exported = await b.outside.exportApplication(id, "md");
    expect(await text(exported.blob)).toContain("Describe the community you serve");
  });

  it("decision, reopen, and the decision again", async () => {
    const awarded = await b.outside.decide(id, { outcome: "awarded", awardedAmount: { amount: "40000.00", currency: "USD" }, awardByYear: [{ year: 2027, amountMinor: 2_000_000 }, { year: 2028, amountMinor: 2_000_000 }], grantStart: "2027-07-01", grantEnd: "2028-06-30", notes: "Two-year grant" });
    expect(awarded).toMatchObject({ stage: "awarded", awardedAmount: { amount: "40000.00", currency: "USD" }, awardByYear: [{ year: 2027, amountMinor: 2_000_000 }, { year: 2028, amountMinor: 2_000_000 }], grantStart: "2027-07-01", grantEnd: "2028-06-30", decisionNotes: "Two-year grant" });
    expect(awarded.decidedAt).toBeTruthy();
    const reopened = await b.outside.reopen(id);
    expect(reopened).toMatchObject({ stage: "submitted", awardedAmount: null, decidedAt: null });
    expect(reopened.snapshotSha256).toMatch(SHA);
    expect((await b.outside.decide(id, { outcome: "awarded", awardedAmount: { amount: "40000.00", currency: "USD" } })).stage).toBe("awarded");
  });

  it("pipeline: one list of built-in applications, outside ones and saved items", async () => {
    const items = await b.outside.pipeline();
    const mine = items.find((p) => p.kind === "outside_application" && p.id === id);
    expect(mine).toMatchObject({ title: listing.title, stage: "awarded" });
    expect(mine!.url).toContain(`/outside/${id}`);
    expect(items.some((p) => p.kind === "saved_gms")).toBe(true);
    for (const p of items) {
      expect(["gms_application", "outside_application", "saved_gms"]).toContain(p.kind);
      expect(p.title).toBeTruthy();
      if (p.nextDeadline !== null) expect(p.nextDeadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("funder records: contacts, notes, the portal login holder and past asks", async () => {
    const rec = await b.outside.createFunderRecord({ name: listing.funder!, website: "https://northwind.example", notes: "Prefers short LOIs.", contacts: [{ name: "Ana Ruiz", role: "Program officer", email: "ana@northwind.example" }], portalUrl: "https://portal.northwind.example", portalLoginHolder: "Dana Ortiz" });
    expect(rec).toMatchObject({ name: listing.funder, notes: "Prefers short LOIs.", portalLoginHolder: "Dana Ortiz", contacts: [{ name: "Ana Ruiz", role: "Program officer", email: "ana@northwind.example" }] });
    expect(rec.applications.map((a) => a.id)).toContain(id);
    const past = rec.applications.find((a) => a.id === id)!;
    expect(past).toMatchObject({ kind: "outside_application", stage: "awarded", awardedAmount: { amount: "40000.00", currency: "USD" } });
    // Linked by the record itself, not by a name match with a funder on this GMS.
    expect(past.nameMatch ?? false).toBe(false);
    expect((await b.outside.funderRecords()).map((r) => r.id)).toContain(rec.id);
    expect((await b.outside.updateFunderRecord(rec.id, { notes: "Prefers two-page LOIs." })).notes).toBe("Prefers two-page LOIs.");
    expect((await b.outside.funderRecord(rec.id)).applications.map((a) => a.id)).toContain(id);
    expect((await b.outside.get(id)).funderRecordId).toBe(rec.id);
    const spare = await b.outside.createFunderRecord({ name: "Cascade Trust" });
    await b.outside.deleteFunderRecord(spare.id);
    expect(await status(b.outside.funderRecord(spare.id))).toBe(404);
  });

  it("calendar feed: the link is shown once and serves deadlines without signing in", async () => {
    const other = await b.outside.create({ source: "manual", title: "Capacity building 2028", funderName: "Cascade Trust", loiDue: "2027-09-01", fullDue: "2027-10-15" });
    const { url } = await b.outside.createCalendarFeed();
    expect(url).toMatch(/\/cal\/[A-Za-z0-9_-]+\.ics$/);
    if (b.feed) {
      const res = await b.feed(url);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/calendar");
      const ics = await res.text();
      expect(ics).toContain("BEGIN:VCALENDAR");
      expect(ics).toContain("Capacity building 2028");
      expect(ics).toContain("20270901");
      // Rotating replaces the link; the old one stops working.
      const rotated = await b.outside.createCalendarFeed();
      expect(rotated.url).not.toBe(url);
      expect((await b.feed(url)).status).toBe(404);
      await b.outside.deleteCalendarFeed();
      expect((await b.feed(rotated.url)).status).toBe(404);
    } else {
      await b.outside.deleteCalendarFeed();
    }
    await b.outside.archive(other.id);
    expect((await b.outside.list()).map((o) => o.id)).not.toContain(other.id);
    expect((await b.outside.list({ archived: true })).map((o) => o.id)).toContain(other.id);
    expect((await b.outside.unarchive(other.id)).archivedAt).toBeNull();
  });

  it("import: a dry run previews rows with their problems and creates nothing; the real run creates the good rows", async () => {
    const csv = "Grant,Funder,Due,Ask\nSummer camp 2027,Larkspur Fund,2027-08-01,12000\n,No title,2027-08-01,1\nRoof repair,Pinecrest Trust,not a date,5000\n";
    const mapping = { title: "Grant", funderName: "Funder", fullDue: "Due", askAmount: "Ask" };
    const before = (await b.outside.list()).length;
    const dry = await b.outside.importCsv({ csv, mapping, dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.created).toEqual([]);
    expect(dry.rows.map((r) => r.row)).toEqual([2, 3, 4]);
    expect(dry.rows[0]!.problems).toEqual([]);
    expect(dry.rows[0]!.values).toMatchObject({ title: "Summer camp 2027", funderName: "Larkspur Fund" });
    expect(dry.rows[1]!.problems.length).toBeGreaterThan(0);
    expect(dry.rows[2]!.problems.length).toBeGreaterThan(0);
    for (const p of dry.rows.flatMap((r) => r.problems)) expect(p.message).toBeTruthy();
    expect((await b.outside.list()).length).toBe(before);
    const run = await b.outside.importCsv({ csv, mapping, dryRun: false });
    expect(run.dryRun).toBe(false);
    expect(run.created.map((c) => c.title)).toEqual(["Summer camp 2027"]);
    expect(run.created[0]).toMatchObject({ funderName: "Larkspur Fund", deadlines: { fullDue: "2027-08-01" } });
    expect((await b.outside.list()).length).toBe(before + 1);
    const all = await b.outside.exportAll("csv");
    expect(await text(all.blob)).toContain("Summer camp 2027");
  });

  it("consulting request: the preview is exactly what is sent; answers only when asked", async () => {
    const who = { contactName: "Maria Santos", contactEmail: "maria@aldercreekfs.example", message: "We need help with the evaluation plan." };
    const plain = await b.outside.consultingPreview(id, who);
    expect(plain).toMatchObject({ replyTo: who.contactEmail, contactName: who.contactName, contactEmail: who.contactEmail, title: listing.title, funder: listing.funder, stage: "awarded", questionCount: 3, message: who.message, answers: null, answersTruncated: false });
    expect(plain.to).toBe("hello@agents.opengrants.io");
    expect(plain.subject).toBe(`Consulting request: ${listing.title} (${plain.organization})`);
    expect(plain.organization).toBe("Alder Creek Family Services");
    expect(plain.deadlines).toMatchObject({ fullDue: "2027-06-15" });
    const withAnswers = await b.outside.consultingPreview(id, { ...who, includeAnswers: true });
    // Every question goes, in order; one not answered yet goes with an empty answer.
    expect(withAnswers.answers?.map((a) => a.prompt.slice(0, 20))).toEqual(["Describe the communi", "How will you measure", "Attach a one-page bu"]);
    expect(withAnswers.answers!.map((a) => a.body)).toEqual(["We serve 1,200 families across three rural counties.", "Quarterly surveys and intake records.", ""]);
    expect(withAnswers.answersTruncated).toBe(false);

    const before = b.mail().length;
    const sent = await b.outside.sendConsulting(id, who);
    expect(sent).toMatchObject({ to: "hello@agents.opengrants.io", replyTo: who.contactEmail });
    expect(sent.sentAt).toMatch(ISO_DAY);
    if (b.real) {
      const mail = b.mail().slice(before);
      expect(mail).toHaveLength(1);
      expect(mail[0]).toMatchObject({ to: ["hello@agents.opengrants.io"], replyTo: who.contactEmail, subject: plain.subject });
      expect(mail[0]!.text).toContain("right away");
      expect(mail[0]!.text).not.toContain("We serve 1,200 families");
    }
    for (let i = 0; i < 2; i++) await b.outside.sendConsulting(id, who);
    expect(await status(b.outside.sendConsulting(id, who))).toBe(429);
  });

  it("the real client called every endpoint the screens use, under /gms", () => {
    if (!b.real) return;
    const seen = new Set(b.calls.map((c) => c.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ":id").replace(/(app|opp)_:id/g, ":id")));
    for (const c of [
      "GET /gms/discover/competitions",
      "POST /gms/discover/saved",
      "GET /gms/discover/saved",
      "POST /gms/discover/opengrants/search",
      "GET /gms/discover/opengrants/og-1",
      "POST /gms/outside-applications",
      "GET /gms/outside-applications",
      "GET /gms/outside-applications/:id",
      "POST /gms/outside-applications/:id/stage",
      "POST /gms/outside-applications/:id/questions/parse",
      "POST /gms/outside-applications/:id/questions",
      "PATCH /gms/outside-questions/:id",
      "PUT /gms/outside-questions/:id/answer",
      "GET /gms/outside-questions/:id/answers",
      "POST /gms/outside-applications/:id/documents",
      "GET /gms/outside-applications/:id/documents/:id/file",
      "POST /gms/tasks",
      "POST /gms/outside-applications/:id/submit",
      "GET /gms/outside-applications/:id/export",
      "POST /gms/outside-applications/:id/decision",
      "POST /gms/outside-applications/:id/reopen",
      "POST /gms/outside-applications/:id/archive",
      "POST /gms/outside-applications/:id/unarchive",
      "GET /gms/pipeline",
      "POST /gms/funder-records",
      "GET /gms/funder-records",
      "GET /gms/funder-records/:id",
      "PATCH /gms/funder-records/:id",
      "DELETE /gms/funder-records/:id",
      "POST /gms/calendar-feed",
      "DELETE /gms/calendar-feed",
      "POST /gms/outside-applications/import",
      "GET /gms/outside-applications/export.csv",
      "POST /gms/outside-applications/:id/consulting-request/preview",
      "POST /gms/outside-applications/:id/consulting-request",
    ])
      expect(seen, c).toContain(c);
  });
});
