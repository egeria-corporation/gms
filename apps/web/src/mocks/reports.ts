// SPDX-License-Identifier: AGPL-3.0-only
// The report builder in mock mode: the server's data sets and column whitelist, fixture rows for
// Riverbend's applications, awards, payments, reports and grantees (dates are relative to today so
// the starter views always have something to show), saved views and schedules held in the page,
// and CSV files written the way the server writes them.
import { ApiError } from "../api/client.ts";
import type { Cell, DataSet, DataSetKey, Definition, Recipient, ReportFile, ReportsApi, ReportView, Schedule, ViewInput } from "../api/reports.ts";
import { CSV_MAX_ROWS, PREVIEW_ROWS, ReportProblem, csvFilename, csvText, emptyDefinition, runReport } from "../lib/reports.ts";
import { MOCK_USER } from "./fixtures.ts";
import { USERS, USER_NAMES } from "./funder.ts";

type Rows = Record<string, Cell>[];
const APPLICATION = ["submitted", "screening", "under_review", "recommended", "accepted", "declined", "waitlisted", "revision_requested", "interview", "withdrawn"];
const AWARD = ["offered", "accepted", "active", "suspended", "completed", "cancelled"];
const TRANCHE = ["scheduled", "due", "ready", "releasing", "initiated", "settled", "held", "failed", "returned", "cancelled"];
const REQUIREMENT = ["scheduled", "due", "overdue", "submitted", "under_review", "accepted", "returned", "waived"];
const t = (key: string, label: string, source: string) => ({ key, label, type: "text" as const, source, aggregatable: false });
const n = (key: string, label: string, source: string) => ({ key, label, type: "number" as const, source, aggregatable: true });
const m = (key: string, label: string, source: string, aggregatable = true, note?: string) => ({ key, label, type: "money" as const, source, aggregatable, ...(note ? { note } : {}) });
const d = (key: string, label: string, source: string) => ({ key, label, type: "date" as const, source, aggregatable: false });
const s = (key: string, label: string, values: string[], statusKind: "application" | "award" | "tranche" | "requirement") => ({ key, label, type: "status" as const, source: "status", aggregatable: false, values, statusKind });

