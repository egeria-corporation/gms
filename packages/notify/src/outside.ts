// SPDX-License-Identifier: AGPL-3.0-only
// Apply anywhere email (v1.5.0): the deadline reminder for an outside application
// (`outside_deadline`) and the consulting request sent to OpenGrants. Every value comes from what
// the applicant typed, so each is plain text: cleaned, escaped in the HTML part, never a link. The
// only links are the GMS's own.
import { cleanLine, cleanText } from "./direct-award.ts";
import { DEFAULT_LOCALE, emailDate, emailT, type EmailKey, type Locale } from "./i18n.ts";
import { escapeHtml, type RenderedEmail } from "./render.ts";

export const OUTSIDE_DEADLINE_TEMPLATE = "outside_deadline";

/** Reminder offsets in days before a deadline (0 = the day itself). */
export const OUTSIDE_DEADLINE_OFFSETS: readonly number[] = [14, 7, 2, 0];

export type OutsideDeadlineKind = "loi" | "full" | "internal";
const KIND_LABEL: Record<OutsideDeadlineKind, EmailKey> = { loi: "outsideDeadline.kind.loi", full: "outsideDeadline.kind.full", internal: "outsideDeadline.kind.internal" };
export const outsideDeadlineLabel = (kind: OutsideDeadlineKind, locale: Locale = DEFAULT_LOCALE): string => emailT(locale)(KIND_LABEL[kind]);

export interface OutsideDeadlineFields {
  organization: string;
  title: string;
  funder: string | null;
  kind: OutsideDeadlineKind;
  /** YYYY-MM-DD. */
  dueOn: string;
  daysLeft: number;
  /** Questions not yet approved, for the line that says what is left. */
  openQuestions: number;
  /** The outside application in the GMS. */
  link: string;
  /** The recipient's language (English when absent). */
  locale?: Locale;
}

const SAFE_LINK = /^https:\/\/[^\s"'<>]+$/;
const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");

const when = (days: number) => ({ when: days <= 0 ? "today" : days === 1 ? "tomorrow" : "future", days });

export function outsideDeadlineEmail(f: OutsideDeadlineFields): RenderedEmail {
  if (!SAFE_LINK.test(f.link)) throw new Error("The link must be an https URL");
  const title = cleanLine(f.title);
  const funder = f.funder ? cleanLine(f.funder) : null;
  const org = cleanLine(f.organization);
  const locale = f.locale ?? DEFAULT_LOCALE;
  const t = emailT(locale);
  const subject = cleanLine(t("outsideDeadline.subject", { kind: f.kind, ...when(f.daysLeft), title }));
  const lines = [
    t("outsideDeadline.line", { kind: f.kind, title: `${title}${funder ? ` (${funder})` : ""}`, ...when(f.daysLeft), date: emailDate(locale, cleanLine(f.dueOn)) }),
    t("outsideDeadline.questions", { count: f.openQuestions }),
    t(f.kind === "internal" ? "outsideDeadline.internal" : "outsideDeadline.submit"),
  ];
  const open = t("outsideDeadline.link");
  const why = t("outsideDeadline.why", { organization: org });
  const hello = t("common.hello");
  const text = [hello, lines.join("\n"), `${open}: ${f.link}`, why].join("\n\n");
  const html = [paragraphs(hello), paragraphs(lines.join("\n")), `<p><a href="${escapeHtml(f.link)}">${escapeHtml(open)}</a></p>`, paragraphs(why)].join("\n");
  return { subject, text, html };
}

// ------------------------------------------------------------------------------------ consulting

/** Where consulting requests go unless CONSULTING_REQUEST_TO says otherwise (owner decision D7). */
export const CONSULTING_REQUEST_TO = "hello@agents.opengrants.io";
/** Answer text included when the person ticks "include my current answers", at most this long in all. */
export const CONSULTING_ANSWERS_MAX = 20_000;

export interface ConsultingRequestContent {
  organization: string;
  requester: { name: string; email: string };
  title: string;
  funder: string | null;
  stage: string;
  deadlines: { label: string; date: string }[];
  /** Printed, e.g. "USD 50,000.00"; null when no ask is recorded. */
  ask: string | null;
  links: { label: string; url: string }[];
  questionCount: number;
  message: string | null;
  /** Present only when the person chose to include their current answers. */
  answers: { prompt: string; answer: string }[] | null;
}

/** The answers as they will be sent, truncated to CONSULTING_ANSWERS_MAX characters in all. */
export function consultingAnswersText(answers: readonly { prompt: string; answer: string }[]): string {
  const full = answers.map((a, i) => `${i + 1}. ${cleanLine(a.prompt)}\n${cleanText(a.answer) || "(no answer yet)"}`).join("\n\n");
  return full.length > CONSULTING_ANSWERS_MAX ? `${full.slice(0, CONSULTING_ANSWERS_MAX - 1)}…` : full;
}

/** The consulting request email: exactly the preview the person confirmed. */
export function consultingRequestEmail(c: ConsultingRequestContent): RenderedEmail {
  const org = cleanLine(c.organization);
  const title = cleanLine(c.title);
  const subject = cleanLine(`Consulting request: ${title} (${org})`);
  const facts: string[] = [
    `Organization: ${org}`,
    `Requested by: ${cleanLine(c.requester.name)} <${cleanLine(c.requester.email)}>`,
    `Application: ${title}`,
    `Funder: ${c.funder ? cleanLine(c.funder) : "Not recorded"}`,
    `Stage: ${cleanLine(c.stage)}`,
    ...(c.deadlines.length ? c.deadlines.map((d) => `${cleanLine(d.label)}: ${cleanLine(d.date)}`) : ["Deadlines: none recorded"]),
    `Ask: ${c.ask ? cleanLine(c.ask) : "Not recorded"}`,
    ...c.links.map((l) => `${cleanLine(l.label)}: ${cleanLine(l.url)}`),
    `Questions: ${c.questionCount}`,
  ];
  const intro = `${org} wants consulting support from OpenGrants for this application, starting right away. Reply to this email to reach ${cleanLine(c.requester.name)}.`;
  const message = c.message ? cleanText(c.message).slice(0, 5000) : "";
  const answers = c.answers ? consultingAnswersText(c.answers) : "";
  const text = [intro, facts.join("\n"), ...(message ? [`Message:\n${message}`] : []), ...(c.answers ? [`Current answers:\n\n${answers || "(none yet)"}`] : ["The organization did not include its answers."]), "Sent from OpenGrants GMS."].join("\n\n");
  const html = [
    paragraphs(intro),
    `<p>${facts.map(escapeHtml).join("<br>")}</p>`,
    ...(message ? [`<p><strong>Message</strong></p>${paragraphs(message)}`] : []),
    ...(c.answers ? [`<p><strong>Current answers</strong></p>${paragraphs(answers || "(none yet)")}`] : [paragraphs("The organization did not include its answers.")]),
    paragraphs("Sent from OpenGrants GMS."),
  ].join("\n");
  return { subject, text, html };
}
