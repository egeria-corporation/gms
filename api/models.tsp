import "@typespec/http";
import "@typespec/json-schema";
import "@common-grants/core";

using TypeSpec.Http;
using TypeSpec.JsonSchema;
using CommonGrants.Models;
using CommonGrants.Fields;

/** GMS data models.
 *
 * Rules (CLAUDE.md):
 * - CommonGrants models are used as-is on `/common-grants/` routes and extended only through
 *   `customFields`. `AwardBase` has no `customFields` and is never given one.
 * - No bank credentials or personal identity data appear anywhere in this namespace. Payment
 *   models expose Passport ids, `bankName` and `last4` only.
 * - Money is a CommonGrants `Money` object (decimal string amount + ISO currency).
 */
@jsonSchema
namespace GMS.Models;

// #########################################################
// Scalars and shared enums
// #########################################################

/** A human-prefixed GMS identifier: a UUIDv7 behind a type prefix, e.g. `app_0192f0c1-…`. */
@pattern("^(opp|cmp|frm|app|rev|awd|agr|trn|req|sub)_[0-9a-f-]{36}$")
@example("awd_0192f0c1-7a3e-7b2c-9a41-5d2f6c1e8b90")
scalar PrefixedId extends string;

/** Either a bare UUID or the human-prefixed form of one. */
scalar GmsId extends string;

/** Last four digits of the payout destination, from the PayeeCredential, for display only. */
@pattern("^[0-9]{4}$")
@example("4821")
scalar Last4 extends string;

/** A SHA-256 digest, lower-case hex. */
@pattern("^[0-9a-f]{64}$")
scalar Sha256 extends string;

/** Passport assurance level. */
union VerificationLevel {
  L0: "L0",
  L1: "L1",
  L2: "L2",
  L3: "L3",
}

union WorkspaceKind {
  funder: "funder",
  applicant: "applicant",
}

/** Funder roles: admin, program_officer, finance, reviewer, external_reviewer, observer, auditor.
 * Applicant roles: admin, editor, finance, viewer, consultant.
 */
union MemberRole {
  admin: "admin",
  programOfficer: "program_officer",
  finance: "finance",
  reviewer: "reviewer",
  externalReviewer: "external_reviewer",
  observer: "observer",
  auditor: "auditor",
  editor: "editor",
  viewer: "viewer",
  consultant: "consultant",
}

/** GMS application status (build spec §10.1). Projected to CommonGrants `AppStatusOptions` with
 * `custom` + `customValue` where the protocol has no equivalent.
 */
union ApplicationStatus {
  draft: "draft",
  submitted: "submitted",
  screening: "screening",
  underReview: "under_review",
  recommended: "recommended",
  accepted: "accepted",
  declined: "declined",
  waitlisted: "waitlisted",
  revisionRequested: "revision_requested",
  interview: "interview",
  withdrawn: "withdrawn",
}

union AwardStatus {
  offered: "offered",
  accepted: "accepted",
  active: "active",
  suspended: "suspended",
  completed: "completed",
  cancelled: "cancelled",
}

union AgreementStatus {
  draft: "draft",
  sent: "sent",
  signedByGrantee: "signed_by_grantee",
  countersigned: "countersigned",
  executed: "executed",
  voided: "voided",
}

union TrancheStatus {
  scheduled: "scheduled",
  due: "due",
  ready: "ready",
  releasing: "releasing",
  initiated: "initiated",
  settled: "settled",
  held: "held",
  failed: "failed",
  returned: "returned",
  cancelled: "cancelled",
}

union RequirementStatus {
  scheduled: "scheduled",
  due: "due",
  overdue: "overdue",
  submitted: "submitted",
  underReview: "under_review",
  accepted: "accepted",
  returned: "returned",
  waived: "waived",
}

union SubmissionStatus {
  draft: "draft",
  submitted: "submitted",
  underReview: "under_review",
  accepted: "accepted",
  returned: "returned",
}

union DecisionOutcome {
  approve: "approve",
  decline: "decline",
  waitlist: "waitlist",
  defer: "defer",
}

union PaymentMode {
  facilitated: "facilitated",
  resolve: "resolve",
}

union TriState {
  pass: "pass",
  fail: "fail",
  `unknown`: "unknown",
}

/** Timestamps carried by every GMS record. */
model Timestamps {
  createdAt: utcDateTime;
  updatedAt: utcDateTime;
}

/** Pagination query parameters for GMS list routes (page size capped at 100). */
model PageParams {
  /** The page to return */
  @query
  @minValue(1)
  page?: int32 = 1;

  /** The number of items to return per page */
  @query
  @minValue(1)
  @maxValue(100)
  pageSize?: int32 = 100;
}

/** A JSON merge patch (RFC 7396) over the writable fields of the addressed record. */
model MergePatch is Record<unknown>;

/** A free-text reason recorded in the ledger. */
model ReasonBody {
  reason: string;
}

// #########################################################
// Workspaces, members, Passport link
// #########################################################

/** Tenant brand applied to public pages, letters, agreements and emails. */
model Brand {
  logoUrl?: url;

  /** Accent color, hex. Checked for WCAG AA contrast against `onAccent` at save. */
  @pattern("^#[0-9A-Fa-f]{6}$")
  accent?: string;

  @pattern("^#[0-9A-Fa-f]{6}$")
  onAccent?: string;

  fontPreference?: string;
}

model Workspace {
  id: CommonGrants.Types.uuid;
  kind: WorkspaceKind;

  /** The linked Passport organization; null for individual applicants. */
  passportOrgId: CommonGrants.Types.uuid | null;

  handle: string;
  displayName: string;
  legalName?: string;
  brand?: Brand;
  settings?: Record<unknown>;
  verificationLevel?: VerificationLevel;
  status: string;
  ...Timestamps;
}

model WorkspaceInput {
  kind: WorkspaceKind;
  handle: string;
  displayName: string;
  passportOrgId?: CommonGrants.Types.uuid;
  brand?: Brand;
}

/** A member of a workspace. `email` and `name` come from the person's account; an invited member
 * shows the invited address until they have signed in.
 */
model Member {
  userId: CommonGrants.Types.uuid;
  email: string | null;
  name: string | null;
  role: MemberRole;

  /** Restrictions for consultants and external reviewers: application, award or competition ids. */
  scope: Record<unknown>;

  expiresAt: utcDateTime | null;
  mfaEnrolledAt: utcDateTime | null;

  /** TOTP MFA is required for this role */
  requiresMfa: boolean;

  invitedBy: CommonGrants.Types.uuid | null;
  createdAt: utcDateTime;
}

model MemberInput {
  userId: CommonGrants.Types.uuid;
  role: MemberRole;
  scope?: Record<unknown>;
  expiresAt?: utcDateTime;
}

/** A created invitation. The token is returned once, inside `acceptUrl`; only its hash is stored. */
model Invitation {
  id: CommonGrants.Types.uuid;
  email: string;
  role: MemberRole;
  expiresAt: utcDateTime;
  token: string;
  acceptUrl: url;
}

model InvitationInput {
  email: string;
  role: MemberRole;

  /** Restrictions for consultants and external reviewers */
  scope?: Record<unknown>;

  expiresInDays?: int32 = 14;
}

/** A Passport OAuth client created in Passport's funder console. The secret is stored encrypted
 * and never returned.
 */
model PassportLinkRequest {
  clientId: string;
  clientSecret: string;
}

/** The funder's Passport client link and a live check of it. */
model PassportLinkStatus {
  linked: boolean;
  passportOrgId: CommonGrants.Types.uuid | null;
  mode?: "funder_client" | "applicant_consent";
  clientId?: string | null;
  scopes?: string[];
  linkedAt?: utcDateTime | null;
  lastOkAt?: utcDateTime | null;

  /** `unknown` when Passport cannot be reached; never collapsed into pass or fail */
  check: {
    state: TriState;
    reason: string;
  };

  /** Whether Passport reports a funding source the funder can pay from; null when unknown */
  canDebit: boolean | null;
}

// #########################################################
// Programs, opportunities, competitions, forms
// #########################################################

