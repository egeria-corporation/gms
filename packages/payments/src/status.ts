// SPDX-License-Identifier: AGPL-3.0-only
// Passport disbursement status → GMS tranche status.
import type { PassportDisbursementStatus } from "@gms/passport-client";
import type { TrancheStatus } from "@gms/workflow";

const MAP: Record<PassportDisbursementStatus, TrancheStatus> = {
  // Accepted by Passport, money not moving yet.
  pending: "releasing",
  validated: "releasing",
  initiated: "initiated",
  settled: "settled",
  failed: "failed",
  returned: "returned",
  held: "held",
};

export function trancheStatusFor(status: PassportDisbursementStatus): TrancheStatus {
  return MAP[status];
}

/**
 * The statuses a tranche passes through to reach `target` from `from`. A failure before any money
 * moved (`releasing → failed`) returns the tranche to `due` so it can be released again; a failure
 * or return after initiation stays where it is for a person to review. Passport never retries on its own.
 */
export function pathTo(from: TrancheStatus, target: TrancheStatus): TrancheStatus[] {
  if (from === target) return [];
  if (target === "failed" && from === "releasing") return ["failed", "due"];
  if (target === "settled" && from === "releasing") return ["initiated", "settled"];
  return [target];
}

const ORDER: TrancheStatus[] = ["scheduled", "due", "ready", "releasing", "initiated", "settled"];
const TERMINAL: TrancheStatus[] = ["settled", "returned", "cancelled"];

/** Webhooks can arrive late or out of order: never move a tranche backwards along the payment path. */
export function isStale(current: TrancheStatus, incoming: TrancheStatus): boolean {
  if (current === incoming) return true;
  // A settled payment can still come back from the bank.
  if (current === "settled") return incoming !== "returned";
  if (TERMINAL.includes(current)) return true;
  const a = ORDER.indexOf(current);
  const b = ORDER.indexOf(incoming);
  return a >= 0 && b >= 0 && b < a;
}
