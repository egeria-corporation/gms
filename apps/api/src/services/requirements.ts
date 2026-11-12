// SPDX-License-Identifier: AGPL-3.0-only
// Requirements and submissions (build spec §10.1, §10.8, §11.7): what a grantee owes, the report
// they send, the funder's accept or return, and sharing an accepted report with another funder by
// consent. Status changes go through the requirement and submission machines; accepting a
// requirement that releases a tranche makes that tranche due.
import { buildPrefillSource, computeResponseStatus, mergeResponse, passportFieldPaths, prefill, validateResponse, type FormDefinition, type JsonObject, type Provenance } from "@gms/forms";
import { DEFAULT_REMINDER_PLAN, DEFAULT_TEMPLATES, normalizePlan, renderEmail, runReminders, type ReminderLog } from "@gms/notify";
import { acceptRequirement, requirementMachine, submissionMachine, type RequirementAction, type RequirementContext, type RequirementStatus, type SubmissionAction, type SubmissionContext, type SubmissionStatus, type TrancheCondition, type TrancheStatus } from "@gms/workflow";
import { z } from "zod";
import { ApiError, notFound } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { unprocessable } from "../lib/input.ts";
import { awardFields } from "./agreements.ts";
import { primaryEmail } from "./apply.ts";
import { namesOf, orgFacts, verificationOf } from "./profile.ts";
import { STAFF_ROLES, emitFor, type Award } from "./awards.ts";
import { audit, authorize, required, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import { toDefinition } from "./forms.ts";
import { normalizePreferences } from "./notifications.ts";
import type { PageRequest } from "./programs.ts";
import { RepoError, type Row } from "./repos/types.ts";

type Req = Row<"requirements">;
type Sub = Row<"submissions">;
type Resp = Row<"form_responses">;
const REQUIREMENT_STAFF = [...STAFF_ROLES, "finance"] as const;

export const requirementView = (r: Req, submission?: Sub | null) => ({
  id: apiId("requirement", r.id),
  awardId: apiId("award", r.award_id),
  type: r.type,
  title: r.title,
  formId: r.form_id ? apiId("form", r.form_id) : null,
  formVersion: r.form_version,
  dueAt: r.due_at,
  graceDays: r.grace_days,
  reminderPlan: r.reminder_plan,
  status: r.status,
  releasesTrancheId: r.releases_tranche_id ? apiId("tranche", r.releases_tranche_id) : null,
  submissionId: submission ? apiId("submission", submission.id) : null,
  submissionStatus: submission?.status ?? null,
});

// ------------------------------------------------------------------------------------ machines

function requirementPorts(ctx: ServiceContext, workspaceId: string, awardId: string) {
  return {
    write: async (c: { subjectType: string; subjectId: string; from: string; to: string; patch: Record<string, unknown> }) => {
      if (c.subjectType === "requirement") {
        const [hit] = await ctx.repos.table("requirements").update({ id: c.subjectId, status: c.from }, { status: c.to, ...(c.to === "waived" ? { waived_by: ctx.actor.userId } : {}) });
        if (!hit) throw new ApiError(409, "conflict", "This requirement changed while you were working. Reload and try again");
      } else if (c.subjectType === "submission") {
        const p = c.patch as { submitted_at?: string | null; review_note?: string | null };
        const [hit] = await ctx.repos.table("submissions").update({ id: c.subjectId, status: c.from }, {
          status: c.to,
          ...(p.submitted_at ? { submitted_at: p.submitted_at, submitted_by: ctx.actor.userId } : {}),
          ...("review_note" in p ? { review_note: p.review_note ?? null, reviewed_by: ctx.actor.userId } : {}),
        });
        if (!hit) throw new ApiError(409, "conflict", "This submission changed while you were working. Reload and try again");
      } else if (c.subjectType === "tranche") {
        const p = c.patch as { due_at?: string | null };
        const [hit] = await ctx.repos.table("tranches").update({ id: c.subjectId, status: c.from }, { status: c.to, ...(p.due_at ? { due_at: p.due_at } : {}) });
        if (!hit) throw new ApiError(409, "conflict", "This payment changed while you were working. Reload and try again");
      } else throw new Error(`requirementPorts cannot write a ${c.subjectType}`);
    },
    ledger: (e: { eventType: string; subjectType: string; subjectId: string; data: Record<string, unknown> }) => audit(ctx, e.eventType, e.subjectType, e.subjectId, { ...e.data, awardId }, workspaceId),
    emit: (e: { type: string; subjectType: string; subjectId: string; data: Record<string, unknown> }) => emitFor(ctx, workspaceId, e.type, { subjectType: e.subjectType, subjectId: e.subjectId, awardId, ...e.data }),
  };
}

type Side = "applicant" | "funder" | "system";

async function moveRequirement(ctx: ServiceContext, r: Req, action: RequirementAction, side: Side, mctx: RequirementContext = {}): Promise<Req> {
  const res = await requirementMachine.transition({ id: r.id, status: r.status as RequirementStatus }, action, { id: ctx.actor.id, kind: side }, { ...mctx, now: ctx.now().toISOString() }, requirementPorts(ctx, r.workspace_id, r.award_id));
  if (!res.ok) throw new ApiError(res.code === "actor_not_allowed" ? 403 : 409, res.code, res.reason);
  return required(await ctx.repos.table("requirements").one({ id: r.id }), "Requirement");
}

async function moveSubmission(ctx: ServiceContext, s: Sub, action: SubmissionAction, side: Side, mctx: SubmissionContext = {}): Promise<Sub> {
  const res = await submissionMachine.transition({ id: s.id, status: s.status as SubmissionStatus }, action, { id: ctx.actor.id, kind: side }, { ...mctx, now: ctx.now().toISOString() }, requirementPorts(ctx, s.workspace_id, s.award_id ?? ""));
  if (!res.ok) throw new ApiError(res.code === "actor_not_allowed" ? 403 : 409, res.code, res.reason);
  return required(await ctx.repos.table("submissions").one({ id: s.id }), "Submission");
}

// ------------------------------------------------------------------------------------ funder side

async function ownRequirement(ctx: ServiceContext, requirementId: string, write: boolean): Promise<{ r: Req; ws: ServiceWorkspace }> {
  const ws = await authorize(ctx, { scope: write ? "requirements:write" : "requirements:read", kind: "funder", ...(write ? { roles: REQUIREMENT_STAFF } : {}) });
  const r = await ctx.repos.table("requirements").one({ id: requirementId, workspace_id: ws.id });
  // A requirement is on one of this workspace's own awards; a row that names another funder's award is not one.
  if (!r || !(await ctx.repos.table("awards").one({ id: r.award_id, workspace_id: ws.id }))) throw notFound("Requirement");
  return { r, ws };
}

const latestSubmission = async (ctx: ServiceContext, requirementId: string): Promise<Sub | null> => (await ctx.repos.table("submissions").find({ requirement_id: requirementId }, { orderBy: "created_at", ascending: false, limit: 1 }))[0] ?? null;

export async function listRequirements(ctx: ServiceContext, awardId: string) {
  const ws = await authorize(ctx, { scope: "requirements:read" });
  const award = await ctx.repos.table("awards").one({ id: awardId });
  if (!award || !((ws.kind === "funder" && award.workspace_id === ws.id) || (ws.kind === "applicant" && award.recipient_workspace_id === ws.id))) throw notFound("Award");
  const rows = await ctx.repos.table("requirements").find({ award_id: award.id, workspace_id: award.workspace_id }, { orderBy: "due_at" });
  return Promise.all(rows.map(async (r) => requirementView(r, await latestSubmission(ctx, r.id))));
}

export const requirementInput = z
  .object({
    type: z.enum(["report", "document", "milestone", "site_visit", "acknowledgment"]),
    title: z.string().trim().min(1).max(300),
    formId: z.string().optional(),
    formVersion: z.number().int().positive().optional(),
    dueAt: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
    graceDays: z.number().int().min(0).max(365).optional(),
    reminderPlan: z.array(z.number().int().min(-365).max(365)).max(20).optional(),
    releasesTrancheId: z.string().optional(),
  })
  .strict();
export const requirementPatch = requirementInput.partial();

const isoOf = (v: string | undefined) => (v === undefined ? undefined : new Date(v.length === 10 ? `${v}T00:00:00Z` : v).toISOString());
const bare = (v: string, prefix: string) => v.replace(new RegExp(`^${prefix}_`), "");

async function pinnedForm(ctx: ServiceContext, ws: ServiceWorkspace, formId: string | undefined, version: number | undefined): Promise<{ form_id: string; form_version: number } | null> {
  if (!formId) return null;
  const id = bare(formId, "frm");
  const versions = (await ctx.repos.table("forms").find({ id }, { orderBy: "version", ascending: false })).filter((f) => f.published_at && (f.workspace_id === null || f.workspace_id === ws.id));
  const hit = version ? versions.find((f) => f.version === version) : versions[0];
  if (!hit) throw new ApiError(422, "form_not_published", "A requirement needs a published form version from this workspace or the shared library");
  return { form_id: hit.id, form_version: hit.version };
}

async function ownTranche(ctx: ServiceContext, awardId: string, trancheId: string | undefined): Promise<string | null> {
  if (!trancheId) return null;
  const t = await ctx.repos.table("tranches").one({ id: bare(trancheId, "trn") });
  const award = t ? await ctx.repos.table("awards").one({ id: awardId, workspace_id: t.workspace_id }) : null;
  if (!t || t.award_id !== awardId || !award) throw new ApiError(422, "unknown_tranche", "That tranche is not on this award");
  if (t.status !== "scheduled") throw new ApiError(422, "tranche_not_scheduled", "Only a scheduled tranche can wait on a requirement");
  return t.id;
}

export async function createRequirement(ctx: ServiceContext, awardId: string, input: z.output<typeof requirementInput>) {
  const ws = await authorize(ctx, { scope: "requirements:write", kind: "funder", roles: REQUIREMENT_STAFF });
  const award = await ctx.repos.table("awards").one({ id: awardId });
  if (!award || award.workspace_id !== ws.id) throw notFound("Award");
  const form = await pinnedForm(ctx, ws, input.formId, input.formVersion);
  const trancheId = await ownTranche(ctx, award.id, input.releasesTrancheId);
  let plan: number[];
  try {
    plan = input.reminderPlan ? normalizePlan(input.reminderPlan) : [...DEFAULT_REMINDER_PLAN];
  } catch {
    throw unprocessable("The reminder plan is not valid", [{ path: "reminderPlan", message: "Use whole days between -365 and 365" }]);
  }
  const r = await ctx.repos.table("requirements").insert({ workspace_id: ws.id, award_id: award.id, type: input.type, title: input.title, form_id: form?.form_id ?? null, form_version: form?.form_version ?? null, due_at: isoOf(input.dueAt) ?? null, grace_days: input.graceDays ?? 0, reminder_plan: plan as unknown as Req["reminder_plan"], status: "scheduled", releases_tranche_id: trancheId });
  if (trancheId) await ctx.repos.table("tranches").update({ id: trancheId }, { condition: { type: "onReportAccepted", requirementId: r.id } as unknown as Row<"tranches">["condition"] });
  await audit(ctx, "requirement.created", "requirement", r.id, { awardId: award.id, type: r.type, dueAt: r.due_at });
  return requirementView(r);
}

export async function updateRequirement(ctx: ServiceContext, requirementId: string, input: z.output<typeof requirementPatch>) {
  const { r, ws } = await ownRequirement(ctx, requirementId, true);
  if (["accepted", "waived"].includes(r.status)) throw new ApiError(409, "requirement_closed", `An ${r.status} requirement cannot change`);
  const form = input.formId !== undefined ? await pinnedForm(ctx, ws, input.formId, input.formVersion) : undefined;
  if (form !== undefined && (await latestSubmission(ctx, r.id))) throw new ApiError(409, "submission_started", "The form cannot change once the grantee has started the report");
  const [saved] = await ctx.repos.table("requirements").update({ id: r.id }, {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.dueAt !== undefined ? { due_at: isoOf(input.dueAt)! } : {}),
    ...(input.graceDays !== undefined ? { grace_days: input.graceDays } : {}),
    ...(input.reminderPlan !== undefined ? { reminder_plan: normalizePlan(input.reminderPlan) as unknown as Req["reminder_plan"] } : {}),
    ...(form ? form : {}),
  });
  await audit(ctx, "requirement.updated", "requirement", r.id, { fields: Object.keys(input) });
  return requirementView(saved ?? r, await latestSubmission(ctx, r.id));
}