model Program {
  id: CommonGrants.Types.uuid;
  name: string;
  description: string | null;
  fiscalYear: int32 | null;

  /** Integer minor units of `currency`; null when the program has no budget set */
  budgetAmountMinor: int64 | null;

  currency: string;

  /** Award period, agreement template, payment schedule, requirements and reminder plan applied to new awards */
  defaults: Record<unknown>;

  createdAt: utcDateTime;
  updatedAt: utcDateTime;
}

model ProgramInput {
  name: string;
  description?: string | null;
  fiscalYear?: int32 | null;
  budgetAmountMinor?: int64 | null;
  currency?: string;
  defaults?: Record<unknown>;
}

/** One eligibility rule or a nested group (build spec §10.3). */
model EligibilityRule {
  path?: string;
  `op`?: "eq" | "neq" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "exists" | "matches";
  value?: unknown;
  order?: string[];
  missing?: "unknown" | "fail" | "pass";
  label?: string;
  explain?: string;
  all?: EligibilityRule[];
  any?: EligibilityRule[];
}

model PublishSettings {
  publicPage?: boolean;
  openGrantsIndex?: boolean;
  sitemap?: boolean;
}

/** An opportunity as the `/gms` routes return it. The CommonGrants projection is served at
 * `/common-grants/opportunities/{oppId}`.
 */
model GmsOpportunity {
  id: PrefixedId;
  programId: CommonGrants.Types.uuid | null;
  slug: string;
  title: string;
  description: string;
  status: "forecasted" | "open" | "closed";

  /** CommonGrants `OppFunding` */
  funding: Record<unknown>;

  /** CommonGrants `OppTimeline` */
  keyDates: Record<unknown>;

  acceptedApplicantTypes: string[];

  /** `{ all: [] }` when the opportunity has no rules */
  eligibilityRules: EligibilityRule;

  publish: PublishSettings;
  customFields: Record<unknown>;
  published: boolean;
  publishedAt: utcDateTime | null;
  createdAt: utcDateTime;
  updatedAt: utcDateTime;
}

/** `POST /gms/opportunities/{id}/preview`: what publishing would serve. */
model OpportunityPreview {
  commonGrants: OpportunityDetails;
  publicUrl: url;
  brand: Record<unknown>;
  publish: PublishSettings;
}

model GmsOpportunityInput {
  programId?: CommonGrants.Types.uuid;
  slug?: string;
  title: string;
  description: string;
  funding?: Record<unknown>;
  keyDates?: Record<unknown>;
  acceptedApplicantTypes?: string[];
  eligibilityRules?: EligibilityRule;
  publish?: PublishSettings;
  customFields?: Record<unknown>;
}

model Stage {
  key: string;
  label: string;

  /** Form id → pinned published version */
  forms: Record<int32>;

  opens?: utcDateTime | null;
  closes?: utcDateTime | null;
  rubricId?: CommonGrants.Types.uuid | null;
  reviewers?: string | null;
  entryFrom?: string[];
  requiresSubmission?: boolean;
  decisionRequired?: boolean;

  /** `blind` (default), `see_after_submit` or `open` */
  reviewMode?: "blind" | "see_after_submit" | "open";

  /** Once true, reviewers of this stage can see each other's submitted reviews */
  panelOpen?: boolean;
}

model GmsCompetition {
  id: PrefixedId;
  opportunityId: PrefixedId;
  title: string;
  description: string | null;
  instructions: string | null;
  status: "draft" | "open" | "closed";
  keyDates: Record<unknown>;
  stages: Stage[];

  /** The union of the stages' forms: form id → pinned version */
  forms: Record<int32>;

  validation: Record<unknown>;
  acceptedApplicantTypes: string[];
  createdAt: utcDateTime;
  updatedAt: utcDateTime;
}

model GmsCompetitionInput {
  opportunityId: GmsId;
  title: string;
  description?: string | null;
  instructions?: string | null;
  keyDates?: Record<unknown>;
  acceptedApplicantTypes?: string[];
}

/** `PUT /gms/competitions/{id}/stages`. Allowed only while the competition is a draft. */
model StagesInput {
  stages: Stage[];
}

model StageForms {
  /** Stage key → (form id → version) */
  stages: Record<Record<int32>>;

  /** Re-validate in-progress responses against the new pinned versions. */
  migrate?: boolean;
}

model RubricRef {
  /** The stage the rubric applies to; every decision stage when omitted */
  stage?: string;

  rubricId: CommonGrants.Types.uuid | null;
}

/** One line of a readiness checklist: state, label, reason and a link to the screen that fixes it. */
model ReadinessLine {
  key: string;
  state: TriState;
  label: string;
  reason: string;
  fixHref: string | null;
}

/** A readiness checklist (launch a competition, release a tranche, submit an application). The
 * primary action is disabled while any line fails or is unknown.
 */
model Readiness {
  ready: boolean;
  summary: {
    pass: int32;
    fail: int32;
    `unknown`: int32;
  };
  items: ReadinessLine[];
}

union FormPurpose {
  application: "application",
  report: "report",
  loi: "loi",
  amendment: "amendment",
  siteVisit: "site_visit",
  other: "other",
}

/** A form version as the `/gms` routes return it. Lists omit the schema, UI schema, mappings and
 * field metadata. The CommonGrants `FormBase` is served at `/common-grants/forms/{formId}`.
 */
model GmsForm {
  id: PrefixedId;
  version: int32;
  title: string;
  description: string | null;
  instructions: string | null;
  purpose: FormPurpose;
  status: "draft" | "published";
  publishedAt: utcDateTime | null;
  supersedesFormVersion: int32 | null;

  /** True for a form of the shared library */
  shared: boolean;

  createdAt: utcDateTime;
  updatedAt: utcDateTime;

  /** JSON Schema 2020-12 subset */
  jsonSchema?: Record<unknown>;

  uiSchema?: Record<unknown>;
  mappingFromCommonGrants?: Record<unknown>;
  mappingToCommonGrants?: Record<unknown>;

  /** Per-field reviewer visibility, PII flags and limits */
  fieldMeta?: Record<unknown>;
}

model GmsFormInput {
  title: string;
  description?: string | null;
  instructions?: string | null;
  purpose?: FormPurpose;
  jsonSchema?: Record<unknown>;
  uiSchema?: Record<unknown>;
  mappingFromCommonGrants?: Record<unknown>;
  mappingToCommonGrants?: Record<unknown>;
  fieldMeta?: Record<unknown>;

  /** Start from an existing form (e.g. one from the shared library) */
  copyFrom?: {
    id: GmsId;
    version?: int32;
  };
}

/** Dry-run rules. Send `rules` or an `opportunityId` (its stored rules are used). Facts come from
 * `org` / `profile` / `form` in the request, or from the cached Passport record of
 * `applicantWorkspaceId` when that organization has consented.
 */
model EligibilityRequest {
  rules?: EligibilityRule;
  opportunityId?: GmsId;
  applicantWorkspaceId?: CommonGrants.Types.uuid;

  /** A CommonGrants `OrganizationBase` */
  org?: Record<unknown>;

  /** Passport Common App profile fields, as the `profile.*` paths read them */
  profile?: Record<unknown>;

  /** Form id → response */
  form?: Record<Record<unknown>>;

  applicant?: {
    type?: string;
  };
}

model EligibilityRuleResult {
  /** The leaf rule that was evaluated: `{ path, op, value, ... }` */
  rule: Record<unknown>;

  /** The rule's plain-language label */
  label: string;

  outcome: TriState;
  actual?: unknown;
  explain: string;
}

model EligibilityResult {
  /** `unknown` never auto-declines; it flags the application for a person. */
  eligible: boolean | "unknown";

  results: EligibilityRuleResult[];
}

// #########################################################
// Applications, reviews, decisions
// #########################################################

