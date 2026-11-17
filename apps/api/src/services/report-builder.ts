// SPDX-License-Identifier: AGPL-3.0-only
// The report builder (docs/reports.md): six data sets over the funder's own records, each a
// typed whitelist of columns (report-engine.ts); previews and CSV downloads of a definition built
// from those columns; saved views, private or shared with the workspace, plus six starter views;
// and a weekly or monthly schedule that writes the CSV to the EXPORTS bucket and emails members of
// the workspace a link to it (counts only, never the file).
//
// Amounts are the GMS's own records: requested and awarded amounts, scheduled payments, and what
// the funder recorded it paid elsewhere (resolve mode). Passport's `disbursedAmount` appears once,
// labelled "Disbursed through Passport", and is never added up. No column holds bank, payout or
// identity data, and the whitelist refuses one (`defineDataSet`).
import { scoreReview, type Scores } from "@gms/review";
import { APPLICATION_STATUSES, AWARD_STATUSES, REQUIREMENT_STATUSES, TRANCHE_STATUSES } from "@gms/workflow";
import type { TableName } from "@gms/db";
import { DEFAULT_LOCALE, type Locale } from "@gms/i18n";
import { scheduledReportEmail } from "@gms/notify";
import { z } from "zod";
import { scopesForRole } from "../auth/scopes.ts";
import { forbidden } from "../auth/verify.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import { fundingOf, keyDatesOf, minorOf } from "./awards.ts";
import { audit, authorize, fundScopeOf, systemContext, type BaseContext, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import { namesShared, orgFacts, sharingWith, verificationShared } from "./profile.ts";
import type { Row as DbRow, Where } from "./repos/types.ts";
import { normalizePreferences } from "./notifications.ts";
import { recipientLocales } from "./preferences.ts";
import { columnsIn, withHeaderIn } from "./report-words.ts";
import { toRubric } from "./reviews.ts";
import { ADAPTERS } from "@gms/importers";
import {
  CSV_MAX_ROWS,
  MAX_SOURCE_ROWS,
  PREVIEW_ROWS,
  canAggregate,
  csvFilename,
  csvText,
  defineDataSet,
  definitionInput,
  plan,
  run,
  type Cell,
  type DataSetDef,
  type DataSetKey,
  type Definition,
  type ReportResult,
  type Row,
} from "./report-engine.ts";

export { csvStream } from "./report-engine.ts";

/** Each grants system's name, by adapter key, for imported history's "Imported from". */
const SYSTEM_NAMES: Record<string, string> = Object.fromEntries(Object.values(ADAPTERS).map((a) => [a.key, a.system]));

// ------------------------------------------------------------------------------------ data sets

// Drafts are the applicant's own until submitted: the data set reads submitted applications only.
const APPLICATION_STATUS = APPLICATION_STATUSES.filter((s) => s !== "draft");

export const DATA_SETS: Record<DataSetKey, DataSetDef> = {
  applications: defineDataSet({
    key: "applications",
    label: "Applications",
    description: "Submitted applications, with their opportunity, program, stage, status, request and review scores.",
    scope: "applications:read",
    columns: [
      { key: "title", label: "Application", type: "text", source: "applications.title" },
      { key: "applicant", label: "Applicant", type: "text", source: "the applicant workspace's name (its Passport legal name while it shares its record)" },
      { key: "opportunity", label: "Opportunity", type: "text", source: "opportunities.title" },
      { key: "competition", label: "Competition", type: "text", source: "competitions.title" },
      { key: "program", label: "Program", type: "text", source: "programs.name, through the opportunity" },
      { key: "fund", label: "Fund", type: "text", source: "funds.name, through the opportunity's program" },
      { key: "stage", label: "Stage", type: "text", source: "the competition's stage label" },
      { key: "status", label: "Status", type: "status", source: "applications.status", values: APPLICATION_STATUS, statusKind: "application" },
      { key: "requested", label: "Requested amount", type: "money", source: "applications.requested_amount_minor", currencyColumn: "currency" },
      { key: "currency", label: "Currency", type: "text", source: "applications.currency" },
      { key: "submittedOn", label: "Submitted on", type: "date", source: "applications.submitted_at" },
      { key: "submittedYear", label: "Year submitted", type: "text", source: "applications.submitted_at" },
      { key: "averageScore", label: "Average score", type: "number", source: "submitted reviews at the current stage, 0-100" },
      { key: "reviews", label: "Reviews submitted", type: "number", source: "reviews at the current stage" },
      { key: "decision", label: "Decision", type: "text", source: "the latest committed decision" },
      { key: "declineReason", label: "Decline reason", type: "text", source: "the rationale of the committed decline" },
    ],
  }),
  awards: defineDataSet({
    key: "awards",
    label: "Awards",
    description: "Awards with their program, recipient, amount, dates and what the payment schedule says is paid and still owed.",
    scope: "awards:read",
    columns: [
      { key: "title", label: "Award", type: "text", source: "awards.title" },
      { key: "program", label: "Program", type: "text", source: "programs.name" },
      { key: "fund", label: "Fund", type: "text", source: "funds.name, through the award's program" },
      { key: "recipient", label: "Recipient", type: "text", source: "the recipient workspace's name (its Passport legal name while it shares its record)" },
      { key: "recipientVerified", label: "Recipient verified", type: "text", source: "Passport verification, or a self-declared profile" },
      { key: "status", label: "Status", type: "status", source: "awards.status", values: AWARD_STATUSES, statusKind: "award" },
      { key: "amount", label: "Awarded amount", type: "money", source: "awards.funding.awardedAmount", currencyColumn: "currency" },
      { key: "currency", label: "Currency", type: "text", source: "awards.funding.awardedAmount.currency" },
      { key: "awardDate", label: "Award date", type: "date", source: "awards.key_dates.awardDate, else when the award was made" },
      { key: "awardYear", label: "Award year", type: "text", source: "the award date" },
      { key: "startDate", label: "Start", type: "date", source: "awards.key_dates.periodOfPerformance.startDate" },
      { key: "endDate", label: "End", type: "date", source: "awards.key_dates.periodOfPerformance.endDate" },
      { key: "paidElsewhere", label: "Paid elsewhere (recorded)", type: "money", source: "settled payments the funder recorded as paid outside the GMS", currencyColumn: "currency" },
      { key: "scheduledRemaining", label: "Scheduled, not yet paid", type: "money", source: "payments scheduled, due, ready, held, failed or in flight", currencyColumn: "currency" },
      { key: "nextPaymentDate", label: "Next payment date", type: "date", source: "the earliest due date of a payment not yet paid" },
      { key: "overdueReports", label: "Overdue reports", type: "number", source: "requirements of the award that are overdue" },
      { key: "disbursedThroughPassport", label: "Disbursed through Passport", type: "money", source: "awards.funding.disbursedAmount, as last read from Passport", currencyColumn: "currency", aggregatable: false, note: "Read from Passport, not a GMS figure; never added up" },
    ],
  }),
  payments: defineDataSet({
    key: "payments",
    label: "Payments",
    description: "Scheduled payments (tranches) of each award: when they are due, where they stand, and what was recorded as paid elsewhere.",
    scope: "payments:read",
    columns: [
      { key: "tranche", label: "Payment", type: "text", source: "the payment's place in the schedule" },
      { key: "award", label: "Award", type: "text", source: "awards.title" },
      { key: "program", label: "Program", type: "text", source: "programs.name" },
      { key: "fund", label: "Fund", type: "text", source: "funds.name, through the award's program" },
      { key: "recipient", label: "Recipient", type: "text", source: "the recipient workspace's name" },
      { key: "amount", label: "Amount", type: "money", source: "tranches.amount_minor", currencyColumn: "currency" },
      { key: "currency", label: "Currency", type: "text", source: "tranches.currency" },
      { key: "dueDate", label: "Due", type: "date", source: "tranches.due_at" },
      { key: "status", label: "Status", type: "status", source: "tranches.status", values: TRANCHE_STATUSES, statusKind: "tranche" },
      { key: "howPaid", label: "How it is paid", type: "text", source: "through Passport, or recorded as paid elsewhere" },
      { key: "paidElsewhere", label: "Recorded paid elsewhere", type: "money", source: "the amount of a payment recorded as paid outside the GMS", currencyColumn: "currency" },
      { key: "paidOn", label: "Paid on", type: "date", source: "the date recorded for a payment made elsewhere" },
    ],
  }),
  requirements: defineDataSet({
    key: "requirements",
    label: "Reports and requirements",
    description: "What each award asks of its grantee: reports, documents and milestones, when they are due and how late they are.",
    scope: "requirements:read",
    columns: [
      { key: "title", label: "Requirement", type: "text", source: "requirements.title" },
      { key: "type", label: "Type", type: "text", source: "requirements.type" },
      { key: "award", label: "Award", type: "text", source: "awards.title" },
      { key: "program", label: "Program", type: "text", source: "programs.name" },
      { key: "fund", label: "Fund", type: "text", source: "funds.name, through the award's program" },
      { key: "recipient", label: "Recipient", type: "text", source: "the recipient workspace's name" },
      { key: "dueDate", label: "Due", type: "date", source: "requirements.due_at" },
      { key: "status", label: "Status", type: "status", source: "requirements.status", values: REQUIREMENT_STATUSES, statusKind: "requirement" },
      { key: "overdueDays", label: "Days overdue", type: "number", source: "days since the due date, for a requirement not yet received" },
    ],
  }),
  organizations: defineDataSet({
    key: "organizations",
    label: "Organizations",
    description: "Organizations that applied to or were awarded by this funder: whether they are verified, where they are, and what they were awarded.",
    scope: "grantees:read",
    columns: [
      { key: "name", label: "Organization", type: "text", source: "the workspace's name (its Passport legal name while it shares its record)" },
      { key: "verified", label: "Verified", type: "text", source: "Passport verification, or a self-declared profile" },
      { key: "fund", label: "Funds", type: "text", source: "funds.name of the programs it applied to or was awarded from, in name order" },
      { key: "location", label: "Location", type: "text", source: "city and state of the organization's record, while it shares its record" },
      { key: "region", label: "State or region", type: "text", source: "state of the organization's record, while it shares its record" },
      { key: "applications", label: "Applications submitted", type: "number", source: "submitted applications to this funder" },
      { key: "awardCount", label: "Awards", type: "number", source: "awards from this funder" },
      { key: "totalAwarded", label: "Total awarded", type: "money", source: "awarded amounts of accepted, active, suspended and completed awards (blank when they are in more than one currency)", currencyColumn: "currency" },
      { key: "currency", label: "Currency", type: "text", source: "the currency of those awards, or Mixed" },
    ],
  }),
  // Imported history (v1.12.0, ./history.ts): what came from the system used before. No reviewer's
  // name and no contact field: an organization is named as the export named it.
  history: defineDataSet({
    key: "history",
    label: "Imported history",
    description: "Past applications, reviews and reports brought from the system you used before: what was asked for, decided, scored and reported. Read-only history, never part of a live competition.",
    scope: "applications:read",
    columns: [
      { key: "record", label: "Record", type: "text", source: "Past application, Past review or Past report" },
      { key: "title", label: "Title", type: "text", source: "the application's or report's title; for a review, its application's" },
      { key: "organization", label: "Organization", type: "text", source: "the organization as the export named it" },
      { key: "program", label: "Program", type: "text", source: "the program as the export named it, or the linked award's program" },
      { key: "fund", label: "Fund", type: "text", source: "funds.name, through the matched program or the linked award's program" },
      { key: "call", label: "Call or round", type: "text", source: "history_applications.call_title" },
      { key: "outcome", label: "Outcome", type: "text", source: "the outcome, recommendation or report status as the export wrote it" },
      { key: "submittedOn", label: "Submitted on", type: "date", source: "when the application or the report was submitted" },
      { key: "submittedYear", label: "Year submitted", type: "text", source: "the submitted date" },
      { key: "dueOn", label: "Due on", type: "date", source: "history_reports.due_on" },
      { key: "reviewedOn", label: "Reviewed on", type: "date", source: "history_reviews.reviewed_on" },
      { key: "requested", label: "Requested amount", type: "money", source: "history_applications.requested_amount_minor", currencyColumn: "currency" },
      { key: "awarded", label: "Awarded amount", type: "money", source: "history_applications.awarded_amount_minor", currencyColumn: "currency" },
      { key: "currency", label: "Currency", type: "text", source: "history_applications.currency" },
      { key: "score", label: "Total score", type: "number", source: "history_reviews.total_score" },
      { key: "reviews", label: "Reviews", type: "number", source: "past reviews of the application" },
      { key: "award", label: "Linked award", type: "text", source: "awards.title of the award it was linked to" },
      { key: "importedFrom", label: "From system", type: "text", source: "the grants system whose export it came from" },
    ],
  }),
};

/** The data sets as the builder shows them. */
export async function dataSetCatalog(ctx: ServiceContext) {
  await access(ctx);
  return Object.values(DATA_SETS).map((d) => ({
    key: d.key,
    label: d.label,
    description: d.description,
    /** False when the caller's role or token lacks the data set's own scope. */
    available: ctx.scopes.includes(d.scope),
    columns: d.columns.map((c) => ({ key: c.key, label: c.label, type: c.type, source: c.source, aggregatable: canAggregate(c), ...(c.values ? { values: [...c.values] } : {}), ...(c.statusKind ? { statusKind: c.statusKind } : {}), ...(c.note ? { note: c.note } : {}) })),
  }));
}

// ------------------------------------------------------------------------------------ access

/** Funder members who may read reports. Reviewers and external reviewers may not. */
export const REPORT_ROLES = ["admin", "program_officer", "finance", "observer", "auditor"] as const;

/**
 * Saved views and schedules are made by a person in the GMS, never by an API client or an agent:
 * a shared view changes what colleagues see and a schedule sends email. One constant to relax.
 */
export const VIEW_WRITES_PEOPLE_ONLY = true;

const access = (ctx: ServiceContext): Promise<ServiceWorkspace> => authorize(ctx, { scope: "analytics:read", kind: "funder", roles: REPORT_ROLES });

function needDataSet(ctx: ServiceContext, key: DataSetKey): DataSetDef {
  const d = DATA_SETS[key];
  if (!ctx.scopes.includes(d.scope)) throw forbidden("insufficient_scope", `Reports on ${d.label.toLowerCase()} need the ${d.scope} scope`, d.scope);
  return d;
}

function personOnly(ctx: ServiceContext, what: string): string {
  if (VIEW_WRITES_PEOPLE_ONLY && (ctx.actor.kind !== "user" || !ctx.actor.userId)) throw forbidden("person_required", `${what} is done by a person in the GMS`);
  return ctx.actor.userId!;
}

// ------------------------------------------------------------------------------------ reading

/** PostgREST answers at most 1,000 rows a request: read in pages, up to `cap` rows. */
const PAGE = 1000;
async function readAll<T extends TableName>(repos: BaseContext["repos"], table: T, where: Where<T>, cap: number, notNull?: readonly (keyof DbRow<T> & string)[]): Promise<{ rows: DbRow<T>[]; more: boolean }> {
  const rows: DbRow<T>[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await repos.table(table).find(where, { orderBy: "id" as keyof DbRow<T> & string, limit: PAGE, offset, ...(notNull ? { notNull } : {}) });
    rows.push(...page);
    if (page.length < PAGE) return { rows: rows.slice(0, cap), more: rows.length > cap };
    if (rows.length > cap) return { rows: rows.slice(0, cap), more: true };
  }
}

/** Rows by id, a few hundred ids a request (an `in` list travels in the URL). */
async function byIds<T extends TableName>(repos: BaseContext["repos"], table: T, ids: readonly string[]): Promise<DbRow<T>[]> {
  const unique = [...new Set(ids)];
  const out: DbRow<T>[] = [];
  for (let i = 0; i < unique.length; i += 200) out.push(...(await repos.table(table).find({ id: unique.slice(i, i + 200) } as unknown as Where<T>)));
  return out;
}

type Repos = Pick<BaseContext, "repos">;
type Loaded = { rows: Row[]; truncated: boolean };
const day = (s: string | null | undefined): string | null => (s ? s.slice(0, 10) : null);
const OPEN_PAYMENT: readonly string[] = ["scheduled", "due", "ready", "held", "failed", "releasing", "initiated"];
const NOT_YET_PAID: readonly string[] = ["scheduled", "due", "ready", "held", "failed"];
const NOT_RECEIVED: readonly string[] = ["scheduled", "due", "overdue", "returned"];
const COMMITTED: readonly string[] = ["accepted", "active", "suspended", "completed"];
const DECISION_WORDS: Record<string, string> = { approve: "Approved", decline: "Declined", waitlist: "Waitlisted", defer: "Deferred" };
const VERIFIED_WORDS = { passport: "Verified with Passport", self_declared: "Self-declared, not verified", none: "Not verified" } as const;

/** How the funder names each organization, and whether it is verified, by the consent rule of the grantee directory. */
async function organizationsOf(base: Repos, funderId: string, ids: readonly (string | null)[]) {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  const [workspaces, shared] = await Promise.all([byIds(base.repos, "workspaces", wanted), sharingWith(base, funderId, wanted)]);
  return new Map(workspaces.map((w) => [w.id, { w, shared: shared.has(w.id), name: namesShared(w, shared.has(w.id)).name, verified: VERIFIED_WORDS[verificationShared(w, shared.has(w.id)).source] }]));
}

/** No program, or a program whose fund this reader cannot see. */
const NO_FUND = "No fund";

/** Each program's fund name. Read through the caller's repositories, so a fund advisor sees their funds' names only. */
async function fundNames(base: Repos, wsId: string, programs: DbRow<"programs">[]): Promise<Map<string, string>> {
  const funds = await readAll(base.repos, "funds", { workspace_id: wsId }, MAX_SOURCE_ROWS);
  const name = new Map(funds.rows.map((f) => [f.id, f.name]));
  return new Map(programs.flatMap((p) => (p.fund_id && name.has(p.fund_id) ? [[p.id, name.get(p.fund_id)!] as [string, string]] : [])));
}

const recipientName = (a: DbRow<"awards">, orgs: Awaited<ReturnType<typeof organizationsOf>>) => (a.recipient_workspace_id ? orgs.get(a.recipient_workspace_id)?.name : null) ?? (a.recipient_individual as { name?: string } | null)?.name ?? "Unknown recipient";

async function loadApplications(base: Repos, wsId: string): Promise<Loaded> {
  const apps = await readAll(base.repos, "applications", { workspace_id: wsId }, MAX_SOURCE_ROWS, ["submitted_at"]);
  const [opps, comps, programs, assignments, reviews, decisions] = await Promise.all([
    readAll(base.repos, "opportunities", { workspace_id: wsId }, MAX_SOURCE_ROWS),
    readAll(base.repos, "competitions", { workspace_id: wsId }, MAX_SOURCE_ROWS),
    readAll(base.repos, "programs", { workspace_id: wsId }, MAX_SOURCE_ROWS),
    readAll(base.repos, "review_assignments", { workspace_id: wsId }, MAX_SOURCE_ROWS * 5),
    readAll(base.repos, "reviews", { workspace_id: wsId }, MAX_SOURCE_ROWS * 5),
    readAll(base.repos, "decisions", { workspace_id: wsId }, MAX_SOURCE_ROWS * 2),
  ]);
  const orgs = await organizationsOf(base, wsId, apps.rows.map((a) => a.applicant_workspace_id));
  const opp = new Map(opps.rows.map((o) => [o.id, o]));
  const comp = new Map(comps.rows.map((c) => [c.id, c]));
  const program = new Map(programs.rows.map((p) => [p.id, p.name]));
  const fund = await fundNames(base, wsId, programs.rows);
  const submitted = new Map(reviews.rows.filter((r) => r.submitted_at).map((r) => [r.assignment_id, r]));
  const rubricRows = await byIds(base.repos, "rubrics", assignments.rows.map((a) => a.rubric_id));
  const rubric = new Map(rubricRows.map((r) => [`${r.id}:${r.version}`, toRubric(r)]));
  const assignmentsOf = new Map<string, DbRow<"review_assignments">[]>();
  for (const a of assignments.rows) assignmentsOf.set(a.application_id, [...(assignmentsOf.get(a.application_id) ?? []), a]);
  const latest = new Map<string, DbRow<"decisions">>();
  for (const d of decisions.rows.filter((x) => x.committed_at).sort((x, y) => (x.committed_at! < y.committed_at! ? -1 : 1))) latest.set(d.application_id, d);
  const rows = apps.rows.map((a): Row => {
    const o = opp.get(a.opportunity_id);
    const c = comp.get(a.competition_id);
    const stages = ((c?.stages as { key: string; label: string }[] | null) ?? []);
    // The score the inbox shows: submitted, not recused, at the application's current stage.
    const overall = (assignmentsOf.get(a.id) ?? [])
      .filter((x) => x.stage === a.stage && x.status !== "recused")
      .map((x) => {
        const r = submitted.get(x.id);
        const rb = rubric.get(`${x.rubric_id}:${x.rubric_version}`);
        return r && rb ? scoreReview(rb, r.scores as Scores).overall : null;
      })
      .filter((x): x is number => x !== null);
    const d = latest.get(a.id);
    return {
      title: a.title,
      applicant: orgs.get(a.applicant_workspace_id)?.name ?? null,
      opportunity: o?.title ?? null,
      competition: c?.title ?? null,
      program: (o?.program_id ? program.get(o.program_id) : null) ?? "No program",
      fund: (o?.program_id ? fund.get(o.program_id) : null) ?? NO_FUND,
      stage: stages.find((s) => s.key === a.stage)?.label ?? a.stage,
      status: a.status,
      requested: a.requested_amount_minor,
      currency: a.currency,
      submittedOn: day(a.submitted_at),
      submittedYear: a.submitted_at ? a.submitted_at.slice(0, 4) : null,
      averageScore: overall.length ? Math.round((overall.reduce((s, x) => s + x, 0) / overall.length) * 10) / 10 : null,
      reviews: overall.length,
      decision: d ? (DECISION_WORDS[d.outcome] ?? d.outcome) : null,
      declineReason: a.status === "declined" ? (d?.outcome === "decline" && d.rationale?.trim() ? d.rationale.trim().slice(0, 500) : "No reason recorded") : null,
    };
  });
  return { rows, truncated: apps.more };
}

async function awardContext(base: Repos, wsId: string) {
  const [awards, programs] = await Promise.all([readAll(base.repos, "awards", { workspace_id: wsId }, MAX_SOURCE_ROWS), readAll(base.repos, "programs", { workspace_id: wsId }, MAX_SOURCE_ROWS)]);
  const orgs = await organizationsOf(base, wsId, awards.rows.map((a) => a.recipient_workspace_id));
  return { awards, award: new Map(awards.rows.map((a) => [a.id, a])), program: new Map(programs.rows.map((p) => [p.id, p.name])), fund: await fundNames(base, wsId, programs.rows), orgs };
}

const paidElsewhere = (t: DbRow<"tranches">) => (t.mode === "resolve" && t.status === "settled" ? t.amount_minor : null);

async function loadAwards(base: Repos, wsId: string): Promise<Loaded> {
  const { awards, program, fund, orgs } = await awardContext(base, wsId);
  const [tranches, requirements] = await Promise.all([readAll(base.repos, "tranches", { workspace_id: wsId }, MAX_SOURCE_ROWS * 4), readAll(base.repos, "requirements", { workspace_id: wsId }, MAX_SOURCE_ROWS * 4)]);
  const byAward = <R extends { award_id: string }>(rows: R[]) => {
    const m = new Map<string, R[]>();
    for (const r of rows) m.set(r.award_id, [...(m.get(r.award_id) ?? []), r]);
    return m;
  };
  const paymentsOf = byAward(tranches.rows);
  const requirementsOf = byAward(requirements.rows);
  const rows = awards.rows.map((a): Row => {
    const f = fundingOf(a);
    const k = keyDatesOf(a);
    const pays = paymentsOf.get(a.id) ?? [];
    const awardDate = k.awardDate?.date?.slice(0, 10) ?? day(a.created_at);
    const next = pays.filter((t) => NOT_YET_PAID.includes(t.status) && t.due_at).map((t) => t.due_at!.slice(0, 10)).sort()[0] ?? null;
    const recipient = a.recipient_workspace_id ? orgs.get(a.recipient_workspace_id) : undefined;
    return {
      title: a.title,
      program: (a.program_id ? program.get(a.program_id) : null) ?? "No program",
      fund: (a.program_id ? fund.get(a.program_id) : null) ?? NO_FUND,
      recipient: recipientName(a, orgs),
      recipientVerified: recipient?.verified ?? VERIFIED_WORDS.none,
      status: a.status,
      amount: minorOf(f.awardedAmount),
      currency: f.awardedAmount?.currency ?? "USD",
      awardDate,
      awardYear: awardDate?.slice(0, 4) ?? null,
      startDate: k.periodOfPerformance?.startDate?.slice(0, 10) ?? null,
      endDate: k.periodOfPerformance?.endDate?.slice(0, 10) ?? null,
      paidElsewhere: pays.reduce((s, t) => s + (paidElsewhere(t) ?? 0), 0),
      scheduledRemaining: pays.filter((t) => OPEN_PAYMENT.includes(t.status)).reduce((s, t) => s + t.amount_minor, 0),
      nextPaymentDate: next,
      overdueReports: (requirementsOf.get(a.id) ?? []).filter((r) => r.status === "overdue").length,
      disbursedThroughPassport: minorOf(f.disbursedAmount),
    };
  });
  return { rows, truncated: awards.more };
}

async function loadPayments(base: Repos, wsId: string): Promise<Loaded> {
  const { award, program, fund, orgs } = await awardContext(base, wsId);
  const tranches = await readAll(base.repos, "tranches", { workspace_id: wsId }, MAX_SOURCE_ROWS);
  const counts = new Map<string, number>();
  for (const t of tranches.rows) counts.set(t.award_id, Math.max(counts.get(t.award_id) ?? 0, t.seq));
  const rows = tranches.rows.map((t): Row => {
    const a = award.get(t.award_id);
    const external = t.external as { paidAt?: string } | null;
    return {
      tranche: `Payment ${t.seq} of ${counts.get(t.award_id) ?? t.seq}`,
      award: a?.title ?? null,
      program: (a?.program_id ? program.get(a.program_id) : null) ?? "No program",
      fund: (a?.program_id ? fund.get(a.program_id) : null) ?? NO_FUND,
      recipient: a ? recipientName(a, orgs) : null,
      amount: t.amount_minor,
      currency: t.currency,
      dueDate: day(t.due_at),
      status: t.status,
      howPaid: t.mode === "resolve" ? "Paid elsewhere" : t.mode === "facilitated" ? "Through Passport" : null,
      paidElsewhere: paidElsewhere(t),
      paidOn: t.mode === "resolve" && t.status === "settled" ? day(external?.paidAt) : null,
    };
  });
  return { rows, truncated: tranches.more };
}

const TYPE_WORDS: Record<string, string> = { report: "Report", document: "Document", milestone: "Milestone", site_visit: "Site visit", acknowledgment: "Acknowledgment" };

async function loadRequirements(base: Repos, wsId: string, now: Date): Promise<Loaded> {
  const { award, program, fund, orgs } = await awardContext(base, wsId);
  const reqs = await readAll(base.repos, "requirements", { workspace_id: wsId }, MAX_SOURCE_ROWS);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const rows = reqs.rows.map((r): Row => {
    const a = award.get(r.award_id);
    const due = r.due_at ? Date.UTC(Number(r.due_at.slice(0, 4)), Number(r.due_at.slice(5, 7)) - 1, Number(r.due_at.slice(8, 10))) : null;
    return {
      title: r.title,
      type: TYPE_WORDS[r.type] ?? r.type,
      award: a?.title ?? null,
      program: (a?.program_id ? program.get(a.program_id) : null) ?? "No program",
      fund: (a?.program_id ? fund.get(a.program_id) : null) ?? NO_FUND,
      recipient: a ? recipientName(a, orgs) : null,
      dueDate: day(r.due_at),
      status: r.status,
      overdueDays: due !== null && NOT_RECEIVED.includes(r.status) && due < today ? Math.floor((today - due) / 86_400_000) : 0,
    };
  });
  return { rows, truncated: reqs.more };
}

async function loadOrganizations(base: Repos, wsId: string): Promise<Loaded> {
  const [apps, awards, opps, programs] = await Promise.all([readAll(base.repos, "applications", { workspace_id: wsId }, MAX_SOURCE_ROWS * 2, ["submitted_at"]), readAll(base.repos, "awards", { workspace_id: wsId }, MAX_SOURCE_ROWS * 2), readAll(base.repos, "opportunities", { workspace_id: wsId }, MAX_SOURCE_ROWS), readAll(base.repos, "programs", { workspace_id: wsId }, MAX_SOURCE_ROWS)]);
  const fund = await fundNames(base, wsId, programs.rows);
  const programOfOpp = new Map(opps.rows.map((o) => [o.id, o.program_id]));
  // The grantee directory's rule: an organization that submitted an application here or holds an award from here.
  const ids = [...new Set([...apps.rows.map((a) => a.applicant_workspace_id), ...awards.rows.map((a) => a.recipient_workspace_id).filter((x): x is string => !!x)])];
  const orgs = await organizationsOf(base, wsId, ids);
  const rows = [...orgs.values()]
    .filter((o) => o.w.kind === "applicant")
    .map(({ w, shared, name, verified }): Row => {
      // Where the organization is: from its own record, and only while it shares that record with this funder.
      const primary = shared ? (((orgFacts(w).org as { addresses?: { primary?: Record<string, unknown> } }).addresses?.primary) ?? null) : null;
      const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
      const city = text(primary?.city);
      const region = text(primary?.stateOrProvince);
      const mine = awards.rows.filter((a) => a.recipient_workspace_id === w.id);
      const theirPrograms = [...apps.rows.filter((a) => a.applicant_workspace_id === w.id).map((a) => programOfOpp.get(a.opportunity_id) ?? null), ...mine.map((a) => a.program_id)];
      const funds = [...new Set(theirPrograms.map((p) => (p ? fund.get(p) : undefined)).filter((f): f is string => !!f))].sort((x, y) => x.localeCompare(y));
      const committed = mine.filter((a) => COMMITTED.includes(a.status));
      // Amounts in two currencies are never added together.
      const currencies = new Set(committed.map((a) => fundingOf(a).awardedAmount?.currency ?? "USD"));
      return {
        name,
        verified,
        fund: funds.length ? funds.join(", ") : NO_FUND,
        location: [city, region].filter(Boolean).join(", ") || null,
        region,
        applications: apps.rows.filter((a) => a.applicant_workspace_id === w.id).length,
        awardCount: mine.length,
        totalAwarded: currencies.size > 1 ? null : committed.reduce((s, a) => s + (minorOf(fundingOf(a).awardedAmount) ?? 0), 0),
        currency: currencies.size > 1 ? "Mixed" : ([...currencies][0] ?? null),
      };
    });
  return { rows, truncated: apps.more || awards.more };
}

const RECORD_WORDS = { application: "Past application", review: "Past review", report: "Past report" } as const;
const PAST_OUTCOME_WORDS: Record<string, string> = { awarded: "Awarded", declined: "Declined", withdrawn: "Withdrawn", undecided: "Not decided" };
const PAST_REPORT_WORDS: Record<string, string> = { approved: "Approved", submitted: "Submitted", late: "Late", not_submitted: "Not submitted" };

/** Imported history: one row per past application, review and report (./history.ts). Read through the reader's repositories, so a fund advisor sees their funds' only. */
async function loadHistory(base: Repos, wsId: string): Promise<Loaded> {
  const [apps, reviews, reports, programs] = await Promise.all([
    readAll(base.repos, "history_applications", { workspace_id: wsId }, MAX_SOURCE_ROWS),
    readAll(base.repos, "history_reviews", { workspace_id: wsId }, MAX_SOURCE_ROWS * 2),
    readAll(base.repos, "history_reports", { workspace_id: wsId }, MAX_SOURCE_ROWS),
    readAll(base.repos, "programs", { workspace_id: wsId }, MAX_SOURCE_ROWS),
  ]);
  const awards = new Map((await byIds(base.repos, "awards", [...apps.rows, ...reports.rows].map((x) => x.award_id).filter((x): x is string => !!x))).map((a) => [a.id, a]));
  const program = new Map(programs.rows.map((p) => [p.id, p.name]));
  const fund = await fundNames(base, wsId, programs.rows);
  const app = new Map(apps.rows.map((a) => [a.id, a]));
  const reviewCount = new Map<string, number>();
  for (const r of reviews.rows) if (r.application_id) reviewCount.set(r.application_id, (reviewCount.get(r.application_id) ?? 0) + 1);
  const system = (k: string | null) => (k ? (SYSTEM_NAMES[k] ?? null) : null);
  const awardOf = (id: string | null) => (id ? (awards.get(id) ?? null) : null);
  const programIdOf = (programId: string | null, awardId: string | null) => programId ?? awardOf(awardId)?.program_id ?? null;
  const programOf = (name: string | null, programId: string | null, awardId: string | null) => name ?? (programIdOf(programId, awardId) ? program.get(programIdOf(programId, awardId)!) : null) ?? "No program";
  const fundOf = (programId: string | null, awardId: string | null) => (programIdOf(programId, awardId) ? fund.get(programIdOf(programId, awardId)!) : null) ?? NO_FUND;
  const blank = { call: null, submittedOn: null, submittedYear: null, dueOn: null, reviewedOn: null, requested: null, awarded: null, currency: null, score: null, reviews: null } as const;
  const rows: Row[] = [
    ...apps.rows.map((a): Row => ({
      ...blank,
      record: RECORD_WORDS.application,
      title: a.title,
      organization: a.organization_name,
      program: programOf(a.program_name, a.program_id, a.award_id),
      fund: fundOf(a.program_id, a.award_id),
      call: a.call_title,
      outcome: a.outcome_label ?? PAST_OUTCOME_WORDS[a.outcome] ?? null,
      submittedOn: a.submitted_on,
      submittedYear: a.submitted_on?.slice(0, 4) ?? null,
      requested: a.requested_amount_minor,
      awarded: a.awarded_amount_minor,
      currency: a.currency,
      reviews: reviewCount.get(a.id) ?? 0,
      award: awardOf(a.award_id)?.title ?? null,
      importedFrom: system(a.source_system),
    })),
    ...reviews.rows.map((r): Row => {
      const a = r.application_id ? app.get(r.application_id) : undefined;
      return {
        ...blank,
        record: RECORD_WORDS.review,
        title: a?.title ?? r.application_title,
        organization: a?.organization_name ?? r.organization_name,
        program: a ? programOf(a.program_name, a.program_id, a.award_id) : "No program",
        fund: a ? fundOf(a.program_id, a.award_id) : NO_FUND,
        call: a?.call_title ?? null,
        outcome: r.recommendation,
        reviewedOn: r.reviewed_on,
        score: r.total_score === null ? null : Number(r.total_score),
        award: a ? (awardOf(a.award_id)?.title ?? null) : null,
        importedFrom: system(r.source_system),
      };
    }),
    ...reports.rows.map((r): Row => ({
      ...blank,
      record: RECORD_WORDS.report,
      title: r.title,
      organization: r.organization_name ?? null,
      program: programOf(null, null, r.award_id),
      fund: fundOf(null, r.award_id),
      outcome: r.report_state_label ?? PAST_REPORT_WORDS[r.report_state] ?? null,
      submittedOn: r.submitted_on,
      submittedYear: r.submitted_on?.slice(0, 4) ?? null,
      dueOn: r.due_on,
      award: awardOf(r.award_id)?.title ?? r.award_title,
      importedFrom: system(r.source_system),
    })),
  ];
  return { rows, truncated: apps.more || reviews.more || reports.more };
}

/** The rows of a data set for one funder workspace. Callers have authorized the reader. */
export function loadDataSet(base: Repos, key: DataSetKey, wsId: string, now: Date): Promise<Loaded> {
  switch (key) {
    case "applications":
      return loadApplications(base, wsId);
    case "awards":
      return loadAwards(base, wsId);
    case "payments":
      return loadPayments(base, wsId);
    case "requirements":
      return loadRequirements(base, wsId, now);
    case "organizations":
      return loadOrganizations(base, wsId);
    case "history":
      return loadHistory(base, wsId);
  }
}

async function compute(base: Repos, wsId: string, definition: Definition, now: Date, limit: number): Promise<ReportResult> {
  const p = plan(DATA_SETS[definition.dataSet], definition);
  const loaded = await loadDataSet(base, definition.dataSet, wsId, now);
  return run(p, loaded.rows, { now, limit, sourceTruncated: loaded.truncated });
}

// ------------------------------------------------------------------------------------ ad hoc

export { definitionInput };

/** The first 200 rows (or groups) of a definition. */
export async function previewReport(ctx: ServiceContext, definition: Definition) {
  const ws = await access(ctx);
  needDataSet(ctx, definition.dataSet);
  const result = await compute(ctx, ws.id, definition, ctx.now(), PREVIEW_ROWS);
  return { ...result, asOf: ctx.now().toISOString(), limit: PREVIEW_ROWS };
}

/** Up to 50,000 rows for a CSV download, and the file's name. */
export async function exportReport(ctx: ServiceContext, definition: Definition, name?: string) {
  const ws = await access(ctx);
  const d = needDataSet(ctx, definition.dataSet);
  const result = await compute(ctx, ws.id, definition, ctx.now(), CSV_MAX_ROWS);
  await audit(ctx, "report.exported", "workspace", ws.id, { dataSet: d.key, rows: result.rows.length, truncated: result.truncated });
  // The header row in the requester's language (the cells are data, as stored).
  return { ...result, columns: columnsIn(ctx.locale, definition, result.columns), filename: csvFilename(name ?? d.label, ctx.now()), limit: CSV_MAX_ROWS };
}

// ------------------------------------------------------------------------------------ views

/** The six views every funder starts with. Read only: "Save a copy" makes one the person can change and schedule. */
export const STARTER_VIEWS: readonly { key: string; name: string; description: string; definition: Definition }[] = [
  {
    key: "awards-this-year",
    name: "Awards this year by program",
    description: "Committed awards made this calendar year, by program: how many, how much, what was recorded as paid, what is still scheduled and how many reports are overdue.",
    definition: { dataSet: "awards", columns: ["program", "title", "recipient", "amount", "paidElsewhere", "scheduledRemaining", "overdueReports"], filters: [{ column: "awardDate", op: "between", from: "startOfYear", to: "endOfYear" }, { column: "status", op: "in", values: ["accepted", "active", "suspended", "completed"] }], groupBy: ["program"], aggregates: [{ fn: "count" }, { fn: "sum", column: "amount" }, { fn: "sum", column: "paidElsewhere" }, { fn: "sum", column: "scheduledRemaining" }, { fn: "sum", column: "overdueReports" }], sort: [{ column: "sum:amount", dir: "desc" }] },
  },
  {
    key: "payments-due-90",
    name: "Payments due next 90 days",
    description: "Payments not yet paid that fall due from today through the next 90 days.",
    definition: { dataSet: "payments", columns: ["dueDate", "recipient", "award", "tranche", "amount", "currency", "status", "program"], filters: [{ column: "dueDate", op: "between", from: "today", to: "today+90d" }, { column: "status", op: "in", values: ["scheduled", "due", "ready", "held", "failed"] }], groupBy: [], aggregates: [], sort: [{ column: "dueDate", dir: "asc" }] },
  },
  {
    key: "overdue-reports",
    name: "Overdue reports",
    description: "Reports and other requirements past their due date and not received, the latest first.",
    definition: { dataSet: "requirements", columns: ["title", "recipient", "award", "program", "dueDate", "overdueDays", "status"], filters: [{ column: "status", op: "eq", value: "overdue" }], groupBy: [], aggregates: [], sort: [{ column: "overdueDays", dir: "desc" }] },
  },
  {
    key: "applications-by-stage",
    name: "Applications by stage",
    description: "Submitted applications counted by competition and stage, with the amount requested and the average review score.",
    definition: { dataSet: "applications", columns: ["competition", "stage", "title", "status"], filters: [], groupBy: ["competition", "stage"], aggregates: [{ fn: "count" }, { fn: "sum", column: "requested" }, { fn: "avg", column: "averageScore" }], sort: [{ column: "competition", dir: "asc" }, { column: "stage", dir: "asc" }] },
  },
  {
    key: "grantees-by-total",
    name: "Grantees by total awarded",
    description: "Organizations holding an award from this funder, the largest total first.",
    definition: { dataSet: "organizations", columns: ["name", "verified", "location", "awardCount", "totalAwarded", "currency"], filters: [{ column: "awardCount", op: "between", from: 1 }], groupBy: [], aggregates: [], sort: [{ column: "totalAwarded", dir: "desc" }] },
  },
  {
    key: "decline-reasons",
    name: "Decline reasons",
    description: "Declined applications counted by the reason recorded with the decision.",
    definition: { dataSet: "applications", columns: ["declineReason", "title"], filters: [{ column: "status", op: "eq", value: "declined" }], groupBy: ["declineReason"], aggregates: [{ fn: "count" }], sort: [{ column: "count", dir: "desc" }] },
  },
];
// Each starter is checked against the whitelist when the module loads.
for (const s of STARTER_VIEWS) plan(DATA_SETS[s.definition.dataSet], definitionInput.parse(s.definition));

const STARTER_PREFIX = "starter-";

export const viewInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).nullable().optional(),
    visibility: z.enum(["private", "workspace"]).default("private"),
    definition: definitionInput,
  })
  .strict();
