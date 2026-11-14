// SPDX-License-Identifier: AGPL-3.0-only
// Write faster, and win and keep it (v1.6.0 + v1.7.0), for an applicant workspace: AI drafts from
// the organization's own library, AI reading a funder's guidelines, library freshness and variants,
// the document vault, required documents, go/no-go, question comments, milestones, outside awards
// and their obligations, reports reusing earlier answers, payments received, closeout, the next
// cycle and the funding summary. All of it is the applicant workspace's private record.
//
// `createHttpWriteKeepApi` calls the GMS Worker; `createMockWriteKeepApi` (mocks/writeKeep.ts)
// implements the same interface in the browser. The routes follow the API document (api/keep.tsp);
// the normalizers accept the small variations a server could answer with (money as Money or minor
// units or a per-currency list, a bare list or one wrapped in `data`/`items`/a named key).
import type { AppDocument, Answer } from "./applicant.ts";
import { ApiError } from "./client.ts";
import { moneyOf, toApplication, toQuestion, type ExportFile, type Money, type OutsideApplication, type OutsideQuestion, type QuestionInput } from "./outside.ts";
import type { ParsedQuestion, TextCounts } from "../lib/outside.ts";
import { DEFAULT_WEIGHTS, DOC_TYPES, GO_CRITERIA, type Criterion, type DocType, type RequiredDocument, type Scores, type Variants } from "../lib/writeKeep.ts";

// ------------------------------------------------------------------------------------ shapes

/** A number in a draft taken from a library answer not verified in the last 12 months (or never). */
export interface StaleFlag {
  answerId: string | null;
  /** The figure as it appears in the draft, such as "312 families". */
  figure: string;
  lastVerifiedAt: string | null;
}
/** A draft the assistant wrote from the library and the organization's facts. Nothing is saved. */
export interface AnswerDraft {
  draft: string;
  usedAnswerIds: string[];
  /** What the material did not say, written into the draft as [bracketed placeholders]. */
  unknowns: string[];
  staleFlags: StaleFlag[];
  counts: TextCounts;
  overLimit: boolean;
}

/** What the assistant found in a funder's guidelines. Nothing is saved until the person saves it. */
export interface GuidelinesRead {
  questions: ParsedQuestion[];
  /** Labels such as "IRS determination letter". */
  requiredDocuments: string[];
  /** The uploaded guidelines, kept on the application (`doc_type: funder_guidelines`); null for pasted text. */
  document: AppDocument | null;
}

export interface LibraryMeta {
  lastVerifiedAt: string | null;
  variants: Variants;
  tags: string[];
}
/** A library answer with the v1.6 fields, read when the server sends them. */
export type LibraryAnswer = Answer & Partial<LibraryMeta>;

export interface VaultDocument {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string | null;
  docType: DocType;
  /** YYYY-MM-DD, or null when it does not expire. */
  expiresOn: string | null;
  uploadedAt: string;
}
export interface VaultUpload {
  name: string;
  mime: string;
  contentBase64: string;
  docType: DocType;
  expiresOn?: string | null;
}

export interface GrantSettings {
  goNoGoEnabled: boolean;
  goNoGoWeights: Record<Criterion, number>;
  /** 1 = January. */
  fiscalYearStartMonth: number;
}
export interface GoNoGoInput {
  eligibility: "pass" | "fail";
  scores: Scores;
  decision: "go" | "no_go";
  reason?: string;
  /** Go only: where the application moves next. */
  to?: "loi" | "drafting";
}

export interface QuestionComment {
  id: string;
  questionId: string | null;
  authorUserId: string | null;
  body: string;
  createdAt: string;
}