/** An application in the funder's inbox. The detail route adds the optional fields. */
model GmsApplication {
  id: PrefixedId;
  title: string;
  competitionId: PrefixedId;
  opportunityId: PrefixedId;
  stage: string;
  status: ApplicationStatus;

  /** The outcome of the eligibility rules at the last evaluation; `unknown` flags it for a person. */
  eligibility: boolean | "unknown" | null;

  requestedAmountMinor: int64 | null;
  currency: string;
  tags: string[];
  assignedToUserId: CommonGrants.Types.uuid | null;
  submittedAt: utcDateTime | null;
  verificationLevelAtSubmit: VerificationLevel | null;
  applicant: {
    workspaceId: CommonGrants.Types.uuid;
    name: string | null;
    handle: string | null;

    /** The applicant's current Passport level; null once their consent is revoked. */
    level: VerificationLevel | null;
  };
  updatedAt: utcDateTime;

  /** Detail only. */
  attestationUrl?: url | null;

  /** Detail only: the rule-by-rule results. */
  eligibilityResults?: EligibilityResult | null;

  decisionId?: CommonGrants.Types.uuid | null;

  /** Detail only: the cached Passport record, while the applicant's consent stands. Null for external reviewers. */
  organization?: {
    `projection`: OrganizationBase;
    level: VerificationLevel | null;
    verifiedAt: utcDateTime | null;
    syncedAt: utcDateTime | null;
    levelChangedSinceSubmit: boolean;
  } | null;

  /** Detail only. Reviewers get reviewer-visible fields; external reviewers also lose PII. */
  formResponses?: InboxFormResponse[];

  timeline?: ApplicationEvent[];
}

model InboxFormResponse {
  formId: PrefixedId;
  formVersion: int32;
  formTitle: string | null;
  stage: string | null;
  status: "notStarted" | "inProgress" | "complete";
  response: Record<unknown>;

  /** JSON pointer → `passport` | `library` | `prior_submission` | `qbo` | `user` | `agent:<client>` */
  provenance: Record<string>;

  /** Section key → the applicant teammate who owns it. Empty for reviewers. */
  sectionAssignments?: Record<string>;

  validationErrors: unknown[];
  lockedAt: utcDateTime | null;

  /** Paths hidden or masked for this viewer. */
  masked: string[];
}

model ApplicationEvent {
  id: CommonGrants.Types.uuid;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  fromStage: string | null;
  toStage: string | null;
  payload?: Record<unknown>;
  actor?: string;
  at: utcDateTime;

  /** The revision request's message, on the applicant's status view. */
  message?: string | null;

  /** On a resubmission after a revision request: what the applicant changed. Null on every other event. */
  revision?: RevisionDiff | null;
}

/** Field by field, what changed between the funder's revision request and the applicant's resubmission. */
model RevisionDiff {
  requestedAt: utcDateTime;
  message: string | null;
  changes: RevisionChange[];
}

model RevisionChange {
  formId: PrefixedId;

  /** JSON pointer of the field */
  path: string;

  /** The value before and after, as text (non-text values as JSON). Null when the field was empty. */
  before: string | null;

  after: string | null;
  wordsBefore: int32;
  wordsAfter: int32;
  wordDelta: int32;
}

/** Who owns which section of one form of an application. */
model FormSectionAssignments {
  formId: PrefixedId;
  stage: string | null;

  /** Section key → user id */
  sections: Record<CommonGrants.Types.uuid>;
}

model InsertAnswerInput {
  answerId: CommonGrants.Types.uuid;

  /** JSON pointer of the field that receives the answer's text */
  path: string;
}

model InsertAnswerResult {
  /** The CommonGrants form response after the insert */
  formResponse: Record<unknown>;

  path: string;
  provenance: "library";

  /** False when the field already held this text */
  changed: boolean;

  /** The answer, with this use recorded in `usedIn` */
  answer: Answer;
}

model AnswerUse {
  applicationId: CommonGrants.Types.uuid;
  formId: CommonGrants.Types.uuid;
  path: string;
  version: int32;
  insertedAt: utcDateTime;
}

model MemberNotification {
  /** Id of the ledger or application event the notification is derived from */
  id: CommonGrants.Types.uuid;

  type: string;
  category: NotificationCategory;
  title: string;
  subjectType: string | null;
  subjectId: string | null;
  message: string | null;
  at: utcDateTime;
  read: boolean;
}

alias NotificationCategory = "application" | "decision" | "award" | "agreement" | "payment" | "requirement" | "submission" | "organization" | "approval" | "review" | "agent";

model NotificationList {
  unread: int32;
  items: MemberNotification[];
}

/** Either `ids` or `all: true`. */
model NotificationReadInput {
  ids?: CommonGrants.Types.uuid[];
  all?: true;
}

model NotificationChannel {
  inApp: boolean;
  email: boolean;
}

/** `email` and `digest` are stored for the mail jobs; today only `inApp` changes what is returned. */
model NotificationPreferences {
  digest: "immediate" | "daily" | "weekly" | "off";

  /** Category → channels. Every category is present in responses; missing ones default to on. */
  channels: Record<NotificationChannel>;
}

/** What an action on an application returns: the fields it changed. */
model ApplicationActionResult {
  id: PrefixedId;
  status?: ApplicationStatus;
  stage?: string;
  tags?: string[];
  assignedToUserId?: CommonGrants.Types.uuid | null;
  decisionId?: CommonGrants.Types.uuid;

  /** Whether the templated letter went out, and why not when it did not. */
  letter?: {
    sent: boolean;
    reason?: string;
  };
}

model AdvanceRequest {
  toStage: string;
  note?: string;
}

model RevisionRequest {
  /** Form id → field paths the applicant is asked to revise */
  fields?: Record<string[]>;

  message: string;
  dueAt?: utcDateTime;
}

model DeclineRequest {
  rationale?: string;
  letterTemplateId?: string;

  /** Send the decline letter (default true). */
  sendLetter?: boolean;
}

model TagsRequest {
  add?: string[];
  remove?: string[];
}

model AssignRequest {
  userId: CommonGrants.Types.uuid | null;
}

model BulkApplicationRequest {
  applicationIds: GmsId[];
  action: "advance" | "decline" | "tag" | "assign";

  /** The body the single-application route takes for this action. */
  params?: Record<unknown>;
}

/** Each application succeeds or fails on its own; nothing is rolled back. */
model BulkResult {
  action: "advance" | "decline" | "tag" | "assign";
  requested: int32;
  succeeded: string[];
  failed: {
    id: string;
    message: string;
  }[];
  lettersSent: int32;
}

/** An application as its applicant sees it in the list. */
model MyApplication {
  id: PrefixedId;
  title: string;
  status: ApplicationStatus;
  stage: {
    key: string;
    label: string;
    closes: utcDateTime | null;
  };
  funder: {
    workspaceId: CommonGrants.Types.uuid;
    name: string | null;
    handle: string | null;
    brand: Brand;
  };
  opportunity: {
    id: PrefixedId;
    title: string | null;
  };

  /** Forms of the current stage and how many validate. */
  forms: {
    total: int32;
    complete: int32;
  };
  submittedAt: utcDateTime | null;
  updatedAt: utcDateTime;
}

model ApplicationStatusView {
  id: PrefixedId;
  title: string;
  status: ApplicationStatus;
  stage: string;
  submittedAt: utcDateTime | null;
  stages: {
    key: string;
    label: string;
    opens: utcDateTime | null;
    closes: utcDateTime | null;
    state: "done" | "current" | "upcoming";
  }[];
  timeline: ApplicationEvent[];
}

/** A funder the applicant has applied to on the GMS. */
model MyFunder {
  workspaceId: CommonGrants.Types.uuid;
  name: string;
  handle: string;
  brand: Brand;
  since: utcDateTime | null;
  applications: int32;
  awards: int32;
}

model RubricCriterion {
  key: string;
  label: string;
  description?: string;
  weight: float64;

  /** `numeric(min,max)` or `categorical[...]` */
  scale: Record<unknown>;

  guidance?: string;
}

model Rubric {
  id: string;
  name: string;
  version: int32;
  criteria: RubricCriterion[];
  overall?: Record<unknown>;
  spreadThreshold?: float64;
}

model RubricInput {
  name: string;
  criteria: RubricCriterion[];
  overall?: Record<unknown>;
  spreadThreshold?: float64;
}