export const MOCK_DATA_SETS: DataSet[] = [
  {
    key: "applications",
    label: "Applications",
    description: "Submitted applications, with their opportunity, program, stage, status, request and review scores.",
    available: true,
    columns: [t("title", "Application", "applications.title"), t("applicant", "Applicant", "the applicant workspace's name"), t("opportunity", "Opportunity", "opportunities.title"), t("competition", "Competition", "competitions.title"), t("program", "Program", "programs.name"), t("stage", "Stage", "the competition's stage label"), s("status", "Status", APPLICATION, "application"), m("requested", "Requested amount", "applications.requested_amount_minor"), t("currency", "Currency", "applications.currency"), d("submittedOn", "Submitted on", "applications.submitted_at"), t("submittedYear", "Year submitted", "applications.submitted_at"), n("averageScore", "Average score", "submitted reviews at the current stage, 0-100"), n("reviews", "Reviews submitted", "reviews at the current stage"), t("decision", "Decision", "the latest committed decision"), t("declineReason", "Decline reason", "the rationale of the committed decline")],
  },
  {
    key: "awards",
    label: "Awards",
    description: "Awards with their program, recipient, amount, dates and what the payment schedule says is paid and still owed.",
    available: true,
    columns: [t("title", "Award", "awards.title"), t("program", "Program", "programs.name"), t("recipient", "Recipient", "the recipient workspace's name"), t("recipientVerified", "Recipient verified", "Passport verification, or a self-declared profile"), s("status", "Status", AWARD, "award"), m("amount", "Awarded amount", "awards.funding.awardedAmount"), t("currency", "Currency", "awards.funding.awardedAmount.currency"), d("awardDate", "Award date", "awards.key_dates.awardDate"), t("awardYear", "Award year", "the award date"), d("startDate", "Start", "period of performance"), d("endDate", "End", "period of performance"), m("paidElsewhere", "Paid elsewhere (recorded)", "settled payments recorded as paid outside the GMS"), m("scheduledRemaining", "Scheduled, not yet paid", "payments not yet paid"), d("nextPaymentDate", "Next payment date", "the earliest due date of a payment not yet paid"), n("overdueReports", "Overdue reports", "requirements of the award that are overdue"), m("disbursedThroughPassport", "Disbursed through Passport", "awards.funding.disbursedAmount", false, "Read from Passport, not a GMS figure; never added up")],
  },
  {
    key: "payments",
    label: "Payments",
    description: "Scheduled payments (tranches) of each award: when they are due, where they stand, and what was recorded as paid elsewhere.",
    available: true,
    columns: [t("tranche", "Payment", "the payment's place in the schedule"), t("award", "Award", "awards.title"), t("program", "Program", "programs.name"), t("recipient", "Recipient", "the recipient workspace's name"), m("amount", "Amount", "tranches.amount_minor"), t("currency", "Currency", "tranches.currency"), d("dueDate", "Due", "tranches.due_at"), s("status", "Status", TRANCHE, "tranche"), t("howPaid", "How it is paid", "through Passport, or recorded as paid elsewhere"), m("paidElsewhere", "Recorded paid elsewhere", "the amount of a payment recorded as paid outside the GMS"), d("paidOn", "Paid on", "the date recorded for a payment made elsewhere")],
  },
  {
    key: "requirements",
    label: "Reports and requirements",
    description: "What each award asks of its grantee: reports, documents and milestones, when they are due and how late they are.",
    available: true,
    columns: [t("title", "Requirement", "requirements.title"), t("type", "Type", "requirements.type"), t("award", "Award", "awards.title"), t("program", "Program", "programs.name"), t("recipient", "Recipient", "the recipient workspace's name"), d("dueDate", "Due", "requirements.due_at"), s("status", "Status", REQUIREMENT, "requirement"), n("overdueDays", "Days overdue", "days since the due date, for a requirement not yet received")],
  },
  {
    key: "organizations",
    label: "Organizations",
    description: "Organizations that applied to or were awarded by this funder: whether they are verified, where they are, and what they were awarded.",
    available: true,
    columns: [t("name", "Organization", "the workspace's name"), t("verified", "Verified", "Passport verification, or a self-declared profile"), t("location", "Location", "city and state, while the organization shares its record"), t("region", "State or region", "state, while the organization shares its record"), n("applications", "Applications submitted", "submitted applications to this funder"), n("awardCount", "Awards", "awards from this funder"), m("totalAwarded", "Total awarded", "awarded amounts of committed awards"), t("currency", "Currency", "the currency of those awards, or Mixed")],
  },
];

const day = (offset: number, now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offset * 86_400_000).toISOString().slice(0, 10);