export type ObligationKind = "report" | "payment_expected" | "payment_received" | "condition";
export type ObligationStatus = "upcoming" | "due" | "submitted" | "received" | "done" | "missed";
export interface Obligation {
  id: string;
  outsideApplicationId: string;
  kind: ObligationKind;
  title: string;
  /** When it is due; for a payment received, the date it arrived. */
  dueOn: string | null;
  /** Payments only. */
  amount: Money | null;
  status: ObligationStatus;
  seriesId: string | null;
  notes: string | null;
  submittedAt: string | null;
  confirmationRef: string | null;
  /** The "as submitted" PDF of a report. */
  documentId: string | null;
  snapshotSha256: string | null;
  /** When it was done or received. */
  completedOn: string | null;
  /** The statuses a person may move it to, when the server says (submitted has its own route). */
  allowedStatuses: ObligationStatus[] | null;
  createdAt: string;
  updatedAt: string;
}
/** "Every N months from the first one until the end" (the first is `startOn` itself). */
export interface SeriesInput {
  everyMonths: number;
  startOn: string;
  endOn: string;
}
export interface ObligationInput {
  kind: ObligationKind;
  title: string;
  dueOn?: string | null;
  amount?: Money | null;
  notes?: string | null;
  series?: SeriesInput;
}
export type ObligationPatch = Partial<{ title: string; dueOn: string | null; amount: Money | null; notes: string | null }>;
export interface StatusInput {
  to: ObligationStatus;
  /** When it was done or received (today by default). */
  completedOn?: string;
  /** A payment expected that came in: the amount received. */
  amount?: Money;
}
export type SeriesPatch = Partial<{ title: string; everyMonths: number; startOn: string; endOn: string; amount: Money | null; notes: string | null }>;

/** An answer from an earlier report in this workspace, offered for reuse. */
export interface PriorReportAnswer {
  answerId: string;
  questionId: string;
  prompt: string;
  body: string;
  applicationTitle: string | null;
  funderName: string | null;
  obligationTitle: string | null;
  submittedAt: string | null;
}

export interface OutsideAward {
  id: string;
  title: string;
  funderName: string;
  awardedAmount: Money | null;
  /** Null when the server did not say. */
  receivedAmount: Money | null;
  grantStart: string | null;
  grantEnd: string | null;
  closedOutAt: string | null;
  nextDue: { title: string; dueOn: string } | null;
}

export interface FundingYear {
  fiscalYear: number;
  label: string;
  submitted: number;
  decided: number;
  awarded: number;
  declined: number;
  /** Awarded ÷ decided; null when nothing was decided. */
  winRate: number | null;
  asked: Money;
  awardedAmount: Money;
}
export interface FundingSummary {
  fiscalYearStartMonth: number;
  currency: string;
  years: FundingYear[];
}

export interface WriteKeepApi {
  // ---- v1.6 write faster
  /** A draft for one question from the library and the organization's facts. Saves nothing; counts against the AI quota. */
  draftAnswer(questionId: string): Promise<AnswerDraft>;
  /** Reads pasted guidelines (60,000 characters at most). Saves nothing. */
  readGuidelines(applicationId: string, text: string): Promise<GuidelinesRead>;
  /** Keeps an uploaded PDF or text file on the application and reads it. The questions are not saved. */
  uploadGuidelines(applicationId: string, file: { name: string; mime: "application/pdf" | "text/plain"; contentBase64: string }): Promise<GuidelinesRead>;
  /** The answer library with when each answer was last verified, its variants and tags. */
  library(): Promise<LibraryAnswer[]>;
  verifyAnswer(answerId: string): Promise<LibraryAnswer>;
  /** Saves new variants or tags (on the server, as a new version of the answer). */
  updateAnswerMeta(answerId: string, patch: Partial<Pick<LibraryMeta, "variants" | "tags">>): Promise<LibraryAnswer>;
  vault(): Promise<VaultDocument[]>;
  uploadVault(input: VaultUpload): Promise<VaultDocument>;
  updateVault(id: string, patch: Partial<Pick<VaultDocument, "docType" | "expiresOn" | "name">>): Promise<VaultDocument>;
  deleteVault(id: string): Promise<void>;
  vaultFile(id: string): Promise<ExportFile>;
  /** Replaces the application's required documents. */
  setRequiredDocuments(applicationId: string, list: RequiredDocument[]): Promise<RequiredDocument[]>;
  /** "Use from vault": a vault document meets one required document (null takes it off). */
  useFromVault(applicationId: string, label: string, documentId: string | null): Promise<RequiredDocument[]>;
  /** Creates the milestone tasks the person confirmed. */
  createMilestones(applicationId: string, tasks: { title: string; dueOn: string; assigneeUserId?: string | null }[]): Promise<number>;
  settings(): Promise<GrantSettings>;
  saveSettings(patch: Partial<GrantSettings>): Promise<GrantSettings>;
  /** Records go (to a letter of inquiry or drafting) or no-go (not pursuing), through the workflow. */
  decideGoNoGo(applicationId: string, input: GoNoGoInput): Promise<OutsideApplication>;
  comments(applicationId: string, questionId: string): Promise<QuestionComment[]>;
  addComment(questionId: string, body: string): Promise<QuestionComment>;

