// SPDX-License-Identifier: AGPL-3.0-only
// The dry run: mapping suggestions, per-row checks, reconciliation totals by year, duplicate and
// already-imported rows, and stable row keys for an idempotent re-run.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HISTORY_TARGET, OUTSIDE_TARGET, columnsFingerprint, planImport, rowKey, suggestMapping, tableFromCsv, tableFromGrid, tableFromRecords, SourceTableError, MAX_IMPORT_ROWS, readDate, readAmount } from "../src/index.ts";
import { readXlsx } from "../src/xlsx.ts";

const HISTORY = [
  "Organization,EIN,Grant,Amount,Award date,Program,Paid,Paid on,Memo",
  "Alder Creek Family Services,12-3456789,Van route,\"$50,000\",2024-03-01,Youth,25000,2024-04-01,first",
  "Pine Valley Arts,,Murals,12500.50,3/15/2024,,,,",
  "River Clinic,,Dental van,80000,2025-01-10,Health,80000,2025-02-01,",
  "No Amount Org,,Bad row,,2025-02-01,,,,",
  "Alder Creek Family Services,12-3456789,Van route,\"$50,000\",2024-03-01,Youth,25000,2024-04-01,first",
].join("\n");
const MAPPING = { recipientName: "Organization", recipientEin: "EIN", title: "Grant", awardedAmount: "Amount", awardDate: "Award date", programName: "Program", paidAmount: "Paid", paidDate: "Paid on" };
const src = { kind: "csv" as const, ref: null };

describe("reading sources", () => {
  it("names blank and repeated headers and drops blank rows", () => {
    const t = tableFromGrid([["", "", ""], ["Name", "", "Name"], ["a", "b", "c"], ["", "", ""], ["d", "", ""]]);
    expect(t.header).toEqual(["Name", "Column B", "Name (2)"]);
    expect(t.rows).toEqual([
      { line: 3, cells: ["a", "b", "c"] },
      { line: 5, cells: ["d", "", ""] },
    ]);
  });
  it(`refuses more than ${MAX_IMPORT_ROWS} data rows`, () => {
    const big = ["t", ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `r${i}`)].join("\n");
    expect(() => tableFromCsv(big)).toThrow(SourceTableError);
    expect(tableFromCsv(["t", ...Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => `r${i}`)].join("\n")).rows).toHaveLength(MAX_IMPORT_ROWS);
  });
  it("keeps Airtable record ids and the schema's field order", () => {
    const t = tableFromRecords([{ id: "recA", fields: { Name: "Alder", Amount: 5, Tags: ["a", "b"] } }, { id: "recB", fields: { Extra: "x" } }], ["Amount", "Name"]);
    expect(t.header).toEqual(["Amount", "Name", "Tags", "Extra"]);
    expect(t.rows).toEqual([
      { line: 1, id: "recA", cells: ["5", "Alder", "a, b", ""] },
      { line: 2, id: "recB", cells: ["", "", "", "x"] },
    ]);
  });
  it("reads an XLSX workbook: the first sheet by default, dates as dates", async () => {
    const bytes = new Uint8Array(readFileSync(new URL("./fixtures/history.xlsx", import.meta.url)));
    const w = await readXlsx(bytes);
    expect(w.sheets).toEqual(["Grants 2024", "Notes"]);
    expect(w.sheet).toBe("Grants 2024");
    expect(w.table.header).toEqual(["Organization", "Grant", "Amount", "Award date", "Program", "Paid"]);
    expect(w.table.rows[0]!.cells).toEqual(["Alder Creek Family Services", "Van route", "50000", "2024-04-01", "Youth", "25000"]);
    expect(w.table.rows[1]!.cells).toEqual(["Pine Valley Arts", "Murals", "12500.5", "2025-04-01", "", ""]);
    expect((await readXlsx(bytes, "Notes")).table.rows[0]!.cells).toEqual(["Not this sheet"]);
    await expect(readXlsx(new TextEncoder().encode("Organization,Grant\n"))).rejects.toThrow(/not an .xlsx workbook/);
  });
  it("reads dates and amounts the way spreadsheets write them", () => {
    expect([readDate("2027-05-01"), readDate("5/1/2027"), readDate("May 1, 2027"), readDate("1 May 2027"), readDate("2027-05-01T10:00:00Z"), readDate("2/30/2027"), readDate(" ")]).toEqual(["2027-05-01", "2027-05-01", "2027-05-01", "2027-05-01", "2027-05-01", null, undefined]);
    expect([readAmount("$25,000", "USD"), readAmount("USD 1,200.5", "USD"), readAmount("300", "JPY"), readAmount("1.5", "JPY"), readAmount("-5", "USD"), readAmount("lots", "USD")]).toEqual([2_500_000, 120_050, 300, null, null, null]);
  });
});

