// SPDX-License-Identifier: AGPL-3.0-only
// The applicant's own grant seeking beyond this GMS: outside applications (to any funder), their
// questions and answer versions, the pipeline, light funder records, the calendar feed, CSV import
// and export, and the consulting request. These are the applicant workspace's private records.
// `createHttpOutsideApi` calls the GMS Worker; `createMockOutsideApi` (mocks/outside.ts) implements
// the same interface in the browser.
//
// The shapes are written by hand against the apply-anywhere contract while the API is built in
// parallel; the normalizers below accept the small variations a first server could answer with
// (dates nested under `deadlines` or flat, money as Money or minor units, the owner as an id).
import type { AppDocument, AttachmentInput, DiscoverCompetition, OpenGrantsListing, Task } from "./applicant.ts";
import { ApiError } from "./client.ts";
import type { LimitKind, OutsideStage, ParsedQuestion, QuestionPhase, TextCounts, DecisionOutcome } from "../lib/outside.ts";

export type { OutsideStage, LimitKind, QuestionPhase, DecisionOutcome };
export type OutsideSource = "opengrants" | "manual" | "import" | "link";
export type SubmissionMethod = "portal" | "email" | "mail" | "grants_gov" | "other";
export type QuestionStatus = "empty" | "draft" | "ready" | "approved";

export interface Money {
  /** Decimal string, as CommonGrants Money. */
  amount: string;
  currency: string;
}
export interface YearAmount {
  year: number;
  amountMinor: number;
}
export interface Deadlines {
  loiDue: string | null;
  fullDue: string | null;
  internalDue: string | null;
  rolling: boolean;
}
export interface OwnerRef {
  userId: string;
  name: string | null;
}
/** What the OpenGrants listing said when the application was started from it. */
export interface ListingSnapshot {
  funder?: string;
  amount?: string;
  deadline?: string;
  summary?: string;
  url?: string;
}

export interface OutsideListItem {
  id: string;
  title: string;
  funderName: string;
  stage: OutsideStage;
  deadlines: Deadlines;
  askAmount: Money | null;
  owner: OwnerRef | null;
  updatedAt: string;
  questionCounts: { total: number; approved: number };
  /** Not in the contract's list shape; read when the server sends it (Find funding uses it to show Saved). */
  source?: OutsideSource | null;
  sourceRef?: string | null;
  archivedAt?: string | null;
}

