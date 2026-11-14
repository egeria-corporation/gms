// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// Write faster and win and keep it (v1.6.0), one scenario on two backends: (a) the web HTTP
// clients (api/writeKeep.ts, and the outside, applicant and assistant calls the same screens make)
// against the real API Worker in-process over its in-memory repositories, with the fake model
// (assistant off, then on), the in-memory mail port and file storage, and (b) the in-browser mock.
// The same assertions run on both, on the fields the screens read, so the e2e flows (mock mode)
// prove what a real install does. Each call is shaped the way the screens make it.
import { beforeAll, describe, expect, it } from "vitest";
import { createHttpApplicantApi, type AppDocument, type ApplicantApi } from "../src/api/applicant.ts";
import { createHttpApplicantFullApi, type ApplicantFullApi } from "../src/api/applicantFull.ts";
import { ApiError } from "../src/api/client.ts";
import { createHttpOutsideApi, type OutsideApi, type OutsideQuestion } from "../src/api/outside.ts";
import { createHttpWriteKeepApi, libraryWithMeta, type Obligation, type WriteKeepApi } from "../src/api/writeKeep.ts";
import { countText } from "../src/lib/outside.ts";
import { bestVariant, isStale, movesFrom, variantChoices } from "../src/lib/writeKeep.ts";
import { createMockApplicantApi, seedApplicantStore } from "../src/mocks/applicant.ts";
import { createMockApplicantFullApi, seedFullStore } from "../src/mocks/applicantFull.ts";
import { demoSession } from "../src/mocks/auth.ts";
import { createMockOutsideApi, seedOutsideStore, textPdf } from "../src/mocks/outside.ts";
import { createMockWriteKeepApi } from "../src/mocks/writeKeep.ts";
import { loadApi, type ApiHarness } from "./api-harness.ts";

interface Mail {
  to: string[];
  subject: string;
  text: string;
}
interface Backend {
  applicant: ApplicantApi;
  outside: OutsideApi;
  full: ApplicantFullApi;
  wk: WriteKeepApi;
  /** Switches the assistant on or off for the workspace (the server's env, or the mock's status). */
  assist(on: boolean): void;
  /** Sets the workspace's monthly assistant limit (null: the default again). */
  quota(limit: number | null): void;
  /** What the model answers next (the real backend's fake model; the mock writes its own). */
  model(answer: unknown): void;
  /** Every request the model was sent (the real backend only). */
  modelRequests: () => { user?: string; documents?: { kind: string; title?: string }[] }[];
  mail: () => Mail[];
  /** A raw call to the API, for routes the screens do not use (the real backend only). */
  raw: ((method: string, path: string, body?: unknown) => Promise<{ status: number; data: unknown }>) | null;
  /** "METHOD /path" for every call the HTTP clients made (the real backend only). */
  calls: string[];
  real: boolean;
}

const HEX = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ID = new RegExp(`^(?:[a-z]{3}_)?${HEX}$`);
const SHA = /^[0-9a-f]{64}$/;

/** The in-process API's clock (apps/api/test/helpers.ts); the mock runs on the same one. */
const CLOCK = new Date("2027-04-16T17:00:00Z");
const TODAY = "2027-04-16";

const GUIDELINES = [
  "Northwind Family Foundation: 2027 guidelines",
  "",
  "1. Describe your project and the families it serves. (250 words)",
  "",
  "2. How will you measure success? Maximum 1,500 characters including spaces.",
  "",
  "Attach your IRS determination letter and your most recent audit.",
].join("\n");
/** What the fake model reads from GUIDELINES: what a careful reader (and the mock) finds there. */
const READING = {
  questions: [
    { prompt: "Describe your project and the families it serves.", limitKind: "words", limitValue: 250, phase: "full" },
    { prompt: "How will you measure success?", limitKind: "chars", limitValue: 1500, phase: "full" },
  ],
  requiredDocuments: ["IRS determination letter", "Most recent audit"],
  deadlines: { loiDue: null, fullDue: null },
  cautions: [],
};

const b64 = (s: string) => btoa(s);
const bytesB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const sha256 = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer))].map((x) => x.toString(16).padStart(2, "0")).join("");

