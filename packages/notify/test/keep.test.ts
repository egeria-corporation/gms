// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { documentExpiringEmail, OBLIGATION_REMINDER_OFFSETS, outsideNextCycleEmail, outsideObligationEmail } from "../src/index.ts";

const LINK = "https://gms.test/w/alder-creek/outside/1";

describe("write faster and keep it emails", () => {
  it("warns of an expiring vault document in plain words, with the text escaped", () => {
    const m = documentExpiringEmail({ organization: "Alder Creek", documentName: "Audit <2025>.pdf", typeLabel: "Audit", expiresOn: "2027-05-16", daysLeft: 30, link: LINK });
    expect(m.subject).toBe("Document expiring in 30 days: Audit <2025>.pdf");
    expect(m.text).toContain("expires in 30 days, on 2027-05-16");
    expect(m.html).toContain("Audit &lt;2025&gt;.pdf");
    expect(m.html).not.toContain("<2025>");
  });

  it("reminds of a report before and after its due date", () => {
    expect(OBLIGATION_REMINDER_OFFSETS).toEqual([30, 14, 7, 0, -3, -14]);
    const before = outsideObligationEmail({ organization: "Alder Creek", title: "Clinic grant", funder: "Northwind", obligationTitle: "Progress report 1", kind: "report", dueOn: "2027-07-01", daysLeft: 7, link: LINK });
    expect(before.subject).toBe("Report due in 7 days: Progress report 1");
    expect(before.text).toContain("mark it submitted");
    const after = outsideObligationEmail({ organization: "Alder Creek", title: "Clinic grant", funder: null, obligationTitle: "Signage", kind: "condition", dueOn: "2027-07-01", daysLeft: -3, link: LINK });
    expect(after.subject).toBe("Overdue condition: Signage");
    expect(after.text).toContain("was due 3 days ago");
  });

  it("reminds of the next cycle, and refuses a link that is not the GMS's https link", () => {
    const m = outsideNextCycleEmail({ organization: "Alder Creek", title: "Clinic grant", funder: "Northwind", programName: "Rural Health Fund", nextCycleOn: "2028-01-15", link: LINK });
    expect(m.subject).toBe("Next funding cycle: Rural Health Fund");
    expect(() => outsideNextCycleEmail({ organization: "A", title: "T", funder: null, programName: null, nextCycleOn: "2028-01-15", link: "javascript:alert(1)" })).toThrow();
  });
});
