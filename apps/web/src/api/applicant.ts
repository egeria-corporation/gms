// SPDX-License-Identifier: AGPL-3.0-only
// The applicant workspace's API port: Passport record and readiness, applications (the
// CommonGrants apply routes plus the GMS extras), discovery, answers, awards and consents.
// `createHttpApplicantApi` calls the GMS Worker; `createMockApplicantApi` (mocks/applicant.ts)
// implements the same interface in the browser. test/applicant-contract.test.tsx holds both to
// the same assertions.
import type { FormDefinition, JsonObject, ValidationError } from "@gms/forms";
import { ApiError } from "./client.ts";
import type { components } from "./schema.d.ts";

type S = components["schemas"];

export type MyOrganization = S["Models.MyOrganization"];
export type ApplicantReadiness = S["Models.ApplicantReadiness"];
export type ReadinessCheck = S["Models.ReadinessCheck"];
export type ConsentStart = S["Models.ConsentStart"];
export type Consent = S["Models.Consent"];
export type MyFunder = S["Models.MyFunder"];
export type MyApplication = S["Models.MyApplication"];
export type ApplicationStatus = S["Models.ApplicationStatus"];
export type ApplicationStatusView = S["Models.ApplicationStatusView"];
export type ApplicationEvent = S["Models.ApplicationEvent"];
export type EligibilityResult = S["Models.EligibilityResult"];
export type Comment = S["Models.Comment"];
export type AppDocument = S["Models.Document"];
export type Answer = S["Models.Answer"];
export type DiscoverCompetition = S["Models.DiscoverCompetition"];
export type SavedListing = S["Models.SavedListing"];
export type Thread = S["Models.Thread"];
export type Message = S["Models.Message"];
export type Task = S["Models.Task"];
export type Award = S["Models.GmsAward"];
export type AwardDetail = S["Models.GmsAwardDetail"];
export type Agreement = S["Models.Agreement"];
export type Approval = S["Models.Approval"];
export type ApplicantMember = S["Models.Member"];

export interface ApplicantInvitation {
  id: string;
  email: string;
  role: string;
  expiresAt: string | null;
}

export type FormResponseStatus = "notStarted" | "inProgress" | "complete";

/** One form of an application: the pinned definition version, the answers and where each came from. */
export interface AppForm {
  /** Bare form UUID, as the CommonGrants routes use. */
  formId: string;
  version: number;
  response: JsonObject;
  status: FormResponseStatus;
  validationErrors: ValidationError[];
  /** JSON pointer → `passport` | `library` | `user` | `agent:<client>` … */
  provenance: Record<string, string>;
  /** Set when the form belongs to an earlier stage and is read-only. */
  lockedAt: string | null;
  lastModifiedAt: string;
}

/** An application as the editor needs it: the CommonGrants record with the GMS workflow state unpacked. */
export interface Application {
  /** Prefixed id (`app_<uuid>`), as `/gms` routes and URLs use. */
  id: string;
  uuid: string;
  title: string;
  competitionId: string;
  opportunityId: string;
  status: ApplicationStatus;
  stage: string;
  submittedAt: string | null;
  eligibility: (EligibilityResult & { preview?: boolean }) | null;
  verificationLevel: string | null;
  forms: AppForm[];
}

/** A form save: the merged response, plus the Passport-owned paths the server refused to change. */
export type SavedForm = AppForm & { rejected: string[] };

export type AttachmentInput =
  | { name: string; mime: string; contentBase64: string }
  | { name: string; mime: string; passportDocumentId: string; size: number; sha256: string };

export interface OpenGrantsListing {
  id: string;
  title: string;
  funder?: string;
  summary?: string;
  amount?: string;
  deadline?: string;
  url?: string;
  source?: string;
  /** Set when the listing points at an opportunity on this GMS. */
  gms: { opportunityId: string; competitionId: string | null } | null;
  [key: string]: unknown;
}

export type OpenGrantsTool = "search" | "match" | "eligibility" | "alerts";

export interface ApplicantApi {
  // ---- Passport record ----
  organization(): Promise<MyOrganization>;
  refreshOrganization(): Promise<MyOrganization>;
  readiness(): Promise<ApplicantReadiness>;
  /** Where to send the browser to consent in Passport. `workspaceId` re-links an existing workspace. */
  startConsent(input?: { workspaceId?: string; returnTo?: string }): Promise<ConsentStart>;
  consents(): Promise<Consent[]>;
  revokeConsent(id: string): Promise<{ revoked: boolean }>;
  funders(): Promise<MyFunder[]>;
  members(): Promise<ApplicantMember[]>;
  /** Invites a teammate, or a consultant whose access ends after `expiresInDays`. */
  invite(input: { email: string; role: string; expiresInDays?: number; expiresAt?: string | null }): Promise<ApplicantInvitation>;

