// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { cleanLine, cleanText, containsLink, directAwardInvitationEmail, FUNDER_NOT_VERIFIED_LINE, LinkInTextError, type DirectAwardInvitationFields } from "../src/index.ts";

const base: DirectAwardInvitationFields = {
  funderName: "Riverbend Community Foundation",
  funderVerified: true,
  organizationName: "Alder Creek Family Services",
  awardTitle: "Emergency operating support",
  amount: "USD 25,000.00",
  period: { startDate: "2027-05-01", endDate: "2028-04-30" },
  message: null,
  invitedEmail: "jo@aldercreek.example",
  claimUrl: "https://app.gms.test/awards/claim?token=gms_awi_abcdefghijklmnop",
  homeUrl: "https://app.gms.test/",
  expiresOn: "2027-04-30",
};

const links = (html: string) => [...html.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((m) => m[1]);

describe("direct award invitation email", () => {
  it("names the funder exactly, the award and how to accept, with the claim link and the GMS home only", () => {
    const e = directAwardInvitationEmail(base);
    expect(e.subject).toBe("Riverbend Community Foundation has offered Alder Creek Family Services a grant");
    expect(e.text).toContain("Award: Emergency operating support\nAmount: USD 25,000.00\nGrant period: 2027-05-01 to 2028-04-30");
    expect(e.text).toContain("sign in with jo@aldercreek.example");
    expect(e.text).toContain("OpenGrants Passport is not needed");
    expect(e.text).toContain("Accepting shares your organization's record with Riverbend Community Foundation.");
    expect(e.text).toContain(base.claimUrl);
    expect(e.text).toContain("expires on 2027-04-30");
    expect(e.text).not.toContain(FUNDER_NOT_VERIFIED_LINE);
    expect(links(e.html)).toEqual([base.claimUrl, base.homeUrl]);
  });

  it("says when the funder is not verified with Passport", () => {
    const e = directAwardInvitationEmail({ ...base, funderVerified: false });
    expect(e.text).toContain("This funder's organization is not verified with OpenGrants Passport.");
    expect(e.html).toContain("This funder&#39;s organization is not verified with OpenGrants Passport.");
  });

  it("keeps the funder's message plain text: escaped, never markup or a link", () => {
    const message = 'Congratulations!\n\n<a href="#x">Click</a> [here](#x) **bold** <script>alert(1)</script>';
    const e = directAwardInvitationEmail({ ...base, message, funderName: 'Fund <b>"X"</b>', awardTitle: "[Title](#x)" });
    expect(links(e.html)).toEqual([base.claimUrl, base.homeUrl]);
    expect(e.html).not.toContain("<script>");
    expect(e.html).not.toContain("<b>");
    expect(e.html).toContain("&lt;script&gt;");
    expect(e.html).toContain("<p>Congratulations!</p>");
    expect(e.text).toContain("Message from Fund <b>\"X\"</b>:\nCongratulations!");
  });

  it("puts no line break in the subject and refuses links that are not https", () => {
    expect(directAwardInvitationEmail({ ...base, funderName: "A\r\nBcc: someone" }).subject).toBe("A Bcc: someone has offered Alder Creek Family Services a grant");
    expect(() => directAwardInvitationEmail({ ...base, claimUrl: "javascript:alert(1)" })).toThrow();
    expect(() => directAwardInvitationEmail({ ...base, homeUrl: 'https://x.example/"onmouseover=1' })).toThrow();
  });

  it("caps the message at 2000 characters", () => {
    const e = directAwardInvitationEmail({ ...base, message: "x".repeat(2500) });
    expect(e.text).toContain(`${"x".repeat(2000)}\n\n`);
    expect(e.text).not.toContain("x".repeat(2001));
  });
});

describe("the one link detector", () => {
  it.each([
    "verify at fordgrants.foundation",
    "confirm your bank at grants-portal.ngo",
    "see riverbend.de",
    "ask agent.ai",
    "grants．ngo",
    "grants。org",
    "grants｡org",
    "ｅｘａｍｐｌｅ．ｃｏｍ",
    "exa​mple.org",
    "www.example.com",
    "https://x",
    "mailto:someone",
    "javascript:alert(1)",
    "write to grants@riverbend",
    "grants＠riverbend",
    "Riverbend.Foundation Inc",
    "例え.テスト",
  ])("finds a link in %j", (text) => {
    expect(containsLink(text)).toBe(true);
  });

  it.each([
    "Riverbend Community Foundation",
    "Dr. Smith and the U.S. Department of Health",
    "St. Mary's Clinic, Inc.",
    "e.g. clinics and 3.5 million meals",
    "Version 2.0 of the plan",
    "Thank you for your work this winter.\n\nWe look forward to it.",
    "",
  ])("finds none in %j", (text) => {
    expect(containsLink(text)).toBe(false);
  });

  it("refuses to build an email whose funder-supplied text reads as a link", () => {
    expect(() => directAwardInvitationEmail({ ...base, funderName: "Ford Foundation - verify at fordgrants.foundation" })).toThrow(LinkInTextError);
    expect(() => directAwardInvitationEmail({ ...base, message: "grants．ngo" })).toThrow(LinkInTextError);
  });
});

describe("free text cleaning", () => {
  it("removes bidirectional controls, zero-width characters and control characters", () => {
    const bidi = "‪‫‬‭‮⁦⁧⁨⁩​‌‍‎‏﻿­";
    expect(cleanLine(`Al${bidi}der\u0000 Creek\u0007\r\n Family\tServices\u0085 `)).toBe("Alder Creek Family Services");
    expect(cleanText(`Line one‮\r\nLine two\u0000\n\n\tNext${bidi}`)).toBe("Line one\nLine two\n\n Next");
  });

  it("cleans the email's fields too", () => {
    const e = directAwardInvitationEmail({ ...base, organizationName: "Alder‮ Creek", message: "Hi​ there" });
    expect(e.subject).toBe("Riverbend Community Foundation has offered Alder Creek a grant");
    expect(e.text).toContain("Hi there");
    expect(e.text).not.toMatch(/\p{Cf}/u);
  });
});