/** A reviewer's assignment to one application in one stage. Ids of assignments are bare UUIDs. */
model ReviewAssignment {
  id: CommonGrants.Types.uuid;
  applicationId: PrefixedId;
  applicationTitle: string | null;
  competitionId: PrefixedId | null;
  stage: string;
  reviewerUserId: CommonGrants.Types.uuid;
  rubricId: CommonGrants.Types.uuid;
  rubricVersion: int32;
  dueAt: utcDateTime | null;
  status: "assigned" | "coi_declared" | "in_progress" | "submitted" | "recused";

  /** `declared` is null until the reviewer has answered the conflict-of-interest question. */
  coi: {
    declared: boolean | null;
    reason: string | null;
  };

  /** Present once the reviewer has saved scores. `overall` is 0–100, null while incomplete. */
  review: {
    id: PrefixedId;
    submittedAt: utcDateTime | null;
    overall: float64 | null;
    complete: boolean;
  } | null;

  createdAt: utcDateTime;
}

/** The reviewer's working view: the rubric, their own review, and the application as a reviewer may
 * see it (reviewer-visible fields only; PII masked and no organization record for external reviewers).
 */
model ReviewAssignmentDetail {
  ...ReviewAssignment;
  rubric: {
    id: CommonGrants.Types.uuid;
    version: int32;
    name: string;
    criteria: RubricCriterion[];
    overall: Record<unknown>;
  };
  myReview: {
    scores: Record<unknown>;
    narrative: string | null;
    recommendation: string | null;
    submittedAt: utcDateTime | null;
  } | null;

  /** Null for a recused reviewer. */
  application: Record<unknown> | null;
}

model ReviewAssignmentInput {
  applicationId: GmsId;

  /** Defaults to the application's current stage */
  stage?: string;

  reviewerUserId: CommonGrants.Types.uuid;

  /** Used for the same-domain conflict check when the membership carries no email */
  reviewerEmail?: string;

  dueAt?: utcDateTime;
}

model AutoAssignRequest {
  competitionId: GmsId;
  stage?: string;
  reviewersPerApplication?: int32 = 2;

  /** Limit the pool, or override capacity and expertise tags per reviewer */
  reviewers?: {
    userId: CommonGrants.Types.uuid;
    email?: string;
    capacity?: int32;
    tags?: string[];
  }[];

  dueAt?: utcDateTime;

  /** Return the plan without creating assignments */
  dryRun?: boolean = false;
}

model AutoAssignResult {
  stage: string;
  dryRun: boolean;
  created: int32;
  assignments: {
    applicationId: PrefixedId;
    reviewerUserId: CommonGrants.Types.uuid;
    matchedTags: string[];
  }[];

  /** Applications that could not get their full complement */
  unfilled: {
    applicationId: PrefixedId;
    missing: int32;
  }[];

  /** Every reviewer/application pair excluded for a conflict of interest */
  coiFlags: {
    applicationId: PrefixedId;
    reviewerUserId: CommonGrants.Types.uuid;
    reason: "declared_org" | "declared_program" | "same_email_domain";
    detail: string;
  }[];
}

/** `PATCH /gms/review-assignments/{id}`: one action per request. */
model ReviewAssignmentPatch {
  action: "declare_coi" | "save" | "submit" | "recuse" | "reschedule";

  /** declare_coi */
  hasConflict?: boolean;

  /** declare_coi, recuse */
  reason?: string;

  /** save, submit: criterion key → value, or `{ value, comment }` */
  scores?: Record<unknown>;

  narrative?: string;
  recommendation?: string;

  /** reschedule */
  dueAt?: utcDateTime | null;
}

model InviteReviewerRequest {
  email: string;
  competitionId: GmsId;
  expiresInDays?: int32 = 14;
}

model ReviewerInvitation {
  id: CommonGrants.Types.uuid;
  email: string;
  role: "external_reviewer";
  competitionId: PrefixedId;
  expiresAt: utcDateTime;

  /** Returned once; only its hash is stored */
  token: string;

  acceptUrl: url;
  emailed: boolean;
}

model Review {
  id: PrefixedId;
  assignmentId: CommonGrants.Types.uuid;
  applicationId: PrefixedId;
  stage: string;
  reviewerUserId: CommonGrants.Types.uuid;

  /** True for the caller's own review */
  own: boolean;

  /** Criterion key → value, or `{ value, comment }` */
  scores: Record<unknown>;

  /** Criterion key → 0–1 */
  normalized: Record<float64>;

  /** Weighted overall, 0–100; null while any criterion is unscored */
  overall: float64 | null;

  narrative: string | null;
  recommendation: string | null;
  visibility: "panel" | "funder_only";
  submittedAt: utcDateTime | null;
}

model RankingRow {
  applicationId: PrefixedId;
  title: string;
  applicant: string | null;
  status: ApplicationStatus;

  /** 1-based; null when no review has been submitted */
  rank: int32 | null;

  n: int32;
  mean: float64 | null;
  median: float64 | null;

  /** Sample standard deviation of the reviewers' overall scores */
  stdev: float64 | null;

  /** True when `stdev` exceeds the rubric's spread threshold */
  spreadFlag: boolean;

  overalls: {
    reviewerId: CommonGrants.Types.uuid;
    overall: float64;
  }[];
  incomplete: string[];
  requestedAmountMinor: int64 | null;
  currency: string;
  assigned: int32;
  pending: int32;
  decision: {
    id: CommonGrants.Types.uuid;
    outcome: DecisionOutcome;
    amountMinor: int64 | null;
    committed: boolean;
  } | null;
}

model Ranking {
  competitionId: PrefixedId;
  stage: string;
  rubric: {
    id: CommonGrants.Types.uuid;
    version: int32;
    name: string;
  };
  items: RankingRow[];
}

model DecisionInput {
  applicationId: GmsId;
  outcome: DecisionOutcome;

  /** Required for `approve`; integer minor units */
  amountMinor?: int64;

  conditions?: string[];
  rationale?: string;
  letterTemplateId?: CommonGrants.Types.uuid;
}

model ProposeDecisionsRequest {
  competitionId: GmsId;
  decisions: DecisionInput[];
}

model ProposeDecisionsResult {
  decisions: Decision[];
  allocation: Allocation;
}

model CommitDecisionsRequest {
  competitionId: GmsId;
  decisionIds: CommonGrants.Types.uuid[];

  /** A workspace admin may commit past the program's budget by giving a reason; it is ledgered */
  override?: {
    reason: string;
  };
}

model CommitDecisionsResult {
  committed: int32;
  failed: int32;
  results: {
    decisionId: CommonGrants.Types.uuid;
    applicationId: PrefixedId;
    outcome: DecisionOutcome;
    ok: boolean;
    awardId?: PrefixedId;
    agreementId?: PrefixedId;
    letterSent?: boolean;
    message?: string;
  }[];
  override: {
    by: CommonGrants.Types.uuid;
    reason: string;
    overByMinor: int64;
  } | null;
  allocation: Allocation;
}

model Decision {
  id: CommonGrants.Types.uuid;
  competitionId: PrefixedId;
  applicationId: PrefixedId;
  stage: string | null;
  outcome: DecisionOutcome;
  amountMinor: int64 | null;
  currency: string;
  conditions: string[];
  rationale: string | null;
  letterTemplateId: CommonGrants.Types.uuid | null;

  /** Ledger actor string of whoever proposed it (a person, or a person through an agent) */
  proposedBy: string | null;

  decidedBy: CommonGrants.Types.uuid | null;

  /** Null while this is still a proposal */
  committedAt: utcDateTime | null;

  createdAt: utcDateTime;
}

/** Program headroom for a panel, in integer minor units. `budgetMinor` and `availableMinor` are
 * null when the program has no budget set.
 */
model Allocation {
  programId: CommonGrants.Types.uuid | null;
  currency: string;
  budgetMinor: int64 | null;

  /** Awards in the program that were not cancelled */
  committedMinor: int64;

  /** Approvals proposed in this competition and not yet committed */
  proposedMinor: int64;

  availableMinor: int64 | null;
  over: boolean;
  overByMinor: int64;
}

// #########################################################
// Awards, agreements, payments
// #########################################################

