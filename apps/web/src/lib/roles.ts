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
  if (isReviewOnly(role)) return new Set(["Programs", "Opportunities", "Awards", "Payments", "Reporting", "Grantees", "Analytics", "Communications", "Approvals", "Settings", "Panel & decisions"]);
  if (READ_ONLY.has(role)) return new Set(["Communications", "Approvals", "Settings"]);
  return new Set();
}

/** Who may give an award directly: it needs the awards:write scope, so admin and program officer. */
export const canGiveDirectAward = (role: string): boolean => role === "admin" || role === "program_officer";

/** Who may resend or redirect an invitation already given: the givers, and finance, which follows up on awards. */
export const canResendInvitation = (role: string): boolean => canGiveDirectAward(role) || role === "finance";

/** Who may cancel (withdraw) an award: cancel keeps its own roles, the same two as giving one. */
export const canCancelAward = (role: string): boolean => role === "admin" || role === "program_officer";

/**
 * What an applicant role may change. Mirrors `APPLICANT_ROLE_SCOPES` in the API: the screen hides
 * a control the role's scopes will refuse, and says who can do it.
 */
export function applicantAccess(role: string | null | undefined) {
  const admin = role === "admin" || role === "owner";
  const editor = role === "editor";
  const finance = role === "finance";
  const viewer = role === "viewer";
  const consultant = role === "consultant";
  return {
    /** workspace:admin, applications:submit, awards:write, agreements:write */
    admin,
    /** applications:write */
    applications: admin || editor || consultant,
    /** applications:submit */
    submit: admin,
    /** awards:write and agreements:write */
    awards: admin,
    /** requirements:write */
    reports: admin || editor || finance,
    /** messages:write */
    messages: admin || editor || finance,
    /** library:write */
    library: admin || editor,
    /** admin or editor: withdraw, email a package, calendar feed, vault writes, import */
    draft: admin || editor,
    /** discovery, which every applicant role has except a consultant */
    discovery: admin || editor || finance || viewer,
    /** requirements:read */
    readReports: admin || editor || finance || viewer,
  };
}