export const viewPatch = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    visibility: z.enum(["private", "workspace"]).optional(),
    definition: definitionInput.optional(),
  })
  .strict();

type View = DbRow<"report_views">;
type Schedule = DbRow<"report_schedules">;

async function namesFor(ctx: Pick<ServiceContext, "ports">, ids: readonly string[]): Promise<Map<string, string>> {
  const people = ctx.ports.directory ? await ctx.ports.directory.lookup([...new Set(ids)]) : new Map();
  return new Map([...people].map(([id, p]) => [id, p.name?.trim() || p.email?.split("@")[0] || "A member"]));
}

function scheduleView(s: Schedule | null | undefined, names: Map<string, string>, now: Date) {
  if (!s) return null;
  return {
    cadence: s.cadence as "weekly" | "monthly",
    weekday: s.weekday,
    dayOfMonth: s.day_of_month,
    recipients: s.recipient_user_ids.map((id) => ({ userId: id, name: names.get(id) ?? "A member" })),
    active: s.active,
    stoppedReason: s.stopped_reason,
    lastSentAt: s.last_sent_at,
    nextSendAt: s.active ? nextSendAt(s, now).toISOString() : null,
  };
}

function toView(v: View, me: string | null, schedule: Schedule | null | undefined, names: Map<string, string>, now: Date) {
  return {
    id: v.id,
    name: v.name,
    description: v.description,
    dataSet: v.data_set as DataSetKey,
    definition: v.definition as unknown as Definition,
    visibility: v.visibility as "private" | "workspace",
    starter: false,
    owner: { userId: v.owner_user_id, name: names.get(v.owner_user_id) ?? "A member" },
    mine: v.owner_user_id === me,
    schedule: scheduleView(schedule, names, now),
    createdAt: v.created_at,
    updatedAt: v.updated_at,
  };
}