/** An award as the GMS routes return it. The CommonGrants projection is at `/common-grants/awards/{id}`. */
model GmsAward {
  id: PrefixedId;
  title: string;
  description: string | null;
  status: AwardStatus;
  currency: string;
  requestedAmountMinor: int64 | null;
  awardedAmountMinor: int64 | null;

  /** The value last read from Passport; never computed in the GMS. Null until Passport reports one. */
  disbursedAmountMinor: int64 | null;

  /** When `disbursedAmountMinor` was last read from Passport */
  disbursedAt: utcDateTime | null;

  /** CommonGrants `AwdTimeline` */
  keyDates: Record<unknown>;

  conditions: string[];
  applicationId: PrefixedId | null;
  opportunityId: PrefixedId | null;
  programId: CommonGrants.Types.uuid | null;
  parentAwardId: PrefixedId | null;
  funder: {
    workspaceId: CommonGrants.Types.uuid;
    name: string | null;
    handle: string | null;
    brand: Record<unknown> | null;
  };
  recipient: {
    workspaceId: CommonGrants.Types.uuid;
    name: string | null;
    handle: string | null;

    /** The recipient's current Passport level, while their consent stands */
    level: string | null;
  } | null;
  recipientIndividual: Record<unknown> | null;
  passport: {
    /** The mirrored award in Passport, set after acceptance */
    awardId: string | null;

    syncedAt: utcDateTime | null;
    mirror: "synced" | "pending" | "not_applicable" | "disabled";
  };
  createdAt: utcDateTime;
  updatedAt: utcDateTime;
}

model GmsAwardDetail {
  ...GmsAward;
  agreement: AgreementSummary | null;
  tranches: AwardTranche[];
  requirements: AwardRequirement[];
  amendments: Amendment[];
}

/** `POST /gms/my/awards/{id}/accept`: the award plus what happened with the Passport mirror. */
model AcceptedAward {
  ...GmsAwardDetail;
  mirror: {
    state: "synced" | "skipped" | "failed";
    passportAwardId?: string;
    reason?: string;
  } | null;
}

model AwardTranche {
  id: PrefixedId;
  seq: int32;
  amountMinor: int64;
  currency: string;
  condition: Record<unknown>;
  status: TrancheStatus;
  dueAt: utcDateTime | null;
  holdReason: string | null;
  mode: "facilitated" | "resolve" | null;
  passportStatus: string | null;
  releasedAt: utcDateTime | null;
}

model AwardRequirement {
  id: PrefixedId;
  type: "report" | "document" | "milestone" | "site_visit" | "acknowledgment";
  title: string;
  formId: PrefixedId | null;
  dueAt: utcDateTime | null;
  status: RequirementStatus;
  releasesTrancheId: PrefixedId | null;
}

model AwardFromApplicationRequest {
  applicationId: GmsId;
  amountMinor: int64;
  currency?: string = "USD";
  startDate?: plainDate;
  endDate?: plainDate;
  conditions?: string[];
}

model AwardFromApplicationResult {
  awardId: PrefixedId;
  agreementId: PrefixedId | null;
  status: AwardStatus;
}

model AmendmentInput {
  type: "extension" | "reallocation" | "scope" | "supplemental";

  /** extension: `{ newEndDate }`; supplemental: `{ amountMinor }`; reallocation and scope: free-form */
  request?: Record<unknown>;

  reason: string;
}

model AmendmentDecision {
  status: "approved" | "declined";
  note?: string;
}

model Amendment {
  id: CommonGrants.Types.uuid;
  awardId: PrefixedId;
  type: "extension" | "reallocation" | "scope" | "supplemental";
  request: Record<unknown>;
  status: "requested" | "approved" | "declined";
  requestedBy: CommonGrants.Types.uuid | null;
  decidedBy: CommonGrants.Types.uuid | null;
  decidedAt: utcDateTime | null;
  childAwardId: PrefixedId | null;
  createdAt: utcDateTime;
}

/** What a click-to-sign signature shows to the other party. The full audit record (user, network
 * address, document hash) is in the ledger and on the executed PDF.
 */
model Signature {
  name: string;
  at: utcDateTime;
}

model SignRequest {
  /** Typed legal name */
  name: string;

  /** The attestation checkbox */
  attest: true;

  /** SHA-256 of the document the signer was shown; when given it must match the agreement */
  documentSha256?: Sha256;
}

model AgreementSummary {
  id: PrefixedId;
  version: int32;
  status: AgreementStatus;

  /** SHA-256 of the document sent for signature; null until it is sent */
  documentSha256: Sha256 | null;

  granteeSignedAt: utcDateTime | null;
  funderSignedAt: utcDateTime | null;
  executedAt: utcDateTime | null;
}

model Agreement {
  ...AgreementSummary;
  awardId: PrefixedId;
  templateId: CommonGrants.Types.uuid | null;
  granteeSignature: Signature | null;
  funderSignature: Signature | null;
  hasStoredPdf: boolean;
  createdAt: utcDateTime;
}

model SentAgreement {
  ...Agreement;
  letter: {
    sent: boolean;
    reason?: string;
  };
}

model ExecutedAgreement {
  ...Agreement;

  /** SHA-256 of the executed PDF (text plus signature record); also in the ledger */
  executedPdfSha256: Sha256;

  awardStatus: AwardStatus;
  tranchesDue: PrefixedId[];
}

model AgreementInput {
  /** An agreement template of this workspace; the program default or the standard agreement otherwise */
  templateId?: CommonGrants.Types.uuid;
}

model TrancheCondition {
  type: "onExecution" | "onReportAccepted" | "onDate" | "manual";
  requirementId?: GmsId;
  date?: plainDate;
}

model Tranche {
  id: PrefixedId;
  awardId: PrefixedId;
  seq: int32;
  amount: Money;
  condition: TrancheCondition;
  status: TrancheStatus;
  dueAt?: utcDateTime;
  releasedBy?: string;
  releasedAt?: utcDateTime;
  mode?: PaymentMode;
  passportDisbursementId?: string;
  passportStatus?: string;
  holdReason?: string;

  /** Display only, from the PayeeCredential */
  bankName?: string;

  last4?: Last4;
}

model TrancheInput {
  seq: int32;
  amount: Money;
  condition: TrancheCondition;
}

model ScheduleInput {
  tranches: TrancheInput[];
}

model ReleaseRequest {
  /** Confirms a second tranche of the same amount within 24 hours */
  confirmDuplicate?: boolean;
}

/** A payment the funder made outside Passport (resolve mode). */
model ExternalPayment {
  reference: string;
  paidAt: utcDateTime;
  destinationLast4: Last4;
}

model PaymentAlert {
  kind:
    | "destination_change_pending"
    | "freeze_window"
    | "level_below_l3"
    | "agreement_not_executed"
    | "passport_unavailable"
    | "organization_inactive"
    | "unverified_external";
  recipientWorkspaceId?: CommonGrants.Types.uuid;
  trancheId?: PrefixedId;
  title: string;
  detail: string;

  /** What clears the block: a date or an action */
  clears?: string;
}

/** An outbound bank transaction read from Mercury for reconciliation. */
model BankTransaction {
  id: string;
  provider: "mercury";
  amount: Money;
  postedAt: utcDateTime;
  counterpartyName?: string;
  memo?: string;
  matchedTrancheId?: PrefixedId;
  suggestedTrancheId?: PrefixedId;
}

model MatchRequest {
  trancheId: GmsId;
}

// #########################################################
// Requirements, submissions, budgets
// #########################################################

model Requirement {
  id: PrefixedId;
  awardId: PrefixedId;
  type: "report" | "document" | "milestone" | "site_visit" | "acknowledgment";
  title: string;
  formId?: PrefixedId;
  formVersion?: int32;
  dueAt?: utcDateTime;
  recurrence?: Record<unknown>;
  graceDays?: int32;

  /** Day offsets from the due date, e.g. `[-30, -14, -7, 0, 3, 14]` */
  reminderPlan?: int32[];

  status: RequirementStatus;
  releasesTrancheId?: PrefixedId;
}

model RequirementInput {
  type: "report" | "document" | "milestone" | "site_visit" | "acknowledgment";
  title: string;
  formId?: GmsId;
  formVersion?: int32;
  dueAt?: utcDateTime;
  recurrence?: Record<unknown>;
  graceDays?: int32;
  reminderPlan?: int32[];
  releasesTrancheId?: GmsId;
}

model Submission {
  id: PrefixedId;
  requirementId: PrefixedId;
  awardId: PrefixedId;
  status: SubmissionStatus;
  submittedAt?: utcDateTime;
  reviewedBy?: string;
  reviewNote?: string;

  /** Set when the grantee shared an accepted submission from another funder */
  sharedFromSubmissionId?: PrefixedId;

  formResponses?: AppFormResponse[];
}

