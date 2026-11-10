// SPDX-License-Identifier: AGPL-3.0-only
// The one place a tranche changes (build spec §10.1, §10.7). `@gms/payments` decides what should
// happen and returns `TrancheUpdate`s; this module walks each update through the tranche machine
// (guard → write → ledger → webhook) and then stores the non-status facts that came with it.
import type { Tranche as PaymentsTranche, TrancheCondition, TrancheUpdate } from "@gms/payments";
import { trancheMachine, type TrancheAction, type TrancheContext, type TrancheStatus } from "@gms/workflow";
import { ApiError } from "../lib/errors.ts";
import { audit, required, type ServiceContext } from "./context.ts";
import { emitFor } from "./awards.ts";
import type { Row } from "./repos/types.ts";

type TrancheRow = Row<"tranches">;

export const toPaymentsTranche = (t: TrancheRow): PaymentsTranche => ({
  id: t.id,
  awardId: t.award_id,
  seq: t.seq,
  amountMinor: t.amount_minor,
  currency: t.currency,
  condition: t.condition as unknown as TrancheCondition,
  status: t.status as TrancheStatus,
  dueAt: t.due_at,
  mode: t.mode as PaymentsTranche["mode"],
  passportDisbursementId: t.passport_disbursement_id,
  passportStatus: t.passport_status,
  holdReason: t.hold_reason,
  idempotencyKey: t.idempotency_key ?? `trn_${t.id}`,
  releasedBy: t.released_by,
  releasedAt: t.released_at,
  external: t.external as PaymentsTranche["external"],
});

/** The machine actions that take a tranche from one status to the next one on an update's path. */
const STEPS: Record<string, TrancheAction[]> = {
  "scheduled>due": ["mark_due"],
  "due>ready": ["mark_ready"],
  "due>releasing": ["mark_ready", "release"],
  "ready>releasing": ["release"],
  "releasing>initiated": ["initiated"],
  "releasing>held": ["passport_hold"],
  "releasing>failed": ["refused"],
  "failed>due": ["retry"],
  "failed>held": ["retry", "hold"],
  "initiated>settled": ["settle"],
  "initiated>failed": ["fail"],
  "initiated>returned": ["return"],
  "settled>returned": ["return"],
  "due>held": ["hold"],
  "ready>held": ["hold"],
  "held>due": ["release_hold"],
  "held>releasing": ["resume_release"],
  "held>initiated": ["passport_released"],
  "held>settled": ["passport_released", "settle"],
  "held>failed": ["passport_released", "fail"],
  "due>settled": ["record_external"],
  "ready>settled": ["record_external"],
  "scheduled>cancelled": ["cancel"],
  "due>cancelled": ["cancel"],
  "ready>cancelled": ["cancel"],
  "held>cancelled": ["cancel"],
  "failed>cancelled": ["cancel"],
};

export type TrancheActor = "funder" | "system" | "passport";

const isUuid = (s: string | null | undefined): s is string => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/**
 * Walk one update through the machine and store what came with it. Statuses are only ever written
 * by the machine's port below; the trailing write carries display facts (Passport ids, the
 * external payment record), never a status.
 */
export async function applyTrancheUpdate(ctx: ServiceContext, update: TrancheUpdate, as: TrancheActor): Promise<TrancheRow> {
  let row = required(await ctx.repos.table("tranches").one({ id: update.trancheId }), "Tranche");
  const workspaceId = row.workspace_id;
  const p = update.patch;
  const now = ctx.now().toISOString();
  const mctx: TrancheContext = {
    conditionSatisfied: true,
    readinessPassed: true,
    holdReason: (p.holdReason as string | null | undefined) ?? update.reason ?? row.hold_reason ?? "manual",
    idempotencyKey: row.idempotency_key ?? `trn_${row.id}`,
    passportDisbursementId: p.passportDisbursementId ?? row.passport_disbursement_id ?? undefined,
    ...(p.passportStatus ? { passportStatus: p.passportStatus } : {}),
    ...(p.external ? { external: { reference: p.external.reference, paidAt: p.external.paidAt, destinationLast4: p.external.last4 } } : {}),
    now,
  };
  const ports = {
    write: async (c: { subjectId: string; from: string; to: string; patch: Record<string, unknown> }) => {
      const m = c.patch as { due_at?: string | null; hold_reason?: string | null; mode?: string; passport_disbursement_id?: string | null; passport_status?: string | null; released_at?: string | null };
      const [hit] = await ctx.repos.table("tranches").update({ id: c.subjectId, status: c.from }, {
        status: c.to,
        ...(m.due_at ? { due_at: m.due_at } : {}),
        ...("hold_reason" in m ? { hold_reason: m.hold_reason ?? null } : {}),
        ...(m.mode ? { mode: m.mode } : {}),
        ...(m.passport_disbursement_id ? { passport_disbursement_id: m.passport_disbursement_id } : {}),
        ...(m.passport_status !== undefined ? { passport_status: m.passport_status } : {}),
        ...(m.released_at ? { released_at: m.released_at } : {}),
      });
      if (!hit) throw new ApiError(409, "conflict", "This payment changed while you were working. Reload and try again");
    },
    ledger: (e: { eventType: string; subjectType: string; subjectId: string; data: Record<string, unknown> }) => audit(ctx, e.eventType, e.subjectType, e.subjectId, { ...e.data, ...(update.reason ? { reason: update.reason } : {}) }, workspaceId),
    emit: (e: { type: string; subjectType: string; subjectId: string; data: Record<string, unknown> }) => emitFor(ctx, workspaceId, e.type, { subjectType: e.subjectType, subjectId: e.subjectId, awardId: row.award_id, ...e.data }),
  };

  let status = row.status as TrancheStatus;
  for (const target of update.path) {
    if (target === status) continue;
    const actions = STEPS[`${status}>${target}`];
    if (!actions) throw new ApiError(409, "invalid_transition", `A ${status.replace(/_/g, " ")} payment cannot become ${target.replace(/_/g, " ")}`);
    for (const action of actions) {
      // A person releases; Passport and jobs report. `mark_ready` on the way to a release is the system's.
      const kind = action === "release" || action === "record_external" ? "funder" : as;
      const r = await trancheMachine.transition({ id: row.id, status }, action, { id: ctx.actor.id, kind }, mctx, ports);
      if (!r.ok) throw new ApiError(r.code === "actor_not_allowed" ? 403 : 409, r.code, r.reason);
      status = r.to;
    }
  }

  const facts = {
    ...(p.mode ? { mode: p.mode } : {}),
    ...(p.passportDisbursementId ? { passport_disbursement_id: p.passportDisbursementId } : {}),
    ...(p.passportStatus !== undefined ? { passport_status: p.passportStatus } : {}),
    ...(p.holdReason !== undefined && status !== "held" ? { hold_reason: null } : {}),
    ...(p.holdReason && status === "held" ? { hold_reason: p.holdReason } : {}),
    ...(p.releasedAt ? { released_at: p.releasedAt } : {}),
    ...(p.releasedBy !== undefined && isUuid(ctx.actor.userId) ? { released_by: ctx.actor.userId } : {}),
    ...(p.external ? { external: p.external as unknown as TrancheRow["external"] } : {}),
    ...(p.dueAt ? { due_at: p.dueAt } : {}),
  };
  if (Object.keys(facts).length) [row] = [(await ctx.repos.table("tranches").update({ id: row.id }, facts))[0] ?? row];
  return required(await ctx.repos.table("tranches").one({ id: row.id }), "Tranche");
}