const starterView = (s: (typeof STARTER_VIEWS)[number]) => ({ id: `${STARTER_PREFIX}${s.key}`, name: s.name, description: s.description, dataSet: s.definition.dataSet, definition: s.definition, visibility: "workspace" as const, starter: true, owner: null, mine: false, schedule: null, createdAt: null, updatedAt: null });

/** A saved view the caller may see: shared with the workspace, or the caller's own. 404 otherwise. */
async function visibleView(ctx: ServiceContext, ws: ServiceWorkspace, id: string): Promise<View> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw notFound("Report view");
  const v = await ctx.repos.table("report_views").one({ id: id.toLowerCase(), workspace_id: ws.id });
  if (!v || (v.visibility !== "workspace" && v.owner_user_id !== ctx.actor.userId)) throw notFound("Report view");
  return v;
}

/** The starter views and the saved views the caller may see (shared ones and its own private ones). */
export async function listViews(ctx: ServiceContext) {
  const ws = await access(ctx);
  const me = ctx.actor.userId;
  const [views, schedules] = await Promise.all([ctx.repos.table("report_views").find({ workspace_id: ws.id }, { orderBy: "name", limit: 1000 }), ctx.repos.table("report_schedules").find({ workspace_id: ws.id }, { limit: 1000 })]);
  const visible = views.filter((v) => v.visibility === "workspace" || v.owner_user_id === me);
  const mine = schedules.filter((s) => visible.some((v) => v.id === s.view_id));
  const names = await namesFor(ctx, [...visible.map((v) => v.owner_user_id), ...mine.flatMap((s) => s.recipient_user_ids)]);
  const now = ctx.now();
  return { starters: STARTER_VIEWS.map(starterView), saved: visible.map((v) => toView(v, me, mine.find((s) => s.view_id === v.id), names, now)) };
}