  // ---- v1.7 win and keep it
  outsideAwards(): Promise<OutsideAward[]>;
  obligations(applicationId: string): Promise<Obligation[]>;
  /** One obligation, or every instance of a series. */
  createObligation(applicationId: string, input: ObligationInput): Promise<Obligation[]>;
  updateObligation(obligationId: string, patch: ObligationPatch): Promise<Obligation>;
  setObligationStatus(obligationId: string, input: StatusInput): Promise<Obligation>;
  /** Changes a series: only future, untouched instances are replaced. */
  updateSeries(seriesId: string, patch: SeriesPatch): Promise<{ replaced: number; added: number; kept: number }>;
  deleteObligation(obligationId: string): Promise<void>;
  /** Records a report the person submitted to the funder; keeps an "as submitted" PDF with its fingerprint. */
  submitObligation(obligationId: string, input: { submittedAt: string; confirmationRef?: string }): Promise<Obligation>;
  reportQuestions(obligationId: string): Promise<OutsideQuestion[]>;
  addReportQuestions(obligationId: string, questions: QuestionInput[]): Promise<OutsideQuestion[]>;
  /** Answers to other reports' questions in the workspace, for a question of this report. */
  priorReportAnswers(obligationId: string, filter?: { questionId?: string; q?: string }): Promise<PriorReportAnswer[]>;
  closeOut(applicationId: string): Promise<OutsideApplication>;
  /** "Get an alert when it reopens": a funding alert on the program, on the GMS's own alerts service (never OpenGrants' API). */
  nextCycleAlert(applicationId: string): Promise<{ id: string; query: string; createdAt: string }>;
  fundingSummary(): Promise<FundingSummary>;
  exportSummary(format: "csv" | "pdf"): Promise<ExportFile>;
}

/**
 * The answer library with its v1.6 fields. A server that sends `lastVerifiedAt` on the answers
 * needs nothing more; otherwise the fields are read from the library call and joined by key.
 */
export async function libraryWithMeta(answers: () => Promise<Answer[]>, wk: Pick<WriteKeepApi, "library">): Promise<LibraryAnswer[]> {
  const list = await answers();
  if (list.length === 0 || list.some((a) => "lastVerifiedAt" in a)) return list;
  const meta = await wk.library().catch(() => [] as LibraryAnswer[]);
  return list.map((a) => {
    const m = meta.find((x) => x.id === a.id) ?? meta.find((x) => x.key === a.key);
    return m ? { ...a, lastVerifiedAt: m.lastVerifiedAt ?? null, variants: m.variants ?? {}, tags: m.tags ?? [] } : a;
  });
}

// ------------------------------------------------------------------------------------ shaping

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap((x) => (typeof x === "string" && x.trim() ? [x.trim()] : str(obj(x).label) ? [str(obj(x).label)!] : [])) : []);
const day = (v: unknown) => str(v)?.slice(0, 10) ?? null;
/** A list from a bare array, or the first array under one of `keys`. */
const listOf = (data: unknown, ...keys: string[]): unknown[] => {
  if (Array.isArray(data)) return data;
  for (const k of keys) if (Array.isArray(obj(data)[k])) return obj(data)[k] as unknown[];
  return [];
};

