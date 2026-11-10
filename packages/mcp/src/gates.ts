// SPDX-License-Identifier: AGPL-3.0-only
// Human gates. A gated tool called by an agent returns `pending_approval` and runs only after a
// person approves it in the UI.

/** Gated unless the token carries an explicit `approvals:bypass` grant. */
export const DEFAULT_GATED_TOOLS = [
  "commit_decisions",
  "release_tranche",
  "submit_application",
  "sign_agreement",
  "accept_award",
  "send_communication",
  // Not in the spec's default list. Added because acceptance item 11 requires an agent's decline to
  // appear as pending approval, and a decline queues a letter to the applicant.
  "decline_application",
] as const;

/** Gated for every agent, whatever the token grants and whatever a workspace configures. This is
 * the stricter reading of the design note "Signing is a human gate: agents can prepare an
 * agreement, never sign one": money leaving, legal signature and offer acceptance always need a
 * person. */
export const NON_BYPASSABLE_TOOLS = ["sign_agreement", "accept_award", "release_tranche"] as const;

export interface GatePolicy {
  /** Extra tools a workspace (settings) or an API client (`gated_tools`) wants gated. Overrides can
   * only add gates; they never remove a default one. */
  additionalGatedTools?: readonly string[];
}

export function isNonBypassable(tool: string): boolean {
  return (NON_BYPASSABLE_TOOLS as readonly string[]).includes(tool);
}

export function isGated(tool: string, policy: GatePolicy = {}): boolean {
  return (DEFAULT_GATED_TOOLS as readonly string[]).includes(tool) || isNonBypassable(tool) || (policy.additionalGatedTools ?? []).includes(tool);
}

/** Whether this call must wait for a person. Humans in the UI (no client) are the approval. */
export function requiresApproval(tool: string, caller: { clientId: string | null; approvalsBypass: boolean }, policy: GatePolicy = {}): boolean {
  if (caller.clientId === null) return false;
  if (isNonBypassable(tool)) return true;
  if (!isGated(tool, policy)) return false;
  return !caller.approvalsBypass;
}
