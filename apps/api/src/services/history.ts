// SPDX-License-Identifier: AGPL-3.0-only
// Imported history (v1.12.0): a funder's past applications, the reviews of them and the reports on
// its past grants, brought from the system it used before through the import framework
// (./imports.ts; the targets are in packages/importers/src/targets/past-*.ts). This file writes
// each checked row of such an import and serves what was imported, as "Imported history" on the
// grantee and award pages and to the report builder.
//
// History is not live. It lives in tables of its own (migration 0046) that no review queue,
// decision, payment, requirement or competition reads: it cannot be reviewed, decided or paid, and
// nothing here changes a live record. Funder staff read it with their existing roles; reviewers
// and external reviewers never do (HISTORY_ROLES, and gms.is_staff in RLS).
//
// Linking, never guessing. A past application is linked to its award by the export's own id (the
// key the grant history import gave the same id), then by the award's exact title and recipient;
// to an organization through that award, else by EIN or exact name among the organizations already
// connected to the funder (the rule of imported awards, review F-01). A review is linked to its
// application by the export's id for it (hashed), then by exact title (and organization when the
// export names one); a review that arrives before its application waits for it by that key. A
// report is linked to its award as an application is. A name that fits more than one record links
// to none.
import { ADAPTERS, isPastTarget, rowKey, sha256Hex, type AdapterKey, type PastApplicationRecord, type PastReportRecord, type PastReviewRecord, type PastTargetKey } from "@gms/importers";
import { z } from "zod";
import { ApiError, notFound } from "../lib/errors.ts";
import { parse } from "../lib/input.ts";
import { apiId, bareUuid, uuidOf } from "../lib/ids.ts";
import { awardImportContext, matchImportedRecipient, type AwardImportContext } from "./analytics.ts";
import { authorize, guardWrite, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import type { Row } from "./repos/types.ts";

type Award = Row<"awards">;
type HApp = Row<"history_applications">;
type HReview = Row<"history_reviews">;
type HReport = Row<"history_reports">;
type LogRow = Row<"import_rows">;
type Run = Row<"import_runs">;

/** Funder members who read imported history: staff. Reviewers and external reviewers never do. */
export const HISTORY_ROLES = ["admin", "program_officer", "finance", "observer", "auditor"] as const;

/** Rows written per commit call (each row looks up its links: a few requests). */
export const PAST_COMMIT_BATCH = 25;

/** The run log's entity type for each history target. */
export const PAST_ENTITY: Record<PastTargetKey, "history_application" | "history_review" | "history_report"> = {
  history_applications: "history_application",
  history_reviews: "history_review",
  history_reports: "history_report",
};
const TABLE = { history_applications: "history_applications", history_reviews: "history_reviews", history_reports: "history_reports" } as const;

/** Files from a system's zip attached to imported history (./import-files.ts), by target. */
export const PAST_FILE_SUBJECT: Partial<Record<PastTargetKey, string>> = { history_applications: "history_application_file", history_reports: "history_report_file" };

/** Whether the entity a run log row names was written. */
export async function pastEntityExists(ctx: ServiceContext, target: PastTargetKey, id: string, wsId: string): Promise<boolean> {
  return !!(await ctx.repos.table(TABLE[target]).one({ id, workspace_id: wsId }));
}

// ------------------------------------------------------------------------------------ links

/** A hash of the export's own id, per kind of record: what links a review to its application. Never the id itself. */
export const exportKey = (kind: "application" | "review" | "report", id: string): Promise<string> => sha256Hex(`history\n${kind}\n${id}`);

/** Names compared for an exact match: trimmed, single spaces, any case. */
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

/** What the writers of one commit batch share: the funder's programs and connected organizations, and how its grant history imports keyed their ids. */
export interface PastContext {
  awards: AwardImportContext;
  /** The row-key scopes of this workspace's grant history imports that mapped a Row ID column. */
  awardScopes: string[];
}

export async function pastContext(ctx: ServiceContext, wsId: string): Promise<PastContext> {
  const [awards, runs] = await Promise.all([awardImportContext(ctx, wsId), ctx.repos.table("import_runs").find({ workspace_id: wsId, target: "award_history" }, { notNull: ["committed_at"], orderBy: "created_at", ascending: false, limit: 200 })]);
  // The same scope as the dry run gave each row key (packages/importers/src/plan.ts).
  const scopes = runs.flatMap((r) => {
    const col = (r.mapping as Record<string, string>).sourceId;
    return col ? [r.source_ref ?? `${r.source}:${col}`] : [];
  });
  return { awards, awardScopes: [...new Set(scopes)] };
}

/** The award a grant history import wrote for this export id, when exactly one did. */
async function awardByExportId(ctx: ServiceContext, wsId: string, deps: PastContext, id: string | null): Promise<Award | null> {
  if (!id || !deps.awardScopes.length) return null;
  const keys = await Promise.all(deps.awardScopes.map((scope) => rowKey("award_history", { id, scope })));
  const hits = await ctx.repos.table("import_rows").find({ workspace_id: wsId, target: "award_history", row_key: keys }, { notNull: ["entity_id", "written_at"] });
  const ids = [...new Set(hits.map((h) => h.entity_id!))];
  if (ids.length !== 1) return null;
  return ctx.repos.table("awards").one({ id: ids[0]!, workspace_id: wsId });
}

/** The award whose title is exactly this one (and whose recipient is the organization, when named), when exactly one is. */
async function awardByName(ctx: ServiceContext, wsId: string, title: string | null, organization: string | null): Promise<Award | null> {
  if (!title) return null;
  const candidates = (await ctx.repos.table("awards").find({ workspace_id: wsId, title: title.trim() }, { limit: 20 })).filter((a) => same(a.title, title));
  if (!organization) return candidates.length === 1 ? candidates[0]! : null;
  const ids = candidates.map((a) => a.recipient_workspace_id).filter((x): x is string => !!x);
  const workspaces = ids.length ? await ctx.repos.table("workspaces").find({ id: ids }) : [];
  const names = new Map(workspaces.map((w) => [w.id, [w.display_name, w.legal_name]]));
  const fits = candidates.filter((a) => (a.recipient_workspace_id ? (names.get(a.recipient_workspace_id) ?? []).some((n) => same(n, organization)) : same((a.recipient_individual as { name?: string } | null)?.name, organization)));
  return fits.length === 1 ? fits[0]! : null;
}

const DECLINED: readonly string[] = ["declined", "withdrawn"];

// ------------------------------------------------------------------------------------ writing

const DUPLICATE_REASON = "Imported already, from another file of the same export";

/** A row of the run log that turned out to be a record imported before: it is skipped, its claim released. */
async function skipAsDuplicate(ctx: ServiceContext, row: LogRow): Promise<"skipped"> {
  await ctx.repos.table("import_rows").update({ id: row.id }, { entity_id: null, entity_type: null, outcome: "skip", reason: DUPLICATE_REASON, record: null });
  return "skipped";
}

async function writeApplication(ctx: ServiceContext, wsId: string, run: Run, row: LogRow, rec: PastApplicationRecord, deps: PastContext, id: string): Promise<"written" | "skipped"> {
  const sourceKey = rec.sourceId ? await exportKey("application", rec.sourceId) : null;
  if (sourceKey) {
    const before = await ctx.repos.table("history_applications").find({ workspace_id: wsId, source_key: sourceKey }, { limit: 20 });
    if (before.some((h) => h.id !== id && same(h.title, rec.title) && same(h.organization_name, rec.organizationName))) return skipAsDuplicate(ctx, row);
  }
  // By the export's own id first; by exact name only when the outcome does not say it was declined.
  const award = (await awardByExportId(ctx, wsId, deps, rec.sourceId)) ?? (DECLINED.includes(rec.outcome) ? null : await awardByName(ctx, wsId, rec.title, rec.organizationName));
  const organization = award?.recipient_workspace_id ?? matchImportedRecipient(deps.awards, rec.organizationName, rec.organizationEin)?.id ?? null;
  const program = rec.programName ? deps.awards.programs.find((p) => same(p.name, rec.programName)) : undefined;
  await guardWrite("This past application", () =>
    ctx.repos.table("history_applications").insert({
      id,
      workspace_id: wsId,
      organization_name: rec.organizationName,
      organization_workspace_id: organization,
      award_id: award?.id ?? null,
      program_id: program?.id ?? (award?.program_id ?? null),
      program_name: rec.programName,
      title: rec.title,
      call_title: rec.callTitle,
      submitted_on: rec.submittedOn,
      outcome: rec.outcome,
      outcome_label: rec.outcomeLabel,
      currency: rec.currency,
      requested_amount_minor: rec.requestedAmountMinor,
      awarded_amount_minor: rec.awardedAmountMinor,
      answers: rec.answers as unknown as HApp["answers"],
      source_key: sourceKey,
      source_system: run.adapter,
      import_run_id: run.id,
    }),
  );
  // Reviews imported before their application find it now, by the same key.
  if (sourceKey) await ctx.repos.table("history_reviews").update({ workspace_id: wsId, application_key: sourceKey, application_id: null }, { application_id: id });
  return "written";
}

/** The past application a review belongs to: by the export's id, then by exact title (and organization), when exactly one fits. */
async function applicationOf(ctx: ServiceContext, wsId: string, key: string | null, rec: PastReviewRecord): Promise<HApp | null> {
  if (key) {
    const byKey = await ctx.repos.table("history_applications").find({ workspace_id: wsId, source_key: key }, { limit: 2 });
    if (byKey.length === 1) return byKey[0]!;
    if (byKey.length > 1) return null;
  }
  if (!rec.applicationTitle) return null;
  const byTitle = (await ctx.repos.table("history_applications").find({ workspace_id: wsId, title: rec.applicationTitle }, { limit: 20 })).filter((h) => !rec.organizationName || same(h.organization_name, rec.organizationName));
  return byTitle.length === 1 ? byTitle[0]! : null;
}

async function writeReview(ctx: ServiceContext, wsId: string, run: Run, row: LogRow, rec: PastReviewRecord, id: string): Promise<"written" | "skipped"> {
  const applicationKey = rec.applicationRef ? await exportKey("application", rec.applicationRef) : null;
  const sourceKey = rec.sourceId ? await exportKey("review", rec.sourceId) : null;
  if (sourceKey) {
    const before = await ctx.repos.table("history_reviews").find({ workspace_id: wsId, source_key: sourceKey }, { limit: 20 });
    if (before.some((r) => r.id !== id && r.application_key === applicationKey)) return skipAsDuplicate(ctx, row);
  }
  const application = await applicationOf(ctx, wsId, applicationKey, rec);
  await guardWrite("This past review", () =>
    ctx.repos.table("history_reviews").insert({
      id,
      workspace_id: wsId,
      application_id: application?.id ?? null,
      application_key: applicationKey,
      application_title: rec.applicationTitle,
      organization_name: rec.organizationName,
      reviewer_name: rec.reviewerName,
      scores: rec.scores as unknown as HReview["scores"],
      total_score: rec.totalScore,
      recommendation: rec.recommendation,
      comment: rec.comment,
      reviewed_on: rec.reviewedOn,
      source_key: sourceKey,
      source_system: run.adapter,
      import_run_id: run.id,
    }),
  );
  return "written";
}

async function writeReport(ctx: ServiceContext, wsId: string, run: Run, row: LogRow, rec: PastReportRecord, deps: PastContext, id: string): Promise<"written" | "skipped"> {
  const sourceKey = rec.sourceId ? await exportKey("report", rec.sourceId) : null;
  if (sourceKey) {
    const before = await ctx.repos.table("history_reports").find({ workspace_id: wsId, source_key: sourceKey }, { limit: 20 });
    if (before.some((r) => r.id !== id && same(r.title, rec.title))) return skipAsDuplicate(ctx, row);
  }
  let award = await awardByExportId(ctx, wsId, deps, rec.awardRef);
  if (!award && rec.awardRef) {
    // The same id named a past application that is linked to its award.
    const apps = await ctx.repos.table("history_applications").find({ workspace_id: wsId, source_key: await exportKey("application", rec.awardRef) }, { limit: 2 });
    const linked = apps.length === 1 ? apps[0]!.award_id : null;
    award = linked ? await ctx.repos.table("awards").one({ id: linked, workspace_id: wsId }) : null;
  }
  award ??= await awardByName(ctx, wsId, rec.awardTitle, rec.organizationName);
  const organization = award?.recipient_workspace_id ?? (rec.organizationName ? (matchImportedRecipient(deps.awards, rec.organizationName, null)?.id ?? null) : null);
  await guardWrite("This past report", () =>
    ctx.repos.table("history_reports").insert({
      id,
      workspace_id: wsId,
      award_id: award?.id ?? null,
      organization_workspace_id: organization,
      award_title: rec.awardTitle,
      organization_name: rec.organizationName,
      title: rec.title,
      due_on: rec.dueOn,
      submitted_on: rec.submittedOn,
      report_state: rec.state,
      report_state_label: rec.stateLabel,
      source_key: sourceKey,
      source_system: run.adapter,
      import_run_id: run.id,
    }),
  );
  return "written";
}

/**
 * Write one checked row of a history import with the entity id its log row claimed
 * (./imports.ts `writeRow`). A retried call finds the entity there and writes nothing again.
 */
export async function writePastRow(ctx: ServiceContext, wsId: string, run: Run, row: LogRow, deps: PastContext, id: string): Promise<"written" | "skipped"> {
  const target = run.target;
  // Only imports.ts calls this, for a history target; anything else is a bug, not a person's mistake.
  if (!isPastTarget(target)) throw new Error("writePastRow: the run is not a history import");
  if (await pastEntityExists(ctx, target, id, wsId)) return "written";
  if (target === "history_applications") return writeApplication(ctx, wsId, run, row, row.record as unknown as PastApplicationRecord, deps, id);
  if (target === "history_reviews") return writeReview(ctx, wsId, run, row, row.record as unknown as PastReviewRecord, id);
  return writeReport(ctx, wsId, run, row, row.record as unknown as PastReportRecord, deps, id);
}

// ------------------------------------------------------------------------------------ reading

const access = (ctx: ServiceContext): Promise<ServiceWorkspace> => authorize(ctx, { scope: "applications:read", kind: "funder", roles: HISTORY_ROLES });

/** At most this many records of each kind are listed for one organization or award, the latest first. */
export const HISTORY_LIST_MAX = 200;

const systemOf = (key: string | null) => (key && ADAPTERS[key as AdapterKey] ? { key: key as AdapterKey, system: ADAPTERS[key as AdapterKey].system } : null);

function reviewView(r: HReview) {
  return {
    id: r.id,
    applicationId: r.application_id,
    applicationTitle: r.application_title,
    reviewerName: r.reviewer_name,
    scores: (r.scores as unknown as { criterion: string; score: number; outOf: number | null }[]).map((s) => ({ criterion: s.criterion, score: s.score, outOf: s.outOf ?? null })),
    totalScore: r.total_score === null ? null : Number(r.total_score),
    recommendation: r.recommendation,
    comment: r.comment,
    reviewedOn: r.reviewed_on,
    sourceSystem: systemOf(r.source_system),
  };
}

function applicationView(a: HApp, awards: Map<string, Award>, reviews: number) {
  const award = a.award_id ? awards.get(a.award_id) : undefined;
  return {
    id: a.id,
    title: a.title,
    organizationName: a.organization_name,
    organizationId: a.organization_workspace_id,
    programName: a.program_name,
    callTitle: a.call_title,
    submittedOn: a.submitted_on,
    outcome: a.outcome as "awarded" | "declined" | "withdrawn" | "undecided" | "unknown",
    outcomeLabel: a.outcome_label,
    currency: a.currency,
    requestedAmountMinor: a.requested_amount_minor,
    awardedAmountMinor: a.awarded_amount_minor,
    award: award ? { id: apiId("award", award.id), title: award.title } : null,
    answerCount: (a.answers as unknown as unknown[]).length,
    reviewCount: reviews,
    sourceSystem: systemOf(a.source_system),
    importedAt: a.created_at,
  };
}

function reportView(r: HReport, awards: Map<string, Award>, file: Row<"documents"> | undefined) {
  const award = r.award_id ? awards.get(r.award_id) : undefined;
  return {
    id: r.id,
    title: r.title,
    organizationName: r.organization_name,
    organizationId: r.organization_workspace_id,
    awardTitle: r.award_title,
    award: award ? { id: apiId("award", award.id), title: award.title } : null,
    dueOn: r.due_on,
    submittedOn: r.submitted_on,
    state: r.report_state as "approved" | "submitted" | "late" | "not_submitted" | "unknown",
    stateLabel: r.report_state_label,
    file: file ? { id: file.id, name: file.name, mime: file.mime, size: file.size } : null,
    sourceSystem: systemOf(r.source_system),
    importedAt: r.created_at,
  };
}

const historyQuery = z
  .object({
    /** An organization's applicant workspace id (the grantee page). */
    organization: z.string().uuid().optional(),
    /** An award, by its API id (the award page). */
    award: z.string().min(1).max(80).optional(),
  })
  .strict()
  .refine((q) => !!q.organization !== !!q.award, "Name an organization or an award");

const byDate = (x: string | null, y: string | null) => (x === y ? 0 : x === null ? 1 : y === null ? -1 : x < y ? 1 : -1);

/**
 * Imported history about one organization or one award: past applications (with how many reviews
 * each has) and past reports. `query` is the request's query string, checked after the caller is
 * authorized, so a caller who may not read history learns nothing from a malformed request.
 */
export async function listHistory(ctx: ServiceContext, query: { organization?: string | undefined; award?: string | undefined }) {
  const ws = await access(ctx);
  const q = parse(historyQuery, Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined)));
  const awardId = q.award ? uuidOf("award", q.award, "Award") : null;
  if (awardId && !(await ctx.repos.table("awards").one({ id: awardId, workspace_id: ws.id }))) throw notFound("Award");
  const where = awardId ? { workspace_id: ws.id, award_id: awardId } : { workspace_id: ws.id, organization_workspace_id: q.organization! };
  const withReports = ctx.scopes.includes("requirements:read");
  const [apps, reports] = await Promise.all([
    ctx.repos.table("history_applications").find(where, { orderBy: "submitted_on", ascending: false, limit: HISTORY_LIST_MAX }),
    withReports ? ctx.repos.table("history_reports").find(where, { orderBy: "due_on", ascending: false, limit: HISTORY_LIST_MAX }) : Promise.resolve([] as HReport[]),
  ]);
  const withReviews = ctx.scopes.includes("reviews:read");
  const reviews = withReviews && apps.length ? await ctx.repos.table("history_reviews").find({ workspace_id: ws.id, application_id: apps.map((a) => a.id) }, { limit: 5000 }) : [];
  const count = new Map<string, number>();
  for (const r of reviews) count.set(r.application_id!, (count.get(r.application_id!) ?? 0) + 1);
  const awardIds = [...new Set([...apps, ...reports].map((x) => x.award_id).filter((x): x is string => !!x))];
  const awards = new Map((awardIds.length ? await ctx.repos.table("awards").find({ workspace_id: ws.id, id: awardIds }) : []).map((a) => [a.id, a]));
  const files = reports.length ? await ctx.repos.table("documents").find({ workspace_id: ws.id, subject_type: PAST_FILE_SUBJECT.history_reports!, subject_id: reports.map((r) => r.id) }, { orderBy: "created_at" }) : [];
  const fileOf = new Map(files.map((d) => [d.subject_id!, d]));
  return {
    applications: [...apps].sort((x, y) => byDate(x.submitted_on, y.submitted_on)).map((a) => applicationView(a, awards, count.get(a.id) ?? 0)),
    reports: [...reports].sort((x, y) => byDate(x.due_on, y.due_on)).map((r) => reportView(r, awards, fileOf.get(r.id))),
    /** False when the caller's token cannot read reviews or reports; those lists are then left out, not empty. */
    includes: { reviews: withReviews, reports: withReports },
  };
}

