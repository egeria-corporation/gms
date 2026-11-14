// SPDX-License-Identifier: AGPL-3.0-only
// Win and keep it (v1.7.0): an awarded outside application's obligations (reports, expected
// payments, payments received, conditions), their series, a report's own questions and its "as
// submitted" PDF, the award page with payments received against the amount awarded, the closeout,
// and Awarded funding (outside awards next to built-in ones).
//
// Private to the applicant workspace. Amounts are the applicant's own records: an amount and a
// date, never a destination or a bank detail; no money moves. Every status change runs guard →
// write → ledger (changeStatus, with the edges of @gms/workflow); the closeout runs through the
// `outside_application` machine.
import { relevanceScore } from "@gms/assist";
import { renderOutsideSnapshot, sha256Hex } from "@gms/documents";
import { countText } from "@gms/forms";
import { cleanLine, cleanText } from "@gms/notify";
import { toMinor, toMoney, type Money } from "@gms/protocol";
import { initialStatus, MAX_SERIES_INSTANCES, obligationMoveRefusal, OBLIGATION_KINDS, OBLIGATION_STATUSES, seriesDates, SETTLED_STATUSES, type ObligationKind, type ObligationStatus } from "@gms/workflow";
import { z } from "zod";
import { ApiError, notFound } from "../lib/errors.ts";
import { listMyAwards } from "./awards.ts";
import { audit, authorize, changeStatus, guardWrite, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import type { questionsInput} from "./outside.ts";
import { addQuestions, docView, getOutside, loadOutside, moneyInput, OUTSIDE_ROLES, outsideWorkspace, questionsWithAnswers, questionView, requirePerson, stageLabel, transitionOutsideRow, writable } from "./outside.ts";
import type { Row } from "./repos/types.ts";

type Oa = Row<"outside_applications">;
type Ob = Row<"outside_obligations">;
type Series = Row<"outside_obligation_series">;

/** At most this many obligations on one award (60 per series, several series and one-offs). */
export const MAX_OBLIGATIONS_PER_AWARD = 300;

const KIND_LABEL: Record<ObligationKind, string> = { report: "Report", payment_expected: "Expected payment", payment_received: "Payment received", condition: "Condition" };
const STATUS_LABEL: Record<ObligationStatus, string> = { upcoming: "Upcoming", due: "Due", submitted: "Submitted", received: "Received", done: "Done", missed: "Missed" };
const todayOf = (ctx: Pick<ServiceContext, "now">) => ctx.now().toISOString().slice(0, 10);
const money = (minor: number | null, currency: string): Money | null => (minor === null ? null : toMoney(minor, currency));

// ------------------------------------------------------------------------------------ access

/** The award (an awarded outside application) for reading, or for changing: awarded, not archived, not closed out. */
async function loadAward(ctx: ServiceContext, id: string, write: boolean): Promise<{ ws: ServiceWorkspace; row: Oa }> {
  const found = await loadOutside(ctx, id, write ? "applications:write" : "applications:read");
  if (write) assertAwardOpen(found.row);
  return found;
}
function assertAwardOpen(row: Oa) {
  writable(row);
  if (row.stage !== "awarded") throw new ApiError(409, "not_awarded", "Obligations are kept for an awarded application. Record the award first");
  if (row.closed_out_at) throw new ApiError(409, "closed_out", "This award is closed out. Reopen the application to change it");
}

async function loadObligation(ctx: ServiceContext, oid: string, write: boolean) {
  const ws = await outsideWorkspace(ctx, write ? "applications:write" : "applications:read");
  const o = await ctx.repos.table("outside_obligations").one({ id: oid, workspace_id: ws.id });
  if (!o) throw notFound("Obligation");
  const row = (await ctx.repos.table("outside_applications").one({ id: o.outside_application_id, workspace_id: ws.id }))!;
  if (write) assertAwardOpen(row);
  return { ws, o, row };
}

// ------------------------------------------------------------------------------------ views

export function obligationView(o: Ob, currency: string, today: string, questionCount = 0) {
  const kind = o.kind as ObligationKind;
  const status = o.status as ObligationStatus;
  const open = !(SETTLED_STATUSES as readonly string[]).includes(status) && status !== "submitted";
  return {
    id: o.id,
    outsideApplicationId: o.outside_application_id,
    kind,
    kindLabel: KIND_LABEL[kind],
    title: o.title,
    dueOn: o.due_on,
    amount: money(o.amount_minor, currency),
    status,
    statusLabel: STATUS_LABEL[status],
    overdue: open && !!o.due_on && o.due_on < today,
    seriesId: o.series_id,
    customized: o.customized,
    notes: o.notes,
    submittedAt: o.submitted_at,
    confirmationRef: o.confirmation_ref,
    snapshot: o.document_id && o.snapshot_sha256 ? { documentId: o.document_id, sha256: o.snapshot_sha256 } : null,
    documentId: o.document_id,
    completedOn: o.completed_on,
    questionCount,
    allowedStatuses: ((): ObligationStatus[] => OBLIGATION_STATUSES.filter((to) => to !== "submitted" && to !== status && obligationMoveRefusal(kind, status, to) === null))(),
    createdAt: o.created_at,
    updatedAt: o.updated_at,
  };
}

const seriesView = (s: Series, currency: string, instances: number) => ({ id: s.id, kind: s.kind, title: s.title, everyMonths: s.every_months, startOn: s.start_on, endOn: s.end_on, amount: money(s.amount_minor, currency), notes: s.notes, instances });

async function obligationsOf(ctx: ServiceContext, row: Oa) {
  const list = await ctx.repos.table("outside_obligations").find({ workspace_id: row.workspace_id, outside_application_id: row.id }, { limit: MAX_OBLIGATIONS_PER_AWARD + 10 });
  return list.sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999") || a.created_at.localeCompare(b.created_at));
}

/** Payments: what was awarded, what came in, what is still expected. Records only. */
function paymentsOf(row: Oa, list: Ob[], today: string) {
  const received = list.filter((o) => o.status === "received" && o.amount_minor !== null);
  const expected = list.filter((o) => o.kind === "payment_expected" && o.status !== "received" && o.amount_minor !== null);
  const sum = (xs: Ob[]) => xs.reduce((n, o) => n + (o.amount_minor ?? 0), 0);
  const awarded = row.awarded_amount_minor;
  return {
    currency: row.currency,
    awarded: money(awarded, row.currency),
    received: toMoney(sum(received), row.currency),
    expected: toMoney(sum(expected), row.currency),
    outstanding: awarded === null ? null : toMoney(Math.max(0, awarded - sum(received)), row.currency),
    entries: [...received, ...expected].sort((a, b) => (a.due_on ?? "").localeCompare(b.due_on ?? "")).map((o) => obligationView(o, row.currency, today)),
  };
}

const closeoutOf = (row: Oa, list: Ob[]) => {
  const open = list.filter((o) => !(SETTLED_STATUSES as readonly string[]).includes(o.status));
  return { closedOutAt: row.closed_out_at, eligible: row.stage === "awarded" && !row.closed_out_at && !row.archived_at && open.length === 0, openCount: open.length };
};

/** Every obligation of an award, its series, the payments and whether it can be closed out. */
export async function listObligations(ctx: ServiceContext, id: string) {
  const { row } = await loadAward(ctx, id, false);
  const list = await obligationsOf(ctx, row);
  const series = await ctx.repos.table("outside_obligation_series").find({ workspace_id: row.workspace_id, outside_application_id: row.id }, { orderBy: "created_at" });
  const questions = list.length ? await ctx.repos.table("outside_questions").find({ workspace_id: row.workspace_id, outside_application_id: row.id, obligation_id: list.filter((o) => o.kind === "report").map((o) => o.id) }) : [];
  const today = todayOf(ctx);
  return {
    obligations: list.map((o) => obligationView(o, row.currency, today, questions.filter((q) => q.obligation_id === o.id).length)),
    series: series.map((s) => seriesView(s, row.currency, list.filter((o) => o.series_id === s.id).length)),
    payments: paymentsOf(row, list, today),
    closeout: closeoutOf(row, list),
  };
}

// ------------------------------------------------------------------------------------ create, edit, remove

const title = z.string().transform(cleanLine).pipe(z.string().min(1).max(300));
const notes = z.string().transform(cleanText).pipe(z.string().max(5000)).transform((v) => v || null);
const isoDate = z.iso.date();

export const obligationInput = z
  .object({
    kind: z.enum(OBLIGATION_KINDS),
    title,
    /** When it is due; for a payment received, the date it arrived. */
    dueOn: isoDate.optional(),
    /** Payments only, in the application's currency. */
    amount: moneyInput.optional(),
    notes: notes.optional(),
    /** "Every N months from start until grant end" (not for a payment received). `endOn` defaults to the grant's end. */
    series: z.object({ everyMonths: z.number().int().min(1).max(24), startOn: isoDate, endOn: isoDate.optional() }).strict().optional(),
  })
  .strict()
  .refine((v) => !v.amount || v.kind === "payment_expected" || v.kind === "payment_received", { message: "Only payments have an amount", path: ["amount"] })
  .refine((v) => v.kind !== "payment_received" || (!!v.amount && !!v.dueOn), { message: "A payment received has an amount and the date it arrived", path: ["amount"] })
  .refine((v) => !v.series || v.kind !== "payment_received", { message: "A payment received is recorded once, not as a series", path: ["series"] })
  .refine((v) => !!v.series || v.kind !== "report" || !!v.dueOn, { message: "A report has a due date", path: ["dueOn"] });

function minorIn(row: Oa, m: { amount: string; currency: string } | undefined): number | null {
  if (!m) return null;
  if (m.currency !== row.currency) throw new ApiError(422, "currency_mismatch", `Every amount on this award is in ${row.currency}`);
  try {
    return toMinor(m);
  } catch {
    throw new ApiError(400, "bad_request", `${m.amount} is not a valid ${m.currency} amount`, [{ code: "invalid_field", field: "amount" }]);
  }
}

const datesOrRefuse = (startOn: string, endOn: string, everyMonths: number) => {
  try {
    return seriesDates(startOn, endOn, everyMonths, MAX_SERIES_INSTANCES);
  } catch (e) {
    throw new ApiError(422, "series_out_of_bounds", e instanceof RangeError && /at most/.test(e.message) ? `A series makes at most ${MAX_SERIES_INSTANCES} dates. Choose a longer period or an earlier end` : "The series ends before it starts", [{ code: "series", field: "series" }]);
  }
};

/** Record an obligation, or a series of them (generated on save, at most 60). */
export async function createObligation(ctx: ServiceContext, id: string, input: z.output<typeof obligationInput>) {
  const { ws, row } = await loadAward(ctx, id, true);
  const amount = minorIn(row, input.amount);
  const existing = await ctx.repos.table("outside_obligations").count({ workspace_id: ws.id, outside_application_id: row.id });
  const base = { workspace_id: ws.id, outside_application_id: row.id, kind: input.kind, title: input.title, amount_minor: amount, notes: input.notes ?? null, status: initialStatus(input.kind), created_by: ctx.actor.userId };
  if (!input.series) {
    if (existing + 1 > MAX_OBLIGATIONS_PER_AWARD) throw new ApiError(422, "too_many_obligations", `An award holds at most ${MAX_OBLIGATIONS_PER_AWARD} obligations`);
    const o = await guardWrite("This obligation", () => ctx.repos.table("outside_obligations").insert({ ...base, due_on: input.dueOn ?? null, ...(input.kind === "payment_received" ? { completed_on: input.dueOn! } : {}) }));
    await audit(ctx, "outside_obligation.created", "outside_obligation", o.id, { outsideApplicationId: row.id, kind: o.kind, dueOn: o.due_on });
    return obligationView(o, row.currency, todayOf(ctx));
  }
  const endOn = input.series.endOn ?? row.grant_end;
  if (!endOn) throw new ApiError(422, "series_needs_end", "Give the series an end date, or record the grant's end date first", [{ code: "series", field: "series.endOn" }]);
  const dates = datesOrRefuse(input.series.startOn, endOn, input.series.everyMonths);
  if (existing + dates.length > MAX_OBLIGATIONS_PER_AWARD) throw new ApiError(422, "too_many_obligations", `An award holds at most ${MAX_OBLIGATIONS_PER_AWARD} obligations`);
  const series = await guardWrite("This series", () => ctx.repos.table("outside_obligation_series").insert({ workspace_id: ws.id, outside_application_id: row.id, kind: input.kind, title: input.title, every_months: input.series!.everyMonths, start_on: input.series!.startOn, end_on: endOn, amount_minor: input.kind === "payment_expected" ? amount : null, notes: input.notes ?? null, created_by: ctx.actor.userId }));
  const made: Ob[] = [];
  for (const [i, d] of dates.entries()) made.push(await ctx.repos.table("outside_obligations").insert({ ...base, title: instanceTitle(input.title, i, dates.length), due_on: d, series_id: series.id }));
  await audit(ctx, "outside_obligation.series_created", "outside_application", row.id, { seriesId: series.id, kind: series.kind, everyMonths: series.every_months, startOn: series.start_on, endOn: series.end_on, instances: made.length });
  const today = todayOf(ctx);
  return { series: seriesView(series, row.currency, made.length), obligations: made.map((o) => obligationView(o, row.currency, today)) };
}

/** "Progress report (1 of 4)". */
const instanceTitle = (t: string, i: number, n: number) => (n > 1 ? `${t} (${i + 1} of ${n})`.slice(0, 300) : t);

export const obligationPatch = z.object({ title: title.optional(), dueOn: isoDate.nullable().optional(), amount: moneyInput.nullable().optional(), notes: notes.nullable().optional() }).strict();

/** Edit one obligation. An instance of a series edited on its own is left alone when the series is regenerated. */
export async function patchObligation(ctx: ServiceContext, oid: string, input: z.output<typeof obligationPatch>) {
  const { ws, o, row } = await loadObligation(ctx, oid, true);
  if (input.amount !== undefined && input.amount !== null && o.kind !== "payment_expected" && o.kind !== "payment_received") throw new ApiError(422, "no_amount", "Only payments have an amount");
  if (o.kind === "payment_received" && (input.amount === null || input.dueOn === null)) throw new ApiError(422, "payment_needs_amount", "A payment received keeps its amount and date");
  if (o.kind === "report" && input.dueOn === null) throw new ApiError(422, "report_needs_date", "A report keeps a due date");
  const [saved] = await guardWrite("This obligation", () =>
    ctx.repos.table("outside_obligations").update(
      { id: o.id, workspace_id: ws.id },
      {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.dueOn !== undefined ? { due_on: input.dueOn, ...(o.kind === "payment_received" ? { completed_on: input.dueOn } : {}) } : {}),
        ...(input.amount !== undefined ? { amount_minor: input.amount === null ? null : minorIn(row, input.amount) } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(o.series_id ? { customized: true } : {}),
      },
    ),
  );
  return obligationView(saved ?? o, row.currency, todayOf(ctx));
}

/** Remove one obligation. A report that was submitted is kept: it is the record of what was sent. */
export async function deleteObligation(ctx: ServiceContext, oid: string) {
  const { ws, o, row } = await loadObligation(ctx, oid, true);
  if (o.kind === "report" && (o.status === "submitted" || o.status === "done")) throw new ApiError(409, "kept_record", "A submitted report is kept as the record of what was sent");
  await ctx.repos.table("outside_questions").remove({ workspace_id: ws.id, obligation_id: o.id });
  await ctx.repos.table("outside_obligations").remove({ id: o.id, workspace_id: ws.id });
  await audit(ctx, "outside_obligation.removed", "outside_obligation", o.id, { outsideApplicationId: row.id, kind: o.kind });
  return { id: o.id, deleted: true };
}

// ------------------------------------------------------------------------------------ status (guard → write → ledger)

export const statusInput = z
  .object({
    to: z.enum(OBLIGATION_STATUSES),
    /** When it was done or the payment arrived (defaults to today). */
    completedOn: isoDate.optional(),
    /** An expected payment received: the amount that actually came in, if different. */
    amount: moneyInput.optional(),
  })
  .strict();

async function moveObligation(ctx: ServiceContext, o: Ob, to: ObligationStatus, patch: Partial<Ob>) {
  let saved: Ob | undefined;
  await changeStatus(ctx, {
    event: "outside_obligation.status_changed",
    subjectType: "outside_obligation",
    subjectId: o.id,
    current: o.status,
    from: OBLIGATION_STATUSES,
    to,
    guard: () => obligationMoveRefusal(o.kind as ObligationKind, o.status as ObligationStatus, to),
    write: async () => {
      [saved] = await ctx.repos.table("outside_obligations").update({ id: o.id, workspace_id: o.workspace_id, status: o.status }, { status: to, ...patch });
      if (!saved) throw new ApiError(409, "conflict", "This obligation changed while you were working on it. Reload it and try again");
    },
    data: { outsideApplicationId: o.outside_application_id, kind: o.kind },
  });
  return saved!;
}

/** Move an obligation: done, received, missed, or back. Marking a report submitted has its own route. */
export async function setObligationStatus(ctx: ServiceContext, oid: string, input: z.output<typeof statusInput>) {
  const { o, row } = await loadObligation(ctx, oid, true);
  if (input.to === "submitted") throw new ApiError(409, "use_submit", "Mark a report submitted with its date and confirmation");
  if (input.amount && input.to !== "received") throw new ApiError(422, "no_amount", "An amount is given only when a payment is received");
  const settles = input.to === "done" || input.to === "received";
  const patch: Partial<Ob> = settles ? { completed_on: input.completedOn ?? todayOf(ctx), ...(input.amount ? { amount_minor: minorIn(row, input.amount) } : {}) } : { completed_on: null };
  return obligationView(await moveObligation(ctx, o, input.to, patch), row.currency, todayOf(ctx));
}

// ------------------------------------------------------------------------------------ series

export const seriesPatch = z
  .object({ title: title.optional(), everyMonths: z.number().int().min(1).max(24).optional(), startOn: isoDate.optional(), endOn: isoDate.optional(), amount: moneyInput.nullable().optional(), notes: notes.nullable().optional() })
  .strict();

/** Future, untouched instances: upcoming, never edited on their own, nothing recorded, no report questions. */
async function untouchedFuture(ctx: ServiceContext, s: Series, today: string) {
  const instances = await ctx.repos.table("outside_obligations").find({ workspace_id: s.workspace_id, series_id: s.id });
  const questions = instances.length ? await ctx.repos.table("outside_questions").find({ workspace_id: s.workspace_id, obligation_id: instances.map((i) => i.id) }) : [];
  const touched = (o: Ob) => o.status !== "upcoming" || o.customized || o.submitted_at !== null || o.completed_on !== null || o.document_id !== null || questions.some((q) => q.obligation_id === o.id);
  return { instances, replaceable: instances.filter((o) => !!o.due_on && o.due_on > today && !touched(o)) };
}

/**
 * Change a series and regenerate it: only future, untouched instances are replaced; past ones and
 * any that were edited, moved or written stay as they are. At most 60 instances in all.
 */
export async function updateSeries(ctx: ServiceContext, sid: string, input: z.output<typeof seriesPatch>) {
  const ws = await outsideWorkspace(ctx, "applications:write");
  const s = await ctx.repos.table("outside_obligation_series").one({ id: sid, workspace_id: ws.id });
  if (!s) throw notFound("Series");
  const row = (await ctx.repos.table("outside_applications").one({ id: s.outside_application_id, workspace_id: ws.id }))!;
  assertAwardOpen(row);
  if (input.amount && s.kind !== "payment_expected") throw new ApiError(422, "no_amount", "Only expected payments have an amount");
  const next = {
    title: input.title ?? s.title,
    every_months: input.everyMonths ?? s.every_months,
    start_on: input.startOn ?? s.start_on,
    end_on: input.endOn ?? s.end_on,
    amount_minor: input.amount === undefined ? s.amount_minor : input.amount === null ? null : minorIn(row, input.amount),
    notes: input.notes === undefined ? s.notes : input.notes,
  };
  const dates = datesOrRefuse(next.start_on, next.end_on, next.every_months);
  const today = todayOf(ctx);
  const { instances, replaceable } = await untouchedFuture(ctx, s, today);
  const kept = instances.filter((o) => !replaceable.includes(o));
  const keptDates = new Set(kept.map((o) => o.due_on));
  const fresh = dates.filter((d) => d > today && !keptDates.has(d));
  if (kept.length + fresh.length > MAX_SERIES_INSTANCES) throw new ApiError(422, "series_out_of_bounds", `A series makes at most ${MAX_SERIES_INSTANCES} dates. Choose a longer period or an earlier end`);
  const [saved] = await guardWrite("This series", () => ctx.repos.table("outside_obligation_series").update({ id: s.id, workspace_id: ws.id }, next));
  for (const o of replaceable) await ctx.repos.table("outside_obligations").remove({ id: o.id, workspace_id: ws.id, status: "upcoming" });
  const total = kept.length + fresh.length;
  const made: Ob[] = [];
  for (const d of fresh) {
    const n = dates.indexOf(d);
    made.push(await ctx.repos.table("outside_obligations").insert({ workspace_id: ws.id, outside_application_id: row.id, kind: s.kind, title: instanceTitle(next.title, n, dates.length), due_on: d, amount_minor: next.amount_minor, notes: next.notes, status: "upcoming", series_id: s.id, created_by: ctx.actor.userId }));
  }
  await audit(ctx, "outside_obligation.series_changed", "outside_application", row.id, { seriesId: s.id, everyMonths: next.every_months, startOn: next.start_on, endOn: next.end_on, replaced: replaceable.length, added: made.length, kept: kept.length });
  return { series: seriesView(saved ?? s, row.currency, total), replaced: replaceable.length, added: made.length, kept: kept.length };
}

/** Remove a series: its future, untouched instances go; the rest stay as one-off obligations. */
export async function deleteSeries(ctx: ServiceContext, sid: string) {
  const ws = await outsideWorkspace(ctx, "applications:write");
  const s = await ctx.repos.table("outside_obligation_series").one({ id: sid, workspace_id: ws.id });
  if (!s) throw notFound("Series");
  const row = (await ctx.repos.table("outside_applications").one({ id: s.outside_application_id, workspace_id: ws.id }))!;
  assertAwardOpen(row);
  const { instances, replaceable } = await untouchedFuture(ctx, s, todayOf(ctx));
  for (const o of replaceable) await ctx.repos.table("outside_obligations").remove({ id: o.id, workspace_id: ws.id, status: "upcoming" });
  for (const o of instances.filter((i) => !replaceable.includes(i))) await ctx.repos.table("outside_obligations").update({ id: o.id, workspace_id: ws.id }, { series_id: null });
  await ctx.repos.table("outside_obligation_series").remove({ id: s.id, workspace_id: ws.id });
  await audit(ctx, "outside_obligation.series_removed", "outside_application", row.id, { seriesId: s.id, removed: replaceable.length, kept: instances.length - replaceable.length });
  return { id: s.id, deleted: true, removed: replaceable.length, kept: instances.length - replaceable.length };
}

// ------------------------------------------------------------------------------------ reports

async function loadReport(ctx: ServiceContext, oid: string, write: boolean) {
  const found = await loadObligation(ctx, oid, write);
  if (found.o.kind !== "report") throw new ApiError(409, "not_a_report", "Only a report has questions");
  return found;
}

/** A report's questions with their latest answers, in the same shape as an application's. */
export async function listReportQuestions(ctx: ServiceContext, oid: string) {
  const { o, row } = await loadReport(ctx, oid, false);
  return (await questionsWithAnswers(ctx, row, o.id)).map(({ q, latest }) => questionView(q, latest));
}

export async function addReportQuestions(ctx: ServiceContext, oid: string, input: z.output<typeof questionsInput>) {
  const { o, row } = await loadReport(ctx, oid, true);
  if (o.status === "submitted" || o.status === "done") throw new ApiError(409, "report_submitted", "This report was submitted. Move it back to due to change it");
  return addQuestions(ctx, row.id, input, o.id);
}

export const reuseQuery = z.object({ questionId: z.uuid().optional(), q: z.string().trim().max(200).optional() }).strict();

/**
 * "Reuse from an earlier report": the latest answers to every other report's questions in the
 * workspace, most relevant to the question first. The person inserts one with provenance
 * `prior_submission` (the answer save checks it really is an earlier report's).
 */
export async function reuseCandidates(ctx: ServiceContext, oid: string, query: z.output<typeof reuseQuery> = {}) {
  const { ws, o } = await loadReport(ctx, oid, false);
  const target = query.questionId ? await ctx.repos.table("outside_questions").one({ id: query.questionId, workspace_id: ws.id, obligation_id: o.id }) : null;
  if (query.questionId && !target) throw notFound("Question");
  const questions = (await ctx.repos.table("outside_questions").find({ workspace_id: ws.id, phase: "report" }, { limit: 5000 })).filter((q) => q.obligation_id && q.obligation_id !== o.id);
  if (!questions.length) return [];
  const answers = await ctx.repos.table("outside_answers").find({ workspace_id: ws.id, question_id: questions.map((q) => q.id) });
  const latest = new Map<string, Row<"outside_answers">>();
  for (const a of answers) if ((latest.get(a.question_id)?.version ?? 0) < a.version) latest.set(a.question_id, a);
  const obligations = await ctx.repos.table("outside_obligations").find({ workspace_id: ws.id, id: [...new Set(questions.map((q) => q.obligation_id!))] });
  const apps = await ctx.repos.table("outside_applications").find({ workspace_id: ws.id, id: [...new Set(obligations.map((x) => x.outside_application_id))] });
  const needle = query.q?.toLowerCase();
  return questions
    .flatMap((q) => {
      const a = latest.get(q.id);
      if (!a || !a.body.trim()) return [];
      if (needle && !`${q.prompt} ${a.body}`.toLowerCase().includes(needle)) return [];
      const ob = obligations.find((x) => x.id === q.obligation_id);
      const app = apps.find((x) => x.id === ob?.outside_application_id);
      return [{ answerId: a.id, questionId: q.id, prompt: q.prompt, body: a.body, version: a.version, counts: countText(a.body), obligationId: ob?.id ?? null, obligationTitle: ob?.title ?? null, reportStatus: ob?.status ?? null, submittedAt: ob?.submitted_at ?? null, applicationTitle: app?.title ?? null, funderName: app?.funder_name ?? null, relevance: target ? relevanceScore(target.prompt, { title: q.prompt, body: a.body }) : 0 }];
    })
    .sort((x, y) => y.relevance - x.relevance || (y.submittedAt ?? "").localeCompare(x.submittedAt ?? ""))
    .slice(0, 50);
}

export const reportSubmitInput = z.object({ submittedAt: z.union([z.iso.datetime({ offset: true }), isoDate]), confirmationRef: z.string().transform(cleanLine).pipe(z.string().max(200)).optional() }).strict();

/**
 * Mark a report submitted (to the funder, elsewhere): the date, the confirmation, and an "as
 * submitted" PDF of its questions and latest answers, stored with its SHA-256. A person only, like
 * an application's submission.
 */
export async function submitReport(ctx: ServiceContext, oid: string, input: z.output<typeof reportSubmitInput>) {
  const { ws, o, row } = await loadReport(ctx, oid, true);
  requirePerson(ctx, "Marking a report submitted");
  const submittedAt = new Date(input.submittedAt.length === 10 ? `${input.submittedAt}T12:00:00Z` : input.submittedAt).toISOString();
  if (Date.parse(submittedAt) > ctx.now().getTime() + 86_400_000) throw new ApiError(422, "submitted_in_future", "The submission date cannot be in the future");
  const refusal = obligationMoveRefusal("report", o.status as ObligationStatus, "submitted");
  if (refusal) throw new ApiError(409, "invalid_transition", refusal);
  if (!ctx.ports.storage) throw new ApiError(503, "storage_unavailable", "File storage is not configured on this server, so the as-submitted copy cannot be kept");
  const qa = await questionsWithAnswers(ctx, row, o.id);
  const w = await ctx.repos.table("workspaces").one({ id: ws.id });
  const confirmationRef = input.confirmationRef || null;
  const bytes = await renderOutsideSnapshot(
    {
      title: `${o.title}: ${row.title}`.slice(0, 300),
      organization: w?.legal_name ?? w?.display_name ?? "Organization",
      funder: row.funder_name,
      program: row.program_name,
      submittedAt,
      method: "Report to the funder",
      confirmationRef,
      questions: qa.map(({ q, latest }) => {
        const c = countText(latest?.body ?? "");
        return { phase: "report" as const, section: q.section, prompt: q.prompt, limit: q.limit_kind && q.limit_value ? `${q.limit_value.toLocaleString("en-US")} ${q.limit_kind === "words" ? "words" : q.limit_kind === "chars" ? "characters" : "characters without spaces"}` : null, answer: latest?.body ?? "", counts: `${c.words.toLocaleString("en-US")} word${c.words === 1 ? "" : "s"} · ${c.chars.toLocaleString("en-US")} characters · ${c.charsNoSpaces.toLocaleString("en-US")} without spaces` };
      }),
    },
    { reference: `Outside obligation ${o.id}` },
  );
  const sha256 = await sha256Hex(bytes);
  const stored = await ctx.ports.storage.put(`outside/${row.id}/reports/${sha256}.pdf`, bytes, "application/pdf");
  const doc = await ctx.repos.table("documents").insert({ workspace_id: ws.id, owner_workspace_id: ws.id, subject_type: "outside_application", subject_id: row.id, name: `As submitted - ${o.title}.pdf`.slice(0, 250), mime: "application/pdf", size: bytes.byteLength, sha256, storage: stored.storage, path: stored.path, uploaded_by: ctx.actor.userId });
  try {
    const saved = await moveObligation(ctx, o, "submitted", { submitted_at: submittedAt, confirmation_ref: confirmationRef, document_id: doc.id, snapshot_sha256: sha256 });
    await audit(ctx, "outside_obligation.submitted", "outside_obligation", o.id, { outsideApplicationId: row.id, submittedAt, snapshotDocumentId: doc.id });
    return obligationView(saved, row.currency, todayOf(ctx), qa.length);
  } catch (e) {
    await ctx.repos.table("documents").remove({ id: doc.id, workspace_id: ws.id });
    throw e;
  }
}

// ------------------------------------------------------------------------------------ the award page, closeout, Awarded funding

/** The outside award page: amount per year, grant period, the award letter, obligations and payments received. */
export async function getOutsideAward(ctx: ServiceContext, id: string) {
  const { row } = await loadAward(ctx, id, false);
  if (row.stage !== "awarded") throw notFound("Outside award");
  const all = await listObligations(ctx, id);
  const letters = await ctx.repos.table("documents").find({ workspace_id: row.workspace_id, subject_type: "outside_application", subject_id: row.id, doc_type: "award_letter" }, { orderBy: "created_at", ascending: false, limit: 1 });
  return {
    id: row.id,
    label: "Outside award",
    source: "outside" as const,
    title: row.title,
    funderName: row.funder_name,
    programName: row.program_name,
    currency: row.currency,
    awardedAmount: money(row.awarded_amount_minor, row.currency),
    awardByYear: (Array.isArray(row.award_by_year) ? (row.award_by_year as { year: number; amountMinor: number }[]) : []).map((y) => ({ year: y.year, amountMinor: y.amountMinor, amount: toMoney(y.amountMinor, row.currency) })),
    grantStart: row.grant_start,
    grantEnd: row.grant_end,
    decidedAt: row.decided_at,
    awardLetter: letters[0] ? docView(letters[0]) : null,
    ...all,
  };
}

/** "Close out this award": every obligation done or received; the stage stays awarded. Through the workflow, ledgered. */
export async function closeOut(ctx: ServiceContext, id: string) {
  const { row } = await loadOutside(ctx, id, "applications:write");
  const list = await obligationsOf(ctx, row);
  const settled = list.every((o) => (SETTLED_STATUSES as readonly string[]).includes(o.status));
  await transitionOutsideRow(ctx, row, { action: "close_out", settled }, {}, { obligations: list.length });
  return getOutside(ctx, row.id);
}

/**
 * Awarded funding: built-in awards (labelled "On this GMS") next to outside awards ("Outside
 * award"). Built-in awards come from the awards service as the applicant reads them.
 */
export async function awardedFunding(ctx: ServiceContext) {
  const ws = await authorize(ctx, { scope: "awards:read", kind: "applicant" });
  const gms = (await listMyAwards(ctx, { page: 1, pageSize: 200, offset: 0 })).items.map((a) => ({ kind: "gms_award" as const, label: "On this GMS", id: a.id, title: a.title, funderName: a.funder.name, status: a.status, statusLabel: a.status.replace(/_/g, " "), currency: a.currency, awardedAmountMinor: a.awardedAmountMinor, awardedAmount: a.awardedAmountMinor === null ? null : toMoney(a.awardedAmountMinor, a.currency), grantStart: null as string | null, grantEnd: null as string | null, closedOutAt: null as string | null, award: a }));
  const outside = ws.role === null || OUTSIDE_ROLES.includes(ws.role) ? await ctx.repos.table("outside_applications").find({ workspace_id: ws.id, stage: "awarded" }, { orderBy: "decided_at", ascending: false, limit: 1000 }) : [];
  return {
    items: [
      ...gms,
      ...outside.map((r) => ({ kind: "outside_award" as const, label: "Outside award", id: r.id, title: r.title, funderName: r.funder_name, status: r.closed_out_at ? "closed_out" : "active", statusLabel: r.closed_out_at ? "Closed out" : stageLabel(r.stage), currency: r.currency, awardedAmountMinor: r.awarded_amount_minor, awardedAmount: money(r.awarded_amount_minor, r.currency), grantStart: r.grant_start, grantEnd: r.grant_end, closedOutAt: r.closed_out_at, award: null })),
    ],
  };
}
