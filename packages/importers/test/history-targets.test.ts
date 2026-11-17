// SPDX-License-Identifier: AGPL-3.0-only
// Imported history (v1.12.0): a funder's past applications, reviews and reports. Each target's
// mapping and validation; the answers and criterion scores read from the columns no field takes;
// contact details never kept; bank- and identity-shaped columns dropped by the sensitive screen
// before anything is read, including from Bonterra CyberGrants' payee columns; and the presets of
// every system that exports the data. The fixtures are small, made-up exports; value-shaped
// sensitive cells are made at run time, so no file holds one.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADAPTERS,
  CYBERGRANTS,
  EMAIL_MASK,
  FILE_ADAPTERS,
  HISTORY_TARGET,
  PAST_APPLICATIONS_TARGET,
  PAST_REPORTS_TARGET,
  PAST_REVIEWS_TARGET,
  SENSITIVE_NUMBER_MASK,
  TARGETS,
  adapterMapping,
  adapterView,
  adaptersFor,
  answersOf,
  checkPastApplicationRow,
  checkPastReportRow,
  checkPastReviewRow,
  detectAdapter,
  planImport,
  readOutcome,
  readReportState,
  readScore,
  reviewerNameOf,
  screenColumns,
  setAsideNotAwarded,
  suggestMapping,
  tableFromCsv,
  type ImportTarget,
  type PastApplicationRecord,
  type PastReportRecord,
  type PastReviewRecord,
  type SourceTable,
} from "../src/index.ts";

