// SPDX-License-Identifier: AGPL-3.0-only
// The email that invites someone to help write one draft (v1.7.0, `draft_invitation`). It is
// transactional: sent once, when a member clicks "Send invitation", with no marketing, no
// tracking and no reminders. Every name in it was typed by someone in the workspace, so each is
// plain text, and any that would read as a link is left out (the email then says less, never
// more). The only links are the accept link and the GMS home.
import { cleanLine, containsLink } from "./direct-award.ts";
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
  const team = org ?? "a team";

  const subject = cleanLine(title ? `Help write ${title}` : `You are invited to help write an application`);
  const who = inviter ? `${inviter}${org ? ` of ${org}` : ""}` : org ? `Someone at ${org}` : "Someone";
  const intro = `${who} invited you to help write ${title ? `the application ${title}` : "an application"} on OpenGrants GMS.`;
  const ask = part ? `They would like you to write: ${part}` : null;
  const access = `You will be able to open this one application and write its answers, and nothing else of ${team}'s workspace.`;
  const how = `To accept, open the link below and sign in with ${email}. The link works once and expires on ${cleanLine(f.expiresOn)}.`;
  const close = "This invitation is sent once, with no reminders. If you were not expecting it, you can ignore this email.";

  const text = ["Hello,", intro, ...(ask ? [ask] : []), access, `${how}\n${f.acceptUrl}`, close, `OpenGrants GMS: ${f.homeUrl}`].join("\n\n");
  const html = [
    paragraphs("Hello,"),
    paragraphs(intro),
    ...(ask ? [paragraphs(ask)] : []),
    paragraphs(access),
    paragraphs(how),
    `<p><a href="${escapeHtml(f.acceptUrl)}">Accept the invitation</a></p>`,
    paragraphs(close),
    `<p><a href="${escapeHtml(f.homeUrl)}">OpenGrants GMS</a></p>`,
  ].join("\n");
  return { subject, text, html };
}