/** One past application with its answers and its reviews. */
export async function getHistoryApplication(ctx: ServiceContext, id: string) {
  const ws = await access(ctx);
  const a = await ctx.repos.table("history_applications").one({ id: bareUuid(id, "Past application"), workspace_id: ws.id });
  if (!a) throw notFound("Past application");
  const withReviews = ctx.scopes.includes("reviews:read");
  const [reviews, award, files] = await Promise.all([
    withReviews ? ctx.repos.table("history_reviews").find({ workspace_id: ws.id, application_id: a.id }, { orderBy: "reviewed_on", limit: 500 }) : Promise.resolve([] as HReview[]),
    a.award_id ? ctx.repos.table("awards").one({ id: a.award_id, workspace_id: ws.id }) : Promise.resolve(null),
    ctx.repos.table("documents").find({ workspace_id: ws.id, subject_type: PAST_FILE_SUBJECT.history_applications!, subject_id: a.id }, { orderBy: "created_at" }),
  ]);
  return {
    ...applicationView(a, new Map(award ? [[award.id, award]] : []), reviews.length),
    answers: (a.answers as unknown as { question: string; answer: string }[]).map((x) => ({ question: x.question, answer: x.answer })),
    reviews: reviews.map(reviewView),
    files: files.map((d) => ({ id: d.id, name: d.name, mime: d.mime, size: d.size })),
    includes: { reviews: withReviews },
  };
}

