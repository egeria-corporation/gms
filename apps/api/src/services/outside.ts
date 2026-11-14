// SPDX-License-Identifier: AGPL-3.0-only
// Apply anywhere (v1.5.0): outside applications, the applicant's own records of applications to
// ANY funder. They are private to the applicant workspace: no funder workspace, CommonGrants
// route, Passport mirror or funder analytics reads them. The GMS never submits anything: it
// records a submission the person made elsewhere, with an "as submitted" PDF of their answers.
//
// Stage changes run through the `outside_application` machine (@gms/workflow): guard → write →
// ledger. Recording a submission or a decision is for a person only (an agent's call goes to an
// approval and runs as the person who approves it). No money moves: amounts are the applicant's
// own records.
import { renderPdf, renderOutsideSnapshot, sha256Hex, type Block } from "@gms/documents";
import { countText, isOverLimit, parseQuestions, type LimitKind, type TextCounts } from "@gms/forms";
import { mapCsv, toCsv } from "@gms/importers";
import { cleanLine, cleanText } from "@gms/notify";
import { toMinor, toMoney, type Money } from "@gms/protocol";
import { checkOutside, plainMovesFrom, transitionOutside, LIMIT_KINDS, OUTSIDE_SOURCES, OUTSIDE_STAGES, QUESTION_PHASES, QUESTION_STATUSES, SUBMISSION_METHODS, type OutsideRequest, type OutsideStage } from "@gms/workflow";
import { z } from "zod";
import { forbidden } from "../auth/verify.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import { matchGmsOpportunity } from "./applicant.ts";
import { audit, authorize, changeStatus, guardWrite, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import { listMyDocuments } from "./organization.ts";
import { refuseSensitiveFilename, requiredDocumentsView } from "./vault.ts";
import type { Row } from "./repos/types.ts";

type Oa = Row<"outside_applications">;
type Question = Row<"outside_questions">;
type Answer = Row<"outside_answers">;

/**
 * Who in an applicant workspace may see outside applications. Consultants are left out: their
 * access is scoped to the applications they were given (membership `scope`), and outside
 * applications are not among them. One place to relax.
 */
export const OUTSIDE_ROLES: readonly string[] = ["admin", "editor", "finance", "viewer"];
export const MAX_QUESTIONS_PER_APPLICATION = 300;
export const MAX_IMPORT_ROWS = 500;
const MAX_UPLOAD = 25 * 1024 * 1024;

const STAGE_LABEL: Record<OutsideStage, string> = { prospect: "Prospect", deciding: "Deciding", loi: "Letter of inquiry", invited: "Invited to apply", drafting: "Drafting", submitted: "Submitted", awarded: "Awarded", declined: "Declined", withdrawn: "Withdrawn", not_pursuing: "Not pursuing" };
export const stageLabel = (s: string): string => STAGE_LABEL[s as OutsideStage] ?? s;
const METHOD_LABEL: Record<string, string> = { portal: "Funder's online portal", email: "Email", mail: "Mail", grants_gov: "Grants.gov", other: "Other" };
const LIMIT_LABEL: Record<LimitKind, string> = { words: "words", chars: "characters", chars_no_spaces: "characters without spaces" };

// ------------------------------------------------------------------------------------ access

export async function outsideWorkspace(ctx: ServiceContext, scope: "applications:read" | "applications:write"): Promise<ServiceWorkspace> {
  return authorize(ctx, { scope, kind: "applicant", roles: OUTSIDE_ROLES });
}

/** The outside application, in the caller's workspace only; anything else is a 404. */
export async function loadOutside(ctx: ServiceContext, id: string, scope: "applications:read" | "applications:write"): Promise<{ ws: ServiceWorkspace; row: Oa }> {
  const ws = await outsideWorkspace(ctx, scope);
  const row = await ctx.repos.table("outside_applications").one({ id, workspace_id: ws.id });
  if (!row) throw notFound("Outside application");
  return { ws, row };
}

/** A person, never an agent or API client, even one holding `approvals:bypass` (contract: human only). */
export function requirePerson(ctx: ServiceContext, what: string): void {
  if (ctx.actor.kind === "user") return;
  throw forbidden("approval_required", `${what} is done by a person. Call the MCP tool, which files an approval request, or do it in the GMS`);
}

export const writable = (row: Oa) => {
  if (row.archived_at) throw new ApiError(409, "archived", "This application is archived. Unarchive it to change it");
};

export async function assertMember(ctx: ServiceContext, workspaceId: string, userId: string | null | undefined) {
  if (userId && !(await ctx.repos.table("workspace_members").one({ workspace_id: workspaceId, user_id: userId }))) throw new ApiError(422, "not_a_member", "That person is not a member of this workspace");
}

// ------------------------------------------------------------------------------------ input pieces

const line = (max: number) => z.string().transform(cleanLine).pipe(z.string().min(1).max(max));
const optLine = (max: number) => z.string().transform(cleanLine).pipe(z.string().max(max)).transform((v) => v || null);
const paragraph = (max: number) => z.string().transform(cleanText).pipe(z.string().max(max)).transform((v) => v || null);
const webUrl = z.string().trim().max(2000).pipe(z.url({ protocol: /^https?$/ }));
const isoDate = z.iso.date();
export const moneyInput = z.object({ amount: z.string().regex(/^\d{1,13}(\.\d{1,3})?$/, "A decimal amount, e.g. 25000.00"), currency: z.string().regex(/^[A-Z]{3}$/).default("USD") }).strict();
/** By year: `{ year, amount }` with Money, or `{ year, amountMinor }` (the web's form) in the application's currency. */
const byYearInput = z.array(z.union([z.object({ year: z.number().int().min(1900).max(2999), amount: moneyInput }).strict(), z.object({ year: z.number().int().min(1900).max(2999), amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict()])).max(20);
/** Custom field names that would hold bank or identity data are refused: the GMS never keeps those. */
const SENSITIVE_KEY = /(rout(ing)?[\s_-]*(no|num|number)|acc(oun)?t[\s_-]*(no|num|number)|iban|swift|\bs\.?s\.?n\b|s{2}n|social[\s_-]*sec|birth|\bdob\b|tax[\s_-]*id|gov(ernment)?[\s_-]*id|passport[\s_-]*(no|num|number)|driver|password|passcode)/i;
const customFieldsInput = z
  .record(z.string().trim().min(1).max(100), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]))
  .refine((o) => Object.keys(o).length <= 30, "At most 30 custom fields")
  .refine((o) => !Object.keys(o).some((k) => SENSITIVE_KEY.test(k)), "Custom fields cannot hold bank, identity or password details");
const listingInput = z.object({ funder: optLine(200).optional(), amount: optLine(200).optional(), deadline: optLine(100).optional(), summary: paragraph(2000).optional(), url: webUrl.optional() }).strict();

const minorOf = (m: { amount: string; currency: string }) => {
  try {
    return toMinor(m);
  } catch {
    throw new ApiError(400, "bad_request", `${m.amount} is not a valid ${m.currency} amount`, [{ code: "invalid_field", field: "amount" }]);
  }
};
const yearsOf = (rows: z.output<typeof byYearInput>, currency: string) =>
  rows.map((r) => {
    if ("amountMinor" in r) return { year: r.year, amountMinor: r.amountMinor };
    if (r.amount.currency !== currency) throw new ApiError(422, "currency_mismatch", `Every amount on an application is in ${currency}`);
    return { year: r.year, amountMinor: minorOf(r.amount) };
  });

// ------------------------------------------------------------------------------------ views

const money = (minor: number | null, currency: string): Money | null => (minor === null ? null : toMoney(minor, currency));
const yearsView = (v: unknown, currency: string) => (Array.isArray(v) ? (v as { year: number; amountMinor: number }[]).map((r) => ({ year: r.year, amountMinor: r.amountMinor, amount: toMoney(r.amountMinor, currency) })) : []);

export function deadlinesOf(row: Pick<Oa, "loi_due" | "full_due" | "internal_due" | "rolling">) {
  return { loiDue: row.loi_due, fullDue: row.full_due, internalDue: row.internal_due, rolling: row.rolling };
}

/** The next open deadline from today (UTC), or the latest past one when all have passed. */
export function nextDeadlineOf(row: Pick<Oa, "loi_due" | "full_due" | "internal_due" | "stage">, today: string): { kind: "loi" | "full" | "internal"; date: string } | null {
  const all = (["internal", "loi", "full"] as const).flatMap((kind) => {
    const date = kind === "loi" ? row.loi_due : kind === "full" ? row.full_due : row.internal_due;
    return date ? [{ kind, date }] : [];
  });
  if (!all.length) return null;
  const ahead = all.filter((d) => d.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  return ahead[0] ?? all.sort((a, b) => b.date.localeCompare(a.date))[0]!;
}

async function namesOf(ctx: ServiceContext, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  return wanted.length && ctx.ports.directory ? await ctx.ports.directory.lookup(wanted) : new Map<string, { email: string | null; name: string | null }>();
}
const person = (names: Map<string, { email: string | null; name: string | null }>, id: string | null) => (id ? { userId: id, name: names.get(id)?.name ?? names.get(id)?.email?.split("@")[0] ?? null } : null);

function listItem(ctx: ServiceContext, row: Oa, counts: { total: number; approved: number }, names: Map<string, { email: string | null; name: string | null }>) {
  return {
    id: row.id,
    title: row.title,
    funderName: row.funder_name,
    funderRecordId: row.funder_record_id,
    programName: row.program_name,
    stage: row.stage,
    stageLabel: stageLabel(row.stage),
    source: row.source,
    sourceRef: row.source_ref,
    deadlines: deadlinesOf(row),
    nextDeadline: nextDeadlineOf(row, ctx.now().toISOString().slice(0, 10)),
    askAmount: money(row.ask_amount_minor, row.currency),
    owner: person(names, row.owner_user_id),
    archived: row.archived_at !== null,
    archivedAt: row.archived_at,
    questionCounts: counts,
    updatedAt: row.updated_at,
  };
}

async function questionCounts(ctx: ServiceContext, workspaceId: string, ids: string[]) {
  const qs = ids.length ? await ctx.repos.table("outside_questions").find({ workspace_id: workspaceId, outside_application_id: ids }) : [];
  const out = new Map<string, { total: number; approved: number }>();
  for (const id of ids) out.set(id, { total: 0, approved: 0 });
  for (const q of qs) {
    const c = out.get(q.outside_application_id)!;
    c.total++;
    if (q.status === "approved") c.approved++;
  }
  return out;
}

export const limitOf = (q: Question) => (q.limit_kind && q.limit_value ? { kind: q.limit_kind as LimitKind, value: q.limit_value } : null);
const limitText = (q: Question) => (q.limit_kind && q.limit_value ? `${q.limit_value.toLocaleString("en-US")} ${LIMIT_LABEL[q.limit_kind as LimitKind]}` : null);

export function answerView(a: Answer, q: Question) {
  const counts = countText(a.body);
  return { id: a.id, questionId: a.question_id, version: a.version, body: a.body, provenance: a.provenance, libraryAnswerId: a.library_answer_id, counts, overLimit: isOverLimit(counts, { kind: (q.limit_kind as LimitKind | null) ?? null, value: q.limit_value }), createdBy: a.created_by, createdAt: a.created_at, savedBy: a.created_by, savedAt: a.created_at };
}

export const questionView = (q: Question, latest: Answer | null) => ({
  id: q.id,
  outsideApplicationId: q.outside_application_id,
  phase: q.phase,
  section: q.section,
  position: q.position,
  prompt: q.prompt,
  guidance: q.guidance,
  limit: limitOf(q),
  limitKind: q.limit_kind,
  limitValue: q.limit_value,
  required: q.required,
  assigneeUserId: q.assignee_user_id,
  status: q.status,
  answer: latest ? answerView(latest, q) : null,
  updatedAt: q.updated_at,
});

/** Questions of one application in order, each with its latest answer. */
export async function questionsWithAnswers(ctx: ServiceContext, row: Oa) {
  const qs = (await ctx.repos.table("outside_questions").find({ workspace_id: row.workspace_id, outside_application_id: row.id })).sort(byOrder);
  const answers = qs.length ? await ctx.repos.table("outside_answers").find({ workspace_id: row.workspace_id, question_id: qs.map((q) => q.id) }) : [];
  const latest = new Map<string, Answer>();
  for (const a of answers) if ((latest.get(a.question_id)?.version ?? 0) < a.version) latest.set(a.question_id, a);
  return qs.map((q) => ({ q, latest: latest.get(q.id) ?? null }));
}
const PHASE_ORDER = { loi: 0, full: 1, report: 2 } as Record<string, number>;
const byOrder = (a: Question, b: Question) => (PHASE_ORDER[a.phase] ?? 9) - (PHASE_ORDER[b.phase] ?? 9) || a.position - b.position || a.created_at.localeCompare(b.created_at);

/** As the built-in attachments show a document (`Models.Document`). */
export const docView = (d: Row<"documents">) => ({ id: d.id, name: d.name, mime: d.mime, size: d.size, sha256: d.sha256, source: d.passport_document_id ? "passport_locker" : "upload", passportDocumentId: d.passport_document_id, scanStatus: d.scan_status, docType: d.doc_type, expiresOn: d.expires_on, uploadedAt: d.created_at });
/** As `/gms/tasks` shows a task (`Models.Task`). */
const taskView = (t: Row<"tasks">) => ({ id: t.id, subjectType: t.subject_type, subjectId: t.subject_id, title: t.title, assigneeUserId: t.assignee_user_id, dueAt: t.due_at, doneAt: t.done_at, createdAt: t.created_at });

/** Ledger data keys an application's activity may show: ids, stages and dates. Never answer text, amounts or addresses. */
const ACTIVITY_KEYS = new Set(["from", "to", "stage", "archived", "archivedAt", "submittedAt", "decidedAt", "snapshotDocumentId", "requestId", "sentAt", "source", "migration"]);
/** The newest activity entries shown on an application. */
const ACTIVITY_LIMIT = 200;

/** The application's ledger events, newest first: `{ id, type, at, actor, data }` with ids, stages and dates only. */
async function activityOf(ctx: ServiceContext, row: Oa) {
  const q = { workspaceId: row.workspace_id, subjectType: "outside_application", subjectId: row.id };
  const total = await ctx.ledger.count(q);
  const events = await ctx.ledger.list({ ...q, offset: Math.max(0, total - ACTIVITY_LIMIT), limit: ACTIVITY_LIMIT });
  return events.reverse().map((e) => ({ id: e.id, type: e.eventType, at: e.occurredAt, actor: e.actor, data: Object.fromEntries(Object.entries(e.data ?? {}).filter(([k]) => ACTIVITY_KEYS.has(k))) }));
}

/**
 * The "AI use" note: the questions whose current answer is text the assistant drafted and a person
 * accepted (provenance `assist`). Empty when the assistant wrote none of it.
 */
export function aiUseOf(qa: { q: Question; latest: Answer | null }[]) {
  const questions = qa.filter((x) => x.latest?.provenance === "assist").map(({ q, latest }) => ({ questionId: q.id, prompt: q.prompt, phase: q.phase, version: latest!.version, savedAt: latest!.created_at }));
  return { used: questions.length > 0, count: questions.length, questions };
}

async function detailView(ctx: ServiceContext, row: Oa) {
  const [qa, docs, tasks, record, activity] = await Promise.all([
    questionsWithAnswers(ctx, row),
    ctx.repos.table("documents").find({ workspace_id: row.workspace_id, subject_type: "outside_application", subject_id: row.id }, { orderBy: "created_at" }),
    ctx.repos.table("tasks").find({ workspace_id: row.workspace_id, subject_type: "outside_application", subject_id: row.id }, { orderBy: "created_at" }),
    row.funder_record_id ? ctx.repos.table("funder_records").one({ id: row.funder_record_id, workspace_id: row.workspace_id }) : Promise.resolve(null),
    activityOf(ctx, row),
  ]);
  const names = await namesOf(ctx, [row.owner_user_id]);
  const counts = { total: qa.length, approved: qa.filter((x) => x.q.status === "approved").length };
  return {
    ...listItem(ctx, row, counts, names),
    previousStage: row.previous_stage,
    allowedMoves: row.archived_at ? [] : plainMovesFrom(row.stage as OutsideStage),
    listing: row.listing,
    sourceRef: row.source_ref,
    listingUrl: row.listing_url,
    portalUrl: row.portal_url,
    currency: row.currency,
    askByYear: yearsView(row.ask_by_year, row.currency),
    // The submission and the decision, flat (as the web reads them) and grouped.
    submittedAt: row.submitted_at,
    submissionMethod: row.submission_method,
    confirmationRef: row.confirmation_ref,
    receiptDocumentId: row.receipt_document_id,
    snapshotDocumentId: row.snapshot_document_id,
    snapshotSha256: row.snapshot_sha256,
    decidedAt: row.decided_at,
    awardedAmount: money(row.awarded_amount_minor, row.currency),
    awardByYear: yearsView(row.award_by_year, row.currency),
    grantStart: row.grant_start,
    grantEnd: row.grant_end,
    decisionNotes: row.decision_notes,
    nextCycleOn: row.next_cycle_on,
    submission: row.submitted_at
      ? { submittedAt: row.submitted_at, method: row.submission_method, methodLabel: METHOD_LABEL[row.submission_method ?? ""] ?? null, confirmationRef: row.confirmation_ref, receiptDocumentId: row.receipt_document_id, snapshot: row.snapshot_document_id ? { documentId: row.snapshot_document_id, sha256: row.snapshot_sha256 } : null }
      : null,
    decision: row.decided_at || row.next_cycle_on || row.decision_notes
      ? { decidedAt: row.decided_at, awardedAmount: money(row.awarded_amount_minor, row.currency), awardByYear: yearsView(row.award_by_year, row.currency), grantStart: row.grant_start, grantEnd: row.grant_end, notes: row.decision_notes, nextCycleOn: row.next_cycle_on }
      : null,
    customFields: row.custom_fields,
    funderRecord: record ? { id: record.id, name: record.name, portalLoginHolder: record.portal_login_holder, portalUrl: record.portal_url } : null,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    questions: qa.map(({ q, latest }) => questionView(q, latest)),
    aiUse: aiUseOf(qa),
    requiredDocuments: await requiredDocumentsView(ctx, row),
    documents: docs.map(docView),
    tasks: tasks.map(taskView),
    activity,
  };
}

// ------------------------------------------------------------------------------------ list, create, read, edit

export const listQuery = z.object({ stage: z.string().optional(), q: z.string().max(200).optional(), archived: z.enum(["true", "false", "all"]).optional() }).strict();

export async function listOutside(ctx: ServiceContext, query: z.output<typeof listQuery> = {}) {
  const ws = await outsideWorkspace(ctx, "applications:read");
  const stages = query.stage ? query.stage.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (stages.some((s) => !(OUTSIDE_STAGES as readonly string[]).includes(s))) throw new ApiError(400, "bad_request", `stage must be one of ${OUTSIDE_STAGES.join(", ")}`, [{ code: "invalid_parameter", field: "stage" }]);
  let rows = await ctx.repos.table("outside_applications").find({ workspace_id: ws.id, ...(stages.length ? { stage: stages } : {}) }, { orderBy: "updated_at", ascending: false, limit: 5000 });
  const archived = query.archived ?? "false";
  if (archived !== "all") rows = rows.filter((r) => (r.archived_at !== null) === (archived === "true"));
  const needle = query.q?.trim().toLowerCase();
  if (needle) rows = rows.filter((r) => `${r.title} ${r.funder_name ?? ""} ${r.program_name ?? ""}`.toLowerCase().includes(needle));
  const counts = await questionCounts(ctx, ws.id, rows.map((r) => r.id));
  const names = await namesOf(ctx, rows.map((r) => r.owner_user_id));
  return rows.map((r) => listItem(ctx, r, counts.get(r.id)!, names));
}

export const createInput = z
  .object({
    source: z.enum(["opengrants", "manual", "link"]).default("manual"),
    sourceRef: z.string().trim().min(1).max(300).optional(),
    listing: listingInput.optional(),
    title: line(300),
    funderName: line(200),
    programName: optLine(300).optional(),
    funderRecordId: z.uuid().optional(),
    listingUrl: webUrl.optional(),
    portalUrl: webUrl.optional(),
    loiDue: isoDate.optional(),
    fullDue: isoDate.optional(),
    internalDue: isoDate.optional(),
    rolling: z.boolean().optional(),
    askAmount: moneyInput.optional(),
    stage: z.enum(["prospect", "drafting"]).default("drafting"),
  })
  .strict()
  .refine((v) => v.source !== "opengrants" || !!v.sourceRef, { message: "An OpenGrants listing needs its listing id", path: ["sourceRef"] });

/** The funder record to link: the one named, or one whose name matches (ignoring case), or none. */
async function funderRecordFor(ctx: ServiceContext, workspaceId: string, id: string | null | undefined, name: string | null) {
  if (id) {
    const r = await ctx.repos.table("funder_records").one({ id, workspace_id: workspaceId });
    if (!r) throw notFound("Funder record");
    return r.id;
  }
  if (!name) return null;
  const key = name.trim().toLowerCase();
  return (await ctx.repos.table("funder_records").find({ workspace_id: workspaceId })).find((r) => r.name.trim().toLowerCase() === key)?.id ?? null;
}

/**
 * Create an outside application, or return the one already tracking that OpenGrants listing.
 * A link (or OpenGrants listing) that points at an opportunity open on this GMS is refused for
 * drafting: that funder takes applications here, as a built-in application.
 */
export async function createOutside(ctx: ServiceContext, input: z.output<typeof createInput>): Promise<{ created: boolean; application: Awaited<ReturnType<typeof detailView>> }> {
  const ws = await outsideWorkspace(ctx, "applications:write");
  if (input.source === "opengrants") {
    const existing = await ctx.repos.table("outside_applications").one({ workspace_id: ws.id, source: "opengrants", source_ref: input.sourceRef! });
    if (existing) return { created: false, application: await detailView(ctx, existing) };
  }
  if (input.stage === "drafting" && input.source !== "manual") {
    const here = await matchGmsOpportunity(ctx, { id: input.sourceRef ?? "", title: input.title, url: input.listingUrl ?? input.listing?.url ?? undefined });
    if (here?.competitionId) throw new ApiError(409, "apply_here", "This funder takes applications on this GMS. Start the application from its opportunity page", [{ code: "opportunity", detail: here.opportunityId }, { code: "competition", detail: here.competitionId }]);
  }
  const currency = input.askAmount?.currency ?? "USD";
  const listing = input.listing ? Object.fromEntries(Object.entries(input.listing).filter(([, v]) => v !== null && v !== undefined)) : {};
  const insert = {
    workspace_id: ws.id,
    title: input.title,
    funder_name: input.funderName,
    program_name: input.programName ?? null,
    funder_record_id: await funderRecordFor(ctx, ws.id, input.funderRecordId, input.funderName),
    source: input.source,
    source_ref: input.sourceRef ?? null,
    listing: listing as Oa["listing"],
    listing_url: input.listingUrl ?? input.listing?.url ?? null,
    portal_url: input.portalUrl ?? null,
    stage: input.stage,
    currency,
    ask_amount_minor: input.askAmount ? minorOf(input.askAmount) : null,
    loi_due: input.loiDue ?? null,
    full_due: input.fullDue ?? null,
    internal_due: input.internalDue ?? null,
    rolling: input.rolling ?? false,
    owner_user_id: ctx.actor.userId,
    created_by: ctx.actor.userId,
  };
  let row: Oa;
  try {
    row = await guardWrite("An outside application for this listing", () => ctx.repos.table("outside_applications").insert(insert));
  } catch (e) {
    // Two saves of the same listing at once: the other one won; return it.
    const raced = input.source === "opengrants" && e instanceof ApiError && e.status === 409 ? await ctx.repos.table("outside_applications").one({ workspace_id: ws.id, source: "opengrants", source_ref: input.sourceRef! }) : null;
    if (raced) return { created: false, application: await detailView(ctx, raced) };
    throw e;
  }
  await audit(ctx, "outside_application.created", "outside_application", row.id, { source: row.source, stage: row.stage });
  return { created: true, application: await detailView(ctx, row) };
}

export async function getOutside(ctx: ServiceContext, id: string) {
  const { row } = await loadOutside(ctx, id, "applications:read");
  return detailView(ctx, row);
}

/** Everything a person edits by hand. Never the stage, the submission or the decision. */
export const patchInput = z
  .object({
    title: line(300).optional(),
    funderName: line(200).optional(),
    programName: optLine(300).nullable().optional(),
    funderRecordId: z.uuid().nullable().optional(),
    listingUrl: webUrl.nullable().optional(),
    portalUrl: webUrl.nullable().optional(),
    loiDue: isoDate.nullable().optional(),
    fullDue: isoDate.nullable().optional(),
    internalDue: isoDate.nullable().optional(),
    rolling: z.boolean().optional(),
    askAmount: moneyInput.nullable().optional(),
    askByYear: byYearInput.optional(),
    ownerUserId: z.uuid().nullable().optional(),
    customFields: customFieldsInput.optional(),
  })
  .strict();

export async function patchOutside(ctx: ServiceContext, id: string, input: z.output<typeof patchInput>) {
  const { ws, row } = await loadOutside(ctx, id, "applications:write");
  writable(row);
  await assertMember(ctx, ws.id, input.ownerUserId);
  // One currency per application: the ask sets it while nothing else is recorded in another.
  const currency = input.askAmount?.currency ?? row.currency;
  if (input.askAmount && input.askAmount.currency !== row.currency && (row.awarded_amount_minor !== null || (Array.isArray(row.ask_by_year) && row.ask_by_year.length > 0 && input.askByYear === undefined))) {
    throw new ApiError(422, "currency_mismatch", `Every amount on this application is in ${row.currency}`);
  }
  const patch: Partial<Oa> = {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.funderName !== undefined ? { funder_name: input.funderName } : {}),
    ...(input.programName !== undefined ? { program_name: input.programName } : {}),
    ...(input.funderRecordId !== undefined ? { funder_record_id: input.funderRecordId === null ? null : await funderRecordFor(ctx, ws.id, input.funderRecordId, null) } : {}),
    ...(input.listingUrl !== undefined ? { listing_url: input.listingUrl } : {}),
    ...(input.portalUrl !== undefined ? { portal_url: input.portalUrl } : {}),
    ...(input.loiDue !== undefined ? { loi_due: input.loiDue } : {}),
    ...(input.fullDue !== undefined ? { full_due: input.fullDue } : {}),
    ...(input.internalDue !== undefined ? { internal_due: input.internalDue } : {}),
    ...(input.rolling !== undefined ? { rolling: input.rolling } : {}),
    ...(input.askAmount !== undefined ? { ask_amount_minor: input.askAmount === null ? null : minorOf(input.askAmount), currency } : {}),
    ...(input.askByYear !== undefined ? { ask_by_year: yearsOf(input.askByYear, currency) as unknown as Oa["ask_by_year"] } : {}),
    ...(input.ownerUserId !== undefined ? { owner_user_id: input.ownerUserId } : {}),
    ...(input.customFields !== undefined ? { custom_fields: input.customFields as Oa["custom_fields"] } : {}),
  };
  const [saved] = await guardWrite("This change", () => ctx.repos.table("outside_applications").update({ id: row.id, workspace_id: ws.id }, patch));
  return detailView(ctx, saved ?? row);
}

// ------------------------------------------------------------------------------------ stage changes (packages/workflow)

const subjectOf = (row: Oa) => ({ id: row.id, stage: row.stage as OutsideStage, previousStage: (row.previous_stage as OutsideStage | null) ?? null, archivedAt: row.archived_at });

/**
 * Run one action through the machine. `extra` columns are written in the same update as the
 * stage; the update names the stage it read, so a change made meanwhile is not overwritten.
 */
async function transition(ctx: ServiceContext, row: Oa, req: OutsideRequest, extra: Partial<Oa> = {}, ledgerExtra: Record<string, unknown> = {}) {
  const now = ctx.now().toISOString();
  let wrote: Oa | undefined;
  const result = await transitionOutside(subjectOf(row), req, { id: ctx.actor.id, kind: "applicant" }, {
    write: async (w) => {
      const [saved] = await guardWrite("This change", () => ctx.repos.table("outside_applications").update({ id: row.id, workspace_id: row.workspace_id, stage: row.stage, archived_at: row.archived_at }, { ...(w.patch as Partial<Oa>), ...extra }));
      if (!saved) throw new ApiError(409, "conflict", "This application changed while you were working on it. Reload it and try again");
      wrote = saved;
    },
    ledger: (e) => audit(ctx, e.eventType, "outside_application", e.subjectId, { ...e.data, ...ledgerExtra }),
    emit: async () => {},
  }, now);
  if (!result.ok) throw new ApiError(409, result.code === "guard_failed" ? "guard_failed" : "invalid_transition", result.reason);
  return wrote!;
}

export const stageInput = z.object({ to: z.enum(OUTSIDE_STAGES) }).strict();

/** Plain moves only: submitted, awarded and declined each need their own record. */
export async function setStage(ctx: ServiceContext, id: string, input: z.output<typeof stageInput>) {
  const { row } = await loadOutside(ctx, id, "applications:write");
  return detailView(ctx, await transition(ctx, row, { action: "move", to: input.to }));
}

export async function reopen(ctx: ServiceContext, id: string) {
  const { row } = await loadOutside(ctx, id, "applications:write");
  return detailView(ctx, await transition(ctx, row, { action: "reopen" }));
}

export async function archive(ctx: ServiceContext, id: string, on: boolean) {
  const { row } = await loadOutside(ctx, id, "applications:write");
  return detailView(ctx, await transition(ctx, row, { action: on ? "archive" : "unarchive" }));
}

export const submitInput = z
  .object({
    submittedAt: z.union([z.iso.datetime({ offset: true }), isoDate]),
    method: z.enum(SUBMISSION_METHODS),
    confirmationRef: optLine(200).optional(),
    receiptDocumentId: z.uuid().optional(),
  })
  .strict();

/** The questions and latest answers, as the snapshot and the export print them. */
async function printable(ctx: ServiceContext, row: Oa) {
  return (await questionsWithAnswers(ctx, row)).map(({ q, latest }) => {
    const counts = countText(latest?.body ?? "");
    return { phase: q.phase as "loi" | "full" | "report", section: q.section, prompt: q.prompt, limit: limitText(q), answer: latest?.body ?? "", counts: countsText(counts) };
  });
}
const countsText = (c: TextCounts) => `${c.words.toLocaleString("en-US")} word${c.words === 1 ? "" : "s"} · ${c.chars.toLocaleString("en-US")} characters · ${c.charsNoSpaces.toLocaleString("en-US")} without spaces`;

async function organizationName(ctx: ServiceContext, workspaceId: string) {
  const w = await ctx.repos.table("workspaces").one({ id: workspaceId });
  return w?.legal_name ?? w?.display_name ?? "Organization";
}

/** The "as submitted" PDF for these answers at this time. The same answers and time give the same bytes. */
export async function renderSnapshot(ctx: ServiceContext, row: Oa, submittedAt: string, method: string, confirmationRef: string | null) {
  return renderOutsideSnapshot(
    { title: row.title, organization: await organizationName(ctx, row.workspace_id), funder: row.funder_name, program: row.program_name, submittedAt, method: METHOD_LABEL[method] ?? method, confirmationRef, questions: await printable(ctx, row) },
    { reference: `Outside application ${row.id}` },
  );
}

/**
 * Record that the person submitted the application elsewhere: the date, how, the confirmation and
 * a receipt, plus a PDF of every question and its latest answer, stored as a document with its
 * SHA-256. Human only: an agent's call becomes an approval and runs as the person who approves it.
 */
export async function recordSubmission(ctx: ServiceContext, id: string, input: z.output<typeof submitInput>) {
  const { ws, row } = await loadOutside(ctx, id, "applications:write");
  requirePerson(ctx, "Recording a submission");
  const submittedAt = new Date(input.submittedAt.length === 10 ? `${input.submittedAt}T12:00:00Z` : input.submittedAt).toISOString();
  if (Date.parse(submittedAt) > ctx.now().getTime() + 86_400_000) throw new ApiError(422, "submitted_in_future", "The submission date cannot be in the future");
  // Refuse before anything is stored.
  const check = checkOutside(subjectOf(row), { action: "submit", submittedAt, method: input.method }, { kind: "applicant" }, ctx.now().toISOString());
  if (!check.ok) throw new ApiError(409, check.code === "guard_failed" ? "guard_failed" : "invalid_transition", check.reason);
  if (input.receiptDocumentId && !(await ctx.repos.table("documents").one({ id: input.receiptDocumentId, workspace_id: ws.id, subject_type: "outside_application", subject_id: row.id }))) throw notFound("Receipt document");
  if (!ctx.ports.storage) throw new ApiError(503, "storage_unavailable", "File storage is not configured on this server, so the as-submitted copy cannot be kept");
  const confirmationRef = input.confirmationRef ?? null;
  const bytes = await renderSnapshot(ctx, row, submittedAt, input.method, confirmationRef);
  const sha256 = await sha256Hex(bytes);
  const stored = await ctx.ports.storage.put(`outside/${row.id}/${sha256}.pdf`, bytes, "application/pdf");
  const doc = await ctx.repos.table("documents").insert({ workspace_id: ws.id, owner_workspace_id: ws.id, subject_type: "outside_application", subject_id: row.id, name: `As submitted - ${row.title}.pdf`.slice(0, 250), mime: "application/pdf", size: bytes.byteLength, sha256, storage: stored.storage, path: stored.path, uploaded_by: ctx.actor.userId });
  try {
    const saved = await transition(ctx, row, { action: "submit", submittedAt, method: input.method }, { confirmation_ref: confirmationRef, receipt_document_id: input.receiptDocumentId ?? null, snapshot_document_id: doc.id, snapshot_sha256: sha256 }, { snapshotDocumentId: doc.id });
    return detailView(ctx, saved);
  } catch (e) {
    await ctx.repos.table("documents").remove({ id: doc.id, workspace_id: ws.id });
    throw e;
  }
}

export const decisionInput = z
  .object({
    outcome: z.enum(["awarded", "declined", "withdrawn"]),
    awardedAmount: moneyInput.optional(),
    awardByYear: byYearInput.optional(),
    grantStart: isoDate.optional(),
    grantEnd: isoDate.optional(),
    notes: paragraph(5000).optional(),
    nextCycleOn: isoDate.optional(),
  })
  .strict()
  .refine((v) => v.outcome !== "awarded" || !!v.awardedAmount, { message: "Give the amount awarded", path: ["awardedAmount"] })
  .refine((v) => !v.grantStart || !v.grantEnd || v.grantEnd >= v.grantStart, { message: "The grant ends after it starts", path: ["grantEnd"] });

/** Record the funder's answer. Human only, like the submission. */
export async function recordDecision(ctx: ServiceContext, id: string, input: z.output<typeof decisionInput>) {
  const { row } = await loadOutside(ctx, id, "applications:write");
  requirePerson(ctx, "Recording a decision");
  let currency = row.currency;
  if (input.awardedAmount && input.awardedAmount.currency !== row.currency) {
    if (row.ask_amount_minor !== null || (Array.isArray(row.ask_by_year) && row.ask_by_year.length)) throw new ApiError(422, "currency_mismatch", `Every amount on this application is in ${row.currency}`);
    currency = input.awardedAmount.currency;
  }
  const awarded = input.outcome === "awarded" && input.awardedAmount ? minorOf(input.awardedAmount) : null;
  const extra: Partial<Oa> = {
    currency,
    decision_notes: input.notes ?? null,
    next_cycle_on: input.nextCycleOn ?? null,
    ...(input.outcome === "awarded" ? { award_by_year: yearsOf(input.awardByYear ?? [], currency) as unknown as Oa["award_by_year"], grant_start: input.grantStart ?? null, grant_end: input.grantEnd ?? null } : {}),
  };
  const saved = await transition(ctx, row, { action: "decide", outcome: input.outcome, awardedAmountMinor: awarded }, extra);
  return detailView(ctx, saved);
}

// ------------------------------------------------------------------------------------ questions and answers

const questionFields = {
  phase: z.enum(QUESTION_PHASES).optional(),
  section: optLine(200).nullable().optional(),
  position: z.number().int().min(0).max(100_000).optional(),
  prompt: z.string().transform(cleanText).pipe(z.string().min(1).max(5000)),
  guidance: paragraph(10_000).nullable().optional(),
  limitKind: z.enum(LIMIT_KINDS).nullable().optional(),
  limitValue: z.number().int().min(1).max(1_000_000).nullable().optional(),
  required: z.boolean().optional(),
  assigneeUserId: z.uuid().nullable().optional(),
};
const oneQuestion = z.object(questionFields).strict().refine((q) => (q.limitKind ?? null) === null || (q.limitValue ?? null) !== null, { message: "A limit needs a number", path: ["limitValue"] });
export const questionsInput = z.union([z.object({ questions: z.array(oneQuestion).min(1).max(100) }).strict(), oneQuestion]).transform((v) => ("questions" in v ? v.questions : [v]));

export async function listQuestions(ctx: ServiceContext, id: string) {
  const { row } = await loadOutside(ctx, id, "applications:read");
  return (await questionsWithAnswers(ctx, row)).map(({ q, latest }) => questionView(q, latest));
}

/** Add questions (one, or a reviewed list from the paste flow), after the ones already there. */
export async function addQuestions(ctx: ServiceContext, id: string, input: z.output<typeof questionsInput>) {
  const { ws, row } = await loadOutside(ctx, id, "applications:write");
  writable(row);
  const existing = await ctx.repos.table("outside_questions").find({ workspace_id: ws.id, outside_application_id: row.id });
  if (existing.length + input.length > MAX_QUESTIONS_PER_APPLICATION) throw new ApiError(422, "too_many_questions", `An application holds at most ${MAX_QUESTIONS_PER_APPLICATION} questions`);
  for (const q of input) await assertMember(ctx, ws.id, q.assigneeUserId);
  let next = existing.reduce((m, q) => Math.max(m, q.position + 1), 0);
  const made: Question[] = [];
  for (const q of input) {
    made.push(
      await guardWrite("This question", () =>
        ctx.repos.table("outside_questions").insert({
          workspace_id: ws.id,
          outside_application_id: row.id,
          phase: q.phase ?? "full",
          section: q.section ?? null,
          position: q.position ?? next++,
          prompt: q.prompt,
          guidance: q.guidance ?? null,
          limit_kind: q.limitKind && q.limitValue ? q.limitKind : null,
          limit_value: q.limitKind && q.limitValue ? q.limitValue : null,
          required: q.required ?? false,
          assignee_user_id: q.assigneeUserId ?? null,
        }),
      ),
    );
  }
  await ctx.repos.table("outside_applications").update({ id: row.id, workspace_id: ws.id }, {});
  return made.map((q) => questionView(q, null));
}

export const parseInput = z.object({ text: z.string().max(100_000), phase: z.enum(QUESTION_PHASES).optional(), mode: z.enum(["deterministic", "ai"]).optional() }).strict();

/**
 * Propose questions from pasted text by numbering, blank lines and the usual limit phrasings,
 * saving nothing. `mode: "ai"` (the assistant reading a funder's guidelines, owner decision D5) is
 * `parseGuidelinesText` in ./drafting.ts; the route sends it there.
 */
export async function parseQuestionText(ctx: ServiceContext, id: string, input: z.output<typeof parseInput>) {
  await loadOutside(ctx, id, "applications:write");
  if (input.mode === "ai") throw new ApiError(400, "bad_request", "Reading guidelines with the assistant goes through parseGuidelinesText");
  return { mode: "deterministic" as const, questions: parseQuestions(input.text, input.phase ?? "full") };
}

export async function loadQuestion(ctx: ServiceContext, qid: string, scope: "applications:read" | "applications:write") {
  const ws = await outsideWorkspace(ctx, scope);
  const q = await ctx.repos.table("outside_questions").one({ id: qid, workspace_id: ws.id });
  if (!q) throw notFound("Question");
  const row = await ctx.repos.table("outside_applications").one({ id: q.outside_application_id, workspace_id: ws.id });
  if (!row) throw notFound("Question");
  return { ws, q, row };
}

export async function latestAnswer(ctx: ServiceContext, q: Question) {
  return (await ctx.repos.table("outside_answers").find({ workspace_id: q.workspace_id, question_id: q.id }, { orderBy: "version", ascending: false, limit: 1 }))[0] ?? null;
}

/** A question's status is an editorial flag; it changes through changeStatus (guard → write → ledger). */
async function setQuestionStatus(ctx: ServiceContext, q: Question, to: string) {
  if (q.status === to) return q;
  let saved: Question | undefined;
  await changeStatus(ctx, {
    event: "outside_question.status_changed",
    subjectType: "outside_question",
    subjectId: q.id,
    current: q.status,
    from: QUESTION_STATUSES,
    to,
    write: async () => {
      [saved] = await ctx.repos.table("outside_questions").update({ id: q.id, workspace_id: q.workspace_id }, { status: to });
    },
    data: { outsideApplicationId: q.outside_application_id },
  });
  return saved ?? q;
}

export const questionPatch = z
  .object({ ...questionFields, prompt: questionFields.prompt.optional(), status: z.enum(["draft", "ready", "approved"]).optional() })
  .strict()
  .refine((q) => (q.limitKind ?? null) === null || q.limitValue !== null, { message: "A limit needs a number", path: ["limitValue"] });

export async function patchQuestion(ctx: ServiceContext, qid: string, input: z.output<typeof questionPatch>) {
  const { ws, q, row } = await loadQuestion(ctx, qid, "applications:write");
  writable(row);
  await assertMember(ctx, ws.id, input.assigneeUserId);
  const limitKind = input.limitKind === undefined ? q.limit_kind : input.limitKind;
  const limitValue = input.limitValue === undefined ? q.limit_value : input.limitValue;
  const clearLimit = input.limitKind === null || input.limitValue === null;
  const [saved] = await guardWrite("This question", () =>
    ctx.repos.table("outside_questions").update(
      { id: q.id, workspace_id: ws.id },
      {
        ...(input.phase !== undefined ? { phase: input.phase } : {}),
        ...(input.section !== undefined ? { section: input.section } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
        ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
        ...(input.guidance !== undefined ? { guidance: input.guidance } : {}),
        ...(input.limitKind !== undefined || input.limitValue !== undefined ? (clearLimit ? { limit_kind: null, limit_value: null } : { limit_kind: limitKind, limit_value: limitValue }) : {}),
        ...(input.required !== undefined ? { required: input.required } : {}),
        ...(input.assigneeUserId !== undefined ? { assignee_user_id: input.assigneeUserId } : {}),
      },
    ),
  );
  let current = saved ?? q;
  const latest = await latestAnswer(ctx, current);
  if (input.status) {
    if (!latest || !latest.body.trim()) throw new ApiError(422, "no_answer", "Write an answer before marking the question ready or approved");
    current = await setQuestionStatus(ctx, current, input.status);
  }
  return questionView(current, latest);
}

export async function deleteQuestion(ctx: ServiceContext, qid: string) {
  const { ws, q, row } = await loadQuestion(ctx, qid, "applications:write");
  writable(row);
  await ctx.repos.table("outside_answers").remove({ workspace_id: ws.id, question_id: q.id });
  await ctx.repos.table("outside_questions").remove({ id: q.id, workspace_id: ws.id });
  return { id: q.id, deleted: true };
}

export const answerInput = z
  .object({
    body: z.string().max(100_000),
    libraryAnswerId: z.uuid().optional(),
    /** `assist`: the person accepted (and perhaps edited) a draft from the assistant. `prior_submission`: reused from an earlier report. */
    provenance: z.enum(["assist", "prior_submission"]).optional(),
    /** With `prior_submission`: the earlier report answer the text came from. */
    sourceAnswerId: z.uuid().optional(),
  })
  .strict()
  .refine((v) => !(v.libraryAnswerId && v.provenance), { message: "An answer comes from the library or from the assistant or an earlier report, not both", path: ["provenance"] })
  .refine((v) => (v.provenance === "prior_submission") === !!v.sourceAnswerId, { message: "Name the earlier report answer the text was reused from", path: ["sourceAnswerId"] });

type LibraryUse = { outsideApplicationId?: string; questionId?: string; applicationId?: string; version: number; insertedAt: string };

/**
 * Text reused from an earlier report must come from a report answer of this workspace, on another
 * report obligation than the question's own (contract: "Reuse from an earlier report").
 */
async function assertPriorReportAnswer(ctx: ServiceContext, workspaceId: string, q: Question, sourceAnswerId: string) {
  const src = await ctx.repos.table("outside_answers").one({ id: sourceAnswerId, workspace_id: workspaceId });
  const srcQ = src ? await ctx.repos.table("outside_questions").one({ id: src.question_id, workspace_id: workspaceId }) : null;
  if (!src || !srcQ || srcQ.phase !== "report" || !srcQ.obligation_id) throw notFound("Earlier report answer");
  if (q.phase !== "report" || srcQ.obligation_id === q.obligation_id) throw new ApiError(422, "not_an_earlier_report", "Text can be reused from another report's answers into a report question");
}

/**
 * Save an answer as a new version. Provenance is `agent:<clientId>` for an agent; otherwise
 * `library` when it came from the answer library (and the library answer records where it was
 * used), `assist` when the person accepted the assistant's draft, `prior_submission` when reused
 * from an earlier report, `user` otherwise. An edit of an approved answer sends the question back
 * to draft.
 */
export async function putAnswer(ctx: ServiceContext, qid: string, input: z.output<typeof answerInput>) {
  const { ws, q, row } = await loadQuestion(ctx, qid, "applications:write");
  writable(row);
  const library = input.libraryAnswerId ? await ctx.repos.table("answers").one({ id: input.libraryAnswerId, workspace_id: ws.id }) : null;
  if (input.libraryAnswerId) {
    if (!ctx.scopes.includes("library:read")) throw new ApiError(403, "insufficient_scope", "This action needs the library:read scope");
    if (!library) throw notFound("Answer");
  }
  // An agent's save is always recorded as the agent's, whatever it says the text is.
  const provenance = ctx.actor.clientId ? `agent:${ctx.actor.clientId.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 200) || "client"}` : library ? "library" : (input.provenance ?? "user");
  if (input.provenance === "prior_submission") await assertPriorReportAnswer(ctx, ws.id, q, input.sourceAnswerId!);
  const body = input.body.replace(/\r\n?/g, "\n");
  let saved: Answer | null = null;
  for (let attempt = 0; attempt < 3 && !saved; attempt++) {
    const version = ((await latestAnswer(ctx, q))?.version ?? 0) + 1;
    try {
      saved = await ctx.repos.table("outside_answers").insert({ workspace_id: ws.id, question_id: q.id, version, body, provenance, library_answer_id: library?.id ?? null, created_by: ctx.actor.userId });
    } catch (e) {
      // Someone saved the same question at the same moment: take the next version.
      if (!(e instanceof Error && "kind" in e && (e as { kind: string }).kind === "conflict")) throw e;
    }
  }
  if (!saved) throw new ApiError(409, "conflict", "This answer is being saved elsewhere. Try again");
  if (library) {
    const use: LibraryUse = { outsideApplicationId: row.id, questionId: q.id, version: library.version, insertedAt: ctx.now().toISOString() };
    const same = (u: LibraryUse) => u.questionId === q.id;
    for (const other of await ctx.repos.table("answers").find({ workspace_id: ws.id })) {
      if (other.id === library.id) continue;
      const kept = (other.used_in as unknown as LibraryUse[]).filter((u) => !same(u));
      if (kept.length !== (other.used_in as unknown[]).length) await ctx.repos.table("answers").update({ id: other.id, workspace_id: ws.id }, { used_in: kept as unknown as Row<"answers">["used_in"] });
    }
    await ctx.repos.table("answers").update({ id: library.id, workspace_id: ws.id }, { used_in: [...(library.used_in as unknown as LibraryUse[]).filter((u) => !same(u)), use] as unknown as Row<"answers">["used_in"] });
  }
  let current = q;
  if (q.status === "empty" && body.trim()) current = await setQuestionStatus(ctx, q, "draft");
  else if (q.status === "approved") current = await setQuestionStatus(ctx, q, "draft");
  await ctx.repos.table("outside_applications").update({ id: row.id, workspace_id: ws.id }, {});
  const view = answerView(saved, current);
  return { ...view, question: questionView(current, saved) };
}

export async function listAnswerVersions(ctx: ServiceContext, qid: string) {
  const { q } = await loadQuestion(ctx, qid, "applications:read");
  return (await ctx.repos.table("outside_answers").find({ workspace_id: q.workspace_id, question_id: q.id }, { orderBy: "version", ascending: false })).map((a) => answerView(a, q));
}

// ------------------------------------------------------------------------------------ export

export type ExportFormat = "txt" | "md" | "pdf";

/** Questions and latest answers, to paste into a funder's portal or keep. */
export async function exportOutside(ctx: ServiceContext, id: string, format: ExportFormat): Promise<{ body: string | Uint8Array; contentType: string; filename: string }> {
  const { row } = await loadOutside(ctx, id, "applications:read");
  const items = await printable(ctx, row);
  const base = row.title.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "application";
  const heading = [row.funder_name ? `Funder: ${row.funder_name}` : null, row.program_name ? `Program: ${row.program_name}` : null].filter((h): h is string => h !== null);
  if (format === "txt") {
    const parts = [row.title, ...heading, ...items.map((q, i) => `${i + 1}. ${q.prompt}${q.limit ? ` (limit: ${q.limit})` : ""}\n\n${q.answer || "(no answer yet)"}`)];
    return { body: parts.join("\n\n") + "\n", contentType: "text/plain; charset=utf-8", filename: `${base}.txt` };
  }
  if (format === "md") {
    const parts = [`# ${row.title}`, ...heading.map((h) => `**${h.replace(": ", ":** ")}`), ...items.map((q, i) => `## ${i + 1}. ${q.prompt.replace(/\n/g, " ")}${q.limit ? `\n\n_Limit: ${q.limit}_` : ""}\n\n${q.answer || "_No answer yet._"}`)];
    return { body: parts.join("\n\n") + "\n", contentType: "text/markdown; charset=utf-8", filename: `${base}.md` };
  }
  const fields: [string, string][] = [...(row.funder_name ? [["Funder", row.funder_name] as [string, string]] : []), ...(row.program_name ? [["Program", row.program_name] as [string, string]] : [])];
  const blocks: Block[] = [{ type: "heading", level: 1, text: row.title }, ...(fields.length ? [{ type: "fields" as const, rows: fields }] : [])];
  items.forEach((q, i) => {
    blocks.push({ type: "heading", level: 3, text: `${i + 1}. ${q.prompt}` });
    if (q.limit) blocks.push({ type: "paragraph", text: `Limit: ${q.limit}` });
    for (const p of (q.answer || "No answer yet.").split(/\n{2,}/)) blocks.push({ type: "paragraph", text: p.replace(/\n/g, " ") });
  });
  const bytes = await renderPdf({ title: row.title, header: await organizationName(ctx, row.workspace_id), footer: "Exported from OpenGrants GMS", createdAt: ctx.now().toISOString(), blocks });
  return { body: bytes, contentType: "application/pdf", filename: `${base}.pdf` };
}

// ------------------------------------------------------------------------------------ documents

/** `award_letter` marks the funder's award letter, shown on the outside award page (v1.7.0). */
const outsideDocType = z.enum(["award_letter"]).optional();
export const documentInput = z.union([
  z.object({ name: z.string().trim().min(1).max(300), mime: z.string().min(3).max(120), contentBase64: z.string().min(1), docType: outsideDocType }).strict(),
  // A Passport locker file referenced with its details, as built-in attachments accept; the GMS keeps no copy.
  z.object({ name: z.string().trim().min(1).max(300), mime: z.string().min(3).max(120), passportDocumentId: z.string().min(1).max(200), size: z.number().int().min(0), sha256: z.string().regex(/^[0-9a-f]{64}$/), docType: outsideDocType }).strict(),
  // A file already in the Passport locker, by id: name, type and hash come from the locker.
  z.object({ passportDocumentId: z.string().min(1).max(200), docType: outsideDocType }).strict(),
]);

/** Attach a file to an outside application (its checklist or a receipt). The applicant's own document. */
export async function attachOutsideDocument(ctx: ServiceContext, id: string, input: z.output<typeof documentInput>) {
  const { ws, row } = await loadOutside(ctx, id, "applications:write");
  writable(row);
  if ("name" in input) refuseSensitiveFilename(input.name);
  const base = { workspace_id: ws.id, owner_workspace_id: ws.id, subject_type: "outside_application", subject_id: row.id, uploaded_by: ctx.actor.userId, doc_type: input.docType ?? null };
  let doc: Row<"documents">;
  if ("passportDocumentId" in input && "sha256" in input) {
    doc = await ctx.repos.table("documents").insert({ ...base, name: input.name, mime: input.mime, size: input.size, sha256: input.sha256, storage: "supabase", path: `passport:${input.passportDocumentId}`, passport_document_id: input.passportDocumentId });
  } else if ("passportDocumentId" in input) {
    const found = (await listMyDocuments(ctx)).find((d) => d.id === input.passportDocumentId);
    if (!found) throw notFound("Passport locker document");
    if (!found.sha256) throw new ApiError(422, "document_not_attachable", "This locker document has no recorded hash, so it cannot be attached. Upload the file instead");
    doc = await ctx.repos.table("documents").insert({ ...base, name: found.name ?? found.kind, mime: found.mimeType ?? "application/octet-stream", size: 0, sha256: found.sha256, storage: "supabase", path: `passport:${found.id}`, passport_document_id: found.id });
  } else {
    if (!ctx.ports.storage) throw new ApiError(503, "storage_unavailable", "File storage is not configured on this server");
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(input.contentBase64), (c) => c.charCodeAt(0));
    } catch {
      throw new ApiError(400, "bad_request", "contentBase64 is not valid base64");
    }
    if (bytes.byteLength > MAX_UPLOAD) throw new ApiError(413, "too_large", "Files up to 25 MB can be attached");
    const sha256 = await sha256Hex(bytes);
    const stored = await ctx.ports.storage.put(`outside/${row.id}/${sha256}`, bytes, input.mime);
    doc = await ctx.repos.table("documents").insert({ ...base, name: input.name, mime: input.mime, size: bytes.byteLength, sha256, storage: stored.storage, path: stored.path });
  }
  return docView(doc);
}