describe("mapping suggestions", () => {
  it("takes exact names first, each column once, and prefers a saved mapping", () => {
    const header = ["Organization", "EIN", "Grant", "Amount", "Award date", "Program", "Paid", "Paid on", "Memo"];
    expect(suggestMapping(HISTORY_TARGET, header)).toMatchObject({ recipientName: "Organization", recipientEin: "EIN", title: "Grant", awardedAmount: "Amount", awardDate: "Award date", programName: "Program", paidAmount: "Paid", paidDate: "Paid on" });
    expect(suggestMapping(HISTORY_TARGET, header, { title: "Memo" }).title).toBe("Memo");
    // A saved column that is no longer in the file is not used.
    expect(suggestMapping(HISTORY_TARGET, header, { title: "Gone" }).title).toBe("Grant");
    const outside = suggestMapping(OUTSIDE_TARGET, ["Grant", "Funder", "Internal deadline", "Deadline", "LOI due", "Ask"]);
    expect(outside).toMatchObject({ title: "Grant", funderName: "Funder", internalDue: "Internal deadline", fullDue: "Deadline", loiDue: "LOI due", askAmount: "Ask" });
  });
  it("gives files with the same columns the same fingerprint", async () => {
    expect(await columnsFingerprint(["Grant", "Funder"])).toBe(await columnsFingerprint(["funder ", "GRANT"]));
    expect(await columnsFingerprint(["Grant", "Funder"])).not.toBe(await columnsFingerprint(["Grant", "Funder", "Ask"]));
  });
});

describe("planImport", () => {
  it("checks every row and reconciles counts and money by year", async () => {
    const plan = await planImport({ target: HISTORY_TARGET, table: tableFromCsv(HISTORY), mapping: MAPPING, source: src });
    expect(plan.missingRequired).toEqual([]);
    expect(plan.rows.map((r) => [r.line, r.outcome, r.reason])).toEqual([
      [2, "create", null],
      [3, "create", null],
      [4, "create", null],
      [5, "error", null],
      [6, "skip", "The same as row 2"],
    ]);
    expect(plan.rows[3]!.problems).toEqual([{ field: "awardedAmount", message: "No amount awarded" }]);
    expect(plan.rows[0]!.record).toMatchObject({ recipientName: "Alder Creek Family Services", recipientEin: "123456789", awardedAmountMinor: 5_000_000, year: 2024, payment: { amountMinor: 2_500_000, paidOn: "2024-04-01", reference: "Imported grant history" } });
    expect(plan.reconciliation).toMatchObject({ rows: 5, create: 3, skip: 1, error: 0 + 1 });
    expect(plan.reconciliation.totals).toEqual([
      { outcome: "create", kind: "awarded", currency: "USD", year: 2024, amountMinor: 6_250_050, rows: 2 },
      { outcome: "create", kind: "awarded", currency: "USD", year: 2025, amountMinor: 8_000_000, rows: 1 },
      { outcome: "create", kind: "paid", currency: "USD", year: 2024, amountMinor: 2_500_000, rows: 1 },
      { outcome: "create", kind: "paid", currency: "USD", year: 2025, amountMinor: 8_000_000, rows: 1 },
      { outcome: "skip", kind: "awarded", currency: "USD", year: 2024, amountMinor: 5_000_000, rows: 1 },
      { outcome: "skip", kind: "paid", currency: "USD", year: 2024, amountMinor: 2_500_000, rows: 1 },
    ]);
  });

  it("is idempotent: the same rows again are all skipped as imported already", async () => {
    const first = await planImport({ target: HISTORY_TARGET, table: tableFromCsv(HISTORY), mapping: MAPPING, source: src });
    const already = new Map(first.rows.filter((r) => r.outcome === "create").map((r) => [r.key, "2026-11-15T10:00:00.000Z"]));
    // Saved again with the columns in another order: the same records, the same keys.
    const reordered = HISTORY.split("\n").map((l) => l).join("\n");
    const again = await planImport({ target: HISTORY_TARGET, table: tableFromCsv(reordered), mapping: MAPPING, source: { kind: "xlsx", ref: null }, already });
    expect(again.reconciliation).toMatchObject({ create: 0, skip: 4, error: 1 });
    expect(again.rows[0]!.reason).toBe("Imported already on 2026-11-15");
  });

  it("keys rows by a mapped row ID, so a changed row is still recognised", async () => {
    const v1 = "ID,Organization,Grant,Amount\nG-1,Alder,Van,100\nG-2,Pine,Murals,200";
    const v2 = "ID,Organization,Grant,Amount\nG-1,Alder,Van route (renamed),100\nG-3,River,Clinic,300";
    const mapping = { sourceId: "ID", recipientName: "Organization", title: "Grant", awardedAmount: "Amount" };
    const first = await planImport({ target: HISTORY_TARGET, table: tableFromCsv(v1), mapping, source: src });
    const already = new Map(first.rows.map((r) => [r.key, null]));
    const second = await planImport({ target: HISTORY_TARGET, table: tableFromCsv(v2), mapping, source: src, already });
    expect(second.rows.map((r) => r.outcome)).toEqual(["skip", "create"]);
    expect(second.rows[0]!.key).toBe(await rowKey("award_history", { id: "G-1", scope: "csv:ID" }));
  });

  it("drops sensitive columns before mapping: a mapped one is unknown and its values never appear", async () => {
    const secret = ["900", "00", "0001"].join("-");
    const csv = `Grant,Funder,Contact ref\nCapacity,Cascade,${secret}\n`;
    const plan = await planImport({ target: OUTSIDE_TARGET, table: tableFromCsv(csv), mapping: { title: "Grant", funderName: "Funder", notes: "Contact ref" }, source: src });
    expect(plan.columns).toEqual(["Grant", "Funder"]);
    expect(plan.dropped).toEqual([{ column: "Contact ref", reason: "identity_number" }]);
    expect(plan.unknownColumns).toEqual(["notes"]);
    expect(plan.rows[0]!.outcome).toBe("create");
    expect(JSON.stringify(plan)).not.toContain(secret);
  });

  it("reports required fields the mapping leaves out, and every row is then an error", async () => {
    const plan = await planImport({ target: OUTSIDE_TARGET, table: tableFromCsv("Grant\nA\n"), mapping: { title: "Grant" }, source: src });
    expect(plan.missingRequired).toEqual(["funderName"]);
    expect(plan.reconciliation).toMatchObject({ create: 0, error: 1 });
  });
});

