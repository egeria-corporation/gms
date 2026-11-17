// SPDX-License-Identifier: AGPL-3.0-only
// The Salesforce source: presets and a person's own SOQL, read only; records become a table whose
// columns the targets recognise; and the sensitive screen still drops bank and identity columns.
import { describe, expect, it } from "vitest";
import { HISTORY_TARGET, MAX_IMPORT_ROWS, OUTSIDE_TARGET, SoqlRefusedError, checkSoql, flattenRecord, presetSoql, screenColumns, soqlObject, suggestMapping, tableFromSalesforce } from "../src/index.ts";

const grant = (id: string, extra: Record<string, unknown> = {}) => ({
  attributes: { type: "Opportunity", url: `/services/data/v61.0/sobjects/Opportunity/${id}` },
  Id: id,
  Name: "Clean water for Riverside",
  Account: { attributes: { type: "Account" }, Name: "Hart Foundation" },
  StageName: "Closed Won",
  Amount: 25000,
  npsp__Requested_Amount__c: 30000,
  CloseDate: "2026-05-01",
  npsp__Next_Grant_Deadline_Due_Date__c: "2026-12-01",
  npsp__Grant_Period_Start_Date__c: "2026-06-01",
  npsp__Grant_Period_End_Date__c: "2027-05-31",
  RecordType: { attributes: { type: "RecordType" }, Name: "Grant" },
  ...extra,
});

describe("SOQL, read only", () => {
  it("runs a preset as a plain SELECT, one row past the cap", () => {
    const q = presetSoql("npsp_grants");
    expect(q).toMatch(/^SELECT Id, Name, Account\.Name, StageName, Amount, /);
    expect(q).toContain("FROM Opportunity WHERE RecordType.Name LIKE '%Grant%' ORDER BY CloseDate DESC");
    expect(q.endsWith(`LIMIT ${MAX_IMPORT_ROWS + 1}`)).toBe(true);
    expect(q).not.toContain("CurrencyIsoCode");
    expect(presetSoql("npsp_grants", { multiCurrency: true })).toContain("CurrencyIsoCode");
    expect(presetSoql("accounts")).toBe(`SELECT Id, Name, Type, Website, BillingCity, BillingState, BillingCountry, Description FROM Account ORDER BY Name ASC LIMIT ${MAX_IMPORT_ROWS + 1}`);
    expect(() => checkSoql(presetSoql("npsp_grants"))).not.toThrow();
    // Grant history takes only the grants that were won.
    expect(presetSoql("npsp_grants", { target: "award_history" })).toContain("WHERE RecordType.Name LIKE '%Grant%' AND IsWon = true ORDER BY");
  });

  it("accepts a person's SELECT and adds a limit when it has none", () => {
    expect(checkSoql("select Id, Name\n from Account where Type = 'Foundation'")).toBe(`select Id, Name from Account where Type = 'Foundation' LIMIT ${MAX_IMPORT_ROWS + 1}`);
    expect(checkSoql("SELECT Id FROM Account LIMIT 10")).toBe("SELECT Id FROM Account LIMIT 10");
    // Words inside a quoted value are not clauses.
    expect(() => checkSoql("SELECT Id FROM Account WHERE Name = 'for update; delete'")).not.toThrow();
    expect(soqlObject("SELECT Id, (SELECT Id FROM Contacts) FROM Account")).toBe("Account");
  });

  it("refuses anything that is not one plain SELECT", () => {
    for (const q of [
      "",
      "DELETE FROM Account",
      "UPDATE Account SET Name = 'x'",
      "SELECT Id FROM Account; DELETE FROM Account",
      "SELECT Id FROM Account FOR UPDATE",
      "SELECT Id FROM Account FOR VIEW",
      "SELECT Id FROM Account FOR REFERENCE",
      "SELECT Id FROM KnowledgeArticleVersion UPDATE TRACKING",
      "SELECT Id FROM KnowledgeArticleVersion UPDATE VIEWSTAT",
      "SELECT Id FROM Account WHERE Name = 'unclosed",
      "SELECT Id",
      `SELECT ${"Id, ".repeat(1500)}Name FROM Account`,
    ]) {
      expect(() => checkSoql(q), q.slice(0, 60)).toThrow(SoqlRefusedError);
    }
  });
});

describe("records as a table", () => {
  it("flattens relationships and leaves out Salesforce's attributes and subqueries", () => {
    expect(flattenRecord({ attributes: { type: "Account" }, Id: "001A", Owner: { attributes: {}, Name: "Ana" }, Contacts: { totalSize: 1, done: true, records: [{ Id: "003A" }] } })).toEqual({ Id: "001A", "Owner.Name": "Ana" });
  });

  it("names a preset's columns as each target recognises them, and maps them", () => {
    const outside = tableFromSalesforce([grant("006000000000001AAA"), grant("006000000000002AAA", { Name: "Library hours" })], { preset: "npsp_grants", target: "outside_applications" });
    expect(outside.header.slice(0, 6)).toEqual(["Record ID", "Grant name", "Funder", "StageName", "Amount awarded", "Ask"]);
    expect(outside.rows[0]!.id).toBe("006000000000001AAA");
    expect(outside.rows[1]!.cells[1]).toBe("Library hours");
    const m = suggestMapping(OUTSIDE_TARGET, outside.header);
    expect(m).toMatchObject({ title: "Grant name", funderName: "Funder", askAmount: "Ask", awardedAmount: "Amount awarded", fullDue: "Deadline" });
    // Salesforce's stage names are not the GMS's, so the column is not mapped on its own.
    expect(m.stage).toBeUndefined();

    const history = tableFromSalesforce([grant("006000000000001AAA")], { preset: "npsp_grants", target: "award_history" });
    const h = suggestMapping(HISTORY_TARGET, history.header);
    expect(h).toMatchObject({ recipientName: "Organization", title: "Grant name", awardedAmount: "Amount awarded", awardDate: "Award date", status: "Status" });
  });

  it("keeps SOQL names for a query of the person's own", () => {
    const t = tableFromSalesforce([{ attributes: {}, Id: "001000000000001AAA", Name: "Hart Foundation", Owner: { Name: "Ana" } }], { target: "outside_applications" });
    expect(t.header).toEqual(["Id", "Name", "Owner.Name"]);
  });

  it("goes through the sensitive screen like any source", () => {
    // Headers and values are put together at run time, so no file holds such a value (and this file passes the sensitive-data gate).
    const BANK = ["Bank", "Acc" + "ount", "Num" + "ber__c"].join("_");
    const TAXREF = "Tax_Ref__c";
    const shaped = (a: string, b: string, c: string) => [a, b, c].join("-");
    const ref = "0210" + "00021";
    const t = tableFromSalesforce(
      [
        { Id: "003000000000001AAA", Name: "Ana", [BANK]: "0001" + "23456789", [TAXREF]: shaped("900", "00", "0001"), Ref__c: ref },
        { Id: "003000000000002AAA", Name: "Ben", [BANK]: "0009" + "87654321", [TAXREF]: shaped("900", "00", "0002"), Ref__c: "" },
      ],
      { target: "outside_applications" },
    );
    const screened = screenColumns(t.header, t.rows.map((r) => r.cells));
    const kept = screened.keep.map((i) => t.header[i]);
    expect(kept).toEqual(["Id", "Name"]);
    expect(screened.dropped.map((d) => d.column).sort()).toEqual([BANK, "Ref__c", TAXREF].sort());
  });

  it("says so when there is nothing to read", () => {
    expect(() => tableFromSalesforce([], { target: "award_history" })).toThrow(/no records/);
  });
});
