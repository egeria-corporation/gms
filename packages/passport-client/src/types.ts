// SPDX-License-Identifier: AGPL-3.0-only
// Wire types for the Passport routes the GMS calls. They follow Passport as deployed (Stripe Connect,
// 2026-11): see docs/payments.md for where this differs from the GMS build prompt.
/** Passport assurance level. Structurally the same union as `PassportLevel` in `@gms/workflow`. */
export type PassportLevel = "L0" | "L1" | "L2" | "L3";

/** CommonGrants `Money`: a decimal string and an ISO 4217 code. */
export interface Money {
  amount: string;
  currency: string;
}

export interface Envelope<T> {
  status: number;
  message: string;
  data: T;
}

export interface PaginatedEnvelope<T> {
  status: number;
  message: string;
  items: T[];
  paginationInfo: { page: number; pageSize: number; totalItems: number; totalPages: number };
}

/** Destination display data. Passport exposes the bank name and last four digits only. */
export interface PayoutDestination {
  provider: "stripe";
  token: string;
  tokensByRail: Record<string, string>;
  bankName: string;
  last4: string;
  holderType: string;
  holderNameMatch: string;
  holderNameMatchedTo?: string;
  validations: { provider: string; method: string; status?: string; verificationMethod?: string; at: string }[];
  verifiedAt: string;
  status: "active";
}

export interface PendingDestinationChange {
  destinationId: string;
  /** `pending` | `awaiting_confirmation` | `cooling_off` | `held`. */
  state: string;
  bankName: string;
  last4: string;
  requestedAt: string;
  coolingOffUntil: string | null;
}

export interface PayeeCredential {
  id: string;
  version: number;
  organization: { id: string; name: string; identifiers: Record<string, { registry: { code: string; url?: string }; id: string }> };
  level: PassportLevel;
  /** `null` when the organization has no active destination. */
  payoutDestination: PayoutDestination | null;
  changeControl: {
    pendingChange: PendingDestinationChange | null;
    freezeUntil: string | null;
    lastChangedAt: string | null;
  };
  warranty: { cap: Money; termsUrl: string };
  attestation: string;
  issuedAt: string;
}

/** A funder's funding bank at Passport (an ACH debit source on its Stripe Customer). */
export interface FunderSource {
  id: string;
  orgId: string;
  provider: "stripe";
  status: "pending" | "verified" | "failed" | "disabled";
  statusReason: string | null;
  bankName: string;
  last4: string | null;
  canDebit: boolean;
  verifiedAt: string | null;
  createdAt: string;
}

export type PassportRail = "auto" | "standard" | "instant";
export type PassportDisbursementStatus = "pending" | "validated" | "initiated" | "settled" | "failed" | "returned" | "held";
export type DisbursementMode = "facilitated" | "resolve";

export interface ExternalPayment {
  reference: string;
  paidAt: string;
  destinationLast4: string;
}

export interface CreateDisbursementRequest {
  awardId: string;
  recipientOrgId: string;
  credentialId: string;
  credentialVersion: number;
  amount: Money;
  rail?: PassportRail;
  mode: DisbursementMode;
  memo?: string;
  feePaidBy?: "source";
  external?: ExternalPayment;
}

export interface Disbursement {
  id: string;
  awardId: string;
  funderOrgId: string;
  recipientOrgId: string;
  credentialId: string;
  credentialVersion: number;
  destinationId: string | null;
  amount: Money;
  requestedRail: PassportRail;
  rail: "standard" | "instant" | null;
  mode: DisbursementMode;
  status: PassportDisbursementStatus;
  statusReason?: string;
  memo?: string;
  fee: Money | null;
  external?: ExternalPayment;
  warrantyEligible: boolean;
  checks: { id: string; passed: boolean; at: string; detail?: string }[];
  timeline: { status: PassportDisbursementStatus; at: string; reason?: string }[];
  createdAt: string;
  lastModifiedAt: string;
}

/** The parts of a CommonGrants `OrganizationBase` the GMS reads. Everything else passes through. */
export interface CgOrganization {
  id: string;
  name: string;
  customFields?: Record<string, { name?: string; fieldType?: string; value: unknown }>;
  [key: string]: unknown;
}

export interface CgOrgChange {
  id: string;
  status?: string;
  [key: string]: unknown;
}

export const GMS_AWARD_REGISTRY = "org:opengrants:gms";

