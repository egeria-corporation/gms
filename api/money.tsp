import "@typespec/http";
import "@common-grants/core";
import "./models.tsp";

// Payments, requirements, budgets, grantees, analytics and integrations: the response shapes the
// Worker returns for the money and reporting routes. Amounts are integer minor units. No model
// here carries bank or identity data: a destination is a bank name and the last four digits, and
// `disbursedAmountMinor` is always the value last read from Passport.

namespace GMS.Models;

// ---------------------------------------------------------------------------- payments

/** A scheduled payment. Releases happen at Passport; this is the instruction and its status. */
model PaymentTranche {
  id: PrefixedId;
  awardId: PrefixedId;
  seq: int32;
  amountMinor: int64;
  currency: string;

  /** `{ type: onExecution | onReportAccepted | onDate | manual, requirementId?, date? }` */
  condition: Record<unknown>;

  status: TrancheStatus;
  dueAt: utcDateTime | null;
  holdReason: string | null;
  mode: "facilitated" | "resolve" | null;
  passportDisbursementId: string | null;

  /** Passport's disbursement status, or `refused` / `unverified` when Passport holds no settled record */
  passportStatus: string | null;

  releasedAt: utcDateTime | null;
  releasedBy: string | null;

  /** Resolve mode: reference, paidAt and last four digits of what the funder paid elsewhere */
  external: Record<unknown> | null;
}

model PaymentSchedule {
  awardId: PrefixedId;
  currency: string;
  awardedAmountMinor: int64 | null;

  /** Read back from Passport; null until Passport has reported one. Never computed in the GMS. */
  disbursedAmountMinor: int64 | null;

  disbursedAsOf: utcDateTime | null;
  tranches: PaymentTranche[];
}

model ScheduleLine {
  /** Give `amountMinor` or `percent` (of what remains of the award), not both */
  amountMinor?: int64;

  percent?: float64;
  condition: Record<unknown>;
}

model PaymentScheduleInput {
  tranches: ScheduleLine[];
}

model TrancheListItem {
  ...PaymentTranche;
  award: {
    id: PrefixedId;
    title: string;
    status: string;
  } | null;
  recipient: {
    workspaceId: CommonGrants.Types.uuid;
    name: string;
    handle: string;
    verificationLevel: string | null;
    pendingDestinationChange: boolean;
  } | null;
}

/** Why a payment is blocked: what, why, and what clears it. */
model PaymentBanner {
  cause: string;
  tone: "warn" | "danger" | "neutral";
  title: string;
  detail: string;
  clears: string;
}

/** Display facts of the destination Passport would pay. Never more than these. */
model PaymentDestination {
  bankName: string | null;
  last4: string | null;
  status: string;
}

model PaymentReadinessCheck {
  ...ReadinessCheck;

  /** A pass that still deserves attention */
  warning?: boolean;
}

/** The seven readiness checks for one tranche, evaluated live. */
model TrancheReadiness {
  /** `facilitated`: released through Passport. `resolve`: this server records payments after they are paid outside the GMS. */
  mode?: "facilitated" | "resolve";

  /** Plain words for `resolve` mode; null otherwise */
  modeNote?: string | null;

  checks: PaymentReadinessCheck[];
  passed: int32;
  failed: int32;
  `unknown`: int32;
  total: int32;

  /** True only when every line passes */
  releasable: boolean;

  text: string;
  banner: PaymentBanner | null;
  destination: PaymentDestination | null;
}

model TrancheReadinessView {
  ...TrancheReadiness;
  tranche: PaymentTranche;
}

model ReleaseInput {
  /** A person confirms that a same-amount payment within 24 hours is intended */
  confirmDuplicate?: boolean;

  rail?: "auto" | "standard" | "instant";
}

model ReleaseResult {
  /** `accepted`, `refused` (no money moved) or `unconfirmed` (Passport did not answer; repeat safely) */
  result: "accepted" | "refused" | "unconfirmed";

  tranche: PaymentTranche;
  replayed?: boolean;
  code?: string;
  message?: string;
}

model ExternalPaymentInput {
  reference: string;
  paidAt: string;

  /** The last four digits of the account that was paid. Never more. */
  @pattern("^[0-9]{4}$")
  destinationLast4: string;

  bankTransactionId?: string;
}

model ExternalPaymentResult {
  /** `unverified`: recorded here, but Passport could not verify it against the grantee's destination */
  result: "recorded" | "unverified";

  tranche: PaymentTranche;
  code?: string;
  message?: string;
}