describe("targets", () => {
  it("outside applications: the v1.5.0 rules, with field names in the messages", () => {
    const ok = OUTSIDE_TARGET.check({ title: "Capacity 2026", funderName: "Cascade Trust", stage: "Awarded", fullDue: "2026-03-01", askAmount: "$20,000", submittedAt: "2026-02-20", submissionMethod: "portal", awardedAmount: "$15,000", grantStart: "2026-07-01" });
    expect(ok.problems).toEqual([]);
    expect(ok.record).toMatchObject({ stage: "awarded", askAmountMinor: 2_000_000, awardedAmountMinor: 1_500_000, submittedOn: "2026-02-20", submissionMethod: "portal", decided: true });
    expect(ok.money).toEqual([
      { kind: "ask", amountMinor: 2_000_000, currency: "USD", year: 2026 },
      { kind: "awarded", amountMinor: 1_500_000, currency: "USD", year: 2026 },
    ]);
    const bad = OUTSIDE_TARGET.check({ title: "Bad row", stage: "Paid", fullDue: "03/32/2026", askAmount: "lots", listingUrl: "not a link" });
    expect(bad.record).toBeNull();
    expect(bad.problems).toEqual(expect.arrayContaining([{ field: "funderName", message: "No funder" }, { field: "stage", message: '"Paid" is not a stage' }, { field: "fullDue", message: "Full application due is not a date (use YYYY-MM-DD)" }, { field: "askAmount", message: "The ask is not an amount" }, { field: "listingUrl", message: "Listing link is not a web address" }]));
    // A prospect keeps no submission and no award, whatever the row says.
    expect(OUTSIDE_TARGET.check({ title: "Later", funderName: "Pine", stage: "prospect", submittedAt: "2026-01-01", submissionMethod: "email", awardedAmount: "100" }).record).toMatchObject({ submittedOn: null, submissionMethod: null, awardedAmountMinor: null, decided: false });
  });
  it("grant history: a payment needs a date and cannot exceed the award", () => {
    expect(HISTORY_TARGET.check({ recipientName: "A", title: "T", awardedAmount: "100", paidAmount: "50" }).problems).toEqual([{ field: "paidDate", message: "A payment needs the date it was paid (or an award date)" }]);
    expect(HISTORY_TARGET.check({ recipientName: "A", title: "T", awardedAmount: "100", paidAmount: "150", paidDate: "2024-01-01" }).problems).toEqual([{ field: "paidAmount", message: "The amount paid is more than the amount awarded" }]);
    expect(HISTORY_TARGET.check({ recipientName: "A", title: "T", awardedAmount: "100", recipientEin: "12345" }).problems).toEqual([{ field: "recipientEin", message: "The EIN is not nine digits" }]);
    expect(HISTORY_TARGET.check({ recipientName: "A", title: "T", awardedAmount: "100", year: "FY2019", status: "Closed" }).record).toMatchObject({ year: 2019, status: "completed", payment: null });
  });
});
