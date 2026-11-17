// SPDX-License-Identifier: AGPL-3.0-only
// Send to the funder (C4): the email that carries an outside application's package to a funder
// contact the person typed. It goes out under the person's name, replies go to the person, and the
// preview the person confirmed is exactly what is sent. Every value comes from what the applicant
// typed, so each is plain text: cleaned, escaped in the HTML part, never a link.
import { cleanLine, cleanText } from "./direct-award.ts";
import type { Mailer, OutboundEmail } from "./mailer.ts";
import { DEFAULT_LOCALE, emailT, type Locale } from "./i18n.ts";
import { escapeHtml, type RenderedEmail } from "./render.ts";

/** The line under a package (PDF pages, answers.txt and the email), unless the workspace turned "Powered by" off; `packageFooter` in another language. */
export const PACKAGE_FOOTER = emailT()("sendPackage.footer");
export const packageFooter = (locale: Locale = DEFAULT_LOCALE): string => emailT(locale)("sendPackage.footer");

/** The person's own words above the package, at most this long. */
export const PACKAGE_MESSAGE_MAX = 2000;

export interface PackageEmailContent {
  /** The person sending: their name is the sender name and replies go to their address. */
  sender: { name: string; email: string };
  organization: string;
  title: string;
  funder: string | null;
  program: string | null;
  /** Printed, e.g. "USD 50,000.00"; null when no ask is recorded. */
  ask: string | null;
  /** e.g. "Application due 2027-05-01"; null when none is recorded. */
  deadline: string | null;
  message: string | null;
  /** The names of the files attached, in order: the package PDF first. */
  attachments: readonly string[];
  /** The workspace's "Powered by" setting: the footer line under the email. */
  footer: boolean;
  /** E4: the applicant's "for funders" link the footer line ends with; the GMS address when absent. */
  footerLink?: string;
  /** The sender's language, the package's (English when absent). What they typed stays as written. */
  locale?: Locale;
}

const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");

/** The package email. The same content always gives the same subject, text and HTML. */
export function sendPackageEmail(c: PackageEmailContent): RenderedEmail {
  const org = cleanLine(c.organization);
  const title = cleanLine(c.title);
  const name = cleanLine(c.sender.name);
  const funder = c.funder ? cleanLine(c.funder) : null;
  const locale = c.locale ?? DEFAULT_LOCALE;
  const t = emailT(locale);
  const footer = c.footerLink ? emailT(locale)("sendPackage.footerLink", { link: c.footerLink }) : packageFooter(locale);
  const subject = cleanLine(t("sendPackage.subject", { title, organization: org }));
  const facts = [
    t("sendPackage.organization", { value: org }),
    t("sendPackage.application", { value: title }),
    ...(funder ? [t("sendPackage.funder", { value: funder })] : []),
    ...(c.program ? [t("sendPackage.program", { value: cleanLine(c.program) })] : []),
    c.ask ? t("sendPackage.ask", { value: cleanLine(c.ask) }) : t("sendPackage.askNotStated"),
    ...(c.deadline ? [t("sendPackage.deadline", { value: cleanLine(c.deadline) })] : []),
  ];
  const intro = t("sendPackage.intro", { hasFunder: funder ? "yes" : "no", name, organization: org, funder: funder ?? "" });
  const message = c.message ? cleanText(c.message).slice(0, PACKAGE_MESSAGE_MAX) : "";
  const files = c.attachments.map((a) => `- ${cleanLine(a)}`);
  const reply = t("sendPackage.reply", { name, email: cleanLine(c.sender.email) });
  const attached = t("sendPackage.attached");
  const text = [...(message ? [message] : []), intro, facts.join("\n"), `${attached}:\n${files.join("\n")}`, reply, ...(c.footer ? [`--\n${footer}`] : [])].join("\n\n");
  const html = [
    ...(message ? [paragraphs(message)] : []),
    paragraphs(intro),
    `<p>${facts.map(escapeHtml).join("<br>")}</p>`,
    `<p><strong>${escapeHtml(attached)}</strong></p><ul>${c.attachments.map((a) => `<li>${escapeHtml(cleanLine(a))}</li>`).join("")}</ul>`,
    paragraphs(reply),
    ...(c.footer ? [`<p><small>${escapeHtml(footer)}</small></p>`] : []),
  ].join("\n");
  return { subject, text, html };
}

/** The address part of a From value (`Name <a@b>` or `a@b`). */
export const mailAddressOf = (from: string): string => (/<([^<>\s]+@[^<>\s]+)>/.exec(from)?.[1] ?? from).trim();

/** The From header with the person's name as the sender name, on the GMS's own sending address. */
export function fromWithName(name: string, mailFrom: string): string {
  const display = cleanLine(name)
    .replace(/["\\<>]/g, "")
    .slice(0, 80)
    .trim();
  const address = mailAddressOf(mailFrom);
  return display ? `"${display}" <${address}>` : address;
}

/** A file sent with an email; `content` is base64, as Resend's `attachments` take it. */
export interface EmailAttachment {
  filename: string;
  content: string;
  contentType: string;
}

export type OutboundEmailWithAttachments = OutboundEmail & { attachments: EmailAttachment[] };

/**
 * Whether a mailer passes `attachments` on to the provider. A mailer that does says so with
 * `sendsAttachments = true`; any other would drop the files and send an email that names
 * attachments it does not carry, so the package is not emailed through it.
 */
export const sendsAttachments = (m: Mailer | null | undefined): boolean => !!m && (m as { sendsAttachments?: unknown }).sendsAttachments === true;

/** Base64 of bytes, without Node's Buffer (Workers). */
export function base64Of(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
