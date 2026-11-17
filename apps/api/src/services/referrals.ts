// SPDX-License-Identifier: AGPL-3.0-only
// Who joined from which link (E4, migration 0047). Three links bring people to the GMS:
//   - a peer funder's invitation (peer-invites.ts), `?invite=<token>` on the "for funders" page;
//   - an applicant's package footer (for-funders.ts), `?ref=<token>` on the same page;
//   - an intermediary's co-branded onboarding link (partners.ts), `/join/<token>`.
// The person signs in and makes their workspace through the normal setup (`POST /gms/workspaces`),
// then the page they came from claims the new workspace for the link. A workspace is counted once,
// by the link's or the invitation's id: never with a tracking pixel, never with who joined beyond
// the count. Only a person claims, for a workspace they admin and made within the hour.
import { z } from "zod";
import { randomToken } from "../auth/crypto.ts";
import { ApiError } from "../lib/errors.ts";
import { sha256Hex } from "./ports.ts";
import { audit, authorize, changeStatus, type ServiceContext } from "./context.ts";
import { humanOnly } from "./awards.ts";
import type { Row } from "./repos/types.ts";
import { RepoError } from "./repos/types.ts";

type Link = Row<"referral_links">;

/** A new workspace is claimed for a link within this long of being made. One place to relax. */
export const REFERRAL_CLAIM_WINDOW_MS = 60 * 60 * 1000;

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
/** A link token: 20 characters of a-z and 0-9 (about 103 bits), as 0047 checks. */
export function linkToken(): string {
  const out: string[] = [];
  while (out.length < 20) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      // 252 = 7 × 36: drop the bytes that would make the first letters likelier.
      if (b < 252 && out.length < 20) out.push(ALPHABET[b % 36]!);
    }
  }
  return out.join("");
}
export const LINK_TOKEN = /^[a-z0-9]{20}$/;
/** An invitation token as it appears in the email's link. */
export const INVITE_TOKEN = /^gms_pi_[A-Za-z0-9_-]{43}$/;
export const inviteToken = (): string => randomToken("gms_pi_");
export const tokenHash = (token: string): Promise<string> => sha256Hex(new TextEncoder().encode(token));

/** The live link of a kind for a workspace, made on first use. Two requests at once end with one. */
export async function ensureLink(ctx: Pick<ServiceContext, "repos" | "actor">, workspaceId: string, kind: "package" | "onboarding"): Promise<Link> {
  const live = await ctx.repos.table("referral_links").one({ workspace_id: workspaceId, kind, revoked_at: null });
  if (live) return live;
  try {
    return await ctx.repos.table("referral_links").insert({ workspace_id: workspaceId, kind, token: linkToken(), created_by: ctx.actor.userId });
  } catch (e) {
    if (!(e instanceof RepoError && e.kind === "conflict")) throw e;
    const made = await ctx.repos.table("referral_links").one({ workspace_id: workspaceId, kind, revoked_at: null });
    if (made) return made;
    throw e;
  }
}

/** A live link by its token, or null (a revoked or unknown token reads as no link). */
export async function liveLink(ctx: Pick<ServiceContext, "repos">, token: string | null | undefined, kind: "package" | "onboarding"): Promise<Link | null> {
  if (!token || !LINK_TOKEN.test(token)) return null;
  const row = await ctx.repos.table("referral_links").one({ token, kind });
  return row && !row.revoked_at ? row : null;
}

export const claimInput = z
  .object({
    /** The workspace the person just made with the normal setup. */
    workspaceId: z.uuid(),
    source: z.enum(["invite", "package", "onboarding"]),
    token: z.string().trim().min(10).max(80),
  })
  .strict();

export interface ClaimResult {
  counted: boolean;
  /** Why it was not counted, for the page (it never blocks anything). */
  reason: "counted" | "already_counted" | "unknown_link" | "own_link";
}

/**
 * Count a new workspace for the link it came from. A person only; the workspace must be one they
 * admin, made within REFERRAL_CLAIM_WINDOW_MS, of the kind the link brings (funders, or for an
 * onboarding link also applicants), and not one of the link's own workspace. Counted once.
 */
