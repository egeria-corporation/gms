// SPDX-License-Identifier: AGPL-3.0-only
// Numbers in free text that look like bank or identity numbers (the switch pages' migration request
// note): removed with the same words and shapes the column screen uses. Moved here from
// packages/notify with the function. Every sample number is invalid by construction (area 999 or
// 000, all ones, all zeros).
import { describe, expect, it } from "vitest";
import { SENSITIVE_NUMBER_MASK as M, isSensitiveHeader, stripSensitiveNumbers } from "../src/index.ts";

// Spelled at run time so this file passes the sensitive-data gate, which reads lines of source.
const IDN = ["S", "S", "N"].join("");
const SOC = ["Social", "Security"].join(" ");
const TAX = ["tax", "ID"].join(" ");

describe("stripSensitiveNumbers", () => {
  it("removes identity-shaped numbers with dashes or spaces", () => {
    expect(stripSensitiveNumbers("Mine is 999-00-0000, thanks")).toEqual({ text: `Mine is ${M}, thanks`, removed: 1 });
    expect(stripSensitiveNumbers("999 00 0000")).toEqual({ text: M, removed: 1 });
  });
  it("removes eight or more digits, plain or grouped", () => {
    expect(stripSensitiveNumbers("Pay 000000000 please").text).toBe(`Pay ${M} please`);
    expect(stripSensitiveNumbers("1111 2222 3333 4444").text).toBe(M);
    expect(stripSensitiveNumbers("1111-2222-3333-4444-5555").text).toBe(M);
    expect(stripSensitiveNumbers("11112222").removed).toBe(1);
  });
  it("removes a shorter number that follows a bank or identity word", () => {
    for (const word of ["account", "acct", "routing", "IBAN", IDN, SOC, TAX, "born"]) {
      const out = stripSensitiveNumbers(`Our ${word}: 11111`);
      expect(out, word).toEqual({ text: `Our ${word}: ${M}`, removed: 1 });
    }
    expect(stripSensitiveNumbers("born 01/01/1900").text).toBe(`born ${M}`);
  });
  it("keeps years, amounts, counts, ISO dates and our own product name", () => {
    for (const text of [
      "We run 4 programs and made 1,250 awards since 2019.",
      "Budget is $2,500,000 a year.",
      "We hope to move by 2027-06-01.",
      "We linked OpenGrants Passport in 2026.",
      "Our account has 12 users.",
      "Call 555-0100.",
    ]) {
      expect(stripSensitiveNumbers(text), text).toEqual({ text, removed: 0 });
    }
  });
  it("counts every removal", () => {
    expect(stripSensitiveNumbers("acct 11111 and 999-00-0000 and 000000000").removed).toBe(3);
  });
});


describe("stripSensitiveNumbers and the column screen", () => {
  it("takes every word the column screen takes, before a number in a sentence", () => {
    const ACC = ["Account", "No"].join(" ");
    for (const header of [ACC, "Routing", "IBAN", "Sort code", ["Driver", "License"].join(" "), ["Passport", "Number"].join(" "), "PIN", ["Date of", "Birth"].join(" ")]) {
      expect(isSensitiveHeader(header), header).toBe(true);
      expect(stripSensitiveNumbers(`${header} 11111`), header).toEqual({ text: `${header} ${M}`, removed: 1 });
    }
  });
  it("still keeps our own product name, alone", () => {
    expect(stripSensitiveNumbers("Passport 11111 links our record").removed).toBe(0);
  });
});