/** One view, starter or saved. */
export async function getView(ctx: ServiceContext, id: string) {
  const ws = await access(ctx);
  if (id.startsWith(STARTER_PREFIX)) {
    const s = STARTER_VIEWS.find((x) => `${STARTER_PREFIX}${x.key}` === id);
    if (!s) throw notFound("Report view");
    return starterView(s);
  }
  const v = await visibleView(ctx, ws, id);
  const schedule = await ctx.repos.table("report_schedules").one({ view_id: v.id, workspace_id: ws.id });
  const names = await namesFor(ctx, [v.owner_user_id, ...(schedule?.recipient_user_ids ?? [])]);
  return toView(v, ctx.actor.userId, schedule, names, ctx.now());
}

export async function createView(ctx: ServiceContext, input: z.output<typeof viewInput>) {
  const ws = await access(ctx);
  const me = personOnly(ctx, "Saving a report view");
  needDataSet(ctx, input.definition.dataSet);
  plan(DATA_SETS[input.definition.dataSet], input.definition);
  const v = await ctx.repos.table("report_views").insert({ workspace_id: ws.id, name: input.name, description: input.description ?? null, data_set: input.definition.dataSet, definition: input.definition as unknown as View["definition"], visibility: input.visibility, owner_user_id: me });
  await audit(ctx, "report.view_saved", "report_view", v.id, { name: v.name, dataSet: v.data_set, visibility: v.visibility });
  return getView(ctx, v.id);
}

