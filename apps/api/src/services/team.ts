// SPDX-License-Identifier: AGPL-3.0-only
// Deciding and writing as a team (v1.6.0), on outside applications: the go/no-go scorecard, who
// may approve an answer, comment threads per question, internal milestones from the full
// deadline, and a month grid of deadlines. Every stage change runs through the
// `outside_application` machine; every question status change is ledgered.
import { GO_TARGETS, type GoTarget } from "@gms/workflow";
import { cleanLine, cleanText } from "@gms/notify";
import { z } from "zod";
import { ApiError, notFound } from "../lib/errors.ts";
import { createAlert, listAlerts } from "./applicant-insights.ts";
import { audit, required, type ServiceContext } from "./context.ts";
import { assertMember, deadlinesOf, loadOutside, loadQuestion, outsideWorkspace, transitionOutsideRow, writable, getOutside } from "./outside.ts";
import type { Row } from "./repos/types.ts";

type Oa = Row<"outside_applications">;

// ------------------------------------------------------------------------------------ go/no-go

export const SCORE_KEYS = ["fit", "capacity", "effort", "relationship"] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];
/** Workspace-editable defaults (contract): fit 3, capacity 2, effort vs. amount 2, relationship 1. */
export const DEFAULT_GO_NO_GO_WEIGHTS: Readonly<Record<ScoreKey, number>> = { fit: 3, capacity: 2, effort: 2, relationship: 1 };
export const SCORE_LABEL: Record<ScoreKey, string> = { fit: "Fit with our mission", capacity: "Capacity to deliver", effort: "Effort vs. amount", relationship: "Relationship with the funder" };

/** The workspace's go/no-go settings: off by default, with the default weights. */
export function goNoGoSettingsOf(settings: unknown) {
  const s = (settings ?? {}) as { goNoGoEnabled?: unknown; goNoGoWeights?: Record<string, unknown> };
  const w = s.goNoGoWeights ?? {};
  const weights = Object.fromEntries(SCORE_KEYS.map((k) => [k, typeof w[k] === "number" && Number.isInteger(w[k]) && (w[k] as number) >= 0 && (w[k] as number) <= 10 ? (w[k] as number) : DEFAULT_GO_NO_GO_WEIGHTS[k]])) as Record<ScoreKey, number>;
  if (SCORE_KEYS.every((k) => weights[k] === 0)) Object.assign(weights, DEFAULT_GO_NO_GO_WEIGHTS);
  return { enabled: s.goNoGoEnabled === true, weights, labels: SCORE_LABEL };
}

/** The weighted mean of the 1-5 scores, to two places (1 to 5). */
export function scoreTotal(scores: Record<ScoreKey, number>, weights: Record<ScoreKey, number>): number {
  const sum = SCORE_KEYS.reduce((n, k) => n + weights[k], 0);
  return Math.round((SCORE_KEYS.reduce((n, k) => n + scores[k] * weights[k], 0) / sum) * 100) / 100;
}

const score = z.number().int().min(1).max(5);
export const goNoGoInput = z
  .object({
    eligibility: z.enum(["pass", "fail"]),
    scores: z.object({ fit: score, capacity: score, effort: score, relationship: score }).strict(),
    decision: z.enum(["go", "no_go"]),
    /** Where a go leads: a letter of inquiry or drafting (the person picks). */
    to: z.enum(GO_TARGETS).optional(),
    reason: z.string().transform(cleanText).pipe(z.string().max(2000)).optional(),
  })
  .strict()
  .refine((v) => v.decision !== "go" || !!v.to, { message: "Say where it goes next: loi or drafting", path: ["to"] })
  .refine((v) => v.decision !== "go" || v.eligibility === "pass", { message: "An organization that is not eligible cannot go ahead", path: ["decision"] });

/**
 * Record the go/no-go scorecard and move the application: go to a letter of inquiry or drafting,
 * no-go to not pursuing. The workspace must have the scorecard switched on.
 */