export const waiveInput = z.object({ reason: z.string().trim().min(1).max(5000) }).strict();

export async function waiveRequirement(ctx: ServiceContext, requirementId: string, input: z.output<typeof waiveInput>) {
  const { r } = await ownRequirement(ctx, requirementId, true);
  return requirementView(await moveRequirement(ctx, r, "waive", "funder", { reason: input.reason }));
}

/** The Reporting & compliance queue: what is due, overdue, received or returned, with who owes it. */
export async function listDueRequirements(ctx: ServiceContext, page: PageRequest, f: { status?: string | undefined } = {}) {
  const ws = await authorize(ctx, { scope: "requirements:read", kind: "funder" });
  const where = { workspace_id: ws.id, status: f.status ? [f.status] : ["due", "overdue", "submitted", "under_review", "returned"] };
  const [rows, total] = await Promise.all([ctx.repos.table("requirements").find(where, { orderBy: "due_at", limit: page.pageSize, offset: page.offset }), ctx.repos.table("requirements").count(where)]);
  const awards = rows.length ? await ctx.repos.table("awards").find({ id: [...new Set(rows.map((r) => r.award_id))] }) : [];
  const recipients = awards.length ? await ctx.repos.table("workspaces").find({ id: [...new Set(awards.map((a) => a.recipient_workspace_id).filter((x): x is string => !!x))] }) : [];
  const items = await Promise.all(
    rows.map(async (r) => {
      const a = awards.find((x) => x.id === r.award_id);
      const w = recipients.find((x) => x.id === a?.recipient_workspace_id);
      return { ...requirementView(r, await latestSubmission(ctx, r.id)), award: a ? { id: apiId("award", a.id), title: a.title } : null, recipient: w ? { workspaceId: w.id, ...namesOf(w), handle: w.handle, verification: verificationOf(w) } : null };
    }),
  );
  return { items, total };
}

