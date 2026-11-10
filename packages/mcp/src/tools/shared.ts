// SPDX-License-Identifier: AGPL-3.0-only
// Schema fragments shared by the funder and applicant tool declarations.
import { z } from "zod";
import type { Scope } from "../scopes.ts";
import type { ToolSpec } from "../types.ts";

/** Declares one tool. `service` names the ServiceLayer method; keeping it a literal lets the
 * ServiceLayer interface be derived from the declarations, so the two can never drift. */
export function tool<S extends string, I extends z.ZodObject>(
  service: S,
  scope: Scope,
  description: string,
  input: I,
  options: { gated?: boolean } = {},
): ToolSpec<S, I> {
  return { service, scope, description, input, gated: options.gated ?? false };
}

/** API-visible id with its human prefix (`app_…`, `awd_…`). */
export const id = (prefix: string, what: string) =>
  z.string().regex(new RegExp(`^${prefix}_[0-9A-Za-z-]{6,64}$`), `Expected an id starting with ${prefix}_`).describe(what);

export const uuid = (what: string) => z.string().min(8).max(64).describe(what);

export const paging = {
  page: z.number().int().min(1).default(1).describe("1-based page number"),
  pageSize: z.number().int().min(1).max(100).default(100).describe("Items per page (max 100)"),
};

export const amountMinor = z.number().int().nonnegative().describe("Amount in minor units (cents)");
export const currency = z.string().regex(/^[A-Z]{3}$/).default("USD").describe("ISO 4217 currency code");
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Calendar date, YYYY-MM-DD");
export const isoDateTime = z.string().datetime({ offset: true }).describe("RFC 3339 timestamp");
export const jsonObject = z.record(z.string(), z.unknown());

export const applicationStatus = z.enum([
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
]);
export const awardStatus = z.enum(["offered", "accepted", "active", "suspended", "completed", "cancelled"]);
export const trancheStatus = z.enum(["scheduled", "due", "ready", "releasing", "initiated", "settled", "held", "failed", "returned", "cancelled"]);
export const requirementStatus = z.enum(["scheduled", "due", "overdue", "submitted", "under_review", "accepted", "returned", "waived"]);
export const verificationLevel = z.enum(["L0", "L1", "L2", "L3"]);
export const applicantType = z.enum(["organization", "individual"]);
export const amendmentType = z.enum(["extension", "reallocation", "scope", "supplemental"]);

export const opportunityId = id("opp", "Opportunity id");
export const competitionId = id("cmp", "Competition id");
export const formId = id("frm", "Form id");
export const applicationId = id("app", "Application id");
export const reviewAssignmentId = id("rev", "Review assignment id");
export const awardId = id("awd", "Award id");
export const agreementId = id("agr", "Agreement id");
export const trancheId = id("trn", "Tranche id");
export const requirementId = id("req", "Requirement id");
export const submissionId = id("sub", "Submission id");

export const fundingSchema = z
  .object({
    totalAmountAvailableMinor: amountMinor.optional(),
    minAwardAmountMinor: amountMinor.optional(),
    maxAwardAmountMinor: amountMinor.optional(),
    estimatedAwardCount: z.number().int().positive().optional(),
    currency,
  })
  .describe("Projected to CommonGrants OppFunding");

export const keyDatesSchema = z
  .object({ openDate: isoDate.optional(), closeDate: isoDate.optional(), decisionDate: isoDate.optional() })
  .describe("Projected to CommonGrants key dates");

/** Eligibility rule DSL (build spec §10.3). Validated in full by @gms/rules at save time. */
export const eligibilityRules = jsonObject.describe('Eligibility rule tree: { "all": [...] } or { "any": [...] } of { path, op, value }');
