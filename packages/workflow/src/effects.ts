// SPDX-License-Identifier: AGPL-3.0-only
// Cross-machine effects (§10.1). Each orchestrator runs the primary transition and then the
// dependent ones through the same ports, so the dependent writes are ledgered and announced too.
import { agreementMachine, type AgreementContext } from "./agreement.ts";
import { awardMachine, type AwardContext } from "./award.ts";
import type { Actor, Ports, Subject, TransitionResult } from "./machine.ts";
import { requirementMachine, type RequirementContext } from "./requirement.ts";
import type { AgreementStatus, AwardStatus, RequirementStatus, TrancheStatus } from "./statuses.ts";
import { trancheMachine, type TrancheCondition } from "./tranche.ts";

export interface TrancheRef extends Subject<TrancheStatus> {
  condition: TrancheCondition;
}

const SYSTEM: Actor = { id: "system:workflow", kind: "system" };

/** Tranches that become due when the agreement is executed. */
export function tranchesDueOnExecution(tranches: readonly TrancheRef[]): TrancheRef[] {
  return tranches.filter((t) => t.status === "scheduled" && t.condition.type === "onExecution");
}

export interface ExecuteAgreementResult {
  agreement: TransitionResult<AgreementStatus>;
  award: TransitionResult<AwardStatus> | null;
  tranchesDue: string[];
}

/** countersigned → executed; then the award (if `accepted`) becomes active and `onExecution`
 *  tranches become due. */
export async function executeAgreement(
  input: { agreement: Subject<AgreementStatus>; award: Subject<AwardStatus> & { conditions?: readonly string[] }; tranches: readonly TrancheRef[] },
  actor: Actor,
  ctx: AgreementContext,
  ports: Ports,
): Promise<ExecuteAgreementResult> {
  const agreement = await agreementMachine.transition(input.agreement, "execute", actor, ctx, ports);
  if (!agreement.ok) return { agreement, award: null, tranchesDue: [] };
  let award: TransitionResult<AwardStatus> | null = null;
  if (input.award.status === "accepted") {
    const awardCtx: AwardContext = { agreementStatus: "executed", conditions: input.award.conditions, now: ctx.now };
    award = await awardMachine.transition(input.award, "activate", SYSTEM, awardCtx, ports);
  }
  const tranchesDue: string[] = [];
  for (const t of tranchesDueOnExecution(input.tranches)) {
    const r = await trancheMachine.transition(t, "mark_due", SYSTEM, { conditionSatisfied: true, now: ctx.now }, ports);
    if (r.ok) tranchesDue.push(t.id);
  }
  return { agreement, award, tranchesDue };
}

export interface AcceptRequirementResult {
  requirement: TransitionResult<RequirementStatus>;
  trancheDue: string | null;
}

/** under_review → accepted; a requirement with `releases_tranche_id` moves that tranche to `due`. */
export async function acceptRequirement(
  input: { requirement: Subject<RequirementStatus> & { releasesTrancheId?: string | null }; tranche?: TrancheRef | null },
  actor: Actor,
  ctx: RequirementContext,
  ports: Ports,
): Promise<AcceptRequirementResult> {
  const requirement = await requirementMachine.transition(input.requirement, "accept", actor, ctx, ports);
  if (!requirement.ok) return { requirement, trancheDue: null };
  const t = input.tranche;
  if (!t || !input.requirement.releasesTrancheId || t.id !== input.requirement.releasesTrancheId || t.status !== "scheduled") {
    return { requirement, trancheDue: null };
  }
  const r = await trancheMachine.transition(t, "mark_due", SYSTEM, { conditionSatisfied: true, now: ctx.now }, ports);
  return { requirement, trancheDue: r.ok ? t.id : null };
}
