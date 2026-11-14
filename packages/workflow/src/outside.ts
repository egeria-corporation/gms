// SPDX-License-Identifier: AGPL-3.0-only
// The `outside_application` machine (apply anywhere, v1.5.0). An outside application is the
// applicant's own record of an application to any funder; the GMS never submits anything, it
// records what the person did elsewhere. Every stage change runs here: guard → write → ledger.
//
// Unlike the other machines a move names its target stage, and `reopen` returns to the stage the
// application was in before it closed, so this machine has its own small engine over the same
// `Ports`. Ledger entries carry ids, stages and dates only (never amounts or answer text). No
// webhook is sent: outside applications are private to the applicant, and no webhook event type
// describes them (`OUTSIDE_WEBHOOK_EVENTS`, one place to add one later, to the owner's own
// subscriptions only).
import type { Actor, ActorKind, Ports, RefusalCode } from "./machine.ts";
import { OUTSIDE_STAGES, SUBMISSION_METHODS, type OutsideStage, type SubmissionMethod } from "./statuses.ts";

export { OUTSIDE_STAGES, type OutsideStage } from "./statuses.ts";

/** Where each stage may go next (contract: apply anywhere). Closed stages go nowhere but `reopen`. */
export const OUTSIDE_EDGES: Readonly<Record<OutsideStage, readonly OutsideStage[]>> = {
  prospect: ["deciding", "loi", "drafting", "not_pursuing"],
  deciding: ["loi", "drafting", "not_pursuing"],
  loi: ["invited", "declined", "withdrawn", "not_pursuing"],
  invited: ["drafting"],
  drafting: ["submitted", "withdrawn", "not_pursuing"],
  submitted: ["awarded", "declined", "withdrawn"],
  awarded: [],
  declined: [],
  withdrawn: [],
  not_pursuing: [],
};

/** Stages an application ends in; `reopen` leaves them. */
export const OUTSIDE_CLOSED_STAGES: readonly OutsideStage[] = ["awarded", "declined", "withdrawn", "not_pursuing"];

/** Stages a plain move cannot reach: each needs its own record (the submission, or the decision). */
export const OUTSIDE_RECORDED_STAGES: readonly OutsideStage[] = ["submitted", "awarded", "declined"];

/** The outcomes a decision records. `withdrawn` may also be a plain move. */
export const OUTSIDE_OUTCOMES = ["awarded", "declined", "withdrawn"] as const;
export type OutsideOutcome = (typeof OUTSIDE_OUTCOMES)[number];

/** Where `reopen` goes when no earlier stage was recorded (a row imported already closed). */
export const OUTSIDE_REOPEN_FALLBACK: Readonly<Record<string, OutsideStage>> = { awarded: "submitted", declined: "submitted", withdrawn: "drafting", not_pursuing: "prospect" };

/** Webhook event types for outside applications: none in this release. */
export const OUTSIDE_WEBHOOK_EVENTS: readonly string[] = [];

/** Only the applicant moves its own record. */
const ACTORS: readonly ActorKind[] = ["applicant"];

/** Where a go/no-go decision is taken (contract: the Deciding stage). One place to widen. */
export const GO_NO_GO_FROM: readonly OutsideStage[] = ["deciding"];
/** Where a "go" may lead; "no go" leads to not_pursuing. */
export const GO_TARGETS = ["loi", "drafting"] as const;
export type GoTarget = (typeof GO_TARGETS)[number];

export type OutsideRequest =
  | { action: "move"; to: OutsideStage }
  | { action: "go_no_go"; decision: "go" | "no_go"; to?: GoTarget | null; eligible: boolean }
  | { action: "close_out"; settled: boolean }
  | { action: "submit"; submittedAt?: string | null; method?: string | null }
  | { action: "decide"; outcome: OutsideOutcome; awardedAmountMinor?: number | null }
  | { action: "reopen" }
  | { action: "archive" }
  | { action: "unarchive" };

export interface OutsideSubject {
  id: string;
  stage: OutsideStage;
  previousStage: OutsideStage | null;
  archivedAt: string | null;
  /** When an awarded application was closed out; reopening clears it. */
  closedOutAt?: string | null;
}

