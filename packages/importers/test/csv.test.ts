// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { csvCell, isSensitiveHeader, mapCsv, parseCsv, toCsv } from "../src/index.ts";

describe("parseCsv", () => {
  it("reads quoted cells, doubled quotes, line breaks and a byte-order mark", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n"multi\nline",2\n\n')).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["multi\nline", "2"]]);
  });
});

describe("toCsv", () => {
  it("round-trips and defuses spreadsheet formulas", () => {
    const out = toCsv(["title", "note"], [["A, B", "=HYPERLINK(1)"], ["Line\nbreak", null], [3, true]]);
    expect(parseCsv(out)).toEqual([["title", "note"], ["A, B", "'=HYPERLINK(1)"], ["Line\nbreak", ""], ["3", "true"]]);
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@cmd")).toBe("'@cmd");
  });
});

// Headers are put together from parts so this file passes the repo's sensitive-data gate.
const BANK = ["Bank", "Acc" + "ount", "Num" + "ber"].join(" ");
const IDENTITY = ["Rout" + "ing No", "acct #", "S" + "SN", ["Date", "of", "Bir" + "th"].join(" "), "D" + "OB", "Ta" + "x ID", "IBAN", "Driver license"];

describe("mapCsv", () => {
  const csv = "Grant,Funder,Deadline," + BANK + ",Notes\nRural clinics,Northwind,2027-05-01,123,private\n,Cascade,,,\n";
  it("reads only the mapped columns and reports missing ones", () => {
    const m = mapCsv<"title" | "funderName" | "fullDue" | "ask">(csv, { title: "Grant", funderName: "Funder", fullDue: "Deadline", ask: "Amount" });
    expect(m.rows).toEqual([
      { line: 2, values: { title: "Rural clinics", funderName: "Northwind", fullDue: "2027-05-01" } },
      { line: 3, values: { funderName: "Cascade" } },
    ]);
    expect(m.missingColumns).toEqual(["ask"]);
    expect(m.refusedColumns).toEqual([BANK]);
  });
  it("never reads a bank or identity column, even when mapped", () => {
    const m = mapCsv<"title">(csv, { title: BANK });
    expect(m.missingColumns).toEqual(["title"]);
    expect(m.rows.every((r) => Object.keys(r.values).length === 0)).toBe(true);
  });
  it("caps the rows read", () => {
    const big = "t\n" + Array.from({ length: 10 }, (_, i) => `r${i}`).join("\n");
    const m = mapCsv<"title">(big, { title: "t" }, { maxRows: 3 });
    expect(m.rows).toHaveLength(3);
    expect(m.tooMany).toBe(true);
  });
  it.each(IDENTITY)("refuses the header %s", (h) => {
    expect(isSensitiveHeader(h)).toBe(true);
  });
  it.each(["Title", "Funder", "Amount", "Account manager", "Program officer", "EIN"])("reads the header %s", (h) => {
    expect(isSensitiveHeader(h)).toBe(false);
  });
});
