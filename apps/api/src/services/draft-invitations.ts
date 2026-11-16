// SPDX-License-Identifier: AGPL-3.0-only
// Invite someone into a draft (v1.7.0). From the assignee picker of an outside application's
// question or a built-in application's section, a workspace admin types an address and clicks
// "Send invitation". That one click creates one row in `invitations` and sends one transactional
// email; nothing is ever sent again for it (no reminders), and no address book is read.
//
// The invited person joins as a consultant, the least privileged applicant role that can edit
// answers, scoped to that one draft: `applicationIds` (built-in, as consultants already were) or
// `outsideApplicationIds` (outside applications, through the cowriter access in ./outside.ts).
// On acceptance they are assigned the question or section and land on the draft.
//
// Ledger entries carry the address masked (`r…@example.org`). A workspace may create at most
// INVITATIONS_PER_DAY invitations in a rolling day, from this screen and Team & access together;
// the database holds the same limit (0032, gms.invitations_per_day()).
import { draftInvitationEmail } from "@gms/notify";
import { addressLocale } from "./recipient-locale.ts";
import { z } from "zod";
import { randomToken, sha256b64url } from "../auth/crypto.ts";
import { forbidden } from "../auth/verify.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import { apiId, uuidOf } from "../lib/ids.ts";
import { access } from "./apply.ts";
import { maskEmail } from "./award-invitations.ts";
import { audit, authorize, required, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import { COWRITER_ROLE, loadOutside, writable } from "./outside.ts";
import { RepoError, type Insert, type Row } from "./repos/types.ts";

/** The role an invited cowriter gets: the least privileged applicant role that can edit answers. */
export { COWRITER_ROLE };
/** Who may invite someone into a draft. One place to widen (e.g. to "editor"). */
export const DRAFT_INVITER_ROLES: readonly string[] = ["admin"];
/** Invitations a workspace may create per rolling day (both screens). Mirrors gms.invitations_per_day() in 0032. */
export const INVITATIONS_PER_DAY = 20;
/** How long the link in a draft invitation works. */
export const DRAFT_INVITATION_DAYS = 14;
/** The one-time notes a member can dismiss. */
export const NOTES = ["invite_teammate"] as const;
export type NoteKey = (typeof NOTES)[number];

const DAY_MS = 86_400_000;

export const draftRef = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("outside_application"), id: z.uuid(), questionId: z.uuid().optional() }).strict(),
  z
    .object({ kind: z.literal("application"), id: z.string().min(1).max(100), formId: z.string().min(1).max(100).optional(), section: z.string().trim().min(1).max(200).optional() })
    .strict()
    .refine((d) => !d.section || !!d.formId, { message: "A section is named together with its form", path: ["formId"] }),
]);
export const draftInvitationInput = z.object({ email: z.email().max(320), draft: draftRef }).strict();
export const draftInvitationQuery = z.object({ kind: z.enum(["outside_application", "application"]), id: z.string().min(1).max(100) }).strict();
export const noteInput = z.object({ note: z.enum(NOTES) }).strict();

/** The draft as stored in `invitations.scope.draft`: bare UUIDs. */
export interface DraftScope {
  kind: "outside_application" | "application";
  id: string;
  questionId?: string;
  formId?: string;
  section?: string;
}

/** The invitation's draft, or null for an ordinary Team & access invitation. */
export function draftOf(scope: unknown): DraftScope | null {
  const d = (scope as { draft?: unknown } | null)?.draft as Partial<DraftScope> | undefined;
  if (!d || typeof d !== "object" || typeof d.id !== "string" || (d.kind !== "outside_application" && d.kind !== "application")) return null;
  return {
    kind: d.kind,
    id: d.id,
    ...(typeof d.questionId === "string" ? { questionId: d.questionId } : {}),
    ...(typeof d.formId === "string" ? { formId: d.formId } : {}),
    ...(typeof d.section === "string" ? { section: d.section } : {}),
  };
}

/** The draft as the API names it: prefixed ids for built-in applications and forms. */
export const draftView = (d: DraftScope) =>
  d.kind === "application"
    ? { kind: d.kind, id: apiId("application", d.id), formId: d.formId ? apiId("form", d.formId) : null, section: d.section ?? null, questionId: null }
    : { kind: d.kind, id: d.id, formId: null, section: null, questionId: d.questionId ?? null };

/** The membership scope key that opens the draft to a consultant. */
const accessKey = (d: DraftScope) => (d.kind === "application" ? "applicationIds" : "outsideApplicationIds");

