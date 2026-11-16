// SPDX-License-Identifier: AGPL-3.0-only
// Send to the funder: the package email, the sender name and the attachment guard.
import { describe, expect, it } from "vitest";
import { base64Of, fromWithName, mailAddressOf, MemoryMailer, PACKAGE_FOOTER, ResendMailer, sendPackageEmail, sendsAttachments, type PackageEmailContent } from "../src/index.ts";

const content: PackageEmailContent = {
  sender: { name: "Ana Ruiz", email: "ana.ruiz@aldercreekfs.example" },
  organization: "Alder Creek Family Services",
  title: "Rural clinics 2027",
  funder: "Northwind Family Foundation",
  program: "Rural Health",
  ask: "USD 50,000.00",
  deadline: "Application due 2027-05-01",
  message: "Dear Ms. Lee,\n\nAs we discussed, here is our application.",
  attachments: ["Rural-clinics-2027.pdf", "Board list.pdf"],
  footer: true,
};

describe("package email", () => {
  it("says who sends what, lists the files and ends with the footer line", () => {
    const m = sendPackageEmail(content);
    expect(m.subject).toBe("Application: Rural clinics 2027 (Alder Creek Family Services)");
    expect(m.text.startsWith("Dear Ms. Lee,\n\nAs we discussed, here is our application.")).toBe(true);
    expect(m.text).toContain("Ana Ruiz of Alder Creek Family Services sends the application below for Northwind Family Foundation.");
    expect(m.text).toContain("Program: Rural Health\nAsk: USD 50,000.00\nDeadline: Application due 2027-05-01");
    expect(m.text).toContain("Attached:\n- Rural-clinics-2027.pdf\n- Board list.pdf");
    expect(m.text).toContain("Reply to this email to reach Ana Ruiz (ana.ruiz@aldercreekfs.example).");
    expect(m.text.endsWith(`--\n${PACKAGE_FOOTER}`)).toBe(true);
    expect(m.html).toContain(PACKAGE_FOOTER);
  });
  it("leaves the footer out when the workspace turned it off", () => {
    const m = sendPackageEmail({ ...content, footer: false });
    expect(m.text).not.toContain("Prepared with");
    expect(m.html).not.toContain("Prepared with");
  });
  it("escapes what the applicant typed and keeps the subject on one line", () => {
    const m = sendPackageEmail({ ...content, title: "<b>Bold</b>\nBcc: x", message: "<script>x</script>" });
    expect(m.subject).toBe("Application: <b>Bold</b> Bcc: x (Alder Creek Family Services)");
    expect(m.html).not.toContain("<b>");
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
  });
  it("is the same for the same content", () => {
    expect(sendPackageEmail(content)).toEqual(sendPackageEmail({ ...content }));
  });
});

describe("sender", () => {
  it("puts the person's name on the GMS's own address", () => {
    expect(fromWithName("Ana Ruiz", "OpenGrants GMS <notify@gms.opengrants.io>")).toBe('"Ana Ruiz" <notify@gms.opengrants.io>');
    expect(fromWithName('Ana "A" <Ruiz>\r\nBcc: x', "notify@gms.opengrants.io")).toBe('"Ana A Ruiz Bcc: x" <notify@gms.opengrants.io>');
    expect(fromWithName("  ", "notify@gms.opengrants.io")).toBe("notify@gms.opengrants.io");
    expect(mailAddressOf("GMS <a@b.example>")).toBe("a@b.example");
  });
});

describe("attachments", () => {
  it("only a mailer that says it passes attachments on is used", () => {
    // Both mailers pass attachments on (v1.9.0); a mailer that does not say so is not used.
    expect(sendsAttachments(new MemoryMailer())).toBe(true);
    expect(sendsAttachments(new ResendMailer("test-key"))).toBe(true);
    expect(sendsAttachments(Object.assign(new MemoryMailer(), { sendsAttachments: false }))).toBe(false);
    expect(sendsAttachments({ send: async () => ({ id: "x" }) })).toBe(false);
    expect(sendsAttachments(undefined)).toBe(false);
  });
  it("encodes bytes as base64 without Buffer", () => {
    expect(base64Of(new TextEncoder().encode("hello"))).toBe("aGVsbG8=");
    const big = new Uint8Array(100_000).fill(65);
    expect(atob(base64Of(big)).length).toBe(100_000);
  });
});