export function toDraft(raw: unknown): AnswerDraft {
  const r = obj(raw);
  const c = obj(r.counts);
  const used = Array.isArray(r.usedAnswers) ? r.usedAnswers.map(obj) : [];
  return {
    draft: typeof r.draft === "string" ? r.draft : typeof r.text === "string" ? r.text : "",
    usedAnswerIds: strs(r.usedAnswerIds),
    unknowns: strs(r.unknowns),
    staleFlags: (Array.isArray(r.staleFlags) ? r.staleFlags : []).flatMap((f): StaleFlag[] => {
      if (typeof f === "string") return f.trim() ? [{ answerId: null, figure: f.trim(), lastVerifiedAt: null }] : [];
      const x = obj(f);
      const figure = str(x.figure) ?? str(x.text) ?? str(x.value);
      const answerId = str(x.answerId);
      return figure ? [{ answerId, figure, lastVerifiedAt: str(x.lastVerifiedAt) ?? str(used.find((u) => u.id === answerId)?.lastVerifiedAt) }] : [];
    }),
    counts: { words: num(c.words) ?? 0, chars: num(c.chars) ?? 0, charsNoSpaces: num(c.charsNoSpaces) ?? 0 },
    overLimit: r.overLimit === true,
  };
}

export function toGuidelines(raw: unknown): GuidelinesRead {
  const r = obj(raw);
  return {
    questions: (Array.isArray(r.questions) ? r.questions : []).flatMap((q): ParsedQuestion[] => {
      const x = obj(q);
      const prompt = str(x.prompt);
      if (!prompt) return [];
      const phase = x.phase === "loi" || x.phase === "report" ? x.phase : "full";
      const kind = x.limitKind === "words" || x.limitKind === "chars" || x.limitKind === "chars_no_spaces" ? x.limitKind : undefined;
      const value = num(x.limitValue);
      return [{ prompt, phase, ...(kind && value ? { limitKind: kind, limitValue: value } : {}) }];
    }),
    requiredDocuments: strs(r.requiredDocuments),
    document: r.document && typeof r.document === "object" ? (r.document as AppDocument) : null,
  };
}

const DOC_TYPE_SET: ReadonlySet<string> = new Set(DOC_TYPES);
export function toVault(raw: unknown): VaultDocument {
  const r = obj(raw);
  const t = str(r.docType);
  return {
    id: String(r.id),
    name: str(r.name) ?? "Document",
    mime: str(r.mime) ?? str(r.mimeType) ?? "application/octet-stream",
    size: num(r.size) ?? 0,
    sha256: str(r.sha256),
    docType: (t && DOC_TYPE_SET.has(t) ? t : "other") as DocType,
    expiresOn: day(r.expiresOn) ?? day(obj(r.expiry).expiresOn),
    uploadedAt: str(r.uploadedAt) ?? str(r.createdAt) ?? "",
  };
}

export function toSettings(raw: unknown): GrantSettings {
  const r = obj(raw);
  const w = obj(r.goNoGoWeights);
  const month = num(r.fiscalYearStartMonth);
  return {
    goNoGoEnabled: r.goNoGoEnabled === true,
    goNoGoWeights: Object.fromEntries(GO_CRITERIA.map((c) => [c, num(w[c]) ?? DEFAULT_WEIGHTS[c]])) as Record<Criterion, number>,
    fiscalYearStartMonth: month && month >= 1 && month <= 12 ? month : 1,
  };
}