/** A signed-in person's own click. Never an agent or API client, with or without `approvals:bypass`. */
function requireOwnClick(ctx: ServiceContext) {
  if (ctx.actor.kind !== "user" || !ctx.actor.userId) throw forbidden("human_only", "An invitation is sent by a person's own click in the GMS, never by an agent or API client");
}

/** Invitations this workspace created in the last 24 hours. */
async function sentToday(ctx: ServiceContext, workspaceId: string): Promise<number> {
  const since = ctx.now().getTime() - DAY_MS;
  const rows = await ctx.repos.table("invitations").find({ workspace_id: workspaceId }, { orderBy: "created_at", ascending: false, limit: INVITATIONS_PER_DAY + 1 });
  return rows.filter((r) => Date.parse(r.created_at) > since).length;
}

const limitReached = () => new ApiError(429, "invitation_limit", `Your workspace has sent ${INVITATIONS_PER_DAY} invitations in the last 24 hours, the most allowed in a day. Try again tomorrow`);

/** Refuse a new invitation when the day's count is spent. Every invitation path calls this before writing. */
export async function assertInvitationAllowance(ctx: ServiceContext, workspaceId: string): Promise<void> {
  if ((await sentToday(ctx, workspaceId)) >= INVITATIONS_PER_DAY) throw limitReached();
}

/** Insert an invitation; the database's own count (0032) answers 429 as well. */
export async function insertInvitation(ctx: ServiceContext, row: Insert<"invitations">): Promise<Row<"invitations">> {
  try {
    return await ctx.repos.table("invitations").insert(row);
  } catch (e) {
    if (e instanceof RepoError && e.kind === "invalid" && /daily invitation limit/.test(e.message)) throw limitReached();
    throw e;
  }
}

/** The draft, checked for the caller: it exists in their workspace, they may write it, and it is still open. */
async function resolveDraft(ctx: ServiceContext, input: z.output<typeof draftRef>): Promise<{ draft: DraftScope; title: string; part: string | null }> {
  if (input.kind === "outside_application") {
    const { ws, row } = await loadOutside(ctx, input.id, "applications:write");
    writable(row);
    let part: string | null = null;
    if (input.questionId) {
      const q = await ctx.repos.table("outside_questions").one({ id: input.questionId, workspace_id: ws.id, outside_application_id: row.id });
      if (!q) throw notFound("Question");
      part = q.prompt;
    }
    return { draft: { kind: "outside_application", id: row.id, ...(input.questionId ? { questionId: input.questionId } : {}) }, title: row.title, part };
  }
  const appUuid = uuidOf("application", input.id, "Application");
  const { app, side } = await access(ctx, appUuid, "applications:write");
  if (side !== "applicant") throw notFound("Application");
  if (app.status !== "draft" && app.status !== "revision_requested") throw new ApiError(409, "application_locked", `This application is ${app.status.replace(/_/g, " ")}; invite someone while it is being written`);
  let formId: string | undefined;
  if (input.formId) {
    formId = uuidOf("form", input.formId, "Form");
    required(await ctx.repos.table("form_responses").one({ application_id: app.id, form_id: formId }), "Form response");
  }
  return { draft: { kind: "application", id: app.id, ...(formId ? { formId } : {}), ...(input.section ? { section: input.section } : {}) }, title: app.title, part: input.section ?? null };
}

const pending = (inv: Row<"invitations">, now: Date) => !inv.accepted_at && Date.parse(inv.expires_at) > now.getTime();

/** Is this address already on the team (by the account's address, or the address it was invited with)? */
async function isMember(ctx: ServiceContext, workspaceId: string, email: string): Promise<boolean> {
  const members = await ctx.repos.table("workspace_members").find({ workspace_id: workspaceId });
  if (members.some((m) => String((m.scope as { email?: unknown } | null)?.email ?? "").toLowerCase() === email)) return true;
  const people = (await ctx.ports.directory?.lookup(members.map((m) => m.user_id))) ?? new Map<string, { email: string | null }>();
  return [...people.values()].some((p) => p.email?.toLowerCase() === email);
}

/**
 * `POST /gms/draft-invitations`: invite someone by email into one draft. One invitation, one
 * email, on the admin's own click. The token comes back only inside `acceptUrl`, and only when
 * the email could not be sent, so the admin can pass the link on themselves.
 */
