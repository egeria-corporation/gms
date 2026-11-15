// SPDX-License-Identifier: AGPL-3.0-only
// The report builder: the column whitelist (unknown columns refused, no bank or identity column
// possible), grouping and sums, formula-safe CSV cells, the row cap, saved views and who sees
// them, and scheduled files: once per view and period, only to members who may read them, with
// counts and a link and never the file.
import { describe, expect, it, beforeEach } from "vitest";
import { scopesForRole } from "../src/auth/scopes.ts";
import { ApiError } from "../src/lib/errors.ts";
import { makeActor, type ServiceContext } from "../src/services/context.ts";
import * as reports from "../src/services/report-builder.ts";
import { CSV_MAX_ROWS, NOT_REPORTABLE, csvCell, csvStream, csvText, defineDataSet, definitionInput, plan, run, type Definition } from "../src/services/report-engine.ts";
import { CLIENT_AGENT, USER_ADMIN, USER_AUDITOR, USER_OFFICER, WEB, WS_APPLICANT, WS_FUNDER, WS_OTHER, harness, type Harness } from "./helpers.ts";

const WS_APPLICANT_2 = "44444444-4444-4444-8444-444444444444";
const USER_REVIEWER = "12121212-1212-4121-8121-121212121212";
const USER_OUTSIDER = "13131313-1313-4131-8131-131313131313";
const id = (n: number) => `0190b000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const P_HEALTH = id(1);
const P_HOUSING = id(2);
const OPP = id(3);
const COMP = id(4);
const AW1 = id(10);
const AW2 = id(11);
const AW3 = id(12);

let h: Harness;

function ctxAs(userId: string | null, role: string | null, opts: { kind?: "user" | "delegated" | "client"; scopes?: readonly string[]; ws?: string } = {}): ServiceContext {
  const kind = opts.kind ?? "user";
  return {
    repos: h.repos,
    ledger: h.ledger,
    webhooks: h.webhooks,
    now: () => h.clock.now,
    config: { baseUrl: "https://gms.test", webBaseUrl: WEB, passportBaseUrl: null, credentialsKey: null, passportClient: null, mailFrom: "OpenGrants GMS <notices@gms.test>" },
    ports: { directory: h.directory, mailer: h.mailer },
    actor: makeActor(kind, kind === "client" ? null : userId, kind === "user" ? null : CLIENT_AGENT),
    workspace: { id: opts.ws ?? WS_FUNDER, kind: "funder", role, memberScope: null },
    scopes: opts.scopes ?? (role ? scopesForRole("funder", role) : []),
  };
}
const admin = () => ctxAs(USER_ADMIN, "admin");
const officer = () => ctxAs(USER_OFFICER, "program_officer");
const auditor = () => ctxAs(USER_AUDITOR, "auditor");
const base = () => ({ repos: h.repos, ledger: h.ledger, webhooks: h.webhooks, now: () => h.clock.now, config: admin().config, ports: { directory: h.directory, mailer: h.mailer } });

const files = new Map<string, string>();
const store: reports.ReportFileStore = { put: async (k, b) => void files.set(k, b), get: async (k) => files.get(k) ?? null, delete: async (k) => void files.delete(k) };

const def = (d: Partial<Definition> & Pick<Definition, "dataSet" | "columns">): Definition => definitionInput.parse(d);
const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, code: e.code };
    throw e;
  }
  throw new Error("expected a refusal");
};

async function seed() {
  const t = h.repos.table.bind(h.repos);
  await t("workspaces").insert({ id: WS_APPLICANT_2, kind: "applicant", handle: "birch-hollow", display_name: "Birch Hollow Food Bank", org_projection: { name: "Birch Hollow Food Bank Inc", addresses: { primary: { city: "Birch Hollow", stateOrProvince: "WA" } } }, passport_org_id: "0190a000-0000-7000-8000-0000000000b2" });
  await t("workspaces").update({ id: WS_APPLICANT }, { passport_org_id: "0190a000-0000-7000-8000-0000000000a1", org_projection: { name: "Alder Creek Family Services", addresses: { primary: { city: "Alder Creek", stateOrProvince: "OR" } } }, verification_level: "L3" });
  // Alder Creek shares its record with the funder; Birch Hollow does not.
  await t("consents").insert({ applicant_workspace_id: WS_APPLICANT, funder_workspace_id: WS_FUNDER, basis: "application" });
  await t("workspace_members").insert({ workspace_id: WS_FUNDER, user_id: USER_REVIEWER, role: "reviewer" });
  h.directory.users.set(USER_AUDITOR, { email: "ana.lee@riverbendcf.example", name: "Ana Lee" });
  await t("programs").insert({ id: P_HEALTH, workspace_id: WS_FUNDER, name: "Health" });
  await t("programs").insert({ id: P_HOUSING, workspace_id: WS_FUNDER, name: "Housing" });
  await t("opportunities").insert({ id: OPP, workspace_id: WS_FUNDER, title: "Community Health 2027", slug: "community-health-2027", program_id: P_HEALTH });
  await t("competitions").insert({ id: COMP, workspace_id: WS_FUNDER, opportunity_id: OPP, title: "Spring cycle", stages: [{ key: "loi", label: "Letter of inquiry" }, { key: "full", label: "Full proposal" }] });
  const app = (n: number, extra: Record<string, unknown>) => t("applications").insert({ id: id(n), workspace_id: WS_FUNDER, competition_id: COMP, opportunity_id: OPP, applicant_workspace_id: WS_APPLICANT, stage: "full", title: `Application ${n}`, ...extra });
  await app(20, { status: "under_review", submitted_at: "2027-03-02T10:00:00Z", requested_amount_minor: 5_000_000 });
  await app(21, { status: "declined", submitted_at: "2027-03-03T10:00:00Z", requested_amount_minor: 2_000_000, applicant_workspace_id: WS_APPLICANT_2, stage: "loi" });
  await app(22, { status: "declined", submitted_at: "2027-03-04T10:00:00Z", requested_amount_minor: 1_000_000, stage: "loi" });
  await app(23, { status: "draft", requested_amount_minor: 9_000_000 });
  await t("decisions").insert({ workspace_id: WS_FUNDER, competition_id: COMP, application_id: id(21), outcome: "decline", rationale: "Outside our service area", committed_at: "2027-03-10T10:00:00Z" });
  await t("decisions").insert({ workspace_id: WS_FUNDER, competition_id: COMP, application_id: id(22), outcome: "decline", rationale: "Outside our service area", committed_at: "2027-03-11T10:00:00Z" });
  // Two reviews of application 20 at its stage, one recused.
  await t("rubrics").insert({ id: id(30), version: 1, workspace_id: WS_FUNDER, name: "Rubric", criteria: [{ key: "fit", label: "Fit", weight: 1, scale: { type: "numeric", min: 0, max: 10 } }] });
  for (const [n, score, status] of [[31, 8, "submitted"], [32, 6, "submitted"], [33, 0, "recused"]] as const) {
    await t("review_assignments").insert({ id: id(n), workspace_id: WS_FUNDER, application_id: id(20), reviewer_user_id: id(n + 100), rubric_id: id(30), rubric_version: 1, stage: "full", status });
    if (status === "submitted") await t("reviews").insert({ workspace_id: WS_FUNDER, assignment_id: id(n), scores: { fit: score }, submitted_at: "2027-03-20T10:00:00Z" });
  }
  const award = (aid: string, extra: Record<string, unknown>) => t("awards").insert({ id: aid, workspace_id: WS_FUNDER, ...extra } as never);
  await award(AW1, { title: "Clinic navigators", program_id: P_HEALTH, recipient_workspace_id: WS_APPLICANT, status: "active", funding: { awardedAmount: { amount: "100000.00", currency: "USD" }, disbursedAmount: { amount: "10000.00", currency: "USD" } }, key_dates: { awardDate: { date: "2027-02-01" }, periodOfPerformance: { startDate: "2027-03-01", endDate: "2028-02-29" } } });
  await award(AW2, { title: "Pantry shelving", program_id: P_HOUSING, recipient_workspace_id: WS_APPLICANT_2, status: "completed", funding: { awardedAmount: { amount: "50000.00", currency: "USD" } }, key_dates: { awardDate: { date: "2026-05-01" } } });
  await award(AW3, { title: "Exchange visit", program_id: P_HEALTH, recipient_workspace_id: WS_APPLICANT, status: "active", funding: { awardedAmount: { amount: "20000.00", currency: "EUR" } }, key_dates: { awardDate: { date: "2027-03-01" } } });
  await t("payment_schedules").insert({ id: id(40), workspace_id: WS_FUNDER, award_id: AW1 });
  await t("payment_schedules").insert({ id: id(41), workspace_id: WS_FUNDER, award_id: AW2 });
  const tranche = (n: number, extra: Record<string, unknown>) => t("tranches").insert({ id: id(n), workspace_id: WS_FUNDER, ...extra } as never);
  // Paid elsewhere and recorded (resolve mode), due, scheduled; and one paid through Passport.
  await tranche(50, { award_id: AW1, schedule_id: id(40), seq: 1, amount_minor: 2_500_000, status: "settled", mode: "resolve", external: { reference: "chk 1001", paidAt: "2027-03-05", destinationLast4: "4321" }, due_at: "2027-03-01T00:00:00Z" });
  await tranche(51, { award_id: AW1, schedule_id: id(40), seq: 2, amount_minor: 2_500_000, status: "due", due_at: "2027-05-01T00:00:00Z" });
  await tranche(52, { award_id: AW1, schedule_id: id(40), seq: 3, amount_minor: 5_000_000, status: "scheduled", due_at: "2027-09-01T00:00:00Z" });
  await tranche(53, { award_id: AW2, schedule_id: id(41), seq: 1, amount_minor: 5_000_000, status: "settled", mode: "facilitated", due_at: "2026-06-01T00:00:00Z" });
  await t("requirements").insert({ workspace_id: WS_FUNDER, award_id: AW1, title: "Interim report", type: "report", status: "overdue", due_at: "2027-04-01T00:00:00Z" });
  await t("requirements").insert({ workspace_id: WS_FUNDER, award_id: AW1, title: "Final report", type: "report", status: "scheduled", due_at: "2028-03-31T00:00:00Z" });
  await t("requirements").insert({ workspace_id: WS_FUNDER, award_id: AW2, title: "Photos", type: "document", status: "accepted", due_at: "2026-09-01T00:00:00Z" });
}

beforeEach(async () => {
  h = await harness();
  files.clear();
  await seed();
});

const cell = (r: { columns: { key: string }[]; rows: unknown[][] }, row: number, key: string) => r.rows[row]![r.columns.findIndex((c) => c.key === key)];

describe("the column whitelist", () => {
  it("has no column that could carry bank, identity or contact data", () => {
    for (const d of Object.values(reports.DATA_SETS)) for (const c of d.columns) expect(NOT_REPORTABLE.test(`${c.key} ${c.label} ${c.source}`), `${d.key}.${c.key}`).toBe(false);
  });

  it("refuses to define such a column", () => {
    const bad = [
      { key: "bankName", label: "Bank", source: "payee credential" },
      { key: "iban", label: "IBAN", source: "x" },
      { key: "payoutLast4", label: "Last 4", source: "x" },
      { key: "recipientEin", label: "Recipient EIN", source: "workspaces.ein" },
      { key: "contactEmail", label: "Contact", source: "x" },
      { key: "destinationId", label: "Payout", source: "x" },
      { key: "swiftCode", label: "Code", source: "x" },
    ];
    for (const b of bad) expect(() => defineDataSet({ key: "awards", label: "Awards", description: "", scope: "awards:read", columns: [{ ...b, type: "text" }] }), b.key).toThrow(/cannot be reported/);
  });

  it("refuses a column the data set does not have, and anything but column keys", async () => {
    const unknown = await refusal(reports.previewReport(admin(), def({ dataSet: "awards", columns: ["title", "ein"] })));
    expect(unknown).toEqual({ status: 422, code: "unknown_column" });
    // A workspace column that exists in the database is still not a column of the data set.
    expect((await refusal(reports.previewReport(admin(), def({ dataSet: "organizations", columns: ["name", "handle"] })))).code).toBe("unknown_column");
    expect(definitionInput.safeParse({ dataSet: "awards", columns: ["amount; drop table awards"] }).success).toBe(false);
    expect(definitionInput.safeParse({ dataSet: "awards", columns: ["amount"], sql: "select 1" }).success).toBe(false);
    expect(definitionInput.safeParse({ dataSet: "workspace_members", columns: ["user_id"] }).success).toBe(false);
    expect(definitionInput.safeParse({ dataSet: "awards", columns: ["title"], filters: [{ column: "recipient_individual", op: "eq", value: "x" }] }).success).toBe(false);
    expect(await refusal(reports.previewReport(admin(), def({ dataSet: "awards", columns: ["title"], filters: [{ column: "recipientIndividual", op: "eq", value: "x" }] })))).toEqual({ status: 422, code: "unknown_column" });
  });

  it("refuses filters, sums and sorts that do not fit the column", () => {
    const awards = reports.DATA_SETS.awards;
    const code = (d: Definition) => {
      try {
        plan(awards, d);
        return "ok";
      } catch (e) {
        return (e as ApiError).code;
      }
    };
    expect(code(def({ dataSet: "awards", columns: ["title"], groupBy: ["program"], aggregates: [{ fn: "sum", column: "title" }] }))).toBe("invalid_aggregate");
    // Passport's disbursed amount is shown, never added up.
    expect(code(def({ dataSet: "awards", columns: ["title"], groupBy: ["program"], aggregates: [{ fn: "sum", column: "disbursedThroughPassport" }] }))).toBe("invalid_aggregate");
    expect(code(def({ dataSet: "awards", columns: ["title"], groupBy: ["program"], aggregates: [{ fn: "avg", column: "disbursedThroughPassport" }] }))).toBe("invalid_aggregate");
    expect(code(def({ dataSet: "awards", columns: ["title"], filters: [{ column: "status", op: "eq", value: "paid" }] }))).toBe("invalid_filter");
    expect(code(def({ dataSet: "awards", columns: ["title"], filters: [{ column: "title", op: "between", from: 1 }] }))).toBe("invalid_filter");
    expect(code(def({ dataSet: "awards", columns: ["title"], sort: [{ column: "amount", dir: "asc" }] }))).toBe("unknown_column");
    expect(code(def({ dataSet: "awards", columns: ["title", "amount"], sort: [{ column: "amount", dir: "desc" }] }))).toBe("ok");
  });

  it("needs the data set's own scope as well as analytics:read", async () => {
    const token = ctxAs(USER_ADMIN, "admin", { kind: "delegated", scopes: ["analytics:read", "awards:read"] });
    expect((await reports.previewReport(token, def({ dataSet: "awards", columns: ["title"] }))).rows.length).toBe(3);
    expect(await refusal(reports.previewReport(token, def({ dataSet: "payments", columns: ["amount"] })))).toEqual({ status: 403, code: "insufficient_scope" });
    expect((await refusal(reports.previewReport(ctxAs(USER_REVIEWER, "reviewer"), def({ dataSet: "applications", columns: ["title"] })))).status).toBe(403);
    expect((await refusal(reports.previewReport(ctxAs(USER_ADMIN, "admin", { scopes: ["awards:read"] }), def({ dataSet: "awards", columns: ["title"] })))).code).toBe("insufficient_scope");
  });
});

describe("the data sets", () => {
  it("awards: amounts as recorded in the GMS, with Passport's figure apart", async () => {
    const r = await reports.previewReport(admin(), def({ dataSet: "awards", columns: ["title", "program", "recipient", "recipientVerified", "amount", "paidElsewhere", "scheduledRemaining", "nextPaymentDate", "overdueReports", "disbursedThroughPassport"], sort: [{ column: "title", dir: "asc" }] }));
    expect(r.rows.map((x) => x[0])).toEqual(["Clinic navigators", "Exchange visit", "Pantry shelving"]);
    expect(cell(r, 0, "amount")).toBe(10_000_000);
    // Only the payment recorded as paid elsewhere counts as paid elsewhere.
    expect(cell(r, 0, "paidElsewhere")).toBe(2_500_000);
    expect(cell(r, 0, "scheduledRemaining")).toBe(7_500_000);
    expect(cell(r, 0, "nextPaymentDate")).toBe("2027-05-01");
    expect(cell(r, 0, "overdueReports")).toBe(1);
    expect(cell(r, 0, "disbursedThroughPassport")).toBe(1_000_000);
    expect(r.columns.find((c) => c.key === "disbursedThroughPassport")?.label).toBe("Disbursed through Passport");
    // A payment made through Passport is not "paid elsewhere".
    expect(cell(r, 2, "paidElsewhere")).toBe(0);
    expect(cell(r, 0, "recipientVerified")).toBe("Verified with Passport");
    // Without a consent the funder names the organization by its workspace name.
    expect(cell(r, 2, "recipient")).toBe("Birch Hollow Food Bank");
    // Nothing bank-shaped leaves the data set, not even the last four digits on the payment record.
    expect(JSON.stringify(r)).not.toContain("4321");
    expect(JSON.stringify(r)).not.toContain("chk 1001");
  });

  it("applications: submitted only, with the inbox's average score and the decline reason", async () => {
    const r = await reports.previewReport(admin(), def({ dataSet: "applications", columns: ["title", "program", "stage", "status", "requested", "averageScore", "reviews", "declineReason"], sort: [{ column: "title", dir: "asc" }] }));
    expect(r.rows.map((x) => x[0])).toEqual(["Application 20", "Application 21", "Application 22"]);
    expect(cell(r, 0, "averageScore")).toBe(70);
    expect(cell(r, 0, "reviews")).toBe(2);
    expect(cell(r, 0, "stage")).toBe("Full proposal");
    expect(cell(r, 0, "program")).toBe("Health");
    expect(cell(r, 1, "declineReason")).toBe("Outside our service area");
  });

  it("payments and requirements", async () => {
    h.clock.now = new Date("2027-04-16T17:00:00Z");
    const p = await reports.previewReport(admin(), def({ dataSet: "payments", columns: ["tranche", "amount", "status", "howPaid", "paidElsewhere", "paidOn"], sort: [{ column: "tranche", dir: "asc" }], filters: [{ column: "status", op: "in", values: ["settled"] }] }));
    expect(p.rows).toEqual([
      ["Payment 1 of 1", 5_000_000, "settled", "Through Passport", null, null],
      ["Payment 1 of 3", 2_500_000, "settled", "Paid elsewhere", 2_500_000, "2027-03-05"],
    ]);
    const q = await reports.previewReport(admin(), def({ dataSet: "requirements", columns: ["title", "status", "overdueDays"], sort: [{ column: "overdueDays", dir: "desc" }] }));
    expect(q.rows[0]).toEqual(["Interim report", "overdue", 15]);
    expect(q.rows.slice(1).map((x) => x[2])).toEqual([0, 0]);
  });

  it("organizations: location only while the organization shares its record", async () => {
    const r = await reports.previewReport(admin(), def({ dataSet: "organizations", columns: ["name", "verified", "location", "awardCount", "totalAwarded", "currency"], sort: [{ column: "name", dir: "asc" }] }));
    // Alder Creek holds a USD and a EUR award: its total is left blank rather than adding the two.
    expect(r.rows).toEqual([
      ["Alder Creek Family Services", "Verified with Passport", "Alder Creek, OR", 2, null, "Mixed"],
      ["Birch Hollow Food Bank", "Verified with Passport", null, 1, 5_000_000, "USD"],
    ]);
  });

  it("reads a data set larger than one page of the database", async () => {
    for (let i = 0; i < 2100; i++) await h.repos.table("requirements").insert({ workspace_id: WS_FUNDER, award_id: AW2, title: `Item ${i}`, type: "document", status: "accepted" });
    const r = await reports.previewReport(admin(), def({ dataSet: "requirements", columns: ["title"], groupBy: ["status"], aggregates: [{ fn: "count" }], sort: [{ column: "count", dir: "desc" }] }));
    expect(r.rows[0]).toEqual(["accepted", 2101]);
  });

  it("never reads another workspace's rows", async () => {
    await h.repos.table("programs").insert({ id: id(90), workspace_id: WS_OTHER, name: "Other" });
    await h.repos.table("awards").insert({ id: id(91), workspace_id: WS_OTHER, title: "Someone else's award", program_id: id(90), status: "active" });
    const r = await reports.previewReport(admin(), def({ dataSet: "awards", columns: ["title"] }));
    expect(r.rows.flat()).not.toContain("Someone else's award");
  });
});

describe("grouping, sums and the CSV", () => {
  it("groups by one or two columns with count, sum and average, and never adds up two currencies", async () => {
    const r = await reports.previewReport(admin(), def({ dataSet: "awards", columns: ["title"], groupBy: ["program"], aggregates: [{ fn: "count" }, { fn: "sum", column: "amount" }, { fn: "avg", column: "amount" }, { fn: "sum", column: "paidElsewhere" }], sort: [{ column: "program", dir: "asc" }] }));
    expect(r.columns.map((c) => c.label)).toEqual(["Program", "Count", "Total awarded amount", "Average awarded amount", "Total paid elsewhere (recorded)"]);
    // Health holds a USD and a EUR award: its money totals are left blank, with a note.
    expect(r.rows).toEqual([
      ["Health", 2, null, null, null],
      ["Housing", 1, 5_000_000, 5_000_000, 0],
    ]);
    expect(r.warnings.join(" ")).toMatch(/more than one currency/);
    const two = await reports.previewReport(admin(), def({ dataSet: "awards", columns: ["title"], groupBy: ["program", "currency"], aggregates: [{ fn: "sum", column: "amount" }], sort: [{ column: "sum:amount", dir: "desc" }] }));
    expect(two.rows).toEqual([
      ["Health", "USD", 10_000_000],
      ["Housing", "USD", 5_000_000],
      ["Health", "EUR", 2_000_000],
    ]);
    expect(two.warnings).toEqual([]);
  });

  it("filters by equals, in, and date and money ranges, relative dates included", async () => {
    h.clock.now = new Date("2027-04-16T17:00:00Z");
    const titles = async (filters: Definition["filters"]) => (await reports.previewReport(admin(), def({ dataSet: "awards", columns: ["title"], filters, sort: [{ column: "title", dir: "asc" }] }))).rows.map((x) => x[0]);
    expect(await titles([{ column: "program", op: "eq", value: "housing" }])).toEqual(["Pantry shelving"]);
    expect(await titles([{ column: "status", op: "in", values: ["active"] }])).toEqual(["Clinic navigators", "Exchange visit"]);
    expect(await titles([{ column: "awardDate", op: "between", from: "startOfYear", to: "endOfYear" }])).toEqual(["Clinic navigators", "Exchange visit"]);
    expect(await titles([{ column: "awardDate", op: "between", from: "2026-01-01", to: "2026-12-31" }])).toEqual(["Pantry shelving"]);
    expect(await titles([{ column: "amount", op: "between", from: 3_000_000 }])).toEqual(["Clinic navigators", "Pantry shelving"]);
    const due = await reports.previewReport(admin(), def({ dataSet: "payments", columns: ["tranche"], filters: [{ column: "dueDate", op: "between", from: "today", to: "today+90d" }] }));
    expect(due.rows).toEqual([["Payment 2 of 3"]]);
  });

  it("writes formula-safe CSV cells", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1+2")).toBe("'-1+2");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tx")).toBe("'\tx");
    expect(csvCell("a, b")).toBe(`"a, b"`);
    expect(csvCell("Plain")).toBe("Plain");
    expect(csvCell(null)).toBe("");
    const result = { columns: [{ key: "title", label: "Award", type: "text" as const }, { key: "amount", label: "Amount", type: "money" as const }, { key: "status", label: "Status", type: "status" as const }], rows: [["=cmd|'/c calc'!A1", 1_234_567, "under_review"], ["@evil", null, null]] };
    expect(csvText(result)).toBe(`Award,Amount,Status\r\n'=cmd|'/c calc'!A1,12345.67,Under review\r\n'@evil,,\r\n`);
  });

  it("streams the same file it would write", async () => {
    const result = { columns: [{ key: "n", label: "N", type: "number" as const }], rows: Array.from({ length: 1234 }, (_, i) => [i]) };
    const text = await new Response(csvStream(result, 100)).text();
    expect(text).toBe(csvText(result));
  });

  it("caps a download at 50,000 rows and says so", () => {
    const p = plan(reports.DATA_SETS.requirements, def({ dataSet: "requirements", columns: ["title"] }));
    const rows = Array.from({ length: CSV_MAX_ROWS + 1 }, (_, i) => ({ title: `R${i}` }));
    const r = run(p, rows, { now: new Date(), limit: CSV_MAX_ROWS });
    expect(r.rows.length).toBe(50_000);
    expect(r.total).toBe(50_001);
    expect(r.truncated).toBe(true);
    const preview = run(p, rows, { now: new Date(), limit: 200 });
    expect(preview.rows.length).toBe(200);
  });

  it("an export is ledgered with counts only", async () => {
    const out = await reports.exportReport(admin(), def({ dataSet: "awards", columns: ["title", "amount"] }), "Awards by program");
    expect(out.filename).toBe("awards-by-program-2027-04-16.csv");
    const e = h.ledger.events.find((x) => x.eventType === "report.exported")!;
    expect(e.data).toEqual({ dataSet: "awards", rows: 3, truncated: false });
  });
});

describe("saved views", () => {
  it("lists six starter views that run", async () => {
    const list = await reports.listViews(auditor());
    expect(list.starters.map((s) => s.name)).toEqual(["Awards this year by program", "Payments due next 90 days", "Overdue reports", "Applications by stage", "Grantees by total awarded", "Decline reasons"]);
    for (const s of list.starters) expect((await reports.runView(admin(), s.id)).columns.length).toBeGreaterThan(0);
    const declines = await reports.runView(admin(), "starter-decline-reasons");
    expect(declines.rows).toEqual([["Outside our service area", 2]]);
    const overdue = await reports.runView(admin(), "starter-overdue-reports");
    expect(overdue.rows.map((r) => r[0])).toEqual(["Interim report"]);
    const year = await reports.runView(admin(), "starter-awards-this-year");
    expect(year.rows.map((r) => r[0])).toEqual(["Health"]);
  });

  it("keeps a private view to its owner and shares a workspace view", async () => {
    const mine = await reports.createView(officer(), { name: "My awards", visibility: "private", definition: def({ dataSet: "awards", columns: ["title"] }) });
    const shared = await reports.createView(officer(), { name: "Board pack", visibility: "workspace", definition: def({ dataSet: "awards", columns: ["title", "amount"] }) });
    expect(mine.mine).toBe(true);
    expect((await reports.listViews(auditor())).saved.map((v) => v.name)).toEqual(["Board pack"]);
    expect((await refusal(reports.getView(auditor(), mine.id))).status).toBe(404);
    expect((await refusal(reports.runView(auditor(), mine.id))).status).toBe(404);
    expect((await reports.runView(auditor(), shared.id)).rows.length).toBe(3);
    // Only the owner changes it; an admin may remove a shared view.
    expect((await refusal(reports.updateView(admin(), shared.id, { name: "Mine now" }))).code).toBe("not_owner");
    expect((await reports.updateView(officer(), shared.id, { name: "Board pack Q2" })).name).toBe("Board pack Q2");
    expect((await refusal(reports.deleteView(auditor(), shared.id, store))).code).toBe("not_owner");
    expect((await reports.deleteView(admin(), shared.id, store)).deleted).toBe(true);
    expect((await refusal(reports.deleteView(admin(), mine.id, store))).status).toBe(404);
  });

  it("saves views for people only, never for an agent or API client", async () => {
    const input = { name: "Agent view", visibility: "workspace" as const, definition: def({ dataSet: "awards", columns: ["title"] }) };
    expect((await refusal(reports.createView(ctxAs(USER_OFFICER, "program_officer", { kind: "delegated" }), input))).code).toBe("person_required");
    expect((await refusal(reports.createView(ctxAs(null, null, { kind: "client", scopes: ["analytics:read", "awards:read"] }), input))).code).toBe("person_required");
    expect((await refusal(reports.createView(officer(), { ...input, definition: def({ dataSet: "awards", columns: ["routing"] }) }))).code).toBe("unknown_column");
  });
});

describe("scheduled files", () => {
  async function scheduled(visibility: "private" | "workspace" = "workspace", recipients = [USER_OFFICER, USER_ADMIN]) {
    const v = await reports.createView(officer(), { name: "Board pack", visibility, definition: def({ dataSet: "awards", columns: ["title", "amount"] }) });
    // Friday 2027-04-16 17:00 UTC: this week's 13:00 send has passed, so the first file is next Friday's.
    const withSchedule = await reports.setSchedule(officer(), v.id, { cadence: "weekly", weekday: 5, recipientUserIds: recipients });
    return { v, withSchedule };
  }

  it("checks every recipient: members who may read the report only", async () => {
    const v = await reports.createView(officer(), { name: "Board pack", visibility: "workspace", definition: def({ dataSet: "awards", columns: ["title"] }) });
    const bad = async (ids: string[]) => refusal(reports.setSchedule(officer(), v.id, { cadence: "monthly", dayOfMonth: 1, recipientUserIds: ids }));
    expect(await bad([USER_OUTSIDER])).toEqual({ status: 422, code: "recipient_not_allowed" });
    expect((await bad([USER_REVIEWER])).code).toBe("recipient_not_allowed");
    expect(reports.scheduleInput.safeParse({ cadence: "weekly", weekday: 1, recipientUserIds: ["board@example.org"] }).success).toBe(false);
    expect(reports.scheduleInput.safeParse({ cadence: "weekly", weekday: 1, recipientUserIds: [USER_ADMIN], emails: ["board@example.org"] }).success).toBe(false);
    const priv = await reports.createView(officer(), { name: "Mine", visibility: "private", definition: def({ dataSet: "awards", columns: ["title"] }) });
    expect((await refusal(reports.setSchedule(officer(), priv.id, { cadence: "weekly", weekday: 1, recipientUserIds: [USER_ADMIN] }))).code).toBe("recipient_not_allowed");
    // Scheduling is a person's act, never an agent's, and the owner's.
    expect((await refusal(reports.setSchedule(ctxAs(USER_OFFICER, "program_officer", { kind: "delegated" }), v.id, { cadence: "weekly", weekday: 1, recipientUserIds: [USER_ADMIN] }))).code).toBe("person_required");
    expect((await refusal(reports.setSchedule(admin(), v.id, { cadence: "weekly", weekday: 1, recipientUserIds: [USER_ADMIN] }))).code).toBe("not_owner");
    const ok = await reports.setSchedule(officer(), v.id, { cadence: "monthly", dayOfMonth: 1, recipientUserIds: [USER_ADMIN, USER_AUDITOR] });
    expect(ok.schedule?.recipients.map((r) => r.name)).toEqual(["Helen Ortiz", "Ana Lee"]);
    expect(ok.schedule?.nextSendAt).toBe("2027-05-01T13:00:00.000Z");
  });

  it("sends once per view and period, with counts and a link and never the file", async () => {
    const { v, withSchedule } = await scheduled();
    expect(withSchedule.schedule?.nextSendAt).toBe("2027-04-23T13:00:00.000Z");
    expect(await reports.sendScheduledReports(base(), store)).toMatchObject({ due: 0, sent: 0 });
    h.clock.now = new Date("2027-04-23T13:05:00Z");
    const first = await reports.sendScheduledReports(base(), store);
    expect(first).toMatchObject({ due: 1, sent: 1, emails: 2 });
    const [file] = await h.repos.table("report_files").find({ view_id: v.id });
    expect(file).toMatchObject({ period_key: "2027-W16", row_count: 3, storage_key: `exports/${WS_FUNDER}/reports/${v.id}/2027-W16.csv` });
    expect(files.get(file!.storage_key)).toMatch(/^Award,Awarded amount\r\nClinic navigators,100000\.00\r\n/);
    expect(h.mailer.sent.map((m) => m.to[0]).sort()).toEqual(["dana.ortiz@riverbendcf.example", "helen.ortiz@riverbendcf.example"]);
    const mail = h.mailer.sent[0]!;
    expect(mail.text).toContain("3 rows");
    expect(mail.text).toContain(`${WEB}/w/riverbend/report-builder?file=${file!.id}`);
    // Counts only: no amount, no recipient, no row of the report in the email.
    expect(mail.text).not.toContain("Clinic navigators");
    expect(mail.html).not.toContain("100000");
    expect(JSON.stringify(mail)).not.toMatch(/attachments/);
    // The same period again, on the next tick: nothing new.
    h.clock.now = new Date("2027-04-23T13:10:00Z");
    expect(await reports.sendScheduledReports(base(), store)).toMatchObject({ due: 0, sent: 0 });
    expect(h.mailer.sent.length).toBe(2);
    expect((await h.repos.table("report_files").find({ view_id: v.id })).length).toBe(1);
    expect(h.ledger.events.filter((e) => e.eventType === "report.sent").map((e) => e.data)).toEqual([{ period: "2027-W16", rows: 3, recipients: 2, emails: 2 }]);
  });

  it("finishes a file whose emails did not all go out, without sending anyone a second email", async () => {
    await scheduled();
    h.clock.now = new Date("2027-04-23T13:05:00Z");
    // The second email fails: the file stays unsent.
    const send = h.mailer.send.bind(h.mailer);
    let calls = 0;
    h.mailer.send = async (m) => {
      calls++;
      if (calls === 2) throw new Error("mail down");
      return send(m);
    };
    expect(await reports.sendScheduledReports(base(), store)).toMatchObject({ sent: 0, skipped: 1, emails: 1 });
    h.mailer.send = send;
    h.clock.now = new Date("2027-04-23T13:10:00Z");
    expect(await reports.sendScheduledReports(base(), store)).toMatchObject({ sent: 1 });
    // The first person's retry carried the same idempotency key, so the mailer delivered it once.
    expect(new Set(h.mailer.sent.map((m) => m.idempotencyKey)).size).toBe(2);
    expect(h.mailer.sent.length).toBe(2);
    expect((await h.repos.table("report_files").find({})).length).toBe(1);
  });

  it("skips a member who left, and stops when the owner leaves or the view goes", async () => {
    const { v } = await scheduled();
    await h.repos.table("workspace_members").remove({ workspace_id: WS_FUNDER, user_id: USER_ADMIN });
    h.clock.now = new Date("2027-04-23T13:05:00Z");
    await reports.sendScheduledReports(base(), store);
    expect(h.mailer.sent.map((m) => m.to[0])).toEqual(["dana.ortiz@riverbendcf.example"]);
    const [file] = await h.repos.table("report_files").find({ view_id: v.id });
    expect(file!.recipient_user_ids).toEqual([USER_OFFICER]);
    // The owner leaves: the schedule stops and says why.
    await h.repos.table("workspace_members").remove({ workspace_id: WS_FUNDER, user_id: USER_OFFICER });
    h.clock.now = new Date("2027-04-30T13:05:00Z");
    expect(await reports.sendScheduledReports(base(), store)).toMatchObject({ stopped: 1, sent: 0 });
    expect(await h.repos.table("report_schedules").one({ view_id: v.id })).toMatchObject({ active: false, stopped_reason: "owner_left" });
  });

  it("stops when the view is removed, and keeps files 30 days", async () => {
    const { v } = await scheduled();
    h.clock.now = new Date("2027-04-23T13:05:00Z");
    await reports.sendScheduledReports(base(), store);
    const [file] = await h.repos.table("report_files").find({ view_id: v.id });
    // A recipient downloads it signed in; anyone else gets 404.
    const got = await reports.downloadFile(ctxAs(USER_ADMIN, "admin"), file!.id, store);
    expect(String(got.body)).toContain("Clinic navigators");
    expect(got.filename).toBe("board-pack-2027-W16.csv");
    expect((await refusal(reports.downloadFile(auditor(), file!.id, store))).status).toBe(404);
    expect((await refusal(reports.downloadFile(ctxAs(USER_ADMIN, "admin", { ws: WS_OTHER }), file!.id, store))).status).toBe(404);
    expect((await reports.listMyFiles(ctxAs(USER_ADMIN, "admin"))).map((f) => f.viewName)).toEqual(["Board pack"]);
    // After 30 days it is gone: the download says so and the job removes it.
    h.clock.now = new Date("2027-05-23T13:06:00Z");
    expect((await refusal(reports.downloadFile(ctxAs(USER_ADMIN, "admin"), file!.id, store))).status).toBe(410);
    await reports.stopSchedule(officer(), v.id);
    expect(await reports.sendScheduledReports(base(), store)).toMatchObject({ purged: 1 });
    expect(files.size).toBe(0);
    // Removing the view removes its schedule.
    await reports.setSchedule(officer(), v.id, { cadence: "weekly", weekday: 1, recipientUserIds: [USER_OFFICER] });
    await reports.deleteView(officer(), v.id, store);
    expect(await h.repos.table("report_schedules").find({ view_id: v.id })).toEqual([]);
  });

  it("sends a private view only to its owner, and nothing without mail or storage", async () => {
    await scheduled("private", [USER_OFFICER]);
    h.clock.now = new Date("2027-04-23T13:05:00Z");
    expect(await reports.sendScheduledReports({ ...base(), ports: { directory: h.directory } }, store)).toMatchObject({ reason: "mail is not configured", sent: 0 });
    expect(await reports.sendScheduledReports(base(), null)).toMatchObject({ reason: "EXPORTS is not bound" });
    expect(await reports.sendScheduledReports(base(), store)).toMatchObject({ sent: 1, emails: 1 });
    expect(h.mailer.sent.map((m) => m.to[0])).toEqual(["dana.ortiz@riverbendcf.example"]);
  });
});
