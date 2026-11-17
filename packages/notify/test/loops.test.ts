// SPDX-License-Identifier: AGPL-3.0-only
// The peer invitation email (E4): the admin's note as written, one link, no reminder promised, in
// the sender's language; and the package footer lines with the "for funders" link.
import { describe, expect, it } from "vitest";
import { packageFooterWithLink, packagePdfFooterWithLink, peerInviteEmail } from "../src/index.ts";

const fields = { inviterName: "Helen Ortiz", funderName: "Riverbend Community Foundation", note: "We switched last spring.\n\nIt saved our team a week per cycle.", joinUrl: "https://gms.test/for-funders?invite=gms_pi_abc" };

describe("peer invitation email", () => {
  it("says who invites, carries the note and one link, and promises no reminders", () => {
    const m = peerInviteEmail(fields);
    expect(m.subject).toBe("Helen Ortiz invited you to the OpenGrants Grant Management System");
    expect(m.text).toContain("A note from Helen Ortiz:\n\nWe switched last spring.\n\nIt saved our team a week per cycle.");
    expect(m.text).toContain("Helen Ortiz at Riverbend Community Foundation uses the OpenGrants Grant Management System");
    expect(m.text).toContain("https://gms.test/for-funders?invite=gms_pi_abc");
    expect(m.text).toContain("no reminders follow");
    expect([...m.html.matchAll(/<a /g)]).toHaveLength(1);
    expect(m.html).not.toMatch(/<img/i);
  });

  it("escapes what the admin typed and leaves an empty note out", () => {
    const m = peerInviteEmail({ ...fields, note: "<b>Hi</b> & welcome" });
    expect(m.html).toContain("&lt;b&gt;Hi&lt;/b&gt; &amp; welcome");
    expect(peerInviteEmail({ ...fields, note: null }).text).not.toContain("A note from");
  });

  it("writes the fixed words in Spanish for a Spanish-speaking sender", () => {
    const m = peerInviteEmail({ ...fields, locale: "es" });
    expect(m.subject).toBe("Helen Ortiz le invitó al OpenGrants Grant Management System");
    expect(m.text).toContain("no habrá recordatorios");
    expect(m.text).toContain("We switched last spring.");
  });

  it("refuses a link that is not https", () => {
    expect(() => peerInviteEmail({ ...fields, joinUrl: "javascript:alert(1)" })).toThrow();
  });
});

describe("package footer link", () => {
  it("ends the full line with the link and gives the PDF a short one", () => {
    expect(packageFooterWithLink("https://gms.test/for-funders?ref=abc")).toBe("Prepared with the OpenGrants Grant Management System, free for funders and applicants · https://gms.test/for-funders?ref=abc");
    expect(packagePdfFooterWithLink("https://gms.test/for-funders?ref=abc", "es")).toBe("OpenGrants GMS, gratis para financiadores · gms.test/for-funders?ref=abc");
  });
});
