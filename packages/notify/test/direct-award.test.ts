// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { directAwardInvitationEmail, FUNDER_NOT_VERIFIED_LINE, type DirectAwardInvitationFields } from "../src/index.ts";

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
    const message = 'Congratulations!\n\n<a href="https://evil.example">Click</a> [here](https://evil.example) **bold** <script>alert(1)</script>';
    const e = directAwardInvitationEmail({ ...base, message, funderName: 'Fund <b>"X"</b>', awardTitle: "[Title](https://evil.example)" });
    expect(links(e.html)).toEqual([base.claimUrl, base.homeUrl]);
    expect(e.html).not.toContain("<script>");
    expect(e.html).not.toContain("<b>");
    expect(e.html).toContain("&lt;script&gt;");
    expect(e.html).toContain("<p>Congratulations!</p>");
    expect(e.text).toContain("Message from Fund <b>\"X\"</b>:\nCongratulations!");
  });

  it("puts no line break in the subject and refuses links that are not https", () => {
    expect(directAwardInvitationEmail({ ...base, funderName: "A\r\nBcc: x@y.example" }).subject).toBe("A Bcc: x@y.example has offered Alder Creek Family Services a grant");
    expect(() => directAwardInvitationEmail({ ...base, claimUrl: "javascript:alert(1)" })).toThrow();
    expect(() => directAwardInvitationEmail({ ...base, homeUrl: 'https://x.example/"onmouseover=1' })).toThrow();
  });

  it("caps the message at 2000 characters", () => {
    const e = directAwardInvitationEmail({ ...base, message: "x".repeat(2500) });
    expect(e.text).toContain(`${"x".repeat(2000)}\n\n`);
    expect(e.text).not.toContain("x".repeat(2001));
  });
});
