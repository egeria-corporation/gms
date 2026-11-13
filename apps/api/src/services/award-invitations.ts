// SPDX-License-Identifier: AGPL-3.0-only
// How a direct award's invitation is shown and recorded. The full address never leaves the
// invitation row: views and the ledger carry it masked (`j…@example.org`).
import type { Row } from "./repos/types.ts";

export type AwardInvitation = Row<"award_invitations">;
export type InvitationStatus = "sent" | "accepted" | "declined" | "expired" | "revoked";

/** `jo@example.org` → `j…@example.org`. Anything without an `@` is masked whole. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "…";
  return `${email.slice(0, 1)}…${email.slice(at)}`;
}

/** Ended first (accepted, declined, revoked), then by its date. */
export function invitationStatus(inv: Pick<AwardInvitation, "accepted_at" | "declined_at" | "revoked_at" | "expires_at">, now: Date): InvitationStatus {
  if (inv.accepted_at) return "accepted";
  if (inv.declined_at) return "declined";
  if (inv.revoked_at) return "revoked";
  return Date.parse(inv.expires_at) <= now.getTime() ? "expired" : "sent";
}

export const invitationView = (inv: AwardInvitation, now: Date) => ({ email: maskEmail(inv.email), status: invitationStatus(inv, now), sentAt: inv.last_sent_at, expiresAt: inv.expires_at });
export type InvitationView = ReturnType<typeof invitationView>;
