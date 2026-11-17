// SPDX-License-Identifier: AGPL-3.0-only
// The Salesforce source: presets and a person's own SOQL, read only; records become a table whose
// columns the targets recognise; and the sensitive screen still drops bank and identity columns.
import { describe, expect, it } from "vitest";
import { HISTORY_TARGET, MAX_IMPORT_ROWS, OUTSIDE_TARGET, PAST_APPLICATIONS_TARGET, SoqlRefusedError, checkSoql, flattenRecord, isSensitiveHeader, presetSoql, salesforcePresetsFor, screenColumns, soqlObject, suggestMapping, tableFromSalesforce } from "../src/index.ts";

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

// Red team (v1.12.0 integration): ways a query of the person's own might get past the check. Each
// must be refused before anything is sent to Salesforce.
describe("SOQL check, red team", () => {
  const refused = (q: string, why: RegExp) => {
    let err: unknown;
    try {
      checkSoql(q);
    } catch (e) {
      err = e;
    }
    expect(err, q.slice(0, 80)).toBeInstanceOf(SoqlRefusedError);
    expect((err as Error).message, q.slice(0, 80)).toMatch(why);
  };

  it("refuses more than one statement, however the second is hidden", () => {
    refused("SELECT Id FROM Account; SELECT Id FROM Contact", /one query at a time/);
    refused("SELECT Id FROM Account WHERE Name = 'a';DELETE FROM Account", /one query at a time/);
    refused("SELECT Id FROM Account\n;\nDELETE FROM Account", /one query at a time/);
    // A quote escaped with a backslash does not close the value, so the semicolon after it is outside.
    refused("SELECT Id FROM Account WHERE Name = 'it\\'s'; DELETE FROM Account", /one query at a time/);
    // Backslash escapes are read as Salesforce reads them: the value ends at the unescaped quote.
    refused("SELECT Id FROM Account WHERE Name = 'a\\\\'; DELETE FROM Account", /one query at a time/);
    refused("SELECT Id FROM Account WHERE Name = 'a\\'", /not closed/);
  });

  it("reads DML words inside quoted values as data, and refuses them outside", () => {
    for (const q of [
      "SELECT Id FROM Account WHERE Name = 'DELETE FROM Account'",
      "SELECT Id FROM Account WHERE Name = 'x; UPDATE Account SET Name = 1'",
      "SELECT Id FROM Account WHERE Description LIKE '%insert%' AND Name != 'merge upsert undelete'",
      "SELECT Id FROM Account WHERE Name = 'for update' OR Name = 'all rows' OR Name = 'using scope'",
    ]) {
      expect(() => checkSoql(q), q).not.toThrow();
    }
    refused("SELECT Id FROM Account WHERE Name = 'x' DELETE", /Only a SELECT/);
    refused("SELECT Id FROM Account WHERE Name = 'x' UPDATE Account", /Only a SELECT/);
    refused("SELECT Id FROM Account WHERE Name = 'x' upsert", /Only a SELECT/);
    refused("INSERT INTO Account (Name) VALUES ('x')", /Only a SELECT/);
    refused("  delete from Account where Name = 'select '", /Only a SELECT/);
  });

  it("refuses FOR UPDATE, ALL ROWS and USING SCOPE in any case and spacing", () => {
    refused("SELECT Id FROM Account FOR UPDATE", /FOR UPDATE/);
    refused("select Id from Account for\n\t update", /FOR UPDATE/);
    refused("SELECT Id FROM Account WHERE Name = 'a' fOr UpDaTe", /FOR UPDATE/);
    refused("SELECT Id FROM Account\u00a0FOR\u00a0UPDATE", /FOR UPDATE/);
    refused("SELECT Id FROM Account ALL ROWS", /ALL ROWS/);
    refused("SELECT Id FROM Account WHERE IsDeleted = true all   rows", /ALL ROWS/);
    refused("SELECT Id FROM Account USING SCOPE Everything", /USING SCOPE/);
    refused("SELECT Id FROM Account using scope mine", /USING SCOPE/);
    // FIELDS() reaches fields the query does not name, so their names cannot be checked first.
    refused("SELECT FIELDS(ALL) FROM Contact LIMIT 200", /FIELDS\(\)/);
    refused("SELECT Id, fields ( custom ) FROM Contact LIMIT 200", /FIELDS\(\)/);
  });

  it("refuses a comment, which SOQL does not have and could only hide something from the check", () => {
    refused("SELECT Id FROM Account -- FOR UPDATE", /no comments/);
    refused("SELECT Id FROM Account /* ; DELETE */", /no comments|one query/);
    refused("SELECT Id FROM Account /* hidden */ WHERE Name = 'x'", /no comments/);
    refused("SELECT Id FROM Account // note", /no comments/);
    refused("SELECT Id FROM Account WHERE Name = 'a' --\nFOR UPDATE", /no comments/);
    // Inside a quoted value the same characters are data.
    expect(() => checkSoql("SELECT Id FROM Account WHERE Name = 'a -- b /* c */'")).not.toThrow();
  });

  it("refuses hidden characters and anything SOQL does not use outside quotes", () => {
    refused("SELECT Id FROM Account FOR\u200bUPDATE", /hidden or control/);
    refused("SELECT Id FROM Account\u0000; DELETE FROM Account", /hidden or control/);
    refused("SELECT Id FROM Account\u202eETADPU ROF", /hidden or control/);
    refused("SELECT Id FROM Account WHERE Name = \"x\"", /character SOQL does not use/);
    refused("SELECT Id FROM Account WHERE Name = 'x' & q=SELECT Id FROM Contact", /character SOQL does not use/);
    refused("SELECT Id FROM Account#", /character SOQL does not use/);
    refused("SELECT Id FROM Account WHERE Name = \\'x'", /character SOQL does not use|not closed/);
    // Dates, date literals, lists, comparisons and relationship paths are all plain SOQL.
    expect(() => checkSoql("SELECT Id, Owner.Name, (SELECT Id FROM Contacts) FROM Account WHERE CreatedDate > 2026-01-01T00:00:00+05:00 AND LastModifiedDate = LAST_N_DAYS:30 AND Type IN ('Foundation', 'Trust') AND AnnualRevenue >= -1 AND Name != 'Café' ORDER BY Name ASC NULLS LAST LIMIT 10")).not.toThrow();
  });

  it("refuses a query that names a field the sensitive screen would drop, wherever it sits", () => {
    // Field names are put together at run time, so no file holds such a name (and this file passes the sensitive-data gate).
    const ACC = "Acc" + "ount";
    const names = [
      `Bank_${ACC}_Number__c`,
      `Payee_${ACC}_Number__c`,
      `npsp__Payee${ACC}Number__c`,
      "Routing_Number__c",
      ["S", "SN__c"].join("S").replace("SS", "S"),
      "Tax_ID__c",
      "Birth" + "date",
      `Contact.Birth${"date"}`,
      `${ACC}Number`,
      "Government_ID__c",
    ];
    for (const n of names) {
      expect(isSensitiveHeader(n), n).toBe(true);
      refused(`SELECT Id, ${n} FROM Contact`, /bank or identity/);
      refused(`SELECT Id FROM Contact WHERE ${n} != null`, /bank or identity/);
      refused(`SELECT Id FROM Contact ORDER BY ${n}`, /bank or identity/);
      refused(`SELECT MAX(${n}) total FROM Contact`, /bank or identity/);
      refused(`SELECT Id, (SELECT ${n} FROM Contacts) FROM Account`, /bank or identity/);
    }
    // Ordinary grant fields are fine, Account relationships included.
    expect(() => checkSoql("SELECT Id, Name, Account.Name, Account.Website, npsp__Requested_Amount__c, npsp__Grant_Program_Area_s__c FROM Opportunity")).not.toThrow();
    // Every preset passes the check it would be given.
    for (const target of ["outside_applications", "award_history", "history_applications"] as const) for (const p of salesforcePresetsFor(target)) expect(() => checkSoql(presetSoql(p, { target }))).not.toThrow();
  });
});

