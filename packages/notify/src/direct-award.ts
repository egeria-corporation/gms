// SPDX-License-Identifier: AGPL-3.0-only
// The email that offers a directly given award (contract: direct awards). Everything in it except
// the two links is typed by the funder, so every value is plain text: escaped in the HTML part,
// never turned into markup or a link. The only links are the claim link and the GMS home.
import { escapeHtml, type RenderedEmail } from "./render.ts";

/** Shown unless the funder is verified with Passport (linked at L1 or above). */
export const FUNDER_NOT_VERIFIED_LINE = "This funder's organization is not verified with OpenGrants Passport.";

/** The funder's note is plain text, at most this long. */
export const DIRECT_AWARD_MESSAGE_MAX = 2000;

// ------------------------------------------------------------------------------------ links

/** Characters read as the dot between host labels (IDNA): the ideographic, fullwidth and halfwidth full stops. */
const LABEL_DOTS = /[\u3002\uFF0E\uFF61]/g;
/** `scheme://` and the schemes that work without slashes. */
const SCHEME = /(?:[a-z][a-z0-9+.-]*:\/\/|\b(?:mailto|tel|sms|javascript|data|file|https?|ftp):)/i;
/** An address: something@something. */
const AT_ADDRESS = /[^\s@]@[^\s@]/;
/** Two dot-separated labels, the last of two or more letters, whatever the ending: `grants.ngo`, `x.foundation`, `a.de`. */
const HOST = /[\p{L}\p{N}_-]\.\p{L}{2,}/u;

/** Text as a mail program or browser would read it for links: NFKC, every full stop a dot, no invisible format characters. */
export function linkView(text: string): string {
  return text.normalize("NFKC").replace(LABEL_DOTS, ".").replace(/\p{Cf}/gu, "");
}

/**
 * Whether free text someone supplies would show up as a link in an email: a URL scheme, an `@`
 * address, or a host name of any ending. The one detector for every field a funder or grantee
 * types into GMS mail (organization name, title, message, decline reason) and for the funder's
 * name as the email prints it. Deliberately broad: `St.John` or `file.pdf` without a space count too.
 */
export function containsLink(text: string | null | undefined): boolean {
  if (!text) return false;
  const v = linkView(text);
  return SCHEME.test(v) || AT_ADDRESS.test(v) || HOST.test(v);
}

/** A field of the invitation email that would carry a link. */
export class LinkInTextError extends Error {
  constructor(readonly field: string) {
    super(`${field} would show as a link in the email`);
    this.name = "LinkInTextError";
  }
}

export interface DirectAwardInvitationFields {
  /** The funder's Passport legal name when it is linked to Passport, else its workspace's name. */
  funderName: string;
  /** True only when the funder is verified with Passport (L1 or above). */
  funderVerified: boolean;
  /** The organization's name as the funder typed it. */
  organizationName: string;
  awardTitle: string;
  /** Printed amount, e.g. `USD 25,000.00`. */
  amount: string;
  period?: { startDate: string; endDate: string } | null;
  message?: string | null;
  /** The address the invitation went to: the one to sign in with. */
  invitedEmail: string;
  claimUrl: string;
  homeUrl: string;
  /** YYYY-MM-DD. */
  expiresOn: string;
}

/**
 * One line of free text: line breaks and tabs become spaces, other control characters (C0, C1,
 * NUL) and invisible format characters (Unicode Cf: bidirectional controls, zero-width
 * characters) are removed, and spaces are folded. For every single-line field someone types into
 * GMS mail, at input and again in the email.
 */
export const cleanLine = (v: string): string =>
  v
    .replace(/\p{Cf}+/gu, "")
    .replace(/[\t\n\v\f\r\u0085\u2028\u2029]+/g, " ")
    .replace(/\p{Cc}+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
/** Free text that keeps its paragraphs and line breaks; otherwise as `cleanLine`. */
export const cleanText = (v: string): string =>
  v
    .replace(/\r\n?|[\u0085\u2028\u2029]/g, "\n")
    .replace(/\p{Cf}+/gu, "")
    .replace(/[\t\v\f]+/g, " ")
    .replace(/[^\P{Cc}\n]+/gu, "")
    .replace(/[ ]+\n/g, "\n")
    .trim();
const oneLine = cleanLine;
const plain = cleanText;
const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

const SAFE_URL = /^https:\/\/[^\s"'<>]+$/;

export function directAwardInvitationEmail(f: DirectAwardInvitationFields): RenderedEmail {
  if (!SAFE_URL.test(f.claimUrl) || !SAFE_URL.test(f.homeUrl)) throw new Error("The claim and home links must be https URLs");
  // The only links are the claim link and the GMS home: no other field may read as one.
  for (const [field, value] of [["funderName", f.funderName], ["organizationName", f.organizationName], ["awardTitle", f.awardTitle], ["message", f.message]] as const) if (containsLink(value)) throw new LinkInTextError(field);
  const funder = oneLine(f.funderName);
  const org = oneLine(f.organizationName);
  const title = oneLine(f.awardTitle);
  const amount = oneLine(f.amount);
  const email = oneLine(f.invitedEmail);
  const message = f.message ? plain(f.message).slice(0, DIRECT_AWARD_MESSAGE_MAX) : "";
  const period = f.period ? `${oneLine(f.period.startDate)} to ${oneLine(f.period.endDate)}` : null;

  const subject = oneLine(`${funder} has offered ${org} a grant`);
  const facts = [`Award: ${title}`, `Amount: ${amount}`, ...(period ? [`Grant period: ${period}`] : [])];
  const intro = `${funder} has offered ${org} a grant through OpenGrants GMS.`;
  const how = `To review and accept it, open the link below and sign in with ${email}. You can set up your organization there; OpenGrants Passport is not needed. Accepting shares your organization's record with ${funder}.`;
  const expiry = `The link expires on ${oneLine(f.expiresOn)} and works once. If you were not expecting this, you can ignore this email.`;

  const text = [
    "Hello,",
    intro,
    facts.join("\n"),
    ...(f.funderVerified ? [] : [FUNDER_NOT_VERIFIED_LINE]),
    ...(message ? [`Message from ${funder}:\n${message}`] : []),
    `${how}\n${f.claimUrl}`,
    expiry,
    `OpenGrants GMS: ${f.homeUrl}`,
  ].join("\n\n");

  const html = [
    paragraphs("Hello,"),
    paragraphs(intro),
    `<p>${facts.map(escapeHtml).join("<br>")}</p>`,
    ...(f.funderVerified ? [] : [`<p><strong>${escapeHtml(FUNDER_NOT_VERIFIED_LINE)}</strong></p>`]),
    ...(message ? [`<p>${escapeHtml(`Message from ${funder}:`)}</p><blockquote>${paragraphs(message)}</blockquote>`] : []),
    paragraphs(how),
    `<p><a href="${escapeHtml(f.claimUrl)}">Review and accept the award</a></p>`,
    paragraphs(expiry),
    `<p><a href="${escapeHtml(f.homeUrl)}">OpenGrants GMS</a></p>`,
  ].join("\n");

  return { subject, text, html };
}