const KINDS: ReadonlySet<string> = new Set<ObligationKind>(["report", "payment_expected", "payment_received", "condition"]);
const STATUSES: ReadonlySet<string> = new Set<ObligationStatus>(["upcoming", "due", "submitted", "received", "done", "missed"]);
export function toObligation(raw: unknown): Obligation {
  const r = obj(raw);
  const kind = str(r.kind);
  const status = str(r.status);
  const snapshot = obj(r.snapshot);
  return {
    id: String(r.id),
    outsideApplicationId: String(r.outsideApplicationId ?? ""),
    kind: (kind && KINDS.has(kind) ? kind : "condition") as ObligationKind,
    title: str(r.title) ?? "",
    dueOn: day(r.dueOn),
    amount: moneyOf(r.amount, r.amountMinor, str(r.currency) ?? "USD"),
    status: (status && STATUSES.has(status) ? status : "upcoming") as ObligationStatus,
    seriesId: str(r.seriesId),
    notes: str(r.notes),
    submittedAt: day(r.submittedAt),
    confirmationRef: str(r.confirmationRef),
    documentId: str(snapshot.documentId) ?? str(r.documentId),
    snapshotSha256: str(snapshot.sha256) ?? str(r.snapshotSha256),
    completedOn: day(r.completedOn),
    allowedStatuses: Array.isArray(r.allowedStatuses) ? (r.allowedStatuses.filter((s) => typeof s === "string" && STATUSES.has(s)) as ObligationStatus[]) : null,
    createdAt: str(r.createdAt) ?? "",
    updatedAt: str(r.updatedAt) ?? "",
  };
}

export function toComment(raw: unknown): QuestionComment {
  const r = obj(raw);
  const author = str(r.author);
  return { id: String(r.id), questionId: str(r.questionId), authorUserId: str(r.authorUserId) ?? (author?.match(/^user:([^/]+)/)?.[1] ?? null), body: typeof r.body === "string" ? r.body : "", createdAt: str(r.createdAt) ?? "" };
}

export function toPrior(raw: unknown): PriorReportAnswer {
  const r = obj(raw);
  return {
    answerId: String(r.answerId),
    questionId: String(r.questionId ?? ""),
    prompt: str(r.prompt) ?? "",
    body: typeof r.body === "string" ? r.body : "",
    applicationTitle: str(r.applicationTitle),
    funderName: str(r.funderName),
    obligationTitle: str(r.obligationTitle),
    submittedAt: day(r.submittedAt),
  };
}

/** One currency's amount from Money, minor units, or a per-currency list of Money. */
function moneyIn(v: unknown, minor: unknown, currency: string): Money {
  if (Array.isArray(v)) {
    const list = v.map((x) => moneyOf(x, null, currency)).filter((m): m is Money => !!m);
    return list.find((m) => m.currency === currency) ?? list[0] ?? { amount: "0.00", currency };
  }
  return moneyOf(v, minor, currency) ?? { amount: "0.00", currency };
}

export function toSummary(raw: unknown): FundingSummary {
  const r = obj(raw);
  const currency = str(r.currency) ?? "USD";
  return {
    fiscalYearStartMonth: num(r.fiscalYearStartMonth) ?? 1,
    currency,
    years: (Array.isArray(r.years) ? r.years : []).map((y) => {
      const x = obj(y);
      const decided = num(x.decided) ?? 0;
      const awarded = num(x.awarded) ?? 0;
      return {
        fiscalYear: num(x.fiscalYear) ?? 0,
        label: str(x.label) ?? String(x.fiscalYear ?? ""),
        submitted: num(x.submitted) ?? 0,
        decided,
        awarded,
        declined: num(x.declined) ?? 0,
        winRate: num(x.winRate) ?? (decided ? awarded / decided : null),
        asked: moneyIn(x.asked, x.askedMinor, currency),
        awardedAmount: moneyIn(x.awardedAmount, x.awardedMinor, currency),
      };
    }),
  };
}

/** The server's required documents ({label, status, document}) or the client's ({label, status, documentId}). */
export const toRequired = (v: unknown): RequiredDocument[] =>
  listOf(v, "items", "requiredDocuments").flatMap((x) => {
    const d = obj(x);
    const label = str(d.label);
    if (!label) return [];
    const documentId = str(d.documentId) ?? str(obj(d.document).id);
    const status = d.status === "not_needed" ? "not_needed" : documentId || d.status === "attached" ? "attached" : "needed";
    return [{ label, documentId, status }];
  });

