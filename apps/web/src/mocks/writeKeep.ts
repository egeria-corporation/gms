// SPDX-License-Identifier: AGPL-3.0-only
// In-browser implementation of the write-and-keep port. It shares the outside-applications store
// (applications, questions and answer versions, files), the applicant store (the answer library,
// members, built-in applications and awards) and the assistant's status and quota, and follows the
// contract closely enough for the screens to behave the same in mock mode: drafts use only the
// library and the organization's facts and save nothing, guideline reading needs the assistant and
// counts against its quota, the vault refuses bank-like file names, go/no-go moves the stage by the
// machine, series stop at 60 and re-plan only future untouched instances, closeout needs every
// obligation done or received.
import type { Answer, AppDocument } from "../api/applicant.ts";
import { ApiError } from "../api/client.ts";
import { minorOf, type Money, type OutsideApplication } from "../api/outside.ts";
import type {
  AnswerDraft,
  ObligationPatch,
  FundingSummary,
  FundingYear,
  GrantSettings,
  GuidelinesRead,
  LibraryAnswer,
  Obligation,
  ObligationInput,
  OutsideAward,
  PriorReportAnswer,
  QuestionComment,
  StaleFlag,
  VaultDocument,
  WriteKeepApi,
} from "../api/writeKeep.ts";
import type { Session } from "../auth/types.ts";
import { countFor, countText, isOverLimit, parseQuestions, TRANSITIONS, type LimitKind } from "../lib/outside.ts";
import { addMonths, blockedFilename, DEFAULT_WEIGHTS, DOC_TYPES, fiscalYearLabel, fiscalYearOf, fiscalYearRange, GO_CRITERIA, isStale, movesFrom, SERIES_MAX, seriesDates, VAULT_MAX_BYTES, VAULT_WARNING, WEIGHT_MAX, type RequiredDocument, type VariantTexts } from "../lib/writeKeep.ts";
import { APPLICANT_IDS, type ApplicantStore } from "./applicant.ts";
import type { FullStore } from "./applicantFull.ts";
import { createMockOutsideApi, day, OUTSIDE_IDS, textPdf, type MockQuestion, type MockRecord, type OutsideStore } from "./outside.ts";

const clone = <T>(v: T): T => structuredClone(v);
const notFound = (what: string) => new ApiError(404, `${what} not found`);
const invalid = (field: string, message: string) => new ApiError(422, message, [{ field, message }]);
/** The Worker answers 400 when the request itself is malformed (its input check), 422 when it is well formed but refused. */
const badRequest = (field: string, message: string) => new ApiError(400, message, [{ field, message }]);
/** As the Worker: pasted guidelines and uploaded files the assistant may read, at most. */
export const GUIDELINES_LIMITS = { chars: 60_000, bytes: 10 * 1_048_576, pages: 50 };

interface MockObligation extends Omit<Obligation, "allowedStatuses"> {
  /** Changed by hand (or acted on), so a series edit leaves it alone. */
  touched: boolean;
}
interface MockSeries {
  id: string;
  applicationId: string;
  everyMonths: number;
  startOn: string;
  endOn: string;
}
export interface WriteKeepStore {
  vault: VaultDocument[];
  settings: GrantSettings;
  obligations: MockObligation[];
  series: MockSeries[];
  comments: (QuestionComment & { applicationId: string })[];
  /** Library fields this release adds, by answer key (a new version keeps them). */
  library: Record<string, { lastVerifiedAt: string | null; variants: VariantTexts; tags: string[] }>;
}

export const WK_IDS = {
  vaultIrs: "vdc_d6000000-0000-7000-8000-000000000001",
  vaultAudit: "vdc_d6000000-0000-7000-8000-000000000002",
  vaultBoard: "vdc_d6000000-0000-7000-8000-000000000003",
  oblReport1: "obl_d5000000-0000-7000-8000-000000000001",
  oblReport2: "obl_d5000000-0000-7000-8000-000000000002",
  oblPaid1: "obl_d5000000-0000-7000-8000-000000000003",
  oblExpected2: "obl_d5000000-0000-7000-8000-000000000004",
  oblCondition: "obl_d5000000-0000-7000-8000-000000000005",
  oblReport3: "obl_d5000000-0000-7000-8000-000000000006",
  seriesReports: "srs_d7000000-0000-7000-8000-000000000001",
} as const;