  // ---- applications ----
  applications(): Promise<MyApplication[]>;
  applicationStatus(id: string): Promise<ApplicationStatusView>;
  startApplication(competitionId: string): Promise<Application>;
  application(id: string): Promise<Application>;
  /** The pinned version of a form an application answers. */
  form(formId: string, version: number): Promise<FormDefinition>;
  /** Sends only the changed paths; the server merges them into the stored response. */
  saveForm(applicationId: string, formId: string, patch: JsonObject): Promise<SavedForm>;
  /** Rejects with a 422 ApiError listing `{ field, detail }` when the application is not ready. */
  submit(applicationId: string): Promise<Application>;
  withdraw(applicationId: string): Promise<{ id: string; status: ApplicationStatus }>;
  comments(applicationId: string): Promise<Comment[]>;
  addComment(applicationId: string, input: { body: string; formId?: string; fieldPath?: string }): Promise<Comment>;
  resolveComment(applicationId: string, commentId: string): Promise<Comment>;
  /** Section label → the teammate who owns it, for one form of an application. */
  sections(applicationId: string, formId: string): Promise<{ formId: string; sections: Record<string, string> }>;
  assignSections(applicationId: string, formId: string, sections: Record<string, string | null>): Promise<{ formId: string; sections: Record<string, string> }>;
  attachments(applicationId: string): Promise<AppDocument[]>;
  attach(applicationId: string, input: AttachmentInput): Promise<AppDocument>;
  threads(applicationId: string): Promise<Thread[]>;
  openThread(applicationId: string): Promise<Thread>;
  postMessage(threadId: string, body: string): Promise<Message>;
  tasks(): Promise<Task[]>;
  updateTask(id: string, patch: { done?: boolean }): Promise<Task>;

  // ---- answer library ----
  answers(): Promise<Answer[]>;
  createAnswer(input: { title: string; body: string }): Promise<Answer>;
  updateAnswer(id: string, patch: { title?: string; body?: string }): Promise<Answer>;

  // ---- discovery ----
  discover(): Promise<DiscoverCompetition[]>;
  saved(): Promise<SavedListing[]>;
  save(input: { source: "gms" | "opengrants"; externalId: string; title: string; url?: string }): Promise<SavedListing>;
  /** Rejects with a 503 ApiError when OpenGrants is not configured or cannot be reached. */
  openGrants(tool: OpenGrantsTool, args: Record<string, unknown>): Promise<{ results: OpenGrantsListing[]; cached: boolean }>;

  // ---- awards ----
  awards(): Promise<Award[]>;
  award(id: string): Promise<AwardDetail>;
  acceptAward(id: string): Promise<AwardDetail>;
  agreement(id: string): Promise<Agreement>;
  /** Signing is for people: the server answers 403 `human_only` to any agent or client token. */
  signAgreement(id: string, input: { name: string; attest: true; documentSha256?: string }): Promise<Agreement>;

  // ---- agent approvals ----
  approvals(status?: Approval["status"]): Promise<Approval[]>;
  decideApproval(id: string, approve: boolean, note?: string): Promise<Approval>;
}

// ------------------------------------------------------------------------------------ shaping

const bare = (id: string) => id.replace(/^[a-z]{3}_/, "");

interface CustomField {
  value?: unknown;
}
interface CgFormResponse {
  formId: string;
  response?: JsonObject;
  status?: { value?: string } | string;
  validationErrors?: unknown[];
  customFields?: Record<string, CustomField>;
  lastModifiedAt?: string;
}
interface CgApplication {
  id: string;
  title: string;
  competitionId: string;
  opportunityId: string;
  submittedAt?: string | null;
  formResponses?: Record<string, CgFormResponse>;
  customFields?: Record<string, CustomField>;
}

const asErrors = (list: unknown[] | undefined): ValidationError[] =>
  (list ?? []).flatMap((e) => {
    if (!e || typeof e !== "object") return [];
    const x = e as { field?: unknown; message?: unknown; type?: unknown };
    return [{ field: typeof x.field === "string" ? x.field : "", message: typeof x.message === "string" ? x.message : "Check this answer", type: typeof x.type === "string" ? x.type : "invalid" }];
  });