model PaymentsCenter {
  items: {
    ...TrancheReadiness;
    tranche: PaymentTranche;
    award: {
      id: PrefixedId;
      title: string;
    };
  }[];
  totals: {
    dueMinor: int64;
    releasable: int32;
    blocked: int32;
  };
}

model PaymentAlertView {
  kind: string;
  tone: "warn" | "danger" | "neutral";
  title: string;
  detail: string;
  trancheId?: PrefixedId;
  awardId?: PrefixedId;
  recipientWorkspaceId?: CommonGrants.Types.uuid;
}

/** An outbound bank transaction read for reconciliation. No account identifier is kept. */
model BankTransactionView {
  id: CommonGrants.Types.uuid;
  provider: string;
  amountMinor: int64;
  currency: string;
  postedAt: utcDateTime;
  counterpartyName: string | null;
  memo: string | null;
  matchedTrancheId: PrefixedId | null;
  matchedAt: utcDateTime | null;
  proposals?: {
    trancheId: PrefixedId;
    score: float64;
    amountDeltaMinor: int64;
    ambiguous: boolean;
  }[];
}

model BankMatchInput {
  trancheId: PrefixedId;

  @pattern("^[0-9]{4}$")
  destinationLast4: string;
}

model BankMatchResult {
  ...ExternalPaymentResult;
  transaction: BankTransactionView;
}

// ---------------------------------------------------------------------------- requirements

model RequirementView {
  id: PrefixedId;
  awardId: PrefixedId;
  type: "report" | "document" | "milestone" | "site_visit" | "acknowledgment";
  title: string;
  formId: PrefixedId | null;
  formVersion: int32 | null;
  dueAt: utcDateTime | null;
  graceDays: int32;

  /** Days relative to the due date on which a reminder goes out */
  reminderPlan: unknown;

  status: RequirementStatus;
  releasesTrancheId: PrefixedId | null;
  submissionId: PrefixedId | null;
  submissionStatus: string | null;
  award?: {
    id: PrefixedId;
    title: string;
  } | null;
  recipient?: Record<unknown> | null;
  funder?: Record<unknown> | null;
}

model RequirementCreate {
  type: "report" | "document" | "milestone" | "site_visit" | "acknowledgment";
  title: string;
  formId?: string;
  formVersion?: int32;
  dueAt?: string;
  graceDays?: int32;
  reminderPlan?: int32[];
  releasesTrancheId?: string;
}

model SubmissionFormResponse {
  formId: PrefixedId;
  formVersion: int32;
  response: Record<unknown>;
  status: string;
  validationErrors: unknown;

  /** Field path → where the value came from: passport, prior_submission, user, agent:<client> */
  provenance: Record<unknown>;

  lockedAt: utcDateTime | null;
}

model SubmissionView {
  id: PrefixedId;
  requirementId: PrefixedId | null;
  awardId: PrefixedId | null;
  status: SubmissionStatus;
  submittedAt: utcDateTime | null;
  reviewNote: string | null;

  /** True for a report a grantee shared with this funder by consent */
  shared: boolean;

  sharedFromSubmissionId: PrefixedId | null;
  sharedFields: unknown;
  requirement: {
    title: string;
    type: string;
    dueAt: utcDateTime | null;
    status: string;
  } | null;
  formResponses: SubmissionFormResponse[];
  requirementStatus?: string;

  /** The tranche that became due when this report was accepted */
  trancheDue?: PrefixedId | null;
}

model SubmissionFormInput {
  response: Record<unknown>;
}

model SubmissionFormSaved {
  ...SubmissionFormResponse;

  /** Fields that follow Passport and were not changed */
  rejected: string[];
}

model ShareSubmissionInput {
  funderWorkspaceId?: CommonGrants.Types.uuid;
  funderHandle?: string;

  /** Top-level field names to share; all when omitted */
  fields?: string[];

  note?: string;
}

model ShareSubmissionResult {
  sharedSubmissionId: PrefixedId;
  funder: {
    workspaceId: CommonGrants.Types.uuid;
    name: string;
    handle: string;
  };
  fields: unknown;
}

model ReminderSent {
  sent: boolean;
  messageId: string;
}

// ---------------------------------------------------------------------------- budgets

model BudgetLineView {
  category: string;
  label: string;
  amountMinor: int64;
  notes?: string;
}

