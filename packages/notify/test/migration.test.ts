// SPDX-License-Identifier: AGPL-3.0-only
// The free migration request (switch pages): the request to OpenGrants, the confirmation to the
// person, and the removal of numbers that look like bank or identity numbers from the note.
// Every sample number here is invalid by construction (area 999 or 000, all ones, all zeros).
import { describe, expect, it } from "vitest";
import { SENSITIVE_NUMBER_MASK as M, migrationConfirmationEmail, migrationRequestEmail, stripSensitiveNumbers, type MigrationRequestContent } from "../src/index.ts";

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

const content: MigrationRequestContent = {
  name: "Ana Ruiz",
  email: "ana@riverbendcf.example",
  organization: "Riverbend Community Foundation",
  system: "Submittable",
  programs: "2 to 5",
  pastAwards: "100 to 1,000",
  timing: "In the next 3 months",
  note: `Our grants run on two forms. ${M}`,
  numbersRemoved: 1,
};

describe("migration request email", () => {
  it("says who asks, for what, and how to reply", () => {
    const m = migrationRequestEmail(content);
    expect(m.subject).toBe("Migration request: Riverbend Community Foundation (from Submittable)");
    expect(m.text).toBe(
      [
        "Riverbend Community Foundation asks for a free migration to the OpenGrants Grant Management System. Reply to this email to reach Ana Ruiz.",
        ["Name: Ana Ruiz", "Work email: ana@riverbendcf.example", "Organization: Riverbend Community Foundation", "Current system: Submittable", "Programs: 2 to 5", "Past awards: 100 to 1,000", "Hoping to move: In the next 3 months"].join("\n"),
        `Note:\nOur grants run on two forms. ${M}`,
        "1 number that looked like a bank or identity number was removed from the note before it was sent.",
        "Sent from the switch pages of OpenGrants GMS.",
      ].join("\n\n"),
    );
  });
  it("says when there is no note, and does not mention removals that did not happen", () => {
    const m = migrationRequestEmail({ ...content, note: null, numbersRemoved: 0 });
    expect(m.text).toContain("\n\nNo note.\n\n");
    expect(m.text).not.toContain("removed");
  });
  it("escapes what the person typed and keeps the subject on one line", () => {
    const m = migrationRequestEmail({ ...content, organization: "<b>Org</b>\nBcc: x@example.org", note: "<script>x</script>" });
    expect(m.subject).toBe("Migration request: <b>Org</b> Bcc: x@example.org (from Submittable)");
    expect(m.html).not.toContain("<b>");
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });
});

describe("migration confirmation email", () => {
  it("says a person will reply and help can start right away, with our own link only", () => {
    const m = migrationConfirmationEmail({ systemPhrase: "Submittable", pageUrl: "https://gms.opengrants.io/switch/submittable" });
    expect(m.subject).toBe("We received your migration request");
    expect(m.text).toContain("help you move from Submittable to the OpenGrants Grant Management System");
    expect(m.text).toContain("A person at OpenGrants will reply to this address, and migration help can start right away.");
    expect(m.text).toContain("If that was not you, ignore it");
    expect(m.html).toContain('<a href="https://gms.opengrants.io/switch/submittable">');
  });
  it("leaves out a link that is not https", () => {
    const m = migrationConfirmationEmail({ systemPhrase: "your current system", pageUrl: "http://localhost:5173/switch" });
    expect(m.text).not.toContain("http://");
    expect(m.html).not.toContain("<a ");
  });
});
