// SPDX-License-Identifier: AGPL-3.0-only
// The free migration request (switch pages): the request to OpenGrants and the confirmation to the
// person. Removing numbers from the note is packages/importers' (test/strip-text.test.ts).
// Every sample number here is invalid by construction (area 999 or 000, all ones, all zeros).
import { describe, expect, it } from "vitest";
import { migrationConfirmationEmail, migrationRequestEmail, type MigrationRequestContent } from "../src/index.ts";

/** What a removed number reads as (stripSensitiveNumbers in @gms/importers). */
const M = "[number removed]";

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