/** The ledger event each action writes (`outside_application.<event>`). */
export const OUTSIDE_EVENTS = { move: "stage_changed", go_no_go: "go_no_go_decided", close_out: "closed_out", submit: "submitted", decide: "decided", reopen: "reopened", archive: "archived", unarchive: "archived" } as const;

export type OutsideCheck =
  | { ok: true; from: OutsideStage; to: OutsideStage; eventType: string; patch: Record<string, unknown>; data: Record<string, unknown> }
  | { ok: false; code: RefusalCode; reason: string };

const label = (s: string) => s.replace(/_/g, " ");
const isStage = (s: unknown): s is OutsideStage => typeof s === "string" && (OUTSIDE_STAGES as readonly string[]).includes(s);
const refuse = (code: RefusalCode, reason: string): OutsideCheck => ({ ok: false, code, reason });
const edge = (from: OutsideStage, to: OutsideStage) => OUTSIDE_EDGES[from].includes(to);
const edgeRefusal = (from: OutsideStage, to: OutsideStage) => refuse("invalid_from", `An application that is ${label(from)} cannot move to ${label(to)}.${OUTSIDE_EDGES[from].length ? ` It can move to ${OUTSIDE_EDGES[from].map(label).join(", ")}.` : " Reopen it first."}`);

/** Where `reopen` returns: the recorded earlier stage when it is an open one, else the fallback. */
export function reopenTarget(subject: Pick<OutsideSubject, "stage" | "previousStage">): OutsideStage {
  const back = subject.previousStage;
  return back && isStage(back) && !OUTSIDE_CLOSED_STAGES.includes(back) ? back : (OUTSIDE_REOPEN_FALLBACK[subject.stage] ?? "drafting");
}

/**
 * Whether the action may run, and what it writes. `now` is the time recorded for archive and
 * decisions. The patch is in database columns; the caller may add its own columns to the same write.
 */
