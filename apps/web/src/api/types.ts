// SPDX-License-Identifier: AGPL-3.0-only
// Shapes of the `/gms` and `/gms/public` routes the web app reads and writes.
//
// These mirror what the Worker answers (apps/api/src/services/*), and test/contract.test.ts holds
// every one of them to the real Worker in-process and to the mock, so neither can drift.
//
// Most are typed here, not taken from the generated schema (`schema.d.ts`), because the TypeSpec
// models for these routes do not yet describe what the Worker returns. Known differences, spec vs
// Worker: Program (`budget` Money / `fiscalYear` string vs `budgetAmountMinor` / number),
// GmsOpportunity, GmsCompetition and GmsForm (a nested `cg` record vs flat fields), Readiness
// (`passed`/`failed`/`lines`/`fixUrl` vs `summary`/`items`/`fixHref`), PassportLinkStatus
// (`canSendFunds` vs `check` + `canDebit`), Invitation (no `id`/`acceptUrl`), EligibilityRequest (no
// `rules`/`org`/`profile`), the member list (paginated `items` vs `data`), FunderPage and
// OpportunityPage (untyped objects), and nullability (`null` vs omitted). Where the spec is exact
// (`Me`, `MyWorkspace`, and the enums below) the generated types are used.
import type { FormSchema, MappingSchema, UiElement, FieldMeta, JsonObject } from "@gms/forms";
import type { Evaluation, Rule } from "@gms/rules";
import type { components } from "./schema.d.ts";

export type { Evaluation, Rule };

export interface Money {
  amount: string;
  currency: string;
}

/** CommonGrants `Event` (single date, date range or other), as stored on opportunities and competitions. */
export interface CgEvent {
  name: string;
  eventType: "singleDate" | "dateRange" | "other";
  date?: string;
  time?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  details?: string;
}

/** CommonGrants `OppFunding`. */
export interface OppFunding {
  details?: string;
  totalAmountAvailable?: Money;
  minAwardAmount?: Money;
  maxAwardAmount?: Money;
  minAwardCount?: number;
  maxAwardCount?: number;
  estimatedAwardCount?: number;
}

/** CommonGrants `OppTimeline`. */
export interface OppTimeline {
  postDate?: CgEvent;
  closeDate?: CgEvent;
  otherDates?: Record<string, CgEvent>;
}

export type OpportunityStatus = "forecasted" | "open" | "closed";
export type CompetitionStatus = "draft" | "open" | "closed";

export interface Brand {
  logoUrl?: string | null;
  accent?: string | null;
  onAccent?: string | null;
  fontPreference?: string | null;
}

export interface WorkspaceRecord {
  id: string;
  kind: "funder" | "applicant";
  handle: string;
  displayName: string;
  legalName: string | null;
  passportOrgId: string | null;
  verificationLevel: string | null;
  profileSource: Verification["source"];
  verification: Verification;
  /** The self-declared profile; null for a Passport workspace and for one with no profile. */
  profile: SelfDeclaredProfile | null;
  brand: Brand;
  settings: Record<string, unknown>;
  status: string;
}

export interface CreateWorkspaceInput {
  kind: "funder" | "applicant";
  handle: string;
  displayName: string;
  legalName?: string;
  brand?: Brand;
  /** A workspace set up without Passport: the organization's own, unverified description of itself. */
  profile?: SelfDeclaredProfile;
}

/** Where an organization's details come from, and how far they are verified. */
export type Verification = components["schemas"]["Models.Verification"];
/** An organization's description of itself, entered in the GMS. Never shown as verified. */
export type SelfDeclaredProfile = components["schemas"]["Models.SelfDeclaredProfile"];
export type SelfDeclaredProfilePatch = components["schemas"]["Models.SelfDeclaredProfilePatch"];
export type WorkspaceProfile = components["schemas"]["Models.WorkspaceProfile"];

export interface WorkspaceWrite {
  workspace: WorkspaceRecord;
  /** E.g. the accent failed the contrast check and the system accent is used instead. */
  warnings: string[];
}

export interface Member {
  userId: string;
  role: string;
  email?: string | null;
  expiresAt?: string | null;
  mfaEnrolledAt?: string | null;
}

export interface InvitationInput {
  email: string;
  role: string;
  expiresInDays?: number;
}
export interface Invitation {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  acceptUrl: string;
}

export type CheckState = components["schemas"]["Models.TriState"];

export interface PassportStatus {
  linked: boolean;
  passportOrgId?: string | null;
  clientId?: string | null;
  scopes?: string[];
  linkedAt?: string | null;
  lastOkAt?: string | null;
  check: { state: CheckState; reason: string };
  canDebit: boolean | null;
}

