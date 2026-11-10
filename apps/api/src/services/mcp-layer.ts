// SPDX-License-Identifier: AGPL-3.0-only
// The MCP ServiceLayer over the same service functions the REST routes call (build spec §10.9:
// "agents get the UI's capabilities, no more"). Each tool method builds a ServiceContext for the
// calling person and client, and every service function re-runs `authorize`. A tool whose service
// has not landed yet answers with a clear tool error instead of pretending.
import { validateResponse, type JsonObject } from "@gms/forms";
import { ServiceError, type Actor as McpActor, type Approval, type ApprovalStatus, type ApprovalStore, type ResourceKind, type ResourceReader, type ServiceLayer } from "@gms/mcp";
import { ApiError } from "../lib/errors.ts";
import { uuidOf } from "../lib/ids.ts";
import * as applicant from "./applicant.ts";
import * as apply from "./apply.ts";
import * as agreements from "./agreements.ts";
import * as awards from "./awards.ts";
import * as collab from "./collaboration.ts";
import * as decisions from "./decisions.ts";
import * as competitions from "./competitions.ts";
import { makeActor, type ServiceContext } from "./context.ts";
import * as forms from "./forms.ts";
import * as inbox from "./inbox.ts";
import * as opportunities from "./opportunities.ts";
import * as org from "./organization.ts";
import * as programs from "./programs.ts";
import * as pub from "./public.ts";
import * as reviews from "./reviews.ts";
import * as templates from "./templates.ts";
import type { Repos, Row } from "./repos/types.ts";

export type ContextBase = Pick<ServiceContext, "repos" | "ledger" | "webhooks" | "now" | "config" | "ports">;

/** The ServiceContext for an MCP actor: role and membership scope are re-read on every call. */
export async function contextFor(base: ContextBase, actor: McpActor): Promise<ServiceContext> {
  const m = await base.repos.table("workspace_members").one({ workspace_id: actor.workspaceId, user_id: actor.userId });
  if (!m || (m.expires_at && Date.parse(m.expires_at) <= base.now().getTime())) throw new ServiceError("forbidden", "The person this token acts for no longer has access to this workspace.");
  return {
    ...base,
    actor: makeActor(actor.clientId ? "delegated" : "user", actor.userId, actor.clientId),
    workspace: { id: actor.workspaceId, kind: actor.workspaceKind, role: m.role, memberScope: (m.scope as Record<string, unknown> | null) ?? null },
    scopes: actor.scopes,
  };
}

function toServiceError(e: unknown): never {
  if (e instanceof ApiError) {
    const issues = e.details.map((x) => ({ field: x.field ?? "", message: x.detail ?? x.code }));
    const code = e.status === 404 ? "not_found" : e.status === 403 || e.status === 401 ? "forbidden" : e.status === 409 ? "conflict" : e.status === 400 || e.status === 422 || e.status === 413 ? "invalid_input" : null;
    if (code) throw new ServiceError(code, e.message, issues.length ? issues : undefined);
  }
  throw e;
}

const paged = (i: { page?: number; pageSize?: number }) => {
  const page = i.page ?? 1;
  const pageSize = i.pageSize ?? 100;
  return { page, pageSize, offset: (page - 1) * pageSize };
};
const app = (id: string) => uuidOf("application", id, "Application");
const frm = (id: string) => uuidOf("form", id, "Form");
const cmp = (id: string) => uuidOf("competition", id, "Competition");
const awd = (id: string) => uuidOf("award", id, "Award");
const agr = (id: string) => uuidOf("agreement", id, "Agreement");
const LEVELS = ["L0", "L1", "L2", "L3"];

type Impl = { [K in keyof ServiceLayer]?: (ctx: ServiceContext, input: Parameters<ServiceLayer[K]>[1]) => Promise<unknown> };