/** The owner changes a view. A view sent to other people stays shared until its schedule is changed. */
export async function updateView(ctx: ServiceContext, id: string, input: z.output<typeof viewPatch>) {
  const ws = await access(ctx);
  const me = personOnly(ctx, "Changing a report view");
  const v = await visibleView(ctx, ws, id);
  if (v.owner_user_id !== me) throw forbidden("not_owner", "Only the person who saved this view can change it. Save a copy instead");
  if (input.definition) {
    needDataSet(ctx, input.definition.dataSet);
    plan(DATA_SETS[input.definition.dataSet], input.definition);
  }
  const schedule = await ctx.repos.table("report_schedules").one({ view_id: v.id, workspace_id: ws.id });
  if (input.visibility === "private" && schedule && schedule.recipient_user_ids.some((r) => r !== me)) throw new ApiError(409, "view_scheduled_to_others", "This view is sent to other people. Change its schedule to send it only to you before making it private");
  if (input.definition && schedule && input.definition.dataSet !== v.data_set) throw new ApiError(409, "view_scheduled", "This view is scheduled. Stop the schedule before changing its data set");
  await ctx.repos.table("report_views").update(
    { id: v.id, workspace_id: ws.id },
    {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      ...(input.definition ? { definition: input.definition as unknown as View["definition"], data_set: input.definition.dataSet } : {}),
    },
  );
  await audit(ctx, "report.view_changed", "report_view", v.id, { fields: Object.keys(input) });
  return getView(ctx, v.id);
}

