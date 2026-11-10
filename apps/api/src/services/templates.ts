// SPDX-License-Identifier: AGPL-3.0-only
// Templates (letters, agreements, emails) and templated sends (build spec §9.2 Templates and sends).
// A template row is immutable: saving a template with the same kind and name adds a version, so an
// agreement or a sent letter always points at the exact text that was used.
import { DEFAULT_AGREEMENT_TEMPLATE, DEFAULT_AWARD_LETTER_TEMPLATE, mergeDocument } from "@gms/documents";
import type { JsonObject } from "@gms/forms";
import { DEFAULT_TEMPLATES, MissingFieldError, renderTemplate as renderEmailTemplate, templateFields, type MergeFields } from "@gms/notify";
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { passportFacts, primaryEmail } from "./apply.ts";
import { STAFF_ROLES, currencyOf, fundingOf, humanOnly, minorOf, printMoney } from "./awards.ts";
import { audit, authorize, required, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import type { PageRequest } from "./programs.ts";
import type { Row } from "./repos/types.ts";

type Template = Row<"templates">;
export const TEMPLATE_KINDS = ["letter", "agreement", "email"] as const;

/** An email template keeps its subject on the first line: `Subject: …`, then a blank line. */
const SUBJECT_LINE = /^Subject:[ \t]*(.*)\r?\n(?:\r?\n)?/i;
export function splitSubject(body: string): { subject: string | null; body: string } {
  const m = SUBJECT_LINE.exec(body);
  return m ? { subject: m[1]!.trim(), body: body.slice(m[0].length) } : { subject: null, body };
}

const view = (t: Template) => {
  const s = t.kind === "email" ? splitSubject(t.body) : { subject: null, body: t.body };
  return { id: t.id, kind: t.kind, name: t.name, version: t.version, subject: s.subject, body: s.body, fields: [...new Set([...(s.subject ? templateFields(s.subject) : []), ...templateFields(s.body)])], shared: t.workspace_id === null, createdAt: t.created_at };
};

/** The texts that ship with the GMS, used when a workspace has not written its own. */
export const BUILT_IN = [
  { id: "builtin:agreement", kind: "agreement", name: "Standard grant agreement", subject: null, body: DEFAULT_AGREEMENT_TEMPLATE },
  { id: "builtin:award_letter", kind: "letter", name: "Award letter", subject: null, body: DEFAULT_AWARD_LETTER_TEMPLATE },
  ...Object.values(DEFAULT_TEMPLATES).map((t) => ({ id: `builtin:${t.kind}`, kind: "email", name: t.name, subject: t.subject, body: t.body })),
].map((t) => ({ ...t, version: 1, fields: [...new Set([...(t.subject ? templateFields(t.subject) : []), ...templateFields(t.body)])], shared: true, builtIn: true }));

export async function listTemplates(ctx: ServiceContext, filter: { kind?: string } = {}) {
  const ws = await authorize(ctx, { scope: "communications:write", kind: "funder" });
  const [own, shared] = await Promise.all([ctx.repos.table("templates").find({ workspace_id: ws.id }, { orderBy: "name" }), ctx.repos.table("templates").find({ workspace_id: null }, { orderBy: "name" })]);
  // Only the latest version of each (kind, name) is offered; earlier versions stay reachable by id.
  const latest = new Map<string, Template>();
  for (const t of [...shared, ...own]) {
    const key = `${t.workspace_id ?? "shared"}|${t.kind}|${t.name}`;
    if (!latest.has(key) || latest.get(key)!.version < t.version) latest.set(key, t);
  }
  const rows = [...latest.values()].filter((t) => !filter.kind || t.kind === filter.kind);
  return { items: rows.map(view), builtIn: BUILT_IN.filter((t) => !filter.kind || t.kind === filter.kind) };
}

export const templateInput = z
  .object({ kind: z.enum(TEMPLATE_KINDS), name: z.string().trim().min(1).max(200), subject: z.string().trim().min(1).max(300).optional(), body: z.string().min(1).max(100_000) })
  .strict()
  .refine((t) => t.kind !== "email" || !!t.subject, { path: ["subject"], message: "An email template needs a subject" });

export async function createTemplate(ctx: ServiceContext, input: z.output<typeof templateInput>) {
  const ws = await authorize(ctx, { scope: "communications:write", kind: "funder", roles: STAFF_ROLES });
  const earlier = await ctx.repos.table("templates").find({ workspace_id: ws.id, kind: input.kind, name: input.name });
  const version = earlier.reduce((v, t) => Math.max(v, t.version), 0) + 1;
  const body = input.kind === "email" ? `Subject: ${input.subject!.replace(/[\r\n]+/g, " ")}\n\n${input.body}` : input.body;
  const row = await ctx.repos.table("templates").insert({ workspace_id: ws.id, kind: input.kind, name: input.name, body, version });
  await audit(ctx, "template.saved", "template", row.id, { kind: row.kind, name: row.name, version });
  return view(row);
}

async function load(ctx: ServiceContext, ws: ServiceWorkspace, id: string) {
  const builtIn = BUILT_IN.find((t) => t.id === id);
  if (builtIn) return builtIn;
  const row = /^[0-9a-f-]{36}$/i.test(id) ? await ctx.repos.table("templates").one({ id }) : null;
  if (!row || (row.workspace_id !== null && row.workspace_id !== ws.id)) required(null, "Template");
  return view(row!);
}

export async function getTemplate(ctx: ServiceContext, id: string) {
  return load(ctx, await authorize(ctx, { scope: "communications:write", kind: "funder" }), id);
}

const missing = (e: MissingFieldError) =>
  new ApiError(422, "missing_merge_fields", "Some merge fields have no value; nothing was rendered or sent", e.fields.map((f) => ({ code: "missing_field", field: f, detail: `{{${f}}} has no value` })));

function render(t: { kind: string; subject: string | null; body: string }, fields: MergeFields) {
  try {
    if (t.kind === "email") return renderEmailTemplate({ subject: t.subject ?? "", body: t.body }, fields);
    return { subject: null, text: mergeDocument(t.body, fields), html: null };
  } catch (e) {
    if (e instanceof MissingFieldError) throw missing(e);
    throw e;
  }
}

export const renderInput = z.object({ fields: z.record(z.string(), z.unknown()).default({}), applicationId: z.string().optional(), awardId: z.string().optional() }).strict();

/** Preview a template with merge fields. Fields derived from an application or award are filled in; `fields` override them. */
export async function renderTemplate(ctx: ServiceContext, id: string, input: { fields: Record<string, unknown>; applicationUuid?: string; awardUuid?: string }) {
  const ws = await authorize(ctx, { scope: "communications:write", kind: "funder" });
  const t = await load(ctx, ws, id);
  const derived = input.applicationUuid || input.awardUuid ? (await recipientFields(ctx, ws, { applicationUuid: input.applicationUuid, awardUuid: input.awardUuid })).fields : {};
  return { templateId: t.id, kind: t.kind, ...render(t, deepMerge(derived, input.fields as MergeFields)) };
}

function deepMerge(a: MergeFields, b: MergeFields): MergeFields {
  const out: MergeFields = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === "object" && out[k] && typeof out[k] === "object" ? deepMerge(out[k] as MergeFields, v as MergeFields) : v;
  return out;
}

/** Who a send goes to, and the merge fields the GMS knows for them. Email comes from the cached Passport record, by consent. */
async function recipientFields(ctx: ServiceContext, ws: ServiceWorkspace, r: { applicationUuid?: string; awardUuid?: string; applicantWorkspaceId?: string }): Promise<{ email: string | null; fields: MergeFields; subject: { type: string; id: string }; reason?: string }> {
  const funder = required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace");
  const fields: MergeFields = { funder: { name: funder.display_name } };
  let applicantId = r.applicantWorkspaceId ?? null;
  let subject = { type: "workspace", id: applicantId ?? ws.id };
  if (r.applicationUuid) {
    const app = required(await ctx.repos.table("applications").one({ id: r.applicationUuid, workspace_id: ws.id }), "Application");
    if (!app.submitted_at) required(null, "Application");
    const opp = await ctx.repos.table("opportunities").one({ id: app.opportunity_id });
    applicantId = app.applicant_workspace_id;
    subject = { type: "application", id: app.id };
    fields.application = { title: app.title, submittedAt: app.submitted_at?.slice(0, 10) ?? "" };
    fields.opportunity = { title: opp?.title ?? "" };
  }
  if (r.awardUuid) {
    const award = required(await ctx.repos.table("awards").one({ id: r.awardUuid, workspace_id: ws.id }), "Award");
    applicantId = award.recipient_workspace_id;
    subject = { type: "award", id: award.id };
    const minor = minorOf(fundingOf(award).awardedAmount);
    fields.award = { title: award.title, amount: minor === null ? "" : printMoney(minor, currencyOf(award)) };
  }
  const applicant = applicantId ? await ctx.repos.table("workspaces").one({ id: applicantId }) : null;
  if (!applicant) return { email: null, fields, subject, reason: "No recipient organization" };
  const consent = await ctx.repos.table("consents").one({ applicant_workspace_id: applicant.id, funder_workspace_id: ws.id, revoked_at: null });
  fields.recipient = { name: applicant.display_name };
  const award = fields.award as MergeFields | undefined;
  fields.links = {
    ...(r.applicationUuid ? { application: `${ctx.config.webBaseUrl}/w/${applicant.handle}/applications/${apiId("application", r.applicationUuid)}/edit`, status: `${ctx.config.webBaseUrl}/w/${applicant.handle}/applications/${apiId("application", r.applicationUuid)}` } : {}),
    ...(r.awardUuid && award ? { award: `${ctx.config.webBaseUrl}/w/${applicant.handle}/grants/${apiId("award", r.awardUuid)}` } : {}),
  };
  if (!consent) return { email: null, fields, subject, reason: "The organization has not shared its record with this funder" };
  return { email: primaryEmail(passportFacts(applicant).org as JsonObject), fields, subject };
}

export const sendInput = z
  .object({
    templateId: z.string().min(1).max(100),
    recipients: z.array(z.object({ applicationId: z.string().optional(), awardId: z.string().optional(), applicantWorkspaceId: z.uuid().optional() }).strict()).min(1).max(500),
    subjectOverride: z.string().trim().min(1).max(200).optional(),
    /** Extra merge fields applied to every recipient. */
    fields: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export interface ResolvedRecipient {
  applicationUuid?: string;
  awardUuid?: string;
  applicantWorkspaceId?: string;
}

/**
 * Send one email template to many recipients. Every letter is rendered first: if any recipient is
 * missing a merge field nothing is sent, so a batch never goes out half-blank.
 */
export async function sendCommunication(ctx: ServiceContext, input: z.output<typeof sendInput>, recipients: ResolvedRecipient[]) {
  const ws = await authorize(ctx, { scope: "communications:write", kind: "funder", roles: STAFF_ROLES, person: true });
  // A human gate (§10.9): an agent's send runs only after a person approves it in the GMS.
  if (ctx.actor.kind !== "user") throw humanOnly("Sending a communication");
  const t = await load(ctx, ws, input.templateId);
  if (t.kind !== "email") throw new ApiError(422, "not_an_email_template", "Only email templates can be sent; letters and agreements are documents");
  if (!ctx.ports.mailer || !ctx.config.mailFrom) throw new ApiError(503, "mail_not_configured", "Outbound mail is not configured on this server; nothing was sent");
  const template = input.subjectOverride ? { ...t, subject: input.subjectOverride } : t;
  const prepared = [];
  for (const r of recipients) {
    const who = await recipientFields(ctx, ws, r);
    prepared.push({ who, rendered: render(template, deepMerge(who.fields, (input.fields ?? {}) as MergeFields)) });
  }
  const batch = crypto.randomUUID();
  const results: { subject: { type: string; id: string }; sent: boolean; reason?: string }[] = [];
  for (const [i, { who, rendered }] of prepared.entries()) {
    if (!who.email) {
      results.push({ subject: who.subject, sent: false, reason: who.reason ?? "The organization has no primary email in Passport" });
      continue;
    }
    try {
      const { id } = await ctx.ports.mailer.send({ from: ctx.config.mailFrom, to: [who.email], subject: rendered.subject ?? "", html: rendered.html ?? "", text: rendered.text, idempotencyKey: `comm:${batch}:${i}` });
      await audit(ctx, "communication.sent", who.subject.type, who.subject.id, { template: t.id, templateName: t.name, batch, messageId: id });
      results.push({ subject: who.subject, sent: true });
    } catch (e) {
      await audit(ctx, "communication.failed", who.subject.type, who.subject.id, { template: t.id, templateName: t.name, batch, error: e instanceof Error ? e.name : "error" });
      results.push({ subject: who.subject, sent: false, reason: "The email could not be sent" });
    }
  }
  const sent = results.filter((r) => r.sent).length;
  await audit(ctx, "communications.batch", "workspace", ws.id, { template: t.id, batch, requested: recipients.length, sent });
  return { batch, templateId: t.id, requested: recipients.length, sent, results };
}

/** The send log: every templated email this workspace sent or failed to send, newest first. */
export async function listCommunications(ctx: ServiceContext, page: PageRequest) {
  const ws = await authorize(ctx, { scope: "communications:write", kind: "funder" });
  const [sent, failed] = await Promise.all([ctx.ledger.list({ workspaceId: ws.id, eventType: "communication.sent", limit: 2000 }), ctx.ledger.list({ workspaceId: ws.id, eventType: "communication.failed", limit: 2000 })]);
  const all = [...sent, ...failed].sort((a, b) => ((a.occurredAt ?? "") < (b.occurredAt ?? "") ? 1 : -1));
  return {
    items: all.slice(page.offset, page.offset + page.pageSize).map((e) => ({ status: e.eventType === "communication.sent" ? "sent" : "failed", subjectType: e.subjectType, subjectId: e.subjectId, template: (e.data?.template as string | undefined) ?? null, templateName: (e.data?.templateName as string | undefined) ?? null, batch: (e.data?.batch as string | undefined) ?? null, actor: e.actor, at: e.occurredAt ?? null })),
    total: all.length,
  };
}
