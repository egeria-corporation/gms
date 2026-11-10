// SPDX-License-Identifier: AGPL-3.0-only
// Status vocabularies for every GMS state machine (build spec §10.1). These unions are the single
// source of truth: migrations, routes, the MCP tools and the web status badges all read from here.

export const APPLICATION_STATUSES = [
  "draft",
  "submitted",
  "screening",
  "under_review",
  "recommended",
  "accepted",
  "declined",
  "waitlisted",
  "revision_requested",
  "interview",
  "withdrawn",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const AWARD_STATUSES = ["offered", "accepted", "active", "suspended", "completed", "cancelled"] as const;
export type AwardStatus = (typeof AWARD_STATUSES)[number];

export const AGREEMENT_STATUSES = ["draft", "sent", "signed_by_grantee", "countersigned", "executed", "voided"] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

export const TRANCHE_STATUSES = [
  "scheduled",
  "due",
  "ready",
  "releasing",
  "initiated",
  "settled",
  "held",
  "failed",
  "returned",
  "cancelled",
] as const;
export type TrancheStatus = (typeof TRANCHE_STATUSES)[number];

export const REQUIREMENT_STATUSES = [
  "scheduled",
  "due",
  "overdue",
  "submitted",
  "under_review",
  "accepted",
  "returned",
  "waived",
] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export const SUBMISSION_STATUSES = ["draft", "submitted", "under_review", "accepted", "returned"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const VERIFICATION_LEVELS = ["L0", "L1", "L2", "L3"] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];
