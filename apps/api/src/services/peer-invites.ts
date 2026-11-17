// SPDX-License-Identifier: AGPL-3.0-only
// Invite a peer funder (E4, loop 1). A funder admin invites another funder by email, with a short
// note of their own. The admin reads a preview of exactly what is sent; the email goes out once,
// under their name with replies to them, and nothing follows it: no reminder, no tracking pixel.
// At most PEER_INVITES_PER_WEEK per workspace per week, held in Postgres by unique places per week
// (peer_invitations, migration 0047), and one invitation per address per workspace, ever.
//
// Sending is a person's act on every surface: agents and API clients are refused (human_only),
// and no MCP tool sends one. Reading the list is open to the workspace's admins and to API
// clients with `workspace:admin`.
//
// The link opens the "for funders" page with the invitation's token (`?invite=`), which leads into
// funder setup; a workspace made from it is counted by the invitation's id (referrals.ts).
import { sha256Hex } from "@gms/documents";
import { DEFAULT_LOCALE } from "@gms/i18n";
import { cleanLine, cleanText, containsLink, fromWithName, PEER_INVITE_NOTE_MAX, peerInviteEmail } from "@gms/notify";
import { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import { maskEmail } from "./award-invitations.ts";
import { humanOnly } from "./awards.ts";
import { authorize, changeStatus, type ServiceContext } from "./context.ts";
import type { PublicContext } from "./public.ts";
import { INVITE_TOKEN, inviteToken, tokenHash } from "./referrals.ts";
import { RepoError, type Row } from "./repos/types.ts";

type Invitation = Row<"peer_invitations">;

/** Invitation emails per funder workspace per week (and over any seven days). One place to relax. */
export const PEER_INVITES_PER_WEEK = 5;
/** A row still `sending` after this long was never sent (the Worker stopped): its place is freed. */
export const STALE_SENDING_MS = 15 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const inviteInput = z
  .object({
    email: z.string().trim().max(320).pipe(z.email()),
    note: z.string().transform(cleanText).pipe(z.string().max(PEER_INVITE_NOTE_MAX)).optional(),
  })
  .strict();
export const sendInput = inviteInput
  .extend({
    /** The link token the preview made, so the email sent is the one previewed. */
    token: z.string().regex(INVITE_TOKEN, "The token from the preview"),
    digest: z.string().regex(/^[0-9a-f]{64}$/, "The digest from the preview"),
  })
  .strict();

/** The Monday (UTC) of the week `at` falls in, as YYYY-MM-DD. */
export function weekStartOf(at: Date): string {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const ADMIN = { scope: "workspace:admin", kind: "funder", roles: ["admin"] } as const;

/** Who may send: a signed-in admin of a funder workspace, never an agent or API client. */
export async function assertMayInvite(ctx: ServiceContext) {
  const ws = await authorize(ctx, { ...ADMIN, person: true });
  if (ctx.actor.kind !== "user") throw humanOnly("Inviting a funder");
  return ws;
}

/** The person's own name and sign-in address: the sender name and where replies go. Never typed. */
async function senderOf(ctx: ServiceContext) {
  const who = ctx.actor.userId && ctx.ports.directory ? (await ctx.ports.directory.lookup([ctx.actor.userId])).get(ctx.actor.userId) : undefined;
  const email = who?.email?.trim() ?? null;
  if (!email) throw new ApiError(422, "sender_unknown", "Your account has no email address for replies, so the invitation cannot be sent");
  const fallback = email.split("@")[0]!.replace(/[._+-]+/g, " ").trim().replace(/\b\p{L}/gu, (ch) => ch.toUpperCase());
  return { name: cleanLine(who?.name ?? "") || fallback || email, email };
}

const emailHashOf = (workspaceId: string, email: string) => sha256Hex(new TextEncoder().encode(`${workspaceId}:${email.trim().toLowerCase()}`));

/** This workspace's invitations sent over the last seven days, and this week's. */
async function usedOf(ctx: ServiceContext, workspaceId: string) {
  const rows = await ctx.repos.table("peer_invitations").find({ workspace_id: workspaceId }, { orderBy: "created_at", ascending: false, limit: 200 });
  const since = ctx.now().getTime() - WEEK_MS;
  const week = weekStartOf(ctx.now());
  const recent = rows.filter((r) => Date.parse(r.created_at) > since || r.week_start === week).length;
  return { recent, remaining: Math.max(0, PEER_INVITES_PER_WEEK - recent) };
}

/** The email exactly as it would be sent, with the digest that ties a send to it. */
async function compose(ctx: ServiceContext, input: z.output<typeof inviteInput>, token: string) {
  const ws = await assertMayInvite(ctx);
  const note = input.note?.trim() || null;
  if (note && containsLink(note)) throw new ApiError(422, "note_has_link", "Take the link or email address out of your note. The invitation carries one link only, to set up a funder workspace", [{ code: "note_has_link", field: "note" }]);
  const { mailer } = ctx.ports;
  const mailFrom = ctx.config.mailFrom;
  if (!mailer || !mailFrom) throw new ApiError(503, "mail_not_configured", "This server cannot send email, so invitations cannot be sent");
  const sender = await senderOf(ctx);
  const to = input.email.trim().toLowerCase();
  if (to === sender.email.toLowerCase()) throw new ApiError(422, "invite_yourself", "Enter the address of the funder you are inviting, not your own", [{ code: "invite_yourself", field: "email" }]);
  const funder = (await ctx.repos.table("workspaces").one({ id: ws.id }))!;
  // The note is in the sender's words, so the fixed words are in the language they read the preview in.
  const locale = ctx.locale ?? DEFAULT_LOCALE;
  const joinUrl = `${ctx.config.webBaseUrl}/for-funders?invite=${token}`;
  const mail = peerInviteEmail({ inviterName: sender.name, funderName: funder.display_name, note, joinUrl, locale });
  const email = { from: fromWithName(sender.name, mailFrom), to, replyTo: sender.email, subject: mail.subject, text: mail.text, html: mail.html, ...(locale === DEFAULT_LOCALE ? {} : { locale }) };
  const digest = await sha256Hex(new TextEncoder().encode(JSON.stringify(email)));
  return { ws, email, digest, note };
}

/** Exactly what would be sent, and to whom. Nothing is sent or counted. */
export async function previewPeerInvite(ctx: ServiceContext, input: z.output<typeof inviteInput>) {
  const token = inviteToken();
  const { ws, email, digest } = await compose(ctx, input, token);
  const used = await usedOf(ctx, ws.id);
  const already = await ctx.repos.table("peer_invitations").one({ workspace_id: ws.id, email_hash: await emailHashOf(ws.id, email.to) });
  return { ...email, token, digest, perWeek: PEER_INVITES_PER_WEEK, remainingThisWeek: used.remaining, alreadyInvited: !!already && already.status !== "sending" };
}

/** Take the first free place of this week, or null when all are taken. Refuses an address this workspace already invited. */
async function claimPlace(ctx: ServiceContext, workspaceId: string, fields: { emailHash: string; masked: string; tokenHash: string }): Promise<Invitation | null> {
  const already = await ctx.repos.table("peer_invitations").one({ workspace_id: workspaceId, email_hash: fields.emailHash });
  if (already) {
    // A send that never finished frees its place and its address; anything else is final.
    if (already.status === "sending" && Date.parse(already.created_at) < ctx.now().getTime() - STALE_SENDING_MS) await ctx.repos.table("peer_invitations").remove({ id: already.id, status: "sending" });
    else throw new ApiError(409, "already_invited", "This address was already invited from this workspace. Invitations are sent once, with no reminders");
  }
  const week = weekStartOf(ctx.now());
  for (let slot = 1; slot <= PEER_INVITES_PER_WEEK; slot++) {
    try {
      return await ctx.repos.table("peer_invitations").insert({ workspace_id: workspaceId, invited_by: ctx.actor.userId!, email_masked: fields.masked, email_hash: fields.emailHash, token_hash: fields.tokenHash, week_start: week, slot, status: "sending" });
    } catch (e) {
      if (!(e instanceof RepoError && e.kind === "conflict")) throw e;
      if (await ctx.repos.table("peer_invitations").one({ workspace_id: workspaceId, email_hash: fields.emailHash })) throw new ApiError(409, "already_invited", "This address was already invited from this workspace. Invitations are sent once, with no reminders");
    }
  }
  return null;
}

/** Send the invitation, if it is still exactly the preview the admin read (`digest`). */
export async function sendPeerInvite(ctx: ServiceContext, input: z.output<typeof sendInput>) {
  const { ws, email, digest, note } = await compose(ctx, input, input.token);
  if (digest !== input.digest) throw new ApiError(409, "preview_changed", "The invitation changed since the preview. Look at the preview again before sending");
  const used = await usedOf(ctx, ws.id);
  const tooMany = () => new ApiError(429, "too_many_peer_invites", `A workspace can invite ${PEER_INVITES_PER_WEEK} funders a week. Try again next week`);
  if (used.remaining <= 0) throw tooMany();
  const masked = maskEmail(email.to);
  const row = await claimPlace(ctx, ws.id, { emailHash: await emailHashOf(ws.id, email.to), masked, tokenHash: await tokenHash(input.token) });
  if (!row) throw tooMany();
  try {
    await ctx.ports.mailer!.send({ from: email.from, to: [email.to], replyTo: email.replyTo, subject: email.subject, text: email.text, html: email.html, ...(email.locale ? { locale: email.locale } : {}), idempotencyKey: `peer-invite:${row.id}`, tags: [{ name: "kind", value: "peer_invitation" }] });
  } catch {
    await ctx.repos.table("peer_invitations").remove({ id: row.id, status: "sending" }).catch(() => undefined);
    throw new ApiError(502, "mail_failed", "The invitation could not be sent. Try again in a few minutes");
  }
  const at = ctx.now().toISOString();
  await changeStatus(ctx, {
    event: "peer_invitation.sent",
    subjectType: "peer_invitation",
    subjectId: row.id,
    current: "sending",
    from: ["sending"],
    to: "sent",
    write: async () => {
      await ctx.repos.table("peer_invitations").update({ id: row.id, status: "sending" }, { status: "sent", sent_at: at });
    },
    data: { to: masked, noteLength: note?.length ?? 0, weekStart: row.week_start },
  });
  return { sent: true, invitation: invitationView({ ...row, status: "sent", sent_at: at }), remainingThisWeek: Math.max(0, used.remaining - 1) };
}

const STATUS = { sending: "not_sent", sent: "sent", joined: "joined" } as const;
const invitationView = (r: Invitation) => ({
  id: r.id,
  to: r.email_masked,
  // A send that is still `sending` shows as not sent: it either finishes in a moment or never went out.
  status: STATUS[r.status as keyof typeof STATUS] ?? "not_sent",
  sentAt: r.sent_at,
  joinedCount: r.joined_count,
  firstJoinedAt: r.first_joined_at,
  createdAt: r.created_at,
});

/** The workspace's invitations, newest first: masked address, sent or joined, how many joined. */
export async function listPeerInvitations(ctx: ServiceContext) {
  const ws = await authorize(ctx, ADMIN);
  const rows = await ctx.repos.table("peer_invitations").find({ workspace_id: ws.id }, { orderBy: "created_at", ascending: false, limit: 200 });
  const used = await usedOf(ctx, ws.id);
  const mailReady = !!ctx.ports.mailer && !!ctx.config.mailFrom;
  return {
    items: rows.map(invitationView),
    perWeek: PEER_INVITES_PER_WEEK,
    remainingThisWeek: used.remaining,
    joined: rows.reduce((n, r) => n + r.joined_count, 0),
    canInvite: ctx.actor.kind === "user" && mailReady && used.remaining > 0,
    reason: ctx.actor.kind !== "user" ? "Only a person invites a funder, in the GMS" : !mailReady ? "This server cannot send email" : used.remaining <= 0 ? `This workspace invited ${PEER_INVITES_PER_WEEK} funders this week. Try again next week` : null,
  };
}

/**
 * What the "for funders" page says about an invitation: who invited them. Unknown, unsent or
 * malformed tokens read as no invitation, so a token cannot be probed for more than a name.
 */
export async function invitationLanding(ctx: Pick<PublicContext, "repos"> & { ports?: ServiceContext["ports"] }, token: string | null | undefined) {
  if (!token || !INVITE_TOKEN.test(token)) return null;
  const inv = await ctx.repos.table("peer_invitations").one({ token_hash: await tokenHash(token) });
  if (!inv || inv.status === "sending") return null;
  const funder = await ctx.repos.table("workspaces").one({ id: inv.workspace_id });
  if (!funder || funder.status !== "active") return null;
  const who = ctx.ports?.directory ? (await ctx.ports.directory.lookup([inv.invited_by])).get(inv.invited_by) : undefined;
  return { funder: { name: funder.display_name, handle: funder.handle }, inviter: cleanLine(who?.name ?? "") || null };
}