// ------------------------------------------------------------------------------------ reminders

class RepoReminderLog implements ReminderLog {
  constructor(
    private readonly ctx: Pick<ServiceContext, "repos" | "now">,
    private readonly r: Req,
  ) {}
  private offset = (key: string) => Number(key.split(":").pop());
  async sentKeys(requirementId: string) {
    return new Set((await this.ctx.repos.table("reminder_sends").find({ requirement_id: requirementId, due_at: this.r.due_at! })).map((s) => `reminder:${requirementId}:${s.offset_days}`));
  }
  async claim(key: string) {
    try {
      await this.ctx.repos.table("reminder_sends").insert({ workspace_id: this.r.workspace_id, requirement_id: this.r.id, due_at: this.r.due_at!, offset_days: this.offset(key), sent_at: this.ctx.now().toISOString() });
      return true;
    } catch (e) {
      if (e instanceof RepoError && e.kind === "conflict") return false;
      throw e;
    }
  }
  async markSent(key: string, messageId: string) {
    await this.ctx.repos.table("reminder_sends").update({ requirement_id: this.r.id, due_at: this.r.due_at!, offset_days: this.offset(key) }, { email_message_id: messageId });
  }
  async release(key: string) {
    await this.ctx.repos.table("reminder_sends").remove({ requirement_id: this.r.id, due_at: this.r.due_at!, offset_days: this.offset(key) });
  }
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

async function reminderEmail(ctx: ServiceContext, r: Req, award: Award, offsetDays: number) {
  const f = await awardFields(ctx, award);
  const timing = offsetDays < 0 ? `in ${-offsetDays} days` : offsetDays === 0 ? "today" : `${offsetDays} days ago`;
  const link = f.recipientHandle ? `${ctx.config.webBaseUrl}/w/${f.recipientHandle}/reports` : ctx.config.webBaseUrl;
  return { to: f.recipientEmail, rendered: renderEmail(DEFAULT_TEMPLATES.report_reminder, { ...f.fields, requirement: { title: r.title, dueDate: day(r.due_at!), timing }, links: { requirement: link } }) };
}

/**
 * Who in the grantee's workspace is mailed a report reminder, by their notification preferences
 * (category `requirement`): `immediate` members now, digest members later, email-off members never.
 * Without a directory of addresses nobody can be resolved and the caller falls back to the
 * organization's address.
 */
async function reminderRecipients(ctx: ServiceContext, workspaceId: string | null): Promise<{ immediate: { key: string; email: string }[]; deferred: number }> {
  const out = { immediate: [] as { key: string; email: string }[], deferred: 0 };
  const directory = ctx.ports.directory;
  if (!workspaceId || !directory) return out;
  const now = ctx.now().getTime();
  const members = (await ctx.repos.table("workspace_members").find({ workspace_id: workspaceId })).filter((m) => !m.expires_at || Date.parse(m.expires_at) > now);
  const people = await directory.lookup(members.map((m) => m.user_id));
  for (const m of members) {
    const prefs = normalizePreferences(m.notification_preferences as never);
    const email = people.get(m.user_id)?.email;
    if (!email || !prefs.channels.requirement.email) continue;
    if (prefs.digest === "daily" || prefs.digest === "weekly") out.deferred++;
    else out.immediate.push({ key: m.user_id, email });
  }
  return out;
}

/**
 * Send whatever reminder is due for one requirement. Idempotent per (requirement, due date,
 * offset): the row in `reminder_sends` is claimed before the email goes out, and the same key is
 * the mail provider's idempotency key, so a retried job never sends twice.
 */
export async function sendDueReminders(ctx: ServiceContext, r: Req): Promise<{ sent: number | null; skipped: number[] }> {
  if (!r.due_at) return { sent: null, skipped: [] };
  const award = await ctx.repos.table("awards").one({ id: r.award_id, workspace_id: r.workspace_id });
  if (!award || !["active", "accepted", "suspended"].includes(award.status)) return { sent: null, skipped: [] };
  const mailer = ctx.ports.mailer;
  const from = ctx.config.mailFrom;
  if (!mailer || !from) return { sent: null, skipped: [] };
  const out = await runReminders(
    { id: r.id, dueAt: r.due_at, status: r.status, graceDays: r.grace_days, reminderPlan: r.reminder_plan as unknown as number[] },
    {
      log: new RepoReminderLog(ctx, r),
      now: ctx.now(),
      send: async (reminder) => {
        const { to, rendered } = await reminderEmail(ctx, r, award, reminder.offsetDays);
        const key = `${reminder.idempotencyKey}:${r.due_at}`;
        const who = await reminderRecipients(ctx, award.recipient_workspace_id);
        // Each member who wants report mail at once gets their own copy. Members on a digest read it
        // there (the grantee's ledger event below feeds it). The organization's address is used only
        // when no member has opted in, so a reminder is never silently dropped.
        const list = who.immediate.length ? who.immediate : who.deferred > 0 ? [] : to.map((email, i) => ({ key: i ? `org${i}` : "org", email }));
        if (!list.length && who.deferred === 0) throw new Error("no_recipient_email");
        let first: string | null = null;
        for (const x of list) {
          const sent = await mailer.send({ from, to: [x.email], subject: rendered.subject, html: rendered.html, text: rendered.text, idempotencyKey: `${key}:${x.key}` });
          first ??= sent.id;
        }
        return first ?? `digest:${key}`;
      },
      onSent: async (reminder, messageId) => {
        await audit(ctx, "requirement.reminder_sent", "requirement", r.id, { offsetDays: reminder.offsetDays, messageId, awardId: r.award_id }, r.workspace_id);
        // The grantee's own record of the reminder: their in-app notification and their digest read it.
        if (award.recipient_workspace_id) await audit(ctx, "requirement.reminder", "requirement", r.id, { offsetDays: reminder.offsetDays, title: r.title, dueAt: r.due_at, awardId: r.award_id }, award.recipient_workspace_id);
      },
    },
  );
  return { sent: out.sent?.offsetDays ?? null, skipped: out.skipped };
}

/** A person sends a reminder now, outside the plan. Ledgered; not deduplicated against the plan. */
export async function remindNow(ctx: ServiceContext, requirementId: string) {
  const { r } = await ownRequirement(ctx, requirementId, true);
  if (!["scheduled", "due", "overdue", "returned"].includes(r.status)) throw new ApiError(409, "nothing_to_remind", `A ${r.status.replace(/_/g, " ")} requirement needs no reminder`);
  if (!r.due_at) throw new ApiError(422, "no_due_date", "Set a due date before sending a reminder");
  if (!ctx.ports.mailer || !ctx.config.mailFrom) throw new ApiError(503, "mail_unavailable", "Outbound mail is not configured on this server");
  const award = required(await ctx.repos.table("awards").one({ id: r.award_id, workspace_id: r.workspace_id }), "Award");
  const offset = Math.round((ctx.now().getTime() - Date.parse(r.due_at)) / 86_400_000);
  const { to, rendered } = await reminderEmail(ctx, r, award, offset);
  if (!to.length) throw new ApiError(422, "no_recipient_email", "No email address is known for this grantee");
  const { id } = await ctx.ports.mailer.send({ from: ctx.config.mailFrom, to, subject: rendered.subject, html: rendered.html, text: rendered.text });
  await audit(ctx, "requirement.reminder_sent", "requirement", r.id, { manual: true, messageId: id, awardId: r.award_id });
  return { sent: true, messageId: id };
}

// ------------------------------------------------------------------------------------ submissions

async function formDef(ctx: ServiceContext, formId: string, version: number): Promise<FormDefinition> {
  return toDefinition(required(await ctx.repos.table("forms").one({ id: formId, version }), "Form"));
}

const checked = (def: FormDefinition, response: JsonObject, provenance: Provenance) => ({ status: computeResponseStatus(def, response, provenance), validation_errors: validateResponse(def, response).validationErrors as unknown as Resp["validation_errors"] });

const responseView = (r: Resp) => ({ formId: apiId("form", r.form_id), formVersion: r.form_version, response: r.response, status: r.status, validationErrors: r.validation_errors, provenance: r.provenance, lockedAt: r.locked_at });

async function submissionDetail(ctx: ServiceContext, s: Sub) {
  const [responses, requirement] = await Promise.all([ctx.repos.table("form_responses").find({ submission_id: s.id }), s.requirement_id ? ctx.repos.table("requirements").one({ id: s.requirement_id }) : null]);
  return {
    id: apiId("submission", s.id),
    requirementId: s.requirement_id ? apiId("requirement", s.requirement_id) : null,
    awardId: s.award_id ? apiId("award", s.award_id) : null,
    status: s.status,
    submittedAt: s.submitted_at,
    reviewNote: s.review_note,
    shared: s.shared_from_submission_id !== null,
    sharedFromSubmissionId: s.shared_from_submission_id ? apiId("submission", s.shared_from_submission_id) : null,
    sharedFields: s.shared_fields,
    requirement: requirement ? { title: requirement.title, type: requirement.type, dueAt: requirement.due_at, status: requirement.status } : null,
    formResponses: responses.map(responseView),
  };
}

/** Who may see a submission: the funder workspace that holds it, or the grantee whose award it reports on. */
async function accessSubmission(ctx: ServiceContext, submissionId: string, write: boolean): Promise<{ s: Sub; side: "funder" | "recipient"; ws: ServiceWorkspace; award: Award | null }> {
  const ws = await authorize(ctx, { scope: write ? "requirements:write" : "requirements:read" });
  const s = await ctx.repos.table("submissions").one({ id: submissionId });
  // The award of the submission's own workspace, or none: the report and the award it reports on are one funder's.
  const award = s?.award_id ? await ctx.repos.table("awards").one({ id: s.award_id, workspace_id: s.workspace_id }) : null;
  if (s?.award_id && !award) throw notFound("Submission");
  if (s && ws.kind === "funder" && s.workspace_id === ws.id && (s.status !== "draft" || s.shared_from_submission_id)) return { s, side: "funder", ws, award };
  if (s && ws.kind === "applicant" && award?.recipient_workspace_id === ws.id && !s.shared_from_submission_id) return { s, side: "recipient", ws, award };
  throw notFound("Submission");
}

export async function getSubmission(ctx: ServiceContext, submissionId: string) {
  return submissionDetail(ctx, (await accessSubmission(ctx, submissionId, false)).s);
}

export async function listReceivedSubmissions(ctx: ServiceContext, page: PageRequest, f: { shared?: boolean; status?: string | undefined } = {}) {
  const ws = await authorize(ctx, { scope: "requirements:read", kind: "funder" });
  const all = (await ctx.repos.table("submissions").find({ workspace_id: ws.id, ...(f.status ? { status: f.status } : {}) }, { orderBy: "created_at", ascending: false, limit: 1000 })).filter((s) => (s.status !== "draft" || s.shared_from_submission_id) && (f.shared === undefined || (s.shared_from_submission_id !== null) === f.shared));
  return { items: await Promise.all(all.slice(page.offset, page.offset + page.pageSize).map((s) => submissionDetail(ctx, s))), total: all.length };
}

export const reviewInput = z.object({ note: z.string().trim().max(5000).optional() }).strict();

/** Accept a report. The requirement is accepted with it, and a tranche waiting on it becomes due. */
export async function acceptSubmission(ctx: ServiceContext, submissionId: string, input: z.output<typeof reviewInput> = {}) {
  const { s, side, ws } = await accessSubmission(ctx, submissionId, true);
  if (side !== "funder" || (ws.role !== null && !(REQUIREMENT_STAFF as readonly string[]).includes(ws.role))) throw new ApiError(403, "forbidden", "Only the funder's program or finance staff can accept a report");
  if (s.shared_from_submission_id) throw new ApiError(409, "shared_submission", "A report shared by a grantee is for reference; there is nothing to accept");
  let sub = s;
  if (sub.status === "submitted") sub = await moveSubmission(ctx, sub, "start_review", "funder");
  sub = await moveSubmission(ctx, sub, "accept", "funder", { ...(input.note ? { reviewNote: input.note } : {}) });
  let r = required(await ctx.repos.table("requirements").one({ id: sub.requirement_id! }), "Requirement");
  if (r.status === "submitted") r = await moveRequirement(ctx, r, "start_review", "funder");
  // Only a tranche of the same award and workspace can be waiting on this requirement.
  const tranche = r.releases_tranche_id ? await ctx.repos.table("tranches").one({ id: r.releases_tranche_id, award_id: r.award_id, workspace_id: r.workspace_id }) : null;
  const result = await acceptRequirement(
    { requirement: { id: r.id, status: r.status as RequirementStatus, releasesTrancheId: r.releases_tranche_id }, tranche: tranche ? { id: tranche.id, status: tranche.status as TrancheStatus, condition: tranche.condition as unknown as TrancheCondition } : null },
    { id: ctx.actor.id, kind: "funder" },
    { now: ctx.now().toISOString() },
    requirementPorts(ctx, r.workspace_id, r.award_id),
  );
  if (!result.requirement.ok) throw new ApiError(409, result.requirement.code, result.requirement.reason);
  return { ...(await submissionDetail(ctx, sub)), requirementStatus: "accepted", trancheDue: result.trancheDue ? apiId("tranche", result.trancheDue) : null };
}

export const returnInput = z.object({ note: z.string().trim().min(1).max(5000) }).strict();

/** Return a report with a note. The requirement goes back to `due` and the grantee can revise. */
export async function returnSubmission(ctx: ServiceContext, submissionId: string, input: z.output<typeof returnInput>) {
  const { s, side, ws } = await accessSubmission(ctx, submissionId, true);
  if (side !== "funder" || (ws.role !== null && !(REQUIREMENT_STAFF as readonly string[]).includes(ws.role))) throw new ApiError(403, "forbidden", "Only the funder's program or finance staff can return a report");
  let sub = s;
  if (sub.status === "submitted") sub = await moveSubmission(ctx, sub, "start_review", "funder");
  sub = await moveSubmission(ctx, sub, "return", "funder", { reviewNote: input.note });
  await ctx.repos.table("form_responses").update({ submission_id: sub.id }, { locked_at: null });
  let r = required(await ctx.repos.table("requirements").one({ id: sub.requirement_id! }), "Requirement");
  if (r.status === "submitted") r = await moveRequirement(ctx, r, "start_review", "funder");
  r = await moveRequirement(ctx, r, "return", "funder", { reason: input.note });
  r = await moveRequirement(ctx, r, "reopen", "funder");
  return { ...(await submissionDetail(ctx, sub)), requirementStatus: r.status };
}

// ------------------------------------------------------------------------------------ grantee side

async function myAwards(ctx: ServiceContext, ws: ServiceWorkspace): Promise<Award[]> {
  return ctx.repos.table("awards").find({ recipient_workspace_id: ws.id, status: ["accepted", "active", "suspended", "completed"] }, { limit: 500 });
}

export async function listMyRequirements(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "requirements:read", kind: "applicant" });
  const awards = await myAwards(ctx, ws);
  if (!awards.length) return [];
  const rows = await ctx.repos.table("requirements").find({ award_id: awards.map((a) => a.id) }, { orderBy: "due_at" });
  const funders = await ctx.repos.table("workspaces").find({ id: [...new Set(awards.map((a) => a.workspace_id))] });
  return Promise.all(
    rows.map(async (r) => {
      const a = awards.find((x) => x.id === r.award_id)!;
      const f = funders.find((x) => x.id === a.workspace_id);
      return { ...requirementView(r, await latestSubmission(ctx, r.id)), award: { id: apiId("award", a.id), title: a.title }, funder: f ? { workspaceId: f.id, name: f.display_name, handle: f.handle, brand: f.brand } : null };
    }),
  );
}