/** Unpacks a CommonGrants `AppFormResponse` (provenance and version ride in `customFields.gms`). */
export function toAppForm(r: CgFormResponse): SavedForm {
  const gms = (r.customFields?.gms?.value ?? {}) as { formVersion?: number; provenance?: Record<string, string>; lockedAt?: string };
  const status = typeof r.status === "string" ? r.status : r.status?.value;
  const rejected = r.customFields?.gmsRejected?.value;
  return {
    formId: r.formId,
    version: gms.formVersion ?? 1,
    response: r.response ?? {},
    status: status === "complete" || status === "inProgress" ? status : "notStarted",
    validationErrors: asErrors(r.validationErrors),
    provenance: gms.provenance ?? {},
    lockedAt: gms.lockedAt ?? null,
    lastModifiedAt: r.lastModifiedAt ?? "",
    rejected: Array.isArray(rejected) ? rejected.filter((p): p is string => typeof p === "string") : [],
  };
}

/** Unpacks a CommonGrants `ApplicationBase` (workflow state rides in `customFields.gms`). */
export function toApplication(a: CgApplication): Application {
  const gms = (a.customFields?.gms?.value ?? {}) as { id?: string; status?: ApplicationStatus; stage?: string; eligibility?: Application["eligibility"] };
  const level = a.customFields?.verificationLevel?.value;
  return {
    id: gms.id ?? `app_${a.id}`,
    uuid: a.id,
    title: a.title,
    competitionId: a.competitionId,
    opportunityId: a.opportunityId,
    status: gms.status ?? "draft",
    stage: gms.stage ?? "application",
    submittedAt: a.submittedAt ?? null,
    eligibility: gms.eligibility && typeof gms.eligibility === "object" && "eligible" in gms.eligibility ? gms.eligibility : null,
    verificationLevel: typeof level === "string" ? level : null,
    forms: Object.values(a.formResponses ?? {}).map(toAppForm),
  };
}

interface CgForm {
  id: string;
  title: string;
  description?: string;
  jsonSchema?: FormDefinition["jsonSchema"];
  uiSchema?: FormDefinition["uiSchema"];
  mappingFromCommonGrants?: FormDefinition["mappingFromCommonGrants"];
  mappingToCommonGrants?: FormDefinition["mappingToCommonGrants"];
  customFields?: Record<string, CustomField>;
}

export function toFormDefinition(f: CgForm, version: number): FormDefinition {
  const gms = (f.customFields?.gms?.value ?? {}) as { version?: number; fieldMeta?: FormDefinition["fieldMeta"] };
  return {
    id: f.id,
    version: gms.version ?? version,
    title: f.title,
    ...(f.description ? { description: f.description } : {}),
    jsonSchema: f.jsonSchema ?? { type: "object", properties: {} },
    uiSchema: f.uiSchema ?? { type: "VerticalLayout", elements: [] },
    ...(f.mappingFromCommonGrants ? { mappingFromCommonGrants: f.mappingFromCommonGrants } : {}),
    ...(f.mappingToCommonGrants ? { mappingToCommonGrants: f.mappingToCommonGrants } : {}),
    ...(gms.fieldMeta ? { fieldMeta: gms.fieldMeta } : {}),
  };
}

/**
 * The paths whose value differs between two responses, as a patch the server can merge: changed
 * leaves keep their place in the object, unchanged siblings are left out, arrays are sent whole.
 */
export function changedPaths(before: JsonObject, after: JsonObject): JsonObject | null {
  const out: JsonObject = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const plain = (v: unknown): v is JsonObject => !!v && typeof v === "object" && !Array.isArray(v);
    if (plain(a) && plain(b)) {
      const inner = changedPaths(a, b);
      if (inner) out[k] = inner;
    } else {
      // A cleared answer is sent as null so the merge removes it.
      out[k] = b === undefined ? null : b;
    }
  }
  return Object.keys(out).length ? out : null;
}

// ------------------------------------------------------------------------------------ HTTP

export interface HttpApplicantOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  /** The applicant workspace the calls act in (sent as `X-GMS-Workspace` with a session bearer). */
  workspaceId: () => string | null;
  fetch?: typeof fetch;
}