/** The owner removes a view; an admin may remove a shared one. Its schedule stops and its files go. */
export async function deleteView(ctx: ServiceContext, id: string, store: ReportFileStore | null) {
  const ws = await access(ctx);
  const me = personOnly(ctx, "Removing a report view");
  const v = await visibleView(ctx, ws, id);
  if (v.owner_user_id !== me && !(ws.role === "admin" && v.visibility === "workspace")) throw forbidden("not_owner", "Only the person who saved this view, or an admin, can remove it");
  const files = await ctx.repos.table("report_files").find({ view_id: v.id, workspace_id: ws.id }, { limit: 1000 });
  if (store) for (const f of files) await store.delete(f.storage_key).catch(() => undefined);
  // The foreign keys cascade too; removing children first keeps the order explicit for every store.
  await ctx.repos.table("report_files").remove({ view_id: v.id, workspace_id: ws.id });
  await ctx.repos.table("report_schedules").remove({ view_id: v.id, workspace_id: ws.id });
  await ctx.repos.table("report_views").remove({ id: v.id, workspace_id: ws.id });
  await audit(ctx, "report.view_removed", "report_view", v.id, { name: v.name, files: files.length });
  return { id: v.id, deleted: true as const };
}

async function definitionOf(ctx: ServiceContext, ws: ServiceWorkspace, id: string): Promise<{ name: string; definition: Definition }> {
  if (id.startsWith(STARTER_PREFIX)) {
    const s = STARTER_VIEWS.find((x) => `${STARTER_PREFIX}${x.key}` === id);
    if (!s) throw notFound("Report view");
    return { name: s.name, definition: s.definition };
  }
  const v = await visibleView(ctx, ws, id);
  return { name: v.name, definition: definitionInput.parse(v.definition) };
}

/** A view's first 200 rows. The MCP tool `run_report_view` calls this. */
export async function runView(ctx: ServiceContext, id: string) {
  const ws = await access(ctx);
  const { name, definition } = await definitionOf(ctx, ws, id);
  return { viewId: id, name, ...(await previewReport(ctx, definition)) };
}

export async function exportView(ctx: ServiceContext, id: string) {
  const ws = await access(ctx);
  const { name, definition } = await definitionOf(ctx, ws, id);
  return exportReport(ctx, definition, name);
}

// ------------------------------------------------------------------------------------ schedules

/** Scheduled files go out at this hour (UTC) on their day: early morning in the Americas. */
export const SEND_HOUR_UTC = 13;
/** How long a scheduled file is kept and can be downloaded. */
export const FILE_DAYS = 30;
export const MAX_RECIPIENTS = 20;

export const scheduleInput = z
  .object({
    cadence: z.enum(["weekly", "monthly"]),
    /** Weekly: 1 = Monday … 7 = Sunday. */
    weekday: z.number().int().min(1).max(7).optional(),
    /** Monthly: 1-28. */
    dayOfMonth: z.number().int().min(1).max(28).optional(),
    /** Members of the workspace, by user id. Never an address. */
    recipientUserIds: z.array(z.uuid()).min(1).max(MAX_RECIPIENTS),
  })
  .strict()
  .refine((s) => (s.cadence === "weekly" ? s.weekday !== undefined && s.dayOfMonth === undefined : s.dayOfMonth !== undefined && s.weekday === undefined), "A weekly schedule names a weekday; a monthly one a day of the month");

