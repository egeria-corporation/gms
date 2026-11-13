// SPDX-License-Identifier: AGPL-3.0-only
// The two database steps of a direct award that must be atomic (contract: direct awards):
// counting an invitation email against the funder's rolling daily limit, and claiming an
// invitation (award, consent and invitation written in one transaction). In production both are
// Postgres functions (migration 0028) run with the service role; the repository versions keep the
// same rules for the in-memory tests and for one isolate.
import type { RpcLike } from "../lib/rate-limit.ts";
import type { Repos } from "./repos/types.ts";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Which send limit a refused send reached. */
export type SendLimitName = "workspace" | "sender" | "address" | "recipient" | "instance";

/** What one invitation email is counted against. */
export interface SendKey {
  /** The funder workspace sending it. */
  workspaceId: string;
  /** The signed-in person sending it, across all their workspaces. */
  senderId: string;
  /** `addressKey` of the request (an IPv4 address or an IPv6 /64); null when unknown. */
  addressKey: string | null;
  /** base64url SHA-256 of the invited address, trimmed and in lower case. */
  recipientDigest: string;
}

/** Most sends per key: per 24 hours, except `recipient`, per 7 days. */
export interface SendLimits {
  workspace: number;
  sender: number;
  address: number;
  recipient: number;
  instance: number;
}

export type SendClaim = { ok: true; sendId: string } | { ok: false; limit: SendLimitName };

/** Invitation emails over rolling windows. `claim` checks every limit and counts, all in one step. */
export interface InvitationLimiter {
  /** Count one send against every key, or (at any limit) against none. */
  claim(key: SendKey, limits: SendLimits, now: Date): Promise<SendClaim>;
  /** Give back a count whose invitation was not sent. */
  release(sendId: string, now: Date): Promise<void>;
}

/** One isolate's counts. Check and count happen with no await between them, so they cannot interleave. */
export class MemoryInvitationLimiter implements InvitationLimiter {
  private sends: (SendKey & { id: string; at: number })[] = [];
  async claim(key: SendKey, limits: SendLimits, now: Date): Promise<SendClaim> {
    const t = now.getTime();
    this.sends = this.sends.filter((s) => s.at > t - 8 * DAY_MS);
    const day = this.sends.filter((s) => s.at > t - DAY_MS);
    const n = (pick: (s: SendKey) => boolean, list = day) => list.filter(pick).length;
    if (n((s) => s.workspaceId === key.workspaceId) >= limits.workspace) return { ok: false, limit: "workspace" };
    if (n((s) => s.senderId === key.senderId) >= limits.sender) return { ok: false, limit: "sender" };
    if (key.addressKey && n((s) => s.addressKey === key.addressKey) >= limits.address) return { ok: false, limit: "address" };
    if (n((s) => s.recipientDigest === key.recipientDigest, this.sends.filter((s) => s.at > t - WEEK_MS)) >= limits.recipient) return { ok: false, limit: "recipient" };
    if (day.length >= limits.instance) return { ok: false, limit: "instance" };
    const id = crypto.randomUUID();
    this.sends.push({ ...key, id, at: t });
    return { ok: true, sendId: id };
  }
  async release(sendId: string): Promise<void> {
    this.sends = this.sends.filter((s) => s.id !== sendId);
  }
}

const sendArgs = (key: SendKey, limits: SendLimits) => ({
  p_workspace: key.workspaceId,
  p_sender: key.senderId,
  p_address: key.addressKey,
  p_recipient: key.recipientDigest,
  p_workspace_limit: limits.workspace,
  p_sender_limit: limits.sender,
  p_address_limit: limits.address,
  p_recipient_limit: limits.recipient,
  p_instance_limit: limits.instance,
});

const LIMIT_NAMES: readonly string[] = ["workspace", "sender", "address", "recipient", "instance"];
export function readSendClaim(data: unknown): SendClaim {
  const row = (data ?? {}) as { outcome?: unknown; sendId?: unknown };
  if (row.outcome === "ok" && typeof row.sendId === "string") return { ok: true, sendId: row.sendId };
  if (typeof row.outcome === "string" && LIMIT_NAMES.includes(row.outcome)) return { ok: false, limit: row.outcome as SendLimitName };
  throw new Error("Counting award invitations returned an unexpected answer");
}

