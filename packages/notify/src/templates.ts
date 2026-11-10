// SPDX-License-Identifier: AGPL-3.0-only
// The built-in template kinds and their default copy. Workspaces store edited copies in `templates`;
// these are the shared-library defaults and the list of fields each kind must be given.
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

export const DEFAULT_TEMPLATES: Record<TemplateKind, EmailTemplate> = {
  acknowledgment: {
    kind: "acknowledgment",
    name: "Application received",
    subject: "We received your application: {{application.title}}",
    body: "Hello {{recipient.name}},\n\n{{funder.name}} received **{{application.title}}** for {{opportunity.title}} on {{application.submittedAt}}.\n\nYou can follow its status at any time: [View application status]({{links.status}})\n\nThank you,\n{{funder.name}}",
  },
  revision_request: {
    kind: "revision_request",
    name: "Revision requested",
    subject: "Revision requested: {{application.title}}",
    body: "Hello {{recipient.name}},\n\n{{funder.name}} has asked for a revision to **{{application.title}}**.\n\n{{revision.message}}\n\nPlease respond by {{revision.dueDate}}: [Open the application]({{links.application}})\n\nThank you,\n{{funder.name}}",
  },
  decline: {
    kind: "decline",
    name: "Decline",
    subject: "An update on your application to {{funder.name}}",
    body: "Hello {{recipient.name}},\n\nThank you for applying to {{opportunity.title}}. After review, {{funder.name}} is not able to fund **{{application.title}}** in this cycle.\n\n{{decision.message}}\n\nYour application and its record stay available to you: [View application]({{links.status}})\n\nSincerely,\n{{funder.name}}",
  },
  award_agreement: {
    kind: "award_agreement",
    name: "Award and agreement",
    subject: "Award offered: {{award.title}}",
    body: "Hello {{recipient.name}},\n\n{{funder.name}} is pleased to offer **{{award.amount}}** for **{{award.title}}**.\n\nTo accept, review the offer and sign the grant agreement: [Review and sign]({{links.award}})\n\nThe first payment is scheduled once the agreement is signed by both parties.\n\nCongratulations,\n{{funder.name}}",
  },
  report_reminder: {
    kind: "report_reminder",
    name: "Report reminder",
    subject: "{{requirement.title}} is due {{requirement.dueDate}}",
    body: "Hello {{recipient.name}},\n\n**{{requirement.title}}** for {{award.title}} is due {{requirement.dueDate}} ({{requirement.timing}}).\n\nMuch of the report is already filled in from your application and earlier reports: [Open the report]({{links.requirement}})\n\nThank you,\n{{funder.name}}",
  },
  payment_sent: {
    kind: "payment_sent",
    name: "Payment sent",
    subject: "Payment sent: {{payment.amount}} from {{funder.name}}",
    body: "Hello {{recipient.name}},\n\n{{funder.name}} sent **{{payment.amount}}** for {{award.title}} (payment {{payment.sequence}}).\n\n- Destination: {{payment.bankName}} ending in {{payment.last4}}\n- Sent: {{payment.sentAt}}\n\nThe destination is the one your organization verified in OpenGrants Passport. If you do not recognize it, contact {{funder.name}} at once.\n\n[View payments]({{links.award}})",
  },
};

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