export async function claimReferral(ctx: ServiceContext, input: z.output<typeof claimInput>): Promise<ClaimResult> {
  await authorize(ctx, {});
  if (ctx.actor.kind !== "user") throw humanOnly("Counting a new workspace for an invitation");
  const userId = ctx.actor.userId!;
  const ws = await ctx.repos.table("workspaces").one({ id: input.workspaceId });
  const member = ws ? await ctx.repos.table("workspace_members").one({ workspace_id: ws.id, user_id: userId }) : null;
  if (!ws || member?.role !== "admin" || Date.parse(ws.created_at) < ctx.now().getTime() - REFERRAL_CLAIM_WINDOW_MS) {
    throw new ApiError(422, "not_your_new_workspace", "Name the workspace you just set up");
  }
  const kind = ws.kind as "funder" | "applicant";
  if (await ctx.repos.table("referral_joins").one({ joined_workspace_id: ws.id })) return { counted: false, reason: "already_counted" };

  let source: { source: "peer_invitation" | "package" | "onboarding"; sourceWorkspaceId: string; invitation?: Row<"peer_invitations">; link?: Link } | null = null;
  if (input.source === "invite") {
    const inv = INVITE_TOKEN.test(input.token) ? await ctx.repos.table("peer_invitations").one({ token_hash: await tokenHash(input.token) }) : null;
    if (inv && inv.status !== "sending") source = { source: "peer_invitation", sourceWorkspaceId: inv.workspace_id, invitation: inv };
  } else {
    const link = await liveLink(ctx, input.token, input.source);
    if (link) source = { source: input.source, sourceWorkspaceId: link.workspace_id, link };
  }
  if (!source) return { counted: false, reason: "unknown_link" };
  if (source.source !== "onboarding" && kind !== "funder") throw new ApiError(422, "funders_only", "This link brings funders. Set up a funder workspace to be counted");
  // A member of the workspace that owns the link is not someone it brought in.
  if (source.sourceWorkspaceId === ws.id || (await ctx.repos.table("workspace_members").one({ workspace_id: source.sourceWorkspaceId, user_id: userId }))) return { counted: false, reason: "own_link" };

  try {
    await ctx.repos.table("referral_joins").insert({
      joined_workspace_id: ws.id,
      joined_kind: kind,
      joined_by: userId,
      source: source.source,
      source_workspace_id: source.sourceWorkspaceId,
      peer_invitation_id: source.invitation?.id ?? null,
      referral_link_id: source.link?.id ?? null,
    });
  } catch (e) {
    if (e instanceof RepoError && e.kind === "conflict") return { counted: false, reason: "already_counted" };
    throw e;
  }
  if (source.invitation) await recountInvitation(ctx, source.invitation);
  // Recorded where the operator's measures read it: the new workspace's ledger, naming the link by id only.
  await audit(ctx, "referral.joined", "workspace", ws.id, { source: source.source, joinedKind: kind, ...(source.invitation ? { peerInvitationId: source.invitation.id } : {}), ...(source.link ? { referralLinkId: source.link.id } : {}) }, ws.id);
  return { counted: true, reason: "counted" };
}

/**
 * An invitation's count is the number of joins that name it, read again each time (never added
 * to), and the first join moves it from sent to joined: guard → write → ledger.
 */
async function recountInvitation(ctx: ServiceContext, inv: Row<"peer_invitations">) {
  const count = await ctx.repos.table("referral_joins").count({ peer_invitation_id: inv.id });
  const at = ctx.now().toISOString();
  if (inv.status === "sent") {
    // The inviting workspace's ledger records the move; the person who joined is not named.
    const inviter = { ...ctx, workspace: { id: inv.workspace_id, kind: "funder" as const, role: null, memberScope: null } };
    await changeStatus(inviter, {
      event: "peer_invitation.joined",
      subjectType: "peer_invitation",
      subjectId: inv.id,
      current: inv.status,
      from: ["sent"],
      to: "joined",
      write: async () => {
        await ctx.repos.table("peer_invitations").update({ id: inv.id, status: "sent" }, { status: "joined", joined_count: Math.max(count, 1), first_joined_at: at });
      },
      data: { joinedCount: count },
    });
    return;
  }
  await ctx.repos.table("peer_invitations").update({ id: inv.id }, { joined_count: Math.max(count, inv.joined_count) });
}

/** How many workspaces joined from these invitations or links, by id. */
export async function joinCounts(ctx: Pick<ServiceContext, "repos">, by: { invitations?: readonly string[]; links?: readonly string[] }) {
  const out = new Map<string, number>();
  if (by.invitations?.length) for (const j of await ctx.repos.table("referral_joins").find({ peer_invitation_id: [...by.invitations] })) out.set(j.peer_invitation_id!, (out.get(j.peer_invitation_id!) ?? 0) + 1);
  if (by.links?.length) for (const j of await ctx.repos.table("referral_joins").find({ referral_link_id: [...by.links] })) out.set(j.referral_link_id!, (out.get(j.referral_link_id!) ?? 0) + 1);
  return out;
}
