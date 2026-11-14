// SPDX-License-Identifier: AGPL-3.0-only
// Write faster, and win and keep it (v1.6.0 + v1.7.0), for an applicant workspace: AI drafts from
// the organization's own library, AI reading a funder's guidelines, library freshness and variants,
// the document vault, go/no-go, question comments, outside awards and their obligations, reports
// reusing earlier answers, payments received, closeout and the funding summary. All of it is the
// applicant workspace's private record.
//
// `createHttpWriteKeepApi` calls the GMS Worker; `createMockWriteKeepApi` (mocks/writeKeep.ts)
// implements the same interface in the browser. The shapes are written by hand against the
// write-and-keep contract while the API is built in parallel; the normalizers accept the small
// variations a first server could answer with (money as Money or minor units, a bare list or one
// wrapped in `data`/`items`).
import type { AppDocument, Answer } from "./applicant.ts";
import { ApiError } from "./client.ts";
import { moneyOf, toApplication, type ExportFile, type Money, type OutsideApplication } from "./outside.ts";
import type { ParsedQuestion, TextCounts } from "../lib/outside.ts";
import { DEFAULT_WEIGHTS, DOC_TYPES, GO_CRITERIA, type Criterion, type DocType, type Scores, type Variants } from "../lib/writeKeep.ts";

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
  nextStage?: "loi" | "drafting";
}

export interface QuestionComment {
  id: string;
  threadId: string;
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
  dueOn: string | null;
  /** Payments only. */
  amount: Money | null;
  status: ObligationStatus;
  seriesId: string | null;
  notes: string | null;
  submittedAt: string | null;
  confirmationRef: string | null;
  /** The "as submitted" PDF of a report, or a document kept with the obligation. */
  documentId: string | null;
  snapshotSha256: string | null;
  createdAt: string;
  updatedAt: string;
}
/** "Every N months from the start until the end"; the first falls N months after the start. */
export interface SeriesInput {
  everyMonths: number;
  from: string;
  until: string;
}
export interface ObligationInput {
  kind: ObligationKind;
  title: string;
  dueOn?: string | null;
  amount?: Money | null;
  notes?: string | null;
  series?: SeriesInput;
}
export type ObligationPatch = Partial<{ title: string; dueOn: string | null; amount: Money | null; notes: string | null; status: ObligationStatus }> & {
  /** "series" changes every future, untouched obligation in the series, regenerated from `series` when given. */
  scope?: "one" | "series";
  series?: SeriesInput;
};

/** An answer from an earlier report in this workspace, offered for reuse. */
export interface PriorReportAnswer {
  answerId: string;
  questionId: string;
  prompt: string;
  body: string;
  applicationId: string;
  applicationTitle: string;
  funderName: string;
  obligationTitle: string | null;
  submittedAt: string | null;
}

export interface OutsideAward {
  id: string;
  title: string;
  funderName: string;
  awardedAmount: Money | null;
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
  uploadGuidelines(applicationId: string, file: { name: string; mime: string; contentBase64: string }): Promise<GuidelinesRead>;
  /** The answer library with when each answer was last verified, its variants and tags. */
  library(): Promise<LibraryAnswer[]>;
  verifyAnswer(answerId: string): Promise<LibraryAnswer>;
  updateAnswerMeta(answerId: string, patch: Partial<Pick<LibraryMeta, "variants" | "tags">>): Promise<LibraryAnswer>;
  vault(): Promise<VaultDocument[]>;
  uploadVault(input: VaultUpload): Promise<VaultDocument>;
  updateVault(id: string, patch: Partial<Pick<VaultDocument, "docType" | "expiresOn" | "name">>): Promise<VaultDocument>;
  deleteVault(id: string): Promise<void>;
  vaultFile(id: string): Promise<ExportFile>;
  settings(): Promise<GrantSettings>;
  saveSettings(patch: Partial<GrantSettings>): Promise<GrantSettings>;
  /** Records go (to a letter of inquiry or drafting) or no-go (not pursuing), through the workflow. */
  decideGoNoGo(applicationId: string, input: GoNoGoInput): Promise<OutsideApplication>;
  comments(applicationId: string, questionId: string): Promise<QuestionComment[]>;
  addComment(applicationId: string, questionId: string, body: string): Promise<QuestionComment>;