model BudgetView {
  id: CommonGrants.Types.uuid;
  kind: "proposed" | "approved" | "actual";
  currency: string;
  categories: unknown;
  lines: BudgetLineView[];
  totalMinor: int64;
  source: string;
  periodStart: plainDate | null;
  periodEnd: plainDate | null;
  updatedAt: utcDateTime;
}

model BudgetBook {
  awardId: PrefixedId;
  currency: string;
  awardedAmountMinor: int64 | null;
  proposed: BudgetView | null;
  approved: BudgetView | null;
  actuals: BudgetView[];
}

model BudgetPut {
  /** The funder sets `approved`; the grantee reports `actual` for a period */
  kind: "approved" | "actual";

  lines: BudgetLineView[];
  periodStart?: plainDate;
  periodEnd?: plainDate;
}

model BudgetVariance {
  /** The grantee's category mapping the comparison used */
  mapping?: BudgetCategoryMapping[];

  /** The grantee's categories that match no funder category and are not mapped yet */
  unmappedCategories?: string[];

  awardId: PrefixedId;
  currency: string;
  hasApprovedBudget: boolean;
  periods: {
    periodStart: plainDate | null;
    periodEnd: plainDate | null;
    totalMinor: int64;
  }[];
  categories: {
    category: string;
    approvedMinor: int64;
    actualMinor: int64;
    varianceMinor: int64;
    percentSpent: float64 | null;
    over: boolean;
  }[];
  totals: {
    approvedMinor: int64;
    actualMinor: int64;
    varianceMinor: int64;
    over: boolean;
  };
}

// ---------------------------------------------------------------------------- grantees

model GranteeSummary {
  workspaceId: CommonGrants.Types.uuid;
  handle: string;
  name: string;
  legalName: string | null;
  passportOrgId: string | null;
  verificationLevel: string | null;
  verification: Verification;
  payee: {
    pendingDestinationChange: boolean;
    active: boolean;
  };
  tags: string[];
  ownerUserId: string | null;
  applications: int32;
  awards: int32;
  pendingChanges: int32;
}

model OrgChangeView {
  id: CommonGrants.Types.uuid;
  passportOrgId: string;
  changeId: string;
  patch: unknown;
  status: "pending" | "accepted" | "dismissed";
  receivedAt: utcDateTime;
  decidedAt: utcDateTime | null;
  decidedBy: string | null;
  grantee?: Record<unknown> | null;
}

model GranteeDetail {
  ...GranteeSummary;
  notes: string | null;
  lastSyncedAt: utcDateTime | null;

  /** The cached OrganizationBase from Passport, when the organization consented; null otherwise and for an organization without Passport */
  organization: Record<unknown> | null;

  /** What an organization without Passport entered itself, when it consented. Not verified. */
  selfDeclared: SelfDeclaredProfile | null;

  consent: boolean;

  /** Bank name and last four digits only */
  payeeStatus: Record<unknown>;

  applicationList: Record<unknown>[];
  awardList: Record<unknown>[];
  orgChanges: OrgChangeView[];
}

model GranteePatch {
  tags?: string[];
  notes?: string | null;
  ownerUserId?: CommonGrants.Types.uuid | null;
}

model ProposeChangeInput {
  /** A merge patch of OrganizationBase fields. Bank and identity details are refused. */
  patch: Record<unknown>;

  note?: string;
}

model ProposeChangeResult {
  status: "pending";
  changeId: string | null;
  location: string | null;
  message: string;
}

// ---------------------------------------------------------------------------- analytics

model PortfolioView {
  asOf: utcDateTime;

  /** When the paid figures were last read back from Passport */
  paidAsOf: utcDateTime | null;

  totals: {
    budgetMinor: int64;
    committedMinor: int64;
    paidMinor: int64;
    awards: int32;
  };
  programs: {
    programId: string | null;
    name: string;
    currency: string;
    budgetMinor: int64 | null;
    committedMinor: int64;
    paidMinor: int64;
    committedNotPaidMinor: int64;
    awards: int32;
    overBudgetMinor: int64;
  }[];
  applications: Record<unknown>;
  reporting: Record<unknown>;
  payments: Record<unknown>;
}

model CycleReport {
  competitionId: PrefixedId;
  title: string;
  status: string;
  started: int32;
  submitted: int32;
  submitRate: float64 | null;
  stages: {
    key: string;
    label: string;
    applications: int32;
  }[];
  byStatus: Record<int32>;
  eligibility: Record<int32>;
  byLevel: Record<int32>;
  reviews: Record<int32>;
  decisions: Record<int32>;
  requestedMinor: int64;
  awardedMinor: int64;
  medianDaysToDecision: float64 | null;
}

