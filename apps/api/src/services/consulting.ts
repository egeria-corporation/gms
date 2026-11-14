// SPDX-License-Identifier: AGPL-3.0-only
// "Get help writing this" (owner decision D7): from an outside application, a person asks
// OpenGrants for consulting support. The preview shows exactly what will be sent; sending emails it
// through the notify/Resend path to CONSULTING_REQUEST_TO (on by default on every install), with
// replies going to the person. Human only: there is no MCP tool, and an agent's token is refused.
// Limits: 3 per application and 10 per workspace per rolling 24 hours, counted atomically.
import { CONSULTING_ANSWERS_MAX, CONSULTING_REQUEST_TO, cleanLine, cleanText, consultingRequestEmail, type ConsultingRequestContent } from "@gms/notify";
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import type { RpcLike } from "../lib/rate-limit.ts";
import { maskEmail } from "./award-invitations.ts";
import { audit, type ServiceContext } from "./context.ts";
import { printMoney } from "./awards.ts";
import { toMoney } from "@gms/protocol";
import { deadlinesOf, loadOutside, requirePerson, stageLabel } from "./outside.ts";
import type { Repos } from "./repos/types.ts";

/** The send limits; one place to relax them. */
export const CONSULTING_LIMITS = { perApplication: 3, perWorkspace: 10 } as const;
/** Who may ask: people who write applications. */
const CONSULTING_ROLES = ["admin", "editor"] as const;

export type ConsultingField = "organization" | "requester" | "title" | "funder" | "deadlines" | "ask" | "links" | "stage" | "questionCount" | "message" | "answers";

export interface ConsultingClaim {
  workspaceId: string;
  applicationId: string;
  requestedBy: string;
  contactName: string;
  contactEmailMasked: string;
  fieldsSent: ConsultingField[];
}

export type ConsultingOutcome = { ok: true; requestId: string } | { ok: false; limit: "application" | "workspace" | "not_found" };

/** Count one request against both limits and record it, or (at a limit) record nothing. */
export interface ConsultingStore {
  claim(c: ConsultingClaim, limits: typeof CONSULTING_LIMITS): Promise<ConsultingOutcome>;
  /** Give back a request whose email was not sent. */
  release(requestId: string): Promise<void>;
  markSent(requestId: string, at: string): Promise<void>;
}

/** The Postgres functions of migration 0029, with the service role. */
export class SupabaseConsultingStore implements ConsultingStore {
  constructor(
    private readonly client: RpcLike,
    private readonly repos: Repos,
  ) {}
  async claim(c: ConsultingClaim, limits: typeof CONSULTING_LIMITS): Promise<ConsultingOutcome> {
    const { data, error } = await this.client.rpc("gms_claim_consulting_request", { p_workspace: c.workspaceId, p_application: c.applicationId, p_requested_by: c.requestedBy, p_contact_name: c.contactName, p_contact_email_masked: c.contactEmailMasked, p_fields_sent: c.fieldsSent, p_application_limit: limits.perApplication, p_workspace_limit: limits.perWorkspace });
    if (error) throw new Error(`Counting a consulting request failed: ${error.message}`);
    const row = (data ?? {}) as { outcome?: string; requestId?: string };
    if (row.outcome === "ok" && typeof row.requestId === "string") return { ok: true, requestId: row.requestId };
    if (row.outcome === "application" || row.outcome === "workspace" || row.outcome === "not_found") return { ok: false, limit: row.outcome };
    throw new Error("Counting a consulting request returned an unexpected answer");
  }
  async release(requestId: string): Promise<void> {
    const { error } = await this.client.rpc("gms_release_consulting_request", { p_request: requestId });
    if (error) throw new Error(`Releasing a consulting request failed: ${error.message}`);
  }
  async markSent(requestId: string, at: string): Promise<void> {
    await this.repos.table("consulting_requests").update({ id: requestId }, { sent_at: at });
  }
}