  // ---- v1.7 win and keep it
  outsideAwards(): Promise<OutsideAward[]>;
  obligations(applicationId: string): Promise<Obligation[]>;
  /** One obligation, or every instance of a series. */
  createObligation(applicationId: string, input: ObligationInput): Promise<Obligation[]>;
  /** Answers every obligation the change touched. */
  updateObligation(obligationId: string, patch: ObligationPatch): Promise<Obligation[]>;
  deleteObligation(obligationId: string): Promise<void>;
  /** Records a report the person submitted to the funder; keeps an "as submitted" PDF with its fingerprint. */
  submitObligation(obligationId: string, input: { submittedAt: string; confirmationRef?: string }): Promise<Obligation>;
  priorReportAnswers(q?: string): Promise<PriorReportAnswer[]>;
  closeOut(applicationId: string): Promise<OutsideApplication>;
  /** "Get an alert when it reopens": a funding alert on the GMS's own alerts service (never OpenGrants' API). */
  createAlert(query: string): Promise<{ id: string; query: string; createdAt: string }>;
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

export function toDraft(raw: unknown): AnswerDraft {
  const r = obj(raw);
  const c = obj(r.counts);
  return {
    draft: typeof r.draft === "string" ? r.draft : typeof r.text === "string" ? r.text : "",
    usedAnswerIds: strs(r.usedAnswerIds),
    unknowns: strs(r.unknowns),
    staleFlags: (Array.isArray(r.staleFlags) ? r.staleFlags : []).flatMap((f): StaleFlag[] => {
      if (typeof f === "string") return f.trim() ? [{ answerId: null, figure: f.trim(), lastVerifiedAt: null }] : [];
      const x = obj(f);
      const figure = str(x.figure) ?? str(x.text) ?? str(x.value);
      return figure ? [{ answerId: str(x.answerId), figure, lastVerifiedAt: str(x.lastVerifiedAt) }] : [];
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
    expiresOn: day(r.expiresOn),
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
    documentId: str(r.documentId),
    snapshotSha256: str(r.snapshotSha256),
    createdAt: str(r.createdAt) ?? "",
    updatedAt: str(r.updatedAt) ?? "",
  };
}

export function toComment(raw: unknown, threadId: string): QuestionComment {
  const r = obj(raw);
  const author = str(r.author);
  return { id: String(r.id), threadId, authorUserId: str(r.authorUserId) ?? (author?.match(/^user:([^/]+)/)?.[1] ?? null), body: typeof r.body === "string" ? r.body : "", createdAt: str(r.createdAt) ?? "" };
}

export function toAward(raw: unknown): OutsideAward {
  const r = obj(raw);
  const currency = str(r.currency) ?? "USD";
  const next = obj(r.nextDue);
  return {
    id: String(r.id),
    title: str(r.title) ?? "",
    funderName: str(r.funderName) ?? "",
    awardedAmount: moneyOf(r.awardedAmount, r.awardedAmountMinor, currency),
    receivedAmount: moneyOf(r.receivedAmount, r.receivedAmountMinor, currency),
    grantStart: day(r.grantStart),
    grantEnd: day(r.grantEnd),
    closedOutAt: str(r.closedOutAt),
    nextDue: str(next.title) && day(next.dueOn) ? { title: str(next.title)!, dueOn: day(next.dueOn)! } : null,
  };
}

export function toSummary(raw: unknown): FundingSummary {
  const r = obj(raw);
  const currency = str(r.currency) ?? "USD";
  const money = (v: unknown, minor: unknown) => moneyOf(v, minor, currency) ?? { amount: "0.00", currency };
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
        asked: money(x.asked, x.askedMinor),
        awardedAmount: money(x.awardedAmount, x.awardedMinor),
      };
    }),
  };
}

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
    const json = (await res.json().catch(() => ({}))) as { data?: T };
    return json.data as T;
  }
  async function list(path: string): Promise<unknown[]> {
    const res = await send("GET", path);
    const json = (await res.json().catch(() => ({}))) as { data?: unknown; items?: unknown[] };
    return json.items ?? (Array.isArray(json.data) ? json.data : Array.isArray(obj(json.data).items) ? (obj(json.data).items as unknown[]) : []);
  }
  async function file(path: string, fallback: string): Promise<ExportFile> {
    const res = await send("GET", path);
    const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get("Content-Disposition") ?? "")?.[1];
    return { filename: named ? decodeURIComponent(named) : fallback, blob: await res.blob() };
  }
  const e = encodeURIComponent;
  const oa = (id: string) => `/gms/outside-applications/${e(id)}`;
  const ob = (id: string) => `/gms/outside-obligations/${e(id)}`;
  const rows = (data: unknown): unknown[] => (Array.isArray(data) ? data : Array.isArray(obj(data).obligations) ? (obj(data).obligations as unknown[]) : Array.isArray(obj(data).items) ? (obj(data).items as unknown[]) : [obj(data)]);

  /** The internal thread that holds one question's comments, found by its field reference. */
  async function threadFor(applicationId: string, questionId: string, create: boolean): Promise<{ id: string; messages: unknown[] } | null> {
    const threads = (await list(`/gms/threads?subjectType=outside_application&subjectId=${e(applicationId)}`)).map(obj);
    const found = threads.find((t) => t.fieldRef === questionId);
    if (found) return { id: String(found.id), messages: Array.isArray(found.messages) ? found.messages : [] };
    if (!create) return null;
    const made = obj(await call("POST", "/gms/threads", { subjectType: "outside_application", subjectId: applicationId, fieldRef: questionId, visibility: "internal" }));
    return { id: String(made.id), messages: [] };
  }

  return {
    draftAnswer: async (qid) => toDraft(await call("POST", `/gms/outside-questions/${e(qid)}/draft`, {})),
    readGuidelines: async (id, text) => toGuidelines(await call("POST", `${oa(id)}/questions/parse`, { text, mode: "ai" })),
    uploadGuidelines: async (id, f) => toGuidelines(await call("POST", `${oa(id)}/guidelines`, f)),
    library: async () => (await list("/gms/my/answers")) as LibraryAnswer[],
    verifyAnswer: (id) => call("POST", `/gms/my/answers/${e(id)}/verify`, {}),
    updateAnswerMeta: (id, patch) => call("PATCH", `/gms/my/answers/${e(id)}`, patch),
    vault: async () => (await list("/gms/vault/documents")).map(toVault),
    uploadVault: async (input) => toVault(await call("POST", "/gms/vault/documents", input)),
    updateVault: async (id, patch) => toVault(await call("PATCH", `/gms/vault/documents/${e(id)}`, patch)),
    deleteVault: async (id) => void (await call("DELETE", `/gms/vault/documents/${e(id)}`)),
    vaultFile: (id) => file(`/gms/vault/documents/${e(id)}/file`, "document"),
    settings: async () => toSettings(await call("GET", "/gms/my/grant-settings")),
    saveSettings: async (patch) => toSettings(await call("PATCH", "/gms/my/grant-settings", patch)),
    decideGoNoGo: async (id, input) => toApplication(await call("POST", `${oa(id)}/go-no-go`, input)),
    comments: async (id, qid) => {
      const t = await threadFor(id, qid, false);
      return t ? t.messages.map((m) => toComment(m, t.id)) : [];
    },
    addComment: async (id, qid, body) => {
      const t = (await threadFor(id, qid, true))!;
      return toComment(await call("POST", `/gms/threads/${e(t.id)}/messages`, { body }), t.id);
    },

    outsideAwards: async () => (await list("/gms/outside-awards")).map(toAward),
    obligations: async (id) => (await list(`${oa(id)}/obligations`)).map(toObligation),
    createObligation: async (id, input) => rows(await call("POST", `${oa(id)}/obligations`, input)).map(toObligation),
    updateObligation: async (oid, patch) => rows(await call("PATCH", ob(oid), patch)).map(toObligation),
    deleteObligation: async (oid) => void (await call("DELETE", ob(oid))),
    submitObligation: async (oid, input) => toObligation(await call("POST", `${ob(oid)}/submit`, input)),
    priorReportAnswers: async (q) => (await list(`/gms/outside-report-answers${q?.trim() ? `?q=${e(q.trim())}` : ""}`)) as PriorReportAnswer[],
    closeOut: async (id) => toApplication(await call("POST", `${oa(id)}/close-out`, {})),
    createAlert: async (query) => {
      const r = obj(await call("POST", "/gms/discover/alerts", { name: query.trim().slice(0, 120), query: query.trim() }));
      return { id: String(r.id), query: str(r.query) ?? query.trim(), createdAt: str(r.createdAt) ?? "" };
    },
    fundingSummary: async () => toSummary(await call("GET", "/gms/funding-summary")),
    exportSummary: (format) => file(`/gms/funding-summary/export.${format}`, `funding-summary.${format}`),
  };
}