export async function createDraftInvitation(ctx: ServiceContext, input: z.output<typeof draftInvitationInput>) {
  requireOwnClick(ctx);
  const ws = await authorize(ctx, { scope: "applications:write", kind: "applicant", roles: DRAFT_INVITER_ROLES });
  const { draft, title, part } = await resolveDraft(ctx, input.draft);
  const email = input.email.trim().toLowerCase();
  if (await isMember(ctx, ws.id, email)) throw new ApiError(409, "already_member", "That person is already on your team. Choose them from the list instead", [{ code: "duplicate", field: "email" }]);
  const now = ctx.now();
  const open = (await ctx.repos.table("invitations").find({ workspace_id: ws.id, email, accepted_at: null })).filter((i) => pending(i, now));
  // No second email for an invitation still waiting: that would be a reminder.
  if (open.length) throw new ApiError(409, "already_invited", `${maskEmail(email)} already has an invitation waiting. It works until ${open[0]!.expires_at.slice(0, 10)}; nothing more is sent`, [{ code: "duplicate", field: "email" }]);
  await assertInvitationAllowance(ctx, ws.id);

  const token = randomToken("gms_inv_");
  const expiresAt = new Date(now.getTime() + DRAFT_INVITATION_DAYS * DAY_MS).toISOString();
  const row = await insertInvitation(ctx, {
    workspace_id: ws.id,
    email,
    role: COWRITER_ROLE,
    scope: { draft, [accessKey(draft)]: [draft.id] } as Row<"invitations">["scope"],
    token_hash: await sha256b64url(token),
    invited_by: ctx.actor.userId,
    expires_at: expiresAt,
  });
  const acceptUrl = `${ctx.config.webBaseUrl}/invitations/draft?token=${encodeURIComponent(token)}`;

  let emailed = false;
  if (ctx.ports.mailer && ctx.config.mailFrom) {
    try {
      const [workspace, people, locale] = await Promise.all([ctx.repos.table("workspaces").one({ id: ws.id }), ctx.ports.directory?.lookup([ctx.actor.userId!]), addressLocale(ctx, email)]);
      const m = draftInvitationEmail({
        locale,
        organization: workspace?.display_name ?? "",
        inviterName: people?.get(ctx.actor.userId!)?.name ?? null,
        draftTitle: title,
        part,
        invitedEmail: email,
        acceptUrl,
        homeUrl: ctx.config.webBaseUrl,
        expiresOn: expiresAt.slice(0, 10),
      });
      await ctx.ports.mailer.send({ from: ctx.config.mailFrom, to: [email], subject: m.subject, text: m.text, html: m.html, locale, idempotencyKey: `invitation:${row.id}`, tags: [{ name: "template", value: "draft_invitation" }] });
      emailed = true;
    } catch {
      // The invitation stands; the admin gets the link to pass on.
    }
  }
  const subject = draft.kind === "application" ? { type: "application", id: draft.id } : { type: "outside_application", id: draft.id };
  await audit(ctx, "invitation.created", subject.type, subject.id, { invitationId: row.id, role: COWRITER_ROLE, email: maskEmail(email), draft: draftView(draft), emailed });
  return { id: row.id, email: maskEmail(email), role: COWRITER_ROLE, draft: draftView(draft), expiresAt, emailed, acceptUrl: emailed ? null : acceptUrl };
}

/** The draft named by a query, checked for reading. Consultants do not see who else was invited. */
async function readableDraft(ctx: ServiceContext, query: z.output<typeof draftInvitationQuery>): Promise<{ ws: ServiceWorkspace; id: string }> {
  if (query.kind === "outside_application") {
    const { ws, row } = await loadOutside(ctx, query.id, "applications:read");
    return { ws, id: row.id };
  }
  const ws = await authorize(ctx, { scope: "applications:read", kind: "applicant" });
  if (ws.role === COWRITER_ROLE) throw notFound("Application");
  const { app, side } = await access(ctx, uuidOf("application", query.id, "Application"), "applications:read");
  if (side !== "applicant") throw notFound("Application");
  return { ws, id: app.id };
}

