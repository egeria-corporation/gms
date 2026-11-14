// SPDX-License-Identifier: AGPL-3.0-only
// Apply anywhere email: the outside deadline reminder and the consulting request.
import { describe, expect, it } from "vitest";
import { CONSULTING_ANSWERS_MAX, CONSULTING_REQUEST_TO, consultingAnswersText, consultingRequestEmail, outsideDeadlineEmail, type ConsultingRequestContent } from "../src/index.ts";

describe("outside_deadline", () => {
  const base = { organization: "Alder Creek Family Services", title: "Rural clinics 2027", funder: "Northwind Family Foundation", kind: "full" as const, dueOn: "2027-05-01", daysLeft: 7, openQuestions: 2, link: "https://app.gms.test/w/alder-creek/outside/oa_1" };
  it("says what is due, when, and what is left", () => {
    const m = outsideDeadlineEmail(base);
    expect(m.subject).toBe("Full application due in 7 days: Rural clinics 2027");
    expect(m.text).toContain("is due in 7 days, on 2027-05-01.");
    expect(m.text).toContain("2 questions are not yet approved.");
    expect(m.text).toContain("Submit it to the funder directly");
    expect(m.html).toContain('<a href="https://app.gms.test/w/alder-creek/outside/oa_1">Open the application</a>');
    expect(outsideDeadlineEmail({ ...base, daysLeft: 0, kind: "internal", openQuestions: 0 }).subject).toBe("Internal deadline due today: Rural clinics 2027");
  });
  it("escapes what the applicant typed and keeps it on one line in the subject", () => {
    const m = outsideDeadlineEmail({ ...base, title: "<b>Bold</b>\nBcc: x", funder: null });
    expect(m.subject).toBe("Full application due in 7 days: <b>Bold</b> Bcc: x");
    expect(m.html).not.toContain("<b>");
    expect(m.html).toContain("&lt;b&gt;Bold&lt;/b&gt;");
  });
  it("refuses a link that is not https", () => {
    expect(() => outsideDeadlineEmail({ ...base, link: "http://x.test" })).toThrow();
  });
});

describe("consulting request", () => {
  const content: ConsultingRequestContent = {
    organization: "Alder Creek Family Services",
    requester: { name: "Ana Ruiz", email: "ana@aldercreekfs.example" },
    title: "Rural clinics 2027",
    funder: "Northwind Family Foundation",
    stage: "Drafting",
    deadlines: [{ label: "Full application", date: "2027-05-01" }],
    ask: "USD 50,000.00",
    links: [{ label: "Funder's listing", url: "https://northwind.example/grants" }],
    questionCount: 4,
    message: "We need help with the evaluation section.",
    answers: null,
  };
  it("goes to OpenGrants by default with the subject and the right-away line", () => {
    expect(CONSULTING_REQUEST_TO).toBe("hello@agents.opengrants.io");
    const m = consultingRequestEmail(content);
    expect(m.subject).toBe("Consulting request: Rural clinics 2027 (Alder Creek Family Services)");
    expect(m.text).toContain("wants consulting support from OpenGrants for this application, starting right away");
    for (const s of ["Organization: Alder Creek Family Services", "Requested by: Ana Ruiz <ana@aldercreekfs.example>", "Funder: Northwind Family Foundation", "Stage: Drafting", "Full application: 2027-05-01", "Ask: USD 50,000.00", "Funder's listing: https://northwind.example/grants", "Questions: 4", "We need help with the evaluation section.", "The organization did not include its answers."]) expect(m.text).toContain(s);
  });
  it("carries no answer text unless asked, and truncates included answers", () => {
    expect(consultingRequestEmail(content).text).not.toContain("Current answers");
    const long = "x".repeat(CONSULTING_ANSWERS_MAX + 500);
    const m = consultingRequestEmail({ ...content, answers: [{ prompt: "Need?", answer: "Families travel 46 miles." }, { prompt: "Plan?", answer: long }] });
    expect(m.text).toContain("1. Need?\nFamilies travel 46 miles.");
    expect(consultingAnswersText([{ prompt: "Plan?", answer: long }]).length).toBe(CONSULTING_ANSWERS_MAX);
  });
  it("escapes everything in the HTML part and makes no link of the applicant's text", () => {
    const m = consultingRequestEmail({ ...content, message: '<a href="https://evil.example">click</a>' });
    expect(m.html).not.toMatch(/<a /);
    expect(m.html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;");
  });
});
