// SPDX-License-Identifier: AGPL-3.0-only
import { createMachine, type CgStatus } from "./machine.ts";
import type { AgreementStatus, AwardStatus } from "./statuses.ts";

export type AwardAction = "accept_offer" | "activate" | "suspend" | "resume" | "complete" | "cancel";

export interface AwardContext {
  /** Status of the award's current agreement, if any. */
  agreementStatus?: AgreementStatus | null;
  /** Award `conditions`; `noAgreementRequired` waives the executed-agreement guard. */
  conditions?: readonly string[];
  /** complete: no tranche is still scheduled, due, ready, held, releasing or initiated. */
  openTranches?: number;
  /** suspend / cancel: why. */
  reason?: string;
  now?: string;
}

export const NO_AGREEMENT_REQUIRED = "noAgreementRequired";

const needsReason = (what: string) => (ctx: AwardContext) => (ctx.reason?.trim() ? null : `A reason is required to ${what} an award.`);

export const awardMachine = createMachine<AwardStatus, AwardAction, AwardContext>({
  subjectType: "award",
  statuses: ["offered", "accepted", "active", "suspended", "completed", "cancelled"],
  terminal: ["completed", "cancelled"],
  transitions: {
    // `accepted` triggers the Passport mirror (§10.6); see `awardEffects`.
    accept_offer: { from: ["offered"], to: "accepted", actors: ["applicant"], patch: (c) => ({ accepted_at: c.now ?? null }) },
    activate: {
      from: ["accepted"],
      to: "active",
      actors: ["funder", "system"],
      guard: (ctx) =>
        ctx.agreementStatus === "executed" || ctx.conditions?.includes(NO_AGREEMENT_REQUIRED)
          ? null
          : "The grant agreement must be executed before the award becomes active.",
    },
    suspend: { from: ["active"], to: "suspended", actors: ["funder"], guard: needsReason("suspend"), patch: (c) => ({ suspend_reason: c.reason }) },
    resume: { from: ["suspended"], to: "active", actors: ["funder"] },
    complete: {
      from: ["active"],
      to: "completed",
      actors: ["funder", "system"],
      guard: (ctx) => ((ctx.openTranches ?? 0) > 0 ? `${ctx.openTranches} tranche(s) are still open; settle or cancel them before completing the award.` : null),
    },
    cancel: { from: ["offered", "accepted", "active", "suspended"], to: "cancelled", actors: ["funder"], guard: needsReason("cancel"), patch: (c) => ({ cancel_reason: c.reason }) },
  },
});

/** Side effects the caller must run after an award transition succeeds. */
export function awardEffects(to: AwardStatus): { mirrorToPassport: boolean; holdOpenTranches: boolean; cancelOpenTranches: boolean } {
  return { mirrorToPassport: to === "accepted", holdOpenTranches: to === "suspended", cancelOpenTranches: to === "cancelled" };
}

/** GMS award status → CommonGrants `AwdStatusOptions`; `customValue` carries the GMS status. */
export function awardCgStatus(status: AwardStatus): CgStatus {
  if (status === "completed") return { value: "completed", customValue: status };
  if (status === "cancelled") return { value: "cancelled", customValue: status };
  return { value: "awarded", customValue: status };
}
