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

model Member {
  userId: CommonGrants.Types.uuid;
  email?: string;
  name?: string;
  role: MemberRole;

  /** Restrictions for consultants and external reviewers: application, award or competition ids. */
  scope?: Record<unknown>;

  expiresAt?: utcDateTime;
  mfaEnrolledAt?: utcDateTime;
}

model MemberInput {
  userId: CommonGrants.Types.uuid;
  role: MemberRole;
  scope?: Record<unknown>;
  expiresAt?: utcDateTime;
}

model Invitation {
  email: string;
  role: MemberRole;
  scope?: Record<unknown>;
  expiresAt?: utcDateTime;
}

/** A Passport OAuth client created in Passport's funder console. The secret is stored encrypted
 * and never returned.
 */
model PassportLinkRequest {
  clientId: string;
  clientSecret: string;
}

model PassportLinkStatus {
  linked: boolean;
  mode?: "funder_client" | "applicant_consent";
  scopes: string[];
  lastOkAt?: utcDateTime;
  revokedAt?: utcDateTime;

  /** Whether the funder can send facilitated payments through Passport. */
  canSendFunds?: boolean;
}

// #########################################################
// Programs, opportunities, competitions, forms
// #########################################################

model Program {
  id: CommonGrants.Types.uuid;
  name: string;
  description?: string;
  fiscalYear?: string;
  budget?: Money;
  defaults?: Record<unknown>;
  ...Timestamps;
}

