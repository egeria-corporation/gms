// SPDX-License-Identifier: AGPL-3.0-only
// The funder's working routes: the applications inbox, reviews, the panel, awards and agreements,
// templates, approvals and the OAuth consent screen. Shapes come from the generated schema; the
// HTTP implementation here and the mock in mocks/funder.ts answer the same interface, and
// test/funder-contract.test.ts holds both to the real Worker.
import type { components } from "./schema.d.ts";

type S = components["schemas"];
export type InboxApplication = S["Models.GmsApplication"];
export type InboxFormResponse = S["Models.InboxFormResponse"];
export type ApplicationEvent = S["Models.ApplicationEvent"];
export type ApplicationActionResult = S["Models.ApplicationActionResult"];
export type EligibilityResult = S["Models.EligibilityResult"];
export type BulkResult = S["Models.BulkResult"];
export type ReviewAssignment = S["Models.ReviewAssignment"];
export type ReviewAssignmentDetail = S["Models.ReviewAssignmentDetail"];
export type ReviewAssignmentPatch = S["Models.ReviewAssignmentPatch"];
export type AutoAssignResult = S["Models.AutoAssignResult"];
export type ReviewerInvitation = S["Models.ReviewerInvitation"];
export type Review = S["Models.Review"];
export type Ranking = S["Models.Ranking"];
export type RankingRow = S["Models.RankingRow"];
export type Allocation = S["Models.Allocation"];
export type Decision = S["Models.Decision"];
export type DecisionInput = S["Models.DecisionInput"];
export type DecisionOutcome = S["Models.DecisionOutcome"];
export type ProposeResult = S["Models.ProposeDecisionsResult"];
export type CommitResult = S["Models.CommitDecisionsResult"];
export type AwardSummary = S["Models.GmsAward"];
export type AwardDetail = S["Models.GmsAwardDetail"];
export type Amendment = S["Models.Amendment"];
export type Agreement = S["Models.Agreement"];
export type SentAgreement = S["Models.SentAgreement"];
export type ExecutedAgreement = S["Models.ExecutedAgreement"];
export type Template = S["Models.Template"];
export type TemplateInput = S["Models.TemplateInput"];
export type TemplateList = S["Models.TemplateList"];
export type Rendered = S["Models.Rendered"];
export type SendResult = S["Models.SendResult"];
export type SentCommunication = S["Models.SentCommunication"];
export type Approval = S["Models.Approval"];
export type Thread = S["Models.Thread"];
export type Task = S["Models.Task"];

export interface ApplicationFilter {
  competitionId?: string;
  stage?: string;
  status?: string;
  /** `true`, `false` or `unknown`. */
  eligibility?: string;
  level?: string;
  tag?: string;
  /** A member's user id, or `unassigned`. */
  assignee?: string;
  q?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}
export interface ApplicationPage {
  items: InboxApplication[];
  total: number;
  /** Applications per status, across the whole filter (not only this page). */
  counts: Record<string, number>;
}

/** What the consent screen shows for a pending authorization request. */
export interface ConsentRequest {
  client: { id: string; name: string; dynamicallyRegistered: boolean; redirectHost: string };
  scopes: { scope: string; description: string }[];
  gatedActions: string[];
  workspaces: { id: string; name: string; kind: "funder" | "applicant"; role: string; grantableScopes: string[]; requiresMfa: boolean }[];
}

export interface FunderApi {
  // ---- applications inbox ----
  listApplications(filter?: ApplicationFilter): Promise<ApplicationPage>;
  getApplication(id: string): Promise<InboxApplication>;
  advanceApplication(id: string, input: { toStage: string; note?: string }): Promise<ApplicationActionResult>;
  requestRevision(id: string, input: { message: string; fields?: Record<string, string[]>; dueAt?: string }): Promise<ApplicationActionResult>;
  declineApplication(id: string, input: { rationale?: string; letterTemplateId?: string; sendLetter?: boolean }): Promise<ApplicationActionResult>;
  tagApplication(id: string, input: { add?: string[]; remove?: string[] }): Promise<ApplicationActionResult>;
  assignApplication(id: string, userId: string | null): Promise<ApplicationActionResult>;
  bulkApplications(input: { applicationIds: string[]; action: "advance" | "decline" | "tag" | "assign"; params?: Record<string, unknown> }): Promise<BulkResult>;
  rerunEligibility(id: string): Promise<EligibilityResult>;

  // ---- messages and tasks ----
  listThreads(applicationId: string): Promise<Thread[]>;
  openThread(applicationId: string, visibility: "shared" | "internal"): Promise<Thread>;
  postMessage(threadId: string, body: string): Promise<{ id: string }>;
  listTasks(filter?: { open?: boolean; mine?: boolean }): Promise<Task[]>;
  updateTask(id: string, patch: { done?: boolean; title?: string }): Promise<Task>;

