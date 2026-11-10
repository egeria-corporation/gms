// SPDX-License-Identifier: AGPL-3.0-only
import { createMachine } from "./machine.ts";
import type { TrancheStatus } from "./statuses.ts";

export type TrancheAction =
  | "mark_due"
  | "mark_ready"
  | "hold"
  | "release_hold"
  | "release"
  | "initiated"
  | "refused"
  | "retry"
  | "settle"
  | "fail"
  | "return"
  | "record_external"
  | "cancel";

export type TrancheConditionType = "onExecution" | "onReportAccepted" | "onDate" | "manual";

export interface TrancheCondition {
  type: TrancheConditionType;
  requirementId?: string;
  date?: string;
}

export interface TrancheContext {
  /** mark_due: the tranche condition is satisfied. */
  conditionSatisfied?: boolean;
  /** mark_ready / release: every readiness check passed (§10.7). */
  readinessPassed?: boolean;
  /** First failing readiness reason, used in refusals. */
  readinessReason?: string;
  holdReason?: string;
  idempotencyKey?: string;
  passportDisbursementId?: string;
  passportStatus?: string;
  /** record_external: what the funder paid elsewhere. Never more than a reference, date and last4. */
  external?: { reference: string; paidAt: string; destinationLast4?: string };
  now?: string;
}

const notReady = (ctx: TrancheContext) => (ctx.readinessPassed ? null : (ctx.readinessReason ?? "The payment readiness check has not passed."));

export const trancheMachine = createMachine<TrancheStatus, TrancheAction, TrancheContext>({
  subjectType: "tranche",
  statuses: ["scheduled", "due", "ready", "releasing", "initiated", "settled", "held", "failed", "returned", "cancelled"],
  terminal: ["settled", "returned", "cancelled"],
  transitions: {
    mark_due: {
      from: ["scheduled"],
      to: "due",
      actors: ["funder", "system"],
      guard: (ctx) => (ctx.conditionSatisfied ? null : "The tranche condition is not satisfied yet."),
      patch: (c) => ({ due_at: c.now ?? null }),
      events: ["tranche.due", "tranche.status.changed"],
    },
    mark_ready: { from: ["due"], to: "ready", actors: ["funder", "system"], guard: notReady },
    hold: {
      from: ["due", "ready"],
      to: "held",
      actors: ["funder", "system", "passport"],
      guard: (ctx) => (ctx.holdReason?.trim() ? null : "A hold needs a reason."),
      patch: (c) => ({ hold_reason: c.holdReason }),
    },
    release_hold: { from: ["held"], to: "due", actors: ["funder", "system", "passport"], patch: () => ({ hold_reason: null }) },
    release: {
      from: ["ready"],
      to: "releasing",
      actors: ["funder"],
      guard: (ctx) => notReady(ctx) ?? (ctx.idempotencyKey ? null : "A release needs an idempotency key."),
      patch: (c, actor) => ({ mode: "facilitated", idempotency_key: c.idempotencyKey, released_by: actor.id, released_at: c.now ?? null }),
    },
    initiated: {
      from: ["releasing"],
      to: "initiated",
      actors: ["system", "passport"],
      guard: (ctx) => (ctx.passportDisbursementId ? null : "Passport did not return a disbursement id."),
      patch: (c) => ({ passport_disbursement_id: c.passportDisbursementId, passport_status: c.passportStatus ?? null }),
    },
    // Passport refused the release.
    refused: { from: ["releasing"], to: "failed", actors: ["system", "passport"], patch: (c) => ({ passport_status: c.passportStatus ?? null }) },
    retry: { from: ["failed"], to: "due", actors: ["funder", "system"] },
    settle: { from: ["initiated"], to: "settled", actors: ["system", "passport"], patch: (c) => ({ passport_status: c.passportStatus ?? "settled" }) },
    fail: { from: ["initiated"], to: "failed", actors: ["system", "passport"], patch: (c) => ({ passport_status: c.passportStatus ?? "failed" }) },
    return: { from: ["initiated"], to: "returned", actors: ["system", "passport"], patch: (c) => ({ passport_status: c.passportStatus ?? "returned" }) },
    record_external: {
      from: ["due", "ready"],
      to: "settled",
      actors: ["funder"],
      guard: (ctx) => (ctx.external?.reference?.trim() && ctx.external.paidAt ? null : "Recording an external payment needs a reference and the date it was paid."),
      patch: (c, actor) => ({ mode: "resolve", external: c.external, released_by: actor.id, passport_status: c.passportStatus ?? null }),
    },
    cancel: { from: ["scheduled", "due", "ready", "held", "failed"], to: "cancelled", actors: ["funder", "system"] },
  },
});