/** Fill what can be filled: Passport first, then the last accepted report on this award, each marked with where it came from. */
async function prefillReport(ctx: ServiceContext, def: FormDefinition, r: Req, recipient: Row<"workspaces">): Promise<{ response: JsonObject; provenance: Provenance }> {
  const facts = orgFacts(recipient);
  const filled = prefill(def, buildPrefillSource(facts.org, facts.profile), {}, { as: facts.source === "self_declared" ? "self_declared" : "passport" });
  const response = { ...filled.response };
  const provenance: Provenance = { ...filled.provenance };
  const earlier = (await ctx.repos.table("submissions").find({ award_id: r.award_id, status: "accepted" }, { orderBy: "submitted_at", ascending: false, limit: 20 })).filter((s) => !s.shared_from_submission_id);
  for (const s of earlier) {
    const prior = await ctx.repos.table("form_responses").one({ submission_id: s.id, form_id: def.id });
    if (!prior) continue;
    for (const [key, value] of Object.entries(prior.response as JsonObject)) {
      if (response[key] !== undefined && response[key] !== null && response[key] !== "") continue;
      response[key] = value;
      provenance[`/${key}`] = "prior_submission";
    }
    break;
  }
  return { response, provenance };
}

/** Open (or return to) the report for a requirement. The first call creates the draft, prefilled. */
export async function startSubmission(ctx: ServiceContext, requirementId: string) {
  const ws = await authorize(ctx, { scope: "requirements:write", kind: "applicant" });
  const r = await ctx.repos.table("requirements").one({ id: requirementId });
  const award = r ? await ctx.repos.table("awards").one({ id: r.award_id }) : null;
  if (!r || !award || award.recipient_workspace_id !== ws.id) throw notFound("Requirement");
  if (["accepted", "waived"].includes(r.status)) throw new ApiError(409, "requirement_closed", `This requirement is ${r.status}`);
  const existing = await latestSubmission(ctx, r.id);
  if (existing && existing.status !== "accepted") return submissionDetail(ctx, existing);
  const s = await ctx.repos.table("submissions").insert({ workspace_id: r.workspace_id, requirement_id: r.id, award_id: r.award_id, status: "draft" });
  if (r.form_id && r.form_version) {
    const def = await formDef(ctx, r.form_id, r.form_version);
    const recipient = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
    const filled = await prefillReport(ctx, def, r, recipient);
    await ctx.repos.table("form_responses").insert({ workspace_id: r.workspace_id, submission_id: s.id, form_id: r.form_id, form_version: r.form_version, response: filled.response as Resp["response"], provenance: filled.provenance as Resp["provenance"], ...checked(def, filled.response, filled.provenance) });
  }
  await audit(ctx, "submission.started", "submission", s.id, { requirementId: r.id, awardId: r.award_id }, r.workspace_id);
  return submissionDetail(ctx, s);
}