/** The fixture rows, built against today so relative filters ("next 90 days", "this year") find something. */
export function mockRows(now = new Date()): Record<DataSetKey, Rows> {
  const year = String(now.getUTCFullYear());
  const health = "Community Health 2027";
  const A = ["Mobile Health Navigation for Rural Families", "Senior Nutrition Outreach", "Telehealth Room Expansion", "Winter Shelter Capacity", "Tenant Stability Counseling"] as const;
  const awards: Rows = [
    { title: A[0], program: health, recipient: "Alder Creek Family Services", recipientVerified: "Verified with Passport", status: "active", amount: 15_000_000, currency: "USD", awardDate: `${year}-02-03`, awardYear: year, startDate: `${year}-03-01`, endDate: `${Number(year) + 1}-02-28`, paidElsewhere: 5_000_000, scheduledRemaining: 10_000_000, nextPaymentDate: day(21, now), overdueReports: 0, disbursedThroughPassport: null },
    { title: A[1], program: health, recipient: "Lakeside Senior Center", recipientVerified: "Verified with Passport", status: "active", amount: 8_000_000, currency: "USD", awardDate: `${year}-02-10`, awardYear: year, startDate: `${year}-03-01`, endDate: `${Number(year) + 1}-02-28`, paidElsewhere: 0, scheduledRemaining: 8_000_000, nextPaymentDate: day(45, now), overdueReports: 1, disbursedThroughPassport: null },
    { title: A[2], program: health, recipient: "Copper Valley Clinic", recipientVerified: "Self-declared, not verified", status: "accepted", amount: 6_000_000, currency: "USD", awardDate: `${year}-03-12`, awardYear: year, startDate: `${year}-04-01`, endDate: `${Number(year) + 1}-03-31`, paidElsewhere: 0, scheduledRemaining: 6_000_000, nextPaymentDate: day(70, now), overdueReports: 0, disbursedThroughPassport: null },
    { title: A[3], program: "Community Health 2026", recipient: "Harbor Light Shelter", recipientVerified: "Verified with Passport", status: "active", amount: 7_600_000, currency: "USD", awardDate: `${Number(year) - 1}-09-15`, awardYear: String(Number(year) - 1), startDate: `${Number(year) - 1}-10-01`, endDate: `${year}-09-30`, paidElsewhere: 0, scheduledRemaining: 3_800_000, nextPaymentDate: day(9, now), overdueReports: 1, disbursedThroughPassport: 3_800_000 },
    { title: A[4], program: "Community Health 2026", recipient: "Northgate Housing Trust", recipientVerified: "Verified with Passport", status: "completed", amount: 9_000_000, currency: "USD", awardDate: `${Number(year) - 1}-06-01`, awardYear: String(Number(year) - 1), startDate: `${Number(year) - 1}-07-01`, endDate: `${year}-06-30`, paidElsewhere: 4_500_000, scheduledRemaining: 0, nextPaymentDate: null, overdueReports: 0, disbursedThroughPassport: 4_500_000 },
  ];
  const payments: Rows = [
    { tranche: "Payment 1 of 3", award: A[0], program: health, recipient: "Alder Creek Family Services", amount: 5_000_000, currency: "USD", dueDate: day(-40, now), status: "settled", howPaid: "Paid elsewhere", paidElsewhere: 5_000_000, paidOn: day(-38, now) },
    { tranche: "Payment 2 of 3", award: A[0], program: health, recipient: "Alder Creek Family Services", amount: 5_000_000, currency: "USD", dueDate: day(21, now), status: "scheduled", howPaid: null, paidElsewhere: null, paidOn: null },
    { tranche: "Payment 3 of 3", award: A[0], program: health, recipient: "Alder Creek Family Services", amount: 5_000_000, currency: "USD", dueDate: day(200, now), status: "scheduled", howPaid: null, paidElsewhere: null, paidOn: null },
    { tranche: "Payment 1 of 2", award: A[1], program: health, recipient: "Lakeside Senior Center", amount: 4_000_000, currency: "USD", dueDate: day(45, now), status: "scheduled", howPaid: null, paidElsewhere: null, paidOn: null },
    { tranche: "Payment 1 of 1", award: A[2], program: health, recipient: "Copper Valley Clinic", amount: 6_000_000, currency: "USD", dueDate: day(70, now), status: "scheduled", howPaid: null, paidElsewhere: null, paidOn: null },
    { tranche: "Payment 2 of 2", award: A[3], program: "Community Health 2026", recipient: "Harbor Light Shelter", amount: 3_800_000, currency: "USD", dueDate: day(9, now), status: "held", howPaid: null, paidElsewhere: null, paidOn: null },
    { tranche: "Payment 1 of 2", award: A[3], program: "Community Health 2026", recipient: "Harbor Light Shelter", amount: 3_800_000, currency: "USD", dueDate: day(-120, now), status: "settled", howPaid: "Through Passport", paidElsewhere: null, paidOn: null },
  ];
  const requirements: Rows = [
    { title: "Interim report", type: "Report", award: A[1], program: health, recipient: "Lakeside Senior Center", dueDate: day(-12, now), status: "overdue", overdueDays: 12 },
    { title: "Shelter occupancy report", type: "Report", award: A[3], program: "Community Health 2026", recipient: "Harbor Light Shelter", dueDate: day(-30, now), status: "overdue", overdueDays: 30 },
    { title: "Interim report", type: "Report", award: A[0], program: health, recipient: "Alder Creek Family Services", dueDate: day(60, now), status: "scheduled", overdueDays: 0 },
    { title: "Final report", type: "Report", award: A[4], program: "Community Health 2026", recipient: "Northgate Housing Trust", dueDate: day(-60, now), status: "accepted", overdueDays: 0 },
  ];
  const applications: Rows = [
    { title: "Mobile Health Navigation for Rural Families", applicant: "Alder Creek Family Services", opportunity: health, competition: "Community Health 2027 · Spring", program: health, stage: "Full proposal", status: "accepted", requested: 15_000_000, currency: "USD", submittedOn: `${year}-01-12`, submittedYear: year, averageScore: 86.5, reviews: 3, decision: "Approved", declineReason: null },
    { title: "Pediatric Dental Van", applicant: "Copper Valley Clinic", opportunity: health, competition: "Community Health 2027 · Spring", program: health, stage: "Full proposal", status: "under_review", requested: 9_000_000, currency: "USD", submittedOn: `${year}-01-20`, submittedYear: year, averageScore: 71.2, reviews: 2, decision: null, declineReason: null },
    { title: "Rural Ride Share", applicant: "Harbor Light Shelter", opportunity: health, competition: "Community Health 2027 · Spring", program: health, stage: "Letter of inquiry", status: "declined", requested: 4_000_000, currency: "USD", submittedOn: `${year}-01-05`, submittedYear: year, averageScore: null, reviews: 0, decision: "Declined", declineReason: "Outside our service area" },
    { title: "Food Pantry Refrigeration", applicant: "Lakeside Senior Center", opportunity: health, competition: "Community Health 2027 · Spring", program: health, stage: "Letter of inquiry", status: "declined", requested: 2_500_000, currency: "USD", submittedOn: `${year}-01-08`, submittedYear: year, averageScore: null, reviews: 0, decision: "Declined", declineReason: "Outside our service area" },
    { title: "Youth Mental Health Peers", applicant: "Northgate Housing Trust", opportunity: health, competition: "Community Health 2027 · Spring", program: health, stage: "Full proposal", status: "declined", requested: 6_500_000, currency: "USD", submittedOn: `${year}-01-15`, submittedYear: year, averageScore: 58.0, reviews: 3, decision: "Declined", declineReason: "Budget fully committed this cycle" },
  ];
  const organizations: Rows = [
    { name: "Alder Creek Family Services", verified: "Verified with Passport", location: "Alder Creek, OR", region: "OR", applications: 1, awardCount: 1, totalAwarded: 15_000_000, currency: "USD" },
    { name: "Northgate Housing Trust", verified: "Verified with Passport", location: null, region: null, applications: 1, awardCount: 1, totalAwarded: 9_000_000, currency: "USD" },
    { name: "Lakeside Senior Center", verified: "Verified with Passport", location: "Lakeside, OR", region: "OR", applications: 1, awardCount: 1, totalAwarded: 8_000_000, currency: "USD" },
    { name: "Harbor Light Shelter", verified: "Verified with Passport", location: "Port Marlow, OR", region: "OR", applications: 1, awardCount: 1, totalAwarded: 7_600_000, currency: "USD" },
    { name: "Copper Valley Clinic", verified: "Self-declared, not verified", location: "Copper Valley, OR", region: "OR", applications: 1, awardCount: 1, totalAwarded: 6_000_000, currency: "USD" },
  ];
  return { applications, awards, payments, requirements, organizations };
}