export interface OutsideApplication {
  id: string;
  title: string;
  programName: string | null;
  funderRecordId: string | null;
  funderName: string;
  source: OutsideSource;
  sourceRef: string | null;
  listing: ListingSnapshot | null;
  listingUrl: string | null;
  portalUrl: string | null;
  stage: OutsideStage;
  previousStage: OutsideStage | null;
  currency: string;
  askAmount: Money | null;
  askByYear: YearAmount[];
  loiDue: string | null;
  fullDue: string | null;
  internalDue: string | null;
  rolling: boolean;
  submittedAt: string | null;
  submissionMethod: SubmissionMethod | null;
  confirmationRef: string | null;
  receiptDocumentId: string | null;
  snapshotDocumentId: string | null;
  snapshotSha256: string | null;
  decidedAt: string | null;
  awardedAmount: Money | null;
  awardByYear: YearAmount[];
  grantStart: string | null;
  grantEnd: string | null;
  decisionNotes: string | null;
  nextCycleOn: string | null;
  owner: OwnerRef | null;
  customFields: Record<string, string | number | boolean | null>;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OutsideAnswer {
  id: string;
  questionId: string;
  version: number;
  body: string;
  /** `user`, `library`, `agent:<client>` … (the forms provenance vocabulary). */
  provenance: string;
  libraryAnswerId: string | null;
  createdBy: string | null;
  createdAt: string;
}
export interface SavedAnswer extends OutsideAnswer {
  counts: TextCounts;
  overLimit: boolean;
}

export interface OutsideQuestion {
  id: string;
  phase: QuestionPhase;
  section: string | null;
  position: number;
  prompt: string;
  guidance: string | null;
  limitKind: LimitKind | null;
  limitValue: number | null;
  required: boolean;
  assigneeUserId: string | null;
  status: QuestionStatus;
  /** The latest version, or null before anything is written. */
  answer: OutsideAnswer | null;
}

/** One ledger entry for this application: ids, stages and dates only, never answer text. */
export interface OutsideEvent {
  id: string;
  type: string;
  at: string;
  actor?: string | null;
  data?: Record<string, unknown>;
}

export interface OutsideDetail extends OutsideApplication {
  questions: OutsideQuestion[];
  documents: AppDocument[];
  tasks: Task[];
  /** Read when the server sends it; otherwise the screen draws the activity from the record's own dates. */
  activity?: OutsideEvent[];
}

export interface OutsideCreateInput {
  source: OutsideSource;
  sourceRef?: string;
  listing?: ListingSnapshot;
  title: string;
  funderName: string;
  programName?: string;
  listingUrl?: string;
  portalUrl?: string;
  loiDue?: string;
  fullDue?: string;
  internalDue?: string;
  rolling?: boolean;
  askAmount?: Money;
  stage?: "prospect" | "drafting";
}

/** Everything a person edits in place. Stage, submission and decision have their own calls. */
export type OutsidePatch = Partial<{
  title: string;
  programName: string | null;
  funderName: string;
  funderRecordId: string | null;
  listingUrl: string | null;
  portalUrl: string | null;
  loiDue: string | null;
  fullDue: string | null;
  internalDue: string | null;
  rolling: boolean;
  askAmount: Money | null;
  askByYear: YearAmount[];
  ownerUserId: string | null;
  customFields: Record<string, string | number | boolean | null>;
}>;

export interface SubmitInput {
  /** Date (YYYY-MM-DD) the person submitted on the funder's own site. */
  submittedAt: string;
  method: SubmissionMethod;
  confirmationRef?: string;
  receiptDocumentId?: string;
}

export interface DecisionInput {
  outcome: DecisionOutcome;
  awardedAmount?: Money;
  awardByYear?: YearAmount[];
  grantStart?: string;
  grantEnd?: string;
  notes?: string;
  nextCycleOn?: string;
}

export interface QuestionInput {
  prompt: string;
  phase?: QuestionPhase;
  section?: string | null;
  guidance?: string | null;
  limitKind?: LimitKind | null;
  limitValue?: number | null;
  required?: boolean;
  assigneeUserId?: string | null;
}
export type QuestionPatch = Partial<QuestionInput & { status: QuestionStatus; position: number }>;

export interface PipelineItem {
  kind: "gms_application" | "outside_application" | "saved_gms";
  id: string;
  title: string;
  funderName: string | null;
  /** Outside applications. */
  stage?: OutsideStage | null;
  /** Applications on this GMS (the application status vocabulary). */
  status?: string | null;
  nextDeadline: string | null;
  url: string | null;
}

export interface FunderContact {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
}
export interface FunderRecordApplication {
  kind: "outside_application" | "gms_application";
  id: string;
  title: string;
  stage?: OutsideStage | null;
  status?: string | null;
  askAmount?: Money | null;
  awardedAmount?: Money | null;
  submittedAt?: string | null;
  decidedAt?: string | null;
  /** A built-in application whose funder's workspace name matches this record's name exactly. */
  nameMatch?: boolean;
}
export interface FunderRecord {
  id: string;
  name: string;
  website: string | null;
  notes: string | null;
  contacts: FunderContact[];
  portalUrl: string | null;
  /** The person on the team who holds the portal login. A name only; never a password. */
  portalLoginHolder: string | null;
  createdAt: string;
  updatedAt: string;
  applications: FunderRecordApplication[];
}
export interface FunderRecordInput {
  name: string;
  website?: string | null;
  notes?: string | null;
  contacts?: FunderContact[];
  portalUrl?: string | null;
  portalLoginHolder?: string | null;
}

/** The fields a CSV column can fill. */
export const IMPORT_FIELDS = ["title", "funderName", "programName", "stage", "loiDue", "fullDue", "internalDue", "askAmount", "listingUrl", "portalUrl"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export interface ImportRow {
  /** 1-based line in the file, the header being line 1. */
  row: number;
  values: Partial<Record<ImportField, string>>;
  problems: { field?: string; message: string }[];
}
export interface ImportResult {
  dryRun: boolean;
  rows: ImportRow[];
  created: OutsideListItem[];
}
export interface ImportInput {
  csv: string;
  /** Field → the CSV header it is read from. */
  mapping: Partial<Record<ImportField, string>>;
  dryRun: boolean;
}

export interface ConsultingInput {
  contactName: string;
  contactEmail: string;
  message?: string;
  includeAnswers?: boolean;
}
/** Exactly what the consulting request email will carry. */
export interface ConsultingPreview {
  to: string;
  replyTo: string;
  subject: string;
  organization: string;
  contactName: string;
  contactEmail: string;
  title: string;
  funder: string;
  deadlines: Deadlines;
  ask: Money | null;
  listingUrl: string | null;
  portalUrl: string | null;
  stage: OutsideStage;
  questionCount: number;
  message: string | null;
  /** Present only when the person chose to include their current answers. */
  answers: { prompt: string; body: string }[] | null;
  answersTruncated: boolean;
}
export interface ConsultingSent {
  sentAt: string;
  to: string;
  replyTo: string;
}

export interface ExportFile {
  filename: string;
  blob: Blob;
}

/**
 * A Find funding item, as the API sends it. Published opportunities with no open competition (D10)
 * come back with `acceptingApplications: false`, `competitionId: null` and `eligibility: null`.
 */
export type DiscoverItem = DiscoverCompetition;
/** An item taking applications: it has a competition to start and this organization's eligibility. */
export type OpenDiscoverItem = DiscoverItem & { competitionId: string; eligibility: NonNullable<DiscoverItem["eligibility"]> };
/** Only an item with a competition and an eligibility result offers Start; anything else is "not taking applications yet". */
export const isAccepting = (d: DiscoverItem): d is OpenDiscoverItem => d.acceptingApplications !== false && !!d.competitionId && !!d.eligibility;

export interface OutsideApi {
  list(filter?: { stage?: OutsideStage; q?: string; archived?: boolean }): Promise<OutsideListItem[]>;
  /** With source "opengrants" and a sourceRef already in the workspace, answers that application instead of a duplicate. */
  create(input: OutsideCreateInput): Promise<OutsideApplication>;
  get(id: string): Promise<OutsideDetail>;
  update(id: string, patch: OutsidePatch): Promise<OutsideApplication>;
  move(id: string, to: OutsideStage): Promise<OutsideApplication>;
  /** Records a submission the person made on the funder's site. People only: an agent's call waits for approval. */
  submit(id: string, input: SubmitInput): Promise<OutsideApplication>;
  /** People only, like submit. */
  decide(id: string, input: DecisionInput): Promise<OutsideApplication>;
  reopen(id: string): Promise<OutsideApplication>;
  archive(id: string): Promise<OutsideApplication>;
  unarchive(id: string): Promise<OutsideApplication>;

  addQuestions(id: string, questions: QuestionInput[]): Promise<OutsideQuestion[]>;
  updateQuestion(questionId: string, patch: QuestionPatch): Promise<OutsideQuestion>;
  deleteQuestion(questionId: string): Promise<void>;
  /** Splits pasted text into proposed questions. Nothing is saved. */
  parseQuestions(id: string, text: string): Promise<ParsedQuestion[]>;
  /** Saves a new version. `libraryAnswerId` marks it as from the answer library. */
  putAnswer(questionId: string, input: { body: string; libraryAnswerId?: string }): Promise<SavedAnswer>;
  answerHistory(questionId: string): Promise<OutsideAnswer[]>;
  exportApplication(id: string, format: "txt" | "md" | "pdf"): Promise<ExportFile>;

  uploadDocument(id: string, input: AttachmentInput): Promise<AppDocument>;
  documentFile(id: string, documentId: string): Promise<ExportFile>;
  createTask(id: string, input: { title: string; dueAt?: string | null; assigneeUserId?: string | null }): Promise<Task>;

  pipeline(): Promise<PipelineItem[]>;

  funderRecords(): Promise<FunderRecord[]>;
  funderRecord(id: string): Promise<FunderRecord>;
  createFunderRecord(input: FunderRecordInput): Promise<FunderRecord>;
  updateFunderRecord(id: string, patch: Partial<FunderRecordInput>): Promise<FunderRecord>;
  deleteFunderRecord(id: string): Promise<void>;

  /** Creates the feed, or replaces it: the address is shown once and the old one stops working. */
  createCalendarFeed(): Promise<{ url: string }>;
  deleteCalendarFeed(): Promise<void>;

  importCsv(input: ImportInput): Promise<ImportResult>;
  exportAll(format: "csv" | "json"): Promise<ExportFile>;

  consultingPreview(id: string, input: ConsultingInput): Promise<ConsultingPreview>;
  /** People only. Rejects with 429 past the daily limits. */
  sendConsulting(id: string, input: ConsultingInput): Promise<ConsultingSent>;

  /** One OpenGrants listing. Rejects with 404 when the OpenGrants API has no single-listing endpoint. */
  openGrantsListing(listingId: string): Promise<OpenGrantsListing>;
}

// ------------------------------------------------------------------------------------ shaping

type Raw = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});

