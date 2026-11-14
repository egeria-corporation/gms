// SPDX-License-Identifier: AGPL-3.0-only
// Write faster and win and keep it (v1.6.0, v1.7.0): the vault's expiry warning
// (`document_expiring`), reminders of an outside award's reports and conditions
// (`outside_obligation_due`) and the next-cycle reminder of a declined application
// (`outside_next_cycle`). Every value is what the applicant typed: cleaned, escaped in the HTML
// part, never a link. The only links are the GMS's own.
import { cleanLine } from "./direct-award.ts";
import { escapeHtml, type RenderedEmail } from "./render.ts";

export const DOCUMENT_EXPIRING_TEMPLATE = "document_expiring";
export const OUTSIDE_OBLIGATION_TEMPLATE = "outside_obligation_due";
export const OUTSIDE_NEXT_CYCLE_TEMPLATE = "outside_next_cycle";

/** Days before (positive) or after (negative) a report or condition is due when a reminder goes: −30/−14/−7/0/+3/+14 in the contract's terms. */
export const OBLIGATION_REMINDER_OFFSETS: readonly number[] = [30, 14, 7, 0, -3, -14];
/** Days before a vault document expires when the warning goes. */
export const DOCUMENT_EXPIRY_OFFSETS: readonly number[] = [30];

const SAFE_LINK = /^https:\/\/[^\s"'<>]+$/;
const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
const assertLink = (link: string) => {
  if (!SAFE_LINK.test(link)) throw new Error("The link must be an https URL");
};
const render = (subject: string, lines: string[], linkLabel: string, link: string, why: string): RenderedEmail => {
  const text = ["Hello,", lines.join("\n"), `${linkLabel}: ${link}`, why].join("\n\n");
  const html = [paragraphs("Hello,"), paragraphs(lines.join("\n")), `<p><a href="${escapeHtml(link)}">${escapeHtml(linkLabel)}</a></p>`, paragraphs(why)].join("\n");
  return { subject: cleanLine(subject), text, html };
};
const relative = (days: number) => (days === 0 ? "today" : days === 1 ? "tomorrow" : days > 1 ? `in ${days} days` : days === -1 ? "yesterday" : `${-days} days ago`);

export interface DocumentExpiringFields {
  organization: string;
  documentName: string;
  /** e.g. "Audit". */
  typeLabel: string;
  /** YYYY-MM-DD. */
  expiresOn: string;
  daysLeft: number;
  /** The vault in the GMS. */
  link: string;
}

export function documentExpiringEmail(f: DocumentExpiringFields): RenderedEmail {
  assertLink(f.link);
  const name = cleanLine(f.documentName);
  const lines = [
    `${cleanLine(f.typeLabel)} "${name}" in your document vault expires ${relative(f.daysLeft)}, on ${cleanLine(f.expiresOn)}.`,
    "Upload the current version so applications use it, and set its new expiry date.",
  ];
  return render(`Document expiring ${relative(f.daysLeft)}: ${name}`, lines, "Open the document vault", f.link, `You get this because you manage documents for ${cleanLine(f.organization)}. Change which emails you get in your notification settings.`);
}

export type ObligationReminderKind = "report" | "condition";

export interface ObligationDueFields {
  organization: string;
  /** The outside application (award) it belongs to. */
  title: string;
  funder: string | null;
  obligationTitle: string;
  kind: ObligationReminderKind;
  /** YYYY-MM-DD. */
  dueOn: string;
  /** Positive before the due date, 0 on it, negative after. */
  daysLeft: number;
  link: string;
}

export function outsideObligationEmail(f: ObligationDueFields): RenderedEmail {
  assertLink(f.link);
  const what = cleanLine(f.obligationTitle);
  const award = `${cleanLine(f.title)}${f.funder ? ` (${cleanLine(f.funder)})` : ""}`;
  const noun = f.kind === "report" ? "report" : "condition";
  const due = f.daysLeft >= 0 ? `is due ${relative(f.daysLeft)}, on ${cleanLine(f.dueOn)}` : `was due ${relative(f.daysLeft)}, on ${cleanLine(f.dueOn)}, and is not marked ${f.kind === "report" ? "submitted" : "done"}`;
  const lines = [
    `The ${noun} "${what}" for ${award} ${due}.`,
    f.kind === "report" ? "Write it in the GMS, send it to the funder, then mark it submitted." : "Mark it done in the GMS once it is met.",
  ];
  const subject = f.daysLeft >= 0 ? `${f.kind === "report" ? "Report" : "Condition"} due ${relative(f.daysLeft)}: ${what}` : `Overdue ${noun}: ${what}`;
  return render(subject, lines, "Open the award", f.link, `You get this because you own this award or are assigned to it in ${cleanLine(f.organization)}. Change which emails you get in your notification settings.`);
}

export interface NextCycleFields {
  organization: string;
  title: string;
  funder: string | null;
  programName: string | null;
  /** YYYY-MM-DD. */
  nextCycleOn: string;
  link: string;
}

export function outsideNextCycleEmail(f: NextCycleFields): RenderedEmail {
  assertLink(f.link);
  const title = cleanLine(f.title);
  const what = f.programName ? cleanLine(f.programName) : title;
  const lines = [
    `You asked to be reminded today, ${cleanLine(f.nextCycleOn)}, that ${what}${f.funder ? ` from ${cleanLine(f.funder)}` : ""} may open again.`,
    "Your earlier application, its answers and the funder's feedback are kept in the GMS. Reopen it, or start a new one from it, when the funder's next round opens.",
  ];
  return render(`Next funding cycle: ${what}`, lines, "Open the earlier application", f.link, `You get this because you own this application in ${cleanLine(f.organization)}. Change which emails you get in your notification settings.`);
}