model ReviewNote {
  note?: string;
}

model ShareSubmissionRequest {
  funderWorkspaceId: CommonGrants.Types.uuid;

  /** Field paths to include; omit to share every field */
  fields?: string[];

  attachmentIds?: string[];
}

model BudgetLine {
  category: string;
  label: string;
  amount: Money;
  notes?: string;
}

model Budget {
  kind: "proposed" | "approved" | "actual";
  categories: string[];
  lines: BudgetLine[];
  source?: string;
  periodStart?: plainDate;
  periodEnd?: plainDate;
}

model VarianceRow {
  category: string;
  approved: Money;
  actual: Money;
  variance: Money;
  variancePercent: float64;
}

// #########################################################
// Grantees, org changes, consents
// #########################################################

model Grantee {
  applicantWorkspaceId: CommonGrants.Types.uuid;
  passportOrgId?: CommonGrants.Types.uuid;
  name: string;
  verificationLevel?: VerificationLevel;
  ownerUserId?: CommonGrants.Types.uuid;
  tags: string[];
  notes?: string;
  pendingOrgChanges: int32;
  lastSyncedAt?: utcDateTime;

  /** The cached CommonGrants profile; present on the detail route */
  organization?: OrganizationBase;
}

model OrgChange {
  id: string;
  passportOrgId: CommonGrants.Types.uuid;
  changeId: string;
  patch: Record<unknown>;
  status: "pending" | "accepted" | "dismissed";
  receivedAt: utcDateTime;
}

model ProposeChangeRequest {
  /** JSON merge patch over the organization's CommonGrants profile */
  patch: Record<unknown>;

  note?: string;
}

model Consent {
  id: string;
  funder: {
    workspaceId: CommonGrants.Types.uuid;
    name: string | null;
    handle: string | null;
  };
  basis: "application" | "passport_grant" | "shared_submission";
  scopes: string[];
  grantedAt: utcDateTime;
  revokedAt: utcDateTime | null;
}

/** One line of a readiness checklist. `unknown` is a state of its own: it is never folded into pass or fail. */
model ReadinessCheck {
  key: string;
  state: "pass" | "fail" | "unknown";
  label: string;
  reason: string;

  /** Where to fix it (a path in the web app or a Passport URL); null when nothing needs fixing. */
  fixHref: string | null;
}

/** Passport readiness shown to an applicant: the level and what each next step needs. */
model ApplicantReadiness {
  level: VerificationLevel | null;

  /** Whether the workspace holds a live Passport consent. */
  linked: boolean;

  syncedAt: utcDateTime | null;
  checks: ReadinessCheck[];
  summary: {
    pass: int32;
    fail: int32;
    `unknown`: int32;
    ready: boolean;
  };
}

/** The applicant's organization as cached from Passport. Read-only here: edits happen in Passport. */
model MyOrganization {
  workspaceId: CommonGrants.Types.uuid;
  handle: string;
  displayName: string;
  passportOrgId: CommonGrants.Types.uuid | null;
  linked: boolean;
  level: VerificationLevel | null;
  verifiedAt: utcDateTime | null;

  /** URL of the signed Passport attestation */
  attestationUrl: url | null;

  /** CommonGrants `OrganizationBase`, exactly as Passport served it. */
  organization: OrganizationBase | null;

  /** Common App profile (budget, fiscal year end, staff count, 990 figures) folded into an object. Confirmed fields only. */
  profile: Record<unknown> | null;

  /** JSON pointer of each profile field → where Passport got the value. */
  profileSources: Record<string>;

  syncedAt: utcDateTime | null;

  /** Where to edit the record in Passport. */
  editUrl: url | null;
}

model ConsentStartRequest {
  /** An applicant workspace the caller administers that has no Passport organization yet. */
  workspaceId?: CommonGrants.Types.uuid;

  /** Path in the web app to land on afterwards. */
  returnTo?: string;
}

model ConsentStart {
  /** Passport authorization URL (authorization code + PKCE) */
  authorizeUrl: url;

  scopes: string[];
  expiresInSeconds: int32;
}

/** A workspace as the signed-in person sees it in the switcher. */
model MyWorkspace {
  id: CommonGrants.Types.uuid;
  handle: string;
  kind: WorkspaceKind;
  role: MemberRole;
  displayName: string;

  /** Same as `displayName`. */
  name: string;

  brand: Brand;

  /** Whether this role needs two-step verification before the workspace opens. */
  requiresMfa: boolean;

  passportOrgId: CommonGrants.Types.uuid | null;
  verificationLevel: VerificationLevel | null;
}

/** The signed-in person and the workspaces they can open. */
model Me {
  userId: CommonGrants.Types.uuid;
  email: string | null;
  mfaVerified: boolean;
  workspaces: MyWorkspace[];
}

/** What a caller is in a workspace: the same answer for a person, an API client and an agent. */
model WhoAmI {
  kind: "user" | "client" | "delegated";
  userId: CommonGrants.Types.uuid | null;
  clientId: string | null;
  workspaceId: CommonGrants.Types.uuid;
  role: MemberRole | null;
  scopes: string[];
}

/** What a funder shows publicly. */
model PublicFunder {
  handle: string;
  name: string;
  brand: {
    logoUrl: string | null;
    accent: string | null;
    onAccent: string | null;
  };
  mission: string | null;
  website: string | null;
  verificationLevel: string | null;
}

model PublicOpportunityCard {
  id: CommonGrants.Types.uuid;
  slug: string;
  title: string;
  description: string;
  status: "forecasted" | "open" | "closed";

  /** CommonGrants `OppFunding` */
  funding: Record<unknown>;

  /** CommonGrants `OppTimeline` */
  keyDates: Record<unknown>;

  acceptedApplicantTypes: string[];
}

model FunderPage {
  funder: PublicFunder;
  opportunities: PublicOpportunityCard[];
}

model PublicCompetition {
  id: CommonGrants.Types.uuid;
  title: string;
  description: string | null;
  instructions: string | null;
  status: "draft" | "open" | "closed";
  keyDates: Record<unknown>;
  stages: {
    key: string;
    label: string;
    opens: utcDateTime | null;
    closes: utcDateTime | null;
    requiresSubmission: boolean;
  }[];
}

model OpportunityPage {
  funder: PublicFunder;
  opportunity: {
    ...PublicOpportunityCard;
    publishedAt: utcDateTime | null;

    /** The eligibility rules' plain-language labels */
    eligibility: string[];
  };
  competitions: PublicCompetition[];

  /** The CommonGrants `OpportunityDetails` record */
  commonGrants: Record<unknown>;

  links: {
    json: url;
    page: url;
  };
}

model SavedListingInput {
  source: "gms" | "opengrants";
  externalId: string;
  title: string;
  url?: url;
  listing?: Record<unknown>;
}

model SavedListing {
  id: CommonGrants.Types.uuid;
  source: "gms" | "opengrants";
  externalId: string;
  title: string;
  url: string | null;
  gmsOpportunityId?: GmsId | null;
  savedAt: utcDateTime;
}

model ThreadInput {
  subjectType?: "application";
  subjectId: GmsId;

  /** `internal` opens the caller's side's private thread; the other side never sees it. */
  visibility?: "shared" | "internal";
}

model TaskPatch {
  title?: string;
  assigneeUserId?: CommonGrants.Types.uuid | null;
  dueAt?: utcDateTime | null;
  done?: boolean;
}

/** One JSON-RPC 2.0 message of the Model Context Protocol (or a batch of up to 20). */
model McpMessage {
  jsonrpc: "2.0";
  id?: string | int32 | null;
  method?: string;
  params?: Record<unknown>;
  result?: unknown;
  error?: {
    code: int32;
    message: string;
    data?: unknown;
  };
}

// #########################################################
// Communication, templates, tasks
// #########################################################

model Thread {
  id: string;
  subjectType: "application" | "award" | "requirement";
  subjectId: string;
  visibility: "shared" | "funder_internal" | "applicant_internal";
  title?: string | null;
  funderWorkspaceId?: CommonGrants.Types.uuid | null;
  applicantWorkspaceId?: CommonGrants.Types.uuid | null;
  messages: Message[];
  updatedAt: utcDateTime;
}

