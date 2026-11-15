// SPDX-License-Identifier: AGPL-3.0-only
// "Powered by OpenGrants Grant Management System" under the application receipt email. The line
// is the system's, not part of the funder's editable copy, and the funder can turn it off. Owner
// decision: no growth prompt ever goes into a review, decision or award email, so only the
// receipt carries it; add a kind here only with that decision revisited.
import { escapeHtml, type RenderedEmail } from "./render.ts";
import type { TemplateKind } from "./templates.ts";

export const POWERED_BY_NAME = "OpenGrants Grant Management System";

/** The only letters that may carry the line. */
export const POWERED_BY_KINDS: readonly TemplateKind[] = ["acknowledgment"];

/**
 * Adds the line to a rendered receipt when the funder has it on. Any other kind, or the setting
 * off, returns the email unchanged. The link is added only for an https landing page.
 */
export function withPoweredBy(kind: TemplateKind, email: RenderedEmail, opts: { enabled: boolean; landingUrl: string }): RenderedEmail {
  if (!opts.enabled || !POWERED_BY_KINDS.includes(kind)) return email;
  const url = /^https:\/\/[^\s"'<>]+$/i.test(opts.landingUrl) ? opts.landingUrl : null;
  const text = `${email.text}\n\n--\nPowered by ${POWERED_BY_NAME}${url ? ` (${url})` : ""}`;
  const html = `${email.html}\n<p><small>Powered by ${url ? `<a href="${escapeHtml(url)}">${POWERED_BY_NAME}</a>` : POWERED_BY_NAME}</small></p>`;
  return { ...email, text, html };
}
