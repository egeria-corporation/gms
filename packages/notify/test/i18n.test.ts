// SPDX-License-Identifier: AGPL-3.0-only
// Emails in the recipient's language (docs/i18n.md): the GMS's own words come from the `email`
// catalog, Spanish for a Spanish-preferring recipient and English otherwise; what people wrote stays
// as written; dates read as the language writes them.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATES,
  deadlinesDigestEmail,
  defaultTemplate,
  directAwardInvitationEmail,
  documentExpiringEmail,
  draftInvitationEmail,
  emailDocument,
  funderActivityDigestEmail,
  localizeFields,
  migrationConfirmationEmail,
  migrationSystemPhrase,
  newMatchesDigestEmail,
  outsideDeadlineEmail,
  outsideNextCycleEmail,
  outsideObligationEmail,
  packageFooter,
  PACKAGE_FOOTER,
  reminderTiming,
  renderEmail,
  sendPackageEmail,
  TEMPLATE_KINDS,
  withPoweredBy,
  type MergeFields,
  type RenderedEmail,
} from "../src/index.ts";

const link = "https://gms.example/x";
const fields: MergeFields = {
  recipient: { name: "Alder Creek" },
  funder: { name: "Riverbend Community Foundation" },
  application: { title: "Navigator Expansion", submittedAt: "2026-11-15" },
  opportunity: { title: "Community Health Grants 2027" },
  links: { status: link, application: link, award: link, requirement: link },
  revision: { message: "Please add the budget narrative.", dueDate: "2026-12-01" },
  decision: { message: "The panel funded fewer projects this year." },
  award: { title: "Navigator Expansion", amount: "$25,000" },
  requirement: { title: "Interim report", dueDate: "2027-03-31", timing: reminderTiming(-7, "es") },
  payment: { amount: "$5,000", sequence: 1, bankName: "River City Credit Union", last4: "4821", sentAt: "2027-01-15" },
};

/** Words the English copy uses and the Spanish never should: a Spanish email that still has them was not translated. */
const ENGLISH = /\b(Hello|Thank you|You get this|Open the|Change which emails|Stop getting|Powered by|is due|expires|Accept the invitation|Review and)\b/;
const all = (e: RenderedEmail) => `${e.subject}\n${e.text}\n${e.html}`;

