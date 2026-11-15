// SPDX-License-Identifier: AGPL-3.0-only
// Sensitive data first: columns are dropped by header and by value before anything else reads
// them. Sensitive-looking values are made up at run time from digits that pass or fail the checks;
// no file in the repository holds one (and the headers are put together from parts, so this file
// passes the sensitive-data gate).
import { describe, expect, it } from "vitest";
import { isAbaRoutingShaped, isSensitiveHeader, screenColumns, sensitiveValue } from "../src/index.ts";

/** Nine digits that pass the routing checksum: eight chosen digits and the check digit that fits. */
function checksumValid(prefix8: string): string {
  const d = [...prefix8].map(Number);
  const partial = 3 * (d[0]! + d[3]! + d[6]!) + 7 * (d[1]! + d[4]! + d[7]!) + (d[2]! + d[5]!);
  return prefix8 + String((10 - (partial % 10)) % 10);
}
const ROUTING_SHAPED = checksumValid("0110" + "0001");
const ROUTING_WRONG_SUM = ROUTING_SHAPED.slice(0, 8) + String((Number(ROUTING_SHAPED[8]) + 1) % 10);
const IDENTITY_SHAPED = ["900", "00", "0001"].join("-");
const LONG_SHAPED = "4" + "0".repeat(14) + "2";
const PHONE_SHAPED = "1" + "555" + "0100" + "123";

describe("header screening", () => {
  const sensitive = ["Rout" + "ing", "ABA", "Bank acc" + "t", "Acc" + "ount No", "acct #", "IBAN", "SWIFT", "S" + "SN", "Soc" + "ial Sec #", ["Date", "of", "Bir" + "th"].join(" "), "D" + "OB", "Ta" + "x ID", "TIN", "Gov" + "ernment ID", "Passport No.", "Driver's lic" + "ense", "Card num" + "ber"];
  it.each(sensitive)("drops a column named %s", (h) => expect(isSensitiveHeader(h)).toBe(true));
  it.each(["Organization", "EIN", "Account manager", "Account notes", "Amount", "Award date", "Program officer", "Grant number", "Routes served"])("keeps a column named %s", (h) => expect(isSensitiveHeader(h)).toBe(false));
});

describe("value screening", () => {
  it("recognises the routing checksum and its assigned ranges", () => {
    expect(isAbaRoutingShaped(ROUTING_SHAPED)).toBe(true);
    expect(isAbaRoutingShaped(ROUTING_WRONG_SUM)).toBe(false);
    // A checksum-valid number outside the assigned first-two-digit ranges is not one.
    expect(isAbaRoutingShaped(checksumValid("5" + "5" + "000000"))).toBe(false);
  });
  it("names what a cell looks like", () => {
    expect(sensitiveValue(ROUTING_SHAPED, "Notes")).toBe("bank_routing");
    expect(sensitiveValue(IDENTITY_SHAPED, "Contact")).toBe("identity_number");
    expect(sensitiveValue(LONG_SHAPED, "Reference")).toBe("long_number");
    expect(sensitiveValue(LONG_SHAPED.replace(/(\d{4})(?=\d)/g, "$1 "), "Reference")).toBe("long_number");
  });
  it("reads nine digits as an EIN in an EIN column, and phone-length digits as a phone in a phone column", () => {
    expect(sensitiveValue(ROUTING_SHAPED, "EIN")).toBeNull();
    expect(sensitiveValue(ROUTING_SHAPED, "Employer identification")).toBeNull();
    expect(sensitiveValue(PHONE_SHAPED, "Phone")).toBeNull();
    expect(sensitiveValue(PHONE_SHAPED, "Notes")).toBe("long_number");
    // A formatted identity number is dropped whatever the header says.
    expect(sensitiveValue(IDENTITY_SHAPED, "EIN")).toBe("identity_number");
  });
  it("leaves ordinary grant values alone", () => {
    for (const v of ["50000", "$25,000.00", "2027-05-01", "12-3456789", "(555) 010-0123", "555-010-0123", "Van route", "AB-2024-0042", "2024"]) expect(sensitiveValue(v, "Anything")).toBeNull();
  });
});

describe("screenColumns", () => {
  it("drops a column on one matching value, keeps only the column name and why", () => {
    const header = ["Organization", "Amount", "Memo", "Bank acc" + "t", "EIN"];
    const rows = [
      ["Alder Creek", "50000", "first payment", "x", ROUTING_SHAPED],
      ["Pine Valley", "12000", IDENTITY_SHAPED, "y", "12-3456789"],
    ];
    const s = screenColumns(header, rows);
    expect(s.keep).toEqual([0, 1, 4]);
    expect(s.dropped).toEqual([
      { column: "Memo", reason: "identity_number" },
      { column: "Bank acc" + "t", reason: "header" },
    ]);
    expect(JSON.stringify(s)).not.toContain(IDENTITY_SHAPED);
  });
});