export const submissionFormInput = z.object({ response: z.record(z.string(), z.unknown()) }).strict();

export async function putSubmissionForm(ctx: ServiceContext, submissionId: string, formId: string, input: z.output<typeof submissionFormInput>) {
  let { s } = await accessSubmission(ctx, submissionId, true);
  const { side } = await accessSubmission(ctx, submissionId, true);
  if (side !== "recipient") throw new ApiError(403, "forbidden", "Only the grantee can edit a report");
  if (s.status === "returned") s = await moveSubmission(ctx, s, "revise", "applicant");
  if (s.status !== "draft") throw new ApiError(409, "submission_locked", `This report is ${s.status.replace(/_/g, " ")} and can no longer be edited`);
  const row = required(await ctx.repos.table("form_responses").one({ submission_id: s.id, form_id: formId }), "Form");
  const def = await formDef(ctx, row.form_id, row.form_version);
  const merged = mergeResponse(row.response as JsonObject, input.response as JsonObject, { provenance: row.provenance as Provenance, actor: ctx.actor.kind === "user" ? "user" : `agent:${ctx.actor.clientId}`, lockedPaths: passportFieldPaths(def) });
  const [saved] = await ctx.repos.table("form_responses").update({ id: row.id }, { response: merged.response as Resp["response"], provenance: merged.provenance as Resp["provenance"], ...checked(def, merged.response, merged.provenance) });
  return { ...responseView(saved ?? row), rejected: merged.rejected };
}