const def = (d: Partial<Definition> & Pick<Definition, "dataSet" | "columns">): Definition => ({ ...emptyDefinition(d.dataSet), ...d });
const STARTERS: { key: string; name: string; description: string; definition: Definition }[] = [
  { key: "awards-this-year", name: "Awards this year by program", description: "Committed awards made this calendar year, by program.", definition: def({ dataSet: "awards", columns: ["program", "title", "recipient", "amount", "paidElsewhere", "scheduledRemaining", "overdueReports"], filters: [{ column: "awardDate", op: "between", from: "startOfYear", to: "endOfYear" }, { column: "status", op: "in", values: ["accepted", "active", "suspended", "completed"] }], groupBy: ["program"], aggregates: [{ fn: "count" }, { fn: "sum", column: "amount" }, { fn: "sum", column: "paidElsewhere" }, { fn: "sum", column: "scheduledRemaining" }, { fn: "sum", column: "overdueReports" }], sort: [{ column: "sum:amount", dir: "desc" }] }) },
  { key: "payments-due-90", name: "Payments due next 90 days", description: "Payments not yet paid that fall due from today through the next 90 days.", definition: def({ dataSet: "payments", columns: ["dueDate", "recipient", "award", "tranche", "amount", "currency", "status", "program"], filters: [{ column: "dueDate", op: "between", from: "today", to: "today+90d" }, { column: "status", op: "in", values: ["scheduled", "due", "ready", "held", "failed"] }], sort: [{ column: "dueDate", dir: "asc" }] }) },
  { key: "overdue-reports", name: "Overdue reports", description: "Reports and other requirements past their due date and not received.", definition: def({ dataSet: "requirements", columns: ["title", "recipient", "award", "program", "dueDate", "overdueDays", "status"], filters: [{ column: "status", op: "eq", value: "overdue" }], sort: [{ column: "overdueDays", dir: "desc" }] }) },
  { key: "applications-by-stage", name: "Applications by stage", description: "Submitted applications counted by competition and stage.", definition: def({ dataSet: "applications", columns: ["competition", "stage", "title", "status"], groupBy: ["competition", "stage"], aggregates: [{ fn: "count" }, { fn: "sum", column: "requested" }, { fn: "avg", column: "averageScore" }], sort: [{ column: "competition", dir: "asc" }, { column: "stage", dir: "asc" }] }) },
  { key: "grantees-by-total", name: "Grantees by total awarded", description: "Organizations holding an award from this funder, the largest total first.", definition: def({ dataSet: "organizations", columns: ["name", "verified", "location", "awardCount", "totalAwarded", "currency"], filters: [{ column: "awardCount", op: "between", from: 1 }], sort: [{ column: "totalAwarded", dir: "desc" }] }) },
  { key: "decline-reasons", name: "Decline reasons", description: "Declined applications counted by the reason recorded with the decision.", definition: def({ dataSet: "applications", columns: ["declineReason", "title"], filters: [{ column: "status", op: "eq", value: "declined" }], groupBy: ["declineReason"], aggregates: [{ fn: "count" }], sort: [{ column: "count", dir: "desc" }] }) },
];