async function realBackend(): Promise<Backend> {
  const helpers = await loadApi();
  const h = (await helpers.harness()) as ApiHarness & {
    env: Record<string, string>;
    mailer: { sent: Mail[] };
    llm: { requests: { user?: string; documents?: { kind: string; title?: string }[] }[] };
    llmAnswer: { value: unknown };
  };
  const scn = (await import(/* @vite-ignore */ new URL("../../api/test/scenario.ts", import.meta.url).href)) as {
    scenario(h: ApiHarness): Promise<unknown>;
    USER_APPLICANT: string;
  };
  await scn.scenario(h);
  const ws = (helpers as unknown as { WS_APPLICANT: string }).WS_APPLICANT;
  const calls: string[] = [];
  const token = () => h.session(scn.USER_APPLICANT, { aal: "aal2" });
  const fetchInProcess: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const u = new URL(req.url);
    calls.push(`${req.method} ${u.pathname}`);
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
    return h.request(u.pathname + u.search, { method: req.method, headers: req.headers, ...(body !== undefined ? { body } : {}) });
  };
  const opts = { baseUrl: helpers.BASE, token, workspaceId: () => ws, fetch: fetchInProcess };
  return {
    applicant: createHttpApplicantApi(opts),
    outside: createHttpOutsideApi(opts),
    full: createHttpApplicantFullApi(opts),
    wk: createHttpWriteKeepApi(opts),
    assist: (on) => {
      h.env.ASSISTANT_ENABLED = on ? "true" : "false";
    },
    quota: (limit) => {
      if (limit === null) delete h.env.ASSISTANT_MONTHLY_QUOTA;
      else h.env.ASSISTANT_MONTHLY_QUOTA = String(limit);
    },
    model: (answer) => {
      h.llmAnswer.value = answer;
    },
    modelRequests: () => h.llm.requests,
    mail: () => h.mailer.sent,
    raw: async (method, path, body) => {
      const res = await h.request(path, { method, headers: { Authorization: `Bearer ${await token()}`, "X-GMS-Workspace": ws, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const json = (await res.json().catch(() => ({}))) as { data?: unknown };
      return { status: res.status, data: json.data };
    },
    calls,
    real: true,
  };
}

async function mockBackend(): Promise<Backend> {
  const applicant = seedApplicantStore();
  const outside = seedOutsideStore();
  const full = seedFullStore(applicant);
  const session = async () => demoSession();
  const now = () => CLOCK;
  return {
    applicant: createMockApplicantApi({ session, store: applicant }),
    outside: createMockOutsideApi({ session, applicant, store: outside, origin: "https://gms.test", now }),
    full: createMockApplicantFullApi({ session, store: applicant, full }),
    wk: createMockWriteKeepApi({ session, applicant, outside, full, now }),
    assist: (on) => {
      full.assist = on ? { enabled: true, quota: { used: 0, limit: 100, remaining: 100, resetsAt: "2027-05-01T00:00:00Z" } } : { enabled: false, quota: null };
    },
    quota: (limit) => {
      const used = full.assist.quota?.used ?? 0;
      const max = limit ?? 100;
      full.assist = { ...full.assist, quota: { used, limit: max, remaining: Math.max(0, max - used), resetsAt: "2027-05-01T00:00:00Z" } };
    },
    model: () => undefined,
    modelRequests: () => [],
    mail: () => [],
    raw: null,
    calls: [],
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
const used = async (b: Backend) => (await b.full.assistStatus()).quota?.used ?? 0;
const docType = (d: AppDocument) => (d as { docType?: string | null }).docType ?? null;

describe.each([
  ["the real API in-process", realBackend],
  ["the mock", mockBackend],
])("write faster and keep it against %s", (_name, make) => {
  let b: Backend;
  // The application written with the assistant, then awarded.
  let id = "";
  let questions: OutsideQuestion[] = [];
  let needId = "";
  let vaultId = "";
  let summaryBefore: Awaited<ReturnType<WriteKeepApi["fundingSummary"]>>;
  beforeAll(async () => {
    b = await make();
    summaryBefore = await b.wk.fundingSummary();
    const made = await b.outside.create({ source: "manual", title: "Rural clinics 2027", funderName: "Northwind Family Foundation", programName: "Healthy Valleys", fullDue: "2027-06-15", askAmount: { amount: "60000.00", currency: "USD" }, stage: "drafting" });
    id = made.id;
    questions = await b.outside.addQuestions(id, [
      { prompt: "Describe the need your project addresses and the families you serve.", phase: "full", limitKind: "words", limitValue: 60 },
      { prompt: "How will you measure success?", phase: "full", limitKind: "chars", limitValue: 1500 },
    ]);
    needId = (await b.applicant.createAnswer({ title: "Need statement", body: "Families in the valley travel 46 miles to reach primary care, and many of the families we serve go without it." })).id;
    await b.applicant.createAnswer({ title: "Families we serve", body: "We serve families across three rural counties of the valley." });
  });

  // ------------------------------------------------------------------ write faster

  it("assistant off: the screens hide AI actions, and the routes refuse them", async () => {
    b.assist(false);
    expect((await b.full.assistStatus()).enabled).toBe(false);
    expect(await status(b.wk.draftAnswer(questions[0]!.id))).toBe(404);
    expect(await status(b.wk.readGuidelines(id, GUIDELINES))).toBe(404);
    expect(await status(b.wk.uploadGuidelines(id, { name: "Northwind guidelines.pdf", mime: "application/pdf", contentBase64: bytesB64(textPdf(GUIDELINES.split("\n"))) }))).toBe(404);
    // The deterministic reading still works, and nothing was kept.
    expect((await b.outside.parseQuestions(id, GUIDELINES)).length).toBeGreaterThan(0);
    const detail = await b.outside.get(id);
    expect(detail.documents.filter((d) => docType(d) === "funder_guidelines")).toHaveLength(0);
    expect(b.modelRequests()).toHaveLength(0);
  });

  it("assistant on: a draft from the library, with [unknowns] and stale figures, saved only when accepted", async () => {
    b.assist(true);
    expect((await b.full.assistStatus()).enabled).toBe(true);
    const before = await used(b);
    b.model({ draft: "Families in the valley travel 46 miles to reach primary care. With this grant we would [what this grant would pay for].", usedAnswerIds: [needId], unknowns: [], staleFlags: [] });
    const q = questions[0]!;
    const draft = await b.wk.draftAnswer(q.id);
    expect(draft.draft.length).toBeGreaterThan(0);
    expect(draft.counts).toEqual(countText(draft.draft));
    expect(draft.overLimit).toBe(false);
    expect(draft.counts.words).toBeLessThanOrEqual(60);
    // Unknowns are written into the draft as [bracketed placeholders].
    expect(draft.unknowns.length).toBeGreaterThan(0);
    for (const u of draft.unknowns) expect(draft.draft).toContain(`[${u}]`);
    // The draft cites library answers, and the stale ones' figures are flagged.
    expect(draft.usedAnswerIds).toContain(needId);
    expect(draft.staleFlags.length).toBeGreaterThan(0);
    for (const f of draft.staleFlags) {
      expect(draft.usedAnswerIds).toContain(f.answerId);
      expect(draft.draft).toContain(f.figure);
    }
    expect(draft.staleFlags.some((f) => f.answerId === needId && f.figure.startsWith("46"))).toBe(true);
    expect(await used(b)).toBe(before + 1);
    // Nothing saved yet.
    expect((await b.outside.get(id)).questions[0]!.answer).toBeNull();
    if (b.real) {
      const sent = b.modelRequests().at(-1)!;
      expect(sent.user).toContain("46 miles");
      expect(sent.documents).toBeUndefined();
    }

    // Accept (or edit, then save): one version with provenance assist; the "AI use" note reads it.
    const saved = await b.outside.putAnswer(q.id, { body: `${draft.draft} Edited by Maria.`, provenance: "assist" });
    expect(saved).toMatchObject({ questionId: q.id, version: 1, provenance: "assist", libraryAnswerId: null });
    const detail = await b.outside.get(id);
    expect(detail.questions.filter((x) => x.answer?.provenance === "assist").map((x) => x.id)).toEqual([q.id]);
    // A question the person writes is not listed.
    await b.outside.putAnswer(questions[1]!.id, { body: "Quarterly surveys and intake records." });
    expect((await b.outside.get(id)).questions[1]!.answer!.provenance).toBe("user");
  });

  it("guidelines, pasted or uploaded: proposed questions and required documents, nothing saved but the file", async () => {
    b.model(READING);
    const before = await used(b);
    const pasted = await b.wk.readGuidelines(id, GUIDELINES);
    expect(pasted.questions.map((q) => [q.prompt.slice(0, 29), q.limitKind ?? null, q.limitValue ?? null, q.phase])).toEqual([
      ["Describe your project and the", "words", 250, "full"],
      ["How will you measure success?", "chars", 1500, "full"],
    ]);
    expect(pasted.requiredDocuments).toEqual(["IRS determination letter", "Most recent audit"]);
    expect(pasted.document).toBeNull();
    expect(await used(b)).toBe(before + 1);
    expect((await b.outside.get(id)).questions).toHaveLength(2);
    expect(await status(b.wk.readGuidelines(id, "x".repeat(60_001)))).toBe(422);

    const pdf = textPdf(GUIDELINES.split("\n"));
    const uploaded = await b.wk.uploadGuidelines(id, { name: "Northwind guidelines.pdf", mime: "application/pdf", contentBase64: bytesB64(pdf) });
    expect(uploaded.questions.map((q) => q.limitValue ?? null)).toEqual([250, 1500]);
    expect(uploaded.requiredDocuments).toEqual(["IRS determination letter", "Most recent audit"]);
    expect(uploaded.document).toMatchObject({ name: "Northwind guidelines.pdf" });
    expect(docType(uploaded.document!)).toBe("funder_guidelines");
    expect(await used(b)).toBe(before + 2);
    const detail = await b.outside.get(id);
    expect(detail.questions).toHaveLength(2);
    expect(detail.documents.filter((d) => docType(d) === "funder_guidelines").map((d) => d.id)).toEqual([uploaded.document!.id]);
    if (b.real) expect(b.modelRequests().at(-1)!.documents).toEqual([expect.objectContaining({ kind: "pdf", title: "Northwind guidelines.pdf" })]);
    // A bank form is refused before anything is kept or read.
    expect(await status(b.wk.uploadGuidelines(id, { name: "Voided check for ACH.pdf", mime: "application/pdf", contentBase64: bytesB64(pdf) }))).toBe(422);
    expect(await used(b)).toBe(before + 2);
  });

  it("quota: at the month's limit every AI action is refused, says when it resets, and keeps nothing", async () => {
    const spent = await used(b);
    b.quota(spent);
    expect((await b.full.assistStatus()).quota).toMatchObject({ used: spent, limit: spent, remaining: 0 });
    for (const call of [() => b.wk.draftAnswer(questions[1]!.id), () => b.wk.readGuidelines(id, GUIDELINES), () => b.wk.uploadGuidelines(id, { name: "Guidelines 2.pdf", mime: "application/pdf", contentBase64: bytesB64(textPdf(["1. Why now? (100 words)"])) })]) {
      const e = await call().catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(429);
      expect((e as ApiError).message).toMatch(/monthly limit\. The count resets on 2027-05-01/);
    }
    expect((await b.outside.get(id)).documents.map((d) => d.name)).not.toContain("Guidelines 2.pdf");
    expect(await used(b)).toBe(spent);
    b.quota(null);
  });

  it("library: verified dates, stale until verified, variants and tags; insert offers the variant that fits", async () => {
    const lib = await libraryWithMeta(() => b.applicant.answers(), b.wk);
    const need = lib.find((a) => a.id === needId)!;
    expect(need).toBeDefined();
    expect(need.lastVerifiedAt ?? null).toBeNull();
    expect(isStale(need.lastVerifiedAt, CLOCK)).toBe(true);
    for (const a of lib) expect("lastVerifiedAt" in a).toBe(true);
    // The library call itself carries the same fields.
    expect((await b.wk.library()).find((a) => a.id === needId)).toMatchObject({ lastVerifiedAt: null, tags: [] });

    const verified = await b.wk.verifyAnswer(needId);
    expect(verified.lastVerifiedAt).toBeTruthy();
    expect(isStale(verified.lastVerifiedAt, CLOCK)).toBe(false);

    // As the library screen saves them: variants and tags (on the server, a new version; the screen selects the returned id).
    const short = "Families travel 46 miles to reach primary care.";
    const changed = await b.wk.updateAnswerMeta(verified.id, { variants: { short }, tags: ["health", "rural"] });
    expect(changed.variants?.short).toBe(short);
    expect(changed.tags).toEqual(["health", "rural"]);
    // Text unchanged: still verified.
    expect(isStale(changed.lastVerifiedAt, CLOCK)).toBe(false);
    needId = changed.id;
    const after = (await libraryWithMeta(() => b.applicant.answers(), b.wk)).find((a) => a.id === changed.id)!;
    expect(after).toMatchObject({ variants: { short }, tags: ["health", "rural"] });

    // Insert from library: with a 10-word limit the short version is offered, without one the full answer.
    const choices = variantChoices(after);
    expect(bestVariant(choices, "words", 10)!.key).toBe("short");
    expect(bestVariant(choices, null, null)!.key).toBe("full");
    if (b.raw) {
      // The server's own suggestion for a question agrees with the browser's choice.
      const tight = (await b.outside.addQuestions(id, [{ prompt: "In one sentence, what need do the families you serve face?", phase: "full", limitKind: "words", limitValue: 10 }]))[0]!;
      const r = await b.raw("GET", `/gms/outside-questions/${tight.id}/library`);
      expect(r.status).toBe(200);
      const mine = (r.data as { id: string; suggested: { variant: string } }[]).find((x) => x.id === changed.id)!;
      expect(mine.suggested.variant).toBe("short");
      await b.outside.deleteQuestion(tight.id);
    }
  });

  it("vault: typed documents with expiry; bank-like names refused; the file comes back", async () => {
    const before = (await b.wk.vault()).length;
    const content = "Board of directors, 2027: seven members.";
    const doc = await b.wk.uploadVault({ name: "Board list 2027.pdf", mime: "application/pdf", contentBase64: b64(content), docType: "board_list", expiresOn: "2027-05-01" });
    expect(doc).toMatchObject({ name: "Board list 2027.pdf", docType: "board_list", expiresOn: "2027-05-01" });
    expect(doc.id).toMatch(ID);
    vaultId = doc.id;
    const list = await b.wk.vault();
    expect(list).toHaveLength(before + 1);
    expect(list.find((d) => d.id === doc.id)).toMatchObject({ docType: "board_list", expiresOn: "2027-05-01", size: content.length });
    for (const name of ["Voided check.pdf", "ACH form.pdf", "W-9 2027.pdf", "Bank letter.pdf"]) {
      const e = await b.wk.uploadVault({ name, mime: "application/pdf", contentBase64: b64("x"), docType: "other" }).catch((x: unknown) => x);
      expect(e, name).toBeInstanceOf(ApiError);
      expect((e as ApiError).status, name).toBe(422);
    }
    expect(await b.wk.vault()).toHaveLength(before + 1);
    // As the documents screen edits: a new expiry, or none.
    expect((await b.wk.updateVault(doc.id, { expiresOn: "2028-05-01" })).expiresOn).toBe("2028-05-01");
    expect((await b.wk.updateVault(doc.id, { expiresOn: null })).expiresOn).toBeNull();
    expect((await b.wk.updateVault(doc.id, { docType: "board_list", expiresOn: "2028-05-01" })).expiresOn).toBe("2028-05-01");
    const file = await b.wk.vaultFile(doc.id);
    expect(await file.blob.text()).toBe(content);
    expect(file.filename).toContain("Board list");
  });

  it("required documents: the checklist, met from the vault, back to needed when the document goes", async () => {
    const set = await b.wk.setRequiredDocuments(id, [
      { label: "IRS determination letter", documentId: null, status: "needed" },
      { label: "Board list", documentId: null, status: "needed" },
      { label: "Letters of support", documentId: null, status: "not_needed" },
    ]);
    expect(set).toEqual([
      { label: "IRS determination letter", documentId: null, status: "needed" },
      { label: "Board list", documentId: null, status: "needed" },
      { label: "Letters of support", documentId: null, status: "not_needed" },
    ]);
    const used = await b.wk.useFromVault(id, "Board list", vaultId);
    expect(used.find((d) => d.label === "Board list")).toEqual({ label: "Board list", documentId: vaultId, status: "attached" });
    expect((await b.outside.get(id)).requiredDocuments.find((d) => d.label === "Board list")).toEqual({ label: "Board list", documentId: vaultId, status: "attached" });
    // The checklist saves its whole list again, the attached one by its document.
    const again = await b.wk.setRequiredDocuments(id, (await b.outside.get(id)).requiredDocuments);
    expect(again.find((d) => d.label === "Board list")).toEqual({ label: "Board list", documentId: vaultId, status: "attached" });
    // Taking it off, then on again.
    expect((await b.wk.useFromVault(id, "Board list", null)).find((d) => d.label === "Board list")!.status).toBe("needed");
    await b.wk.useFromVault(id, "Board list", vaultId);
    expect(await status(b.wk.useFromVault(id, "Annual report", vaultId))).toBe(404);
  });

  it("milestones: the offered tasks are created on confirm and show on the checklist", async () => {
    const n = await b.wk.createMilestones(id, [
      { title: "Draft due", dueOn: "2027-06-01" },
      { title: "Review", dueOn: "2027-06-08" },
      { title: "Final", dueOn: "2027-06-13" },
    ]);
    expect(n).toBe(3);
    const tasks = (await b.outside.get(id)).tasks.filter((t) => ["Draft due", "Review", "Final"].includes(t.title));
    expect(tasks.map((t) => [t.title, t.dueAt?.slice(0, 10)])).toEqual([
      ["Draft due", "2027-06-01"],
      ["Review", "2027-06-08"],
      ["Final", "2027-06-13"],
    ]);
  });

  it("team writing: comments per question, and an admin approves", async () => {
    const q = questions[0]!;
    const c = await b.wk.addComment(q.id, "Can we add the 2026 numbers?");
    expect(c).toMatchObject({ questionId: q.id, body: "Can we add the 2026 numbers?" });
    expect(c.id).toBeTruthy();
    expect(c.authorUserId).toBeTruthy();
    expect(c.createdAt).toBeTruthy();
    expect((await b.wk.comments(id, q.id)).map((x) => x.id)).toEqual([c.id]);
    expect(await b.wk.comments(id, questions[1]!.id)).toEqual([]);
    expect((await b.outside.updateQuestion(q.id, { status: "approved" })).status).toBe("approved");
  });

  it("go/no-go: off by default; on, a scorecard at Deciding moves the stage through the workflow", async () => {
    const settings = await b.wk.settings();
    expect(settings).toEqual({ goNoGoEnabled: false, goNoGoWeights: { fit: 3, capacity: 2, effort: 2, relationship: 1 }, fiscalYearStartMonth: 1 });
    const go = await b.outside.create({ source: "manual", title: "Capacity building 2028", funderName: "Cascade Trust", fullDue: "2027-10-15", stage: "prospect" });
    expect((await b.outside.move(go.id, "deciding")).stage).toBe("deciding");
    const card = { eligibility: "pass" as const, scores: { fit: 4, capacity: 3, effort: 3, relationship: 5 }, decision: "go" as const, to: "drafting" as const, reason: "Strong fit" };
    expect(await status(b.wk.decideGoNoGo(go.id, card))).toBe(409);

    expect(await b.wk.saveSettings({ goNoGoEnabled: true })).toMatchObject({ goNoGoEnabled: true, goNoGoWeights: { fit: 3, capacity: 2, effort: 2, relationship: 1 } });
    expect((await b.wk.settings()).goNoGoEnabled).toBe(true);
    // Go needs eligibility and a next step.
    expect(await status(b.wk.decideGoNoGo(go.id, { ...card, eligibility: "fail" }))).toBe(400);
    const went = await b.wk.decideGoNoGo(go.id, card);
    expect(went.stage).toBe("drafting");
    expect(went.goNoGo).toMatchObject({ eligibility: "pass", scores: { fit: 4, capacity: 3, effort: 3, relationship: 5 }, total: 3.63, decision: "go", reason: "Strong fit" });
    expect(went.goNoGo!.decidedAt).toBeTruthy();
    expect((await b.outside.get(go.id)).goNoGo).toMatchObject({ decision: "go", total: 3.63 });

    const no = await b.outside.create({ source: "manual", title: "Arts in the park", funderName: "Cascade Trust", stage: "prospect" });
    await b.outside.move(no.id, "deciding");
    const dropped = await b.wk.decideGoNoGo(no.id, { eligibility: "fail", scores: { fit: 1, capacity: 2, effort: 2, relationship: 1 }, decision: "no_go", reason: "Outside our counties" });
    expect(dropped).toMatchObject({ stage: "not_pursuing", goNoGo: { decision: "no_go", eligibility: "fail" } });
    // Not at Deciding: refused.
    expect(await status(b.wk.decideGoNoGo(go.id, card))).toBe(409);
    expect(await b.wk.saveSettings({ goNoGoEnabled: false })).toMatchObject({ goNoGoEnabled: false });
  });

  // ------------------------------------------------------------------ win and keep it

  it("award: recorded, with its letter, listed in Awarded funding as an outside award", async () => {
    await b.outside.submit(id, { submittedAt: "2027-04-10", method: "portal", confirmationRef: "NW-0412" });
    const awarded = await b.outside.decide(id, { outcome: "awarded", awardedAmount: { amount: "60000.00", currency: "USD" }, awardByYear: [{ year: 2027, amountMinor: 3_000_000 }, { year: 2028, amountMinor: 3_000_000 }], grantStart: "2027-01-01", grantEnd: "2028-12-31" });
    expect(awarded).toMatchObject({ stage: "awarded", closedOutAt: null });
    const letter = await b.outside.uploadDocument(id, { name: "Award letter.pdf", mime: "application/pdf", contentBase64: bytesB64(textPdf(["Dear Alder Creek Family Services,", "We are pleased to award $60,000."])), docType: "award_letter" });
    expect(letter.id).toMatch(ID);
    const detail = await b.outside.get(id);
    // The award page finds the letter as the outside award screen does.
    expect([...detail.documents].reverse().find((d) => docType(d) === "award_letter" || d.id === detail.awardLetterDocumentId)!.id).toBe(letter.id);
    // A bank form is refused as an attachment too.
    expect(await status(b.outside.uploadDocument(id, { name: "Voided check.pdf", mime: "application/pdf", contentBase64: b64("x") }))).toBe(422);

    const award = (await b.wk.outsideAwards()).find((a) => a.id === id)!;
    expect(award).toEqual({ id, title: "Rural clinics 2027", funderName: "Northwind Family Foundation", awardedAmount: { amount: "60000.00", currency: "USD" }, receivedAmount: { amount: "0.00", currency: "USD" }, grantStart: "2027-01-01", grantEnd: "2028-12-31", closedOutAt: null, nextDue: null });
  });

  let reports: Obligation[] = [];
  let seriesId = "";
  let expectedId = "";
  let conditionId = "";
  it("obligations: a report series, payments received and expected, a condition, as the screens add them", async () => {
    expect(await b.wk.obligations(id)).toEqual([]);
    // The series editor: every 6 months from the first report until the grant's end.
    reports = await b.wk.createObligation(id, { kind: "report", title: "Progress report", series: { everyMonths: 6, startOn: "2027-06-30", endOn: "2028-12-31" } });
    expect(reports.map((o) => [o.title, o.dueOn, o.status])).toEqual([
      ["Progress report (1 of 4)", "2027-06-30", "upcoming"],
      ["Progress report (2 of 4)", "2027-12-30", "upcoming"],
      ["Progress report (3 of 4)", "2028-06-30", "upcoming"],
      ["Progress report (4 of 4)", "2028-12-30", "upcoming"],
    ]);
    seriesId = reports[0]!.seriesId!;
    expect(seriesId).toBeTruthy();
    expect(new Set(reports.map((o) => o.seriesId))).toEqual(new Set([seriesId]));
    // Payments received (the award page's form) and expected (the dialog); a condition with no date.
    const [paid] = await b.wk.createObligation(id, { kind: "payment_received", title: "Payment received", dueOn: "2027-02-01", amount: { amount: "30000.00", currency: "USD" } });
    expect(paid).toMatchObject({ kind: "payment_received", status: "received", dueOn: "2027-02-01", amount: { amount: "30000.00", currency: "USD" }, completedOn: "2027-02-01", allowedStatuses: [] });
    const [expected] = await b.wk.createObligation(id, { kind: "payment_expected", title: "Second payment", amount: { amount: "30000.00", currency: "USD" }, dueOn: "2027-04-20" });
    expectedId = expected!.id;
    // Due in four days: still upcoming (it becomes due on its date).
    expect(expected).toMatchObject({ status: "upcoming", amount: { amount: "30000.00", currency: "USD" } });
    const [condition] = await b.wk.createObligation(id, { kind: "condition", title: "Thank the funder in the annual report", dueOn: null });
    conditionId = condition!.id;
    expect(condition).toMatchObject({ kind: "condition", dueOn: null, status: "upcoming", amount: null });
    const [late] = await b.wk.createObligation(id, { kind: "condition", title: "Site visit", dueOn: "2027-04-01", notes: "Book the clinic room" });
    expect(late).toMatchObject({ status: "upcoming", notes: "Book the clinic room" });
    expect(late!.allowedStatuses).toEqual(movesFrom("condition", "upcoming"));
    // A report needs a date; payments need an amount.
    expect(await status(b.wk.createObligation(id, { kind: "report", title: "Final report", dueOn: null }))).not.toBe(200);
    expect(await status(b.wk.createObligation(id, { kind: "payment_received", title: "Payment received", dueOn: "2027-03-01" }))).not.toBe(200);

    const list = await b.wk.obligations(id);
    expect(list.map((o) => o.title)).toEqual(["Payment received", "Site visit", "Second payment", "Progress report (1 of 4)", "Progress report (2 of 4)", "Progress report (3 of 4)", "Progress report (4 of 4)", "Thank the funder in the annual report"]);
    for (const o of list) expect(o.allowedStatuses).toEqual(movesFrom(o.kind, o.status));
    await b.wk.deleteObligation(late!.id);
    expect((await b.wk.obligations(id)).map((o) => o.id)).not.toContain(late!.id);

    const award = (await b.wk.outsideAwards()).find((a) => a.id === id)!;
    expect(award.receivedAmount).toEqual({ amount: "30000.00", currency: "USD" });
    expect(award.nextDue).toEqual({ title: "Second payment", dueOn: "2027-04-20" });
  });

  it("obligations: edit one, re-plan the series (only future, untouched instances), settle the rest", async () => {
    // The dialog's "only this one" edit.
    const edited = await b.wk.updateObligation(reports[1]!.id, { title: "Progress report (2 of 4)", notes: "Send to Ana", dueOn: "2028-01-15" });
    expect(edited).toMatchObject({ notes: "Send to Ana", dueOn: "2028-01-15", seriesId });
    // "The whole series": every 12 months now; the edited one is kept.
    const r = await b.wk.updateSeries(seriesId, { title: "Progress report", notes: null, everyMonths: 12, startOn: "2027-06-30", endOn: "2028-12-31" });
    expect(r).toEqual({ replaced: 3, added: 2, kept: 1 });
    const series = (await b.wk.obligations(id)).filter((o) => o.seriesId === seriesId);
    expect(series.map((o) => [o.title, o.dueOn])).toEqual([
      ["Progress report (1 of 2)", "2027-06-30"],
      ["Progress report (2 of 4)", "2028-01-15"],
      ["Progress report (2 of 2)", "2028-06-30"],
    ]);
    reports = series;

    // The expected payment came in, with the amount received; the condition is done.
    const got = await b.wk.setObligationStatus(expectedId, { to: "received", completedOn: TODAY, amount: { amount: "29500.00", currency: "USD" } });
    expect(got).toMatchObject({ status: "received", completedOn: TODAY, amount: { amount: "29500.00", currency: "USD" } });
    const done = await b.wk.setObligationStatus(conditionId, { to: "done", completedOn: TODAY });
    expect(done).toMatchObject({ status: "done", completedOn: TODAY });
    expect(done.allowedStatuses).toEqual(["due"]);
    // Submitted has its own call; an edge the kind does not have is refused.
    expect(await status(b.wk.setObligationStatus(reports[0]!.id, { to: "submitted" }))).toBe(409);
    expect(await status(b.wk.setObligationStatus(conditionId, { to: "received" }))).toBe(409);
    expect((await b.wk.outsideAwards()).find((a) => a.id === id)!.receivedAmount).toEqual({ amount: "59500.00", currency: "USD" });
  });

  it("reports: questions written in the same editor, reuse from an earlier report, submitted with an as-submitted PDF", async () => {
    const [first, second] = reports as [Obligation, Obligation];
    const q1 = await b.wk.addReportQuestions(first.id, [{ prompt: "What did the grant make possible this period?", limitKind: "words", limitValue: 200 }]);
    expect(q1).toHaveLength(1);
    expect(q1[0]).toMatchObject({ phase: "report", obligationId: first.id, status: "empty", answer: null });
    expect((await b.wk.reportQuestions(first.id)).map((q) => q.id)).toEqual([q1[0]!.id]);
    // Report questions are not the application's questions.
    expect((await b.outside.get(id)).questions.map((q) => q.id)).not.toContain(q1[0]!.id);
    const body = "We opened two clinic days a week and reached 312 families.";
    const a1 = await b.outside.putAnswer(q1[0]!.id, { body });
    expect(a1).toMatchObject({ version: 1, provenance: "user", body });

    const sub = await b.wk.submitObligation(first.id, { submittedAt: TODAY, confirmationRef: "NW-R1" });
    expect(sub).toMatchObject({ status: "submitted", submittedAt: TODAY, confirmationRef: "NW-R1" });
    expect(sub.documentId).toMatch(ID);
    expect(sub.snapshotSha256).toMatch(SHA);
    const pdf = new Uint8Array(await (await b.outside.documentFile(id, sub.documentId!)).blob.arrayBuffer());
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect(await sha256(pdf)).toBe(sub.snapshotSha256);
    expect(await status(b.wk.submitObligation(first.id, { submittedAt: TODAY }))).toBe(409);
    expect(await status(b.wk.submitObligation(second.id, { submittedAt: "2027-05-01" }))).toBe(422);
    expect(await status(b.wk.addReportQuestions(first.id, [{ prompt: "Anything else?" }]))).toBe(409);
    // A submitted report is kept.
    expect(await status(b.wk.deleteObligation(first.id))).toBe(409);

    // The next report reuses the earlier answer, marked as a prior submission.
    const q2 = await b.wk.addReportQuestions(second.id, [{ prompt: "What did the grant make possible this period?" }]);
    const prior = await b.wk.priorReportAnswers(second.id, { questionId: q2[0]!.id });
    const earlier = prior.find((p) => p.questionId === q1[0]!.id)!;
    expect(earlier).toMatchObject({ body, prompt: "What did the grant make possible this period?", applicationTitle: "Rural clinics 2027", funderName: "Northwind Family Foundation", submittedAt: TODAY });
    expect(earlier.obligationTitle).toContain("Progress report");
    expect(earlier.answerId).toBeTruthy();
    expect((await b.wk.priorReportAnswers(second.id, { questionId: q2[0]!.id, q: "312 families" })).map((p) => p.answerId)).toContain(earlier.answerId);
    expect((await b.wk.priorReportAnswers(second.id, { questionId: q2[0]!.id, q: "no such words anywhere" })).map((p) => p.answerId)).not.toContain(earlier.answerId);
    const reused = await b.outside.putAnswer(q2[0]!.id, { body: earlier.body, provenance: "prior_submission", sourceAnswerId: earlier.answerId });
    expect(reused).toMatchObject({ provenance: "prior_submission", body });

    // The funder accepted the first report.
    const accepted = await b.wk.setObligationStatus(first.id, { to: "done", completedOn: TODAY });
    expect(accepted).toMatchObject({ status: "done" });
  });

  it("closeout: refused while anything is open, then offered and recorded; the award is then read-only", async () => {
    expect(await status(b.wk.closeOut(id))).toBe(409);
    for (const o of await b.wk.obligations(id)) if (!["done", "received"].includes(o.status)) await b.wk.deleteObligation(o.id);
    const closed = await b.wk.closeOut(id);
    expect(closed.stage).toBe("awarded");
    expect(closed.closedOutAt).toBeTruthy();
    expect((await b.outside.get(id)).closedOutAt).toBe(closed.closedOutAt);
    expect((await b.wk.outsideAwards()).find((a) => a.id === id)!.closedOutAt).toBe(closed.closedOutAt);
    expect(await status(b.wk.createObligation(id, { kind: "condition", title: "Late one" }))).toBe(409);
    expect(await status(b.wk.closeOut(id))).toBe(409);
  });

  it("next cycle: declined with a date, and an alert on the program when it reopens (once)", async () => {
    const app = await b.outside.create({ source: "manual", title: "Summer camp 2027", funderName: "Larkspur Fund", programName: "Youth Futures", stage: "drafting" });
    await b.outside.submit(app.id, { submittedAt: "2027-04-12", method: "email" });
    const declined = await b.outside.decide(app.id, { outcome: "declined", nextCycleOn: "2028-01-15", notes: "Apply again in January" });
    expect(declined.stage).toBe("declined");
    const alert = await b.wk.nextCycleAlert(app.id);
    expect(alert.query).toContain("Youth Futures");
    expect(alert.id).toBeTruthy();
    expect((await b.wk.nextCycleAlert(app.id)).id).toBe(alert.id);
    expect((await b.full.alerts()).map((a) => a.id)).toContain(alert.id);
  });

  it("funding summary: by fiscal year, win rate, asked vs awarded; CSV and a one-page PDF", async () => {
    const s = await b.wk.fundingSummary();
    expect(s.fiscalYearStartMonth).toBe(1);
    const fy = (x: typeof s) => x.years.find((y) => y.fiscalYear === 2027) ?? { submitted: 0, decided: 0, awarded: 0, declined: 0, asked: { amount: "0.00" }, awardedAmount: { amount: "0.00" } };
    const now = fy(s);
    const then = fy(summaryBefore);
    expect(s.years.find((y) => y.fiscalYear === 2027)!.label).toBe("FY 2027");
    // This scenario: two submitted, both decided, one awarded ($60,000 of $60,000 asked) and one declined.
    expect([now.submitted - then.submitted, now.decided - then.decided, now.awarded - then.awarded, now.declined - then.declined]).toEqual([2, 2, 1, 1]);
    expect(Number(now.asked.amount) - Number(then.asked.amount)).toBe(60000);
    expect(Number(now.awardedAmount.amount) - Number(then.awardedAmount.amount)).toBe(60000);
    // Awarded over decided, to three decimals.
    for (const y of s.years) expect(y.winRate).toBe(y.decided ? Math.round((y.awarded / y.decided) * 1000) / 1000 : null);
    expect(s.years.map((y) => y.fiscalYear)).toEqual([...s.years.map((y) => y.fiscalYear)].sort((x, y) => y - x));

    // A fiscal year starting in July: the label says which months.
    await b.wk.saveSettings({ fiscalYearStartMonth: 7 });
    const july = await b.wk.fundingSummary();
    expect(july.fiscalYearStartMonth).toBe(7);
    expect(july.years.find((y) => y.fiscalYear === 2027)!.label).toBe("FY 2027 (Jul 2026 to Jun 2027)");
    await b.wk.saveSettings({ fiscalYearStartMonth: 1 });

    const csv = await (await b.wk.exportSummary("csv")).blob.text();
    const [head, ...rows] = csv.trim().split(/\r?\n/);
    expect(head).toBe("fiscal_year,label,start,end,submitted,decided,awarded,declined,win_rate,asked,awarded_amount,outside_submitted,outside_awarded,gms_submitted,gms_awarded");
    expect(rows.length).toBe(s.years.length);
    expect(rows.some((r) => r.startsWith("2027,FY 2027,2027-01-01,2027-12-31,"))).toBe(true);
    const pdf = await b.wk.exportSummary("pdf");
    expect(new TextDecoder().decode(new Uint8Array(await pdf.blob.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    expect(pdf.filename).toMatch(/\.pdf$/);
  });

  it("vault: deleting a document puts the checklist entry it met back to needed", async () => {
    // The application is closed out; a second one carries the checklist.
    const app = await b.outside.create({ source: "manual", title: "Clinic expansion 2028", funderName: "Northwind Family Foundation", stage: "drafting" });
    await b.wk.setRequiredDocuments(app.id, [{ label: "Board list", documentId: null, status: "needed" }]);
    await b.wk.useFromVault(app.id, "Board list", vaultId);
    await b.wk.deleteVault(vaultId);
    expect((await b.wk.vault()).map((d) => d.id)).not.toContain(vaultId);
    expect((await b.outside.get(app.id)).requiredDocuments).toEqual([{ label: "Board list", documentId: null, status: "needed" }]);
    expect(await status(b.wk.vaultFile(vaultId))).toBe(404);
  });

  it("nothing in this scenario sent mail outside the workspace, and the model never saw the vault", () => {
    for (const m of b.mail()) for (const to of m.to) expect(to).not.toMatch(/opengrants\.io$/);
    const sent = JSON.stringify(b.modelRequests());
    expect(sent).not.toContain("seven members");
    expect(sent).not.toContain(b64("Board of directors, 2027: seven members."));
  });

  it("the real client called every write-and-keep endpoint the screens use, under /gms", () => {
    if (!b.real) return;
    const seen = new Set(b.calls.map((c) => c.replace(new RegExp(HEX, "g"), ":id").replace(/\b[a-z]{3}_:id/g, ":id")));
    for (const c of [
      "GET /gms/assist/status",
      "POST /gms/outside-questions/:id/draft",
      "POST /gms/outside-applications/:id/questions/parse",
      "POST /gms/outside-applications/:id/guidelines",
      "PUT /gms/outside-questions/:id/answer",
      "GET /gms/my/answers",
      "POST /gms/my/answers/:id/verify",
      "PATCH /gms/my/answers/:id",
      "GET /gms/vault",
      "POST /gms/vault",
      "PATCH /gms/vault/:id",
      "DELETE /gms/vault/:id",
      "GET /gms/vault/:id/file",
      "PUT /gms/outside-applications/:id/required-documents",
      "POST /gms/outside-applications/:id/required-documents/use-from-vault",
      "POST /gms/outside-applications/:id/milestones",
      "GET /gms/workspaces/:id",
      "PATCH /gms/workspaces/:id",
      "POST /gms/outside-applications/:id/go-no-go",
      "GET /gms/outside-applications/:id/comments",
      "POST /gms/outside-questions/:id/comments",
      "PATCH /gms/outside-questions/:id",
      "POST /gms/outside-applications/:id/documents",
      "GET /gms/my/awarded-funding",
      "GET /gms/outside-awards/:id",
      "GET /gms/outside-applications/:id/obligations",
      "POST /gms/outside-applications/:id/obligations",
      "PATCH /gms/outside-obligations/:id",
      "POST /gms/outside-obligations/:id/status",
      "DELETE /gms/outside-obligations/:id",
      "PATCH /gms/outside-obligation-series/:id",
      "POST /gms/outside-obligations/:id/submit",
      "GET /gms/outside-obligations/:id/questions",
      "POST /gms/outside-obligations/:id/questions",
      "GET /gms/outside-obligations/:id/reuse",
      "GET /gms/outside-applications/:id/documents/:id/file",
      "POST /gms/outside-applications/:id/close-out",
      "POST /gms/outside-applications/:id/next-cycle-alert",
      "GET /gms/funding-summary",
      "GET /gms/funding-summary/export",
    ])
      expect(seen, c).toContain(c);
  });
});