export async function submitSubmission(ctx: ServiceContext, submissionId: string) {
  const { s, side } = await accessSubmission(ctx, submissionId, true);
  if (side !== "recipient") throw new ApiError(403, "forbidden", "Only the grantee can submit a report");
  let sub = s.status === "returned" ? await moveSubmission(ctx, s, "revise", "applicant") : s;
  const rows = await ctx.repos.table("form_responses").find({ submission_id: sub.id });
  const problems: { path: string; message: string }[] = [];
  for (const row of rows) {
    const def = await formDef(ctx, row.form_id, row.form_version);
    for (const e of validateResponse(def, row.response as JsonObject).validationErrors) problems.push({ path: `${apiId("form", row.form_id)}${e.field}`, message: e.message });
  }
  if (problems.length) throw unprocessable("The report is not complete", problems);
  sub = await moveSubmission(ctx, sub, "submit", "applicant", { formsComplete: true });
  await ctx.repos.table("form_responses").update({ submission_id: sub.id }, { locked_at: ctx.now().toISOString() });
  let r = required(await ctx.repos.table("requirements").one({ id: sub.requirement_id! }), "Requirement");
  // A report sent before its window opens is still a report: open the window, then record it.
  if (r.status === "scheduled") r = await moveRequirement(ctx, r, "mark_due", "system");
  r = await moveRequirement(ctx, r, "submit", "applicant");
  return { ...(await submissionDetail(ctx, sub)), requirementStatus: r.status };
}

