// SPDX-License-Identifier: AGPL-3.0-only
// The email that invites someone to help write one draft (v1.7.0, `draft_invitation`). It is
// transactional: sent once, when a member clicks "Send invitation", with no marketing, no
// tracking and no reminders. Every name in it was typed by someone in the workspace, so each is
// plain text, and any that would read as a link is left out (the email then says less, never
// more). The only links are the accept link and the GMS home.
import { cleanLine, containsLink } from "./direct-award.ts";
import { DEFAULT_LOCALE, emailDate, emailT, type Locale } from "./i18n.ts";
import { escapeHtml, type RenderedEmail } from "./render.ts";

export const DRAFT_INVITATION_TEMPLATE = "draft_invitation";

/** The question or section named in the email, at most this many characters. */
export const DRAFT_INVITATION_PART_MAX = 160;

export interface DraftInvitationFields {
  /** The applicant workspace's name. */
  organization: string;
  /** Who clicked "Send invitation", when their name is known. */
  inviterName: string | null;
  /** The application's title. */
  draftTitle: string;
  /** The question (outside application) or section (built-in application) they are asked to write. */
  part: string | null;
  /** The address the invitation went to: the one to sign in with. */
  invitedEmail: string;
  acceptUrl: string;
  homeUrl: string;
  /** YYYY-MM-DD. */
  expiresOn: string;
  /** The recipient's language (English when absent). The names stay as typed. */
  locale?: Locale;
}

const SAFE_URL = /^https:\/\/[^\s"'<>]+$/;
const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");

/** One line of typed text, or null when it is empty or would show as a link in a mail program. */
function shown(v: string | null | undefined, max = 200): string | null {
  if (!v) return null;
  const line = cleanLine(v);
  if (!line || containsLink(line)) return null;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function draftInvitationEmail(f: DraftInvitationFields): RenderedEmail {
  if (!SAFE_URL.test(f.acceptUrl) || !SAFE_URL.test(f.homeUrl)) throw new Error("The accept and home links must be https URLs");
  const org = shown(f.organization);
  const inviter = shown(f.inviterName, 120);
  const title = shown(f.draftTitle, 300);
  const part = shown(f.part, DRAFT_INVITATION_PART_MAX);
  const email = cleanLine(f.invitedEmail);
  const locale = f.locale ?? DEFAULT_LOCALE;
  const t = emailT(locale);
  const hasTitle = title ? "yes" : "no";

  const subject = cleanLine(t("draftInvitation.subject", { hasTitle, title: title ?? "" }));
  const who = inviter && org ? "both" : inviter ? "inviter" : org ? "organization" : "nobody";
  const intro = t("draftInvitation.intro", { who, inviter: inviter ?? "", organization: org ?? "", hasTitle, title: title ?? "" });
  const ask = part ? t("draftInvitation.ask", { part }) : null;
  const access = t("draftInvitation.access", { hasOrganization: org ? "yes" : "no", organization: org ?? "" });
  const how = t("draftInvitation.how", { email, date: emailDate(locale, cleanLine(f.expiresOn)) });
  const close = t("draftInvitation.close");
  const hello = t("common.hello");

  const text = [hello, intro, ...(ask ? [ask] : []), access, `${how}\n${f.acceptUrl}`, close, `OpenGrants GMS: ${f.homeUrl}`].join("\n\n");
  const html = [
    paragraphs(hello),
    paragraphs(intro),
    ...(ask ? [paragraphs(ask)] : []),
    paragraphs(access),
    paragraphs(how),
    `<p><a href="${escapeHtml(f.acceptUrl)}">${escapeHtml(t("draftInvitation.link"))}</a></p>`,
    paragraphs(close),
    `<p><a href="${escapeHtml(f.homeUrl)}">OpenGrants GMS</a></p>`,
  ].join("\n");
  return { subject, text, html };
}