const MEMBERS: Recipient[] = [
  { userId: USERS.dana, name: USER_NAMES[USERS.dana]!, role: "admin" },
  { userId: USERS.marcus, name: USER_NAMES[USERS.marcus]!, role: "program_officer" },
  { userId: USERS.priya, name: USER_NAMES[USERS.priya]!, role: "finance" },
];

export interface ReportsStore {
  views: ReportView[];
  files: (ReportFile & { csv: string; recipients: string[] })[];
  /** Every CSV the mock handed out, newest last (tests read it). */
  downloads: { filename: string; text: string }[];
}

/** A scheduled file already sent to Dana, so the email link and "Sent to you" have something to show. */
export function seedReportsStore(now = new Date()): ReportsStore {
  const board: ReportView = { id: "0190d000-0000-7000-8000-000000000001", name: "Board pack: awards by program", description: "Sent to the board chair before each meeting.", dataSet: "awards", definition: def({ dataSet: "awards", columns: ["title", "program", "recipient", "amount", "paidElsewhere", "scheduledRemaining"], sort: [{ column: "program", dir: "asc" }] }), visibility: "workspace", starter: false, owner: { userId: USERS.marcus, name: USER_NAMES[USERS.marcus]! }, mine: false, schedule: { cadence: "monthly", weekday: null, dayOfMonth: 1, recipients: [{ userId: USERS.dana, name: USER_NAMES[USERS.dana]! }, { userId: USERS.marcus, name: USER_NAMES[USERS.marcus]! }], active: true, stoppedReason: null, lastSentAt: `${day(-14, now)}T13:00:00.000Z`, nextSendAt: `${day(17, now)}T13:00:00.000Z` }, createdAt: `${day(-90, now)}T16:00:00.000Z`, updatedAt: `${day(-90, now)}T16:00:00.000Z` };
  const rows = mockRows(now);
  const result = runReport(MOCK_DATA_SETS[1]!, board.definition, rows.awards, { now, limit: CSV_MAX_ROWS });
  return {
    views: [board],
    files: [{ id: "0190d000-0000-7000-8000-0000000000f1", viewId: board.id, viewName: board.name, period: day(-14, now).slice(0, 7), rows: result.rows.length, truncated: false, createdAt: `${day(-14, now)}T13:00:00.000Z`, expiresAt: `${day(16, now)}T13:00:00.000Z`, csv: csvText(result), recipients: [USERS.dana, USERS.marcus] }],
    downloads: [],
  };
}

