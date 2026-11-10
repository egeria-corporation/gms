// SPDX-License-Identifier: AGPL-3.0-only
// The rest of the applicant workspace's API port: the payment schedule, budget and amendments of a
// grant, reporting requirements and their submissions, library inserts, and the per-person pieces
// both workspace kinds share (notifications, notification preferences, connected agents).
// `createHttpApplicantMoreApi` calls the GMS Worker; `createMockApplicantMoreApi`
// (mocks/applicantMore.ts) implements the same interface in the browser.
// test/applicantMore-contract.test.ts holds both to the same assertions.
import type { JsonObject, ValidationError } from "@gms/forms";
import { toAppForm, type AppForm } from "./applicant.ts";
import { ApiError } from "./client.ts";
import type { components } from "./schema.d.ts";

type S = components["schemas"];

export type TrancheStatus = S["Models.TrancheStatus"];
export type RequirementStatus = S["Models.RequirementStatus"];
export type SubmissionStatus = S["Models.SubmissionStatus"];
export type BudgetBook = S["Models.BudgetBook"];
export type BudgetView = S["Models.BudgetView"];
export type BudgetLine = S["Models.BudgetLineView"];
export type Amendment = S["Models.Amendment"];
export type AmendmentInput = S["Models.AmendmentInput"];
export type MemberNotification = S["Models.MemberNotification"];
export type NotificationList = S["Models.NotificationList"];
export type NotificationPreferences = S["Models.NotificationPreferences"];
export type McpConnection = S["Models.McpConnectionView"];
export type ShareResult = S["Models.ShareSubmissionResult"];
export type RevisionDiff = S["Models.RevisionDiff"];
export type RevisionChange = S["Models.RevisionChange"];

/** One scheduled payment as the grantee sees it. Bank facts are never more than a name and last four. */
export interface ScheduleTranche {
  id: string;
  seq: number;
  amountMinor: number;
  currency: string;
  condition: { type: "onExecution" | "onReportAccepted" | "onDate" | "manual"; requirementId?: string; date?: string };
  status: TrancheStatus;
  dueAt: string | null;
  /** Why the payment is paused, as the funder or Passport recorded it. */
  holdReason: string | null;
  mode: "facilitated" | "resolve" | null;
  passportStatus: string | null;
  releasedAt: string | null;
  bankName?: string | null;
  last4?: string | null;
}

/**
 * Where grant payments go, as much as the grantee's workspace may show: the payee status and, when
 * the API provides them, the bank's name and the last four digits. Never anything more.
 */
export interface PayeeSummary {
  status: "active" | "pending_change" | "none" | "unknown";
  level: string | null;
  bankName: string | null;
  last4: string | null;
  /** Where the destination is managed: Passport, never the GMS. */
  manageUrl: string | null;
}

/** A requirement on one of the organization's grants, with the funder it reports to. */
export interface MyRequirement {
  id: string;
  awardId: string;
  type: string;
  title: string;
  formId: string | null;
  formVersion: number | null;
  dueAt: string | null;
  status: RequirementStatus;
  releasesTrancheId: string | null;
  submissionId: string | null;
  submissionStatus: SubmissionStatus | null;
  award: { id: string; title: string } | null;
  funder: { workspaceId: string; name: string; handle: string; brand?: unknown } | null;
}

export interface SubmissionForm {
  /** Prefixed form id (`frm_<uuid>`). */
  formId: string;
  formVersion: number;
  response: JsonObject;
  status: string;
  validationErrors: ValidationError[];
  /** JSON pointer → `passport` | `prior_submission` | `user` | `agent:<client>` … */
  provenance: Record<string, string>;
  lockedAt: string | null;
}

export interface Submission {
  id: string;
  requirementId: string | null;
  awardId: string | null;
  status: SubmissionStatus;
  submittedAt: string | null;
  /** The funder's note when the report was returned or accepted. */
  reviewNote: string | null;
  requirement: { title: string; type: string; dueAt: string | null; status: string } | null;
  formResponses: SubmissionForm[];
}

