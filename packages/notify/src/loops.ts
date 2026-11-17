// SPDX-License-Identifier: AGPL-3.0-only
// Funder loops (E4): the one email a funder admin sends to invite a peer funder, and the package
// footer line with the applicant's "for funders" link.
//
// The invitation is sent once, when the admin clicks Send after reading the preview, under their
// name, with replies going to them. There are no reminders, no tracking pixel and no link other
// than the one that opens funder setup. What the admin typed (the note) is plain text: cleaned,
// escaped in the HTML part, and refused before this point when it holds a link (peer-invites.ts).
import { cleanLine, cleanText } from "./direct-award.ts";
import { DEFAULT_LOCALE, emailT, type Locale } from "./i18n.ts";
import { escapeHtml, type RenderedEmail } from "./render.ts";

export const PEER_INVITE_TEMPLATE = "peer_invitation";
/** The admin's own note above the invitation, at most this long. */
export const PEER_INVITE_NOTE_MAX = 500;

export interface PeerInviteFields {
  /** The admin's name on their account (never typed for the email). */
  inviterName: string;
  /** The inviting funder workspace's name. */
  funderName: string;
  /** What the admin wrote; null for none. */
  note: string | null;
  /** The invitation's link: funder setup with this invitation's token. */
  joinUrl: string;
  /** The sender's language: the note is in their words, so the fixed words follow them. */
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

/** The invitation email. The same fields always give the same subject, text and HTML. */
export function peerInviteEmail(f: PeerInviteFields): RenderedEmail {
  if (!SAFE_URL.test(f.joinUrl)) throw new Error("The invitation link must be an https URL");
  const t = emailT(f.locale ?? DEFAULT_LOCALE);
  const inviter = cleanLine(f.inviterName).slice(0, 120);
  const funder = cleanLine(f.funderName).slice(0, 200);
  const note = f.note ? cleanText(f.note).trim().slice(0, PEER_INVITE_NOTE_MAX) : "";
  const subject = cleanLine(t("peerInvite.subject", { inviter, funder }));
  const noteFrom = t("peerInvite.noteFrom", { inviter });
  const intro = t("peerInvite.intro", { inviter, funder });
  const what = t("peerInvite.what");
  const how = t("peerInvite.how");
  const once = t("peerInvite.once", { inviter });
  const text = [...(note ? [`${noteFrom}\n\n${note}`] : []), intro, what, `${how}\n${f.joinUrl}`, once].join("\n\n");
  const html = [
    ...(note ? [`<p><strong>${escapeHtml(noteFrom)}</strong></p>`, paragraphs(note)] : []),
    paragraphs(intro),
    paragraphs(what),
    paragraphs(how),
    `<p><a href="${escapeHtml(f.joinUrl)}">${escapeHtml(t("peerInvite.link"))}</a></p>`,
    paragraphs(once),
  ].join("\n");
  return { subject, text, html };
}

/** The package footer with the applicant's "for funders" link (`/for-funders?ref=<token>`), in a language. */
export const packageFooterWithLink = (link: string, locale: Locale = DEFAULT_LOCALE): string => emailT(locale)("sendPackage.footerLink", { link });

/**
 * The package PDF's footer with that link: a short line, so it fits the page beside the page
 * number in both languages (the email and answers.txt carry the full line).
 */
export const packagePdfFooterWithLink = (link: string, locale: Locale = DEFAULT_LOCALE): string => emailT(locale)("sendPackage.footerPdf", { link: link.replace(/^https?:\/\//, "") });