model Message {
  id: string;

  /** Ledger actor: `user:<id>` or `user:<id>/client:<id>` */
  author: string;

  authorUserId?: CommonGrants.Types.uuid | null;
  body: string;
  createdAt: utcDateTime;
}

model MessageInput {
  body: string;
}

model Task {
  id: string;
  subjectType: string | null;
  subjectId: string | null;
  title: string;
  assigneeUserId: CommonGrants.Types.uuid | null;
  dueAt: utcDateTime | null;
  doneAt: utcDateTime | null;
  createdAt: utcDateTime;
}

model TaskInput {
  subjectType?: string;
  subjectId?: string;
  title: string;
  assigneeUserId?: CommonGrants.Types.uuid;
  dueAt?: utcDateTime;
}

model Template {
  /** A UUID, or `builtin:<name>` for the texts that ship with the GMS */
  id: string;

  kind: "letter" | "agreement" | "email";
  name: string;
  version: int32;

  /** Email templates only */
  subject: string | null;

  /** Markdown with `{{merge.fields}}` */
  body: string;

  /** The merge fields the subject and body use */
  fields: string[];

  shared: boolean;
  builtIn?: boolean;
  createdAt?: utcDateTime;
}

model TemplateList {
  items: Template[];
  builtIn: Template[];
}

/** Saving a template with the same kind and name adds a version; earlier versions are immutable. */
model TemplateInput {
  kind: "letter" | "agreement" | "email";
  name: string;

  /** Required for email templates */
  subject?: string;

  body: string;
}

model RenderRequest {
  /** Merge fields; they override the ones derived from the application or award */
  fields?: Record<unknown>;

  applicationId?: GmsId;
  awardId?: GmsId;
}

model Rendered {
  templateId: string;
  kind: "letter" | "agreement" | "email";
  subject: string | null;
  text: string;
  html: string | null;
}

model SendRequest {
  templateId: string;
  recipients: {
    applicationId?: GmsId;
    awardId?: GmsId;
    applicantWorkspaceId?: CommonGrants.Types.uuid;
  }[];
  subjectOverride?: string;

  /** Extra merge fields applied to every recipient */
  fields?: Record<unknown>;
}

model SendResult {
  batch: CommonGrants.Types.uuid;
  templateId: string;
  requested: int32;
  sent: int32;
  results: {
    subject: {
      type: string;
      id: string;
    };
    sent: boolean;
    reason?: string;
  }[];
}

/** One line of the send log. */
model SentCommunication {
  status: "sent" | "failed";
  subjectType: string;
  subjectId: string;
  template: string | null;
  templateName: string | null;
  batch: string | null;
  actor: string;
  at: utcDateTime | null;
}

/** A field comment inside the applicant team. */
model Comment {
  id: string;
  body: string;
  author: string;
  authorUserId: CommonGrants.Types.uuid | null;
  formId: PrefixedId | null;

  /** JSON pointer of the field the comment is about */
  fieldPath: string | null;

  resolvedAt: utcDateTime | null;
  createdAt: utcDateTime;
}

model CommentInput {
  body: string;
  formId?: GmsId;
  fieldPath?: string;
}

model SectionAssignment {
  formId: GmsId;

  /** Section key → user id; null clears the assignment */
  sections: Record<CommonGrants.Types.uuid | null>;
}

/** Either the file itself (up to 25 MB, base64) or a reference into the Passport locker, which is never copied. */
/** A reference to a document in the organization's Passport locker. The GMS holds no copy. */
model LockerDocumentRef {
  /** Passport's document id; pass it as `passportDocumentId` to attach the document. */
  id: string;

  /** Passport's document kind, e.g. `determination_letter`, `audit`, `form_990`. */
  kind: string;

  name: string | null;
  mimeType: string | null;
  sha256: Sha256 | null;

  /** `upload`, `google_drive` or `import`. */
  source: string;

  uploadedAt: utcDateTime;
  expiresAt: utcDateTime | null;

  /** False when Passport holds no hash for the file (a Drive reference), so it cannot be pinned to an application. */
  attachable: boolean;
}

model AttachmentInput {
  /** Required for an upload; for a Passport locker reference by id alone the name comes from Passport. */
  name?: string;

  mime?: string;

  /** The file bytes, base64. The server computes the size and SHA-256. */
  contentBase64?: string;

  /** A reference into the Passport document locker instead of an upload. Sent alone, the server reads the name, type and hash from Passport. */
  passportDocumentId?: string;

  size?: int64;
  sha256?: Sha256;
}

model Document {
  id: string;
  name: string;
  mime: string;
  size: int64;
  sha256: Sha256;
  source: "upload" | "passport_locker";
  passportDocumentId: string | null;
  scanStatus: "not_scanned" | "clean" | "infected";
  uploadedAt: utcDateTime;
}

model Answer {
  id: string;
  key: string;
  title: string;
  body: string;
  version: int32;
  usedIn?: AnswerUse[];
  words: int32;
  updatedAt: utcDateTime;
}

model AnswerInput {
  key?: string;
  title: string;
  body: string;
}

// #########################################################
// Discovery (OpenGrants) and assistant
// #########################################################

/** A competition open on this GMS, with the caller's eligibility. */
model DiscoverCompetition {
  competitionId: CommonGrants.Types.uuid;
  opportunity: {
    id: PrefixedId;
    slug: string;
    title: string;
    description: string;
    funding: Record<unknown>;
  };
  funder: {
    name: string | null;
    handle: string | null;
    brand: Brand;
  };
  stage: {
    key: string;
    label: string;
    closes: utcDateTime | null;
  } | null;

  /** Number of forms in the first stage */
  forms: int32;

  eligibility: EligibilityResult;

  /** The caller's application to this competition, when one exists. */
  application: {
    id: PrefixedId;
    status: ApplicationStatus;
  } | null;

  /** The opportunity's public page */
  url: url | null;
}

/** Query passed to the OpenGrants hosted MCP with the applicant's organization context. */
model OpenGrantsQuery {
  query?: string;
  filters?: Record<unknown>;
}

model OpenGrantsResults {
  /** Listings as OpenGrants returned them, each with `gms` set when it can be applied to here. */
  results: Record<unknown>[];

  /** Served from the 15-minute cache for this organization and query. */
  cached: boolean;
}

/** Whether the assistant is on for this server and how much of the month is left. */
model AssistQuota {
  used: int32;
  limit: int32;
  remaining: int32;
  resetsAt: utcDateTime;
}

model AssistStatus {
  /** False when ASSISTANT_ENABLED is off or no model is configured; the web app then hides its panels. */
  enabled: boolean;

  quota: AssistQuota | null;
}

/** Fields every assistant answer carries. A draft is never saved, submitted or sent by the call. */
model AssistDraftBase {
  draft: true;

  /** `summarize`, `compare_rubric`, `draft_letter` or `adapt_answer` */
  tool: string;

  /** The model that produced the draft */
  `model`: string;

  quota: AssistQuota;

  /** Notes from the model, e.g. that the material contained instruction-like text */
  cautions: string[];
}

model AssistQuote {
  field: string;

  /** Verbatim applicant-supplied text */
  text: string;
}

model SummarizeRequest {
  applicationId: GmsId;
}

model ApplicationSummaryDraft {
  ...AssistDraftBase;
  applicationId: GmsId;
  summary: string;
  strengths: string[];
  openQuestions: string[];
  quotes: AssistQuote[];

  /** What the funder's allow-listed MCP servers said, each with the server it came from */
  fromExternalSystems: {
    server: string;
    note: string;
  }[];

  /** Names of the custom MCP servers that were consulted */
  externalServers: string[];
}

model CompareRubricRequest {
  applicationId: GmsId;
  rubricId: CommonGrants.Types.uuid;
}

model RubricComparisonDraft {
  ...AssistDraftBase;
  applicationId: GmsId;
  rubricId: CommonGrants.Types.uuid;

  /** One entry per rubric criterion. Evidence and gaps only: never a score. */
  criteria: {
    key: string;
    evidence: AssistQuote[];
    observations: string;
    gaps: string[];
  }[];
}