const clone = <T>(x: T): T => structuredClone(x);

export function createMockReportsApi(opts: { store: ReportsStore; now?: () => Date }): ReportsApi {
  const now = () => opts.now?.() ?? new Date();
  const me = MOCK_USER.userId;
  const store = opts.store;
  const dataSet = (key: DataSetKey) => MOCK_DATA_SETS.find((x) => x.key === key)!;
  const problem = (e: unknown): never => {
    if (e instanceof ReportProblem) throw new ApiError(422, e.message, [{ code: e.code, field: e.field }]);
    throw e;
  };
  const compute = (d: Definition, limit: number) => {
    try {
      return runReport(dataSet(d.dataSet), d, mockRows(now())[d.dataSet], { now: now(), limit });
    } catch (e) {
      return problem(e);
    }
  };
  const starter = (x: (typeof STARTERS)[number]): ReportView => ({ id: `starter-${x.key}`, name: x.name, description: x.description, dataSet: x.definition.dataSet, definition: clone(x.definition), visibility: "workspace", starter: true, owner: null, mine: false, schedule: null, createdAt: null, updatedAt: null });
  const visible = (v: ReportView) => v.visibility === "workspace" || v.owner?.userId === me;
  const find = (id: string): ReportView => {
    const s = STARTERS.find((x) => `starter-${x.key}` === id);
    if (s) return starter(s);
    const v = store.views.find((x) => x.id === id);
    if (!v || !visible(v)) throw new ApiError(404, "Report view not found", []);
    return { ...clone(v), mine: v.owner?.userId === me };
  };
  const own = (id: string) => {
    const v = store.views.find((x) => x.id === id);
    if (!v || !visible(v)) throw new ApiError(404, "Report view not found", []);
    if (v.owner?.userId !== me) throw new ApiError(403, "Only the person who saved this view can change it. Save a copy instead", [{ code: "not_owner" }]);
    return v;
  };
  const csvFile = (name: string, d: Definition) => {
    const r = compute(d, CSV_MAX_ROWS);
    const file = { filename: csvFilename(name, now()), text: csvText(r) };
    store.downloads.push(file);
    return { filename: file.filename, blob: new Blob([file.text], { type: "text/csv;charset=utf-8" }) };
  };
  const nextSend = (s: Pick<Schedule, "cadence" | "weekday" | "dayOfMonth">) => {
    const t = now();
    if (s.cadence === "monthly") {
      const day0 = s.dayOfMonth ?? 1;
      const thisMonth = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), day0, 13);
      return new Date(thisMonth > t.getTime() ? thisMonth : Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, day0, 13)).toISOString();
    }
    const dow = t.getUTCDay() || 7;
    let ahead = ((s.weekday ?? 1) - dow + 7) % 7;
    const at = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + ahead, 13);
    if (at <= t.getTime()) ahead += 7;
    return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + ahead, 13)).toISOString();
  };
  return {
    dataSets: async () => clone(MOCK_DATA_SETS),
    preview: async (d) => compute(d, PREVIEW_ROWS),
    exportCsv: async (d, name) => csvFile(name ?? dataSet(d.dataSet).label, d),
    listViews: async () => ({ starters: STARTERS.map(starter), saved: store.views.filter(visible).map((v) => ({ ...clone(v), mine: v.owner?.userId === me })).sort((a, b) => a.name.localeCompare(b.name)) }),
    getView: async (id) => find(id),
    createView: async (input: ViewInput) => {
      if (!input.name.trim()) throw new ApiError(400, "The request is not valid", [{ code: "invalid_field", field: "name" }]);
      compute(input.definition, 1);
      const at = now().toISOString();
      const v: ReportView = { id: crypto.randomUUID(), name: input.name.trim(), description: input.description ?? null, dataSet: input.definition.dataSet, definition: clone(input.definition), visibility: input.visibility, starter: false, owner: { userId: me, name: USER_NAMES[me] ?? "Dana Ortiz" }, mine: true, schedule: null, createdAt: at, updatedAt: at };
      store.views.push(v);
      return clone(v);
    },
    updateView: async (id, patch) => {
      const v = own(id);
      if (patch.definition) compute(patch.definition, 1);
      if (patch.visibility === "private" && v.schedule?.recipients.some((r) => r.userId !== me)) throw new ApiError(409, "This view is sent to other people. Change its schedule to send it only to you before making it private", [{ code: "view_scheduled_to_others" }]);
      Object.assign(v, { ...(patch.name !== undefined ? { name: patch.name.trim() } : {}), ...(patch.description !== undefined ? { description: patch.description } : {}), ...(patch.visibility ? { visibility: patch.visibility } : {}), ...(patch.definition ? { definition: clone(patch.definition), dataSet: patch.definition.dataSet } : {}), updatedAt: now().toISOString() });
      return find(id);
    },
    deleteView: async (id) => {
      const v = store.views.find((x) => x.id === id);
      if (!v || !visible(v)) throw new ApiError(404, "Report view not found", []);
      if (v.owner?.userId !== me && v.visibility !== "workspace") throw new ApiError(403, "Only the person who saved this view, or an admin, can remove it", [{ code: "not_owner" }]);
      store.views = store.views.filter((x) => x.id !== id);
      store.files = store.files.filter((f) => f.viewId !== id);
      return { id, deleted: true as const };
    },
    runView: async (id) => {
      const v = find(id);
      return { ...compute(v.definition, PREVIEW_ROWS), viewId: id, name: v.name };
    },
    exportView: async (id) => {
      const v = find(id);
      return csvFile(v.name, v.definition);
    },
    recipients: async (id) => {
      const v = find(id);
      return clone(v.visibility === "private" ? MEMBERS.filter((x) => x.userId === me) : MEMBERS);
    },
    setSchedule: async (id, input) => {
      const v = own(id);
      const allowed = new Set((v.visibility === "private" ? MEMBERS.filter((x) => x.userId === me) : MEMBERS).map((x) => x.userId));
      const refused = input.recipientUserIds.map((r, i) => ({ r, i })).filter(({ r }) => !allowed.has(r));
      if (refused.length) throw new ApiError(422, v.visibility === "private" ? "A private view is sent only to you. Share it with the workspace to send it to colleagues" : "Send a report only to members of this workspace who can read it", refused.map(({ i }) => ({ code: "recipient_not_allowed", field: `recipientUserIds.${i}` })));
      const sched = { cadence: input.cadence, weekday: input.cadence === "weekly" ? (input.weekday ?? 1) : null, dayOfMonth: input.cadence === "monthly" ? (input.dayOfMonth ?? 1) : null };
      v.schedule = { ...sched, recipients: input.recipientUserIds.map((r) => ({ userId: r, name: MEMBERS.find((x) => x.userId === r)!.name })), active: true, stoppedReason: null, lastSentAt: null, nextSendAt: nextSend(sched) };
      return find(id);
    },
    stopSchedule: async (id) => {
      const v = own(id);
      v.schedule = null;
      return find(id);
    },
    listFiles: async () => store.files.filter((f) => f.recipients.includes(me) && Date.parse(f.expiresAt) > now().getTime()).map(({ csv: _csv, recipients: _r, ...f }) => clone(f)),
    downloadFile: async (id) => {
      const f = store.files.find((x) => x.id === id && x.recipients.includes(me));
      if (!f) throw new ApiError(404, "Report file not found", []);
      if (Date.parse(f.expiresAt) <= now().getTime()) throw new ApiError(410, "Scheduled reports are kept for 30 days. Run the view again for a new file", [{ code: "file_expired" }]);
      const file = { filename: `${csvFilename(f.viewName, new Date(f.createdAt)).replace(/-\d{4}-\d{2}-\d{2}\.csv$/, "")}-${f.period}.csv`, text: f.csv };
      store.downloads.push(file);
      return { filename: file.filename, blob: new Blob([file.text], { type: "text/csv;charset=utf-8" }) };
    },
  };
}
