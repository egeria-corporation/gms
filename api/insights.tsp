import "@typespec/http";
import "@common-grants/core";
import "./models.tsp";

// Read models behind the workspace screens: rollups, panel detail, award activity and closeout,
// upcoming payments, breakdowns, who-has-access, interviews and funding alerts. Amounts are
// integer minor units; nothing here carries bank or identity data.

namespace GMS.Models;

model DocumentRef {
  id: string;
  name: string;
  mime: string;
  size: int64;
  sha256: string;

  /** `passport_locker` when the file is referenced in the organization's Passport locker, else where the GMS stores it */
  source: string;

  passportDocumentId: string | null;
  scanStatus: string;
  uploadedAt: utcDateTime;
}

model ApplicationBudgetView {
  applicationId: PrefixedId;
  requestedAmountMinor: int64 | null;
  currency: string;

  /** The proposed budget: `{ currency, categories, lines[{ category, label, amountMinor, notes }], totalMinor }`, or null */
  budget: Record<unknown> | null;

  documents: DocumentRef[];
}

model InterviewState {
  /** `{ slots[], note, location, at }` once the funder has offered times */
  proposed: Record<unknown> | null;

  /** `{ slot, at }` once the applicant has confirmed one */
  confirmed: Record<unknown> | null;
}

model InterviewProposal {
  slots: utcDateTime[];
  note?: string;
  location?: string;
}

model InterviewConfirmation {
  slot: utcDateTime;
}

model ApplicationFollowUps {
  applicationId: PrefixedId;

  /** `{ id, message, fields[], dueAt, requestedAt, answeredAt }` per revision request */
  revisionRequests: Record<unknown>[];

  interview: InterviewState;

  /** Shown once committed: `{ outcome, decidedAt, amountMinor, currency, conditions[], awardId }`; `rationale` on the funder side only */
  decision: Record<unknown> | null;
}

model ProgramRollup {
  programId: string;
  budgetMinor: int64 | null;
  currency: string;
  committedMinor: int64;

  /** Passport's disbursed amounts as last read back, summed */
  paidMinor: int64;

  remainingMinor: int64 | null;

  /** Award status → `{ count, awardedMinor }` */
  committedByStatus: Record<unknown>;

  awards: int32;
  opportunities: int32;
  ownerUserId: string | null;
}

model ReviewerLoad {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  external: boolean;
  expertiseTags: string[];
  capacity: int32 | null;
  assigned: int32;
  submitted: int32;
  recused: int32;
  expiresAt: utcDateTime | null;
}

model ReviewerPool {
  competitionId: PrefixedId;
  reviewers: ReviewerLoad[];
}

model PanelSummary {
  competitionId: PrefixedId;
  stage: string;

  /** `{ key, label, weight }` per rubric criterion */
  criteria: Record<unknown>[];

  /** `{ applicationId, criteria: { <key>: mean 0–100 | null } }` per application */
  items: Record<unknown>[];

  /** `{ approve, decline, waitlist, defer, undecided, committed, proposedMinor }` */
  decisions: Record<unknown>;
}

model NoteInput {
  body: string;
}

model Note {
  id: string;
  body: string;
  author?: string;
  authorUserId: string | null;
  own?: boolean;
  at: utcDateTime;
}

model ActivityEntry {
  eventType: string;

  /** The event in words, e.g. "Tranche held" */
  label: string;

  actor: string;
  subjectType: string;
  subjectId: string;
  at: utcDateTime | null;
  data: Record<unknown>;
}

model SignatureRecord {
  agreementId: PrefixedId;
  version: int32;
  party: "grantee" | "funder";
  name: string | null;
  userId: string | null;
  ip: string | null;
  at: utcDateTime | null;
  documentSha256: string | null;
}

model CloseoutCheck {
  key: string;
  label: string;
  state: "pass" | "fail" | "unknown";
  reason: string;
}

model AwardCloseout {
  awardId: PrefixedId;
  status: string;
  awardedMinor: int64;

  /** Read back from Passport; never computed in the GMS */
  disbursedMinor: int64;

  disbursedAsOf: utcDateTime | null;
  checks: CloseoutCheck[];
  ready: boolean;
}

model AwardDocument {
  kind: "agreement" | "file";
  id: string;
  name: string;
  status: string;
  sha256: string | null;
  at: utcDateTime;
  href: string | null;
}

model UpcomingPayments {
  days: int32;
  totalMinor: int64;

  /** `{ trancheId, awardId, awardTitle, recipient, seq, amountMinor, currency, status, dueAt, holdReason }` */
  items: Record<unknown>[];
}

model GranteeReport {
  requirementId: PrefixedId;
  awardId: PrefixedId;
  awardTitle: string | null;
  title: string;
  type: string;
  status: string;
  dueAt: utcDateTime | null;
  submissionId: PrefixedId | null;
  submittedAt: utcDateTime | null;
}

model Breakdowns {
  /** `{ key, awards, awardedMinor }` by the recipient's state, from records shared by applying; "Not shared" otherwise */
  awardsByRegion: Record<unknown>[];

  /** `{ basis, byTaxStatus[], byBudgetBand[] }`: only what organizations shared through Passport */
  equity: Record<unknown>;

  /** `{ userId, name, assigned, submitted, recused }` */
  reviewerLoad: Record<unknown>[];
}

model BulkSendRequest {
  templateId: string;

  /** The same filters as `GET /gms/applications`, including `view` */
  view: Record<unknown>;

  subjectOverride?: string;
  fields?: Record<unknown>;

  /** Report who would receive it; send nothing */
  dryRun?: boolean;
}

model TemplateUsage {
  templateId: string;
  sent: int32;
  lastUsedAt: utcDateTime | null;
  channel: string;
}

model ApprovalPreview {
  approval: Record<unknown>;
  affected: int32;

  /** For a decline: `{ applicationId, title, applicant, hasRecipientEmail, subject, html, text }` per application */
  letters: Record<unknown>[];
}

model AccessOverview {
  /** `{ consentId, funder, basis, scopes[], grantedAt, sees }` */
  funders: Record<unknown>[];

  /** `{ id, clientId, userId, connectedBy, scopes[], lastUsedAt, connectedAt }` */
  agents: Record<unknown>[];

  /** `{ userId, name, email (admins only), role, expiresAt, mfaEnrolled }` */
  team: Record<unknown>[];
}

model FunderRelationship {
  workspaceId: string;
  name: string;
  handle: string;
  brand: Record<unknown>;
  applications: int32;
  awards: int32;

  /** `{ kind, label, applicationId?, awardId?, requirementId?, dueAt? }` */
  openItems: Record<unknown>[];

  /** `{ kind, name, awardId, agreementId, sha256, at }` */
  documents: Record<unknown>[];

  /** The funder's public contact: `{ email, website, page }` */
  contact: Record<unknown>;
}

model FundingAlertInput {
  name: string;
  query?: string;
  filters?: Record<unknown>;
  frequency?: "daily" | "weekly";
}

model FundingAlert {
  id: string;
  name: string;
  query: string | null;
  filters: Record<unknown>;
  frequency: string;
  createdAt: utcDateTime;
}
