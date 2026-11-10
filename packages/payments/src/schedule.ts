// SPDX-License-Identifier: AGPL-3.0-only
// Payment schedules: build tranches from a program's default plan, and decide which scheduled
// tranches have become due.
import type { Tranche, TrancheCondition, TrancheUpdate } from "./types.ts";

/** One line of a schedule plan. Give `percent` (of the awarded amount) or a fixed `amountMinor`. */
export type PlanItem = { condition: TrancheCondition } & ({ percent: number; amountMinor?: undefined } | { amountMinor: number; percent?: undefined });

export interface BuildScheduleInput {
  awardId: string;
  awardedMinor: number;
  currency: string;
  plan: PlanItem[];
  /** Returns a new `trn_…` id. The id is also the tranche's Passport Idempotency-Key. */
  newId: () => string;
}

export class ScheduleError extends Error {
  constructor(
    readonly code: "empty_plan" | "invalid_amount" | "sum_mismatch" | "invalid_date",
    message: string,
  ) {
    super(message);
    this.name = "ScheduleError";
  }
}

/** Program default when none is set: one payment when the agreement is executed. */
export const DEFAULT_PLAN: PlanItem[] = [{ percent: 100, condition: { type: "onExecution" } }];

export function buildSchedule(input: BuildScheduleInput): Tranche[] {
  const { awardedMinor, plan } = input;
  if (!plan.length) throw new ScheduleError("empty_plan", "A schedule needs at least one tranche");
  if (!Number.isSafeInteger(awardedMinor) || awardedMinor <= 0) throw new ScheduleError("invalid_amount", "The awarded amount must be positive");

  const amounts = plan.map((p) => {
    if (p.amountMinor !== undefined) return p.amountMinor;
    if (!(p.percent > 0 && p.percent <= 100)) throw new ScheduleError("invalid_amount", "A tranche percentage must be between 0 and 100");
    return Math.floor((awardedMinor * p.percent) / 100);
  });
  // Percentages rarely divide evenly: when the plan is all percentages summing to 100, the last tranche takes the remainder.
  const allPercent = plan.every((p) => p.percent !== undefined);
  if (allPercent && Math.abs(plan.reduce((s, p) => s + (p.percent ?? 0), 0) - 100) < 1e-9) {
    amounts[amounts.length - 1]! += awardedMinor - amounts.reduce((s, a) => s + a, 0);
  }
  if (amounts.some((a) => !Number.isSafeInteger(a) || a <= 0)) throw new ScheduleError("invalid_amount", "Every tranche amount must be positive");
  const total = amounts.reduce((s, a) => s + a, 0);
  if (total !== awardedMinor) throw new ScheduleError("sum_mismatch", `Tranches total ${total} but the award is ${awardedMinor} (minor units)`);

  return plan.map((p, i) => {
    if (p.condition.type === "onDate" && Number.isNaN(Date.parse(p.condition.date))) throw new ScheduleError("invalid_date", "An onDate tranche needs a valid date");
    const id = input.newId();
    return {
      id,
      awardId: input.awardId,
      seq: i + 1,
      amountMinor: amounts[i]!,
      currency: input.currency,
      condition: p.condition,
      status: "scheduled",
      dueAt: p.condition.type === "onDate" ? new Date(p.condition.date).toISOString() : null,
      mode: null,
      passportDisbursementId: null,
      passportStatus: null,
      holdReason: null,
      idempotencyKey: id,
      releasedBy: null,
      releasedAt: null,
      external: null,
    };
  });
}

export interface ScheduleFacts {
  agreementExecuted: boolean;
  /** `noAgreementRequired` on the award: an onExecution tranche is due as soon as the award is active. */
  noAgreementRequired?: boolean;
  awardActive: boolean;
  acceptedRequirementIds: readonly string[];
  now: Date;
}

/** Whether a tranche's own condition is met. A manual tranche is never met automatically. */
export function conditionSatisfied(condition: TrancheCondition, facts: ScheduleFacts): boolean {
  switch (condition.type) {
    case "onExecution":
      return facts.agreementExecuted || (!!facts.noAgreementRequired && facts.awardActive);
    case "onReportAccepted":
      return facts.acceptedRequirementIds.includes(condition.requirementId);
    case "onDate":
      return facts.now.getTime() >= Date.parse(condition.date);
    case "manual":
      return false;
  }
}

/** Scheduled tranches whose condition is now met move to `due`. Nothing is due before the award is active. */
export function evaluateDue(tranches: readonly Tranche[], facts: ScheduleFacts): TrancheUpdate[] {
  if (!facts.awardActive) return [];
  return tranches
    .filter((t) => t.status === "scheduled" && conditionSatisfied(t.condition, facts))
    .map((t) => ({ trancheId: t.id, path: ["due"], patch: { status: "due", dueAt: t.dueAt ?? facts.now.toISOString() }, reason: `condition:${t.condition.type}` }));
}