model DraftLetterRequest {
  /** A template id, or a built-in such as `builtin:decline` */
  templateId: string;

  /** What the letter is for, e.g. `decline`, `award`; defaults to `decision` */
  purpose?: string;

  applicationId?: GmsId;

  /** Funder-supplied facts the letter may use */
  context?: Record<unknown>;

  tone?: string;
}

model LetterDraft {
  ...AssistDraftBase;
  templateId: string;
  subject: string;

  /** Markdown. Merge fields from the template stay as written, in double braces. */
  body: string;

  mergeFieldsUsed: string[];
}

model AdaptAnswerLimits {
  maxWords?: int32;
  maxCharacters?: int32;
}

model AdaptAnswerBody {
  question: string;

  /** Help text the funder attached to the question */
  guidance?: string;

  limits?: AdaptAnswerLimits;
}

model AdaptAnswerRequest {
  ...AdaptAnswerBody;
  answerId: CommonGrants.Types.uuid;
}

model AdaptedAnswerDraft {
  ...AssistDraftBase;
  answerId: CommonGrants.Types.uuid;
  answerVersion: int32;
  text: string;

  /** Counted by the server, not the model */
  wordCount: int32;

  overLimit: boolean;
  changes: string[];

  /** What the question asks for that the library answer does not contain */
  missing: string[];
}

// #########################################################
// Analytics, import and export
// #########################################################

model PortfolioSummary {
  awarded: Money;
  disbursed: Money;
  activeAwards: int32;
  openApplications: int32;
  reportsDue: int32;
  byProgram: Record<unknown>[];
}

model CycleMetrics {
  competitionId: PrefixedId;
  applications: int32;
  eligible: int32;
  approved: int32;
  declined: int32;
  medianDaysToDecision?: float64;
  byStage: Record<unknown>[];
}

/** One row of the 990-PF Part XV grant list. */
model GrantListRow {
  recipientName: string;
  recipientStatus?: string;
  purpose: string;
  amount: Money;
  paidOn?: plainDate;
}

model ExportJob {
  id: string;
  status: "queued" | "running" | "ready" | "failed";

  /** Signed URL, valid 24 hours */
  url?: url;
}

model CsvImportRequest {
  source: "fluxx" | "foundant" | "submittable" | "generic";

  /** Source column → GMS field */
  mapping: Record<string>;

  documentId: string;
}

// #########################################################
// Integrations, ledger, approvals
// #########################################################

model ApiClient {
  clientId: string;
  name: string;
  scopes: string[];
  gatedTools?: string[];
  createdAt: utcDateTime;
  lastUsedAt?: utcDateTime;
}

model ApiClientInput {
  name: string;
  scopes: string[];
}

/** Returned once, at creation. */
model ApiClientCreated {
  ...ApiClient;
  clientSecret: string;
}

model WebhookSubscription {
  id: string;
  url: url;
  events: string[];
  active: boolean;
}

model WebhookSubscriptionInput {
  url: url;
  events: string[];
}

model WebhookDelivery {
  id: string;
  event: string;
  status: "pending" | "delivered" | "failed";
  attempts: int32;
  lastAttemptAt?: utcDateTime;
  responseStatus?: int32;
}

model McpConnection {
  id: string;
  clientId: string;
  clientName?: string;
  userId: CommonGrants.Types.uuid;
  scopes: string[];
  lastUsedAt?: utcDateTime;
  revokedAt?: utcDateTime;
}

model CustomMcpServer {
  id: string;
  name: string;
  url: url;
  allowedTools: string[];
  readOnly: boolean;
}

model CustomMcpServerInput {
  name: string;
  url: url;

  /** Stored encrypted; never returned */
  auth?: Record<unknown>;

  allowedTools?: string[];
}

union ConnectorProvider {
  googleWorkspace: "google_workspace",
  mercury: "mercury",
}

model ConnectorAccount {
  provider: ConnectorProvider;
  status: string;
  scopes: string[];
  lastSyncAt?: utcDateTime;
}

model ConnectorStart {
  /** Redirect URL for Composio-managed connections; absent for token-based connectors */
  redirectUrl?: url;

  /** Read-only API token for Mercury; stored encrypted */
  token?: string;
}

model LedgerEvent {
  id: string;

  /** `user:<id>`, `client:<id>`, `user:<id>/client:<id>`, `system:<job>` or `passport` */
  actor: string;

  eventType: string;
  subjectType: string;
  subjectId: string;
  data: Record<unknown>;
  occurredAt: utcDateTime;
}

/** A human gate for an agent action. */
model Approval {
  /** `apr_<uuid>` */
  id: string;

  workspaceId: CommonGrants.Types.uuid;
  side: "funder" | "applicant";
  tool: string;

  /** The scope a person needs to approve it (the tool's scope). */
  scope?: string | null;

  description?: string | null;

  /** The agent call that is waiting: the person it acts for and the OAuth client. */
  requestedBy: {
    userId: string;
    clientId: string | null;
  };

  /** The tool input, as the agent sent it. */
  input: unknown;

  /** `approved` is the instant between a person's yes and the call finishing; it ends as `executed` or `failed`. */
  status: "pending" | "approved" | "rejected" | "executed" | "failed" | "expired";

  createdAt: utcDateTime;
  decidedBy?: string;
  decidedAt?: utcDateTime;
  note?: string;

  /** What the approved call returned (status `executed`). */
  result?: unknown;

  /** Why the approved call did not go through (status `failed`). */
  error?: string;

  /** The approval's page in the web app. */
  url?: url;
}

// #########################################################
// OAuth, discovery and agent documents
// #########################################################

union GrantType {
  clientCredentials: "client_credentials",
  authorizationCode: "authorization_code",
  refreshToken: "refresh_token",
}

/** OAuth 2.1 token request, form-encoded. */
model TokenRequest {
  grant_type: GrantType;
  scope?: string;
  client_id?: string;
  client_secret?: string;
  code?: string;
  redirect_uri?: url;
  code_verifier?: string;
  refresh_token?: string;
  resource?: url;
}

/** `access_token` is an ES256 JWT carrying `https://gms.opengrants.io/workspace_id`. */
model TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: int32;
  scope: string;
  refresh_token?: string;
}

/** OAuth 2.0 error response (RFC 6749 §5.2). */
@error
model OAuthError {
  error: string;
  error_description?: string;
  error_uri?: url;
}

model AuthorizationDecision {
  /** The request token from the consent redirect */
  req: string;

  /** The workspace the user grants access to */
  workspaceId: CommonGrants.Types.uuid;

  approve: boolean;
}

model AuthorizationDecisionResult {
  /** Client redirect URI carrying `code` and `state` (or `error=access_denied`) */
  redirectTo: url;
}

/** Dynamic client registration request (RFC 7591). Public clients; PKCE S256 required. */
model ClientRegistrationRequest {
  client_name?: string;
  redirect_uris: url[];
  grant_types?: GrantType[];
  token_endpoint_auth_method?: "none";
  scope?: string;
}

model ClientRegistrationResponse {
  client_id: string;
  client_name?: string;
  redirect_uris: url[];
  grant_types: GrantType[];
  token_endpoint_auth_method: "none";
  client_id_issued_at: int64;
}

model Jwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  kid: string;
  alg: "ES256";
  use: "sig";
}

model JwkSet {
  keys: Jwk[];
}

/** RFC 8414 authorization server metadata. */
model AuthorizationServerMetadata {
  issuer: url;
  authorization_endpoint: url;
  token_endpoint: url;
  registration_endpoint: url;
  jwks_uri: url;
  scopes_supported: string[];
  response_types_supported: string[];
  grant_types_supported: GrantType[];
  code_challenge_methods_supported: "S256"[];
  token_endpoint_auth_methods_supported: string[];
}

/** RFC 9728 protected resource metadata for the MCP endpoint. */
model ProtectedResourceMetadata {
  resource: url;
  authorization_servers: url[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
}

model AgentCard {
  name: string;
  description: string;
  url: url;
  auth: Record<unknown>;
  capabilities: string[];
}

/** A signed webhook from Passport or Resend. Stored raw, deduped on the event id. */
model InboundWebhook {
  id?: string;
  type?: string;
  data?: Record<unknown>;
}
