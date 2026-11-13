// SPDX-License-Identifier: AGPL-3.0-only
// What a workspace role may open. The API decides access; this only keeps the app from offering
// someone a screen that will refuse them.

/** Roles whose whole job is reviewing: they work in the reviewer portal, not the funder workspace. */
const REVIEW_ONLY = new Set(["reviewer", "external_reviewer"]);

export const isReviewOnly = (role: string): boolean => REVIEW_ONLY.has(role);

/** Read-only roles in a funder workspace: they see the record, not the controls that change it. */
const READ_ONLY = new Set(["observer", "auditor"]);

/** Funder rail entries by label that a role is not shown. Admins and staff see everything. */
export function hiddenFunderRailItems(role: string): ReadonlySet<string> {
  if (isReviewOnly(role)) return new Set(["Programs", "Opportunities", "Awards", "Payments", "Reporting", "Grantees", "Analytics", "Communications", "Approvals", "Settings"]);
  if (READ_ONLY.has(role)) return new Set(["Communications", "Approvals", "Settings"]);
  return new Set();
}

/** Who may give an award directly (and resend or change the address): a funder admin or finance member. */
export const canGiveDirectAward = (role: string): boolean => role === "admin" || role === "finance";