/** Money from `{amount, currency}`, or from minor units. */
export function moneyOf(value: unknown, minor: unknown, currency = "USD"): Money | null {
  const m = obj(value);
  if (typeof m.amount === "string" || typeof m.amount === "number") return { amount: String(m.amount), currency: str(m.currency) ?? currency };
  const n = num(minor);
  return n === null ? null : { amount: (n / 100).toFixed(2), currency };
}
export const minorOf = (m: Money | null | undefined): number | null => {
  if (!m) return null;
  const n = Number(m.amount);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

const ownerOf = (r: Raw): OwnerRef | null => {
  const o = obj(r.owner);
  if (str(o.userId)) return { userId: o.userId as string, name: str(o.name) };
  const id = str(r.owner) ?? str(r.ownerUserId);
  return id ? { userId: id, name: str(r.ownerName) } : null;
};

const yearsOf = (v: unknown): YearAmount[] =>
  Array.isArray(v)
    ? v.flatMap((x) => {
        const y = obj(x);
        const year = num(y.year);
        const minor = num(y.amountMinor) ?? minorOf(moneyOf(y.amount, null));
        return year !== null && minor !== null ? [{ year, amountMinor: minor }] : [];
      })
    : [];

const dateOf = (v: unknown): string | null => {
  const s = str(v);
  return s ? s.slice(0, 10) : null;
};

export function deadlinesOf(r: Raw): Deadlines {
  const d = { ...r, ...obj(r.deadlines) };
  return { loiDue: dateOf(d.loiDue), fullDue: dateOf(d.fullDue), internalDue: dateOf(d.internalDue), rolling: d.rolling === true };
}

export function toListItem(raw: unknown): OutsideListItem {
  const r = obj(raw);
  const counts = obj(r.questionCounts);
  return {
    id: String(r.id),
    title: str(r.title) ?? "Untitled application",
    funderName: str(r.funderName) ?? "",
    stage: (str(r.stage) ?? "drafting") as OutsideStage,
    deadlines: deadlinesOf(r),
    askAmount: moneyOf(r.askAmount, r.askAmountMinor, str(r.currency) ?? "USD"),
    owner: ownerOf(r),
    updatedAt: str(r.updatedAt) ?? "",
    questionCounts: { total: num(counts.total) ?? 0, approved: num(counts.approved) ?? 0 },
    source: (str(r.source) as OutsideSource | null) ?? null,
    sourceRef: str(r.sourceRef),
    archivedAt: str(r.archivedAt),
  };
}

export function toApplication(raw: unknown): OutsideApplication {
  const r = obj(raw);
  const d = deadlinesOf(r);
  const currency = str(r.currency) ?? "USD";
  const listing = r.listing && typeof r.listing === "object" ? (r.listing as ListingSnapshot) : null;
  const custom = obj(r.customFields);
  return {
    id: String(r.id),
    title: str(r.title) ?? "Untitled application",
    programName: str(r.programName),
    funderRecordId: str(r.funderRecordId),
    funderName: str(r.funderName) ?? "",
    source: (str(r.source) ?? "manual") as OutsideSource,
    sourceRef: str(r.sourceRef),
    listing,
    listingUrl: str(r.listingUrl),
    portalUrl: str(r.portalUrl),
    stage: (str(r.stage) ?? "drafting") as OutsideStage,
    previousStage: str(r.previousStage) as OutsideStage | null,
    currency,
    askAmount: moneyOf(r.askAmount, r.askAmountMinor, currency),
    askByYear: yearsOf(r.askByYear),
    ...d,
    submittedAt: str(r.submittedAt),
    submissionMethod: str(r.submissionMethod) as SubmissionMethod | null,
    confirmationRef: str(r.confirmationRef),
    receiptDocumentId: str(r.receiptDocumentId),
    snapshotDocumentId: str(r.snapshotDocumentId),
    snapshotSha256: str(r.snapshotSha256),
    decidedAt: str(r.decidedAt),
    awardedAmount: moneyOf(r.awardedAmount, r.awardedAmountMinor, currency),
    awardByYear: yearsOf(r.awardByYear),
    grantStart: dateOf(r.grantStart),
    grantEnd: dateOf(r.grantEnd),
    decisionNotes: str(r.decisionNotes),
    nextCycleOn: dateOf(r.nextCycleOn),
    owner: ownerOf(r),
    customFields: Object.fromEntries(Object.entries(custom).filter((e): e is [string, string | number | boolean | null] => e[1] === null || ["string", "number", "boolean"].includes(typeof e[1]))),
    archivedAt: str(r.archivedAt),
    createdAt: str(r.createdAt) ?? "",
    updatedAt: str(r.updatedAt) ?? "",
  };
}

export function toAnswer(raw: unknown): OutsideAnswer {
  const r = obj(raw);
  return {
    id: String(r.id),
    questionId: String(r.questionId ?? ""),
    version: num(r.version) ?? 1,
    body: typeof r.body === "string" ? r.body : "",
    provenance: str(r.provenance) ?? "user",
    libraryAnswerId: str(r.libraryAnswerId),
    createdBy: str(r.createdBy),
    createdAt: str(r.createdAt) ?? "",
  };
}

export function toQuestion(raw: unknown, answers: Map<string, OutsideAnswer> = new Map()): OutsideQuestion {
  const r = obj(raw);
  const id = String(r.id);
  const inline = r.answer ?? r.latestAnswer ?? r.currentAnswer;
  return {
    id,
    phase: (str(r.phase) ?? "full") as QuestionPhase,
    section: str(r.section),
    position: num(r.position) ?? 0,
    prompt: str(r.prompt) ?? "",
    guidance: str(r.guidance),
    limitKind: str(r.limitKind) as LimitKind | null,
    limitValue: num(r.limitValue),
    required: r.required === true,
    assigneeUserId: str(r.assigneeUserId),
    status: (str(r.status) ?? "empty") as QuestionStatus,
    answer: inline && typeof inline === "object" ? toAnswer({ questionId: id, ...(inline as Raw) }) : (answers.get(id) ?? null),
  };
}

export function toDetail(raw: unknown): OutsideDetail {
  const r = obj(raw);
  // Either the record at the top level, or `{ application, questions, answers, documents, tasks }`.
  const record = r.application && typeof r.application === "object" ? { ...(r.application as Raw) } : r;
  const answers = new Map<string, OutsideAnswer>();
  if (Array.isArray(r.answers)) for (const a of r.answers.map(toAnswer)) if (!answers.has(a.questionId) || answers.get(a.questionId)!.version < a.version) answers.set(a.questionId, a);
  const questions = (Array.isArray(r.questions) ? r.questions : []).map((q) => toQuestion(q, answers)).sort((a, b) => a.position - b.position);
  return {
    ...toApplication(record),
    questions,
    documents: (Array.isArray(r.documents) ? r.documents : []) as AppDocument[],
    tasks: (Array.isArray(r.tasks) ? r.tasks : []) as Task[],
    ...(Array.isArray(r.activity) ? { activity: r.activity as OutsideEvent[] } : {}),
  };
}

export function toFunderRecord(raw: unknown): FunderRecord {
  const r = obj(raw);
  return {
    id: String(r.id),
    name: str(r.name) ?? "",
    website: str(r.website),
    notes: str(r.notes),
    contacts: Array.isArray(r.contacts) ? (r.contacts as FunderContact[]) : [],
    portalUrl: str(r.portalUrl),
    portalLoginHolder: str(r.portalLoginHolder),
    createdAt: str(r.createdAt) ?? "",
    updatedAt: str(r.updatedAt) ?? "",
    applications: (Array.isArray(r.applications) ? r.applications : []).map((a) => {
      const x = obj(a);
      return {
        kind: x.kind === "gms_application" ? "gms_application" : "outside_application",
        id: String(x.id),
        title: str(x.title) ?? "",
        stage: str(x.stage) as OutsideStage | null,
        status: str(x.status),
        askAmount: moneyOf(x.askAmount, x.askAmountMinor),
        awardedAmount: moneyOf(x.awardedAmount, x.awardedAmountMinor),
        submittedAt: str(x.submittedAt),
        decidedAt: str(x.decidedAt),
        nameMatch: x.nameMatch === true || x.match === "name",
      } satisfies FunderRecordApplication;
    }),
  };
}

// ------------------------------------------------------------------------------------ HTTP

export interface HttpOutsideOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  /** The applicant workspace the calls act in (sent as `X-GMS-Workspace` with a session bearer). */
  workspaceId: () => string | null;
  fetch?: typeof fetch;
}

