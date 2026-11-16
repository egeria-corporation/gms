// SPDX-License-Identifier: AGPL-3.0-only
// The draft invitation email: transactional, two links only, nothing typed that reads as a link.
import { describe, expect, it } from "vitest";
import { draftInvitationEmail, type DraftInvitationFields } from "../src/index.ts";

const base: DraftInvitationFields = {
  organization: "Alder Creek Family Services",
  inviterName: "Rosa Diaz",
  draftTitle: "Rural clinics 2027",
  part: "Describe the need your project addresses.",
  invitedEmail: "lena@fischergrants.example",
  acceptUrl: "https://app.gms.test/invitations/draft?token=gms_inv_abc",
  homeUrl: "https://app.gms.test",
  expiresOn: "2027-04-30",
};

const links = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

describe("draft_invitation", () => {
  it("says who asked, for which application and question, and how to accept", () => {
    const m = draftInvitationEmail(base);
    expect(m.subject).toBe("Help write Rural clinics 2027");
    expect(m.text).toContain("Rosa Diaz of Alder Creek Family Services invited you to help write the application Rural clinics 2027 on OpenGrants GMS.");
    expect(m.text).toContain("They would like you to write: Describe the need your project addresses.");
    expect(m.text).toContain("this one application and write its answers, and nothing else");
    expect(m.text).toContain("sign in with lena@fischergrants.example");
    expect(m.text).toContain("expires on 2027-04-30");
    expect(m.text).toContain(base.acceptUrl);
  });

  it("is transactional: two links, no reminders promised, nothing to sell", () => {
    const m = draftInvitationEmail(base);
    expect(links(m.html)).toEqual([base.acceptUrl, base.homeUrl]);
    expect(m.text).toContain("sent once, with no reminders");
    expect(m.text.toLowerCase()).not.toMatch(/unsubscribe|newsletter|upgrade|offer|discount|pricing|sign up for/);
  });

  it("leaves out any name that would read as a link, and escapes the rest", () => {
    const m = draftInvitationEmail({ ...base, draftTitle: "Apply at evil.example now", part: "See https://evil.example", inviterName: "<b>Rosa</b>", organization: "Alder Creek" });
    expect(m.text).not.toContain("evil.example");
    expect(m.html).not.toContain("evil.example");
    expect(m.subject).toBe("You are invited to help write an application");
    expect(m.text).toContain("invited you to help write an application");
    expect(m.html).not.toContain("<b>Rosa</b>");
    expect(m.html).toContain("&lt;b&gt;Rosa&lt;/b&gt;");
    expect(links(m.html)).toEqual([base.acceptUrl, base.homeUrl]);
  });

  it("names the organization when the inviter's name is not known, and cuts a long question", () => {
    const m = draftInvitationEmail({ ...base, inviterName: null, part: "x".repeat(400) });
    expect(m.text).toContain("Someone at Alder Creek Family Services invited you");
    expect(m.text).toMatch(/write: x{159}…/);
  });

  it("refuses links that are not https", () => {
    expect(() => draftInvitationEmail({ ...base, acceptUrl: "http://app.gms.test/x" })).toThrow();
  });
});
