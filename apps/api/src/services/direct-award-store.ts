// SPDX-License-Identifier: AGPL-3.0-only
// The two database steps of a direct award that must be atomic (contract: direct awards):
// counting an invitation email against the funder's rolling daily limit, and claiming an
// invitation (award, consent and invitation written in one transaction). In production both are
// Postgres functions (migration 0028) run with the service role; the repository versions keep the
// same rules for the in-memory tests and for one isolate.
import type { RpcLike } from "../lib/rate-limit.ts";
import type { Repos } from "./repos/types.ts";

const DAY_MS = 86_400_000;

/** Invitation emails per funder workspace over a rolling 24 hours. `claim` checks and counts in one step. */
export interface InvitationLimiter {
  /** Count one send; false (and nothing counted) when `limit` sends were made in the last 24 hours. */
  claim(workspaceId: string, limit: number, now: Date): Promise<boolean>;
  /** Give back the latest count, when the invitation it was for was not made. */
  release(workspaceId: string, now: Date): Promise<void>;
}

/** One isolate's counts. Check and count happen with no await between them, so they cannot interleave. */
export class MemoryInvitationLimiter implements InvitationLimiter {
  private readonly sends = new Map<string, number[]>();
  async claim(workspaceId: string, limit: number, now: Date): Promise<boolean> {
    const since = now.getTime() - DAY_MS;
    const recent = (this.sends.get(workspaceId) ?? []).filter((t) => t > since);
    if (recent.length >= limit) {
      this.sends.set(workspaceId, recent);
      return false;
    }
    recent.push(now.getTime());
    this.sends.set(workspaceId, recent);
    return true;
  }
  async release(workspaceId: string): Promise<void> {
    this.sends.get(workspaceId)?.pop();
  }
}

export class SupabaseInvitationLimiter implements InvitationLimiter {
  constructor(private readonly client: RpcLike) {}
  async claim(workspaceId: string, limit: number): Promise<boolean> {
    // The database's clock decides the window; the count and the insert happen under one lock.
    const { data, error } = await this.client.rpc("gms_claim_award_invitation_send", { p_workspace: workspaceId, p_limit: limit });
    if (error) throw new Error(`Counting award invitations failed: ${error.message}`);
    return data === true;
  }
  async release(workspaceId: string): Promise<void> {
    const { error } = await this.client.rpc("gms_release_award_invitation_send", { p_workspace: workspaceId });
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