export async function listOutsideDocuments(ctx: ServiceContext, id: string) {
  const { ws, row } = await loadOutside(ctx, id, "applications:read");
  return (await ctx.repos.table("documents").find({ workspace_id: ws.id, subject_type: "outside_application", subject_id: row.id }, { orderBy: "created_at" })).map(docView);
}

/** The bytes of one of the application's own documents (the as-submitted PDF when `documentId` is "snapshot"). */
export async function outsideDocumentFile(ctx: ServiceContext, id: string, documentId: string | "snapshot") {
  const { ws, row } = await loadOutside(ctx, id, "applications:read");
  const docId = documentId === "snapshot" ? row.snapshot_document_id : documentId;
  const doc = docId ? await ctx.repos.table("documents").one({ id: docId, workspace_id: ws.id, subject_type: "outside_application", subject_id: row.id }) : null;
  if (!doc) throw notFound("Document");
  if (doc.passport_document_id) throw new ApiError(409, "held_in_passport", "This file is kept in the Passport locker; open it there");
  const bytes = ctx.ports.storage ? await ctx.ports.storage.get({ storage: doc.storage as "supabase" | "r2", path: doc.path }) : null;
  if (!bytes) throw new ApiError(503, "storage_unavailable", "The file could not be read from storage");
  return { bytes, mime: doc.mime, filename: doc.name.replace(/["\\\r\n]/g, ""), sha256: doc.sha256 };
}

// ------------------------------------------------------------------------------------ CSV import and export

const IMPORT_FIELDS = ["title", "funderName", "programName", "stage", "loiDue", "fullDue", "internalDue", "rolling", "askAmount", "currency", "listingUrl", "portalUrl", "submittedAt", "submissionMethod", "confirmationRef", "awardedAmount", "grantStart", "grantEnd", "notes"] as const;
type ImportField = (typeof IMPORT_FIELDS)[number];

export const importInput = z
  .object({
    csv: z.string().min(1).max(5_000_000),
    /** Which CSV column feeds each field. `title` and `funderName` are required. */
    mapping: z.partialRecord(z.enum(IMPORT_FIELDS), z.string().trim().min(1).max(200)),
    dryRun: z.boolean().default(true),
  })
  .strict();

const STAGE_WORDS: Record<string, OutsideStage> = Object.fromEntries([...OUTSIDE_STAGES.map((s) => [s, s]), ...Object.entries(STAGE_LABEL).map(([k, v]) => [v.toLowerCase(), k]), ["letter of intent", "loi"], ["invited", "invited"], ["not pursued", "not_pursuing"], ["pending", "submitted"], ["funded", "awarded"], ["rejected", "declined"], ["in progress", "drafting"], ["draft", "drafting"]]) as Record<string, OutsideStage>;
const METHOD_WORDS: Record<string, string> = { portal: "portal", online: "portal", "online portal": "portal", email: "email", "e-mail": "email", mail: "mail", post: "mail", "grants.gov": "grants_gov", grants_gov: "grants_gov", other: "other" };

/** YYYY-MM-DD from `2027-05-01` or `5/1/2027`; null for anything else. */
function csvDate(v: string | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  const [y, m, d] = iso ? [iso[1]!, iso[2]!, iso[3]!] : us ? [us[3]!, us[1]!.padStart(2, "0"), us[2]!.padStart(2, "0")] : [];
  if (!y) return null;
  const date = `${y}-${m}-${d}`;
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== date ? null : date;
}
function csvAmount(v: string | undefined, currency: string): number | null | undefined {
  if (v === undefined) return undefined;
  const clean = v.replace(/[$€£,\s]/g, "").replace(/^(USD|EUR|GBP|CAD)/i, "");
  if (!/^\d{1,13}(\.\d{1,3})?$/.test(clean)) return null;
  try {
    return toMinor({ amount: clean, currency });
  } catch {
    return null;
  }
}

type Problem = { field?: ImportField | "mapping"; message: string };
/** One CSV row as the preview shows it: what was read (`values`), how it will be saved (`normalized`) and what is wrong. */
type ImportPreview = { row: number; ok: boolean; problems: Problem[]; values: Partial<Record<ImportField, string>>; normalized: Record<string, unknown>; id?: string };

/** Import outside applications from a CSV (max 500 rows). A dry run (the default) previews each row and its problems and writes nothing. */
export async function importOutsideCsv(ctx: ServiceContext, input: z.output<typeof importInput>) {
  const ws = await outsideWorkspace(ctx, "applications:write");
  const m = mapCsv<ImportField>(input.csv, input.mapping, { maxRows: MAX_IMPORT_ROWS });
  if (!m.header.length || !m.rows.length) throw new ApiError(422, "empty_csv", "The file has no data rows");
  if (m.tooMany) throw new ApiError(422, "too_many_rows", `Import up to ${MAX_IMPORT_ROWS} rows at a time`);
  const needed = (["title", "funderName"] as const).filter((f) => !input.mapping[f] || m.missingColumns.includes(f));
  if (needed.length) throw new ApiError(422, "mapping_incomplete", `Map a column for: ${needed.join(", ")}`, needed.map((f) => ({ code: "unmapped", field: f })));
  const unknown = m.missingColumns.filter((f) => !needed.includes(f as never));
  const records = await ctx.repos.table("funder_records").find({ workspace_id: ws.id });
  const results: ImportPreview[] = [];
  let created = 0;
  const made: Oa[] = [];
  for (const r of m.rows) {
    const v = r.values;
    const problems: Problem[] = [];
    const problem = (field: ImportField, message: string) => void problems.push({ field, message });
    const currency = (v.currency ?? "USD").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) problem("currency", "The currency is not a three-letter code");
    const title = v.title ? cleanLine(v.title).slice(0, 300) : "";
    const funderName = v.funderName ? cleanLine(v.funderName).slice(0, 200) : "";
    if (!title) problem("title", "No title");
    if (!funderName) problem("funderName", "No funder");
    const stage = v.stage ? STAGE_WORDS[v.stage.trim().toLowerCase().replace(/_/g, " ")] ?? STAGE_WORDS[v.stage.trim().toLowerCase()] : "drafting";
    if (!stage) problem("stage", `"${v.stage}" is not a stage`);
    const dates = { loiDue: csvDate(v.loiDue), fullDue: csvDate(v.fullDue), internalDue: csvDate(v.internalDue), submittedAt: csvDate(v.submittedAt), grantStart: csvDate(v.grantStart), grantEnd: csvDate(v.grantEnd) };
    for (const [k, d] of Object.entries(dates)) if (d === null) problem(k as ImportField, `${k} is not a date (use YYYY-MM-DD)`);
    const ask = csvAmount(v.askAmount, currency);
    const awarded = csvAmount(v.awardedAmount, currency);
    if (ask === null) problem("askAmount", "The ask is not an amount");
    if (awarded === null) problem("awardedAmount", "The awarded amount is not an amount");
    const method = v.submissionMethod ? METHOD_WORDS[v.submissionMethod.trim().toLowerCase()] : undefined;
    if (v.submissionMethod && !method) problem("submissionMethod", `"${v.submissionMethod}" is not a way of submitting (portal, email, mail, grants.gov, other)`);
    const pastSubmit = stage === "submitted" || stage === "awarded" || (stage === "declined" && !!dates.submittedAt) || (stage === "withdrawn" && !!dates.submittedAt);
    if ((stage === "submitted" || stage === "awarded") && (!dates.submittedAt || !method)) problem("submittedAt", "A submitted application needs the date submitted and how it was sent");
    if (stage === "awarded" && (awarded === undefined || awarded === null)) problem("awardedAmount", "An awarded application needs the amount awarded");
    const urls: Record<string, string | null> = {};
    for (const k of ["listingUrl", "portalUrl"] as const) {
      if (v[k] === undefined) continue;
      const ok = webUrl.safeParse(v[k]);
      if (!ok.success) problem(k, `${k} is not a web address`);
      else urls[k] = ok.data;
    }
    const values = { title, funderName, programName: v.programName ? cleanLine(v.programName).slice(0, 300) : null, stage, currency, ...dates, rolling: /^(y|yes|true|1)$/i.test(v.rolling ?? ""), askAmount: typeof ask === "number" ? toMoney(ask, currency) : null, awardedAmount: typeof awarded === "number" ? toMoney(awarded, currency) : null, submissionMethod: method ?? null, confirmationRef: v.confirmationRef ? cleanLine(v.confirmationRef).slice(0, 200) : null, ...urls };
    if (problems.length || input.dryRun) {
      results.push({ row: r.line, ok: problems.length === 0, problems, values: v, normalized: values });
      continue;
    }
    const decided = stage === "awarded" || stage === "declined";
    const row = await guardWrite("This row", () =>
      ctx.repos.table("outside_applications").insert({
        workspace_id: ws.id,
        title,
        funder_name: funderName,
        program_name: values.programName,
        funder_record_id: records.find((f) => f.name.trim().toLowerCase() === funderName.toLowerCase())?.id ?? null,
        source: "import",
        stage: stage!,
        currency,
        ask_amount_minor: typeof ask === "number" ? ask : null,
        loi_due: dates.loiDue ?? null,
        full_due: dates.fullDue ?? null,
        internal_due: dates.internalDue ?? null,
        rolling: values.rolling,
        listing_url: urls.listingUrl ?? null,
        portal_url: urls.portalUrl ?? null,
        submitted_at: pastSubmit && dates.submittedAt ? `${dates.submittedAt}T12:00:00.000Z` : null,
        submission_method: pastSubmit ? (method ?? null) : null,
        confirmation_ref: values.confirmationRef,
        awarded_amount_minor: stage === "awarded" && typeof awarded === "number" ? awarded : null,
        grant_start: stage === "awarded" ? (dates.grantStart ?? null) : null,
        grant_end: stage === "awarded" ? (dates.grantEnd ?? null) : null,
        decided_at: decided ? ctx.now().toISOString() : null,
        decision_notes: v.notes ? cleanText(v.notes).slice(0, 5000) : null,
        owner_user_id: ctx.actor.userId,
        created_by: ctx.actor.userId,
      }),
    );
    await audit(ctx, "outside_application.created", "outside_application", row.id, { source: "import", stage: row.stage });
    created++;
    results.push({ row: r.line, ok: true, problems: [], values: v, normalized: values, id: row.id });
    made.push(row);
  }
  const counts = await questionCounts(ctx, ws.id, made.map((r) => r.id));
  const names = await namesOf(ctx, made.map((r) => r.owner_user_id));
  return {
    dryRun: input.dryRun,
    rows: results,
    created: made.map((r) => listItem(ctx, r, counts.get(r.id)!, names)),
    summary: { rows: m.rows.length, valid: results.filter((x) => x.ok).length, created, failed: results.filter((x) => !x.ok).length },
    unknownColumns: unknown,
    refusedColumns: m.refusedColumns,
  };
}

const EXPORT_HEADER = ["id", "title", "funderName", "programName", "stage", "loiDue", "fullDue", "internalDue", "rolling", "askAmount", "currency", "listingUrl", "portalUrl", "submittedAt", "submissionMethod", "confirmationRef", "awardedAmount", "grantStart", "grantEnd", "decidedAt", "nextCycleOn", "archived", "source", "updatedAt"] as const;

/** Every outside application of the workspace, archived ones too, as CSV or JSON. Answers are not included (export each application for those). */
export async function exportOutsideList(ctx: ServiceContext, format: "csv" | "json") {
  const ws = await outsideWorkspace(ctx, "applications:read");
  const rows = await ctx.repos.table("outside_applications").find({ workspace_id: ws.id }, { orderBy: "created_at", limit: 10_000 });
  const items = rows.map((r) => ({
    id: r.id,
    title: r.title,
    funderName: r.funder_name,
    programName: r.program_name,
    stage: r.stage,
    loiDue: r.loi_due,
    fullDue: r.full_due,
    internalDue: r.internal_due,
    rolling: r.rolling,
    askAmount: r.ask_amount_minor === null ? null : toMoney(r.ask_amount_minor, r.currency).amount,
    currency: r.currency,
    listingUrl: r.listing_url,
    portalUrl: r.portal_url,
    submittedAt: r.submitted_at,
    submissionMethod: r.submission_method,
    confirmationRef: r.confirmation_ref,
    awardedAmount: r.awarded_amount_minor === null ? null : toMoney(r.awarded_amount_minor, r.currency).amount,
    grantStart: r.grant_start,
    grantEnd: r.grant_end,
    decidedAt: r.decided_at,
    nextCycleOn: r.next_cycle_on,
    archived: r.archived_at !== null,
    source: r.source,
    updatedAt: r.updated_at,
  }));
  if (format === "json") return { body: JSON.stringify({ exportedAt: ctx.now().toISOString(), items }, null, 2), contentType: "application/json; charset=utf-8", filename: "outside-applications.json" };
  return { body: toCsv(EXPORT_HEADER, items.map((i) => EXPORT_HEADER.map((k) => i[k]))), contentType: "text/csv; charset=utf-8", filename: "outside-applications.csv" };
}

export { OUTSIDE_SOURCES };