export const shareInput = z.object({ funderWorkspaceId: z.uuid().optional(), funderHandle: z.string().trim().min(1).max(100).optional(), fields: z.array(z.string().min(1).max(200)).max(200).optional(), note: z.string().trim().max(2000).optional() }).strict().refine((v) => !!v.funderWorkspaceId !== !!v.funderHandle, "Name the funder by workspace id or by handle");

/**
 * The grantee shares an accepted report with another funder (§10.8). This is the grantee's
 * consent: a `consents` row (basis `shared_submission`), a copy of the chosen fields in the
 * target funder's workspace flagged as shared, and a ledger entry on both sides.
 */
export async function shareSubmission(ctx: ServiceContext, submissionId: string, input: z.output<typeof shareInput>) {
  const { s, side, ws } = await accessSubmission(ctx, submissionId, true);
  if (side !== "recipient") throw new ApiError(403, "forbidden", "Only the grantee can share a report");
  if (ctx.actor.kind !== "user" && !ctx.actor.userId) throw new ApiError(403, "person_required", "Sharing a report is the grantee's consent and must come from a person");
  if (s.status !== "accepted") throw new ApiError(409, "not_accepted", "Only an accepted report can be shared");
  const target = input.funderWorkspaceId ? await ctx.repos.table("workspaces").one({ id: input.funderWorkspaceId }) : await ctx.repos.table("workspaces").one({ handle: input.funderHandle! });
  if (!target || target.kind !== "funder") throw notFound("Funder");
  if (target.id === s.workspace_id) throw new ApiError(409, "same_funder", "This funder already has the report");
  if (await ctx.repos.table("submissions").one({ workspace_id: target.id, shared_from_submission_id: s.id })) throw new ApiError(409, "already_shared", "This report is already shared with that funder");

  if (!(await ctx.repos.table("consents").one({ applicant_workspace_id: ws.id, funder_workspace_id: target.id, basis: "shared_submission", revoked_at: null }))) {
    await ctx.repos.table("consents").insert({ applicant_workspace_id: ws.id, funder_workspace_id: target.id, basis: "shared_submission", scopes: ["submission:read"], granted_by: ctx.actor.userId, granted_at: ctx.now().toISOString() });
  }
  const copy = await ctx.repos.table("submissions").insert({ workspace_id: target.id, requirement_id: null, award_id: null, status: "submitted", submitted_at: ctx.now().toISOString(), submitted_by: ctx.actor.userId, shared_from_submission_id: s.id, shared_fields: (input.fields ?? null) as Sub["shared_fields"] });
  for (const row of await ctx.repos.table("form_responses").find({ submission_id: s.id })) {
    const all = row.response as JsonObject;
    const response = input.fields ? Object.fromEntries(Object.entries(all).filter(([k]) => input.fields!.includes(k))) : all;
    await ctx.repos.table("form_responses").insert({ workspace_id: target.id, submission_id: copy.id, form_id: row.form_id, form_version: row.form_version, response: response as Resp["response"], provenance: row.provenance, status: row.status, validation_errors: [], locked_at: ctx.now().toISOString() });
  }
  await audit(ctx, "submission.shared", "submission", s.id, { withWorkspaceId: target.id, fields: input.fields ?? "all" }, s.workspace_id);
  await audit(ctx, "submission.received_shared", "submission", copy.id, { fromApplicantWorkspaceId: ws.id }, target.id);
  await emitFor(ctx, target.id, "submission.received", { submissionId: copy.id, shared: true, applicantWorkspaceId: ws.id });
  // Tell the receiving funder's staff, when mail is configured. Failure to notify does not undo the share.
  const sender = await ctx.repos.table("workspaces").one({ id: ws.id });
  const to = primaryEmail((target.org_projection as JsonObject | null) ?? {});
  if (ctx.ports.mailer && ctx.config.mailFrom && to) {
    await ctx.ports.mailer.send({ from: ctx.config.mailFrom, to: [to], subject: `${sender?.display_name ?? "A grantee"} shared a report with you`, text: `${sender?.display_name ?? "A grantee"} shared an accepted report with ${target.display_name}.${input.note ? `\n\n${input.note}` : ""}\n\nOpen it in Reporting: ${ctx.config.webBaseUrl}/w/${target.handle}/reporting`, html: `<p>${sender?.display_name ?? "A grantee"} shared an accepted report with ${target.display_name}.</p><p><a href="${ctx.config.webBaseUrl}/w/${target.handle}/reporting">Open it in Reporting</a></p>` }).catch(() => undefined);
  }
  return { sharedSubmissionId: apiId("submission", copy.id), funder: { workspaceId: target.id, name: target.display_name, handle: target.handle }, fields: input.fields ?? "all" };
}

// ------------------------------------------------------------------------------------ evaluators

/**
 * Job: open and close reporting windows. A scheduled requirement becomes `due` when its first
 * reminder would go out (the earliest offset of its plan); a due one becomes `overdue` once the
 * due date and its grace days have passed.
 */
export async function evaluateRequirement(ctx: ServiceContext, r: Req): Promise<"due" | "overdue" | null> {
  if (!r.due_at) return null;
  const now = ctx.now().getTime();
  const due = Date.parse(r.due_at);
  const plan = (r.reminder_plan as unknown as number[] | null) ?? [...DEFAULT_REMINDER_PLAN];
  // With no reminders planned the window still opens 30 days ahead, so the grantee sees the report as due.
  const lead = plan.length ? Math.max(0, -Math.min(0, ...plan)) : 30;
  if (r.status === "scheduled" && now >= due - lead * 86_400_000) {
    await moveRequirement(ctx, r, "mark_due", "system");
    return "due";
  }
  if (r.status === "due" && now > due + r.grace_days * 86_400_000) {
    await moveRequirement(ctx, r, "mark_overdue", "system");
    return "overdue";
  }
  return null;
}