export type SavedSubmissionForm = SubmissionForm & { rejected: string[] };

export interface ShareInput {
  funderWorkspaceId?: string;
  funderHandle?: string;
  /** Top-level field keys to share; leave out to share the whole report. */
  fields?: string[];
  note?: string;
}

export interface ActualsInput {
  periodStart: string;
  periodEnd: string;
  lines: BudgetLine[];
}

export interface SectionAssignments {
  formId: string;
  sections: Record<string, string>;
}

export interface ApplicantMoreApi {
  // ---- a grant's money ----
  schedule(awardId: string): Promise<ScheduleTranche[]>;
  payee(): Promise<PayeeSummary>;
  budget(awardId: string): Promise<BudgetBook>;
  /** The grantee reports actuals for a period; the approved budget is the funder's to set. */
  reportActuals(awardId: string, input: ActualsInput): Promise<BudgetView>;
  requestAmendment(awardId: string, input: AmendmentInput): Promise<Amendment>;

  // ---- reports ----
  requirements(): Promise<MyRequirement[]>;
  /** Opens (or returns to) the report for a requirement. The first call creates the draft, prefilled. */
  startReport(requirementId: string): Promise<Submission>;
  submission(id: string): Promise<Submission>;
  /** Sends only the changed paths; the server merges them into the stored response. */
  saveReportForm(submissionId: string, formId: string, patch: JsonObject): Promise<SavedSubmissionForm>;
  /** Rejects with a 422 ApiError listing the fields to fix when the report is not complete. */
  submitReport(submissionId: string): Promise<Submission>;
  /** The grantee's consent to give another funder a copy of an accepted report. */
  shareReport(submissionId: string, input: ShareInput): Promise<ShareResult>;

  // ---- application editor follow-ups ----
  /** Section label → teammate, for every form of an application. */
  sectionAssignments(applicationId: string): Promise<SectionAssignments[]>;
  /** Copies a library answer into a field; the field's provenance becomes `library`. */
  insertAnswer(applicationId: string, formId: string, input: { answerId: string; path: string }): Promise<AppForm>;

  // ---- the person (either kind of workspace; `workspaceId` names one other than the current) ----
  notifications(opts?: { unread?: boolean; workspaceId?: string }): Promise<NotificationList>;
  markRead(input: { ids: string[] } | { all: true }, workspaceId?: string): Promise<{ unread: number }>;
  notificationPreferences(workspaceId?: string): Promise<NotificationPreferences>;
  saveNotificationPreferences(prefs: NotificationPreferences, workspaceId?: string): Promise<NotificationPreferences>;
  connections(workspaceId?: string): Promise<McpConnection[]>;
  /** Revoking an agent's connection also revokes its OAuth grant. Only a person can do it. */
  revokeConnection(id: string, workspaceId?: string): Promise<{ revoked: boolean }>;
}

// ------------------------------------------------------------------------------------ shaping

const asErrors = (list: unknown): ValidationError[] =>
  (Array.isArray(list) ? list : []).flatMap((e) => {
    if (!e || typeof e !== "object") return [];
    const x = e as { field?: unknown; message?: unknown; type?: unknown };
    return [{ field: typeof x.field === "string" ? x.field : "", message: typeof x.message === "string" ? x.message : "Check this answer", type: typeof x.type === "string" ? x.type : "invalid" }];
  });