async function fileBytes(ctx: ServiceContext, doc: Row<"documents"> | null) {
  if (!doc) throw notFound("File");
  const bytes = ctx.ports.storage ? await ctx.ports.storage.get({ storage: doc.storage as "supabase" | "r2", path: doc.path }) : null;
  if (!bytes) throw new ApiError(503, "storage_unavailable", "The file could not be read from storage");
  return { bytes, mime: doc.mime, filename: doc.name.replace(/["\\\r\n]/g, "") };
}

/** The file imported with a past report, or with a past application, for download by the funder's staff. */
export async function historyFile(ctx: ServiceContext, kind: "report" | "application", id: string, documentId: string) {
  const ws = await access(ctx);
  if (kind === "report" && !ctx.scopes.includes("requirements:read")) throw notFound("File");
  const table = kind === "report" ? "history_reports" : "history_applications";
  const subject = await ctx.repos.table(table).one({ id: bareUuid(id, kind === "report" ? "Past report" : "Past application"), workspace_id: ws.id });
  if (!subject) throw notFound(kind === "report" ? "Past report" : "Past application");
  const doc = await ctx.repos.table("documents").one({ id: bareUuid(documentId, "File"), workspace_id: ws.id, subject_type: kind === "report" ? PAST_FILE_SUBJECT.history_reports! : PAST_FILE_SUBJECT.history_applications!, subject_id: subject.id });
  return fileBytes(ctx, doc);
}