const NINE = ["900", "00", "0001"].join("");
const LONG = ["0000", "0000", "0012"].join("");
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/adapters/${name}`, import.meta.url), "utf8")
    .replace("{NINE}", NINE)
    .replace("{LONG}", LONG);

const kept = (table: SourceTable) => screenColumns(table.header, table.rows.map((r) => r.cells)).keep.map((i) => table.header[i]!);

async function plan<N>(target: ImportTarget<string, N>, file: string, adapterKey: keyof typeof ADAPTERS) {
  const table = tableFromCsv(fixture(file));
  const columns = kept(table);
  const mapping = adapterMapping(ADAPTERS[adapterKey], target, columns);
  const p = setAsideNotAwarded(await planImport({ target, table, mapping, source: { kind: "csv", ref: null } }), table, ADAPTERS[adapterKey], target);
  return { table, columns, mapping, plan: p };
}

describe("the three history targets", () => {
  it("are registered, for funders, next to grant history", () => {
    expect(Object.keys(TARGETS)).toEqual(["outside_applications", "award_history", "history_applications", "history_reviews", "history_reports"]);
    for (const t of [PAST_APPLICATIONS_TARGET, PAST_REVIEWS_TARGET, PAST_REPORTS_TARGET]) for (const f of t.fields) expect(f.key).toMatch(/^[A-Za-z]{1,40}$/);
    expect(PAST_APPLICATIONS_TARGET.fields.filter((f) => f.required).map((f) => f.key)).toEqual(["organizationName", "title"]);
    expect(PAST_REPORTS_TARGET.fields.filter((f) => f.required).map((f) => f.key)).toEqual(["title"]);
    expect(PAST_REVIEWS_TARGET.fields.filter((f) => f.required)).toEqual([]);
    // No field of any of them takes a contact detail.
    for (const t of [PAST_APPLICATIONS_TARGET, PAST_REVIEWS_TARGET, PAST_REPORTS_TARGET]) for (const f of t.fields) expect(`${f.key} ${f.synonyms.join(" ")}`).not.toMatch(/mail|phone|address/i);
  });

  it("suggest a mapping from plain headers", () => {
    expect(suggestMapping(PAST_APPLICATIONS_TARGET, ["Organization", "Application title", "Round", "Submitted", "Decision", "Amount requested", "Amount awarded", "Application ID"])).toEqual({
      organizationName: "Organization",
      title: "Application title",
      callTitle: "Round",
      submittedDate: "Submitted",
      outcome: "Decision",
      requestedAmount: "Amount requested",
      awardedAmount: "Amount awarded",
      sourceId: "Application ID",
    });
    expect(suggestMapping(PAST_REVIEWS_TARGET, ["Review ID", "Application ID", "Reviewer", "Impact score", "Total score", "Recommendation", "Comments"])).toEqual({ sourceId: "Review ID", applicationRef: "Application ID", reviewerName: "Reviewer", totalScore: "Total score", recommendation: "Recommendation", comment: "Comments" });
    expect(suggestMapping(PAST_REPORTS_TARGET, ["Grant ID", "Grant title", "Report", "Due date", "Date submitted", "Status"])).toEqual({ awardRef: "Grant ID", awardTitle: "Grant title", title: "Report", dueDate: "Due date", submittedDate: "Date submitted", status: "Status" });
  });
});

describe("past applications", () => {
  it("check each row: organization and title, amounts, dates and the EIN", () => {
    const ok = checkPastApplicationRow({ organizationName: " River  Clinic ", title: "Clinic van", submittedDate: "1/10/2024", outcome: "Accepted", requestedAmount: "$45,000", awardedAmount: "40000", organizationEin: "12-3456789", sourceId: " 70012345 " });
    expect(ok.problems).toEqual([]);
    expect(ok.record).toMatchObject({ organizationName: "River Clinic", title: "Clinic van", submittedOn: "2024-01-10", outcome: "awarded", outcomeLabel: "Accepted", currency: "USD", requestedAmountMinor: 4_500_000, awardedAmountMinor: 4_000_000, organizationEin: "123456789", sourceId: "70012345" });
    expect(ok.money).toEqual([
      { kind: "ask", amountMinor: 4_500_000, currency: "USD", year: 2024 },
      { kind: "awarded", amountMinor: 4_000_000, currency: "USD", year: 2024 },
    ]);
    const bad = checkPastApplicationRow({ requestedAmount: "lots", submittedDate: "soon", organizationEin: "12", currency: "dollars" });
    expect(bad.record).toBeNull();
    expect(bad.problems.map((p) => p.field).sort()).toEqual(["currency", "organizationEin", "organizationName", "requestedAmount", "submittedDate", "title"]);
  });

  it("read the outcome from the system's words, and keep the words as written", () => {
    expect(["Accepted", "Approved", "Funded", "Completed", "Granted"].map(readOutcome)).toEqual(Array(5).fill("awarded"));
    expect(["Declined", "Rejected", "Not funded", "Unsuccessful", "Declined - waitlist"].map(readOutcome)).toEqual(Array(5).fill("declined"));
    expect(["Withdrawn", "Cancelled"].map(readOutcome)).toEqual(["withdrawn", "withdrawn"]);
    expect(["In-Progress", "Under review", "Submitted", "Waitlisted"].map(readOutcome)).toEqual(Array(4).fill("undecided"));
    expect([undefined, "", "Blue"].map(readOutcome)).toEqual(["unknown", "unknown", "unknown"]);
  });

  it("keep the other columns as questions and answers, without contact details or bank and identity numbers", () => {
    const answers = answersOf([
      { column: "Project summary", value: "A van. Write to someone@example.org or call 555-010-0123" },
      { column: "Submitter Email", value: "someone@example.org" },
      { column: "Contact phone", value: "555-010-0123" },
      { column: "Mailing address", value: "1 Main St" },
      { column: "Payee Name", value: "River Clinic" },
      { column: "Labels", value: "priority" },
      { column: "How many people will you serve?", value: "1200" },
      { column: "Tell us more", value: `Our account ${LONG} is new` },
    ]);
    expect(answers.map((a) => a.question)).toEqual(["Project summary", "How many people will you serve?", "Tell us more"]);
    expect(answers[0]!.answer).toBe(`A van. Write to ${EMAIL_MASK} or call ${SENSITIVE_NUMBER_MASK}`);
    expect(answers[2]!.answer).toBe(`Our account ${SENSITIVE_NUMBER_MASK} is new`);
    expect(JSON.stringify(answers)).not.toContain(LONG);
  });

  it("from Submittable: every submission, its answers, and the sensitive columns dropped before any is read", async () => {
    const { mapping, plan: p, columns } = await plan(PAST_APPLICATIONS_TARGET, "submittable-applications.csv", "submittable");
    expect(columns).not.toContain("Bank acct");
    expect(columns).not.toContain("Reference");
    expect(mapping).toMatchObject({ sourceId: "Submission ID", title: "Title", organizationName: "Organization", callTitle: "Category", submittedDate: "Date Submitted", outcome: "Status", requestedAmount: "Amount Requested", awardedAmount: "Amount Awarded" });
    // Nothing is set aside: a declined or withdrawn application is history too.
    expect(p.rows.map((r) => r.outcome)).toEqual(["create", "create", "create"]);
    const records = p.rows.map((r) => r.record as PastApplicationRecord);
    expect(records.map((r) => r.outcome)).toEqual(["awarded", "declined", "withdrawn"]);
    expect(records[0]!.answers).toEqual([
      { question: "Project summary", answer: `A mobile clinic for rural families. Write to ${EMAIL_MASK}` },
      { question: "How many people will you serve?", answer: "1200" },
    ]);
    const text = JSON.stringify(p);
    expect(text).not.toContain(NINE);
    expect(text).not.toContain("ana@example.org");
    expect(text).not.toContain("Ruiz");
  });
});

describe("past reviews", () => {
  it("read criterion scores from the score columns, and never a reviewer's contact details", async () => {
    expect([readScore("4"), readScore("4.5"), readScore("4/5"), readScore("3 out of 5"), readScore("n/a"), readScore(""), readScore("good")]).toEqual([{ score: 4, outOf: null }, { score: 4.5, outOf: null }, { score: 4, outOf: 5 }, { score: 3, outOf: 5 }, undefined, undefined, null]);
    expect(reviewerNameOf("Lee Moss <lee@example.org>")).toBe("Lee Moss");
    expect(reviewerNameOf("lee@example.org")).toBeNull();
    expect(reviewerNameOf("555-010-0123")).toBeNull();
    const { mapping, plan: p } = await plan(PAST_REVIEWS_TARGET, "submittable-reviews.csv", "submittable");
    expect(mapping).toEqual({ applicationRef: "Submission ID", applicationTitle: "Submission Title", reviewerName: "Reviewer", totalScore: "Total Score", recommendation: "Recommendation", comment: "Comments", reviewedDate: "Date Completed" });
    expect(p.rows.map((r) => r.outcome)).toEqual(["create", "create", "create", "create"]);
    const [first, second, third] = p.rows.map((r) => r.record as PastReviewRecord);
    expect(first).toMatchObject({ applicationRef: "70012345", reviewerName: "Jo Park", totalScore: 13, recommendation: "Fund", reviewedOn: "2024-02-01" });
    expect(first!.scores).toEqual([
      { criterion: "Impact score", score: 5, outOf: null },
      { criterion: "Feasibility score", score: 4, outOf: null },
      { criterion: "Budget score", score: 4, outOf: 5 },
    ]);
    expect(first!.comment).toBe(`Strong plan. Questions to ${EMAIL_MASK}`);
    expect(second!.reviewerName).toBe("Lee Moss");
    // "n/a" is no score, not a problem.
    expect(third!.scores.map((s) => s.criterion)).toEqual(["Impact score", "Feasibility score"]);
    expect(JSON.stringify(p)).not.toMatch(/(jo|lee)@example\.org/);
  });

  it("need the application and something the reviewer said", () => {
    expect(checkPastReviewRow({ comment: "Fine" }).problems).toEqual([{ field: "applicationTitle", message: "Name the application reviewed: its ID or its title" }]);
    expect(checkPastReviewRow({ applicationRef: "1" }).problems.map((p) => p.message)).toEqual(["The review has no score, recommendation or comment"]);
    expect(checkPastReviewRow({ applicationRef: "1", totalScore: "high" }).problems.map((p) => p.field)).toEqual(["totalScore", "totalScore"]);
    expect(checkPastReviewRow({ applicationRef: "1" }, [{ column: "Impact score", value: "lots" }]).problems.map((p) => p.message)).toContain("Impact score is not a number");
    expect(checkPastReviewRow({ applicationRef: "1", totalScore: "0" }).problems).toEqual([]);
  });
});

describe("past reports", () => {
  it("check each row and read where it stood", () => {
    const r = checkPastReportRow({ awardRef: "48211", title: "Final Impact Report", dueDate: "2025-06-30", submittedDate: "2025-06-20", status: "Completed" });
    expect(r.problems).toEqual([]);
    expect(r.record).toMatchObject({ awardRef: "48211", title: "Final Impact Report", dueOn: "2025-06-30", submittedOn: "2025-06-20", state: "submitted", stateLabel: "Completed" });
    expect(checkPastReportRow({ title: "Report" }).problems.map((p) => p.field)).toEqual(["awardTitle"]);
    expect(checkPastReportRow({ awardTitle: "Van", dueDate: "later" }).problems.map((p) => p.field).sort()).toEqual(["dueDate", "title"]);
    expect([["Approved", false], ["Past Due", false], ["Not Started", false], ["Submitted late", true], ["Received", true], ["Due", false], ["", true], ["", false], ["Blue", false]].map(([s, sub]) => readReportState(s as string, sub as boolean))).toEqual(["approved", "late", "not_submitted", "late", "submitted", "not_submitted", "submitted", "unknown", "unknown"]);
  });
});

describe("Bonterra CyberGrants", () => {
  it("is a file adapter for grant history, past applications and past reports", () => {
    expect(FILE_ADAPTERS.map((a) => a.key)).toContain("cybergrants");
    expect(Object.keys(CYBERGRANTS.presets)).toEqual(["award_history", "history_applications", "history_reports"]);
    expect(adapterView(CYBERGRANTS, "history_reports").steps[0]).toMatch(/impact reports/);
    expect(adapterView(CYBERGRANTS).steps[0]).toMatch(/requests/);
    expect(CYBERGRANTS.headersConfirmed).toBe(false);
  });

  it("drops the payee's bank columns, by header and by value, before anything is mapped", async () => {
    const table = tableFromCsv(fixture("cybergrants-requests.csv"));
    const s = screenColumns(table.header, table.rows.map((r) => r.cells));
    expect(s.dropped.map((d) => [d.column, d.reason])).toEqual([
      ["Payee Bank Acct", "header"],
      ["Payee Routing", "header"],
      ["Payee Reference", "identity_number"],
    ]);
    expect(detectAdapter(kept(table), FILE_ADAPTERS)?.adapter.key).toBe("cybergrants");
    for (const target of [HISTORY_TARGET, PAST_APPLICATIONS_TARGET] as ImportTarget<string, unknown>[]) {
      const { mapping, plan: p } = await plan(target, "cybergrants-requests.csv", "cybergrants");
      for (const dropped of ["Payee Bank Acct", "Payee Routing", "Payee Reference"]) expect(Object.values(mapping)).not.toContain(dropped);
      const text = JSON.stringify(p);
      expect(text).not.toContain(NINE);
      expect(text).not.toContain("on file");
    }
    const apps = await plan(PAST_APPLICATIONS_TARGET, "cybergrants-requests.csv", "cybergrants");
    expect(apps.mapping).toMatchObject({ sourceId: "Request ID", organizationName: "Organization Name", title: "Project Title", callTitle: "Proposal Type", outcome: "Grant Status", requestedAmount: "Requested Amount", awardedAmount: "Grant Amount" });
    const records = apps.plan.rows.map((r) => r.record as PastApplicationRecord);
    expect(records.map((r) => r.outcome)).toEqual(["awarded", "declined", "awarded"]);
    // The payee, the request owner and the payment columns are not answers.
    expect(records[0]!.answers.map((a) => a.question)).toEqual(["Approval Date", "Volunteer Hours Pledged"]);
    // The long account-style number in the payee column of row 3 dropped that column for every row.
    expect(JSON.stringify(apps.plan)).not.toContain(LONG);
  });

  it("imports impact reports as past reports", async () => {
    const { mapping, plan: p } = await plan(PAST_REPORTS_TARGET, "cybergrants-impact-reports.csv", "cybergrants");
    expect(mapping).toEqual({ sourceId: "Impact Report ID", awardRef: "Request ID", awardTitle: "Project Title", organizationName: "Organization Name", title: "Impact Report Type", dueDate: "Due Date", submittedDate: "Date Completed", status: "Impact Report Status" });
    expect(p.rows.map((r) => (r.record as PastReportRecord).state)).toEqual(["submitted", "late", "not_submitted"]);
  });
});

describe("presets for the history targets", () => {
  it("are offered where the system's exports carry the data", () => {
    expect(adaptersFor("history_applications").map((a) => a.key)).toEqual(["good_grants", "sm_apply", "submittable", "foundant_glm", "smartsimple", "openwater", "cybergrants", "fluxx", "zengine"]);
    expect(adaptersFor("history_reviews").map((a) => a.key)).toEqual(["good_grants", "submittable", "smartsimple", "openwater", "zengine"]);
    expect(adaptersFor("history_reports").map((a) => a.key)).toEqual(["cybergrants", "fluxx", "zengine"]);
    expect(adaptersFor("outside_applications")).toEqual([]);
  });

  it("name only fields of their target, and steps for the target when they differ", () => {
    for (const a of Object.values(ADAPTERS)) {
      for (const [target, preset] of Object.entries(a.presets)) {
        const fields = new Set((TARGETS[target as keyof typeof TARGETS] as unknown as ImportTarget).fields.map((f) => f.key));
        for (const [field, candidates] of Object.entries(preset ?? {})) {
          expect(fields.has(field), `${a.key} ${target} ${field}`).toBe(true);
          for (const c of candidates ?? []) expect(c, `${a.key} ${target} ${field}`).toMatch(/^[a-z0-9 ]+$/);
        }
      }
      for (const target of Object.keys(a.targetSteps ?? {})) expect(a.presets[target as keyof typeof a.presets], `${a.key} ${target}`).toBeTruthy();
    }
  });

  it("set nothing aside for a history target", async () => {
    const { plan: p } = await plan(PAST_APPLICATIONS_TARGET, "submittable.csv", "submittable");
    expect(p.rows.every((r) => r.outcome === "create")).toBe(true);
  });
});
