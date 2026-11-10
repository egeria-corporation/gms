// SPDX-License-Identifier: AGPL-3.0-only
// The columns each projection reads, named as in the build spec §8. Declared locally so this
// package has no dependency on `@gms/db`; the generated row types are structurally assignable.
import type { Money } from "./money.ts";
import type { GmsApplicationStatus, GmsAwardStatus, GmsCompetitionStatus, GmsFormResponseStatus, GmsOpportunityStatus } from "./status.ts";

type Json = Record<string, unknown>;

/** The funder workspace that owns a record, as an organization reference. */
export interface FunderRow {
  /** `workspaces.passport_org_id`; a workspace without one cannot be referenced as a CG organization. */
  passport_org_id: string | null;
  handle: string;
  display_name: string;
  legal_name?: string | null;
  ein?: string | null;
}

export interface OpportunityRow {
  id: string;
  workspace_id: string;
  program_id?: string | null;
  slug: string;
  title: string;
  description: string;
  status: GmsOpportunityStatus;
  /** CommonGrants `OppFunding` */
  funding?: Json | null;
  /** CommonGrants `OppTimeline` */
  key_dates?: Json | null;
  /** `ApplicantTypeOptions` values */
  accepted_applicant_types?: string[] | null;
  /** Funder-declared custom fields, already in CommonGrants `CustomField` form */
  custom_fields?: Json | null;
  published_at?: string | null;
  created_at: string;
  updated_at: string;
}

/** One competition stage (build spec §10.4). */
export interface StageJson {
  key: string;
  label: string;
  /** form id → pinned version */
  forms: Record<string, number>;
  opens?: string | null;
  closes?: string | null;
  rubricId?: string | null;
  reviewers?: string | null;
  entryFrom: string[];
  requiresSubmission: boolean;
  decisionRequired: boolean;
}

export interface CompetitionRow {
  id: string;
  opportunity_id: string;
  title: string;
  description?: string | null;
  instructions?: string | null;
  status: GmsCompetitionStatus;
  /** CommonGrants `CompetitionTimeline` */
  key_dates?: Json | null;
  stages?: StageJson[] | null;
  /** form id → pinned version; used when the competition has no stages */
  forms?: Record<string, number> | null;
  validation?: Json | null;
  accepted_applicant_types?: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface FormRow {
  id: string;
  version: number;
  title: string;
  description?: string | null;
  instructions?: string | null;
  json_schema?: Json | null;
  ui_schema?: Json | null;
  mapping_from_cg?: Json | null;
  mapping_to_cg?: Json | null;
  field_meta?: Json | null;
  purpose?: string | null;
  published_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FormResponseRow {
  id: string;
  application_id: string;
  form_id: string;
  form_version: number;
  response?: Json | null;
  status: GmsFormResponseStatus;
  validation_errors?: unknown[] | null;
  /** field path → `passport` | `library` | `prior_submission` | `qbo` | `user` | `agent:<client>` */
  provenance?: Record<string, string> | null;
  locked_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApplicationRow {
  id: string;
  competition_id: string;
  opportunity_id: string;
  applicant_workspace_id?: string | null;
  title: string;
  stage?: string | null;
  status: GmsApplicationStatus;
  submitted_at?: string | null;
  verification_level_at_submit?: string | null;
  attestation_url?: string | null;
  /** `{ eligible, results }` from the rules engine */
  eligibility?: Json | null;
  requested_amount_minor?: number | null;
  currency?: string | null;
  created_at: string;
  updated_at: string;
}

/** `awards.funding`: requested and awarded come from the GMS; disbursed is the cached Passport value. */
export interface AwardFundingJson {
  details?: string;
  requestedAmount?: Money;
  awardedAmount?: Money;
  disbursedAmount?: Money;
}

export interface AwardRow {
  id: string;
  title: string;
  description?: string | null;
  status: GmsAwardStatus;
  funding?: AwardFundingJson | null;
  /** CommonGrants `AwdTimeline` */
  key_dates?: Json | null;
  /** CommonGrants `AwdRecipientIndividual`; set instead of a recipient organization */
  recipient_individual?: Json | null;
  parent_award_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrgRefInput {
  /** Passport organization id */
  id: string;
  name: string;
  ein?: string | null;
}