export function checkOutside(subject: OutsideSubject, req: OutsideRequest, actor: Pick<Actor, "kind">, now: string): OutsideCheck {
  const from = subject.stage;
  if (!isStage(from)) return refuse("invalid_from", `Unknown stage "${String(from)}".`);
  if (!ACTORS.includes(actor.kind)) return refuse("actor_not_allowed", "Only the applicant's own team can change an outside application.");
  const eventType = `outside_application.${OUTSIDE_EVENTS[req.action as keyof typeof OUTSIDE_EVENTS] ?? "unknown"}`;
  if (req.action === "unarchive") {
    if (!subject.archivedAt) return refuse("guard_failed", "This application is not archived.");
    return { ok: true, from, to: from, eventType, patch: { archived_at: null }, data: { stage: from, archived: false } };
  }
  // Nothing moves while archived.
  if (subject.archivedAt) return refuse("guard_failed", "This application is archived. Unarchive it first.");
  switch (req.action) {
    case "archive":
      return { ok: true, from, to: from, eventType, patch: { archived_at: now }, data: { stage: from, archived: true, archivedAt: now } };
    case "move": {
      const to = req.to;
      if (!isStage(to)) return refuse("unknown_action", `Unknown stage "${String(to)}".`);
      if (OUTSIDE_RECORDED_STAGES.includes(to)) return refuse("guard_failed", to === "submitted" ? "Mark it submitted with the date and how it was sent." : "Record the funder's decision instead.");
      if (!edge(from, to)) return edgeRefusal(from, to);
      return { ok: true, from, to, eventType, patch: { stage: to, previous_stage: from }, data: { from, to } };
    }
    case "go_no_go": {
      if (!GO_NO_GO_FROM.includes(from)) return refuse("invalid_from", `A go/no-go decision is made while the application is deciding; this one is ${label(from)}.`);
      if (req.decision !== "go" && req.decision !== "no_go") return refuse("unknown_action", `Unknown decision "${String(req.decision)}".`);
      if (req.decision === "go") {
        if (!req.eligible) return refuse("guard_failed", "The organization is not eligible, so the decision cannot be go.");
        const to = req.to;
        if (!to || !(GO_TARGETS as readonly string[]).includes(to)) return refuse("guard_failed", "Say where it goes next: a letter of inquiry or drafting.");
        if (!edge(from, to)) return edgeRefusal(from, to);
        return { ok: true, from, to, eventType, patch: { stage: to, previous_stage: from }, data: { from, to, decision: "go" } };
      }
      if (!edge(from, "not_pursuing")) return edgeRefusal(from, "not_pursuing");
      return { ok: true, from, to: "not_pursuing", eventType, patch: { stage: "not_pursuing", previous_stage: from }, data: { from, to: "not_pursuing", decision: "no_go" } };
    }
    case "close_out": {
      if (from !== "awarded") return refuse("invalid_from", `Only an awarded application is closed out; this one is ${label(from)}.`);
      if (subject.closedOutAt) return refuse("guard_failed", "This award is already closed out.");
      if (!req.settled) return refuse("guard_failed", "Every obligation must be done or received before the award is closed out.");
      return { ok: true, from, to: from, eventType, patch: { closed_out_at: now }, data: { stage: from, closedOutAt: now } };
    }
    case "submit": {
      if (!edge(from, "submitted")) return edgeRefusal(from, "submitted");
      const at = req.submittedAt ? Date.parse(req.submittedAt) : Number.NaN;
      if (Number.isNaN(at)) return refuse("guard_failed", "Give the date it was submitted.");
      if (!req.method || !(SUBMISSION_METHODS as readonly string[]).includes(req.method)) return refuse("guard_failed", `Say how it was submitted: ${SUBMISSION_METHODS.map(label).join(", ")}.`);
      const submittedAt = new Date(at).toISOString();
      return { ok: true, from, to: "submitted", eventType, patch: { stage: "submitted", previous_stage: from, submitted_at: submittedAt, submission_method: req.method as SubmissionMethod }, data: { from, to: "submitted", submittedAt } };
    }
    case "decide": {
      const to = req.outcome;
      if (!(["awarded", "declined", "withdrawn"] as readonly string[]).includes(to)) return refuse("unknown_action", `Unknown outcome "${String(to)}".`);
      if (!edge(from, to)) return edgeRefusal(from, to);
      const amount = req.awardedAmountMinor;
      if (to === "awarded" && !(typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0)) return refuse("guard_failed", "Give the amount awarded (zero or more).");
      return { ok: true, from, to, eventType, patch: { stage: to, previous_stage: from, decided_at: now, ...(to === "awarded" ? { awarded_amount_minor: amount } : {}) }, data: { from, to, decidedAt: now } };
    }
    case "reopen": {
      if (!OUTSIDE_CLOSED_STAGES.includes(from)) return refuse("invalid_from", `Only an awarded, declined, withdrawn or not pursued application can be reopened; this one is ${label(from)}.`);
      const to = reopenTarget(subject);
      // A reopened decision is no longer a decision.
      const cleared = from === "awarded" || from === "declined" ? { decided_at: null, awarded_amount_minor: null, award_by_year: [], grant_start: null, grant_end: null, closed_out_at: null } : {};
      return { ok: true, from, to, eventType, patch: { stage: to, previous_stage: from, ...cleared }, data: { from, to } };
    }
    default:
      return refuse("unknown_action", `Unknown outside application action "${String((req as { action?: unknown }).action)}".`);
  }
}

/** guard → write → ledger (→ webhook, none today) for one outside application. */
export async function transitionOutside(subject: OutsideSubject, req: OutsideRequest, actor: Actor, ports: Ports, now: string): Promise<OutsideCheck> {
  const c = checkOutside(subject, req, actor, now);
  if (!c.ok) return c;
  await ports.write({ subjectType: "outside_application", subjectId: subject.id, from: c.from, to: c.to, patch: c.patch });
  await ports.ledger({ actor: actor.id, eventType: c.eventType, subjectType: "outside_application", subjectId: subject.id, data: c.data });
  for (const type of OUTSIDE_WEBHOOK_EVENTS) await ports.emit({ type, subjectType: "outside_application", subjectId: subject.id, data: c.data });
  return c;
}

/** Plain moves from a stage (what `POST /stage` and `set_outside_stage` may do). */
export const plainMovesFrom = (stage: OutsideStage): OutsideStage[] => OUTSIDE_EDGES[stage].filter((s) => !OUTSIDE_RECORDED_STAGES.includes(s));