/** One isolate's version over the repositories: the count and the insert run one claim at a time. */
export class RepoConsultingStore implements ConsultingStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly repos: Repos,
    private readonly now: () => Date,
  ) {}
  claim(c: ConsultingClaim, limits: typeof CONSULTING_LIMITS): Promise<ConsultingOutcome> {
    const run = this.queue.then(async (): Promise<ConsultingOutcome> => {
      const since = new Date(this.now().getTime() - 86_400_000).toISOString();
      const app = await this.repos.table("outside_applications").one({ id: c.applicationId, workspace_id: c.workspaceId });
      if (!app) return { ok: false, limit: "not_found" };
      const recent = (await this.repos.table("consulting_requests").find({ workspace_id: c.workspaceId })).filter((r) => r.created_at > since);
      if (recent.filter((r) => r.outside_application_id === c.applicationId).length >= limits.perApplication) return { ok: false, limit: "application" };
      if (recent.length >= limits.perWorkspace) return { ok: false, limit: "workspace" };
      const row = await this.repos.table("consulting_requests").insert({ workspace_id: c.workspaceId, outside_application_id: c.applicationId, requested_by: c.requestedBy, contact_name: c.contactName, contact_email_masked: c.contactEmailMasked, fields_sent: c.fieldsSent });
      return { ok: true, requestId: row.id };
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
  async release(requestId: string): Promise<void> {
    await this.repos.table("consulting_requests").remove({ id: requestId, sent_at: null });
  }
  async markSent(requestId: string, at: string): Promise<void> {
    await this.repos.table("consulting_requests").update({ id: requestId }, { sent_at: at });
  }
}

/** The repository store for one isolate, per repository (tests and installs without the Postgres functions). */
const fallbacks = new WeakMap<Repos, RepoConsultingStore>();
const storeOf = (ctx: ServiceContext): ConsultingStore => {
  if (ctx.ports.consulting) return ctx.ports.consulting;
  let s = fallbacks.get(ctx.repos);
  if (!s) fallbacks.set(ctx.repos, (s = new RepoConsultingStore(ctx.repos, ctx.now)));
  return s;
};

export const consultingInput = z
  .object({
    contactName: z.string().transform(cleanLine).pipe(z.string().min(1).max(200)).optional(),
    contactEmail: z.string().trim().max(320).pipe(z.email()).optional(),
    message: z.string().transform(cleanText).pipe(z.string().max(5000)).optional(),
    includeAnswers: z.boolean().default(false),
  })
  .strict();

const DEADLINE_LABEL = { loi: "Letter of inquiry due", full: "Application due", internal: "Internal deadline" } as const;

async function contentFor(ctx: ServiceContext, id: string, input: z.output<typeof consultingInput>) {
  const { ws, row } = await loadOutside(ctx, id, "applications:write");
  const me = await ctx.repos.table("workspaces").one({ id: ws.id });
  const who = ctx.actor.userId && ctx.ports.directory ? (await ctx.ports.directory.lookup([ctx.actor.userId])).get(ctx.actor.userId) : undefined;
  const name = input.contactName ?? (who?.name ? cleanLine(who.name) : null);
  const email = input.contactEmail ?? who?.email ?? null;
  if (!name || !email) throw new ApiError(422, "contact_required", "Give the name and email address OpenGrants should reply to");
  const qa = await ctx.repos.table("outside_questions").find({ workspace_id: ws.id, outside_application_id: row.id, obligation_id: null });
  let answers: { prompt: string; answer: string }[] | null = null;
  if (input.includeAnswers) {
    const versions = qa.length ? await ctx.repos.table("outside_answers").find({ workspace_id: ws.id, question_id: qa.map((q) => q.id) }) : [];
    const latest = new Map<string, { version: number; body: string }>();
    for (const v of versions) if ((latest.get(v.question_id)?.version ?? 0) < v.version) latest.set(v.question_id, v);
    answers = [...qa].sort((a, b) => a.phase.localeCompare(b.phase) || a.position - b.position).map((q) => ({ prompt: q.prompt, answer: latest.get(q.id)?.body ?? "" }));
  }
  const deadlines: { label: string; date: string }[] = (["loi", "full", "internal"] as const).flatMap((k) => {
    const date = k === "loi" ? row.loi_due : k === "full" ? row.full_due : row.internal_due;
    return date ? [{ label: DEADLINE_LABEL[k], date }] : [];
  });
  if (row.rolling) deadlines.push({ label: "Deadline", date: "Rolling" });
  const content: ConsultingRequestContent = {
    organization: me?.legal_name ?? me?.display_name ?? "Organization",
    requester: { name, email },
    title: row.title,
    funder: row.funder_name,
    stage: stageLabel(row.stage),
    deadlines,
    ask: row.ask_amount_minor === null ? null : printMoney(row.ask_amount_minor, row.currency),
    links: [...(row.listing_url ? [{ label: "Funder's listing", url: row.listing_url }] : []), ...(row.portal_url ? [{ label: "Funder's portal", url: row.portal_url }] : [])],
    questionCount: qa.length,
    message: input.message || null,
    answers,
  };
  const fields: ConsultingField[] = ["organization", "requester", "title", "funder", "deadlines", "ask", "links", "stage", "questionCount", ...(content.message ? (["message"] as const) : []), ...(answers ? (["answers"] as const) : [])];
  return { ws, row, content, fields, ask: row.ask_amount_minor === null ? null : toMoney(row.ask_amount_minor, row.currency) };
}

const recipient = (ctx: ServiceContext) => ctx.config.consultingRequestTo?.trim() || CONSULTING_REQUEST_TO;

/** Exactly what would be sent, and to whom. Nothing is sent or counted. */
export async function previewConsultingRequest(ctx: ServiceContext, id: string, input: z.output<typeof consultingInput>) {
  requirePerson(ctx, "Asking for consulting help");
  const { row, content, fields, ask } = await contentFor(ctx, id, input);
  await assertRole(ctx);
  const mail = consultingRequestEmail(content);
  const answersText = content.answers ? content.answers.map((a, i) => `${i + 1}. ${a.prompt}\n${a.answer}`).join("\n\n") : "";
  // The same facts, one per field, as the confirmation dialog shows them; `text` is the email itself.
  return {
    to: recipient(ctx),
    replyTo: content.requester.email,
    subject: mail.subject,
    text: mail.text,
    organization: content.organization,
    contactName: content.requester.name,
    contactEmail: content.requester.email,
    title: content.title,
    funder: content.funder,
    deadlines: deadlinesOf(row),
    ask,
    listingUrl: row.listing_url,
    portalUrl: row.portal_url,
    stage: row.stage,
    stageLabel: content.stage,
    questionCount: content.questionCount,
    message: content.message,
    answers: content.answers ? content.answers.map((a) => ({ prompt: a.prompt, body: a.answer })) : null,
    answersTruncated: answersText.length > CONSULTING_ANSWERS_MAX,
    content,
    fieldsSent: fields,
  };
}

async function assertRole(ctx: ServiceContext) {
  if (ctx.workspace?.role && !(CONSULTING_ROLES as readonly string[]).includes(ctx.workspace.role)) throw new ApiError(403, "insufficient_role", `This needs one of these roles: ${CONSULTING_ROLES.join(", ")}`);
}

/** Send the request: counted against the limits first, recorded with a masked address, ledgered. */
export async function sendConsultingRequest(ctx: ServiceContext, id: string, input: z.output<typeof consultingInput>) {
  requirePerson(ctx, "Asking for consulting help");
  const { ws, row, content, fields } = await contentFor(ctx, id, input);
  await assertRole(ctx);
  const { mailer } = ctx.ports;
  const from = ctx.config.mailFrom;
  if (!mailer || !from) throw new ApiError(503, "mail_not_configured", "This server cannot send email, so the request cannot be sent. Write to OpenGrants directly");
  const masked = maskEmail(content.requester.email);
  const store = storeOf(ctx);
  const claim = await store.claim({ workspaceId: ws.id, applicationId: row.id, requestedBy: ctx.actor.userId!, contactName: content.requester.name, contactEmailMasked: masked, fieldsSent: fields }, CONSULTING_LIMITS);
  if (!claim.ok) {
    if (claim.limit === "not_found") throw new ApiError(404, "not_found", "Outside application not found");
    throw new ApiError(429, claim.limit === "application" ? "too_many_requests_for_application" : "too_many_requests", claim.limit === "application" ? `Up to ${CONSULTING_LIMITS.perApplication} requests a day can be sent for one application` : `Up to ${CONSULTING_LIMITS.perWorkspace} requests a day can be sent from one workspace`);
  }
  const mail = consultingRequestEmail(content);
  try {
    await mailer.send({ from, to: [recipient(ctx)], replyTo: content.requester.email, subject: mail.subject, text: mail.text, html: mail.html, idempotencyKey: `consulting:${claim.requestId}`, tags: [{ name: "kind", value: "consulting_request" }] });
  } catch {
    await store.release(claim.requestId).catch(() => undefined);
    throw new ApiError(502, "mail_failed", "The request could not be sent. Try again in a few minutes");
  }
  const at = ctx.now().toISOString();
  await store.markSent(claim.requestId, at);
  await audit(ctx, "outside_application.consulting_requested", "outside_application", row.id, { requestId: claim.requestId, contactEmail: masked, fieldsSent: fields, sentAt: at });
  return { sent: true, requestId: claim.requestId, sentAt: at, to: recipient(ctx), replyTo: content.requester.email, message: `OpenGrants consulting can start right away. The team will reply to ${content.requester.email}.` };
}