  // ---- reviews ----
  listAssignments(filter?: { competitionId?: string; applicationId?: string; reviewerUserId?: string; stage?: string; status?: string }): Promise<ReviewAssignment[]>;
  createAssignment(input: { applicationId: string; reviewerUserId: string; stage?: string; dueAt?: string }): Promise<ReviewAssignment>;
  autoAssign(input: { competitionId: string; stage?: string; reviewersPerApplication: number; reviewers?: { userId: string; capacity?: number }[]; dryRun?: boolean }): Promise<AutoAssignResult>;
  inviteReviewer(input: { email: string; competitionId: string }): Promise<ReviewerInvitation>;
  getAssignment(id: string): Promise<ReviewAssignmentDetail>;
  updateAssignment(id: string, patch: ReviewAssignmentPatch): Promise<ReviewAssignment>;
  listReviews(applicationId: string, stage?: string): Promise<Review[]>;
  getRanking(competitionId: string, stage?: string): Promise<Ranking>;

  // ---- decisions ----
  getAllocation(competitionId: string): Promise<Allocation>;
  listDecisions(filter?: { competitionId?: string; applicationId?: string; committed?: boolean }): Promise<Decision[]>;
  proposeDecisions(competitionId: string, decisions: DecisionInput[]): Promise<ProposeResult>;
  commitDecisions(input: { competitionId: string; decisionIds: string[]; override?: { reason: string } }): Promise<CommitResult>;

  // ---- awards and agreements ----
  listAwards(filter?: { status?: string }): Promise<AwardSummary[]>;
  getAward(id: string): Promise<AwardDetail>;
  decideAmendment(id: string, input: { status: "approved" | "declined"; note?: string }): Promise<Amendment>;
  createAgreement(awardId: string, input?: { templateId?: string }): Promise<Agreement>;
  getAgreement(id: string): Promise<Agreement>;
  sendAgreement(id: string): Promise<SentAgreement>;
  countersignAgreement(id: string, input: { name: string; attest: true; documentSha256?: string }): Promise<ExecutedAgreement>;
  /** The agreement as a PDF: the sent document, or the executed one once both parties have signed. */
  agreementPdf(id: string): Promise<Blob>;

  // ---- templates and communications ----
  listTemplates(kind?: string): Promise<TemplateList>;
  createTemplate(input: TemplateInput): Promise<Template>;
  renderTemplate(id: string, input?: { applicationId?: string; awardId?: string; fields?: Record<string, unknown> }): Promise<Rendered>;
  listCommunications(): Promise<SentCommunication[]>;

  // ---- approvals (human gates for agent actions) ----
  listApprovals(status?: string): Promise<Approval[]>;
  decideApproval(id: string, input: { approve: boolean; note?: string }): Promise<Approval>;

  // ---- OAuth consent for an MCP client ----
  consentRequest(req: string): Promise<ConsentRequest>;
  decideConsent(input: { req: string; workspaceId: string; approve: boolean; scopes?: string[] }): Promise<{ redirectTo: string }>;
}

/** Thrown by both implementations; client.ts re-exports the class it uses so `instanceof` holds. */
export interface FunderHttpIo {
  baseUrl: string;
  fetch?: typeof fetch;
  token: () => Promise<string | null>;
  workspaceId: () => string | null;
  /** Builds the error to throw for a non-2xx answer. */
  fail: (status: number, message: string, errors: unknown[]) => Error;
}

type Json = { data?: unknown; items?: unknown[]; counts?: Record<string, number>; paginationInfo?: { totalItems?: number }; message?: string; errors?: unknown[] };

