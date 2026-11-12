// SPDX-License-Identifier: AGPL-3.0-only
// The funder's application inbox (build spec §11.5, definition-of-done item 5): list with filters,
// detail with provenance and eligibility, advance, request a revision, decline, tag, assign, and
// the same in bulk. Status changes go through the application machine; letters go through the
// mail port and are ledgered.
import type { JsonObject } from "@gms/forms";
import { readPassportFields } from "@gms/protocol";
import { advanceStage, type StageDef } from "@gms/workflow";
import { fanOut } from "@gms/webhooks";
import { scoreReview, type Rubric, type Scores } from "@gms/review";
import { z } from "zod";
import { toRubric } from "./reviews.ts";
import { ApiError } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { type App, REVIEWER_ROLES, access, createStageResponses, eventPayload, recipientEmails, recordEvent, renderLetter, responsesOf, reviewerApplicationIds, reviewerResponse, revisionOf, revisionSnapshot, runRules, sendLetter, stagesOf, transitionApp } from "./apply.ts";
import { audit, authorize, requireApproval, required, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import { namesOf, orgFacts, selfDeclaredOf, verificationShared } from "./profile.ts";
import type { PageRequest } from "./programs.ts";
import type { Row } from "./repos/types.ts";

type Ws = Row<"workspaces">;
const WINDOW = 5000;

const eligibleOf = (a: App): boolean | "unknown" | null => {
  const e = a.eligibility as { eligible?: boolean | "unknown" } | null;
  return e && e.eligible !== undefined ? e.eligible : null;
};

function summary(a: App, applicant: Ws | undefined, consented: boolean) {
  return {
    id: apiId("application", a.id),
    title: a.title,
    competitionId: apiId("competition", a.competition_id),
    opportunityId: apiId("opportunity", a.opportunity_id),
    stage: a.stage,
    status: a.status,
    eligibility: eligibleOf(a),
    requestedAmountMinor: a.requested_amount_minor,
    currency: a.currency,
    tags: a.tags,
    assignedToUserId: a.assigned_to_user_id,
    submittedAt: a.submitted_at,
    verificationLevelAtSubmit: a.verification_level_at_submit,
    applicant: {
      workspaceId: a.applicant_workspace_id,
      /** The Passport legal name for a Passport workspace; its own display name is `workspaceName`. */
      name: applicant ? namesOf(applicant).name : null,
      workspaceName: applicant ? namesOf(applicant).workspaceName : null,
      handle: applicant?.handle ?? null,
      // The current level is the applicant's to share; it shows only while their consent stands.
      level: consented ? (applicant?.verification_level ?? null) : null,
      /** Passport-verified, self-declared (not verified) or no profile at all. */
      verification: verificationShared(applicant, consented),
    },
    updatedAt: a.updated_at,
  };
}

/** Reviewers see the applications assigned to them, nothing else. The rule itself is `reviewerApplicationIds`, shared with every other read. */
const visibleIds = (ctx: ServiceContext, ws: ServiceWorkspace): Promise<Set<string> | null> => reviewerApplicationIds(ctx, ws);

export interface InboxFilter {
  competitionId?: string;
  stage?: string;
  status?: string;
  eligibility?: string;
  level?: string;
  tag?: string;
  assignee?: string;
  q?: string;
  /** Named views beyond the plain filters: `review_complete` or `flagged`. */
  view?: string;
  sortBy?: string;
  sortOrder?: string;
}

const SORTS: Record<string, (a: App) => string | number> = {
  submittedAt: (a) => a.submitted_at ?? "",
  title: (a) => a.title.toLowerCase(),
  requestedAmount: (a) => a.requested_amount_minor ?? -1,
  status: (a) => a.status,
  updatedAt: (a) => a.updated_at,
};

export async function listApplications(ctx: ServiceContext, page: PageRequest, f: InboxFilter = {}) {
  const ws = await authorize(ctx, { scope: "applications:read", kind: "funder" });
  const only = await visibleIds(ctx, ws);
  let rows = await ctx.repos.table("applications").find({ workspace_id: ws.id, ...(f.competitionId ? { competition_id: f.competitionId } : {}) }, { notNull: ["submitted_at"], limit: WINDOW });
  const needle = f.q?.trim().toLowerCase();
  rows = rows.filter(
    (a) =>
      (!only || only.has(a.id)) &&
      (!f.stage || a.stage === f.stage) &&
      (!f.status || f.status.split(",").includes(a.status)) &&
      (!f.eligibility || String(eligibleOf(a)) === f.eligibility) &&
      (!f.level || a.verification_level_at_submit === f.level) &&
      (!f.tag || a.tags.includes(f.tag)) &&
      (!f.assignee || (f.assignee === "unassigned" ? a.assigned_to_user_id === null : a.assigned_to_user_id === f.assignee)) &&
      (!needle || a.title.toLowerCase().includes(needle)),
  );
  const review = await reviewFacts(ctx, ws.id, rows);
  const flagged = (a: App) => a.tags.includes("flagged") || eligibleOf(a) === "unknown" || !!review.get(a.id)?.spreadFlag;
  if (f.view === "review_complete") rows = rows.filter((a) => review.get(a.id)?.complete);
  if (f.view === "flagged") rows = rows.filter(flagged);
  const key = f.sortBy === "score" ? (a: App) => review.get(a.id)?.score ?? -1 : (SORTS[f.sortBy ?? "submittedAt"] ?? SORTS.submittedAt!);
  const dir = f.sortOrder === "asc" ? 1 : -1;
  rows.sort((x, y) => (key(x) < key(y) ? -dir : key(x) > key(y) ? dir : 0));
  const slice = rows.slice(page.offset, page.offset + page.pageSize);
  const ids = [...new Set(slice.map((a) => a.applicant_workspace_id))];
  const applicants = ids.length ? await ctx.repos.table("workspaces").find({ id: ids }) : [];
  const consents = ids.length ? await ctx.repos.table("consents").find({ funder_workspace_id: ws.id, applicant_workspace_id: ids, revoked_at: null }) : [];
  const counts: Record<string, number> = {};
  for (const a of rows) counts[a.status] = (counts[a.status] ?? 0) + 1;
  return {
    items: slice.map((a) => {
      const r = review.get(a.id);
      return {
        ...summary(a, applicants.find((w) => w.id === a.applicant_workspace_id), consents.some((c) => c.applicant_workspace_id === a.applicant_workspace_id)),
        // Mean overall score (0–100) of the submitted reviews in the application's current stage.
        score: r?.score ?? null,
        reviews: { assigned: r?.assigned ?? 0, submitted: r?.submitted ?? 0, complete: r?.complete ?? false },
        daysInStage: r?.daysInStage ?? null,
        flagged: flagged(a),
      };
    }),
    total: rows.length,
    counts,
  };
}

interface ReviewFacts {
  score: number | null;
  assigned: number;
  submitted: number;
  complete: boolean;
  spreadFlag: boolean;
  daysInStage: number | null;
}

/** Review progress and time in stage for a set of applications, in a fixed number of queries. */
async function reviewFacts(ctx: ServiceContext, workspaceId: string, apps: App[]): Promise<Map<string, ReviewFacts>> {
  const out = new Map<string, ReviewFacts>();
  if (!apps.length) return out;
  const ids = apps.map((a) => a.id);
  const [assignments, events] = await Promise.all([ctx.repos.table("review_assignments").find({ workspace_id: workspaceId, application_id: ids }), ctx.repos.table("application_events").find({ application_id: ids }, { orderBy: "created_at" })]);
  const reviews = assignments.length ? (await ctx.repos.table("reviews").find({ assignment_id: assignments.map((a) => a.id) })).filter((r) => r.submitted_at) : [];
  const rubrics = new Map<string, Rubric | null>();
  const now = ctx.now().getTime();
  for (const app of apps) {
    const mine = assignments.filter((a) => a.application_id === app.id && a.stage === app.stage && a.status !== "recused");
    const overall: number[] = [];
    for (const a of mine) {
      const review = reviews.find((r) => r.assignment_id === a.id);
      if (!review) continue;
      const k = `${a.rubric_id}:${a.rubric_version}`;
      if (!rubrics.has(k)) {
        const row = await ctx.repos.table("rubrics").one({ id: a.rubric_id, version: a.rubric_version });
        rubrics.set(k, row ? toRubric(row) : null);
      }
      const rubric = rubrics.get(k);
      const scored = rubric ? scoreReview(rubric, review.scores as Scores).overall : null;
      if (scored !== null) overall.push(scored);
    }
    const avg = overall.length ? overall.reduce((s, x) => s + x, 0) / overall.length : null;
    const spread = overall.length > 1 ? Math.sqrt(overall.reduce((s, x) => s + (x - avg!) ** 2, 0) / (overall.length - 1)) : 0;
    const entered = [...events].reverse().find((e) => e.application_id === app.id && e.to_stage === app.stage)?.created_at ?? app.submitted_at;
    out.set(app.id, {
      score: avg === null ? null : Math.round(avg * 10) / 10,
      assigned: mine.length,
      submitted: overall.length,
      complete: mine.length > 0 && mine.every((a) => a.status === "submitted"),
      spreadFlag: spread > 15,
      daysInStage: entered ? Math.max(0, Math.floor((now - Date.parse(entered)) / 86_400_000)) : null,
    });
  }
  return out;
}

async function funderApp(ctx: ServiceContext, appId: string, scope: "applications:read" | "applications:write") {
  // `access` admits a reviewer only for an application assigned to them; the detail below masks it.
  const found = await access(ctx, appId, scope, { reviewers: true });
  if (found.side !== "funder") throw new ApiError(403, "wrong_workspace_kind", "This action belongs to funder workspaces");
  return found;
}

export async function getApplicationDetail(ctx: ServiceContext, appId: string) {
  const { app, ws } = await funderApp(ctx, appId, "applications:read");
  const applicant = required(await ctx.repos.table("workspaces").one({ id: app.applicant_workspace_id }), "Applicant");
  const consented = !!(await ctx.repos.table("consents").one({ funder_workspace_id: ws.id, applicant_workspace_id: applicant.id, revoked_at: null }));
  const external = ws.role === "external_reviewer";
  const reviewer = !!ws.role && REVIEWER_ROLES.includes(ws.role);
  const responses = [];
  for (const r of await responsesOf(ctx, app.id)) {
    const form = await ctx.repos.table("forms").one({ id: r.form_id, version: r.form_version });
    let response = r.response as JsonObject;
    let masked: string[] = [];
    if (reviewer) {
      // Reviewers get only reviewer-visible fields; external reviewers also lose PII (§10.5). The
      // same function masks the CommonGrants record, so the two views cannot drift apart.
      const m = await reviewerResponse(ctx, r, { external });
      response = m.row.response as JsonObject;
      masked = m.masked;
    }
    responses.push({ formId: apiId("form", r.form_id), formVersion: r.form_version, formTitle: form?.title ?? null, stage: r.stage, status: r.status, response, provenance: reviewer ? {} : r.provenance, sectionAssignments: reviewer ? {} : r.section_assignments, validationErrors: r.validation_errors, lockedAt: r.locked_at, masked });
  }
  const events = await ctx.repos.table("application_events").find({ application_id: app.id }, { orderBy: "created_at" });
  const facts = orgFacts(applicant);
  const fields = readPassportFields(facts.source === "passport" ? facts.org : null);
  return {
    ...summary(app, applicant, consented),
    attestationUrl: app.attestation_url,
    eligibilityResults: app.eligibility,
    decisionId: app.decision_id,
    // What the applicant shared by applying: the cached record, while their consent stands. An
    // external reviewer never sees who the applicant's contacts are.
    organization: consented && !external ? { source: facts.source, projection: facts.source === "passport" ? facts.org : null, selfDeclared: facts.source === "self_declared" ? selfDeclaredOf(applicant) : null, level: facts.source === "passport" ? applicant.verification_level : null, verifiedAt: fields.verifiedAt, syncedAt: applicant.org_projection_at, levelChangedSinceSubmit: !!app.verification_level_at_submit && applicant.verification_level !== app.verification_level_at_submit } : null,
    formResponses: responses,
    timeline: events.map((e) => ({ id: e.id, type: e.type, fromStatus: e.from_status, toStatus: e.to_status, fromStage: e.from_stage, toStage: e.to_stage, payload: reviewer ? {} : eventPayload(e), revision: reviewer ? null : revisionOf(e), actor: e.actor, at: e.created_at })),
  };
}

/** Re-run the opportunity's rules against the application as it stands (e.g. after an org change). */
export async function rerunEligibility(ctx: ServiceContext, appId: string) {
  const { app } = await funderApp(ctx, appId, "applications:read");
  const applicant = required(await ctx.repos.table("workspaces").one({ id: app.applicant_workspace_id }), "Applicant");
  return runRules(ctx, app.opportunity_id, applicant, await responsesOf(ctx, app.id));
}

// ------------------------------------------------------------------------------------ actions

const applicantOf = async (ctx: ServiceContext, app: App) => required(await ctx.repos.table("workspaces").one({ id: app.applicant_workspace_id }), "Applicant");
const letterFields = (ctx: ServiceContext, app: App, applicant: Ws, funder: Ws, opportunityTitle: string) => ({
  recipient: { name: applicant.display_name },
  funder: { name: funder.display_name },
  application: { title: app.title },
  opportunity: { title: opportunityTitle },
  links: { application: `${ctx.config.webBaseUrl}/w/${applicant.handle}/applications/app_${app.id}/edit`, status: `${ctx.config.webBaseUrl}/w/${applicant.handle}/applications/app_${app.id}` },
});

export const advanceInput = z.object({ toStage: z.string().min(1).max(60), note: z.string().trim().max(2000).optional() }).strict();

export async function advanceApplication(ctx: ServiceContext, appId: string, input: z.output<typeof advanceInput>) {
  const { app } = await funderApp(ctx, appId, "applications:write");
  const competition = required(await ctx.repos.table("competitions").one({ id: app.competition_id }), "Competition");
  const applicant = await applicantOf(ctx, app);
  const stages: StageDef[] = stagesOf(competition).map((s) => ({ key: s.key, label: s.label, forms: s.forms ?? {}, entryFrom: s.entryFrom ?? [], requiresSubmission: s.requiresSubmission ?? true, decisionRequired: s.decisionRequired }));
  let updated = app;
  const plan = await advanceStage({ id: app.id, status: app.status as never, stage: app.stage }, stages, input.toStage, { id: ctx.actor.id, kind: "funder" }, {
    write: async (change) => {
      const [row] = await ctx.repos.table("applications").update({ id: app.id, status: change.from }, { status: change.to, stage: input.toStage, ...(change.to === "draft" ? { cg_status: "inProgress", cg_custom_value: null } : {}) });
      if (!row) throw new ApiError(409, "conflict", "This application changed while you were working. Reload and try again");
      updated = row;
    },
    applyStageEffects: async (fx) => {
      if (fx.lockResponsesOfStage) await ctx.repos.table("form_responses").update({ application_id: app.id, stage: fx.lockResponsesOfStage, locked_at: null }, { locked_at: ctx.now().toISOString() });
      await createStageResponses(ctx, updated, competition, input.toStage, applicant);
    },
    ledger: (e) => audit(ctx, e.eventType, e.subjectType, e.subjectId, e.data),
    emit: async (e) => {
      await fanOut({ id: crypto.randomUUID(), type: "application.status.changed", workspaceId: app.workspace_id, occurredAt: ctx.now().toISOString(), data: { subjectType: e.subjectType, subjectId: e.subjectId, ...e.data } }, { store: ctx.webhooks, now: ctx.now });
    },
  });
  if (!plan.ok) throw new ApiError(plan.code === "unknown_stage" ? 422 : 409, plan.code, plan.reason);
  await recordEvent(ctx, updated, "advance", { fromStatus: app.status, toStatus: updated.status, fromStage: plan.fromStage, toStage: plan.toStage, payload: input.note ? { note: input.note } : {} });
  return { id: apiId("application", app.id), stage: updated.stage, status: updated.status };
}

export const revisionInput = z
  .object({
    message: z.string().trim().min(1).max(5000),
    dueAt: z.iso.datetime({ offset: true }).optional(),
    /** Form id → field paths the applicant is asked to revise (shown to the applicant; every field of the stage is editable). */
    fields: z.record(z.string(), z.array(z.string().max(500)).max(100)).optional(),
  })
  .strict();

export async function requestRevision(ctx: ServiceContext, appId: string, input: z.output<typeof revisionInput>) {
  const { app, ws } = await funderApp(ctx, appId, "applications:write");
  const updated = await transitionApp(ctx, app, "request_revision", "funder", { revisionNote: input.message }, { message: input.message, dueAt: input.dueAt ?? null, fields: input.fields ?? null, snapshot: await revisionSnapshot(ctx, app) });
  // The applicant edits the current stage again; earlier stages stay locked.
  await ctx.repos.table("form_responses").update({ application_id: app.id, stage: app.stage }, { locked_at: null });
  const applicant = await applicantOf(ctx, app);
  const funder = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const opp = required(await ctx.repos.table("opportunities").one({ id: app.opportunity_id }), "Opportunity");
  const letter = await sendLetter(ctx, "revision_request", await recipientEmails(ctx, applicant), { ...letterFields(ctx, app, applicant, funder, opp.title), revision: { message: input.message, dueDate: input.dueAt?.slice(0, 10) ?? "the date agreed with your program officer" } }, { type: "application", id: app.id, workspaceId: ws.id });
  return { id: apiId("application", app.id), status: updated.status, letter };
}

export const declineInput = z.object({ rationale: z.string().trim().max(5000).optional(), letterTemplateId: z.string().max(100).optional(), sendLetter: z.boolean().default(true) }).strict();

/**
 * Decline at triage or after review. A decline is a decision: it is recorded as a committed row in
 * `decisions` so the application always points at who decided and why.
 */
export async function declineApplication(ctx: ServiceContext, appId: string, input: z.output<typeof declineInput>) {
  const { app, ws } = await funderApp(ctx, appId, "applications:write");
  await authorize(ctx, { scope: "decisions:write", kind: "funder" });
  requireApproval(ctx, "Declining an application");
  const at = ctx.now().toISOString();
  const decision = await ctx.repos.table("decisions").insert({ workspace_id: ws.id, competition_id: app.competition_id, application_id: app.id, stage: app.stage, outcome: "decline", rationale: input.rationale ?? null, currency: app.currency, proposed_by: ctx.actor.id, decided_by: ctx.actor.userId, committed_at: at });
  let updated: App;
  try {
    updated = await transitionApp(ctx, app, "decline", "funder", { decisionId: decision.id }, { rationale: input.rationale ?? null });
  } catch (e) {
    // The application could not be declined from its current status: the decision never stood.
    await ctx.repos.table("decisions").remove({ id: decision.id });
    throw e;
  }
  await audit(ctx, "decision.committed", "decision", decision.id, { applicationId: app.id, outcome: "decline" });
  await fanOut({ id: crypto.randomUUID(), type: "decision.committed", workspaceId: ws.id, occurredAt: at, data: { decisionId: decision.id, applicationId: app.id, outcome: "decline" } }, { store: ctx.webhooks, now: ctx.now });
  let letter: { sent: boolean; reason?: string } = { sent: false, reason: "No letter was requested" };
  if (input.sendLetter) {
    const applicant = await applicantOf(ctx, app);
    const funder = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
    const opp = required(await ctx.repos.table("opportunities").one({ id: app.opportunity_id }), "Opportunity");
    letter = await sendLetter(ctx, "decline", await recipientEmails(ctx, applicant), { ...letterFields(ctx, app, applicant, funder, opp.title), decision: { message: input.rationale ?? "" } }, { type: "application", id: app.id, workspaceId: ws.id });
  }
  return { id: apiId("application", app.id), status: updated.status, decisionId: decision.id, letter };
}

/** The decline letter for one application as it would be sent, without sending or deciding anything. */
export async function declineLetterPreview(ctx: ServiceContext, appId: string, rationale?: string) {
  const { app, ws } = await funderApp(ctx, appId, "applications:read");
  const applicant = await applicantOf(ctx, app);
  const funder = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const opp = required(await ctx.repos.table("opportunities").one({ id: app.opportunity_id }), "Opportunity");
  const consented = !!(await ctx.repos.table("consents").one({ funder_workspace_id: ws.id, applicant_workspace_id: applicant.id, revoked_at: null }));
  const rendered = await renderLetter(ctx, "decline", { ...letterFields(ctx, app, applicant, funder, opp.title), decision: { message: rationale ?? "" } }, ws.id);
  return { applicationId: apiId("application", app.id), title: app.title, applicant: applicant.display_name, hasRecipientEmail: consented && (await recipientEmails(ctx, applicant)).length > 0, subject: rendered.subject, html: rendered.html, text: rendered.text };
}

const TAG = z.string().trim().min(1).max(40).regex(/^[\w .:/-]+$/u, "Use letters, digits, spaces and . : / - _");
export const tagsInput = z.object({ add: z.array(TAG).max(20).default([]), remove: z.array(TAG).max(20).default([]) }).strict();

export async function tagApplication(ctx: ServiceContext, appId: string, input: z.output<typeof tagsInput>) {
  const { app } = await funderApp(ctx, appId, "applications:write");
  const tags = [...new Set([...app.tags.filter((t) => !input.remove.includes(t)), ...input.add])].slice(0, 30);
  await ctx.repos.table("applications").update({ id: app.id }, { tags });
  await audit(ctx, "application.tagged", "application", app.id, { added: input.add, removed: input.remove });
  return { id: apiId("application", app.id), tags };
}

export const assignInput = z.object({ userId: z.uuid().nullable() }).strict();

export async function assignApplication(ctx: ServiceContext, appId: string, input: z.output<typeof assignInput>) {
  const { app, ws } = await funderApp(ctx, appId, "applications:write");
  if (input.userId && !(await ctx.repos.table("workspace_members").one({ workspace_id: ws.id, user_id: input.userId }))) throw new ApiError(422, "not_a_member", "That person is not a member of this workspace");
  await ctx.repos.table("applications").update({ id: app.id }, { assigned_to_user_id: input.userId });
  await audit(ctx, "application.assigned", "application", app.id, { userId: input.userId });
  return { id: apiId("application", app.id), assignedToUserId: input.userId };
}

export const bulkInput = z
  .object({
    action: z.enum(["decline", "tag", "assign", "advance"]),
    applicationIds: z.array(z.string()).min(1).max(200),
    /** The same body the single-application route takes for this action. */
    params: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

/** One action over many applications. Each application succeeds or fails on its own; nothing is rolled back. */
export async function bulkApplications(ctx: ServiceContext, input: z.output<typeof bulkInput>, uuids: string[]) {
  await authorize(ctx, { scope: "applications:write", kind: "funder" });
  if (input.action === "decline") requireApproval(ctx, "Declining applications");
  const bad = (e: z.ZodError) => new ApiError(400, "bad_request", "params is not valid for this action", e.issues.map((i) => ({ code: "invalid_field", field: `params.${i.path.map(String).join(".")}`, detail: i.message })));
  const params = <S extends z.ZodType>(schema: S): z.output<S> => {
    const r = schema.safeParse(input.params);
    if (!r.success) throw bad(r.error);
    return r.data;
  };
  const run: (id: string) => Promise<{ letterSent?: boolean }> =
    input.action === "decline"
      ? ((p) => async (id) => ({ letterSent: (await declineApplication(ctx, id, p)).letter.sent }))(params(declineInput))
      : input.action === "tag"
        ? ((p) => async (id) => (await tagApplication(ctx, id, p), {}))(params(tagsInput))
        : input.action === "assign"
          ? ((p) => async (id) => (await assignApplication(ctx, id, p), {}))(params(assignInput))
          : ((p) => async (id) => (await advanceApplication(ctx, id, p), {}))(params(advanceInput));

  const succeeded: string[] = [];
  const failed: { id: string; message: string }[] = [];
  let lettersSent = 0;
  for (const id of uuids) {
    try {
      if ((await run(id)).letterSent) lettersSent++;
      succeeded.push(apiId("application", id));
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      failed.push({ id: apiId("application", id), message: e.message });
    }
  }
  await audit(ctx, "applications.bulk", "workspace", ctx.workspace!.id, { action: input.action, requested: uuids.length, succeeded: succeeded.length, lettersSent });
  return { action: input.action, requested: uuids.length, succeeded, failed, lettersSent };
}