export function seedWriteKeepStore(): WriteKeepStore {
  const at = `${day(-220)}T16:00:00Z`;
  const obligation = (o: Partial<MockObligation> & Pick<MockObligation, "id" | "kind" | "title" | "status">): MockObligation => ({
    outsideApplicationId: OUTSIDE_IDS.cedar,
    dueOn: null,
    amount: null,
    seriesId: null,
    notes: null,
    submittedAt: null,
    confirmationRef: null,
    documentId: null,
    snapshotSha256: null,
    completedOn: null,
    createdAt: at,
    updatedAt: at,
    touched: false,
    ...o,
  });
  return {
    vault: [
      { id: WK_IDS.vaultIrs, name: "IRS determination letter.pdf", mime: "application/pdf", size: 184_320, sha256: "3f9a51c0d2e4b6a8c1d3e5f7a9b0c2d4e6f8a0b1c3d5e7f9a1b2c3d4e5f6c21e", docType: "irs_letter", expiresOn: null, uploadedAt: "2026-02-04T18:00:00Z" },
      { id: WK_IDS.vaultAudit, name: "FY2026 audited financial statements.pdf", mime: "application/pdf", size: 912_384, sha256: "8b10e2c4a6d8f0b1c3e5a7d9f1b2c4e6a8d0f2b3c5e7a9d1f3b4c6e8a0d277d4", docType: "audit", expiresOn: day(21), uploadedAt: "2026-01-11T18:00:00Z" },
      { id: WK_IDS.vaultBoard, name: "Board of directors 2026.pdf", mime: "application/pdf", size: 61_440, sha256: "c41e7a9b0d2f4a6c8e0b1d3f5a7c9e1b2d4f6a8c0e1b3d5f7a9c0e2b4d69ab2", docType: "board_list", expiresOn: day(-9), uploadedAt: "2025-11-20T18:00:00Z" },
    ],
    settings: { goNoGoEnabled: false, goNoGoWeights: { ...DEFAULT_WEIGHTS }, fiscalYearStartMonth: 1 },
    obligations: [
      obligation({ id: WK_IDS.oblReport1, kind: "report", title: "Progress report (1 of 3)", dueOn: day(-38), status: "submitted", seriesId: WK_IDS.seriesReports, submittedAt: day(-40), confirmationRef: "CVCF-R1", touched: true }),
      obligation({ id: WK_IDS.oblReport2, kind: "report", title: "Progress report (2 of 3)", dueOn: addMonths(day(-38), 6), status: "upcoming", seriesId: WK_IDS.seriesReports }),
      obligation({ id: WK_IDS.oblReport3, kind: "report", title: "Progress report (3 of 3)", dueOn: addMonths(day(-38), 12), status: "upcoming", seriesId: WK_IDS.seriesReports }),
      obligation({ id: WK_IDS.oblPaid1, kind: "payment_received", title: "First payment", dueOn: day(-210), amount: { amount: "30000.00", currency: "USD" }, status: "received", touched: true }),
      obligation({ id: WK_IDS.oblExpected2, kind: "payment_expected", title: "Second payment", dueOn: day(220), amount: { amount: "30000.00", currency: "USD" }, status: "upcoming" }),
      obligation({ id: WK_IDS.oblCondition, kind: "condition", title: "Thank the funder in the annual report", dueOn: day(90), status: "upcoming" }),
    ],
    // Every six months from the first report, three in all (numbered as the API numbers them).
    series: [{ id: WK_IDS.seriesReports, applicationId: OUTSIDE_IDS.cedar, everyMonths: 6, startOn: day(-38), endOn: addMonths(day(-38), 12) }],
    comments: [],
    library: {
      need: { lastVerifiedAt: "2025-08-12T00:00:00Z", variants: { short: "Families in the Alder Creek valley travel more than forty minutes to reach a clinic, and many miss care because of the distance." }, tags: ["health", "rural"] },
      mission: { lastVerifiedAt: null, variants: {}, tags: ["organization"] },
      evaluation: { lastVerifiedAt: `${day(-40)}T00:00:00Z`, variants: {}, tags: ["evaluation"] },
    },
  };
}

// ------------------------------------------------------------------------------------ helpers

const STOP = new Set("about after also and are been being both but can could does each for from have how into its more most our over own per such than that the their them then there these they this those through very was were what when where which while who why will with would your you".split(" "));
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !STOP.has(w)) ?? []);
/** Plain relevance: shared words between the question and an answer's title and text. */
export function relevance(prompt: string, answer: { title: string; body: string }): number {
  const q = words(prompt);
  let n = 0;
  for (const w of words(`${answer.title} ${answer.title} ${answer.body}`)) if (q.has(w)) n++;
  return n;
}
const FIGURE = /\b\d[\d,.]*%?(?:\s+[a-z]+)?/gi;
const sentences = (s: string) => s.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g)?.map((x) => x.trim()).filter(Boolean) ?? [];

function fit(text: string, kind: LimitKind | null, value: number | null): string {
  if (!kind || !value) return text;
  const parts = sentences(text);
  while (parts.length > 1 && countFor(countText(parts.join(" ")), kind) > value) parts.pop();
  let out = parts.join(" ");
  // One sentence still too long: cut it to the limit, by words.
  while (out && countFor(countText(out), kind) > value) out = out.split(/\s+/).slice(0, -1).join(" ");
  return out;
}