const isoWeek = (t: Date) => {
  const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return { year, week };
};

/** The period that holds `at`, and when that period's file is sent. */
export function periodOf(s: Pick<Schedule, "cadence" | "weekday" | "day_of_month">, at: Date): { key: string; sendAt: Date } {
  if (s.cadence === "monthly") {
    const y = at.getUTCFullYear();
    const m = at.getUTCMonth();
    return { key: `${y}-${String(m + 1).padStart(2, "0")}`, sendAt: new Date(Date.UTC(y, m, s.day_of_month ?? 1, SEND_HOUR_UTC)) };
  }
  const dow = at.getUTCDay() || 7;
  const monday = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) - (dow - 1) * 86_400_000;
  const { year, week } = isoWeek(at);
  return { key: `${year}-W${String(week).padStart(2, "0")}`, sendAt: new Date(monday + ((s.weekday ?? 1) - 1) * 86_400_000 + SEND_HOUR_UTC * 3_600_000) };
}

/** When the next file goes out. */
export function nextSendAt(s: Pick<Schedule, "cadence" | "weekday" | "day_of_month" | "starts_at" | "last_period">, now: Date): Date {
  const cur = periodOf(s, now);
  if (cur.sendAt.getTime() >= Date.parse(s.starts_at) && s.last_period !== cur.key && cur.sendAt.getTime() >= now.getTime() - 3_600_000) return cur.sendAt;
  const later = s.cadence === "monthly" ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) : new Date(cur.sendAt.getTime() + 7 * 86_400_000);
  return periodOf(s, later).sendAt;
}

type Member = DbRow<"workspace_members">;
const live = (m: Member, now: Date) => !m.expires_at || Date.parse(m.expires_at) > now.getTime();

/**
 * Members who may receive this view: a live member whose role reads reports and the view's data set;
 * for a private view, its owner only. Never a member limited to some funds: the jobs Worker computes a
 * scheduled report for the whole workspace, so its file would hold other funds' records.
 */
async function eligibleMembers(base: Pick<BaseContext, "repos">, wsId: string, view: Pick<View, "data_set" | "visibility" | "owner_user_id">, now: Date): Promise<Member[]> {
  const scope = DATA_SETS[view.data_set as DataSetKey].scope;
  const members = await base.repos.table("workspace_members").find({ workspace_id: wsId }, { limit: 1000 });
  return members.filter((m) => live(m, now) && !fundScopeOf({ kind: "funder", role: m.role, memberScope: (m.scope as Record<string, unknown> | null) ?? null }) && (REPORT_ROLES as readonly string[]).includes(m.role) && scopesForRole("funder", m.role).includes(scope) && scopesForRole("funder", m.role).includes("analytics:read") && (view.visibility === "workspace" || m.user_id === view.owner_user_id));
}

/** Who the owner can send this view to. */
export async function scheduleRecipients(ctx: ServiceContext, id: string) {
  const ws = await access(ctx);
  const v = await visibleView(ctx, ws, id);
  const members = await eligibleMembers(ctx, ws.id, v, ctx.now());
  const names = await namesFor(ctx, members.map((m) => m.user_id));
  return members.map((m) => ({ userId: m.user_id, name: names.get(m.user_id) ?? "A member", role: m.role })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Send a saved view as a CSV every week or month to members of the workspace. A person only, the
 * view's owner; never through an API client or an agent (no MCP tool). Every recipient must be a
 * member who may read the report; the job checks again before every send.
 */
export async function setSchedule(ctx: ServiceContext, id: string, input: z.output<typeof scheduleInput>) {
  const ws = await access(ctx);
  const me = personOnly(ctx, "Scheduling a report");
  if (fundScopeOf(ws)) throw forbidden("fund_scope", "A scheduled report covers every fund. Ask a workspace admin to schedule it");
  const v = await visibleView(ctx, ws, id);
  if (v.owner_user_id !== me) throw forbidden("not_owner", "Only the person who saved this view can schedule it. Save a copy to schedule your own");
  needDataSet(ctx, v.data_set as DataSetKey);
  const recipients = [...new Set(input.recipientUserIds.map((x) => x.toLowerCase()))];
  const eligible = new Set((await eligibleMembers(ctx, ws.id, v, ctx.now())).map((m) => m.user_id));
  const refused = recipients.map((r, i) => ({ r, i })).filter(({ r }) => !eligible.has(r));
  if (refused.length) throw new ApiError(422, "recipient_not_allowed", v.visibility === "private" ? "A private view is sent only to you. Share it with the workspace to send it to colleagues" : "Send a report only to members of this workspace who can read it", refused.map(({ i }) => ({ code: "recipient_not_allowed", field: `recipientUserIds.${i}` })));
  const values = { cadence: input.cadence, weekday: input.cadence === "weekly" ? input.weekday! : null, day_of_month: input.cadence === "monthly" ? input.dayOfMonth! : null, recipient_user_ids: recipients, starts_at: ctx.now().toISOString(), active: true, stopped_reason: null };
  const existing = await ctx.repos.table("report_schedules").one({ view_id: v.id, workspace_id: ws.id });
  if (existing) await ctx.repos.table("report_schedules").update({ id: existing.id, workspace_id: ws.id }, values);
  else await ctx.repos.table("report_schedules").insert({ workspace_id: ws.id, view_id: v.id, created_by: me, last_period: null, last_sent_at: null, ...values });
  await audit(ctx, "report.scheduled", "report_view", v.id, { cadence: input.cadence, recipients: recipients.length });
  return getView(ctx, v.id);
}

export async function stopSchedule(ctx: ServiceContext, id: string) {
  const ws = await access(ctx);
  const me = personOnly(ctx, "Stopping a report schedule");
  const v = await visibleView(ctx, ws, id);
  if (v.owner_user_id !== me && ws.role !== "admin") throw forbidden("not_owner", "Only the person who saved this view, or an admin, can stop its schedule");
  const removed = await ctx.repos.table("report_schedules").remove({ view_id: v.id, workspace_id: ws.id });
  if (removed) await audit(ctx, "report.schedule_stopped", "report_view", v.id, {});
  return getView(ctx, v.id);
}

// ------------------------------------------------------------------------------------ files

/** Where scheduled CSVs are kept: the EXPORTS bucket, under the workspace. */
export interface ReportFileStore {
  put(key: string, body: string): Promise<void>;
  get(key: string): Promise<ReadableStream<Uint8Array> | string | null>;
  delete(key: string): Promise<void>;
}

/** The R2 bucket as a file store (the API and the jobs Worker both bind EXPORTS). */
export function r2ReportStore(bucket: { put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>; get(key: string): Promise<{ body: ReadableStream<Uint8Array> } | null>; delete(key: string): Promise<void> } | undefined | null): ReportFileStore | null {
  if (!bucket) return null;
  return {
    put: async (key, body) => void (await bucket.put(key, body, { httpMetadata: { contentType: "text/csv; charset=utf-8" } })),
    get: async (key) => (await bucket.get(key))?.body ?? null,
    delete: (key) => bucket.delete(key),
  };
}

const storageKey = (wsId: string, viewId: string, period: string) => `exports/${wsId}/reports/${viewId}/${period}.csv`;
const notExpired = (f: DbRow<"report_files">, now: Date) => Date.parse(f.expires_at) > now.getTime();

/** Scheduled files sent to the caller that are still kept, newest first. */
export async function listMyFiles(ctx: ServiceContext) {
  const ws = await access(ctx);
  const me = ctx.actor.userId;
  if (!me) return [];
  const files = (await ctx.repos.table("report_files").find({ workspace_id: ws.id }, { orderBy: "created_at", ascending: false, limit: 500 })).filter((f) => f.recipient_user_ids.includes(me) && notExpired(f, ctx.now()) && f.sent_at);
  const views = await byIds(ctx.repos, "report_views", files.map((f) => f.view_id));
  return files.slice(0, 50).map((f) => ({ id: f.id, viewId: f.view_id, viewName: views.find((v) => v.id === f.view_id)?.name ?? "Report", period: f.period_key, rows: f.row_count, truncated: f.truncated, createdAt: f.created_at, expiresAt: f.expires_at }));
}

/** A scheduled file, for one of the people it was sent to, signed in, while it is kept. */
export async function downloadFile(ctx: ServiceContext, fileId: string, store: ReportFileStore | null) {
  const ws = await access(ctx);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId)) throw notFound("Report file");
  const f = await ctx.repos.table("report_files").one({ id: fileId.toLowerCase(), workspace_id: ws.id });
  if (!f || !ctx.actor.userId || !f.recipient_user_ids.includes(ctx.actor.userId)) throw notFound("Report file");
  const view = await ctx.repos.table("report_views").one({ id: f.view_id, workspace_id: ws.id });
  if (!view) throw notFound("Report file");
  needDataSet(ctx, view.data_set as DataSetKey);
  if (!notExpired(f, ctx.now())) throw new ApiError(410, "file_expired", `Scheduled reports are kept for ${FILE_DAYS} days. Run the view again for a new file`);
  if (!store) throw new ApiError(503, "exports_not_configured", "This server keeps no report files");
  const body = await store.get(f.storage_key);
  if (body === null) throw new ApiError(410, "file_expired", `Scheduled reports are kept for ${FILE_DAYS} days. Run the view again for a new file`);
  await audit(ctx, "report.file_downloaded", "report_view", view.id, { fileId: f.id, period: f.period_key });
  // Stored once with English headers; each recipient downloads it with the header row in their language.
  const definition = definitionInput.parse(view.definition);
  const english = plan(DATA_SETS[definition.dataSet], definition).columns;
  return { body: withHeaderIn(body, english, columnsIn(ctx.locale, definition, english)), filename: `${csvFilename(view.name, new Date(f.created_at)).replace(/-\d{4}-\d{2}-\d{2}\.csv$/, "")}-${f.period_key}.csv` };
}