export function createHttpApplicantApi(opts: HttpApplicantOptions): ApplicantApi {
  async function call<T>(method: string, path: string, body?: unknown, list = false): Promise<T> {
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
    const json = (await res.json().catch(() => ({}))) as { data?: T; items?: unknown[]; message?: string; errors?: unknown[] };
    if (!res.ok) throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, json.errors ?? []);
    return list ? ((json.items ?? json.data ?? []) as T) : (json.data as T);
  }
  const get = <T>(path: string) => call<T>("GET", path);
  const all = <T>(path: string) => call<T[]>("GET", path, undefined, true);
  const e = encodeURIComponent;
  const cg = (id: string) => `/common-grants/applications/${e(bare(id))}`;
  const my = (id: string) => `/gms/my/applications/${e(id)}`;

  return {
    organization: () => get("/gms/me/organization"),
    refreshOrganization: () => call("POST", "/gms/me/organization/refresh", {}),
    readiness: () => get("/gms/me/readiness"),
    startConsent: (input = {}) => call("POST", "/gms/passport/consent/start", input),
    consents: () => get("/gms/my/consents"),
    revokeConsent: (id) => call("DELETE", `/gms/my/consents/${e(id)}`),
    funders: () => get("/gms/my/funders"),
    members: async () => {
      const id = opts.workspaceId();
      return id ? call<ApplicantMember[]>("GET", `/gms/workspaces/${e(id)}/members`, undefined, true) : [];
    },
    invite: async ({ email, role, expiresInDays }) => {
      const id = opts.workspaceId();
      if (!id) throw new ApiError(400, "Open a workspace first");
      return call("POST", `/gms/workspaces/${e(id)}/invitations`, { email, role, ...(expiresInDays ? { expiresInDays } : {}) });
    },

    applications: () => get("/gms/my/applications"),
    applicationStatus: (id) => get(`${my(id)}/status`),
    startApplication: async (competitionId) => toApplication(await call<CgApplication>("POST", "/common-grants/applications/start", { competitionId: bare(competitionId) })),
    application: async (id) => toApplication(await get<CgApplication>(cg(id))),
    form: async (formId, version) => toFormDefinition(await get<CgForm>(`/common-grants/forms/${e(bare(formId))}?version=${version}`), version),
    saveForm: async (id, formId, patch) => toAppForm(await call<CgFormResponse>("PUT", `${cg(id)}/forms/${e(bare(formId))}`, { response: patch })),
    submit: async (id) => toApplication(await call<CgApplication>("PUT", `${cg(id)}/submit`, {})),
    withdraw: (id) => call("POST", `${my(id)}/withdraw`, {}),
    comments: (id) => get(`${my(id)}/comments`),
    addComment: (id, input) => call("POST", `${my(id)}/comments`, input),
    resolveComment: (id, commentId) => call("POST", `${my(id)}/comments/${e(commentId)}/resolve`, {}),
    // The Worker has no route that reads section assignments back yet; they are known only after a write.
    sections: async (_id, formId) => ({ formId, sections: {} }),
    assignSections: (id, formId, sections) => call("POST", `${my(id)}/sections/assign`, { formId, sections }),
    attachments: (id) => get(`${my(id)}/attachments`),
    attach: (id, input) => call("POST", `${my(id)}/attachments`, input),
    threads: (id) => get(`/gms/threads?subjectType=application&subjectId=${e(id)}`),
    openThread: (id) => call("POST", "/gms/threads", { subjectType: "application", subjectId: id, visibility: "shared" }),
    postMessage: (threadId, body) => call("POST", `/gms/threads/${e(threadId)}/messages`, { body }),
    tasks: () => get("/gms/tasks?open=true"),
    updateTask: (id, patch) => call("PATCH", `/gms/tasks/${e(id)}`, patch),

    answers: () => get("/gms/my/answers"),
    createAnswer: (input) => call("POST", "/gms/my/answers", input),
    updateAnswer: (id, patch) => call("PATCH", `/gms/my/answers/${e(id)}`, patch),

    discover: () => get("/gms/discover/competitions"),
    saved: () => get("/gms/discover/saved"),
    save: (input) => call("POST", "/gms/discover/saved", input),
    openGrants: (tool, args) => call("POST", `/gms/discover/opengrants/${tool}`, args),

    awards: () => all("/gms/my/awards?pageSize=100"),
    award: (id) => get(`/gms/my/awards/${e(id)}`),
    acceptAward: (id) => call("POST", `/gms/my/awards/${e(id)}/accept`, {}),
    agreement: (id) => get(`/gms/agreements/${e(id)}`),
    signAgreement: (id, input) => call("POST", `/gms/agreements/${e(id)}/sign`, input),

    approvals: (status) => all(`/gms/approvals?pageSize=100${status ? `&status=${status}` : ""}`),
    decideApproval: (id, approve, note) => call("POST", `/gms/approvals/${e(id)}/decision`, { approve, ...(note ? { note } : {}) }),
  };
}