export function createHttpFunderApi(io: FunderHttpIo): FunderApi {
  const e = encodeURIComponent;
  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    const token = await io.token();
    const ws = io.workspaceId();
    const res = await (io.fetch ?? fetch)(`${io.baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(ws ? { "X-GMS-Workspace": ws } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as Json;
      throw io.fail(res.status, j.message ?? `Request failed (${res.status})`, j.errors ?? []);
    }
    return res;
  }
  const raw = async (method: string, path: string, body?: unknown) => (await (await send(method, path, body)).json()) as Json;
  const data = async <T>(method: string, path: string, body?: unknown) => (await raw(method, path, body)).data as T;
  const items = async <T>(path: string) => ((await raw("GET", path)).items ?? []) as T[];
  const q = (params: object) => {
    const pairs = Object.entries(params).filter((p): p is [string, string | number | boolean] => p[1] !== undefined && p[1] !== "");
    return pairs.length ? `?${pairs.map(([k, v]) => `${k}=${e(v)}`).join("&")}` : "";
  };

  return {
    async listApplications(filter = {}) {
      const j = await raw("GET", `/gms/applications${q(filter)}`);
      return { items: (j.items ?? []) as InboxApplication[], total: j.paginationInfo?.totalItems ?? j.items?.length ?? 0, counts: j.counts ?? {} };
    },
    getApplication: (id) => data("GET", `/gms/applications/${e(id)}`),
    advanceApplication: (id, input) => data("POST", `/gms/applications/${e(id)}/advance`, input),
    requestRevision: (id, input) => data("POST", `/gms/applications/${e(id)}/request-revision`, input),
    declineApplication: (id, input) => data("POST", `/gms/applications/${e(id)}/decline`, input),
    tagApplication: (id, input) => data("POST", `/gms/applications/${e(id)}/tags`, input),
    assignApplication: (id, userId) => data("POST", `/gms/applications/${e(id)}/assign`, { userId }),
    bulkApplications: (input) => data("POST", "/gms/applications/bulk", input),
    rerunEligibility: (id) => data("POST", `/gms/applications/${e(id)}/eligibility`, {}),

    listThreads: (applicationId) => data("GET", `/gms/threads${q({ subjectType: "application", subjectId: applicationId })}`),
    openThread: (applicationId, visibility) => data("POST", "/gms/threads", { subjectType: "application", subjectId: applicationId, visibility }),
    postMessage: (threadId, body) => data("POST", `/gms/threads/${e(threadId)}/messages`, { body }),
    listTasks: (filter = {}) => data("GET", `/gms/tasks${q(filter)}`),
    updateTask: (id, patch) => data("PATCH", `/gms/tasks/${e(id)}`, patch),

    listAssignments: (filter = {}) => data("GET", `/gms/review-assignments${q(filter)}`),
    createAssignment: (input) => data("POST", "/gms/review-assignments", input),
    autoAssign: (input) => data("POST", "/gms/review-assignments/auto", input),
    inviteReviewer: (input) => data("POST", "/gms/review-assignments/invite", input),
    getAssignment: (id) => data("GET", `/gms/review-assignments/${e(id)}`),
    updateAssignment: (id, patch) => data("PATCH", `/gms/review-assignments/${e(id)}`, patch),
    listReviews: (applicationId, stage) => data("GET", `/gms/reviews${q({ applicationId, stage })}`),
    getRanking: (competitionId, stage) => data("GET", `/gms/competitions/${e(competitionId)}/ranking${q({ stage })}`),

    getAllocation: (competitionId) => data("GET", `/gms/competitions/${e(competitionId)}/allocation`),
    listDecisions: (filter = {}) => data("GET", `/gms/decisions${q(filter)}`),
    proposeDecisions: (competitionId, decisions) => data("POST", "/gms/decisions/propose", { competitionId, decisions }),
    commitDecisions: (input) => data("POST", "/gms/decisions/commit", input),

    listAwards: (filter = {}) => items(`/gms/awards${q({ pageSize: 100, ...filter })}`),
    getAward: (id) => data("GET", `/gms/awards/${e(id)}`),
    decideAmendment: (id, input) => data("PATCH", `/gms/amendments/${e(id)}`, input),
    createAgreement: (awardId, input = {}) => data("POST", `/gms/awards/${e(awardId)}/agreements`, input),
    getAgreement: (id) => data("GET", `/gms/agreements/${e(id)}`),
    sendAgreement: (id) => data("POST", `/gms/agreements/${e(id)}/send`, {}),
    countersignAgreement: (id, input) => data("POST", `/gms/agreements/${e(id)}/countersign`, input),
    agreementPdf: async (id) => (await send("GET", `/gms/agreements/${e(id)}/pdf`)).blob(),

    listTemplates: (kind) => data("GET", `/gms/templates${q({ kind })}`),
    createTemplate: (input) => data("POST", "/gms/templates", input),
    renderTemplate: (id, input = {}) => data("POST", `/gms/templates/${e(id)}/render`, input),
    listCommunications: () => items("/gms/communications?pageSize=100"),

    listApprovals: (status) => items(`/gms/approvals${q({ status, pageSize: 100 })}`),
    decideApproval: (id, input) => data("POST", `/gms/approvals/${e(id)}/decision`, input),

    consentRequest: (req) => data("GET", `/oauth/authorize/request${q({ req })}`),
    decideConsent: (input) => data("POST", "/oauth/authorize/decision", input),
  };
}
