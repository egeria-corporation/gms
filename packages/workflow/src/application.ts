// SPDX-License-Identifier: AGPL-3.0-only
import { camel, createMachine, type Actor, type CgStatus, type LedgerEntry, type Ports } from "./machine.ts";
import type { ApplicationStatus } from "./statuses.ts";

export type ApplicationAction =
  | "submit"
  | "screen"
  | "start_review"
  | "recommend"
  | "accept"
  | "decline"
  | "waitlist"
  | "request_revision"
  | "schedule_interview"
  | "resume_review"
  | "withdraw";

export interface ApplicationContext {
  /** submit: every required form of the current stage is `complete`. */
  requiredFormsComplete?: boolean;
  /** submit: the competition (or the current stage) is open. */
  stageOpen?: boolean;
  /** request_revision: what the applicant is asked to change. */
  revisionNote?: string;
  /** accept / decline / waitlist: the committed decision this status follows from. */
  decisionId?: string;
  now?: string;
}

const NON_TERMINAL: readonly ApplicationStatus[] = [
  "draft",
  "submitted",
  "screening",
  "under_review",
  "recommended",
  "waitlisted",
  "revision_requested",
  "interview",
];

const needsDecision = (ctx: ApplicationContext) =>
  ctx.decisionId ? null : "A committed decision is required; propose and commit a decision first.";

export const applicationMachine = createMachine<ApplicationStatus, ApplicationAction, ApplicationContext>({
  subjectType: "application",
  statuses: [...NON_TERMINAL, "accepted", "declined", "withdrawn"],
  terminal: ["accepted", "declined", "withdrawn"],
  transitions: {
    submit: {
      from: ["draft", "revision_requested"],
      to: "submitted",
      actors: ["applicant"],
      guard: (ctx) =>
        ctx.stageOpen === false
          ? "This stage is closed to submissions."
          : ctx.requiredFormsComplete
            ? null
            : "Every required form must be complete before submitting.",
      patch: (ctx) => ({ submitted_at: ctx.now ?? null }),
      events: ["application.submitted", "application.status.changed"],
    },
    screen: { from: ["submitted"], to: "screening", actors: ["funder", "system"] },
    start_review: { from: ["submitted", "screening"], to: "under_review", actors: ["funder"] },
    recommend: { from: ["under_review", "interview"], to: "recommended", actors: ["funder"] },
    accept: { from: ["recommended", "waitlisted"], to: "accepted", actors: ["funder"], guard: needsDecision, patch: (c) => ({ decision_id: c.decisionId }) },
    decline: {
      from: ["submitted", "screening", "under_review", "interview", "recommended", "waitlisted"],
      to: "declined",
      actors: ["funder"],
      guard: needsDecision,
      patch: (c) => ({ decision_id: c.decisionId }),
    },
    waitlist: { from: ["recommended"], to: "waitlisted", actors: ["funder"], guard: needsDecision, patch: (c) => ({ decision_id: c.decisionId }) },
    request_revision: {
      from: ["submitted", "screening", "under_review"],
      to: "revision_requested",
      actors: ["funder"],
      guard: (ctx) => (ctx.revisionNote?.trim() ? null : "A revision request must say what to change."),
    },
    schedule_interview: { from: ["screening", "under_review"], to: "interview", actors: ["funder"] },
    resume_review: { from: ["interview"], to: "under_review", actors: ["funder"] },
    withdraw: { from: NON_TERMINAL, to: "withdrawn", actors: ["applicant"], patch: (ctx) => ({ withdrawn_at: ctx.now ?? null }) },
  },
});

/** GMS application status → CommonGrants `AppStatusOptions` (never invents enum values). */
export function applicationCgStatus(status: ApplicationStatus): CgStatus {
  switch (status) {
    case "draft":
      return { value: "inProgress" };
    case "submitted":
      return { value: "submitted" };
    case "accepted":
      return { value: "accepted" };
    case "declined":
      return { value: "rejected" };
    default:
      return { value: "custom", customValue: camel(status) };
  }
}

// ---- Stage dimension -------------------------------------------------------------------------

export interface StageDef {
  key: string;
  label?: string;
  /** formId → pinned version */
  forms: Record<string, number>;
  entryFrom: readonly string[];
  requiresSubmission: boolean;
  decisionRequired?: boolean;
}

export interface StagedApplication {
  id: string;
  status: ApplicationStatus;
  stage: string;
}

export type AdvanceResult =
  | {
      ok: true;
      fromStage: string;
      toStage: string;
      status: ApplicationStatus;
      /** Stage whose responses are locked (only when the new stage requires a submission). */
      lockResponsesOfStage: string | null;
      /** Form responses to create as `notStarted`. */
      createFormResponses: { formId: string; formVersion: number }[];
    }
  | { ok: false; code: "actor_not_allowed" | "unknown_stage" | "invalid_from" | "guard_failed"; reason: string };

/** Pure check + effect computation for a stage advance. Only a funder may advance, and only to a
 *  stage whose `entryFrom` includes the current stage. */
export function planAdvance(app: StagedApplication, stages: readonly StageDef[], toStage: string, actor: Actor): AdvanceResult {
  if (actor.kind !== "funder") return { ok: false, code: "actor_not_allowed", reason: "Only the funder can advance an application to another stage." };
  const target = stages.find((s) => s.key === toStage);
  if (!target) return { ok: false, code: "unknown_stage", reason: `This competition has no stage "${toStage}".` };
  if (!target.entryFrom.includes(app.stage)) {
    const allowed = target.entryFrom.length ? target.entryFrom.join(" or ") : "no other stage";
    return { ok: false, code: "invalid_from", reason: `Stage "${toStage}" can be entered from ${allowed}, not from "${app.stage}".` };
  }
  if (app.status === "draft") return { ok: false, code: "guard_failed", reason: "The application has not been submitted for its current stage." };
  if (applicationMachine.isTerminal(app.status)) {
    return { ok: false, code: "guard_failed", reason: `The application is ${app.status.replace(/_/g, " ")} and cannot change stage.` };
  }
  return {
    ok: true,
    fromStage: app.stage,
    toStage,
    status: target.requiresSubmission ? "draft" : app.status,
    lockResponsesOfStage: target.requiresSubmission ? app.stage : null,
    createFormResponses: Object.entries(target.forms).map(([formId, formVersion]) => ({ formId, formVersion })),
  };
}

export interface AdvancePorts extends Ports {
  /** Lock the prior stage's responses and create the new stage's `notStarted` responses. */
  applyStageEffects(effects: { applicationId: string; lockResponsesOfStage: string | null; createFormResponses: { formId: string; formVersion: number }[] }): Promise<void>;
}

export async function advanceStage(app: StagedApplication, stages: readonly StageDef[], toStage: string, actor: Actor, ports: AdvancePorts): Promise<AdvanceResult> {
  const plan = planAdvance(app, stages, toStage, actor);
  if (!plan.ok) return plan;
  await ports.write({ subjectType: "application", subjectId: app.id, from: app.status, to: plan.status, patch: { stage: plan.toStage } });
  await ports.applyStageEffects({ applicationId: app.id, lockResponsesOfStage: plan.lockResponsesOfStage, createFormResponses: plan.createFormResponses });
  const data = { action: "advance", fromStage: plan.fromStage, toStage: plan.toStage, from: app.status, to: plan.status };
  const entry: LedgerEntry = { actor: actor.id, eventType: "application.advance", subjectType: "application", subjectId: app.id, data };
  await ports.ledger(entry);
  await ports.emit({ type: "application.status.changed", subjectType: "application", subjectId: app.id, data });
  return plan;
}
