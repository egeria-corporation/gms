// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES, POWERED_BY_KINDS, renderEmail, TEMPLATE_KINDS, withPoweredBy, type MergeFields } from "../src/index.ts";

const FIELDS: MergeFields = {
  recipient: { name: "Maria Santos" },
  funder: { name: "Riverbend Community Foundation" },
  application: { title: "Navigator Expansion", submittedAt: "2027-03-02" },
  opportunity: { title: "Community Health Grants 2027" },
  links: { status: "https://gms.example/w/alder-creek/applications/app_1" },
};
const LANDING = "https://gms.example/";
const receipt = () => renderEmail(DEFAULT_TEMPLATES.acknowledgment, FIELDS);

describe("Powered by in the application receipt", () => {
  it("adds the line, with a link to the landing page, when the funder has it on", () => {
    const email = withPoweredBy("acknowledgment", receipt(), { enabled: true, landingUrl: LANDING });
    expect(email.text).toMatch(/\n--\nPowered by OpenGrants Grant Management System \(https:\/\/gms\.example\/\)$/);
    expect(email.html).toContain('<p><small>Powered by <a href="https://gms.example/">OpenGrants Grant Management System</a></small></p>');
    expect(email.subject).toBe(receipt().subject);
  });

  it("leaves the receipt as it was when the funder turned it off", () => {
    expect(withPoweredBy("acknowledgment", receipt(), { enabled: false, landingUrl: LANDING })).toEqual(receipt());
    expect(receipt().text).not.toContain("Powered by");
    expect(receipt().html).not.toContain("Powered by");
  });

  it("never reaches a review, decision, award or payment email", () => {
    expect(POWERED_BY_KINDS).toEqual(["acknowledgment"]);
    for (const kind of TEMPLATE_KINDS.filter((k) => k !== "acknowledgment")) {
      const email = { subject: "s", text: "t", html: "<p>h</p>" };
      expect(withPoweredBy(kind, email, { enabled: true, landingUrl: LANDING }), kind).toBe(email);
    }
  });

  it("links only an https landing page, and escapes it", () => {
    const plain = withPoweredBy("acknowledgment", receipt(), { enabled: true, landingUrl: "http://localhost:5173/" });
    expect(plain.html).toContain("<small>Powered by OpenGrants Grant Management System</small>");
    expect(plain.html).not.toContain("localhost");
    const odd = withPoweredBy("acknowledgment", receipt(), { enabled: true, landingUrl: "https://gms.example/?a=1&b=2" });
    expect(odd.html).toContain('href="https://gms.example/?a=1&amp;b=2"');
  });
});
