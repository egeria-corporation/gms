// SPDX-License-Identifier: AGPL-3.0-only
// Giving an award directly: the funder names an organization and a contact address; the contact
// signs in with that address, chooses or sets up the organization's workspace and accepts.
// These types match the contract exactly. Until the generated schema carries them they are
// declared here, so moving to the generated types is one import change.
//
// A claim token is only ever sent in a request body, never in a path or a query string.
import type { AwardDetail, FunderHttpIo } from "./funder.ts";
import type { Verification } from "./types.ts";

export type InvitationStatus = "sent" | "accepted" | "declined" | "expired" | "revoked";

/** The invitation on a direct award, as the funder sees it. The address is masked: `j…@example.org`. */
export interface AwardInvitation {
  email: string;
  status: InvitationStatus;
  sentAt: string;
  expiresAt: string;
}

export interface DirectAwardInput {
  recipient: { organizationName: string; contactEmail: string };
  title: string;
  /** `value` is a decimal string such as "25000.00". */
  amount: { value: string; currency: "USD" };
  startDate?: string;
  endDate?: string;
  programId?: string;
  /** Plain text, shown in the invitation email. At most 2000 characters. */
  message?: string;
}

/** What the person who received the link sees before deciding. */
export type LookupStatus = "pending" | "accepted" | "declined" | "expired" | "revoked";

export interface InvitationLookup {
  status: LookupStatus;
  funder: { name: string; handle: string; verification: Verification };
  award: { title: string; amount: { value: string; currency: string }; startDate: string | null; endDate: string | null; message: string | null };
  organizationName: string;
  /** Masked: `j…@example.org`. */
  invitedEmail: string;
  emailMatches: boolean;
  /** Applicant workspaces where the signed-in person is an admin. */
  workspaces: { id: string; name: string; verification: Verification }[];
}

export interface AwardClaimResult {
  awardId: string;
  workspaceId: string;
}

/** The codes the API answers with, in `errors[].code` of a failed call. */
export type DirectAwardErrorCode =
  | "invitation_not_found"
  | "email_mismatch"
  | "not_workspace_admin"
  | "invitation_expired"
  | "invitation_used"
  | "too_many_invitations"
  | "second_step_required";

/** The first `code` an ApiError carries, if any. */
export function errorCode(error: unknown): string | null {
  const errors = (error as { errors?: unknown[] } | null)?.errors;
  if (!Array.isArray(errors)) return null;
  for (const e of errors) {
    const code = (e as { code?: unknown } | null)?.code;
    if (typeof code === "string") return code;
  }
  return null;
}

/** The invitation on an award view, if it is a direct award. Works on the list and the detail views. */
export function invitationOf(award: { recipient?: unknown }): AwardInvitation | null {
  const r = award.recipient as { invitation?: AwardInvitation | null } | null | undefined;
  return r?.invitation ?? null;
}

export interface DirectAwardsApi {
  // ---- funder ----
  /** Creates the award as offered and emails the contact. Needs the funder's admin or finance role. */
  createDirectAward(input: DirectAwardInput): Promise<DirectAwardView>;
  /** Sends a new link (the old one stops working). A new address replaces the old one. */
  resendInvitation(awardId: string, input?: { contactEmail?: string }): Promise<DirectAwardView>;

  // ---- grantee (signed in; the token always travels in the body) ----
  lookupAwardInvitation(token: string): Promise<InvitationLookup>;
  acceptAwardInvitation(input: { token: string; workspaceId: string }): Promise<AwardClaimResult>;
  declineAwardInvitation(input: { token: string; reason?: string }): Promise<{ declined: true }>;
}

/** The funder's award view, as the existing award views plus the invitation on the recipient. */
export type DirectAwardView = AwardDetail;

export function createHttpDirectAwardsApi(io: FunderHttpIo): DirectAwardsApi {
  const e = encodeURIComponent;
  async function call<T>(method: string, path: string, body: unknown): Promise<T> {
    const token = await io.token();
    const ws = io.workspaceId();
    const res = await (io.fetch ?? fetch)(`${io.baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(ws ? { "X-GMS-Workspace": ws } : {}) },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => ({}))) as { data?: unknown; message?: string; errors?: unknown[] };
    if (!res.ok) throw io.fail(res.status, j.message ?? `Request failed (${res.status})`, j.errors ?? []);
    return j.data as T;
  }
  return {
    createDirectAward: (input) => call("POST", "/gms/awards/direct", input),
    resendInvitation: (awardId, input = {}) => call("POST", `/gms/awards/${e(awardId)}/invitation/resend`, input),
    lookupAwardInvitation: (token) => call("POST", "/gms/award-invitations/lookup", { token }),
    acceptAwardInvitation: (input) => call("POST", "/gms/award-invitations/accept", input),
    declineAwardInvitation: (input) => call("POST", "/gms/award-invitations/decline", input),
  };
}