/** The parts of a CommonGrants `AwardBase` the GMS reads. */
export interface CgAward {
  id: string;
  title?: string;
  status?: { value: string; customValue?: string };
  funding?: { requestedAmount?: Money; awardedAmount?: Money; disbursedAmount?: Money };
  /** `systemId` is Passport's own id; the id the GMS sent comes back under `otherIds["org:opengrants:gms"]`. */
  identifiers?: { systemId?: { registry?: { code?: string }; id?: string }; otherIds?: Record<string, { id?: string } | undefined> };
  [key: string]: unknown;
}

/** The GMS award id (`awd_…`) Passport holds for a mirrored award, or null. */
export const gmsAwardIdOf = (award: Pick<CgAward, "identifiers">): string | null => award.identifiers?.otherIds?.[GMS_AWARD_REGISTRY]?.id ?? null;

/** Body of `POST /passport/funders/{orgId}/awards`: a CommonGrants `AwardBase` without `disbursedAmount`. */
export interface FunderAwardInput {
  title: string;
  description?: string | null;
  status?: { value: "awarded" | "completed" | "cancelled" | "custom"; customValue?: string };
  funding: { awardedAmount: Money; requestedAmount?: Money };
  /** By Passport org id or by EIN; an organization that is not on Passport is refused. */
  recipientOrganizations: { primary: { id: string } | { identifiers: { "org:us:ein": { id: string } } } };
  keyDates?: { awardDate?: { date: string }; periodOfPerformance?: { startDate?: string; endDate?: string } };
  parent?: { id: string };
  /** HTTPS URL of the award in the GMS. */
  source?: string;
  identifiers?: { systemId: { registry: { code: string }; id: string } };
}

export const PASSPORT_EVENTS = [
  "payee.destination.change_pending",
  "payee.destination.changed",
  "payee.level.changed",
  "payee.organization.inactive",
  "disbursement.status.changed",
  /** A funder award changed at Passport (amount, period, status): re-read it. */
  "award.updated",
] as const;
export type PassportEventType = (typeof PASSPORT_EVENTS)[number];

export interface PassportEvent<T = unknown> {
  id: string;
  type: PassportEventType;
  /** The organization the event is about (the payee for payee and disbursement events). */
  orgId: string;
  occurredAt: string;
  data: T;
}

export interface DisbursementStatusChangedData {
  disbursementId: string;
  awardId: string;
  funderOrgId: string;
  recipientOrgId: string;
  status: PassportDisbursementStatus;
  previousStatus: PassportDisbursementStatus | null;
  reason: string | null;
  amount: Money;
  fee: Money | null;
  rail: "standard" | "instant" | null;
  mode: DisbursementMode;
}

export interface AwardUpdatedData {
  awardId: string;
  funderOrgId?: string;
}

export interface DestinationChangePendingData {
  orgId: string;
  handle: string | null;
  destinationId: string;
  state: string;
  bankName: string | null;
  last4: string | null;
  requestedAt: string;
}

export interface DestinationChangedData {
  orgId: string;
  handle: string | null;
  destinationId: string;
  previousDestinationId: string | null;
  bankName: string | null;
  last4: string | null;
}

export interface LevelChangedData {
  orgId: string;
  handle: string | null;
  from: PassportLevel;
  to: PassportLevel;
  reason: string;
}

export interface OrganizationInactiveData {
  orgId: string;
  handle: string | null;
  reason: string[];
}

export interface WebhookSubscription {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
  /** Shown once, at creation. Store it encrypted (see `encryptSecret`). */
  secret: string;
}

/** A reference to a document in an organization's Passport locker: display metadata, never bytes. */
/**
 * A representative Passport has verified (officer match plus a verified channel; `L3` when the
 * control officer also passed identity verification). Shared with consented clients so a relying
 * app can check who may sign for the organization. No contact details.
 */
export interface VerifiedRepresentative {
  id: string;
  /** Name as verified against the officer evidence. */
  fullName: string;
  title: string;
  role: string;
  isControlOfficer: boolean;
  matchedTo: string | null;
  verificationLevel: "L2" | "L3";
  verifiedAt: string;
  identityVerifiedAt: string | null;
}

export interface LockerDocument {
  id: string;
  kind: string;
  name: string | null;
  mimeType: string | null;
  /** Lowercase hex; null when Passport only references the file (for example in the org's Drive). */
  sha256: string | null;
  source: string;
  uploadedAt: string;
  expiresAt: string | null;
  lastModifiedAt: string;
}
