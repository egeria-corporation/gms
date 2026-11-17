// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { CONTENT_DIGESTS, MAX_DIGEST_MATCHES, deadlinesDigestEmail, funderActivityDigestEmail, newMatchesDigestEmail, unsubscribeHeaders } from "../src/index.ts";

const FRAME = {
  workspace: "Alder Creek Family Services",
  unsubscribeLink: "https://app.gms.test/digests/unsubscribe#token=v1.abc.new_matches.1.sig",
  oneClickUrl: "https://gms.test/gms/digests/unsubscribe?token=v1.abc.new_matches.1.sig",
  settingsLink: "https://app.gms.test/notifications",
};
const match = (n: number) => ({ title: `Fund ${n}`, funder: "Northwind", deadline: "2027-05-30", amount: "up to $50,000", source: n % 2 ? ("opengrants" as const) : ("gms" as const), link: `https://app.gms.test/w/alder-creek/find?n=${n}` });

describe("content digest emails", () => {
  it("names the three digests", () => {
    expect(CONTENT_DIGESTS).toEqual(["new_matches", "deadlines", "funder_activity"]);
  });

  it("lists new matches in text and HTML, with one-click unsubscribe headers and no images", () => {
    const m = newMatchesDigestEmail({ ...FRAME, items: [match(1), match(2)], note: "We couldn't reach OpenGrants this week." });
    expect(m.subject).toBe("2 new funding matches for Alder Creek Family Services");
    expect(m.text).toContain("1. Fund 1 (Northwind)\n   Deadline 2027-05-30 · up to $50,000 · From the OpenGrants index");
    expect(m.text).toContain("Open for applications here");
    expect(m.text).toContain(`Stop getting this email: ${FRAME.unsubscribeLink}`);
    expect(m.text).toContain("We couldn't reach OpenGrants this week.");
    expect(m.html).toContain(`<a href="${FRAME.unsubscribeLink}">Stop getting this email</a>`);
    expect(m.html).not.toMatch(/<img|pixel|track/i);
    expect(m.headers).toEqual({ "List-Unsubscribe": `<${FRAME.oneClickUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  });

  it("sends at most ten matches, and never an empty email", () => {
    const m = newMatchesDigestEmail({ ...FRAME, items: Array.from({ length: 14 }, (_, i) => match(i + 1)) });
    expect(m.subject.startsWith(`${MAX_DIGEST_MATCHES} new`)).toBe(true);
    expect(m.text).not.toContain("Fund 11");
    expect(() => newMatchesDigestEmail({ ...FRAME, items: [] })).toThrow(/nothing new/);
    expect(() => deadlinesDigestEmail({ ...FRAME, items: [], today: "2027-04-19" })).toThrow(/nothing new/);
    expect(() => funderActivityDigestEmail({ ...FRAME, counts: { newApplications: 0, reviewsDue: 0, paymentsDue: 0, reportsOverdue: 0 }, links: { newApplications: FRAME.settingsLink, reviewsDue: FRAME.settingsLink, paymentsDue: FRAME.settingsLink, reportsOverdue: FRAME.settingsLink } })).toThrow(/nothing new/);
  });

  it("escapes what OpenGrants or people wrote, and refuses links that are not https", () => {
    const m = newMatchesDigestEmail({ ...FRAME, items: [{ ...match(1), title: "Fund <script>alert(1)</script>", funder: "A & B‮" }] });
    expect(m.html).toContain("Fund &lt;script&gt;");
    expect(m.html).not.toContain("<script>");
    expect(m.text).not.toContain("‮");
    expect(() => newMatchesDigestEmail({ ...FRAME, items: [{ ...match(1), link: "javascript:alert(1)" }] })).toThrow(/https/);
    expect(() => unsubscribeHeaders("http://gms.test/x")).toThrow(/https/);
  });

  it("orders deadlines by date and says how far away each is", () => {
    const m = deadlinesDigestEmail({
      ...FRAME,
      today: "2027-04-19",
      items: [
        { date: "2027-05-03", label: "Application due", title: "Rural clinics", funder: "Northwind", link: "https://app.gms.test/w/alder-creek/outside/1" },
        { date: "2027-04-20", label: "Report due", title: "Interim report (Health navigation)", funder: null, link: "https://app.gms.test/w/alder-creek/reports" },
      ],
    });
    expect(m.subject).toBe("2 deadlines in the next 3 weeks: Alder Creek Family Services");
    const first = m.text.indexOf("2027-04-20 (tomorrow): Report due");
    const second = m.text.indexOf("2027-05-03 (in 14 days): Application due, Rural clinics (Northwind)");
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
  });

  it("gives funder staff counts and links only", () => {
    const links = { newApplications: "https://app.gms.test/w/riverbend/applications", reviewsDue: "https://app.gms.test/w/riverbend/reviews/assign", paymentsDue: "https://app.gms.test/w/riverbend/payments/due", reportsOverdue: "https://app.gms.test/w/riverbend/reporting" };
    const m = funderActivityDigestEmail({ ...FRAME, workspace: "Riverbend", counts: { newApplications: 3, reviewsDue: 1, paymentsDue: 0, reportsOverdue: 2 }, links });
    expect(m.subject).toBe("Riverbend this week: 3 new applications, 1 review due, 2 reports overdue");
    expect(m.text).toContain("- 3 new applications\n  Open applications: https://app.gms.test/w/riverbend/applications");
    expect(m.text).not.toContain("payments due");
    expect(m.html).toContain('<a href="https://app.gms.test/w/riverbend/reporting">Open reporting</a>');
  });
});
