// SPDX-License-Identifier: AGPL-3.0-only
// The email that offers a directly given award (contract: direct awards). Everything in it except
// the two links is typed by the funder, so every value is plain text: escaped in the HTML part,
// never turned into markup or a link. The only links are the claim link and the GMS home.
import { escapeHtml, type RenderedEmail } from "./render.ts";

/** Shown unless the funder is verified with Passport (linked at L1 or above). */
export const FUNDER_NOT_VERIFIED_LINE = "This funder's organization is not verified with OpenGrants Passport.";

/** The funder's note is plain text, at most this long. */
export const DIRECT_AWARD_MESSAGE_MAX = 2000;

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

/** One line: no control characters, no line breaks (subjects and single-line fields). */
// eslint-disable-next-line no-control-regex -- removing control characters is the point
const oneLine = (v: string) => v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
/** Plain text that keeps its paragraphs and line breaks, without other control characters. */
// eslint-disable-next-line no-control-regex -- removing control characters is the point
const plain = (v: string) => v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").trim();
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