// ------------------------------------------------------------------------------------ HTTP

export interface HttpWriteKeepOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  /** The applicant workspace the calls act in (sent as `X-GMS-Workspace` with a session bearer). */
  workspaceId: () => string | null;
  fetch?: typeof fetch;
}

export function createHttpWriteKeepApi(opts: HttpWriteKeepOptions): WriteKeepApi {
  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    const token = await opts.token();
    const workspaceId = opts.workspaceId();
    const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(workspaceId ? { "X-GMS-Workspace": workspaceId } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { message?: string; errors?: unknown[] };
      throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, json.errors ?? []);
    }
    return res;
  }
  async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await send(method, path, body);
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => ({}))) as { data?: T; items?: T };
    return (json.data ?? json.items) as T;
  }
  async function file(path: string, fallback: string): Promise<ExportFile> {
    const res = await send("GET", path);
    const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get("Content-Disposition") ?? "")?.[1];
    return { filename: named ? decodeURIComponent(named) : fallback, blob: await res.blob() };
  }
  const e = encodeURIComponent;
  const oa = (id: string) => `/gms/outside-applications/${e(id)}`;
  const ob = (id: string) => `/gms/outside-obligations/${e(id)}`;
  const ws = () => {
    const id = opts.workspaceId();
    if (!id) throw new ApiError(400, "Open a workspace first");
    return `/gms/workspaces/${e(id)}`;
  };
  // A required document as the API takes it: attached by naming the document, otherwise needed or not needed.
  const requiredInput = (list: RequiredDocument[]) => ({ items: list.map((d) => (d.status === "attached" && d.documentId ? { label: d.label, documentId: d.documentId } : { label: d.label, status: d.status === "not_needed" ? "not_needed" : "needed", documentId: null })) });

  const api: WriteKeepApi = {
    draftAnswer: async (qid) => toDraft(await call("POST", `/gms/outside-questions/${e(qid)}/draft`, {})),
    readGuidelines: async (id, text) => toGuidelines(await call("POST", `${oa(id)}/questions/parse`, { text, mode: "ai" })),
    uploadGuidelines: async (id, f) => toGuidelines(await call("POST", `${oa(id)}/guidelines`, f)),
    library: async () => listOf(await call("GET", "/gms/my/answers"), "answers", "items") as LibraryAnswer[],
    verifyAnswer: (id) => call("POST", `/gms/my/answers/${e(id)}/verify`, {}),
    updateAnswerMeta: (id, patch) => call("PATCH", `/gms/my/answers/${e(id)}`, patch),
    vault: async () => listOf(await call("GET", "/gms/vault"), "documents", "items").map(toVault),
    uploadVault: async (input) => toVault(await call("POST", "/gms/vault", { name: input.name, mime: input.mime, contentBase64: input.contentBase64, docType: input.docType, ...(input.expiresOn ? { expiresOn: input.expiresOn } : {}) })),
    updateVault: async (id, patch) => toVault(await call("PATCH", `/gms/vault/${e(id)}`, patch)),
    deleteVault: async (id) => void (await call("DELETE", `/gms/vault/${e(id)}`)),
    vaultFile: (id) => file(`/gms/vault/${e(id)}/file`, "document"),
    setRequiredDocuments: async (id, list) => toRequired(await call("PUT", `${oa(id)}/required-documents`, requiredInput(list))),
    useFromVault: async (id, label, documentId) => toRequired(await call("POST", `${oa(id)}/required-documents/use-from-vault`, { label, documentId })),
    createMilestones: async (id, tasks) => listOf(await call("POST", `${oa(id)}/milestones`, { tasks }), "tasks", "items").length,
    settings: async () => toSettings(obj(await call("GET", ws())).settings),
    saveSettings: async (patch) => {
      const data = obj(await call("PATCH", ws(), { settings: patch }));
      return toSettings(obj(obj(data.workspace ?? data).settings));
    },
    decideGoNoGo: async (id, input) => toApplication(await call("POST", `${oa(id)}/go-no-go`, input)),
    comments: async (id, qid) => listOf(await call("GET", `${oa(id)}/comments?questionId=${e(qid)}`), "comments", "items").map(toComment),
    addComment: async (qid, body) => toComment(await call("POST", `/gms/outside-questions/${e(qid)}/comments`, { body })),

    outsideAwards: async () => {
      const items = listOf(await call("GET", "/gms/my/awarded-funding"), "items").map(obj).filter((x) => x.kind === "outside_award");
      // Payments received and what is next come from each award's page.
      return Promise.all(
        items.map(async (x) => {
          const page = obj(await call("GET", `/gms/outside-awards/${e(String(x.id))}`).catch(() => ({})));
          const currency = str(x.currency) ?? str(page.currency) ?? "USD";
          const obligations = listOf(page.obligations).map(toObligation);
          const next = obligations.filter((o) => o.dueOn && !["done", "received", "submitted"].includes(o.status)).sort((a, b) => a.dueOn!.localeCompare(b.dueOn!))[0];
          const payments = obj(page.payments);
          return {
            id: String(x.id),
            title: str(x.title) ?? "",
            funderName: str(x.funderName) ?? "",
            awardedAmount: moneyOf(x.awardedAmount, x.awardedAmountMinor, currency),
            receivedAmount: payments.received ? moneyOf(payments.received, null, currency) : null,
            grantStart: day(x.grantStart),
            grantEnd: day(x.grantEnd),
            closedOutAt: str(x.closedOutAt),
            nextDue: next ? { title: next.title, dueOn: next.dueOn! } : null,
          } satisfies OutsideAward;
        }),
      );
    },
    obligations: async (id) => listOf(await call("GET", `${oa(id)}/obligations`), "obligations", "items").map(toObligation),
    createObligation: async (id, input) => {
      const data = await call("POST", `${oa(id)}/obligations`, input);
      return (Array.isArray(obj(data).obligations) || Array.isArray(data) ? listOf(data, "obligations") : [data]).map(toObligation);
    },
    updateObligation: async (oid, patch) => toObligation(await call("PATCH", ob(oid), patch)),
    setObligationStatus: async (oid, input) => toObligation(await call("POST", `${ob(oid)}/status`, input)),
    updateSeries: async (sid, patch) => {
      const r = obj(await call("PATCH", `/gms/outside-obligation-series/${e(sid)}`, patch));
      return { replaced: num(r.replaced) ?? 0, added: num(r.added) ?? 0, kept: num(r.kept) ?? 0 };
    },
    deleteObligation: async (oid) => void (await call("DELETE", ob(oid))),
    submitObligation: async (oid, input) => toObligation(await call("POST", `${ob(oid)}/submit`, input)),
    reportQuestions: async (oid) => listOf(await call("GET", `${ob(oid)}/questions`), "questions").map((q) => toQuestion(q)),
    addReportQuestions: async (oid, questions) => listOf(await call("POST", `${ob(oid)}/questions`, { questions }), "questions").map((q) => toQuestion(q)),
    priorReportAnswers: async (oid, f = {}) => {
      const qs = [f.questionId ? `questionId=${e(f.questionId)}` : null, f.q?.trim() ? `q=${e(f.q.trim())}` : null].filter(Boolean).join("&");
      return listOf(await call("GET", `${ob(oid)}/reuse${qs ? `?${qs}` : ""}`), "items").map(toPrior);
    },
    closeOut: async (id) => toApplication(await call("POST", `${oa(id)}/close-out`, {})),
    nextCycleAlert: async (id) => {
      const r = obj(await call("POST", `${oa(id)}/next-cycle-alert`, {}));
      return { id: String(r.id), query: str(r.query) ?? str(r.name) ?? "", createdAt: str(r.createdAt) ?? "" };
    },
    fundingSummary: async () => toSummary(await call("GET", "/gms/funding-summary")),
    exportSummary: (format) => file(`/gms/funding-summary/export?format=${format}`, `funding-summary.${format}`),
  };
  return api;
}