const IMPLEMENTED: Impl = {
  // ---- funder: design (reads) ----
  listPrograms: (ctx, i) => programs.listPrograms(ctx, paged(i)),
  getProgram: (ctx, i) => programs.getProgram(ctx, i.programId),
  listOpportunities: (ctx, i) => opportunities.listOpportunities(ctx, paged(i), { status: i.status, programId: i.programId }),
  getOpportunity: (ctx, i) => opportunities.getOpportunity(ctx, uuidOf("opportunity", i.opportunityId, "Opportunity")),
  publishOpportunity: (ctx, i) => opportunities.publishOpportunity(ctx, uuidOf("opportunity", i.opportunityId, "Opportunity")),
  listCompetitions: (ctx, i) => competitions.listCompetitions(ctx, i.opportunityId ? { opportunityId: uuidOf("opportunity", i.opportunityId, "Opportunity") } : {}),
  getCompetition: (ctx, i) => competitions.getCompetition(ctx, uuidOf("competition", i.competitionId, "Competition")),
  listForms: (ctx, i) => (i.library ? forms.listLibrary(ctx, paged(i)) : forms.listForms(ctx, paged(i), { purpose: i.purpose })),
  getForm: (ctx, i) => forms.getForm(ctx, frm(i.formId), i.version),

  // ---- funder: inbox ----
  listApplications: async (ctx, i) => {
    const eligibility = i.eligibility === "eligible" ? "true" : i.eligibility === "ineligible" ? "false" : i.eligibility;
    const r = await inbox.listApplications(ctx, { page: 1, pageSize: 5000, offset: 0 }, { ...(i.competitionId ? { competitionId: uuidOf("competition", i.competitionId, "Competition") } : {}), stage: i.stage, status: i.status?.join(","), eligibility, tag: i.tag, assignee: i.assignedToUserId, q: i.search });
    // "At least this level" is a floor, which the REST filter (exact level) does not express.
    const floor = i.minVerificationLevel ? LEVELS.indexOf(i.minVerificationLevel) : -1;
    const items = r.items.filter((a) => floor < 0 || LEVELS.indexOf(a.verificationLevelAtSubmit ?? "L0") >= floor);
    const p = paged(i);
    return { items: items.slice(p.offset, p.offset + p.pageSize), total: items.length, page: p.page, pageSize: p.pageSize };
  },
  getApplication: (ctx, i) => inbox.getApplicationDetail(ctx, app(i.applicationId)),
  runEligibility: (ctx, i) => inbox.rerunEligibility(ctx, app(i.applicationId)),
  advanceApplication: (ctx, i) => inbox.advanceApplication(ctx, app(i.applicationId), { toStage: i.toStage, ...(i.note ? { note: i.note } : {}) }),
  requestRevision: (ctx, i) => inbox.requestRevision(ctx, app(i.applicationId), { message: i.message, ...(i.dueAt ? { dueAt: i.dueAt } : {}) }),
  declineApplication: (ctx, i) => inbox.declineApplication(ctx, app(i.applicationId), { rationale: i.rationale, sendLetter: true }),
  tagApplication: (ctx, i) => inbox.tagApplication(ctx, app(i.applicationId), { add: i.add, remove: i.remove }),

  // ---- funder: reviews, decisions, awards, agreements ----
  listReviewAssignments: async (ctx, i) => {
    const all = await reviews.listAssignments(ctx, { ...(i.competitionId ? { competitionId: cmp(i.competitionId) } : {}), ...(i.applicationId ? { applicationId: app(i.applicationId) } : {}), stage: i.stage, reviewerUserId: i.reviewerUserId, status: i.status });
    const p = paged(i);
    return { items: all.slice(p.offset, p.offset + p.pageSize), total: all.length };
  },
  assignReviewer: (ctx, i) => reviews.createAssignment(ctx, app(i.applicationId), { stage: i.stage, reviewerUserId: i.reviewerUserId, ...(i.dueAt ? { dueAt: i.dueAt } : {}) }),
  getScores: async (ctx, i) => ({ items: await reviews.listReviews(ctx, app(i.applicationId), i.stage) }),
  rankApplications: (ctx, i) => reviews.getRanking(ctx, cmp(i.competitionId), i.stage),
  proposeDecision: (ctx, i) => decisions.proposeDecisions(ctx, cmp(i.competitionId), i.decisions.map((d) => ({ applicationUuid: app(d.applicationId), outcome: d.outcome, ...(d.amountMinor !== undefined ? { amountMinor: d.amountMinor } : {}), conditions: d.conditions, ...(d.rationale ? { rationale: d.rationale } : {}) }))),
  // Gated: this runs only after a person approved the call, as that person.
  commitDecisions: (ctx, i) => decisions.commitDecisions(ctx, cmp(i.competitionId), { decisionIds: i.decisionIds }),
  listAwards: (ctx, i) => awards.listAwards(ctx, paged(i), { status: i.status?.join(","), programId: i.programId, recipientWorkspaceId: i.recipientWorkspaceId }),
  getAward: (ctx, i) => awards.getAward(ctx, awd(i.awardId), "funder"),
  createAwardFromApplication: (ctx, i) => decisions.createAwardFromApplication(ctx, app(i.applicationId), { amountMinor: i.amountMinor, currency: i.currency, startDate: i.startDate, endDate: i.endDate, conditions: i.conditions }),
  amendAward: (ctx, i) => awards.requestAmendment(ctx, awd(i.awardId), { type: i.type, request: i.request, reason: i.reason }),
  closeAward: (ctx, i) => (i.outcome === "completed" ? awards.completeAward(ctx, awd(i.awardId)) : awards.cancelAward(ctx, awd(i.awardId), { reason: i.reason?.trim() || "Cancelled" })),
  generateAgreement: (ctx, i) => agreements.createAgreement(ctx, awd(i.awardId), i.templateId ? { templateId: i.templateId } : {}),
  sendAgreement: (ctx, i) => agreements.sendAgreement(ctx, agr(i.agreementId), {}),
  getAgreementStatus: (ctx, i) => agreements.getAgreement(ctx, agr(i.agreementId)),
  // Gated: this runs only after a person approved the call, as that person.
  sendCommunication: (ctx, i) =>
    templates.sendCommunication(
      ctx,
      { templateId: i.templateId, recipients: [{}], ...(i.subjectOverride ? { subjectOverride: i.subjectOverride } : {}) },
      i.recipients.map((r) => ({ ...(r.applicationId ? { applicationUuid: app(r.applicationId) } : {}), ...(r.awardId ? { awardUuid: awd(r.awardId) } : {}), ...(r.applicantWorkspaceId ? { applicantWorkspaceId: r.applicantWorkspaceId } : {}) })),
    ),
  // A draft only: the letter is rendered for a person to read and is never sent by this tool.
  draftLetter: (ctx, i) => templates.renderTemplate(ctx, i.templateId ?? `builtin:${i.kind === "award" ? "award_agreement" : i.kind}`, { fields: {}, ...(i.applicationId ? { applicationUuid: app(i.applicationId) } : {}), ...(i.awardId ? { awardUuid: awd(i.awardId) } : {}) }),

  // ---- applicant ----
  getMyOrganization: (ctx, i) => (i.refresh ? org.refreshMyOrganization(ctx) : org.getMyOrganization(ctx)),
  getPassportReadiness: (ctx) => org.getMyReadiness(ctx),
  findCompetitions: async (ctx, i) => {
    const needle = i.search?.toLowerCase();
    const all = (await applicant.discoverCompetitions(ctx)).filter((c) => (!needle || `${c.opportunity.title} ${c.opportunity.description}`.toLowerCase().includes(needle)) && (!i.eligibleOnly || c.eligibility.eligible === true));
    const p = paged(i);
    return { items: all.slice(p.offset, p.offset + p.pageSize), total: all.length };
  },
  checkEligibility: async (ctx, i) => {
    const id = uuidOf("competition", i.competitionId, "Competition");
    const found = (await applicant.discoverCompetitions(ctx)).find((c) => c.competitionId === id);
    if (!found) throw new ServiceError("not_found", "No open competition with that id.");
    return found.eligibility;
  },
  searchOpenGrants: (ctx, i) => applicant.openGrants(ctx, "search", i),
  matchOpenGrants: (ctx, i) => applicant.openGrants(ctx, "match", i),
  createFundingAlert: (ctx, i) => applicant.openGrants(ctx, "alerts", i),
  listMyApplications: async (ctx, i) => {
    const all = (await applicant.listMyApplications(ctx)).filter((a) => !i.status?.length || (i.status as string[]).includes(a.status));
    const p = paged(i);
    return { items: all.slice(p.offset, p.offset + p.pageSize), total: all.length };
  },
  getMyApplication: (ctx, i) => apply.getApplication(ctx, app(i.applicationId)),
  startApplication: async (ctx, i) => (await apply.startApplication(ctx, { competitionId: uuidOf("competition", i.competitionId, "Competition") })).application,
  fillFormResponse: (ctx, i) => apply.putFormResponse(ctx, app(i.applicationId), frm(i.formId), { response: i.response }),
  insertAnswer: async (ctx, i) => {
    const answer = (await applicant.listAnswers(ctx)).find((a) => a.id === i.answerId);
    if (!answer) throw new ServiceError("not_found", "No such answer in the library.");
    // A dotted or slash path becomes a nested patch; the merge then marks the field as edited by this caller.
    const segments = i.field.replace(/^[#/]+/, "").split(/[/.]/).filter(Boolean);
    const patch: JsonObject = {};
    segments.reduce<JsonObject>((node, s, idx) => (idx === segments.length - 1 ? ((node[s] = answer.body), node) : ((node[s] = {}), node[s] as JsonObject)), patch);
    return apply.putFormResponse(ctx, app(i.applicationId), frm(i.formId), { response: patch });
  },
  validateApplication: async (ctx, i) => {
    const { app: row } = await apply.access(ctx, app(i.applicationId), "applications:read");
    const competition = await ctx.repos.table("competitions").one({ id: row.competition_id });
    const required = competition ? Object.keys(apply.stageForms(competition, row.stage)) : [];
    const responses = await apply.responsesOf(ctx, row.id);
    const formsOut = [];
    for (const formId of required) {
      const r = responses.find((x) => x.form_id === formId);
      const def = r ? await ctx.repos.table("forms").one({ id: formId, version: r.form_version }) : null;
      const errors = r && def ? validateResponse(forms.toDefinition(def), r.response).validationErrors : [{ field: "", message: "This form has not been started", type: "required" }];
      formsOut.push({ formId: `frm_${formId}`, status: r?.status ?? "notStarted", validationErrors: errors });
    }
    const applicantWs = await ctx.repos.table("workspaces").one({ id: row.applicant_workspace_id });
    const eligibility = applicantWs ? await apply.runRules(ctx, row.opportunity_id, applicantWs, responses) : null;
    return { ready: formsOut.every((f) => f.validationErrors.length === 0), forms: formsOut, eligibility };
  },
  submitApplication: (ctx, i) => apply.submitApplication(ctx, app(i.applicationId)),
  withdrawApplication: (ctx, i) => applicant.withdrawApplication(ctx, app(i.applicationId)),
  // ---- applicant: awards and agreements ----
  listMyAwards: (ctx, i) => awards.listMyAwards(ctx, paged(i), { status: i.status?.join(",") }),
  getMyAward: (ctx, i) => awards.getAward(ctx, awd(i.awardId), "recipient"),
  // Gated and never bypassable: this runs only after the workspace's admin approved it, as that person.
  acceptAward: (ctx, i) => awards.acceptOffer(ctx, awd(i.awardId)),
  // A signature needs the signer's typed name and attestation, which no agent can supply.
  signAgreement: async () => {
    throw new ServiceError("forbidden", "Signing is a human gate: the agreement is signed by a person in the GMS web app, who types their name and confirms their authority. An agent can prepare an agreement, never sign one.");
  },
  requestAmendment: (ctx, i) => awards.requestAmendment(ctx, awd(i.awardId), { type: i.type, request: i.request, reason: i.reason }),
  listAnswers: async (ctx, i) => {
    const needle = i.search?.toLowerCase();
    const all = (await applicant.listAnswers(ctx)).filter((a) => !needle || `${a.title} ${a.body}`.toLowerCase().includes(needle));
    const p = paged(i);
    return { items: all.slice(p.offset, p.offset + p.pageSize), total: all.length };
  },
  saveAnswer: (ctx, i) => (i.answerId ? applicant.updateAnswer(ctx, i.answerId, { title: i.title, body: i.body }) : applicant.createAnswer(ctx, { key: i.key, title: i.title, body: i.body })),
  listMessages: async (ctx, i) => {
    if (!i.applicationId) throw new ServiceError("invalid_input", "Pass applicationId: threads are listed per application.", [{ field: "applicationId", message: "Required" }]);
    const threads = await collab.listThreads(ctx, { subjectType: "application", subjectId: app(i.applicationId) });
    return { items: i.threadId ? threads.filter((t) => t.id === i.threadId) : threads };
  },
  replyToThread: (ctx, i) => collab.postMessage(ctx, i.threadId, { body: i.body }),
};

export const IMPLEMENTED_SERVICES: readonly string[] = Object.keys(IMPLEMENTED);

/** The ServiceLayer the dispatcher calls. Unimplemented methods exist and say so. */
export function createServiceLayer(base: ContextBase): ServiceLayer {
  return new Proxy({} as ServiceLayer, {
    get(_target, method: string) {
      return async (actor: McpActor, input: unknown) => {
        const fn = (IMPLEMENTED as Record<string, ((ctx: ServiceContext, input: never) => Promise<unknown>) | undefined>)[method];
        if (!fn) throw new ServiceError("conflict", "This tool is not available on this server yet. It arrives with a later release; nothing was changed.");
        try {
          return await fn(await contextFor(base, actor), input as never);
        } catch (e) {
          return toServiceError(e);
        }
      };
    },
  });
}

/** `gms://…` resources, read through the same services (so the same visibility rules apply). */
export function createResourceReader(base: ContextBase): ResourceReader {
  return {
    async read(actor, kind: ResourceKind, id) {
      try {
        const ctx = await contextFor(base, actor);
        const bare = (k: "opportunity" | "competition" | "form" | "application") => {
          try {
            return uuidOf(k, id, k);
          } catch {
            return /^[0-9a-f-]{36}$/i.test(id) ? id.toLowerCase() : null;
          }
        };
        if (kind === "application") {
          const uuid = bare("application");
          return uuid ? await apply.getApplication(ctx, uuid) : null;
        }
        if (kind === "org") return actor.workspaceKind === "applicant" ? (await org.getMyOrganization(ctx)).organization : null;
        const viewer = { workspaceId: actor.workspaceId, canReadDrafts: { opportunities: actor.scopes.includes("opportunities:read"), competitions: actor.scopes.includes("competitions:read"), forms: actor.scopes.includes("forms:read") } };
        if (kind === "opportunity") return bare("opportunity") ? await pub.cgGetOpportunity(ctx, bare("opportunity")!, viewer) : null;
        if (kind === "competition") return bare("competition") ? await pub.cgGetCompetition(ctx, bare("competition")!, viewer) : null;
        if (kind === "form") return bare("form") ? await pub.cgGetForm(ctx, bare("form")!, undefined, viewer) : null;
        return null;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) return null;
        throw e;
      }
    },
  };
}

// ------------------------------------------------------------------------------------ approvals

const APPROVAL_PREFIX = "apr_";
export const approvalUuid = (id: string): string | null => {
  const raw = id.startsWith(APPROVAL_PREFIX) ? id.slice(APPROVAL_PREFIX.length) : id;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? raw.toLowerCase() : null;
};
const requestedByString = (r: Approval["requestedBy"]) => (r.clientId ? `user:${r.userId}/client:${r.clientId}` : `user:${r.userId}`);
function parseRequestedBy(s: string): Approval["requestedBy"] {
  const m = /^user:([^/]+)(?:\/client:(.+))?$/.exec(s);
  return m ? { userId: m[1]!, clientId: m[2] ?? null } : { userId: "", clientId: s.replace(/^client:/, "") };
}

export function approvalFromRow(r: Row<"approvals">): Approval {
  return {
    id: `${APPROVAL_PREFIX}${r.id}`,
    workspaceId: r.workspace_id,
    side: r.side as Approval["side"],
    tool: r.tool,
    input: r.input,
    requestedBy: parseRequestedBy(r.requested_by),
    status: r.status as ApprovalStatus,
    createdAt: r.created_at,
    ...(r.decided_by ? { decidedBy: r.decided_by } : {}),
    ...(r.decided_at ? { decidedAt: r.decided_at } : {}),
    ...(r.decision_note ? { note: r.decision_note } : {}),
    ...(r.result !== null ? { result: r.result } : {}),
    ...(r.error ? { error: r.error } : {}),
  };
}

/** Approvals in the `approvals` table. `transition` is a compare-and-set on `status`, so a gated call runs once. */
export class RepoApprovalStore implements ApprovalStore {
  constructor(private readonly repos: Repos) {}

  async create(a: Approval): Promise<void> {
    const id = approvalUuid(a.id);
    if (!id) throw new Error("Approval ids are apr_<uuid>");
    const input = a.input as Record<string, unknown> | null;
    const subject = typeof input?.applicationId === "string" ? { type: "application", id: approvalUuid(input.applicationId.replace(/^app_/, "")) } : null;
    await this.repos.table("approvals").insert({
      id,
      workspace_id: a.workspaceId,
      side: a.side,
      tool: a.tool,
      input: a.input as Row<"approvals">["input"],
      summary: a.tool.replace(/_/g, " "),
      requested_by: requestedByString(a.requestedBy),
      status: "pending",
      ...(subject?.id ? { subject_type: subject.type, subject_id: subject.id } : {}),
    });
  }

  async get(id: string): Promise<Approval | null> {
    const uuid = approvalUuid(id);
    const row = uuid ? await this.repos.table("approvals").one({ id: uuid }) : null;
    return row ? approvalFromRow(row) : null;
  }

  async transition(id: string, from: ApprovalStatus, patch: Partial<Approval> & { status: ApprovalStatus }): Promise<boolean> {
    const uuid = approvalUuid(id);
    if (!uuid) return false;
    const rows = await this.repos.table("approvals").update(
      { id: uuid, status: from },
      {
        status: patch.status,
        ...(patch.decidedBy !== undefined ? { decided_by: patch.decidedBy } : {}),
        ...(patch.decidedAt !== undefined ? { decided_at: patch.decidedAt } : {}),
        ...(patch.note !== undefined ? { decision_note: patch.note } : {}),
        ...(patch.result !== undefined ? { result: (patch.result ?? null) as Row<"approvals">["result"] } : {}),
        ...(patch.error !== undefined ? { error: patch.error.slice(0, 500) } : {}),
      },
    );
    return rows.length > 0;
  }
}
