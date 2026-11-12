// SPDX-License-Identifier: AGPL-3.0-only
// Applying (build spec §11.4): start with Passport prefill, edit form responses with merge
// semantics, submit. These functions back the CommonGrants `/applications` routes and the applicant
// MCP tools alike. Status changes go through the application machine in `@gms/workflow`.
import { computeResponseStatus, extractSubmissionFields, maskForReviewer, mergeResponse, passportFieldPaths, prefill, buildPrefillSource, projectToCommonGrants, validateResponse, type FormDefinition, type JsonObject, type Provenance, type ProvenanceSource } from "@gms/forms";
import { DEFAULT_TEMPLATES, renderEmail } from "@gms/notify";
import { filtered, matchesFilter, parseSearchRequest, projectApplication, projectFormResponse, readPath, sortByPath, toMinor, unionStageForms, type ApplicationBase, type ApplicationRow, type FormResponseRow, type StageJson } from "@gms/protocol";
import { evaluate, parseRules, type Evaluation } from "@gms/rules";
import { applicationCgStatus, applicationMachine, type ApplicationAction, type ApplicationContext, type ApplicationStatus } from "@gms/workflow";
import { fanOut, isWebhookEventType } from "@gms/webhooks";
import { z } from "zod";
import { ApiError, notFound } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { audit, authorize, requireApproval, required, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import { toDefinition } from "./forms.ts";
import { applicantOptionsOf } from "./opportunities.ts";
import { orgFacts, recipientEmails } from "./profile.ts";
import type { Row } from "./repos/types.ts";

export type App = Row<"applications">;
export type Resp = Row<"form_responses">;
type Ws = Row<"workspaces">;
type Comp = Row<"competitions">;
type J = App["eligibility"];

export const stagesOf = (c: Comp): StageJson[] => (Array.isArray(c.stages) ? (c.stages as unknown as StageJson[]) : []);
/** The forms an application fills in a stage; a competition without stages uses its pinned forms as one stage. */
export const stageForms = (c: Comp, stageKey: string): Record<string, number> => {
  const stage = stagesOf(c).find((s) => s.key === stageKey);
  return stage ? (stage.forms ?? {}) : unionStageForms([], c.forms as Record<string, number>);
};
export const firstStage = (c: Comp): string => {
  const stages = stagesOf(c);
  return (stages.find((s) => !(s.entryFrom ?? []).length) ?? stages[0])?.key ?? "application";
};

export const appRow = (a: App): ApplicationRow => ({ ...a, status: a.status as ApplicationRow["status"], eligibility: a.eligibility as ApplicationRow["eligibility"] });
export const respRow = (r: Resp): FormResponseRow => ({
  id: r.id,
  application_id: r.application_id!,
  form_id: r.form_id,
  form_version: r.form_version,
  response: r.response as FormResponseRow["response"],
  status: r.status as FormResponseRow["status"],
  validation_errors: r.validation_errors as unknown[],
  provenance: r.provenance as Record<string, string>,
  locked_at: r.locked_at,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

export async function responsesOf(ctx: ServiceContext, appId: string): Promise<Resp[]> {
  return ctx.repos.table("form_responses").find({ application_id: appId }, { orderBy: "created_at" });
}

// ------------------------------------------------------------------------------------ reviewers
//
// One rule for every read of an application (red team 2026-11): a reviewer sees the applications
// assigned to them, masked, and nothing else. It used to live only in the inbox, so the CommonGrants
// routes, the MCP resource and the side reads served every submitted application in full.

export const REVIEWER_ROLES: readonly string[] = ["reviewer", "external_reviewer"];

/** How a reviewer sees an application. `external` reviewers also lose personal data. */
export interface ReviewerView {
  external: boolean;
}

/** The caller's reviewer view in a funder workspace, or null for staff and for applicants. */
export const reviewerView = (ws: ServiceWorkspace): ReviewerView | null => (ws.kind === "funder" && !!ws.role && REVIEWER_ROLES.includes(ws.role) ? { external: ws.role === "external_reviewer" } : null);

/**
 * The applications a reviewer may see: those assigned to them and not recused; for an external
 * reviewer invited to named competitions, only within those. Null for everyone who is not a reviewer.
 */
export async function reviewerApplicationIds(ctx: ServiceContext, ws: ServiceWorkspace): Promise<Set<string> | null> {
  if (!reviewerView(ws)) return null;
  if (!ctx.actor.userId) return new Set();
  const mine = (await ctx.repos.table("review_assignments").find({ workspace_id: ws.id, reviewer_user_id: ctx.actor.userId })).filter((a) => a.status !== "recused");
  const scoped = (ws.memberScope as { competitionIds?: unknown } | null | undefined)?.competitionIds;
  if (!Array.isArray(scoped) || !mine.length) return new Set(mine.map((a) => a.application_id));
  const apps = await ctx.repos.table("applications").find({ id: [...new Set(mine.map((a) => a.application_id))], workspace_id: ws.id });
  return new Set(apps.filter((a) => (scoped as unknown[]).includes(a.competition_id)).map((a) => a.id));
}

/** A response as a reviewer may read it: hidden fields removed, personal data masked for external reviewers, no provenance. */
export async function reviewerResponse(ctx: ServiceContext, r: Resp, reviewer: ReviewerView): Promise<{ row: Resp; masked: string[] }> {
  const form = await ctx.repos.table("forms").one({ id: r.form_id, version: r.form_version });
  // Without the form there are no field flags to apply: show nothing rather than everything.
  const m = form ? maskForReviewer(toDefinition(form), r.response as JsonObject, reviewer) : { response: {}, masked: [], removed: Object.keys((r.response as JsonObject) ?? {}).map((k) => `/${k}`) };
  return { row: { ...r, response: m.response as Resp["response"], provenance: {} as Resp["provenance"], validation_errors: [] as unknown as Resp["validation_errors"], section_assignments: {} as Resp["section_assignments"] }, masked: [...m.masked, ...m.removed] };
}

/** What the rules decided, without the values they found in the applicant's record. */
const outcomesOnly = (e: App["eligibility"]): App["eligibility"] => {
  const v = e as { results?: unknown[] } | null;
  if (!v || !Array.isArray(v.results)) return e;
  return { ...v, results: v.results.map((r) => (r && typeof r === "object" ? Object.fromEntries(Object.entries(r as Record<string, unknown>).filter(([k]) => k !== "actual" && k !== "explain")) : r)) } as App["eligibility"];
};

/** The CommonGrants record of an application; for a reviewer, masked and without who the applicant is. */
export async function project(ctx: ServiceContext, app: App, reviewer: ReviewerView | null = null): Promise<ApplicationBase> {
  const rows = await responsesOf(ctx, app.id);
  if (!reviewer) return projectApplication({ application: appRow(app), formResponses: rows.map(respRow) });
  const masked: Resp[] = [];
  for (const r of rows) masked.push((await reviewerResponse(ctx, r, reviewer)).row);
  const out = projectApplication({ application: appRow({ ...app, eligibility: outcomesOnly(app.eligibility) }), formResponses: masked.map(respRow) });
  const gms = (out.customFields as Record<string, { value?: Record<string, unknown> }> | undefined)?.gms?.value;
  if (gms) delete gms.applicantWorkspaceId;
  return out;
}

/**
 * Who may see an application, and from which side. 404 for everyone else.
 *
 * Reviewers are refused unless the caller says it serves them (`reviewers: true`), and then only
 * for an application assigned to them. A caller that passes `reviewers: true` must show the
 * reviewer's view: `project(ctx, app, reviewer)` or `reviewerResponse`. Everything else (budget,
 * follow-ups, threads, attachments, agent tools) is staff's and the applicant's, so a new read of
 * an application is closed to reviewers until someone decides what a reviewer should see of it.
 */
export async function access(
  ctx: ServiceContext,
  appId: string,
  scope: "applications:read" | "applications:write" | "applications:submit",
  opts: { reviewers?: boolean } = {},
): Promise<{ app: App; side: "applicant" | "funder"; ws: ServiceWorkspace; reviewer: ReviewerView | null }> {
  const ws = await authorize(ctx, { scope });
  const app = await ctx.repos.table("applications").one({ id: appId });
  if (app && app.applicant_workspace_id === ws.id && ws.kind === "applicant") {
    // A consultant sees only the applications named in their membership scope.
    const allowed = ws.role === "consultant" ? (ws.memberScope?.applicationIds as string[] | undefined) : undefined;
    if (ws.role === "consultant" && !(allowed ?? []).includes(app.id)) throw notFound("Application");
    return { app, side: "applicant", ws, reviewer: null };
  }
  // The funder sees an application once it has been submitted; drafts belong to the applicant.
  if (app && app.workspace_id === ws.id && ws.kind === "funder" && app.submitted_at) {
    const reviewer = reviewerView(ws);
    if (reviewer && !(opts.reviewers && (await reviewerApplicationIds(ctx, ws))?.has(app.id))) throw notFound("Application");
    return { app, side: "funder", ws, reviewer };
  }
  throw notFound("Application");
}

async function formDef(ctx: ServiceContext, formId: string, version: number): Promise<FormDefinition> {
  return toDefinition(required(await ctx.repos.table("forms").one({ id: formId, version }), "Form"));
}

function checked(def: FormDefinition, response: JsonObject, provenance: Provenance) {
  return { status: computeResponseStatus(def, response, provenance), validation_errors: validateResponse(def, response).validationErrors as unknown as Resp["validation_errors"] };
}

export async function runRules(ctx: ServiceContext, opportunityId: string, applicant: Ws, responses: Resp[], applicantType?: string): Promise<Evaluation & { evaluatedAt: string; factsSource: string }> {
  const opp = required(await ctx.repos.table("opportunities").one({ id: opportunityId }), "Opportunity");
  const parsed = parseRules(opp.eligibility_rules);
  const facts = orgFacts(applicant);
  const form = Object.fromEntries(responses.map((r) => [r.form_id, r.response as Record<string, unknown>]));
  // What the organization entered itself counts only as far as the funder accepts it; facts only
  // Passport holds cannot be checked without Passport (packages/rules).
  const opts = { selfReported: facts.source === "passport" ? [] : ["org", "profile"], acceptSelfReported: applicantOptionsOf(opp).acceptSelfReported, passportFacts: facts.source === "passport" };
  const type = applicantType ?? (facts.source === "self_declared" ? ((facts.org.orgType as { term?: string } | undefined)?.term ?? undefined) : undefined);
  // Rules that do not parse cannot decide anything: the result is `unknown`, for a person to look at.
  const result: Evaluation = parsed.ok ? evaluate(parsed.rules, { org: facts.org, profile: facts.profile ?? undefined, form, applicant: { type } }, opts) : { eligible: "unknown", results: [] };
  return { ...result, evaluatedAt: ctx.now().toISOString(), factsSource: facts.source };
}

/** Create the `notStarted` responses of a stage, prefilled from the applicant's Passport record or self-declared profile. */
export async function createStageResponses(ctx: ServiceContext, app: App, competition: Comp, stageKey: string, applicant: Ws): Promise<void> {
  const facts = orgFacts(applicant);
  const source = buildPrefillSource(facts.org, facts.profile);
  for (const [formId, version] of Object.entries(stageForms(competition, stageKey))) {
    if (await ctx.repos.table("form_responses").one({ application_id: app.id, form_id: formId })) continue;
    const def = await formDef(ctx, formId, version);
    const filled = prefill(def, source, {}, { as: facts.source === "self_declared" ? "self_declared" : "passport" });
    await ctx.repos.table("form_responses").insert({
      workspace_id: app.workspace_id,
      application_id: app.id,
      form_id: formId,
      form_version: version,
      stage: stageKey,
      response: filled.response as Resp["response"],
      provenance: filled.provenance as Resp["provenance"],
      ...checked(def, filled.response, filled.provenance),
    });
  }
}

export async function recordEvent(ctx: ServiceContext, app: App, type: string, change: { fromStatus?: string | null; toStatus?: string | null; fromStage?: string | null; toStage?: string | null; payload?: Record<string, unknown> } = {}): Promise<void> {
  await ctx.repos.table("application_events").insert({
    workspace_id: app.workspace_id,
    application_id: app.id,
    type,
    from_status: change.fromStatus ?? null,
    to_status: change.toStatus ?? null,
    from_stage: change.fromStage ?? null,
    to_stage: change.toStage ?? null,
    payload: (change.payload ?? {}) as Row<"application_events">["payload"],
    actor: ctx.actor.id,
  });
}

/**
 * Run an application-machine action. The ledger entry and webhooks belong to the funder's
 * workspace (that is whose application inbox changed), whichever side acted.
 */
export async function transitionApp(ctx: ServiceContext, app: App, action: ApplicationAction, side: "applicant" | "funder", machineCtx: ApplicationContext, eventPayload: Record<string, unknown> = {}): Promise<App> {
  let updated = app;
  const result = await applicationMachine.transition({ id: app.id, status: app.status as ApplicationStatus }, action, { id: ctx.actor.id, kind: side }, { ...machineCtx, now: ctx.now().toISOString() }, {
    write: async (change) => {
      const cg = applicationCgStatus(change.to as ApplicationStatus);
      const [row] = await ctx.repos.table("applications").update({ id: app.id, status: change.from }, { status: change.to, cg_status: cg.value, cg_custom_value: cg.customValue ?? null, ...(change.patch as Partial<App>) });
      // The compare-and-set on `status` lost: someone else moved the application first.
      if (!row) throw new ApiError(409, "conflict", "This application changed while you were working. Reload and try again");
      updated = row;
    },
    ledger: (e) => audit(ctx, e.eventType, e.subjectType, e.subjectId, e.data, app.workspace_id),
    emit: async (e) => {
      if (!isWebhookEventType(e.type)) return;
      await fanOut({ id: crypto.randomUUID(), type: e.type, workspaceId: app.workspace_id, occurredAt: ctx.now().toISOString(), data: { subjectType: e.subjectType, subjectId: e.subjectId, ...e.data } }, { store: ctx.webhooks, now: ctx.now });
    },
  });
  if (!result.ok) throw new ApiError(result.code === "actor_not_allowed" ? 403 : 409, result.code, result.reason);
  await recordEvent(ctx, updated, action, { fromStatus: result.from, toStatus: result.to, fromStage: app.stage, toStage: updated.stage, payload: eventPayload });
  return updated;
}

/** Send one templated letter. A missing mail port or address is reported, never thrown: mail must not undo a status change. */
/**
 * Render one of the built-in letters as it would be sent. A workspace overrides a built-in letter
 * by saving an email template under the same name ("Decline", "Award and agreement", …); email
 * templates are stored as `Subject: …` + body.
 */
export async function renderLetter(ctx: Pick<ServiceContext, "repos">, kind: keyof typeof DEFAULT_TEMPLATES, fields: Parameters<typeof renderEmail>[1], workspaceId: string) {
  const base = DEFAULT_TEMPLATES[kind];
  const custom = (await ctx.repos.table("templates").find({ workspace_id: workspaceId, kind: "email", name: base.name }, { orderBy: "version", ascending: false, limit: 1 }))[0];
  const split = custom ? /^Subject: ([^\n]*)\n\n?([\s\S]*)$/.exec(custom.body) : null;
  return renderEmail(custom ? { ...base, subject: split?.[1] ?? base.subject, body: split?.[2] ?? custom.body } : base, fields);
}

export async function sendLetter(ctx: ServiceContext, kind: keyof typeof DEFAULT_TEMPLATES, to: string | readonly string[] | null | undefined, fields: Parameters<typeof renderEmail>[1], subject: { type: string; id: string; workspaceId: string }): Promise<{ sent: boolean; reason?: string }> {
  if (!ctx.ports.mailer || !ctx.config.mailFrom) return { sent: false, reason: "Outbound mail is not configured" };
  const recipients = (typeof to === "string" ? [to] : [...(to ?? [])]).filter(Boolean);
  if (!recipients.length) return { sent: false, reason: "No email address is known for this organization" };
  try {
    const rendered = await renderLetter(ctx, kind, fields, subject.workspaceId);
    const { id } = await ctx.ports.mailer.send({ from: ctx.config.mailFrom, to: recipients, subject: rendered.subject, html: rendered.html, text: rendered.text, idempotencyKey: `${kind}:${subject.id}:${ctx.now().toISOString().slice(0, 10)}` });
    await audit(ctx, "communication.sent", subject.type, subject.id, { template: kind, messageId: id }, subject.workspaceId);
    return { sent: true };
  } catch (e) {
    await audit(ctx, "communication.failed", subject.type, subject.id, { template: kind, error: e instanceof Error ? e.name : "error" }, subject.workspaceId);
    return { sent: false, reason: "The letter could not be sent" };
  }
}

export { primaryEmail, recipientEmails } from "./profile.ts";

// ------------------------------------------------------------------------------------ start

export const startInput = z
  .object({
    competitionId: z.uuid(),
    /** CommonGrants names the applicant organization; it must be the caller's own Passport organization. */
    organizationId: z.uuid().optional(),
    applicantOrgId: z.uuid().optional(),
    title: z.string().trim().min(1).max(300).optional(),
  })
  .loose();

/** A Passport organization with a consent the applicant has not withdrawn. */
export async function hasLivePassportLink(ctx: ServiceContext, ws: Ws): Promise<boolean> {
  return !!ws.passport_org_id && !!(await ctx.repos.table("passport_links").one({ workspace_id: ws.id, mode: "applicant_consent", revoked_at: null }));
}

export async function startApplication(ctx: ServiceContext, input: z.output<typeof startInput>): Promise<{ application: ApplicationBase; created: boolean }> {
  const ws = await authorize(ctx, { scope: "applications:write", kind: "applicant" });
  const applicant = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const named = input.organizationId ?? input.applicantOrgId;
  if (named && named !== applicant.passport_org_id) throw new ApiError(403, "wrong_organization", "You can only apply for the organization this workspace is linked to in Passport");

  const competition = await ctx.repos.table("competitions").one({ id: input.competitionId });
  const opp = competition ? await ctx.repos.table("opportunities").one({ id: competition.opportunity_id }) : null;
  if (!competition || !opp || competition.status === "draft" || !opp.published_at) throw notFound("Competition");
  if (applicantOptionsOf(opp).requirePassport && !(await hasLivePassportLink(ctx, applicant))) {
    throw new ApiError(403, "passport_required", "This funder asks applicants to connect OpenGrants Passport before applying. Connect Passport in Settings, then start the application again");
  }

  // Starting twice returns the application already in progress.
  const existing = (await ctx.repos.table("applications").find({ competition_id: competition.id, applicant_workspace_id: ws.id })).find((a) => a.status !== "withdrawn" && a.status !== "declined");
  if (existing) return { application: await project(ctx, existing), created: false };
  if (competition.status !== "open") throw new ApiError(409, "competition_closed", "This competition is not open to new applications");

  const stage = firstStage(competition);
  let app = await ctx.repos.table("applications").insert({
    workspace_id: competition.workspace_id,
    applicant_workspace_id: ws.id,
    competition_id: competition.id,
    opportunity_id: opp.id,
    title: input.title ?? opp.title,
    stage,
    currency: ((opp.funding as { currency?: string } | null)?.currency ?? "USD").toUpperCase().slice(0, 3),
  });
  await createStageResponses(ctx, app, competition, stage, applicant);
  const preview = await runRules(ctx, opp.id, applicant, await responsesOf(ctx, app.id));
  [app] = (await ctx.repos.table("applications").update({ id: app.id }, { eligibility: { ...preview, preview: true } as unknown as J })) as [App];
  await recordEvent(ctx, app, "started", { toStatus: "draft", toStage: stage });
  await audit(ctx, "application.started", "application", app.id, { competitionId: competition.id, applicantWorkspaceId: ws.id }, competition.workspace_id);
  return { application: await project(ctx, app), created: true };
}

export async function getApplication(ctx: ServiceContext, appId: string): Promise<ApplicationBase> {
  const { app, reviewer } = await access(ctx, appId, "applications:read", { reviewers: true });
  return project(ctx, app, reviewer);
}

// ------------------------------------------------------------------------------------ form responses

async function responseFor(ctx: ServiceContext, app: App, formId: string): Promise<Resp> {
  return required(await ctx.repos.table("form_responses").one({ application_id: app.id, form_id: formId }), "Form response");
}

export async function getFormResponse(ctx: ServiceContext, appId: string, formId: string) {
  const { app, reviewer } = await access(ctx, appId, "applications:read", { reviewers: true });
  const row = await responseFor(ctx, app, formId);
  return projectFormResponse(respRow(reviewer ? (await reviewerResponse(ctx, row, reviewer)).row : row));
}

export const formResponseInput = z.object({ response: z.record(z.string(), z.unknown()) }).loose();

/** One write path for a form response: the applicant's own edits, an agent's, or an inserted library answer. */
export async function writeFormResponse(ctx: ServiceContext, app: App, formId: string, patch: JsonObject, actor: ProvenanceSource) {
  if (app.status !== "draft" && app.status !== "revision_requested") throw new ApiError(409, "application_locked", `This application is ${app.status.replace(/_/g, " ")} and can no longer be edited`);
  const row = await responseFor(ctx, app, formId);
  if (row.locked_at) throw new ApiError(409, "response_locked", "This form belongs to an earlier stage and is read-only");
  const def = await formDef(ctx, formId, row.form_version);
  // Fields that follow Passport are read-only only where there is a Passport record to follow.
  const applicant = await ctx.repos.table("workspaces").one({ id: app.applicant_workspace_id });
  const lockedPaths = applicant && orgFacts(applicant).source === "passport" ? passportFieldPaths(def) : [];
  const merged = mergeResponse(row.response as JsonObject, patch, { provenance: row.provenance as Provenance, actor, lockedPaths });
  const [saved] = (await ctx.repos.table("form_responses").update({ id: row.id }, { response: merged.response as Resp["response"], provenance: merged.provenance as Resp["provenance"], ...checked(def, merged.response, merged.provenance) })) as [Resp];
  return { formResponse: projectFormResponse(respRow(saved)), changed: merged.changed, rejected: merged.rejected };
}

export async function putFormResponse(ctx: ServiceContext, appId: string, formId: string, input: z.output<typeof formResponseInput>) {
  const { app, side } = await access(ctx, appId, "applications:write");
  if (side !== "applicant") throw new ApiError(403, "forbidden", "Only the applicant can edit a form response");
  // An agent's edits are marked as the agent's, so the applicant can see what it wrote.
  const { formResponse: out, rejected } = await writeFormResponse(ctx, app, formId, input.response as JsonObject, ctx.actor.kind === "user" ? "user" : `agent:${ctx.actor.clientId}`);
  // Passport-owned fields are not editable here; the caller is told which writes were ignored.
  return rejected.length ? { ...out, customFields: { ...out.customFields, gmsRejected: { name: "gmsRejected", fieldType: "array" as const, value: rejected, description: "Fields that follow Passport and cannot be edited here" } } } : out;
}

// ------------------------------------------------------------------------------------ revisions

type Ev = Row<"application_events">;
export interface RevisionChange { formId: string; path: string; before: string | null; after: string | null; wordsBefore: number; wordsAfter: number; wordDelta: number }

function leaves(value: unknown, path: string, out: Map<string, string>): void {
  if (value === null || value === undefined) return;
  if (typeof value === "object" && !Array.isArray(value)) for (const [k, v] of Object.entries(value)) leaves(v, `${path}/${k.replace(/~/g, "~0").replace(/\//g, "~1")}`, out);
  else out.set(path, typeof value === "string" ? value : JSON.stringify(value));
}
const words = (s: string | null) => (s?.trim() ? s.trim().split(/\s+/).length : 0);

/** The current stage's answers as they stood when the funder asked for a revision. */
export async function revisionSnapshot(ctx: ServiceContext, app: App): Promise<Record<string, JsonObject>> {
  const out: Record<string, JsonObject> = {};
  for (const r of await responsesOf(ctx, app.id)) if (r.stage === app.stage) out[r.form_id] = r.response as JsonObject;
  return out;
}

/** Field by field, what the applicant changed between the revision request and the resubmission. */
export function diffRevision(before: Record<string, JsonObject>, after: Record<string, JsonObject>): RevisionChange[] {
  const changes: RevisionChange[] = [];
  for (const formId of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = new Map<string, string>();
    const b = new Map<string, string>();
    leaves(before[formId], "", a);
    leaves(after[formId], "", b);
    for (const path of [...new Set([...a.keys(), ...b.keys()])].sort()) {
      const [x, y] = [a.get(path) ?? null, b.get(path) ?? null];
      if (x !== y) changes.push({ formId: apiId("form", formId), path, before: x, after: y, wordsBefore: words(x), wordsAfter: words(y), wordDelta: words(y) - words(x) });
    }
  }
  return changes;
}

/** An event's payload without the stored snapshot, which is working data for the diff. */
export const eventPayload = (e: Ev) => {
  const { snapshot: _snapshot, revision: _revision, ...rest } = e.payload as Record<string, unknown>;
  return rest;
};
/** The revision diff a resubmission carries; null on every other event. */
export const revisionOf = (e: Ev) => ((e.payload as { revision?: { requestedAt: string; message: string | null; changes: RevisionChange[] } }).revision ?? null);

// ------------------------------------------------------------------------------------ submit

export async function submitApplication(ctx: ServiceContext, appId: string): Promise<ApplicationBase> {
  const { app, side } = await access(ctx, appId, "applications:submit");
  if (side !== "applicant") throw new ApiError(403, "forbidden", "Only the applicant can submit an application");
  requireApproval(ctx, "Submitting an application");
  const competition = required(await ctx.repos.table("competitions").one({ id: app.competition_id }), "Competition");
  const opp = required(await ctx.repos.table("opportunities").one({ id: app.opportunity_id }), "Opportunity");
  const applicant = required(await ctx.repos.table("workspaces").one({ id: app.applicant_workspace_id }), "Workspace");
  const funder = required(await ctx.repos.table("workspaces").one({ id: app.workspace_id }), "Workspace");

  const required_ = Object.keys(stageForms(competition, app.stage));
  const all = await responsesOf(ctx, app.id);
  const current = all.filter((r) => required_.includes(r.form_id));
  // Re-validate now: the form may have been edited by several people since the last save.
  const problems: { field: string; message: string; type: string; formId: string }[] = [];
  const fields: ReturnType<typeof extractSubmissionFields> = {};
  for (const formId of required_) {
    const row = current.find((r) => r.form_id === formId);
    if (!row) {
      problems.push({ formId, field: "", message: "This form has not been started", type: "required" });
      continue;
    }
    const def = await formDef(ctx, formId, row.form_version);
    for (const e of validateResponse(def, row.response).validationErrors) problems.push({ formId, ...e });
    Object.assign(fields, extractSubmissionFields(projectToCommonGrants(def, row.response)));
  }
  if (problems.length) {
    throw new ApiError(422, "validation_failed", "This application is not ready to submit", problems.map((p) => ({ code: p.type, field: `${p.formId}${p.field}`, detail: p.message })));
  }

  const stage = stagesOf(competition).find((s) => s.key === app.stage);
  const closes = stage?.closes ? Date.parse(stage.closes) : NaN;
  const stageOpen = competition.status === "open" && !(closes <= ctx.now().getTime());
  const eligibility = await runRules(ctx, opp.id, applicant, all, fields.applicantType);
  const facts = orgFacts(applicant);
  const at = ctx.now().toISOString();

  // Everything the submission stamps is written before the status moves, so a refused
  // transition leaves a draft that is merely a little more up to date.
  const [stamped] = (await ctx.repos.table("applications").update(
    { id: app.id },
    {
      eligibility: eligibility as unknown as J,
      verification_level_at_submit: facts.level,
      attestation_url: facts.attestationUrl,
      ...(fields.title ? { title: fields.title } : {}),
      ...(fields.requestedAmount ? { requested_amount_minor: toMinor(fields.requestedAmount), currency: fields.requestedAmount.currency } : {}),
    },
  )) as [App];
  // A resubmission after a revision request keeps what changed, so both sides can read the diff.
  let revision: { requestedAt: string; message: string | null; changes: RevisionChange[] } | undefined;
  if (app.status === "revision_requested") {
    const asked = (await ctx.repos.table("application_events").find({ application_id: app.id, type: "request_revision" }, { orderBy: "created_at", ascending: false, limit: 1 }))[0];
    const snapshot = (asked?.payload as { snapshot?: Record<string, JsonObject> } | undefined)?.snapshot;
    if (asked && snapshot) revision = { requestedAt: asked.created_at, message: (asked.payload as { message?: string }).message ?? null, changes: diffRevision(snapshot, await revisionSnapshot(ctx, app)) };
  }
  const submitted = await transitionApp(ctx, stamped, "submit", "applicant", { requiredFormsComplete: true, stageOpen }, { stage: app.stage, eligible: eligibility.eligible, verificationLevel: facts.level, ...(revision ? { revision } : {}) });
  await ctx.repos.table("form_responses").update({ application_id: app.id, stage: app.stage, locked_at: null }, { locked_at: at });

  // Applying is the consent that lets this funder read the cached record for this application.
  if (!(await ctx.repos.table("consents").one({ applicant_workspace_id: applicant.id, funder_workspace_id: funder.id, basis: "application", revoked_at: null }))) {
    await ctx.repos.table("consents").insert({ applicant_workspace_id: applicant.id, funder_workspace_id: funder.id, basis: "application", scopes: ["org:read"], granted_by: ctx.actor.userId, granted_at: at });
    await audit(ctx, "consent.granted", "workspace", applicant.id, { funderWorkspaceId: funder.id, basis: "application" });
  }

  await sendLetter(
    ctx,
    "acknowledgment",
    await recipientEmails(ctx, applicant),
    {
      recipient: { name: applicant.display_name },
      funder: { name: funder.display_name },
      application: { title: submitted.title, submittedAt: at.slice(0, 10) },
      opportunity: { title: opp.title },
      links: { status: `${ctx.config.webBaseUrl}/w/${applicant.handle}/applications/app_${submitted.id}` },
    },
    { type: "application", id: submitted.id, workspaceId: funder.id },
  );
  return project(ctx, submitted);
}

// ------------------------------------------------------------------------------------ search

const FILTER_PATHS: Record<string, string> = { status: "status.value", title: "title", competitionId: "competitionId", opportunityId: "opportunityId", submittedAt: "submittedAt" };
const SEARCH_WINDOW = 2000;

/** `POST /common-grants/applications/search`: the caller's own applications (applicant) or inbox (funder). */
export async function searchApplications(ctx: ServiceContext, body: unknown) {
  const ws = await authorize(ctx, { scope: "applications:read" });
  const req = parseSearchRequest("applications", body);
  let rows = ws.kind === "applicant" ? await ctx.repos.table("applications").find({ applicant_workspace_id: ws.id }, { limit: SEARCH_WINDOW }) : await ctx.repos.table("applications").find({ workspace_id: ws.id }, { limit: SEARCH_WINDOW, notNull: ["submitted_at"] });
  // The same people see the same applications here as one at a time: a consultant only those in
  // their scope, a reviewer only those assigned to them, and masked.
  if (ws.kind === "applicant" && ws.role === "consultant") {
    const allowed = (ws.memberScope?.applicationIds as string[] | undefined) ?? [];
    rows = rows.filter((r) => allowed.includes(r.id));
  }
  const reviewer = reviewerView(ws);
  const assigned = await reviewerApplicationIds(ctx, ws);
  if (assigned) rows = rows.filter((r) => assigned.has(r.id));
  const all = await Promise.all(rows.map((r) => project(ctx, r, reviewer)));
  const needle = req.search?.toLowerCase();
  let hits = all.filter((a) => (!needle || a.title.toLowerCase().includes(needle)) && req.parsedFilters.every((f) => matchesFilter(readPath(a, f.custom ? `customFields.${f.name}.value` : (FILTER_PATHS[f.name] ?? f.name)), f.operator, f.value)));
  hits = sortByPath(hits, req.sortInfo.sortBy === "custom" ? `customFields.${req.sortInfo.customSortBy}.value` : req.sortInfo.sortBy, req.sortInfo.sortOrder);
  return filtered(hits.slice(req.page.offset, req.page.offset + req.page.pageSize), req.page, hits.length, req.sortInfo, req.filters);
}