const asProvenance = (p: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries((p && typeof p === "object" ? p : {}) as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"));

export function toSubmissionForm(r: S["Models.SubmissionFormResponse"] & { rejected?: string[] }): SavedSubmissionForm {
  return {
    formId: r.formId,
    formVersion: r.formVersion,
    response: (r.response ?? {}) as JsonObject,
    status: r.status,
    validationErrors: asErrors(r.validationErrors),
    provenance: asProvenance(r.provenance),
    lockedAt: r.lockedAt,
    rejected: r.rejected ?? [],
  };
}

export function toSubmission(s: S["Models.SubmissionView"]): Submission {
  return {
    id: s.id,
    requirementId: s.requirementId,
    awardId: s.awardId,
    status: s.status,
    submittedAt: s.submittedAt,
    reviewNote: s.reviewNote,
    requirement: s.requirement,
    formResponses: s.formResponses.map(toSubmissionForm),
  };
}

const SUBMISSION_STATUSES: readonly string[] = ["draft", "submitted", "under_review", "accepted", "returned"];

export function toMyRequirement(r: S["Models.RequirementView"]): MyRequirement {
  const f = r.funder as { workspaceId?: unknown; name?: unknown; handle?: unknown; brand?: unknown } | null | undefined;
  return {
    id: r.id,
    awardId: r.awardId,
    type: r.type,
    title: r.title,
    formId: r.formId,
    formVersion: r.formVersion,
    dueAt: r.dueAt,
    status: r.status,
    releasesTrancheId: r.releasesTrancheId,
    submissionId: r.submissionId,
    submissionStatus: r.submissionStatus && SUBMISSION_STATUSES.includes(r.submissionStatus) ? (r.submissionStatus as SubmissionStatus) : null,
    award: r.award ?? null,
    funder: f && typeof f.workspaceId === "string" ? { workspaceId: f.workspaceId, name: typeof f.name === "string" ? f.name : "Funder", handle: typeof f.handle === "string" ? f.handle : "", brand: f.brand } : null,
  };
}

/**
 * Why a payment is paused, in the three parts the design asks for: what is blocked, why, and what
 * clears it. Reasons are the codes the funder's workspace and Passport record on the tranche.
 */
export function holdExplanation(reason: string | null | undefined): { cause: string; why: string; clears: string } {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("destination")) return { cause: "destination_change", why: "Your organization started a change to its payout destination in Passport. Payments pause while the new destination cools off.", clears: "Clears automatically when the destination change completes in Passport" };
  if (r.includes("freeze")) return { cause: "freeze_window", why: "A recent destination change put your payout destination in its freeze window.", clears: "Clears automatically when the freeze window ends" };
  if (r.includes("level")) return { cause: "level_below_l3", why: "Your Passport verification level is below L3, which facilitated payments require.", clears: "Clears when your organization re-attests in Passport" };
  if (r.includes("agreement")) return { cause: "agreement_not_executed", why: "The grant agreement is not executed yet.", clears: "Clears when both parties have signed the agreement" };
  if (r.includes("inactive")) return { cause: "organization_inactive", why: "Passport reports your organization as inactive.", clears: "Clears when your organization's status is active again in Passport" };
  if (r.includes("passport") || r.includes("unavailable")) return { cause: "passport_unavailable", why: "Passport could not be reached, so your payee status is unknown.", clears: "Clears when Passport is reachable again; nothing is released in the meantime" };
  return { cause: "held", why: reason ? reason.replace(/_/g, " ") : "Your funder paused this payment.", clears: "Your funder releases the hold" };
}

// ------------------------------------------------------------------------------------ HTTP

export interface HttpApplicantMoreOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  /** The workspace the calls act in (sent as `X-GMS-Workspace` with a session bearer). */
  workspaceId: () => string | null;
  fetch?: typeof fetch;
}

const bare = (id: string) => id.replace(/^[a-z]{3}_/, "");

