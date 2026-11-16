// SPDX-License-Identifier: AGPL-3.0-only
// Write faster and win and keep it (v1.6.0, v1.7.0): the vault's expiry warning
// (`document_expiring`), reminders of an outside award's reports and conditions
// (`outside_obligation_due`) and the next-cycle reminder of a declined application
// (`outside_next_cycle`). Every value is what the applicant typed: cleaned, escaped in the HTML
// part, never a link. The only links are the GMS's own.
import { cleanLine } from "./direct-award.ts";
import { DEFAULT_LOCALE, emailDate, emailT, whenOf, type EmailT, type Locale } from "./i18n.ts";
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
const render = (t: EmailT, subject: string, lines: string[], linkLabel: string, link: string, why: string): RenderedEmail => {
  const hello = t("common.hello");
  const text = [hello, lines.join("\n"), `${linkLabel}: ${link}`, why].join("\n\n");
  const html = [paragraphs(hello), paragraphs(lines.join("\n")), `<p><a href="${escapeHtml(link)}">${escapeHtml(linkLabel)}</a></p>`, paragraphs(why)].join("\n");
  return { subject: cleanLine(subject), text, html };
};

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
  /** The recipient's language (English when absent); `typeLabel` must already be in it. */
  locale?: Locale;
}

export function documentExpiringEmail(f: DocumentExpiringFields): RenderedEmail {
  assertLink(f.link);
  const locale = f.locale ?? DEFAULT_LOCALE;
  const t = emailT(locale);
  const name = cleanLine(f.documentName);
  const when = whenOf(f.daysLeft);
  const lines = [t("keep.document.line", { type: cleanLine(f.typeLabel), name, ...when, date: emailDate(locale, cleanLine(f.expiresOn)) }), t("keep.document.upload")];
  return render(t, t("keep.document.subject", { ...when, name }), lines, t("keep.document.link"), f.link, t("keep.document.why", { organization: cleanLine(f.organization) }));
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
  /** The recipient's language (English when absent). */
  locale?: Locale;
}

export function outsideObligationEmail(f: ObligationDueFields): RenderedEmail {
  assertLink(f.link);
  const locale = f.locale ?? DEFAULT_LOCALE;
  const t = emailT(locale);
  const what = cleanLine(f.obligationTitle);
  const award = `${cleanLine(f.title)}${f.funder ? ` (${cleanLine(f.funder)})` : ""}`;
  const when = whenOf(f.daysLeft);
  const values = { kind: f.kind, title: what, award, ...when, date: emailDate(locale, cleanLine(f.dueOn)) };
  const lines = [t(f.daysLeft >= 0 ? "keep.obligation.due" : "keep.obligation.overdue", values), t(f.kind === "report" ? "keep.obligation.nextReport" : "keep.obligation.nextCondition")];
  const subject = t(f.daysLeft >= 0 ? "keep.obligation.subjectDue" : "keep.obligation.subjectOverdue", values);
  return render(t, subject, lines, t("keep.obligation.link"), f.link, t("keep.obligation.why", { organization: cleanLine(f.organization) }));
}

export interface NextCycleFields {
  organization: string;
  title: string;
  funder: string | null;
  programName: string | null;
  /** YYYY-MM-DD. */
  nextCycleOn: string;
  link: string;
  /** The recipient's language (English when absent). */
  locale?: Locale;
}

export function outsideNextCycleEmail(f: NextCycleFields): RenderedEmail {
  assertLink(f.link);
  const locale = f.locale ?? DEFAULT_LOCALE;
  const t = emailT(locale);
  const title = cleanLine(f.title);
  const what = f.programName ? cleanLine(f.programName) : title;
  const lines = [t("keep.nextCycle.line", { hasFunder: f.funder ? "yes" : "no", date: emailDate(locale, cleanLine(f.nextCycleOn)), what, funder: f.funder ? cleanLine(f.funder) : "" }), t("keep.nextCycle.kept")];
  return render(t, t("keep.nextCycle.subject", { what }), lines, t("keep.nextCycle.link"), f.link, t("keep.nextCycle.why", { organization: cleanLine(f.organization) }));
}
