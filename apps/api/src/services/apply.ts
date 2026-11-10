// SPDX-License-Identifier: AGPL-3.0-only
// Applying (build spec §11.4): start with Passport prefill, edit form responses with merge
// semantics, submit. These functions back the CommonGrants `/applications` routes and the applicant
// MCP tools alike. Status changes go through the application machine in `@gms/workflow`.
import { computeResponseStatus, extractSubmissionFields, mergeResponse, passportFieldPaths, prefill, buildPrefillSource, projectToCommonGrants, validateResponse, type FormDefinition, type JsonObject, type Provenance } from "@gms/forms";
import { DEFAULT_TEMPLATES, renderEmail } from "@gms/notify";
import { profileToObject, type ProfileField } from "@gms/passport-client";
import { filtered, matchesFilter, parseSearchRequest, projectApplication, projectFormResponse, readPassportFields, readPath, sortByPath, toMinor, unionStageForms, type ApplicationBase, type ApplicationRow, type FormResponseRow, type StageJson } from "@gms/protocol";
import { evaluate, parseRules, type Evaluation } from "@gms/rules";
import { applicationCgStatus, applicationMachine, type ApplicationAction, type ApplicationContext, type ApplicationStatus } from "@gms/workflow";
import { fanOut, isWebhookEventType } from "@gms/webhooks";
import { z } from "zod";
import { ApiError, notFound } from "../lib/errors.ts";
import { audit, authorize, required, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import { toDefinition } from "./forms.ts";
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

export async function project(ctx: ServiceContext, app: App): Promise<ApplicationBase> {
  return projectApplication({ application: appRow(app), formResponses: (await responsesOf(ctx, app.id)).map(respRow) });
}

/** The cached Passport record of an applicant workspace, shaped for prefill and rules. */
export function passportFacts(ws: Ws): { org: JsonObject; profile: JsonObject | null; level: string | null; attestationUrl: string | null } {
  const org = (ws.org_projection as JsonObject | null) ?? {};
  const cached = ws.profile_projection as { fields?: ProfileField[] } | null;
  const profile = cached?.fields?.length ? (profileToObject(cached.fields) as JsonObject) : null;
  const fields = readPassportFields(org);
  return { org, profile, level: ws.verification_level ?? fields.verificationLevel ?? null, attestationUrl: fields.attestation ?? null };
}

/** Who may see an application, and from which side. 404 for everyone else. */
export async function access(ctx: ServiceContext, appId: string, scope: "applications:read" | "applications:write" | "applications:submit"): Promise<{ app: App; side: "applicant" | "funder"; ws: ServiceWorkspace }> {
  const ws = await authorize(ctx, { scope });
  const app = await ctx.repos.table("applications").one({ id: appId });
  if (app && app.applicant_workspace_id === ws.id && ws.kind === "applicant") {
    // A consultant sees only the applications named in their membership scope.
    const allowed = ws.role === "consultant" ? (ws.memberScope?.applicationIds as string[] | undefined) : undefined;
    if (ws.role === "consultant" && !(allowed ?? []).includes(app.id)) throw notFound("Application");
    return { app, side: "applicant", ws };
  }
  // The funder sees an application once it has been submitted; drafts belong to the applicant.
  if (app && app.workspace_id === ws.id && ws.kind === "funder" && app.submitted_at) return { app, side: "funder", ws };
  throw notFound("Application");
}

async function formDef(ctx: ServiceContext, formId: string, version: number): Promise<FormDefinition> {
  return toDefinition(required(await ctx.repos.table("forms").one({ id: formId, version }), "Form"));
}

function checked(def: FormDefinition, response: JsonObject, provenance: Provenance) {
  return { status: computeResponseStatus(def, response, provenance), validation_errors: validateResponse(def, response).validationErrors as unknown as Resp["validation_errors"] };
}

export async function runRules(ctx: ServiceContext, opportunityId: string, applicant: Ws, responses: Resp[], applicantType?: string): Promise<Evaluation & { evaluatedAt: string }> {
  const opp = required(await ctx.repos.table("opportunities").one({ id: opportunityId }), "Opportunity");
  const parsed = parseRules(opp.eligibility_rules);
  const facts = passportFacts(applicant);
  const form = Object.fromEntries(responses.map((r) => [r.form_id, r.response as Record<string, unknown>]));
  // Rules that do not parse cannot decide anything: the result is `unknown`, for a person to look at.
  const result: Evaluation = parsed.ok ? evaluate(parsed.rules, { org: facts.org, profile: facts.profile ?? undefined, form, applicant: { type: applicantType } }) : { eligible: "unknown", results: [] };
  return { ...result, evaluatedAt: ctx.now().toISOString() };
}

/** Create the `notStarted` responses of a stage, prefilled from the applicant's Passport record. */
export async function createStageResponses(ctx: ServiceContext, app: App, competition: Comp, stageKey: string, applicant: Ws): Promise<void> {
  const facts = passportFacts(applicant);
  const source = buildPrefillSource(facts.org, facts.profile);
  for (const [formId, version] of Object.entries(stageForms(competition, stageKey))) {
    if (await ctx.repos.table("form_responses").one({ application_id: app.id, form_id: formId })) continue;
    const def = await formDef(ctx, formId, version);
    const filled = prefill(def, source);
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
export async function sendLetter(ctx: ServiceContext, kind: keyof typeof DEFAULT_TEMPLATES, to: string | null | undefined, fields: Parameters<typeof renderEmail>[1], subject: { type: string; id: string; workspaceId: string }): Promise<{ sent: boolean; reason?: string }> {
  if (!ctx.ports.mailer || !ctx.config.mailFrom) return { sent: false, reason: "Outbound mail is not configured" };
  if (!to) return { sent: false, reason: "The organization has no primary email in Passport" };
  try {
    const custom = await ctx.repos.table("templates").find({ workspace_id: subject.workspaceId, kind }, { orderBy: "version", ascending: false, limit: 1 });
    const base = DEFAULT_TEMPLATES[kind];
    const rendered = renderEmail(custom[0] ? { ...base, body: custom[0].body, name: custom[0].name } : base, fields);
    const { id } = await ctx.ports.mailer.send({ from: ctx.config.mailFrom, to: [to], subject: rendered.subject, html: rendered.html, text: rendered.text, idempotencyKey: `${kind}:${subject.id}:${ctx.now().toISOString().slice(0, 10)}` });
    await audit(ctx, "communication.sent", subject.type, subject.id, { template: kind, messageId: id }, subject.workspaceId);
    return { sent: true };
  } catch (e) {
    await audit(ctx, "communication.failed", subject.type, subject.id, { template: kind, error: e instanceof Error ? e.name : "error" }, subject.workspaceId);
    return { sent: false, reason: "The letter could not be sent" };
  }
}

export const primaryEmail = (org: JsonObject): string | null => {
  const emails = org.emails as { primary?: unknown } | undefined;
  return typeof emails?.primary === "string" ? emails.primary : null;
};

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

export async function startApplication(ctx: ServiceContext, input: z.output<typeof startInput>): Promise<{ application: ApplicationBase; created: boolean }> {
  const ws = await authorize(ctx, { scope: "applications:write", kind: "applicant" });
  const applicant = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const named = input.organizationId ?? input.applicantOrgId;
  if (named && named !== applicant.passport_org_id) throw new ApiError(403, "wrong_organization", "You can only apply for the organization this workspace is linked to in Passport");

  const competition = await ctx.repos.table("competitions").one({ id: input.competitionId });
  const opp = competition ? await ctx.repos.table("opportunities").one({ id: competition.opportunity_id }) : null;
  if (!competition || !opp || competition.status === "draft" || !opp.published_at) throw notFound("Competition");

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
  return project(ctx, (await access(ctx, appId, "applications:read")).app);
}

// ------------------------------------------------------------------------------------ form responses

async function responseFor(ctx: ServiceContext, app: App, formId: string): Promise<Resp> {
  return required(await ctx.repos.table("form_responses").one({ application_id: app.id, form_id: formId }), "Form response");
}

export async function getFormResponse(ctx: ServiceContext, appId: string, formId: string) {
  const { app } = await access(ctx, appId, "applications:read");
  return projectFormResponse(respRow(await responseFor(ctx, app, formId)));
}

export const formResponseInput = z.object({ response: z.record(z.string(), z.unknown()) }).loose();

export async function putFormResponse(ctx: ServiceContext, appId: string, formId: string, input: z.output<typeof formResponseInput>) {
  const { app, side } = await access(ctx, appId, "applications:write");
  if (side !== "applicant") throw new ApiError(403, "forbidden", "Only the applicant can edit a form response");
  if (app.status !== "draft" && app.status !== "revision_requested") throw new ApiError(409, "application_locked", `This application is ${app.status.replace(/_/g, " ")} and can no longer be edited`);
  const row = await responseFor(ctx, app, formId);
  if (row.locked_at) throw new ApiError(409, "response_locked", "This form belongs to an earlier stage and is read-only");
  const def = await formDef(ctx, formId, row.form_version);
  const merged = mergeResponse(row.response as JsonObject, input.response as JsonObject, {
    provenance: row.provenance as Provenance,
    // An agent's edits are marked as the agent's, so the applicant can see what it wrote.
    actor: ctx.actor.kind === "user" ? "user" : `agent:${ctx.actor.clientId}`,
    lockedPaths: passportFieldPaths(def),
  });
  const [saved] = (await ctx.repos.table("form_responses").update({ id: row.id }, { response: merged.response as Resp["response"], provenance: merged.provenance as Resp["provenance"], ...checked(def, merged.response, merged.provenance) })) as [Resp];
  const out = projectFormResponse(respRow(saved));
  // Passport-owned fields are not editable here; the caller is told which writes were ignored.
  return merged.rejected.length ? { ...out, customFields: { ...out.customFields, gmsRejected: { name: "gmsRejected", fieldType: "array" as const, value: merged.rejected, description: "Fields that follow Passport and cannot be edited here" } } } : out;
}

// ------------------------------------------------------------------------------------ submit

export async function submitApplication(ctx: ServiceContext, appId: string): Promise<ApplicationBase> {
  const { app, side } = await access(ctx, appId, "applications:submit");
  if (side !== "applicant") throw new ApiError(403, "forbidden", "Only the applicant can submit an application");
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
  const facts = passportFacts(applicant);
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
  const submitted = await transitionApp(ctx, stamped, "submit", "applicant", { requiredFormsComplete: true, stageOpen }, { stage: app.stage, eligible: eligibility.eligible, verificationLevel: facts.level });
  await ctx.repos.table("form_responses").update({ application_id: app.id, stage: app.stage, locked_at: null }, { locked_at: at });

  // Applying is the consent that lets this funder read the cached record for this application.
  if (!(await ctx.repos.table("consents").one({ applicant_workspace_id: applicant.id, funder_workspace_id: funder.id, basis: "application", revoked_at: null }))) {
    await ctx.repos.table("consents").insert({ applicant_workspace_id: applicant.id, funder_workspace_id: funder.id, basis: "application", scopes: ["org:read"], granted_by: ctx.actor.userId, granted_at: at });
    await audit(ctx, "consent.granted", "workspace", applicant.id, { funderWorkspaceId: funder.id, basis: "application" });
  }

  await sendLetter(
    ctx,
    "acknowledgment",
    primaryEmail(facts.org),
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
  const rows = ws.kind === "applicant" ? await ctx.repos.table("applications").find({ applicant_workspace_id: ws.id }, { limit: SEARCH_WINDOW }) : await ctx.repos.table("applications").find({ workspace_id: ws.id }, { limit: SEARCH_WINDOW, notNull: ["submitted_at"] });
  const all = await Promise.all(rows.map((r) => project(ctx, r)));
  const needle = req.search?.toLowerCase();
  let hits = all.filter((a) => (!needle || a.title.toLowerCase().includes(needle)) && req.parsedFilters.every((f) => matchesFilter(readPath(a, f.custom ? `customFields.${f.name}.value` : (FILTER_PATHS[f.name] ?? f.name)), f.operator, f.value)));
  hits = sortByPath(hits, req.sortInfo.sortBy === "custom" ? `customFields.${req.sortInfo.customSortBy}.value` : req.sortInfo.sortBy, req.sortInfo.sortOrder);
  return filtered(hits.slice(req.page.offset, req.page.offset + req.page.pageSize), req.page, hits.length, req.sortInfo, req.filters);
}