model ProgramInput {
  name: string;
  description?: string;
  fiscalYear?: string;
  budget?: Money;
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

/** The funder-side view of an opportunity: the CommonGrants record plus GMS settings. */
model GmsOpportunity {
  id: PrefixedId;
  programId?: CommonGrants.Types.uuid;
  slug: string;
  eligibilityRules?: EligibilityRule;
  publish?: PublishSettings;
  publishedAt?: utcDateTime;

  /** The CommonGrants projection served at `/common-grants/opportunities/{oppId}`. */
  cg: OpportunityBase;
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

/** One stage of a competition (build spec §10.4). Exposed to CommonGrants clients in
 * `CompetitionBase.customFields.gms.stages`.
 */
model Stage {
  key: string;
  label: string;

  /** Form id → pinned version */
  forms: Record<int32>;

  opens?: utcDateTime;
  closes?: utcDateTime;
  rubricId?: string;
  reviewers?: string;
  entryFrom: string[];
  requiresSubmission: boolean;
  decisionRequired: boolean;
}

model GmsCompetition {
  id: PrefixedId;
  opportunityId: PrefixedId;
  status: "draft" | "open" | "closed";
  stages: Stage[];
  cg: CompetitionBase;
}

model GmsCompetitionInput {
  opportunityId: GmsId;
  title: string;
  description?: string;
  instructions?: string;
  keyDates?: Record<unknown>;
  acceptedApplicantTypes?: string[];
  stages?: Stage[];
}

model StageForms {
  /** Stage key → (form id → version) */
  stages: Record<Record<int32>>;

  /** Re-validate in-progress responses against the new pinned versions. */
  migrate?: boolean;
}

model RubricRef {
  /** Stage key the rubric applies to */
  stage: string;

  rubricId: string;
}

/** One line of a readiness checklist: state, label, reason and a link that fixes it. */
model ReadinessLine {
  key: string;
  state: TriState;
  label: string;
  reason: string;
  fixUrl?: string;
}

model Readiness {
  ready: boolean;
  passed: int32;
  failed: int32;
  `unknown`: int32;
  lines: ReadinessLine[];
}

union FormPurpose {
  application: "application",
  report: "report",
  loi: "loi",
  amendment: "amendment",
  siteVisit: "site_visit",
  other: "other",
}

model GmsForm {
  id: PrefixedId;
  version: int32;
  purpose: FormPurpose;

  /** Per-field reviewer visibility, PII flags and limits */
  fieldMeta?: Record<unknown>;

  publishedAt?: utcDateTime;
  supersedesFormVersion?: int32;
  cg: FormBase;
}

model GmsFormInput {
  title: string;
  description?: string;
  instructions?: string;
  purpose?: FormPurpose;
  jsonSchema?: Record<unknown>;
  uiSchema?: Record<unknown>;
  mappingFromCommonGrants?: Record<unknown>;
  mappingToCommonGrants?: Record<unknown>;
  fieldMeta?: Record<unknown>;
}

model EligibilityRequest {
  opportunityId: GmsId;

  /** Evaluate against a submitted or draft application… */
  applicationId?: GmsId;

  /** …or against an organization alone. */
  orgId?: CommonGrants.Types.uuid;
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

model ReviewAssignment {
  id: PrefixedId;
  applicationId: PrefixedId;
  stage: string;
  reviewerUserId: CommonGrants.Types.uuid;
  rubricId: string;
  rubricVersion: int32;
  dueAt?: utcDateTime;
  status: "assigned" | "coi_declared" | "in_progress" | "submitted" | "recused";
  coi?: {
    declared: boolean;
    reason?: string;
  };
}

model ReviewAssignmentInput {
  applicationId: GmsId;
  stage: string;
  reviewerUserId: CommonGrants.Types.uuid;
  dueAt?: utcDateTime;
}

model AutoAssignRequest {
  competitionId: GmsId;
  stage: string;
  reviewersPerApplication: int32;
  maxPerReviewer?: int32;
}

model Review {
  assignmentId: PrefixedId;

  /** Criterion key → `{ value, comment }` */
  scores: Record<unknown>;

  narrative?: string;
  recommendation?: string;
  submittedAt?: utcDateTime;
  visibility: "panel" | "funder_only";
}

model RankingRow {
  applicationId: PrefixedId;
  applicantName: string;
  rank: int32;
  mean: float64;
  median: float64;
  stdev: float64;
  n: int32;

  /** True when `stdev` exceeds the rubric's spread threshold */
  spreadFlag: boolean;

  requestedAmount?: Money;
}

model DecisionInput {
  applicationId: GmsId;
  outcome: DecisionOutcome;
  amount?: Money;
  conditions?: string[];
  rationale?: string;
  letterTemplateId?: string;
}

model ProposeDecisionsRequest {
  competitionId: GmsId;
  decisions: DecisionInput[];
}

model CommitDecisionsRequest {
  competitionId: GmsId;
  decisionIds: string[];

  /** Admin override of the allocator, with a ledgered reason */
  overrideReason?: string;
}

model Decision {
  id: string;
  competitionId: PrefixedId;
  applicationId: PrefixedId;
  outcome: DecisionOutcome;
  amount?: Money;
  conditions: string[];
  rationale?: string;
  decidedBy?: string;
  committedAt?: utcDateTime;
}

/** Program headroom for a panel: available, committed and proposed. */
model Allocation {
  budget: Money;
  committed: Money;
  proposed: Money;
  available: Money;
  overAllocated: boolean;
}

// #########################################################
// Awards, agreements, payments
// #########################################################

model GmsAward {
  id: PrefixedId;
  applicationId?: PrefixedId;
  recipientWorkspaceId?: CommonGrants.Types.uuid;
  status: AwardStatus;
  conditions: string[];
  parentAwardId?: PrefixedId;

  /** The mirrored award in Passport, set on acceptance */
  passportAwardId?: CommonGrants.Types.uuid;

  passportSyncedAt?: utcDateTime;

  /** When `cg.funding.disbursedAmount` was last read from Passport */
  disbursedAt?: utcDateTime;

  cg: AwardBase;
}

model AmendmentInput {
  type: "extension" | "reallocation" | "scope" | "supplemental";
  request: Record<unknown>;
}

model Amendment {
  id: string;
  awardId: PrefixedId;
  type: "extension" | "reallocation" | "scope" | "supplemental";
  request: Record<unknown>;
  status: "requested" | "approved" | "declined";
  childAwardId?: PrefixedId;
}

/** Click-to-sign audit record. */
model Signature {
  name: string;
  userId: CommonGrants.Types.uuid;
  ip: string;
  at: utcDateTime;

  /** SHA-256 of the document that was signed */
  hash: Sha256;
}

model SignRequest {
  /** Typed legal name */
  name: string;

  /** The attestation checkbox */
  attest: true;

  /** SHA-256 of the document the signer was shown; must match the agreement */
  documentSha256: Sha256;
}

model Agreement {
  id: PrefixedId;
  awardId: PrefixedId;
  templateId?: string;
  version: int32;
  status: AgreementStatus;
  documentSha256?: Sha256;
  granteeSignature?: Signature;
  funderSignature?: Signature;
  executedAt?: utcDateTime;
}

model AgreementInput {
  templateId: string;
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

/** Published data behind a funder's public page. */
model FunderPage {
  funder: Record<unknown>;
  opportunities: Record<unknown>[];
}

/** Published data behind an opportunity's public page, including the plain-language eligibility lines. */
model OpportunityPage {
  funder: Record<unknown>;
  opportunity: Record<unknown>;
  competitions?: Record<unknown>[];
  eligibility?: string[];
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
  id: string;
  kind: "letter" | "agreement" | "email";
  name: string;

  /** Markdown with merge fields */
  body: string;

  version: int32;
}

model TemplateInput {
  kind: "letter" | "agreement" | "email";
  name: string;
  body: string;
}

model RenderRequest {
  /** Merge-field context: record ids the template resolves against */
  context: Record<unknown>;
}

model Rendered {
  subject?: string;
  html: string;
  text?: string;
}

model SendRequest {
  templateId: string;

  /** Application, award or requirement ids to send to */
  subjectIds: string[];

  subjectType: "application" | "award" | "requirement";
}

model SendResult {
  queued: int32;
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
model AttachmentInput {
  name: string;
  mime: string;

  /** The file bytes, base64. The server computes the size and SHA-256. */
  contentBase64?: string;

  /** A reference into the Passport document locker instead of an upload; `size` and `sha256` are then required. */
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
  usedIn?: unknown[];
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

model AssistRequest {
  /** The application, template, answer or rubric the call works on */
  subjectId: string;

  rubricId?: string;
  templateId?: string;
  question?: string;
  limits?: Record<unknown>;
}

/** A draft produced by the assistant. Never saved as final; the UI labels it. */
model AssistDraft {
  draft: string;
  structured?: Record<unknown>;

  /** Custom MCP servers whose results informed the draft */
  provenance?: string[];
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