model GrantList990 {
  year: int32;
  items: {
    awardId: PrefixedId;
    recipientName: string;
    recipientAddress: string | null;
    relationship: string;
    foundationStatus: string;
    purpose: string;
    currency: string;
    awardedMinor: int64;

    /** Passport's disbursed amount as last read back */
    paidMinor: int64;

    approvedForFuturePaymentMinor: int64;
    paidAsOf: utcDateTime | null;
  }[];
  totals: {
    paidMinor: int64;
    approvedForFuturePaymentMinor: int64;
  };
}

model BundleExport {
  /** Key prefix in the exports bucket; null when no bucket is configured */
  prefix: string | null;

  written: boolean;
  files: string[];
  counts: Record<int32>;

  /** The files themselves, when requested inline or when there is no bucket */
  bundle?: Record<unknown>;
}

model CsvImportInput {
  csv: string;

  /** Which CSV column feeds each field: recipientName, recipientEin, title, awardedAmount, awardDate, startDate, endDate, status, programName */
  mapping: Record<string>;

  dryRun?: boolean;
}

model CsvImportResult {
  dryRun: boolean;
  rows: int32;
  created: int32;
  failed: int32;
  unmatchedRecipients: int32;
  results: {
    row: int32;
    ok: boolean;
    awardId?: PrefixedId;
    matchedRecipient?: boolean;
    error?: string;
  }[];
}

// ---------------------------------------------------------------------------- integrations

model WebhookView {
  id: CommonGrants.Types.uuid;
  url: string;
  events: string[];
  active: boolean;
}

model WebhookCreated {
  ...WebhookView;

  /** The signing secret, shown once */
  secret: string;
}

model WebhookCreate {
  url: string;
  events?: string[];
}

model WebhookDeliveryView {
  id: string;
  eventId: string;
  eventType: string;
  status: string;
  attempts: int32;
  lastStatusCode: int32 | null;
  lastError: string | null;
  nextAttemptAt: utcDateTime | null;
  deliveredAt: utcDateTime | null;
  createdAt: utcDateTime;
}

model ApiClientView {
  id: CommonGrants.Types.uuid;
  name: string;
  scopes: string[];
  createdAt: utcDateTime;
  lastUsedAt: utcDateTime | null;
  revokedAt: utcDateTime | null;
}

model ApiClientIssued {
  ...ApiClientView;
  clientId: string;

  /** Shown once; only its hash is stored */
  clientSecret: string;
}

model ApiClientCreate {
  name: string;
  scopes: string[];
}

model McpConnectionView {
  id: CommonGrants.Types.uuid;
  clientId: string;
  clientName: string | null;
  clientUri: string | null;
  userId: string;

  /** True when the caller connected this agent */
  mine: boolean;

  scopes: string[];
  lastUsedAt: utcDateTime | null;
  revokedAt: utcDateTime | null;
  createdAt: utcDateTime;
}

model McpServerView {
  id: CommonGrants.Types.uuid;
  name: string;
  url: string;
  hasAuth: boolean;
  allowedTools: string[];

  /** Always true in v1: only tools the server marks read-only can be allowed */
  readOnly: boolean;

  createdAt: utcDateTime;
}

model RemoteToolView {
  name: string;
  description: string | null;
  readOnly: boolean;
  allowed?: boolean;
}

model McpServerRegistered {
  ...McpServerView;
  tools: RemoteToolView[];
}

model McpServerCreate {
  name: string;
  url: string;

  /** Sent as the Authorization header to the server; stored encrypted and never returned */
  authHeader?: string;

  allowedTools?: string[];
}

model McpServerPatch {
  allowedTools: string[];
}

model ConnectorView {
  provider: "mercury" | "google_workspace";
  connected: boolean;
  status: string;
  scopes: string[];
  lastSyncAt: utcDateTime | null;
  connectUrl?: string | null;
  fetched?: int32;
  added?: int32;
}

model ConnectorConnect {
  /** Mercury: a read-only API token. Stored encrypted; used only to list outbound transactions. */
  token?: string;
}

model DirectoryPersonView {
  email: string;
  name: string | null;
}

model DeletedResult {
  deleted: boolean;
}
