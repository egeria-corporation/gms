// SPDX-License-Identifier: AGPL-3.0-only
// The built-in template kinds and their default copy. Workspaces store edited copies in `templates`;
// these are the shared-library defaults and the list of fields each kind must be given. The default
// copy is in the `email` catalog, in every language; an edited copy is sent as the funder wrote it.
import { DEFAULT_LOCALE, emailDate, emailT, type EmailKey, type Locale } from "./i18n.ts";
import { renderTemplate, templateFields, type MergeFields, type RenderedEmail } from "./render.ts";

export const TEMPLATE_KINDS = ["acknowledgment", "revision_request", "decline", "award_agreement", "report_reminder", "payment_sent"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export interface EmailTemplate {
  kind: TemplateKind;
  name: string;
  subject: string;
  /** Markdown with {{merge.fields}}. */
  body: string;
}

/** The catalog messages of each kind's default copy (docs/i18n.md). Names stay English: a workspace overrides a built-in letter by saving a template under its name. */
const LETTER: Record<TemplateKind, { name: string; subject: EmailKey; body: EmailKey }> = {
  acknowledgment: { name: "Application received", subject: "letter.acknowledgment.subject", body: "letter.acknowledgment.body" },
  revision_request: { name: "Revision requested", subject: "letter.revisionRequest.subject", body: "letter.revisionRequest.body" },
  decline: { name: "Decline", subject: "letter.decline.subject", body: "letter.decline.body" },
  award_agreement: { name: "Award and agreement", subject: "letter.awardAgreement.subject", body: "letter.awardAgreement.body" },
  report_reminder: { name: "Report reminder", subject: "letter.reportReminder.subject", body: "letter.reportReminder.body" },
  payment_sent: { name: "Payment sent", subject: "letter.paymentSent.subject", body: "letter.paymentSent.body" },
};

/**
 * Every merge field the default copy uses. The catalog writes `{{recipient.name}}` as
 * `{recipient_name}`, so a translator sees an ordinary placeholder; it becomes the merge field again here.
 */
const MERGE_FIELDS = [
  "recipient.name", "funder.name", "application.title", "application.submittedAt", "opportunity.title", "links.status", "links.application", "links.award", "links.requirement",
  "revision.message", "revision.dueDate", "decision.message", "award.title", "award.amount", "requirement.title", "requirement.dueDate", "requirement.timing",
  "payment.amount", "payment.sequence", "payment.bankName", "payment.last4", "payment.sentAt",
] as const;
const AS_MERGE_FIELDS = Object.fromEntries(MERGE_FIELDS.map((f) => [f.replace(/\./g, "_"), `{{${f}}}`]));

/** A kind's default copy in a language: the built-in letter a recipient gets unless the funder edited it. */
export function defaultTemplate(kind: TemplateKind, locale: Locale = DEFAULT_LOCALE): EmailTemplate {
  const t = emailT(locale);
  const l = LETTER[kind];
  return { kind, name: l.name, subject: t(l.subject, AS_MERGE_FIELDS), body: t(l.body, AS_MERGE_FIELDS) };
}

/** The default copy in English: the shared library's defaults, and the fields each kind must be given. */
export const DEFAULT_TEMPLATES: Record<TemplateKind, EmailTemplate> = Object.fromEntries(TEMPLATE_KINDS.map((k) => [k, defaultTemplate(k)])) as Record<TemplateKind, EmailTemplate>;

/**
 * Merge values written for the recipient's language: a plain date (`YYYY-MM-DD`) reads as the
 * language writes dates. English is returned unchanged. Only for the GMS's own copy: a funder's
 * edited template gets its values as given.
 */
export function localizeFields(fields: MergeFields, locale: Locale): MergeFields {
  if (locale === DEFAULT_LOCALE) return fields;
  const walk = (v: MergeFields): MergeFields => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? emailDate(locale, x) : x && typeof x === "object" ? walk(x) : x]));
  return walk(fields);
}

/** How far a report's due date is from the reminder, for `requirement.timing`: negative before, positive after. */
export function reminderTiming(offsetDays: number, locale: Locale = DEFAULT_LOCALE): string {
  const days = Math.abs(offsetDays);
  return emailT(locale)("letter.reportReminder.timing", { when: offsetDays < 0 ? "future" : offsetDays === 0 ? "today" : "past", days });
}

export class BankDataError extends Error {}

const LAST4 = /^\d{4}$/;
const PAYMENT_FIELDS = new Set(["amount", "sequence", "bankName", "last4", "sentAt"]);

/** Payment emails may name the bank and the last four digits, nothing more. This refuses any
 * other payment field and any value that looks like a full account or card number. */
export function assertPaymentFieldsSafe(fields: MergeFields): void {
  const payment = fields.payment;
  if (payment === undefined || payment === null) return;
  if (typeof payment !== "object") throw new BankDataError("payment must be an object of merge fields.");
  for (const [key, value] of Object.entries(payment)) {
    if (!PAYMENT_FIELDS.has(key)) throw new BankDataError(`payment.${key} is not allowed in email. Allowed: ${[...PAYMENT_FIELDS].join(", ")}.`);
    if (key === "last4" && !LAST4.test(String(value))) throw new BankDataError("payment.last4 must be exactly four digits.");
    if (key === "bankName" && /\d{5,}/.test(String(value))) throw new BankDataError("payment.bankName must not contain a number sequence.");
  }
}

/** Fields a template of this kind needs (from the default copy, or an edited body). */
export function requiredFields(template: Pick<EmailTemplate, "subject" | "body">): string[] {
  return [...new Set([...templateFields(template.subject), ...templateFields(template.body)])];
}

/** Checks an edited template before it is saved: it may only use fields its kind supplies. */
export function validateTemplate(template: EmailTemplate): { ok: true } | { ok: false; unknownFields: string[] } {
  const known = new Set(requiredFields(DEFAULT_TEMPLATES[template.kind]));
  // Fields common to every send.
  for (const f of ["recipient.name", "funder.name", "award.title", "application.title", "opportunity.title"]) known.add(f);
  const unknownFields = requiredFields(template).filter((f) => !known.has(f));
  return unknownFields.length ? { ok: false, unknownFields } : { ok: true };
}

export function renderEmail(template: EmailTemplate, fields: MergeFields): RenderedEmail {
  assertPaymentFieldsSafe(fields);
  return renderTemplate(template, fields);
}
