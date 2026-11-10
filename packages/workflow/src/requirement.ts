// SPDX-License-Identifier: AGPL-3.0-only
import { createMachine } from "./machine.ts";
import type { RequirementStatus, SubmissionStatus } from "./statuses.ts";

export type RequirementAction = "mark_due" | "mark_overdue" | "submit" | "start_review" | "accept" | "return" | "reopen" | "waive";

export interface RequirementContext {
  /** waive / return: why. */
  reason?: string;
  now?: string;
}

const needsReason = (what: string) => (ctx: RequirementContext) => (ctx.reason?.trim() ? null : `A note is required to ${what}.`);

export const requirementMachine = createMachine<RequirementStatus, RequirementAction, RequirementContext>({
  subjectType: "requirement",
  statuses: ["scheduled", "due", "overdue", "submitted", "under_review", "accepted", "returned", "waived"],
  terminal: ["accepted", "waived"],
  transitions: {
    mark_due: { from: ["scheduled"], to: "due", actors: ["system", "funder"], events: ["requirement.due"] },
    mark_overdue: { from: ["due"], to: "overdue", actors: ["system"] },
    submit: { from: ["due", "overdue"], to: "submitted", actors: ["applicant"], events: ["submission.received"] },
    start_review: { from: ["submitted"], to: "under_review", actors: ["funder"] },
    accept: { from: ["under_review"], to: "accepted", actors: ["funder"], events: ["submission.accepted"] },
    return: { from: ["under_review"], to: "returned", actors: ["funder"], guard: needsReason("return a submission"), patch: (c) => ({ review_note: c.reason }) },
    reopen: { from: ["returned"], to: "due", actors: ["system", "funder"], events: ["requirement.due"] },
    waive: {
      from: ["scheduled", "due", "overdue", "submitted", "under_review", "returned"],
      to: "waived",
      actors: ["funder"],
      guard: needsReason("waive a requirement"),
      patch: (c, actor) => ({ waived_by: actor.id, waive_reason: c.reason }),
    },
  },
});

export type SubmissionAction = "submit" | "start_review" | "accept" | "return" | "revise";

export interface SubmissionContext {
  /** submit: every form of the submission is `complete`. */
  formsComplete?: boolean;
  reviewNote?: string;
  now?: string;
}

export const submissionMachine = createMachine<SubmissionStatus, SubmissionAction, SubmissionContext>({
  subjectType: "submission",
  statuses: ["draft", "submitted", "under_review", "accepted", "returned"],
  terminal: ["accepted"],
  transitions: {
    submit: {
      from: ["draft"],
      to: "submitted",
      actors: ["applicant"],
      guard: (ctx) => (ctx.formsComplete ? null : "Complete every required field before submitting."),
      patch: (c) => ({ submitted_at: c.now ?? null }),
      events: ["submission.received"],
    },
    start_review: { from: ["submitted"], to: "under_review", actors: ["funder"] },
    accept: { from: ["under_review"], to: "accepted", actors: ["funder"], patch: (c, a) => ({ reviewed_by: a.id, review_note: c.reviewNote ?? null }), events: ["submission.accepted"] },
    return: {
      from: ["under_review"],
      to: "returned",
      actors: ["funder"],
      guard: (ctx) => (ctx.reviewNote?.trim() ? null : "A note is required to return a submission."),
      patch: (c, a) => ({ reviewed_by: a.id, review_note: c.reviewNote }),
    },
    revise: { from: ["returned"], to: "draft", actors: ["applicant"] },
  },
});