describe("built-in letters", () => {
  it("are the English catalog's copy, with the merge fields the funder's editor shows", () => {
    expect(DEFAULT_TEMPLATES.acknowledgment.subject).toBe("We received your application: {{application.title}}");
    expect(DEFAULT_TEMPLATES.acknowledgment.body).toContain("{{funder.name}} received **{{application.title}}** for {{opportunity.title}} on {{application.submittedAt}}.");
    for (const kind of TEMPLATE_KINDS) expect(defaultTemplate(kind, "en")).toEqual(DEFAULT_TEMPLATES[kind]);
  });

  it("render in Spanish for a Spanish-preferring recipient, with the same merge fields and dates spelled out", () => {
    for (const kind of TEMPLATE_KINDS) {
      const es = defaultTemplate(kind, "es");
      // The same fields in both languages, so a Spanish letter never goes out with a blank.
      expect([...es.body.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]).sort(), kind).toEqual([...DEFAULT_TEMPLATES[kind].body.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]).sort());
      expect(es.name, "the name stays the template's identity").toBe(DEFAULT_TEMPLATES[kind].name);
      const email = renderEmail(es, localizeFields(fields, "es"));
      expect(all(email), kind).not.toMatch(ENGLISH);
    }
    const receipt = renderEmail(defaultTemplate("acknowledgment", "es"), localizeFields(fields, "es"));
    expect(receipt.subject).toBe("Recibimos su solicitud: Navigator Expansion");
    expect(receipt.text).toContain("Riverbend Community Foundation recibió Navigator Expansion para Community Health Grants 2027 el 15 de noviembre de 2026.");
    expect(receipt.html).toContain('<a href="https://gms.example/x">Ver el estado de la solicitud</a>');
    expect(renderEmail(defaultTemplate("report_reminder", "es"), localizeFields(fields, "es")).text).toContain("vence el 31 de marzo de 2027 (en 7 días)");
  });

  it("render in English otherwise, exactly as before", () => {
    const receipt = renderEmail(DEFAULT_TEMPLATES.acknowledgment, localizeFields(fields, "en"));
    expect(receipt.subject).toBe("We received your application: Navigator Expansion");
    expect(receipt.text).toContain("on 2026-11-15.");
    expect(reminderTiming(-7)).toBe("in 7 days");
    expect(reminderTiming(0)).toBe("today");
    expect(reminderTiming(3)).toBe("3 days ago");
    expect(reminderTiming(-1)).toBe("in 1 day");
  });

  it("leave a funder's own template as written: only the GMS's copy is translated", () => {
    const custom = { kind: "decline" as const, name: "Decline", subject: "Update from {{funder.name}}", body: "Dear {{recipient.name}}, our answer is no. {{decision.message}}" };
    // Rendered with the values as given (dates are not touched) and nothing added in another language.
    expect(renderEmail(custom, fields)).toEqual(renderEmail(custom, fields));
    expect(renderEmail(custom, fields).text).toBe("Dear Alder Creek, our answer is no. The panel funded fewer projects this year.");
  });

  it("put the Powered by line in the recipient's language", () => {
    const receipt = renderEmail(defaultTemplate("acknowledgment", "es"), localizeFields(fields, "es"));
    const es = withPoweredBy("acknowledgment", receipt, { enabled: true, landingUrl: "https://gms.example/", locale: "es" });
    expect(es.text).toMatch(/\n--\nCon la tecnología de OpenGrants Grant Management System \(https:\/\/gms\.example\/\)$/);
    expect(es.html).toContain('<p><small>Con la tecnología de <a href="https://gms.example/">OpenGrants Grant Management System</a></small></p>');
    expect(withPoweredBy("acknowledgment", receipt, { enabled: true, landingUrl: "https://gms.example/" }).text).toContain("Powered by OpenGrants Grant Management System");
  });

  it("carry the language into the HTML document", () => {
    expect(emailDocument("<p>Hola:</p>", "Asunto", "es")).toContain('<html lang="es" dir="ltr">');
    expect(emailDocument("<p>Hello,</p>", "Subject")).toContain('<html lang="en" dir="ltr">');
  });
});

const frame = { workspace: "Alder Creek", unsubscribeLink: "https://gms.example/u", oneClickUrl: "https://gms.example/o", settingsLink: "https://gms.example/s" };