/** `GET /gms/draft-invitations?kind=&id=`: invitations into this draft still waiting, addresses masked. */
export async function listDraftInvitations(ctx: ServiceContext, query: z.output<typeof draftInvitationQuery>) {
  const { ws, id } = await readableDraft(ctx, query);
  const now = ctx.now();
  const rows = (await ctx.repos.table("invitations").find({ workspace_id: ws.id, accepted_at: null }, { orderBy: "created_at", ascending: false, limit: 500 })).filter((i) => pending(i, now) && draftOf(i.scope)?.id === id);
  const used = await sentToday(ctx, ws.id);
  return {
    invitations: rows.map((i) => ({ id: i.id, email: maskEmail(i.email), draft: draftView(draftOf(i.scope)!), expiresAt: i.expires_at, createdAt: i.created_at })),
    canInvite: ctx.actor.kind === "user" && ws.role !== null && DRAFT_INVITER_ROLES.includes(ws.role),
    perDay: INVITATIONS_PER_DAY,
    remainingToday: Math.max(0, INVITATIONS_PER_DAY - used),
  };
}

// ------------------------------------------------------------------------------------ acceptance

type Accepted = { draft: ReturnType<typeof draftView> & { assigned: boolean } } | { draft: null };

/**
 * After an invitation into a draft is accepted: open the draft to a consultant who already had
 * other drafts, assign the question or section if it is still unassigned, and say where to land.
 * Called by `acceptInvitation` in ./workspaces.ts, which has checked the token and the address.
 */
export async function afterDraftAccepted(ctx: ServiceContext, inv: Row<"invitations">, userId: string, existing: Row<"workspace_members"> | null): Promise<Accepted> {
  const draft = draftOf(inv.scope);
  if (!draft) return { draft: null };
  if (existing && existing.role === COWRITER_ROLE) {
    const scope = (existing.scope as Record<string, unknown> | null) ?? {};
    const key = accessKey(draft);
    const ids = Array.isArray(scope[key]) ? (scope[key] as unknown[]).filter((x): x is string => typeof x === "string") : [];
    if (!ids.includes(draft.id)) await ctx.repos.table("workspace_members").update({ id: existing.id }, { scope: { ...scope, [key]: [...ids, draft.id] } as Row<"workspace_members">["scope"] });
  }
  let assigned = false;
  if (draft.kind === "outside_application" && draft.questionId) {
    const q = await ctx.repos.table("outside_questions").one({ id: draft.questionId, workspace_id: inv.workspace_id, outside_application_id: draft.id });
    if (q && !q.assignee_user_id) {
      await ctx.repos.table("outside_questions").update({ id: q.id, workspace_id: inv.workspace_id }, { assignee_user_id: userId });
      assigned = true;
    }
  } else if (draft.kind === "application" && draft.formId && draft.section) {
    const r = await ctx.repos.table("form_responses").one({ application_id: draft.id, form_id: draft.formId });
    const sections = { ...((r?.section_assignments as Record<string, string> | null) ?? {}) };
    if (r && !sections[draft.section]) {
      await ctx.repos.table("form_responses").update({ id: r.id }, { section_assignments: { ...sections, [draft.section]: userId } });
      assigned = true;
    }
  }
  return { draft: { ...draftView(draft), assigned } };
}

/** The membership scope a new cowriter starts with: the draft's id, never the draft record itself. */
export function cowriterScope(inv: Row<"invitations">): Record<string, unknown> | null {
  const draft = draftOf(inv.scope);
  return draft ? { [accessKey(draft)]: [draft.id], email: inv.email } : null;
}

// ------------------------------------------------------------------------------------ one-time notes

async function myMembership(ctx: ServiceContext) {
  const ws = await authorize(ctx, { person: true });
  if (!ws) throw new ApiError(403, "workspace_required", "Name a workspace for this action");
  return required(await ctx.repos.table("workspace_members").one({ workspace_id: ws.id, user_id: ctx.actor.userId! }), "Member");
}

/** `GET /gms/me/notes`: the one-time notes this person dismissed in this workspace. */
export async function listDismissedNotes(ctx: ServiceContext) {
  const m = await myMembership(ctx);
  return { dismissed: (m.dismissed_notes ?? []).filter((n): n is NoteKey => (NOTES as readonly string[]).includes(n)) };
}

/** `POST /gms/me/notes/dismiss`: never show this note to this person in this workspace again. */
export async function dismissNote(ctx: ServiceContext, input: z.output<typeof noteInput>) {
  const m = await myMembership(ctx);
  const dismissed = [...new Set([...(m.dismissed_notes ?? []), input.note])].filter((n) => (NOTES as readonly string[]).includes(n));
  await ctx.repos.table("workspace_members").update({ id: m.id }, { dismissed_notes: dismissed });
  return { dismissed };
}
