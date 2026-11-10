// SPDX-License-Identifier: AGPL-3.0-only
// Passport webhook events as pure functions: each takes the event data and the affected tranches,
// and returns what to change. The caller (apps/api → queue → apps/jobs) verifies and dedupes the
// delivery, then applies the updates through the tranche state machine.
import type { DestinationChangePendingData, DestinationChangedData, DisbursementStatusChangedData, LevelChangedData, OrganizationInactiveData, PassportLevel } from "@gms/passport-client";
import type { TrancheStatus } from "@gms/workflow";
import { isStale, pathTo, trancheStatusFor } from "./status.ts";
import type { HoldReason, Tranche, TrancheUpdate } from "./types.ts";

/** Recipient facts the GMS caches from Passport events (`grantee_records` / workspace projection). */
export interface RecipientPatch {
  orgId: string;
  pendingDestinationChange?: { destinationId: string; bankName: string | null; last4: string | null; requestedAt: string } | null;
  verificationLevel?: PassportLevel;
  active?: boolean;
}

export interface EventEffects {
  trancheUpdates: TrancheUpdate[];
  recipient: RecipientPatch | null;
  /** Re-read `GET /common-grants/awards/{id}` and cache `disbursedAmount` for these Passport award ids. */
  refreshAwards: string[];
  /** Re-resolve the payee credential for these organizations. */
  refreshCredentials: string[];
  /** Alerts for Payments center. */
  alerts: { kind: "destination_change_pending" | "level_below_l3" | "organization_inactive" | "payment_failed" | "payment_returned"; orgId: string; trancheId?: string; message: string }[];
  /** Outbound GMS webhook events to relay. */
  relay: { type: "disbursement.status.changed" | "tranche.status.changed"; trancheId: string }[];
}

const none = (): EventEffects => ({ trancheUpdates: [], recipient: null, refreshAwards: [], refreshCredentials: [], alerts: [], relay: [] });

const HOLDABLE: TrancheStatus[] = ["due", "ready"];

function hold(tranches: readonly Tranche[], reason: HoldReason, only: TrancheStatus[] = HOLDABLE): TrancheUpdate[] {
  return tranches.filter((t) => only.includes(t.status)).map((t) => ({ trancheId: t.id, path: ["held"], patch: { status: "held", holdReason: reason }, reason }));
}

function unhold(tranches: readonly Tranche[], reason: HoldReason): TrancheUpdate[] {
  return tranches.filter((t) => t.status === "held" && t.holdReason === reason && !t.passportDisbursementId).map((t) => ({ trancheId: t.id, path: ["due"], patch: { status: "due", holdReason: null }, reason: `${reason}:cleared` }));
}

/** `tranche` is the tranche whose `passport_disbursement_id` equals `data.disbursementId` (null when unknown). */
export function onDisbursementStatusChanged(data: DisbursementStatusChangedData, tranche: Tranche | null): EventEffects {
  const fx = none();
  // The disbursed amount is Passport's to state: refresh the cache on every change, known tranche or not.
  fx.refreshAwards.push(data.awardId);
  if (!tranche) return fx;
  const target = trancheStatusFor(data.status);
  if (isStale(tranche.status, target)) {
    if (tranche.passportStatus !== data.status && tranche.status === target) fx.trancheUpdates.push({ trancheId: tranche.id, path: [], patch: { passportStatus: data.status } });
    return fx;
  }
  const path = pathTo(tranche.status, target);
  const final = path[path.length - 1] ?? tranche.status;
  fx.trancheUpdates.push({
    trancheId: tranche.id,
    path,
    patch: { status: final, passportStatus: data.status, holdReason: final === "held" ? (data.reason ?? "pending_destination_change") : null },
    ...(data.reason ? { reason: data.reason } : {}),
  });
  fx.relay.push({ type: "disbursement.status.changed", trancheId: tranche.id }, { type: "tranche.status.changed", trancheId: tranche.id });
  if (data.status === "failed") fx.alerts.push({ kind: "payment_failed", orgId: data.recipientOrgId, trancheId: tranche.id, message: `Payment failed${data.reason ? ` (${data.reason})` : ""}. Passport does not retry on its own.` });
  if (data.status === "returned") fx.alerts.push({ kind: "payment_returned", orgId: data.recipientOrgId, trancheId: tranche.id, message: `Payment was returned by the bank${data.reason ? ` (${data.reason})` : ""}.` });
  return fx;
}

/** A destination change started: show the banner and block release for that recipient. */
export function onDestinationChangePending(data: DestinationChangePendingData, recipientTranches: readonly Tranche[]): EventEffects {
  const fx = none();
  fx.recipient = { orgId: data.orgId, pendingDestinationChange: { destinationId: data.destinationId, bankName: data.bankName, last4: data.last4, requestedAt: data.requestedAt } };
  // `due` tranches stay due (readiness fails while the change is pending); `ready` ones are no longer ready.
  fx.trancheUpdates = hold(recipientTranches, "pending_destination_change", ["ready"]);
  fx.refreshCredentials.push(data.orgId);
  fx.alerts.push({ kind: "destination_change_pending", orgId: data.orgId, message: "A payout destination change is pending at Passport. Payments to this grantee are blocked until it takes effect." });
  return fx;
}

/** The change took effect: clear the banner, refresh the credential, lift the holds it caused. */
export function onDestinationChanged(data: DestinationChangedData, recipientTranches: readonly Tranche[]): EventEffects {
  const fx = none();
  fx.recipient = { orgId: data.orgId, pendingDestinationChange: null };
  fx.trancheUpdates = unhold(recipientTranches, "pending_destination_change");
  fx.refreshCredentials.push(data.orgId);
  return fx;
}

export function onLevelChanged(data: LevelChangedData, recipientTranches: readonly Tranche[]): EventEffects {
  const fx = none();
  fx.recipient = { orgId: data.orgId, verificationLevel: data.to };
  fx.refreshCredentials.push(data.orgId);
  if (data.to !== "L3") {
    fx.trancheUpdates = hold(recipientTranches, "level_below_l3", ["ready"]);
    if (data.from === "L3") fx.alerts.push({ kind: "level_below_l3", orgId: data.orgId, message: `Verification level dropped from L3 to ${data.to}. Payments need L3.` });
  } else {
    fx.trancheUpdates = unhold(recipientTranches, "level_below_l3");
  }
  return fx;
}

/** The organization lost standing: hold everything not yet with Passport, and alert. */
export function onOrganizationInactive(data: OrganizationInactiveData, recipientTranches: readonly Tranche[]): EventEffects {
  const fx = none();
  fx.recipient = { orgId: data.orgId, active: false };
  fx.trancheUpdates = hold(recipientTranches, "organization_inactive");
  fx.refreshCredentials.push(data.orgId);
  fx.alerts.push({ kind: "organization_inactive", orgId: data.orgId, message: "Passport reports this organization as inactive. All payments to it are on hold." });
  return fx;
}