describe("the GMS's other emails in Spanish", () => {
  const cases: [string, (locale: "en" | "es") => RenderedEmail][] = [
    ["new matches", (locale) => newMatchesDigestEmail({ ...frame, locale, items: [{ title: "Rural Health Fund", funder: "Copper Valley", deadline: "2027-01-10", amount: "$10,000", source: "gms", link }, { title: "Clinic Access", funder: null, deadline: null, amount: null, source: "opengrants", link }] })],
    ["deadlines", (locale) => deadlinesDigestEmail({ ...frame, locale, today: "2027-01-01", items: [{ date: "2027-01-02", label: locale === "es" ? "Vence el informe" : "Report due", title: "Interim report", funder: "Riverbend", link }] })],
    ["funder activity", (locale) => funderActivityDigestEmail({ ...frame, locale, links: { newApplications: link, reviewsDue: link, paymentsDue: link, reportsOverdue: link }, counts: { newApplications: 3, reviewsDue: 1, paymentsDue: 0, reportsOverdue: 2 } })],
    ["direct award", (locale) => directAwardInvitationEmail({ locale, funderName: "Riverbend", funderVerified: false, organizationName: "Alder Creek", awardTitle: "Navigator", amount: "USD 25,000.00", period: { startDate: "2027-01-01", endDate: "2027-12-31" }, message: "We are glad to support you.", invitedEmail: "ed@alder.example", claimUrl: link, homeUrl: "https://gms.example/", expiresOn: "2027-02-01" })],
    ["draft invitation", (locale) => draftInvitationEmail({ locale, organization: "Alder Creek", inviterName: "Ana", draftTitle: "Navigator", part: "Budget narrative", invitedEmail: "ed@alder.example", acceptUrl: link, homeUrl: "https://gms.example/", expiresOn: "2027-02-01" })],
    ["document expiring", (locale) => documentExpiringEmail({ locale, organization: "Alder Creek", documentName: "FY26 audit", typeLabel: locale === "es" ? "Auditoría" : "Audit", expiresOn: "2027-01-31", daysLeft: 30, link })],
    ["report due", (locale) => outsideObligationEmail({ locale, organization: "Alder Creek", title: "Navigator", funder: "Riverbend", obligationTitle: "Q1 report", kind: "report", dueOn: "2027-01-31", daysLeft: 7, link })],
    ["condition overdue", (locale) => outsideObligationEmail({ locale, organization: "Alder Creek", title: "Navigator", funder: null, obligationTitle: "Signed MOU", kind: "condition", dueOn: "2027-01-31", daysLeft: -3, link })],
    ["next cycle", (locale) => outsideNextCycleEmail({ locale, organization: "Alder Creek", title: "Navigator", funder: "Riverbend", programName: "Health", nextCycleOn: "2027-01-31", link })],
    ["outside deadline", (locale) => outsideDeadlineEmail({ locale, organization: "Alder Creek", title: "Navigator", funder: "Riverbend", kind: "loi", dueOn: "2027-01-31", daysLeft: 7, openQuestions: 2, link })],
    ["migration confirmation", (locale) => migrationConfirmationEmail({ locale, systemPhrase: migrationSystemPhrase("spreadsheets", locale), pageUrl: "https://gms.example/switch/spreadsheets" })],
    ["send package", (locale) => sendPackageEmail({ locale, sender: { name: "Ana", email: "ana@alder.example" }, organization: "Alder Creek", title: "Navigator", funder: "Riverbend", program: "Health", ask: "USD 50,000.00", deadline: null, message: null, attachments: ["Navigator.pdf"], footer: true })],
  ];

  it.each(cases)("%s: Spanish for a Spanish-preferring recipient, English otherwise", (_name, make) => {
    const es = make("es");
    const en = make("en");
    expect(all(es)).not.toMatch(ENGLISH);
    expect(all(en)).not.toEqual(all(es));
    // What people typed stays as written in both.
    for (const typed of ["Alder Creek", "Navigator", "Riverbend"]) if (all(en).includes(typed)) expect(all(es)).toContain(typed);
  });

  it("spells dates out in Spanish and keeps them as stored in English", () => {
    expect(directAwardInvitationEmail({ locale: "es", funderName: "Riverbend", funderVerified: true, organizationName: "Alder Creek", awardTitle: "Navigator", amount: "USD 25,000.00", invitedEmail: "ed@alder.example", claimUrl: link, homeUrl: "https://gms.example/", expiresOn: "2027-02-01" }).text).toContain("El enlace vence el 1 de febrero de 2027");
    expect(directAwardInvitationEmail({ funderName: "Riverbend", funderVerified: true, organizationName: "Alder Creek", awardTitle: "Navigator", amount: "USD 25,000.00", invitedEmail: "ed@alder.example", claimUrl: link, homeUrl: "https://gms.example/", expiresOn: "2027-02-01" }).text).toContain("The link expires on 2027-02-01");
  });

  it("uses plural rules, never a concatenated count", () => {
    const one = funderActivityDigestEmail({ ...frame, locale: "es", links: { newApplications: link, reviewsDue: link, paymentsDue: link, reportsOverdue: link }, counts: { newApplications: 1, reviewsDue: 0, paymentsDue: 0, reportsOverdue: 0 } });
    expect(one.subject).toBe("Alder Creek esta semana: 1 solicitud nueva");
    const many = funderActivityDigestEmail({ ...frame, locale: "es", links: { newApplications: link, reviewsDue: link, paymentsDue: link, reportsOverdue: link }, counts: { newApplications: 4, reviewsDue: 0, paymentsDue: 0, reportsOverdue: 0 } });
    expect(many.subject).toBe("Alder Creek esta semana: 4 solicitudes nuevas");
  });

  it("gives the package footer in the sender's language", () => {
    expect(packageFooter("en")).toBe(PACKAGE_FOOTER);
    expect(packageFooter("es")).toBe("Preparado con el OpenGrants Grant Management System, gratuito para financiadores y solicitantes · gms.opengrants.io");
  });
});