export async function decideGoNoGo(ctx: ServiceContext, id: string, input: z.output<typeof goNoGoInput>) {
  const { ws, row } = await loadOutside(ctx, id, "applications:write");
  writable(row);
  const settings = goNoGoSettingsOf(required(await ctx.repos.table("workspaces").one({ id: ws.id }), "Workspace").settings);
  if (!settings.enabled) throw new ApiError(409, "go_no_go_off", "The go/no-go scorecard is switched off for this workspace. An admin can switch it on in Settings");
  const total = scoreTotal(input.scores, settings.weights);
  const card = { scores: { eligibility: input.eligibility, ...input.scores }, weights: settings.weights, total, decision: input.decision, decidedBy: ctx.actor.userId, decidedAt: ctx.now().toISOString(), reason: input.reason || null, to: input.decision === "go" ? (input.to as GoTarget) : "not_pursuing" };
  await transitionOutsideRow(ctx, row, { action: "go_no_go", decision: input.decision, to: input.to ?? null, eligible: input.eligibility === "pass" }, { go_no_go: card as unknown as Oa["go_no_go"] }, { total });
  return getOutside(ctx, row.id);
}

// ------------------------------------------------------------------------------------ approving answers
// Who may approve an answer lives with the question's status change (./outside.ts): APPROVER_ROLES, assertMayApprove.
export { APPROVER_ROLES, assertMayApprove } from "./outside.ts";

// ------------------------------------------------------------------------------------ comments per question

const commentView = (m: Row<"messages">) => {
  const ref = (m.field_ref ?? {}) as { questionId?: string };
  return { id: m.id, questionId: ref.questionId ?? null, body: m.body, author: m.author, authorUserId: m.author_user_id, resolvedAt: m.resolved_at, resolvedBy: m.resolved_by, createdAt: m.created_at };
};

/** The application's team thread (applicant-internal, in its own workspace), made on first use. */
async function commentThread(ctx: ServiceContext, row: Oa, create: boolean) {
  const where = { workspace_id: row.workspace_id, applicant_workspace_id: row.workspace_id, subject_type: "outside_application", subject_id: row.id, visibility: "applicant_internal" } as const;
  const found = await ctx.repos.table("threads").one(where);
  if (found || !create) return found;
  return ctx.repos.table("threads").insert({ ...where, title: "Team comments" });
}

export const commentInput = z.object({ body: z.string().transform(cleanText).pipe(z.string().min(1).max(5000)) }).strict();
export const commentsQuery = z.object({ questionId: z.uuid().optional() }).strict();

/** Every comment on the application (or one question's), oldest first. */
export async function listQuestionComments(ctx: ServiceContext, id: string, query: z.output<typeof commentsQuery> = {}) {
  const { row } = await loadOutside(ctx, id, "applications:read");
  const thread = await commentThread(ctx, row, false);
  const all = thread ? (await ctx.repos.table("messages").find({ thread_id: thread.id }, { orderBy: "created_at" })).map(commentView) : [];
  return query.questionId ? all.filter((c) => c.questionId === query.questionId) : all;
}

export async function addQuestionComment(ctx: ServiceContext, qid: string, input: z.output<typeof commentInput>) {
  const { q, row } = await loadQuestion(ctx, qid, "applications:write");
  writable(row);
  const thread = (await commentThread(ctx, row, true))!;
  const m = await ctx.repos.table("messages").insert({ thread_id: thread.id, author: ctx.actor.id, author_user_id: ctx.actor.userId, body: input.body, field_ref: { questionId: q.id } });
  await audit(ctx, "outside_question.commented", "outside_question", q.id, { outsideApplicationId: row.id, messageId: m.id });
  return commentView(m);
}

export async function resolveQuestionComment(ctx: ServiceContext, id: string, commentId: string) {
  const { row } = await loadOutside(ctx, id, "applications:write");
  const thread = await commentThread(ctx, row, false);
  if (!thread) throw notFound("Comment");
  const [m] = await ctx.repos.table("messages").update({ id: commentId, thread_id: thread.id }, { resolved_at: ctx.now().toISOString(), resolved_by: ctx.actor.userId });
  return commentView(required(m, "Comment"));
}

// ------------------------------------------------------------------------------------ internal milestones

/** Offered when a full deadline is set (contract): draft due 14 days before, review 7, final 2. One place to change. */
export const MILESTONE_OFFSETS: readonly { key: "draft" | "review" | "final"; title: string; daysBefore: number }[] = [
  { key: "draft", title: "Draft due", daysBefore: 14 },
  { key: "review", title: "Review", daysBefore: 7 },
  { key: "final", title: "Final version", daysBefore: 2 },
];

const minusDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/** The milestone tasks offered for the full deadline, unsaved. Empty without a full deadline. */
export async function milestoneOffer(ctx: ServiceContext, id: string) {
  const { row } = await loadOutside(ctx, id, "applications:read");
  if (!row.full_due) return { fullDue: null, tasks: [] };
  const today = ctx.now().toISOString().slice(0, 10);
  return {
    fullDue: row.full_due,
    tasks: MILESTONE_OFFSETS.map((m) => ({ key: m.key, title: `${m.title}: ${row.title}`.slice(0, 300), dueOn: minusDays(row.full_due!, m.daysBefore), assigneeUserId: row.owner_user_id })).map((t) => ({ ...t, past: t.dueOn < today })),
  };
}

export const milestonesInput = z
  .object({
    tasks: z
      .array(z.object({ title: z.string().transform(cleanText).pipe(z.string().min(1).max(300)), dueOn: z.iso.date(), assigneeUserId: z.uuid().nullable().optional() }).strict())
      .min(1)
      .max(10),
  })
  .strict();

/** Create the milestone tasks the person confirmed (as offered or edited). Each is a task with a due date. */
export async function createMilestones(ctx: ServiceContext, id: string, input: z.output<typeof milestonesInput>) {
  const { ws, row } = await loadOutside(ctx, id, "applications:write");
  writable(row);
  for (const t of input.tasks) await assertMember(ctx, ws.id, t.assigneeUserId);
  const made = [];
  for (const t of input.tasks) {
    const task = await ctx.repos.table("tasks").insert({ workspace_id: ws.id, subject_type: "outside_application", subject_id: row.id, title: t.title, assignee_user_id: t.assigneeUserId ?? null, due_at: `${t.dueOn}T17:00:00.000Z`, created_by: ctx.actor.userId });
    made.push({ id: task.id, title: task.title, assigneeUserId: task.assignee_user_id, dueAt: task.due_at, doneAt: task.done_at });
  }
  await audit(ctx, "outside_application.milestones_created", "outside_application", row.id, { taskIds: made.map((m) => m.id) });
  return made;
}

// ------------------------------------------------------------------------------------ calendar

export const calendarQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month is YYYY-MM") }).strict();

/** A month grid of deadlines: every outside application's LOI, full and internal deadlines in the month, by day. */
export async function pipelineCalendar(ctx: ServiceContext, query: z.output<typeof calendarQuery>) {
  const ws = await outsideWorkspace(ctx, "applications:read");
  const [y, m] = query.month.split("-").map(Number) as [number, number];
  const first = `${query.month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const rows = await ctx.repos.table("outside_applications").find({ workspace_id: ws.id, archived_at: null }, { limit: 5000 });
  const events: { date: string; kind: "loi" | "full" | "internal"; outsideApplicationId: string; title: string; funderName: string | null; stage: string }[] = [];
  for (const r of rows) {
    const d = deadlinesOf(r);
    for (const [kind, date] of [["loi", d.loiDue], ["full", d.fullDue], ["internal", d.internalDue]] as const) if (date && date >= first && date <= last) events.push({ date, kind, outsideApplicationId: r.id, title: r.title, funderName: r.funder_name, stage: r.stage });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const days = Array.from({ length: Number(last.slice(8)) }, (_, i) => `${query.month}-${String(i + 1).padStart(2, "0")}`).map((date) => ({ date, events: events.filter((e) => e.date === date) }));
  return { month: query.month, firstWeekday: new Date(`${first}T00:00:00Z`).getUTCDay(), days };
}


// ------------------------------------------------------------------------------------ the next cycle

/**
 * "Get an alert when it reopens": a funding alert on the program name (or the title) through the
 * GMS's own alerts service, not OpenGrants' API. Asking again returns the same alert.
 */
export async function nextCycleAlert(ctx: ServiceContext, id: string) {
  const { row } = await loadOutside(ctx, id, "applications:read");
  const query = cleanLine(row.program_name ?? row.title).slice(0, 300);
  const name = cleanLine(`Reopens: ${query}`).slice(0, 120);
  const existing = (await listAlerts(ctx)).find((a) => a.name === name);
  if (existing) return { created: false, alert: existing };
  const alert = await createAlert(ctx, { name, query, frequency: "weekly" });
  await audit(ctx, "outside_application.alert_created", "outside_application", row.id, { alertId: alert.id });
  return { created: true, alert };
}
