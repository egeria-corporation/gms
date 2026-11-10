// SPDX-License-Identifier: AGPL-3.0-only
import type { TrancheStatus, VerificationLevel } from "@gms/workflow";

export type TrancheCondition =
  | { type: "onExecution" }
  | { type: "onReportAccepted"; requirementId: string }
  | { type: "onDate"; date: string }
  | { type: "manual" };

export type TrancheMode = "facilitated" | "resolve";

/** What a funder recorded about a payment made outside Passport. Bank display data is the last four digits only. */
export interface ExternalPaymentRecord {
  reference: string;
  paidAt: string;
  last4: string;
}

/** The `tranches` row as the payments package reads it (amounts in integer minor units). */
export interface Tranche {
  id: string;
  awardId: string;
  seq: number;
  amountMinor: number;
  currency: string;
  condition: TrancheCondition;
  status: TrancheStatus;
  dueAt: string | null;
  mode: TrancheMode | null;
  passportDisbursementId: string | null;
  /** Passport's disbursement status, or `refused` / `unverified` when Passport holds no settled record. */
  passportStatus: string | null;
  holdReason: HoldReason | string | null;
  idempotencyKey: string;
  releasedBy: string | null;
  releasedAt: string | null;
  external: ExternalPaymentRecord | null;
}

export type TranchePatch = Partial<Omit<Tranche, "id" | "awardId" | "seq" | "amountMinor" | "currency" | "condition" | "idempotencyKey">>;

/**
 * A change to one tranche. `path` lists every status the tranche passes through, in order, so the
 * workflow package can run each transition (guard → write → ledger → webhook). The payments package
 * never writes a status column itself.
 */
export interface TrancheUpdate {
  trancheId: string;
  path: TrancheStatus[];
  patch: TranchePatch;
  reason?: string;
}

export const HOLD_REASONS = ["pending_destination_change", "freeze_window", "level_below_l3", "agreement_not_executed", "passport_unavailable", "organization_inactive", "credential_version_stale", "manual"] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

export interface AwardForPayments {
  id: string;
  title: string;
  recipientOrgId: string;
  /** Passport's id for the mirrored award; null until the mirror exists. */
  passportAwardId: string | null;
  /** Award conditions; `noAgreementRequired` waives the executed-agreement check. */
  conditions: string[];
  verificationLevelAtSubmit: VerificationLevel | null;
}