export class SupabaseInvitationLimiter implements InvitationLimiter {
  constructor(private readonly client: RpcLike) {}
  async claim(key: SendKey, limits: SendLimits): Promise<SendClaim> {
    // The database's clock decides the windows; the counts and the insert happen under one lock.
    const { data, error } = await this.client.rpc("gms_claim_award_invitation_send", sendArgs(key, limits));
    if (error) throw new Error(`Counting award invitations failed: ${error.message}`);
    return readSendClaim(data);
  }
  async release(sendId: string): Promise<void> {
    const { error } = await this.client.rpc("gms_release_award_invitation_send", { p_send: sendId });
    if (error) throw new Error(`Releasing an award invitation count failed: ${error.message}`);
  }
}

export type ClaimOutcome = "claimed" | "not_found" | "used" | "revoked" | "expired" | "email_mismatch" | "not_workspace_admin" | "award_changed";

export interface ClaimInput {
  /** SHA-256 (base64url) of the token the person presented. */
  tokenHash: string;
  /** The applicant workspace the award goes to. */
  workspaceId: string;
  userId: string;
  /** The address of the person's session. The database also checks the account's own confirmed address. */
  email: string;
  /** The award's CommonGrants status after `accept_offer`. */
  cgStatus: string;
}

/**
 * Claim an invitation: re-check it, attach the award to the workspace, move it offered → accepted,
 * record the `award` consent unless a live consent exists, and mark the invitation accepted, all
 * or nothing. The API has checked everything before; this is the check that holds under races.
 */
export interface DirectAwardClaims {
  claim(input: ClaimInput, now: Date): Promise<{ outcome: ClaimOutcome; consentId: string | null }>;
}

export class SupabaseDirectAwardClaims implements DirectAwardClaims {
  constructor(private readonly client: RpcLike) {}
  async claim(input: ClaimInput): Promise<{ outcome: ClaimOutcome; consentId: string | null }> {
    const { data, error } = await this.client.rpc("gms_claim_direct_award", { p_token_hash: input.tokenHash, p_workspace: input.workspaceId, p_user: input.userId, p_email: input.email, p_cg_status: input.cgStatus });
    if (error) throw new Error(`Claiming the award failed: ${error.message}`);
    const row = (data ?? {}) as { outcome?: unknown; consentId?: unknown };
    const outcome = typeof row.outcome === "string" ? (row.outcome as ClaimOutcome) : "award_changed";
    return { outcome, consentId: typeof row.consentId === "string" ? row.consentId : null };
  }
}

const norm = (email: string) => email.trim().toLowerCase();

/** The same rules over the repositories, one claim at a time (tests, one isolate). */
export class RepoDirectAwardClaims implements DirectAwardClaims {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly repos: Repos) {}

  claim(input: ClaimInput, now: Date): Promise<{ outcome: ClaimOutcome; consentId: string | null }> {
    const run = this.queue.then(() => this.claimNow(input, now));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async claimNow(input: ClaimInput, now: Date): Promise<{ outcome: ClaimOutcome; consentId: string | null }> {
    const none = (outcome: ClaimOutcome) => ({ outcome, consentId: null });
    const inv = await this.repos.table("award_invitations").one({ token_hash: input.tokenHash });
    if (!inv) return none("not_found");
    if (inv.accepted_at || inv.declined_at) return none("used");
    if (inv.revoked_at) return none("revoked");
    if (Date.parse(inv.expires_at) <= now.getTime()) return none("expired");
    if (norm(input.email) !== inv.email) return none("email_mismatch");
    const member = await this.repos.table("workspace_members").one({ workspace_id: input.workspaceId, user_id: input.userId });
    const ws = member ? await this.repos.table("workspaces").one({ id: input.workspaceId }) : null;
    if (!member || member.role !== "admin" || ws?.kind !== "applicant" || ws.id === inv.workspace_id || (member.expires_at && Date.parse(member.expires_at) <= now.getTime())) return none("not_workspace_admin");
    const [award] = await this.repos.table("awards").update({ id: inv.award_id, workspace_id: inv.workspace_id, status: "offered", recipient_workspace_id: null }, { recipient_workspace_id: input.workspaceId, recipient_individual: null, status: "accepted", cg_status: input.cgStatus });
    if (!award) return none("award_changed");
    let consentId: string | null = null;
    if (!(await this.repos.table("consents").one({ applicant_workspace_id: input.workspaceId, funder_workspace_id: inv.workspace_id, revoked_at: null }))) {
      consentId = (await this.repos.table("consents").insert({ applicant_workspace_id: input.workspaceId, funder_workspace_id: inv.workspace_id, basis: "award", scopes: ["org:read"], granted_by: input.userId, granted_at: now.toISOString() })).id;
    }
    await this.repos.table("award_invitations").update({ id: inv.id }, { accepted_at: now.toISOString(), accepted_by: input.userId, accepted_workspace_id: input.workspaceId });
    return { outcome: "claimed", consentId };
  }
}