const REQUIRED_DOCS: Array<[RegExp, string]> = [
  [/determination letter|501\s*\(c\)\s*\(3\)|tax[- ]exempt status/i, "IRS determination letter"],
  [/audit/i, "Most recent audit"],
  [/financial statement/i, "Financial statements"],
  [/board (list|roster|of directors)|list of (board|directors|trustees)/i, "Board list"],
  [/project budget|organi[sz]ational budget|\bbudget\b/i, "Project budget"],
  [/annual report/i, "Annual report"],
  [/letters? of support/i, "Letters of support"],
];
/** The mock's stand-in for the model: the deterministic splitter, plus the documents the text asks for. */
function readText(text: string): Omit<GuidelinesRead, "document"> {
  const requiredDocuments = REQUIRED_DOCS.filter(([re]) => re.test(text)).map(([, label]) => label);
  // Lines that only list attachments are documents, not questions.
  // and a title or an instruction line is not a question: keep what asks something or sets a limit.
  const asks = (p: string) => /[?]/.test(p) || /^(describe|explain|list|tell|share|provide|outline|summari[sz]e|discuss|identify|what|how|why|who|when|where|which)\b/i.test(p);
  const questions = parseQuestions(text).filter((q) => (asks(q.prompt) || !!q.limitKind) && !REQUIRED_DOCS.some(([re]) => re.test(q.prompt) && !/[?]/.test(q.prompt) && !q.limitKind && q.prompt.length < 90));
  return { questions, requiredDocuments };
}
/** Text drawn in a simple PDF (strings shown with Tj), enough for the mock's own and plain PDFs. */
function pdfStrings(bytes: Uint8Array): string {
  const raw = new TextDecoder("latin1").decode(bytes);
  const lines = [...raw.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map((m) => m[1]!.replace(/\\([\\()])/g, "$1"));
  return lines.join("\n");
}
const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// ------------------------------------------------------------------------------------ the port

export interface MockWriteKeepOptions {
  session: () => Promise<Session | null>;
  applicant: ApplicantStore;
  outside: OutsideStore;
  full: FullStore;
  store?: WriteKeepStore;
  now?: () => Date;
  actor?: { userId: string; name: string };
}

export function createMockWriteKeepApi(opts: MockWriteKeepOptions): WriteKeepApi & { store: WriteKeepStore } {
  const wk = opts.store ?? seedWriteKeepStore();
  const A = opts.applicant;
  const O = opts.outside;
  const nowDate = () => (opts.now ?? (() => new Date()))();
  const now = () => nowDate().toISOString();
  const today = () => now().slice(0, 10);
  const actor = opts.actor ?? { userId: APPLICANT_IDS.maria, name: "Maria Santos" };
  const uuid = () => crypto.randomUUID();
  // Report questions are written through the outside-applications port, on the same store.
  const outsideApi = createMockOutsideApi({ session: opts.session, applicant: A, store: O, ...(opts.now ? { now: opts.now } : {}), actor });

  async function signedIn() {
    if (!(await opts.session())) throw new ApiError(401, "Sign in to continue");
  }
  const appOf = (id: string): MockRecord => {
    const a = O.applications.find((x) => x.id === id);
    if (!a) throw notFound("Application");
    return a;
  };
  const writable = (a: MockRecord) => {
    if (a.archivedAt) throw new ApiError(409, "This application is archived. Unarchive it to make changes");
  };
  const log = (a: MockRecord, type: string, data: Record<string, unknown> = {}) => {
    a.updatedAt = now();
    a.activity.push({ id: uuid(), type: `outside_application.${type}`, at: a.updatedAt, actor: `user:${actor.userId}`, data });
  };
  const viewApp = (a: MockRecord): OutsideApplication => {
    const { questions: _q, documents: _d, activity: _e, ...rest } = a;
    return clone(rest);
  };
  const latest = (q: MockQuestion) => q.versions[q.versions.length - 1] ?? null;
  const questionOf = (qid: string): { app: MockRecord; q: MockQuestion } => {
    for (const app of O.applications) {
      const q = app.questions.find((x) => x.id === qid);
      if (q) return { app, q };
    }
    throw notFound("Question");
  };
  const meta = (a: Answer) => wk.library[a.key] ?? { lastVerifiedAt: null, variants: {}, tags: [] };
  const libraryView = (a: Answer): LibraryAnswer => clone({ ...a, ...meta(a) });

  /** The assistant must be on, and each call spends one of the month's drafts. */
  function spendAssist() {
    if (!opts.full.assist.enabled) throw new ApiError(404, "The assistant is not switched on for this workspace");
    const q = opts.full.assist.quota;
    // As the Worker words it.
    if (q && q.limit !== undefined && (q.used ?? 0) >= q.limit) throw new ApiError(429, `This workspace has used the assistant ${q.limit} times this month, its monthly limit.${q.resetsAt ? ` The count resets on ${q.resetsAt.slice(0, 10)}` : ""}`);
    if (q) opts.full.assist.quota = { ...q, used: (q.used ?? 0) + 1, ...(q.limit !== undefined ? { remaining: Math.max(0, q.limit - (q.used ?? 0) - 1) } : {}) };
  }

  const storeFile = async (name: string, mime: string, bytes: Uint8Array) => {
    const digest = globalThis.crypto?.subtle ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer))].map((b) => b.toString(16).padStart(2, "0")).join("") : "0".repeat(64);
    const doc: AppDocument = { id: `doc_${uuid()}`, name, mime, size: bytes.length, sha256: digest, source: "upload", passportDocumentId: null, scanStatus: "clean", uploadedAt: now() };
    O.files[doc.id] = { name, mime, bytes };
    return doc;
  };

  // An obligation as stored, with the moves its kind allows from there. As on the Worker, a status
  // changes only by a move (the daily job makes an upcoming one due on its date; the mock has no job).
  const view = (o: MockObligation): Obligation => {
    const { touched: _t, ...rest } = o;
    return clone({ ...rest, allowedStatuses: movesFrom(o.kind, o.status) });
  };
  const obligationOf = (id: string) => {
    const o = wk.obligations.find((x) => x.id === id);
    if (!o) throw notFound("Obligation");
    return o;
  };
  const isPayment = (k: Obligation["kind"]) => k === "payment_expected" || k === "payment_received";
  const settled = (o: Pick<Obligation, "status">) => o.status === "done" || o.status === "received";
  const sum = (ms: (Money | null)[]) => ms.reduce((n, m) => n + (minorOf(m) ?? 0), 0);
  const money = (minor: number, currency = "USD"): Money => ({ amount: (minor / 100).toFixed(2), currency });

  function checkInput(input: ObligationInput) {
    if (!["report", "payment_expected", "payment_received", "condition"].includes(input.kind)) throw invalid("kind", "Choose what kind of obligation this is");
    if (!input.title?.trim()) throw invalid("title", "Give it a title");
    if (isPayment(input.kind) && (minorOf(input.amount) ?? -1) < 0) throw invalid("amount", "Enter the amount in dollars");
    if (input.kind === "payment_received" && !input.dueOn) throw invalid("dueOn", "Enter the date it arrived");
    if (input.kind === "payment_received" && input.dueOn! > today()) throw invalid("dueOn", "A payment received cannot be dated in the future");
    if (input.series) checkSeries(input.series);
  }
  function checkSeries(sr: { everyMonths: number; startOn: string; endOn: string }) {
    if (!(sr.everyMonths >= 1 && sr.everyMonths <= 24)) throw invalid("series.everyMonths", "Repeat every 1 to 24 months");
    if (!sr.startOn || !sr.endOn || sr.endOn < sr.startOn) throw invalid("series.endOn", "The series needs a first date and an end after it");
    if (seriesDates(sr.startOn, sr.endOn, sr.everyMonths, SERIES_MAX + 1).length > SERIES_MAX) throw invalid("series", `A series can make at most ${SERIES_MAX} obligations`);
  }
  const make = (applicationId: string, input: ObligationInput, dueOn: string | null, seriesId: string | null): MockObligation => ({
    id: `obl_${uuid()}`,
    outsideApplicationId: applicationId,
    kind: input.kind,
    title: input.title.trim(),
    dueOn,
    amount: isPayment(input.kind) ? (input.amount ?? null) : null,
    status: input.kind === "payment_received" ? "received" : "upcoming",
    seriesId,
    notes: input.notes?.trim() || null,
    submittedAt: null,
    confirmationRef: null,
    documentId: null,
    snapshotSha256: null,
    completedOn: input.kind === "payment_received" ? (input.dueOn ?? null) : null,
    createdAt: now(),
    updatedAt: now(),
    touched: input.kind === "payment_received",
  });

  type SourceCounts = { submitted: number; awarded: number };
  /** The funding summary by fiscal year, and how many of each year's came from outside or this GMS (for the CSV). */
  function summarize(): { summary: FundingSummary; bySource: Map<number, { outside: SourceCounts; gms: SourceCounts }> } {
    const start = wk.settings.fiscalYearStartMonth;
    const years = new Map<number, FundingYear>();
    const bySource = new Map<number, { outside: SourceCounts; gms: SourceCounts }>();
    const year = (iso: string) => {
      const fy = fiscalYearOf(iso, start);
      let y = years.get(fy);
      if (!y) {
        years.set(fy, (y = { fiscalYear: fy, label: fiscalYearLabel(fy, start), submitted: 0, decided: 0, awarded: 0, declined: 0, winRate: null, asked: money(0), awardedAmount: money(0) }));
        bySource.set(fy, { outside: { submitted: 0, awarded: 0 }, gms: { submitted: 0, awarded: 0 } });
      }
      return { y, by: bySource.get(fy)! };
    };
    const add = (m: Money, minor: number | null) => ({ ...m, amount: ((minorOf(m)! + (minor ?? 0)) / 100).toFixed(2) });
    for (const a of O.applications.filter((x) => !x.archivedAt)) {
      if (a.submittedAt) {
        const { y, by } = year(a.submittedAt);
        y.submitted++;
        by.outside.submitted++;
        y.asked = add(y.asked, minorOf(a.askAmount));
      }
      if (a.decidedAt && (a.stage === "awarded" || a.stage === "declined")) {
        const { y, by } = year(a.decidedAt);
        y.decided++;
        if (a.stage === "awarded") {
          y.awarded++;
          by.outside.awarded++;
          y.awardedAmount = add(y.awardedAmount, minorOf(a.awardedAmount));
        } else y.declined++;
      }
    }
    for (const x of A.applications) {
      if (x.submittedAt) {
        const { y, by } = year(x.submittedAt);
        y.submitted++;
        by.gms.submitted++;
      }
      if (x.status === "declined") {
        const { y } = year(x.updatedAt);
        y.decided++;
        y.declined++;
      }
    }
    for (const w of A.awards.filter((x) => x.status !== "cancelled")) {
      const { y, by } = year(w.createdAt);
      y.decided++;
      y.awarded++;
      by.gms.awarded++;
      y.awardedAmount = add(y.awardedAmount, w.awardedAmountMinor ?? 0);
    }
    // As the Worker: the win rate to three decimals, the latest year first.
    const summary: FundingSummary = { fiscalYearStartMonth: start, currency: "USD", years: [...years.values()].map((y) => ({ ...y, winRate: y.decided ? Math.round((y.awarded / y.decided) * 1000) / 1000 : null })).sort((x, y) => y.fiscalYear - x.fiscalYear) };
    return { summary, bySource };
  }

  const api: WriteKeepApi = {
    // ---------------------------------------------------------------- drafting
    async draftAnswer(qid) {
      await signedIn();
      const { app, q } = questionOf(qid);
      writable(app);
      spendAssist();
      const prompt = `${q.prompt} ${q.guidance ?? ""}`;
      // Up to 8 library answers by plain relevance; the best two carry the draft.
      const ranked = A.answers
        .map((a) => ({ a, score: relevance(prompt, a) }))
        .filter((x) => x.score > 0)
        .sort((x, y) => y.score - x.score)
        .slice(0, 8);
      const used = ranked.slice(0, 2).map((x) => x.a);
      const mission = A.organization.organization ? (A.organization.organization as { mission?: string }).mission : null;
      const parts: string[] = [];
      if (/\b(mission|history|organi[sz]ation|who you are)\b/i.test(prompt) && mission) parts.push(mission);
      for (const a of used) parts.push(a.body);
      const unknowns = ["what this grant would pay for"];
      if (/\b(measure|outcome|success|evaluat|result)/i.test(prompt) && !used.some((a) => /evaluat|measure/i.test(a.title))) unknowns.push("the outcome targets for this project");
      const tail = unknowns.map((u, i) => (i === 0 ? `With this grant we would [${u}].` : `We will report on [${u}].`)).join(" ");
      let draft = fit([...parts, tail].join(" "), q.limitKind, q.limitValue);
      // Keep the placeholders inside the limit: they say what is missing.
      if (!draft.includes("[")) draft = fit(`${tail} ${parts.join(" ")}`, q.limitKind, q.limitValue);
      const staleFlags: StaleFlag[] = used.flatMap((a) => {
        const m = meta(a);
        if (!isStale(m.lastVerifiedAt, nowDate())) return [];
        return [...a.body.matchAll(FIGURE)].map((f) => f[0].trim()).filter((f) => draft.includes(f)).map((figure) => ({ answerId: a.id, figure, lastVerifiedAt: m.lastVerifiedAt }));
      });
      const counts = countText(draft);
      const out: AnswerDraft = { draft, usedAnswerIds: used.map((a) => a.id), unknowns: unknowns.filter((u) => draft.includes(`[${u}]`)), staleFlags, counts, overLimit: isOverLimit(counts, q.limitKind, q.limitValue) };
      return clone(out);
    },
    async readGuidelines(id, text) {
      await signedIn();
      writable(appOf(id));
      if (!text.trim()) throw invalid("text", "Paste the guidelines first");
      if (text.length > GUIDELINES_LIMITS.chars) throw invalid("text", "Paste at most 60,000 characters at a time");
      spendAssist();
      return clone({ ...readText(text), document: null });
    },
    async uploadGuidelines(id, f) {
      await signedIn();
      const a = appOf(id);
      writable(a);
      const bytes = fromBase64(f.contentBase64);
      const pdf = f.mime === "application/pdf" || /\.pdf$/i.test(f.name);
      if (!pdf && !(f.mime.startsWith("text/") || /\.txt$/i.test(f.name))) throw invalid("file", "Upload a PDF or a plain text file");
      if (blockedFilename(f.name)) throw invalid("name", VAULT_WARNING);
      if (bytes.length > GUIDELINES_LIMITS.bytes) throw invalid("file", "Upload a file of 10 MB or less");
      if (pdf && (new TextDecoder("latin1").decode(bytes).match(/\/Type\s*\/Page\b/g)?.length ?? 0) > GUIDELINES_LIMITS.pages) throw invalid("file", "Upload guidelines of 50 pages or fewer");
      spendAssist();
      const doc = await storeFile(f.name, f.mime || (pdf ? "application/pdf" : "text/plain"), bytes);
      // Kept on the application as the funder's guidelines; only files sent here are ever read by AI.
      const kept = { ...doc, docType: "funder_guidelines" } as AppDocument;
      a.documents.push(kept);
      log(a, "guidelines_uploaded", { documentId: doc.id });
      const text = pdf ? pdfStrings(bytes) : new TextDecoder().decode(bytes);
      return clone({ ...readText(text), document: kept });
    },

    // ---------------------------------------------------------------- library
    async library() {
      await signedIn();
      return A.answers.map(libraryView);
    },
    async verifyAnswer(id) {
      await signedIn();
      const a = A.answers.find((x) => x.id === id);
      if (!a) throw notFound("Answer");
      wk.library[a.key] = { ...meta(a), lastVerifiedAt: now() };
      return libraryView(a);
    },
    async updateAnswerMeta(id, patch) {
      await signedIn();
      const a = A.answers.find((x) => x.id === id);
      if (!a) throw notFound("Answer");
      if (patch.tags && (patch.tags.length > 20 || patch.tags.some((t) => t.trim().length > 50))) throw invalid("tags", "Keep to 20 tags of 50 characters or fewer");
      // As the API: a variant set to null or "" is removed; the first spelling of a tag is kept.
      const variants = { ...meta(a).variants };
      for (const [k, v] of Object.entries(patch.variants ?? {}) as [keyof VariantTexts, string | null | undefined][]) {
        if (v === undefined) continue;
        if (v?.trim()) variants[k] = v;
        else delete variants[k];
      }
      const tags = patch.tags?.map((t) => t.trim()).filter((t, i, all) => t && all.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i);
      wk.library[a.key] = { ...meta(a), variants, ...(tags ? { tags } : {}) };
      return libraryView(a);
    },

    // ---------------------------------------------------------------- vault
    async vault() {
      await signedIn();
      return clone([...wk.vault].sort((x, y) => x.name.localeCompare(y.name)));
    },
    async uploadVault(input) {
      await signedIn();
      if (blockedFilename(input.name)) throw invalid("name", VAULT_WARNING);
      if (!(DOC_TYPES as readonly string[]).includes(input.docType)) throw invalid("docType", "Choose what kind of document this is");
      const bytes = fromBase64(input.contentBase64);
      if (bytes.length > VAULT_MAX_BYTES) throw new ApiError(413, "Upload a file of 25 MB or less");
      const doc = await storeFile(input.name, input.mime, bytes);
      const v: VaultDocument = { id: doc.id, name: doc.name, mime: doc.mime, size: doc.size, sha256: doc.sha256, docType: input.docType, expiresOn: input.expiresOn ?? null, uploadedAt: doc.uploadedAt };
      wk.vault.push(v);
      return clone(v);
    },
    async updateVault(id, patch) {
      await signedIn();
      const v = wk.vault.find((x) => x.id === id);
      if (!v) throw notFound("Document");
      if (patch.name !== undefined && blockedFilename(patch.name)) throw invalid("name", VAULT_WARNING);
      Object.assign(v, patch);
      return clone(v);
    },
    async deleteVault(id) {
      await signedIn();
      const i = wk.vault.findIndex((x) => x.id === id);
      if (i < 0) throw notFound("Document");
      wk.vault.splice(i, 1);
      // A checklist entry it met goes back to needed.
      for (const a of O.applications) for (const d of a.requiredDocuments) if (d.documentId === id) Object.assign(d, { documentId: null, status: "needed" });
    },
    async vaultFile(id) {
      await signedIn();
      const v = wk.vault.find((x) => x.id === id);
      if (!v) throw notFound("Document");
      const f = O.files[id];
      const bytes = f?.bytes ?? textPdf([v.name, "", "A sample document kept in the vault."]);
      return { filename: v.name, blob: new Blob([bytes as BlobPart], { type: f?.mime ?? v.mime }) };
    },

    async setRequiredDocuments(id, list) {
      await signedIn();
      const a = appOf(id);
      writable(a);
      if (list.length > 50) throw invalid("items", "Keep to 50 required documents");
      const seen = new Set<string>();
      for (const d of list) {
        const k = d.label.trim().toLowerCase();
        if (!k) throw invalid("items", "Each required document needs a label");
        if (seen.has(k)) throw invalid("items", "Each required document is listed once");
        seen.add(k);
        if (d.documentId && !wk.vault.some((v) => v.id === d.documentId) && !a.documents.some((x) => x.id === d.documentId)) throw notFound("Document");
      }
      a.requiredDocuments = list.map((d): RequiredDocument => ({ label: d.label.trim(), documentId: d.status === "attached" ? d.documentId : null, status: d.status === "attached" && d.documentId ? "attached" : d.status === "not_needed" ? "not_needed" : "needed" }));
      log(a, "required_documents_changed", { count: a.requiredDocuments.length });
      return clone(a.requiredDocuments);
    },
    async useFromVault(id, label, documentId) {
      await signedIn();
      const a = appOf(id);
      writable(a);
      const d = a.requiredDocuments.find((x) => x.label.toLowerCase() === label.trim().toLowerCase());
      if (!d) throw notFound("Required document");
      if (documentId && !wk.vault.some((v) => v.id === documentId) && !a.documents.some((x) => x.id === documentId)) throw notFound("Vault document");
      Object.assign(d, documentId ? { documentId, status: "attached" } : { documentId: null, status: "needed" });
      log(a, "required_documents_changed", { label: d.label });
      return clone(a.requiredDocuments);
    },
    async createMilestones(id, tasks) {
      await signedIn();
      const a = appOf(id);
      writable(a);
      if (tasks.length < 1 || tasks.length > 10) throw invalid("tasks", "Add 1 to 10 tasks");
      for (const t of tasks) {
        if (!t.title.trim() || !t.dueOn) throw invalid("tasks", "Each task needs a title and a date");
        if (t.assigneeUserId && !A.members.some((m) => m.userId === t.assigneeUserId)) throw invalid("tasks", "Assign tasks to people in this workspace");
        A.tasks.push({ id: uuid(), subjectType: "outside_application", subjectId: id, title: t.title.trim(), assigneeUserId: t.assigneeUserId ?? a.owner?.userId ?? null, dueAt: `${t.dueOn}T17:00:00Z`, doneAt: null, createdAt: now() } as (typeof A.tasks)[number]);
      }
      log(a, "milestones_created", { count: tasks.length });
      return tasks.length;
    },

    // ---------------------------------------------------------------- settings and go/no-go
    async settings() {
      await signedIn();
      return clone(wk.settings);
    },
    async saveSettings(patch) {
      await signedIn();
      const role = A.members.find((m) => m.userId === actor.userId)?.role;
      if (role !== "admin") throw new ApiError(403, "Only a workspace admin can change these settings");
      if (patch.fiscalYearStartMonth !== undefined && !(patch.fiscalYearStartMonth >= 1 && patch.fiscalYearStartMonth <= 12)) throw invalid("fiscalYearStartMonth", "Choose a month");
      if (patch.goNoGoWeights && (GO_CRITERIA.some((c) => !(Number.isInteger(patch.goNoGoWeights![c]) && patch.goNoGoWeights![c] >= 0 && patch.goNoGoWeights![c] <= WEIGHT_MAX)) || GO_CRITERIA.every((c) => patch.goNoGoWeights![c] === 0))) throw invalid("settings.goNoGoWeights", `Each weight is a whole number from 0 to ${WEIGHT_MAX}, and at least one is above zero`);
      wk.settings = { ...wk.settings, ...patch, goNoGoWeights: { ...wk.settings.goNoGoWeights, ...(patch.goNoGoWeights ?? {}) } };
      return clone(wk.settings);
    },
    async decideGoNoGo(id, input) {
      await signedIn();
      const a = appOf(id);
      writable(a);
      if (!wk.settings.goNoGoEnabled) throw new ApiError(409, "Go/no-go is not switched on for this workspace");
      if (a.stage !== "deciding") throw new ApiError(409, "Go/no-go is decided at the Deciding stage");
      if (GO_CRITERIA.some((c) => !(input.scores[c] >= 1 && input.scores[c] <= 5))) throw badRequest("scores", "Score each line from 1 to 5");
      if (input.decision === "go" && input.eligibility === "fail") throw badRequest("decision", "An application that fails eligibility cannot be a go");
      const to = input.decision === "go" ? input.to : "not_pursuing";
      if (!to || !TRANSITIONS[a.stage].includes(to)) throw badRequest("to", "Choose where the application goes next");
      // As the Worker: the weighted mean of the four scores, 1 to 5, to two decimals.
      const w = wk.settings.goNoGoWeights;
      const weight = GO_CRITERIA.reduce((n, c) => n + w[c], 0);
      const total = Math.round((GO_CRITERIA.reduce((n, c) => n + input.scores[c] * w[c], 0) / weight) * 100) / 100;
      a.goNoGo = { eligibility: input.eligibility, scores: { ...input.scores }, weights: { ...w }, total, max: 5, decision: input.decision, decidedBy: actor.userId, decidedAt: now(), reason: input.reason?.trim() || null };
      const from = a.stage;
      a.previousStage = from;
      a.stage = to;
      log(a, "go_no_go_decided", { decision: input.decision, total });
      log(a, "stage_changed", { from, to });
      return viewApp(a);
    },

    // ---------------------------------------------------------------- comments
    async comments(id, qid) {
      await signedIn();
      appOf(id);
      return clone(wk.comments.filter((c) => c.applicationId === id && c.questionId === qid).map(({ applicationId: _a, ...c }) => c));
    },
    async addComment(qid, body) {
      await signedIn();
      const { app } = questionOf(qid);
      if (!body.trim()) throw invalid("body", "Write the comment first");
      if (body.length > 5000) throw invalid("body", "Keep a comment to 5,000 characters");
      const m: QuestionComment = { id: uuid(), questionId: qid, authorUserId: actor.userId, body: body.trim(), createdAt: now() };
      wk.comments.push({ ...m, applicationId: app.id });
      log(app, "question_commented", { questionId: qid });
      return clone(m);
    },

    // ---------------------------------------------------------------- awards and obligations
    async outsideAwards() {
      await signedIn();
      return O.applications
        .filter((a) => a.stage === "awarded" && !a.archivedAt)
        .map((a): OutsideAward => {
          const mine = wk.obligations.filter((o) => o.outsideApplicationId === a.id);
          const received = sum(mine.filter((o) => isPayment(o.kind) && o.status === "received").map((o) => o.amount));
          const next = mine.filter((o) => !settled(o) && o.status !== "submitted" && o.dueOn).sort((x, y) => x.dueOn!.localeCompare(y.dueOn!))[0];
          return clone({ id: a.id, title: a.title, funderName: a.funderName, awardedAmount: a.awardedAmount, receivedAmount: money(received, a.currency), grantStart: a.grantStart, grantEnd: a.grantEnd, closedOutAt: a.closedOutAt, nextDue: next ? { title: next.title, dueOn: next.dueOn! } : null });
        });
    },
    async obligations(id) {
      await signedIn();
      appOf(id);
      return wk.obligations.filter((o) => o.outsideApplicationId === id).sort((x, y) => (x.dueOn ?? "9999").localeCompare(y.dueOn ?? "9999")).map(view);
    },
    async createObligation(id, input) {
      await signedIn();
      const a = appOf(id);
      writable(a);
      if (a.stage !== "awarded") throw new ApiError(409, "Obligations belong to an awarded grant");
      if (a.closedOutAt) throw new ApiError(409, "This award is closed out");
      checkInput(input);
      if (input.series) {
        const sr = { everyMonths: input.series.everyMonths, startOn: input.series.startOn, endOn: input.series.endOn || a.grantEnd || "" };
        checkSeries(sr);
        const sid = `srs_${uuid()}`;
        wk.series.push({ id: sid, applicationId: id, ...sr });
        const dates = seriesDates(sr.startOn, sr.endOn, sr.everyMonths);
        // As the Worker: each instance is titled "X (n of N)".
        const made = dates.map((d, i) => make(id, { ...input, title: `${input.title.trim()} (${i + 1} of ${dates.length})` }, d, sid));
        wk.obligations.push(...made);
        log(a, "obligation_added", { count: made.length, kind: input.kind, seriesId: sid });
        return made.map(view);
      }
      if (input.kind === "report" && !input.dueOn) throw invalid("dueOn", "Give the report its due date");
      const one = make(id, input, input.dueOn ?? null, null);
      wk.obligations.push(one);
      log(a, "obligation_added", { count: 1, kind: input.kind });
      return [view(one)];
    },
    async updateObligation(oid, patch: ObligationPatch) {
      await signedIn();
      const o = obligationOf(oid);
      const a = appOf(o.outsideApplicationId);
      writable(a);
      if (patch.title !== undefined && !patch.title.trim()) throw invalid("title", "Give it a title");
      Object.assign(o, { ...patch, ...(patch.title !== undefined ? { title: patch.title.trim() } : {}), touched: true, updatedAt: now() });
      log(a, "obligation_changed", { obligationId: o.id });
      return view(o);
    },
    async setObligationStatus(oid, input) {
      await signedIn();
      const o = obligationOf(oid);
      const a = appOf(o.outsideApplicationId);
      writable(a);
      if (input.to === "submitted") throw new ApiError(409, "Mark a report submitted with its date instead");
      const from = view(o).status;
      if (!movesFrom(o.kind, from).includes(input.to)) throw new ApiError(409, `This ${o.kind.replace(/_/g, " ")} is ${from}; it cannot become ${input.to}`);
      if (input.amount && input.to !== "received") throw invalid("amount", "An amount goes only with a payment received");
      if (input.to === "received" && !input.amount && !o.amount) throw invalid("amount", "Enter the amount received");
      const completedOn = input.to === "done" || input.to === "received" ? (input.completedOn ?? today()) : null;
      if (completedOn && completedOn > today()) throw invalid("completedOn", "The date cannot be in the future");
      Object.assign(o, { status: input.to, completedOn, ...(input.amount ? { amount: input.amount } : {}), touched: true, updatedAt: now() });
      log(a, "obligation_status_changed", { obligationId: o.id, from, to: input.to });
      return view(o);
    },
    async updateSeries(sid, patch) {
      await signedIn();
      const sr = wk.series.find((x) => x.id === sid);
      if (!sr) throw notFound("Series");
      const a = appOf(sr.applicationId);
      writable(a);
      const next = { ...sr, ...(patch.everyMonths !== undefined ? { everyMonths: patch.everyMonths } : {}), ...(patch.startOn ? { startOn: patch.startOn } : {}), ...(patch.endOn ? { endOn: patch.endOn } : {}) };
      checkSeries(next);
      // Past, edited or acted-on instances stay as they are; only future, untouched ones are replaced.
      const all = wk.obligations.filter((x) => x.seriesId === sid);
      const future = all.filter((x) => !x.touched && x.status === "upcoming" && !!x.dueOn && x.dueOn > today() && !O.applications.some((app) => app.questions.some((q) => q.obligationId === x.id)));
      const kept = all.filter((x) => !future.includes(x));
      const sample = all[0]!;
      const base = (patch.title ?? sample.title).replace(/ \(\d+ of \d+\)$/, "");
      const taken = new Set(kept.map((x) => x.dueOn));
      const planned = seriesDates(next.startOn, next.endOn, next.everyMonths);
      const dates = planned.filter((d) => d > today() && !taken.has(d));
      if (kept.length + dates.length > SERIES_MAX) throw invalid("series", `A series can make at most ${SERIES_MAX} obligations`);
      wk.obligations = wk.obligations.filter((x) => !future.includes(x));
      // As the Worker: each new instance is numbered by its place among the series' dates.
      const titled = (d: string) => (planned.length > 1 ? `${base} (${planned.indexOf(d) + 1} of ${planned.length})` : base);
      const made = dates.map((d) => make(a.id, { kind: sample.kind, title: titled(d), notes: patch.notes !== undefined ? patch.notes : sample.notes, amount: patch.amount !== undefined ? patch.amount : sample.amount }, d, sid));
      wk.obligations.push(...made);
      Object.assign(sr, next);
      log(a, "obligation_series_changed", { seriesId: sid, replaced: future.length, added: made.length, kept: kept.length });
      return { replaced: future.length, added: made.length, kept: kept.length };
    },
    async deleteObligation(oid) {
      await signedIn();
      const o = obligationOf(oid);
      const a = appOf(o.outsideApplicationId);
      writable(a);
      if (o.kind === "report" && (o.status === "submitted" || o.status === "done")) throw new ApiError(409, "A submitted report is kept for your records");
      wk.obligations.splice(wk.obligations.indexOf(o), 1);
      a.questions = a.questions.filter((q) => q.obligationId !== oid);
      log(a, "obligation_removed", { obligationId: oid });
    },
    async submitObligation(oid, input) {
      await signedIn();
      const o = obligationOf(oid);
      const a = appOf(o.outsideApplicationId);
      writable(a);
      if (o.kind !== "report") throw new ApiError(409, "Only a report is submitted");
      if (!movesFrom(o.kind, view(o).status).length && o.status === "submitted") throw new ApiError(409, "This report is already recorded as submitted");
      if (o.status === "submitted") throw new ApiError(409, "This report is already recorded as submitted");
      if (!input.submittedAt) throw invalid("submittedAt", "Enter the date you submitted");
      if (input.submittedAt.slice(0, 10) > today()) throw invalid("submittedAt", "The submission date cannot be in the future");
      const qs = a.questions.filter((q) => q.obligationId === oid).sort((x, y) => x.position - y.position);
      const lines = [`${o.title} - as submitted`, `${a.title} · ${a.funderName}`, `Submitted ${input.submittedAt}${input.confirmationRef ? `, confirmation ${input.confirmationRef}` : ""}`, "", ...qs.flatMap((q, i) => [`${i + 1}. ${q.prompt}`, latest(q)?.body || "(no answer)", ""])];
      const doc = await storeFile(`${o.title} ${o.dueOn ?? ""} - as submitted.pdf`.replace(/\s+/g, " "), "application/pdf", textPdf(lines));
      a.documents.push(doc);
      Object.assign(o, { status: "submitted", submittedAt: input.submittedAt.slice(0, 10), confirmationRef: input.confirmationRef?.trim() || null, documentId: doc.id, snapshotSha256: doc.sha256, touched: true, updatedAt: now() });
      log(a, "obligation_submitted", { obligationId: oid, submittedAt: input.submittedAt });
      return view(o);
    },
    async reportQuestions(oid) {
      await signedIn();
      const o = obligationOf(oid);
      if (o.kind !== "report") throw new ApiError(409, "Only a report has questions");
      return appOf(o.outsideApplicationId)
        .questions.filter((q) => q.obligationId === oid)
        .sort((x, y) => x.position - y.position)
        .map((q) => {
          const { versions: _v, ...rest } = q;
          return clone({ ...rest, answer: latest(q) });
        });
    },
    async addReportQuestions(oid, questions) {
      await signedIn();
      const o = obligationOf(oid);
      if (o.kind !== "report") throw new ApiError(409, "Only a report has questions");
      if (o.status === "submitted" || o.status === "done") throw new ApiError(409, "This report is already submitted");
      return outsideApi.addQuestions(o.outsideApplicationId, questions.map((q) => ({ ...q, phase: "report", obligationId: oid })));
    },
    async priorReportAnswers(oid, f = {}) {
      await signedIn();
      obligationOf(oid);
      const needle = f.q?.trim().toLowerCase();
      const out: PriorReportAnswer[] = [];
      for (const a of O.applications)
        for (const x of a.questions) {
          // Answers to other reports' questions; the report being written is left out.
          if (!x.obligationId || x.obligationId === oid) continue;
          const o = wk.obligations.find((k) => k.id === x.obligationId);
          const v = latest(x);
          if (!o || !v?.body.trim()) continue;
          if (needle && !`${x.prompt} ${v.body}`.toLowerCase().includes(needle)) continue;
          out.push({ answerId: v.id, questionId: x.id, prompt: x.prompt, body: v.body, applicationTitle: a.title, funderName: a.funderName, obligationTitle: o.title, submittedAt: o.submittedAt });
        }
      return clone(out.sort((x, y) => (y.submittedAt ?? "").localeCompare(x.submittedAt ?? "")));
    },
    async closeOut(id) {
      await signedIn();
      const a = appOf(id);
      writable(a);
      if (a.stage !== "awarded") throw new ApiError(409, "Only an awarded grant can be closed out");
      if (a.closedOutAt) throw new ApiError(409, "This award is already closed out");
      const open = wk.obligations.filter((o) => o.outsideApplicationId === id && !settled(o));
      if (open.length) throw new ApiError(409, `${open.length} obligation${open.length === 1 ? " is" : "s are"} not done or received yet`);
      a.closedOutAt = now();
      log(a, "closed_out");
      return viewApp(a);
    },

    async nextCycleAlert(id) {
      await signedIn();
      const a = appOf(id);
      if (a.stage !== "declined") throw invalid("stage", "An alert for the next cycle is set on a declined application");
      const q = (a.programName ?? a.title).trim();
      const existing = opts.full.alerts.find((x) => x.query.toLowerCase() === q.toLowerCase());
      if (existing) return clone(existing);
      const alert = { id: uuid(), query: q, createdAt: now() };
      opts.full.alerts.unshift(alert);
      log(a, "next_cycle_alert_set", { alertId: alert.id });
      return clone(alert);
    },

    // ---------------------------------------------------------------- funding summary
    async fundingSummary() {
      await signedIn();
      return clone(summarize().summary);
    },
    async exportSummary(format) {
      await signedIn();
      const { summary: s, bySource } = summarize();
      const pct = (r: number | null) => (r === null ? "" : `${Math.round(r * 100)}%`);
      // As the Worker prints amounts: "USD 60,000.00", or "None".
      const printed = (m: Money) => (minorOf(m) ? `${m.currency} ${Number(m.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "None");
      if (format === "csv") {
        // The Worker's columns, one row per fiscal year.
        const head = "fiscal_year,label,start,end,submitted,decided,awarded,declined,win_rate,asked,awarded_amount,outside_submitted,outside_awarded,gms_submitted,gms_awarded";
        const cell = (c: unknown) => (/[",\r\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c));
        const rows = s.years.map((y) => {
          const range = fiscalYearRange(y.fiscalYear, s.fiscalYearStartMonth);
          const by = bySource.get(y.fiscalYear)!;
          return [y.fiscalYear, y.label, range.start, range.end, y.submitted, y.decided, y.awarded, y.declined, y.winRate === null ? "" : y.winRate.toFixed(3), printed(y.asked), printed(y.awardedAmount), by.outside.submitted, by.outside.awarded, by.gms.submitted, by.gms.awarded].map(cell).join(",");
        });
        return { filename: "funding-summary.csv", blob: new Blob([[head, ...rows].join("\r\n") + "\r\n"], { type: "text/csv" }) };
      }
      const lines = [`${A.organization.displayName ?? "Funding"} - funding summary`, "", ...s.years.flatMap((y) => [`${y.label}: ${y.submitted} submitted, ${y.decided} decided, ${y.awarded} awarded, ${y.declined} declined, win rate ${pct(y.winRate) || "None decided"}`, `  Asked ${printed(y.asked)}, awarded ${printed(y.awardedAmount)}`, ""])];
      return { filename: "funding-summary.pdf", blob: new Blob([textPdf(lines) as BlobPart], { type: "application/pdf" }) };
    },
  };
  return Object.assign(api, { store: wk });
}