// ------------------------------------------------------------------------------------ the job


export interface ReportJobResult {
  due: number;
  sent: number;
  emails: number;
  skipped: number;
  stopped: number;
  purged: number;
  failed: number;
  reason?: string;
}

/**
 * The scheduled reports job (every 5 minutes): files past their 30 days are removed; each active
 * schedule whose send time in the current period has come writes its CSV once for that period
 * (one `report_files` row per view and period, unique), stores it, and emails each recipient
 * counts and a link to the signed-in download, never the file. A run that stopped before the
 * emails went out is finished by the next one; mail is sent with an idempotency key per file and
 * person, so nobody gets a file twice. A schedule stops when its owner can no longer read the
 * report, and a recipient who left the workspace (or whose role can no longer read it) is skipped.
 */
export async function sendScheduledReports(base: BaseContext, store: ReportFileStore | null): Promise<ReportJobResult> {
  const out: ReportJobResult = { due: 0, sent: 0, emails: 0, skipped: 0, stopped: 0, purged: 0, failed: 0 };
  const now = base.now();
  if (store) {
    const old = (await base.repos.table("report_files").find({}, { orderBy: "expires_at", limit: 200 })).filter((f) => !notExpired(f, now));
    for (const f of old) {
      try {
        await store.delete(f.storage_key);
        await base.repos.table("report_files").remove({ id: f.id, workspace_id: f.workspace_id });
        out.purged++;
      } catch {
        out.failed++;
      }
    }
  }
  const { mailer, directory } = base.ports;
  if (!store) return { ...out, reason: "EXPORTS is not bound" };
  if (!mailer || !base.config.mailFrom || !directory) return { ...out, reason: "mail is not configured" };

  const schedules = await base.repos.table("report_schedules").find({ active: true }, { limit: 1000 });
  for (const s of schedules) {
    const period = periodOf(s, now);
    if (period.sendAt.getTime() > now.getTime() || period.sendAt.getTime() < Date.parse(s.starts_at) || s.last_period === period.key) continue;
    out.due++;
    try {
      const done = await sendOne(base, store, s, period.key, now);
      out[done.outcome]++;
      out.emails += done.emails;
    } catch {
      out.failed++;
    }
  }
  return out;
}

async function sendOne(base: BaseContext, store: ReportFileStore, s: Schedule, period: string, now: Date): Promise<{ outcome: "sent" | "skipped" | "stopped"; emails: number }> {
  const ctx = systemContext(base, { job: "reports" }, { id: s.workspace_id, kind: "funder" });
  const stop = async (reason: "owner_left" | "no_recipients" | "view_private") => {
    await base.repos.table("report_schedules").update({ id: s.id, workspace_id: s.workspace_id }, { active: false, stopped_reason: reason });
    await audit(ctx, "report.schedule_stopped", "report_view", s.view_id, { reason }, s.workspace_id);
    return { outcome: "stopped" as const, emails: 0 };
  };
  const [ws, view] = await Promise.all([base.repos.table("workspaces").one({ id: s.workspace_id }), base.repos.table("report_views").one({ id: s.view_id, workspace_id: s.workspace_id })]);
  if (!ws || ws.kind !== "funder" || !view) return { outcome: "skipped", emails: 0 };
  const eligible = await eligibleMembers(base, ws.id, view, now);
  if (!eligible.some((m) => m.user_id === view.owner_user_id)) return stop("owner_left");
  const recipients = s.recipient_user_ids.filter((r) => eligible.some((m) => m.user_id === r));
  if (!recipients.length) return stop(view.visibility === "private" ? "view_private" : "no_recipients");

  // Claim the period: one file per view and period. A file already sent ends here; one left unsent is finished.
  let file = await base.repos.table("report_files").one({ view_id: view.id, period_key: period });
  if (file?.sent_at) {
    await base.repos.table("report_schedules").update({ id: s.id, workspace_id: s.workspace_id }, { last_period: period });
    return { outcome: "skipped", emails: 0 };
  }
  const definition = definitionInput.parse(view.definition);
  const result = await compute(base, ws.id, definition, now, CSV_MAX_ROWS);
  const key = storageKey(ws.id, view.id, period);
  if (!file) {
    try {
      file = await base.repos.table("report_files").insert({ workspace_id: ws.id, view_id: view.id, schedule_id: s.id, period_key: period, storage_key: key, row_count: result.rows.length, truncated: result.truncated, recipient_user_ids: recipients, sent_count: 0, sent_at: null, expires_at: new Date(now.getTime() + FILE_DAYS * 86_400_000).toISOString() });
    } catch {
      // Another run claimed this period a moment ago; it sends the file.
      return { outcome: "skipped", emails: 0 };
    }
  } else {
    file = (await base.repos.table("report_files").update({ id: file.id, workspace_id: ws.id }, { row_count: result.rows.length, truncated: result.truncated, recipient_user_ids: recipients }))[0] ?? file;
  }
  await store.put(key, csvText(result));

  const people = await base.ports.directory!.lookup(recipients);
  // A recipient who switched off scheduled report emails (or all email) still finds the file in the app.
  const members = await base.repos.table("workspace_members").find({ workspace_id: ws.id, user_id: recipients });
  const wantsEmail = (userId: string) => {
    const m = members.find((x) => x.user_id === userId);
    const prefs = normalizePreferences((m?.notification_preferences ?? {}) as never);
    return prefs.digest !== "off" && prefs.channels.report.email;
  };
  const link = `${base.config.webBaseUrl}/w/${ws.handle}/report-builder?file=${file!.id}`;
  // Each recipient in their own language; the view's and workspace's names as written.
  const locales = await recipientLocales(base.ports, recipients);
  const mailIn = (locale: Locale) => scheduledReportEmail({ view: view.name, workspace: ws.display_name, cadence: s.cadence as "weekly" | "monthly", period, rows: result.rows.length, truncated: result.truncated, max: CSV_MAX_ROWS, total: result.total, days: FILE_DAYS, link, locale });
  let emails = 0;
  for (const userId of recipients) {
    const to = people.get(userId)?.email;
    if (!to || !wantsEmail(userId)) continue;
    const locale = locales.get(userId) ?? DEFAULT_LOCALE;
    const { subject, text, html } = mailIn(locale);
    try {
      await base.ports.mailer!.send({ from: base.config.mailFrom!, to: [to], subject, text, html, locale, idempotencyKey: `report:${file!.id}:${userId}`, tags: [{ name: "kind", value: "scheduled_report" }] });
      emails++;
    } catch {
      // A failed email is not retried by this run; the file stays unsent and the next run tries again.
      return { outcome: "skipped", emails };
    }
  }
  await base.repos.table("report_files").update({ id: file!.id, workspace_id: ws.id }, { sent_count: emails, sent_at: now.toISOString() });
  await base.repos.table("report_schedules").update({ id: s.id, workspace_id: s.workspace_id }, { last_period: period, last_sent_at: now.toISOString() });
  await audit(ctx, "report.sent", "report_view", view.id, { period, rows: result.rows.length, recipients: recipients.length, emails }, ws.id);
  return { outcome: "sent", emails };
}

export type { Cell, Definition, ReportResult };