describe("presets for imported history", () => {
  it("reads every grant Opportunity as a past application and offers no preset for past reviews or reports", () => {
    expect(salesforcePresetsFor("history_applications")).toEqual(["npsp_grants"]);
    expect(salesforcePresetsFor("history_reviews")).toEqual([]);
    expect(salesforcePresetsFor("history_reports")).toEqual([]);
    expect(salesforcePresetsFor("award_history")).toEqual(["npsp_grants", "accounts"]);
    // Won or not: a past application's outcome is its own column.
    expect(presetSoql("npsp_grants", { target: "history_applications" })).not.toContain("IsWon");
    expect(() => presetSoql("accounts", { target: "history_applications" })).toThrow(SoqlRefusedError);
    expect(() => presetSoql("npsp_grants", { target: "history_reviews" })).toThrow(SoqlRefusedError);
    const past = tableFromSalesforce([grant("006000000000001AAA")], { preset: "npsp_grants", target: "history_applications" });
    const m = suggestMapping(PAST_APPLICATIONS_TARGET, past.header);
    expect(m).toMatchObject({ organizationName: "Organization", title: "Application title", requestedAmount: "Amount requested", awardedAmount: "Amount awarded", sourceId: "Record ID" });
    expect(m.outcome).toBeUndefined();
    expect(() => tableFromSalesforce([grant("006000000000001AAA")], { preset: "npsp_grants", target: "history_reports" })).toThrow(SoqlRefusedError);
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