export interface Program {
  id: string;
  name: string;
  description: string | null;
  fiscalYear: number | null;
  budgetAmountMinor: number | null;
  currency: string;
  defaults: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
export type ProgramInput = Partial<Pick<Program, "description" | "fiscalYear" | "budgetAmountMinor" | "currency" | "defaults">> & { name: string };

export interface RubricCriterion {
  key: string;
  label: string;
  description?: string;
  weight: number;
  scale: { type: "numeric"; min: number; max: number } | { type: "categorical"; options: { value: string; label?: string; score: number }[] };
  guidance?: string;
}
export interface Rubric {
  id: string;
  version: number;
  name: string;
  criteria: RubricCriterion[];
  overall: { recommendations?: string[]; spreadThreshold?: number };
  shared: boolean;
}
export type RubricInput = Pick<Rubric, "name" | "criteria"> & { overall?: Rubric["overall"] };

export type PublishFlags = components["schemas"]["Models.PublishSettings"];

export interface Opportunity {
  id: string;
  programId: string | null;
  slug: string;
  title: string;
  description: string;
  status: OpportunityStatus;
  funding: OppFunding;
  keyDates: OppTimeline;
  acceptedApplicantTypes: string[];
  /** An empty `{ all: [] }` when the opportunity has no rules. */
  eligibilityRules: Rule;
  publish: PublishFlags;
  customFields: Record<string, unknown>;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export type OpportunityInput = Partial<
  Pick<Opportunity, "slug" | "description" | "programId" | "funding" | "keyDates" | "acceptedApplicantTypes" | "eligibilityRules" | "publish" | "customFields">
> & { title: string };

export interface OpportunityPreview {
  commonGrants: unknown;
  publicUrl: string;
  brand: Brand;
  publish: PublishFlags;
}

export interface Stage {
  key: string;
  label: string;
  /** form id → pinned published version. */
  forms: Record<string, number>;
  opens?: string | null;
  closes?: string | null;
  rubricId?: string | null;
  reviewers?: string | null;
  entryFrom: string[];
  requiresSubmission: boolean;
  decisionRequired: boolean;
}

export interface Competition {
  id: string;
  opportunityId: string;
  title: string;
  description: string | null;
  instructions: string | null;
  status: CompetitionStatus;
  keyDates: Record<string, unknown>;
  stages: Stage[];
  forms: Record<string, number>;
  acceptedApplicantTypes: string[];
  createdAt: string;
  updatedAt: string;
}
export interface CompetitionInput {
  opportunityId: string;
  title: string;
  description?: string | null;
  instructions?: string | null;
}

export interface ChecklistItem {
  key: string;
  state: CheckState;
  label: string;
  reason: string;
  fixHref: string | null;
}
export interface Checklist {
  ready: boolean;
  summary: { pass: number; fail: number; unknown: number };
  items: ChecklistItem[];
}

export type FormPurpose = components["schemas"]["Models.FormPurpose"];

export interface FormSummary {
  id: string;
  version: number;
  title: string;
  description: string | null;
  instructions: string | null;
  purpose: FormPurpose;
  status: "draft" | "published";
  publishedAt: string | null;
  supersedesFormVersion: number | null;
  shared: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface FormRecord extends FormSummary {
  jsonSchema: FormSchema;
  uiSchema: UiElement;
  mappingFromCommonGrants: MappingSchema;
  mappingToCommonGrants: MappingSchema;
  fieldMeta: Record<string, FieldMeta>;
}
export interface FormInput {
  title: string;
  description?: string | null;
  instructions?: string | null;
  purpose?: FormPurpose;
  jsonSchema?: FormSchema;
  uiSchema?: UiElement;
  mappingFromCommonGrants?: MappingSchema;
  mappingToCommonGrants?: MappingSchema;
  fieldMeta?: Record<string, FieldMeta>;
  copyFrom?: { id: string; version?: number };
}
export type FormPatch = Partial<Omit<FormInput, "copyFrom">>;

export interface EvaluateInput {
  rules?: Rule;
  opportunityId?: string;
  org?: JsonObject;
  profile?: JsonObject;
  applicant?: { type?: string };
}

// ---- public pages (`/gms/public/funders/...`) ----
export interface PublicFunder {
  handle: string;
  name: string;
  brand: { logoUrl: string | null; accent: string | null; onAccent: string | null };
  mission: string | null;
  website: string | null;
  verificationLevel: string | null;
  verification: Verification;
}
export interface PublicOpportunityCard {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: OpportunityStatus;
  funding: OppFunding;
  keyDates: OppTimeline;
  acceptedApplicantTypes: string[];
}
export interface FunderPageData {
  funder: PublicFunder;
  opportunities: PublicOpportunityCard[];
}
export interface PublicStage {
  key: string;
  label: string;
  opens: string | null;
  closes: string | null;
  requiresSubmission: boolean;
}
export interface PublicCompetition {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  status: CompetitionStatus;
  keyDates: Record<string, unknown>;
  stages: PublicStage[];
}
export interface OpportunityPageData {
  funder: PublicFunder;
  opportunity: PublicOpportunityCard & { publishedAt: string | null; eligibility: string[] };
  competitions: PublicCompetition[];
  commonGrants: unknown;
  links: { json: string; page: string };
}

/** CommonGrants `FormBase`, as `/common-grants/competitions/{id}` embeds it. */
export interface CgForm {
  id: string;
  title: string;
  description?: string;
  version?: string;
  instructions?: string;
  jsonSchema: FormSchema;
  uiSchema: UiElement;
}
export interface CgCompetition {
  id: string;
  title: string;
  forms: { forms: Record<string, CgForm> };
}

/** A field-level problem the API reports with a 422 (`errors[]` of the CommonGrants error shape). */
export interface FieldProblem {
  path?: string;
  field?: string;
  message: string;
}