export function createHttpOutsideApi(opts: HttpOutsideOptions): OutsideApi {
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
    return json.items ?? (Array.isArray(json.data) ? json.data : []);
  }
  async function file(path: string, fallback: string): Promise<ExportFile> {
    const res = await send("GET", path);
    const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get("Content-Disposition") ?? "")?.[1];
    return { filename: named ? decodeURIComponent(named) : fallback, blob: await res.blob() };
  }
  const e = encodeURIComponent;
  const oa = (id: string) => `/gms/outside-applications/${e(id)}`;
  const oq = (id: string) => `/gms/outside-questions/${e(id)}`;
  const qs = (params: Record<string, string | undefined>) => {
    const pairs = Object.entries(params).filter((x): x is [string, string] => x[1] !== undefined);
    return pairs.length ? `?${pairs.map(([k, v]) => `${k}=${e(v)}`).join("&")}` : "";
  };

  return {
    list: async (filter = {}) => (await list(`/gms/outside-applications${qs({ stage: filter.stage, q: filter.q || undefined, archived: filter.archived === undefined ? undefined : String(filter.archived) })}`)).map(toListItem),
    create: async (input) => toApplication(await call("POST", "/gms/outside-applications", input)),
    get: async (id) => toDetail(await call("GET", oa(id))),
    update: async (id, patch) => toApplication(await call("PATCH", oa(id), patch)),
    move: async (id, to) => toApplication(await call("POST", `${oa(id)}/stage`, { to })),
    submit: async (id, input) => toApplication(await call("POST", `${oa(id)}/submit`, input)),
    decide: async (id, input) => toApplication(await call("POST", `${oa(id)}/decision`, input)),
    reopen: async (id) => toApplication(await call("POST", `${oa(id)}/reopen`, {})),
    archive: async (id) => toApplication(await call("POST", `${oa(id)}/archive`, {})),
    unarchive: async (id) => toApplication(await call("POST", `${oa(id)}/unarchive`, {})),

    addQuestions: async (id, questions) => {
      const data = await call<unknown>("POST", `${oa(id)}/questions`, { questions });
      const rows = Array.isArray(data) ? data : (obj(data).questions as unknown[] | undefined) ?? [];
      return rows.map((q) => toQuestion(q));
    },
    updateQuestion: async (qid, patch) => toQuestion(await call("PATCH", oq(qid), patch)),
    deleteQuestion: async (qid) => void (await call("DELETE", oq(qid))),
    parseQuestions: async (id, text) => {
      const data = obj(await call("POST", `${oa(id)}/questions/parse`, { text }));
      return (Array.isArray(data.questions) ? data.questions : []) as ParsedQuestion[];
    },
    putAnswer: async (qid, input) => {
      const data = obj(await call("PUT", `${oq(qid)}/answer`, input));
      // Either the version with counts beside it, or `{ answer, counts, overLimit }`.
      const answer = toAnswer({ questionId: qid, ...(data.answer && typeof data.answer === "object" ? (data.answer as Raw) : data) });
      const c = obj(data.counts);
      return { ...answer, counts: { words: num(c.words) ?? 0, chars: num(c.chars) ?? 0, charsNoSpaces: num(c.charsNoSpaces) ?? 0 }, overLimit: data.overLimit === true };
    },
    answerHistory: async (qid) => (await list(`${oq(qid)}/answers`)).map((a) => toAnswer({ questionId: qid, ...obj(a) })).sort((a, b) => b.version - a.version),
    exportApplication: (id, format) => file(`${oa(id)}/export?format=${format}`, `application.${format}`),

    uploadDocument: (id, input) => call("POST", `${oa(id)}/documents`, input),
    documentFile: (id, documentId) => file(`${oa(id)}/documents/${e(documentId)}/file`, "document"),
    createTask: (id, input) => call("POST", "/gms/tasks", { title: input.title, subjectType: "outside_application", subjectId: id, ...(input.dueAt ? { dueAt: input.dueAt } : {}), ...(input.assigneeUserId ? { assigneeUserId: input.assigneeUserId } : {}) }),

    pipeline: async () => (await list("/gms/pipeline")) as PipelineItem[],

    funderRecords: async () => (await list("/gms/funder-records")).map(toFunderRecord),
    funderRecord: async (id) => toFunderRecord(await call("GET", `/gms/funder-records/${e(id)}`)),
    createFunderRecord: async (input) => toFunderRecord(await call("POST", "/gms/funder-records", input)),
    updateFunderRecord: async (id, patch) => toFunderRecord(await call("PATCH", `/gms/funder-records/${e(id)}`, patch)),
    deleteFunderRecord: async (id) => void (await call("DELETE", `/gms/funder-records/${e(id)}`)),

    createCalendarFeed: () => call("POST", "/gms/calendar-feed", {}),
    deleteCalendarFeed: async () => void (await call("DELETE", "/gms/calendar-feed")),

    importCsv: async (input) => {
      const data = obj(await call("POST", "/gms/outside-applications/import", input));
      return { dryRun: data.dryRun !== false, rows: (Array.isArray(data.rows) ? data.rows : []) as ImportRow[], created: (Array.isArray(data.created) ? data.created : []).map(toListItem) };
    },
    exportAll: (format) => file(`/gms/outside-applications/export.${format}`, `applications.${format}`),

    consultingPreview: (id, input) => call("POST", `${oa(id)}/consulting-request/preview`, input),
    sendConsulting: (id, input) => call("POST", `${oa(id)}/consulting-request`, input),

    openGrantsListing: (listingId) => call("GET", `/gms/discover/opengrants/${e(listingId)}`),
  };
}