export function createHttpApplicantMoreApi(opts: HttpApplicantMoreOptions): ApplicantMoreApi {
  async function call<T>(method: string, path: string, body?: unknown, inWorkspace?: string): Promise<T> {
    const token = await opts.token();
    const workspaceId = inWorkspace ?? opts.workspaceId();
    const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(workspaceId ? { "X-GMS-Workspace": workspaceId } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; items?: unknown; message?: string; errors?: unknown[] };
    if (!res.ok) throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, json.errors ?? []);
    return (json.data ?? json.items) as T;
  }
  const get = <T>(path: string) => call<T>("GET", path);
  const e = encodeURIComponent;

  return {
    schedule: (awardId) => get(`/gms/my/awards/${e(awardId)}/schedule`),
    // The Worker gives the grantee no bank name or last four yet; the payee status comes from the
    // Passport readiness check and the destination itself is shown in Passport.
    payee: async () => {
      const r = await get<S["Models.ApplicantReadiness"]>("/gms/me/readiness");
      const check = r.checks.find((c) => c.key === "payee_verified");
      const status = !check || check.state === "unknown" ? "unknown" : check.state === "pass" ? "active" : "none";
      return { status, level: r.level, bankName: null, last4: null, manageUrl: check?.fixHref ?? null };
    },
    budget: (awardId) => get(`/gms/my/awards/${e(awardId)}/budget`),
    reportActuals: (awardId, input) => call("PUT", `/gms/my/awards/${e(awardId)}/budget`, { kind: "actual", ...input }),
    requestAmendment: (awardId, input) => call("POST", `/gms/my/awards/${e(awardId)}/amendments`, input),

    requirements: async () => (await get<S["Models.RequirementView"][]>("/gms/my/requirements")).map(toMyRequirement),
    startReport: async (id) => toSubmission(await call<S["Models.SubmissionView"]>("POST", `/gms/my/requirements/${e(id)}/start`, {})),
    submission: async (id) => toSubmission(await get<S["Models.SubmissionView"]>(`/gms/my/submissions/${e(id)}`)),
    saveReportForm: async (id, formId, patch) => toSubmissionForm(await call<S["Models.SubmissionFormSaved"]>("PUT", `/gms/my/submissions/${e(id)}/forms/${e(formId)}`, { response: patch })),
    submitReport: async (id) => toSubmission(await call<S["Models.SubmissionView"]>("POST", `/gms/my/submissions/${e(id)}/submit`, {})),
    shareReport: (id, input) => call("POST", `/gms/my/submissions/${e(id)}/share`, input),

    sectionAssignments: async (applicationId) => {
      const rows = await get<{ formId: string; sections: Record<string, string | null> }[]>(`/gms/my/applications/${e(applicationId)}/sections`);
      return rows.map((r) => ({ formId: bare(r.formId), sections: Object.fromEntries(Object.entries(r.sections).filter((s): s is [string, string] => typeof s[1] === "string")) }));
    },
    insertAnswer: async (applicationId, formId, input) => {
      const r = await call<{ formResponse: Parameters<typeof toAppForm>[0] }>("POST", `/gms/my/applications/${e(applicationId)}/forms/${e(bare(formId))}/insert-answer`, input);
      return toAppForm(r.formResponse);
    },

    notifications: (o = {}) => call("GET", `/gms/notifications${o.unread ? "?unread=true" : ""}`, undefined, o.workspaceId),
    markRead: async (input, ws) => {
      const r = await call<{ unread?: number }>("POST", "/gms/notifications/read", input, ws);
      return { unread: r?.unread ?? 0 };
    },
    notificationPreferences: (ws) => call("GET", "/gms/me/notification-preferences", undefined, ws),
    saveNotificationPreferences: (prefs, ws) => call("PUT", "/gms/me/notification-preferences", prefs, ws),
    connections: async (ws) => (await call<McpConnection[] | null>("GET", "/gms/mcp-connections", undefined, ws)) ?? [],
    revokeConnection: async (id, ws) => {
      const r = await call<{ revokedAt?: string | null } | null>("DELETE", `/gms/mcp-connections/${e(id)}`, undefined, ws);
      return { revoked: !!r?.revokedAt };
    },
  };
}
