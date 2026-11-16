// SPDX-License-Identifier: AGPL-3.0-only
// The short notices the API sends from its services, in the recipient's language (docs/i18n.md):
// the workspace and reviewer invitations, the Passport sign-in link notice, a shared report, a new
// message's subject, the direct award's answers to the funder, the daily and weekly digests and the
// scheduled report. Names and titles are what people typed and stay as written.
import { DEFAULT_LOCALE, emailDate, emailT, type EmailKey, type Locale } from "./i18n.ts";
import { escapeHtml, type RenderedEmail } from "./render.ts";

const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

const ROLE_KEY: Record<string, EmailKey> = {
  admin: "role.admin",
  program_officer: "role.program_officer",
  finance: "role.finance",
  reviewer: "role.reviewer",
  external_reviewer: "role.external_reviewer",
  observer: "role.observer",
  auditor: "role.auditor",
  editor: "role.editor",
  viewer: "role.viewer",
  consultant: "role.consultant",
};

/** A workspace role as a sentence names it ("program officer"); an unknown role as written, without underscores. */
export const roleWords = (role: string, locale: Locale = DEFAULT_LOCALE): string => (ROLE_KEY[role] ? emailT(locale)(ROLE_KEY[role]) : role.replace(/_/g, " "));

/** The invitation to join a workspace. `workspace` null when the workspace cannot be read. */
export function workspaceInvitationEmail(f: { workspace: string | null; role: string; expiresOn: string; acceptUrl: string; locale?: Locale }): RenderedEmail {
  const locale = f.locale ?? DEFAULT_LOCALE;
  const t = emailT(locale);
  const workspace = f.workspace ?? t("workspaceInvitation.someWorkspace");
  const text = `${t("workspaceInvitation.intro", { workspace, role: roleWords(f.role, locale) })}\n\n${t("workspaceInvitation.accept", { date: emailDate(locale, f.expiresOn) })}\n${f.acceptUrl}\n\n${t("workspaceInvitation.ignore")}`;
  return { subject: t("workspaceInvitation.subject", { workspace }), text, html: paragraphs(text) };
}

const numericEscape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The invitation to review a competition's applications as an external reviewer. */
export function reviewerInvitationEmail(f: { funder: string | null; competition: string; acceptUrl: string; expiresOn: string; locale?: Locale }): RenderedEmail {
  const locale = f.locale ?? DEFAULT_LOCALE;
  const t = emailT(locale);
  const funder = f.funder ?? t("reviewerInvitation.someFunder");
  const date = emailDate(locale, f.expiresOn);
  const intro = t("reviewerInvitation.intro", { funder, competition: f.competition });
  const accept = t("reviewerInvitation.accept");
  const expiry = t("reviewerInvitation.expiry", { date });
  const introHtml = t("reviewerInvitation.intro", { funder: numericEscape(funder), competition: numericEscape(f.competition) });
  return {
    subject: t("reviewerInvitation.subject", { funder }),
    text: `${intro}\n\n${accept}: ${f.acceptUrl}\n\n${expiry}`,
    html: `<p>${introHtml}</p><p><a href="${f.acceptUrl}">${numericEscape(accept)}</a></p><p>${numericEscape(expiry)}</p>`,
  };
}

/** To the account's own address when Passport sign-in was linked to it. */
export function passportLinkedEmail(f: { webBaseUrl: string; locale?: Locale }): RenderedEmail {
  const t = emailT(f.locale ?? DEFAULT_LOCALE);
  const parts = [t("passportLinked.intro"), t("passportLinked.how"), t("passportLinked.notYou", { url: f.webBaseUrl })];
  return { subject: t("passportLinked.subject"), text: parts.join("\n\n"), html: `<p>${parts.map(escapeHtml).join("</p><p>")}</p>` };
}

/** To a funder's address when a grantee shares an accepted report with it. */
export function reportSharedEmail(f: { sender: string | null; funder: string; note?: string | null; link: string; locale?: Locale }): RenderedEmail {
  const t = emailT(f.locale ?? DEFAULT_LOCALE);
  const who = { hasSender: f.sender ? "yes" : "no", sender: f.sender ?? "" };
  const intro = t("reportShared.intro", { ...who, funder: f.funder });
  const open = t("reportShared.open");
  return {
    subject: t("reportShared.subject", who),
    text: `${intro}${f.note ? `\n\n${f.note}` : ""}\n\n${open}: ${f.link}`,
    html: `<p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(f.link)}">${escapeHtml(open)}</a></p>`,
  };
}

/** The subject of a new message's email; the body is the message itself, as written. */
export const threadMessageSubject = (f: { title: string | null; sender: string | null; locale?: Locale }): string =>
  emailT(f.locale ?? DEFAULT_LOCALE)("threadMessage.subject", { about: f.title ? "yes" : "no", title: f.title ?? "", hasSender: f.sender ? "yes" : "no", sender: f.sender ?? "" });

/** To the funder's staff: the organization accepted a directly given award. */
export function awardAcceptedNotice(f: { accepter: string; award: string; organization: string; locale?: Locale }): { subject: string; text: string } {
  const t = emailT(f.locale ?? DEFAULT_LOCALE);
  return { subject: t("awardNotice.acceptedSubject", f), text: t("awardNotice.accepted", f) };
}

/** To the funder's staff: the organization declined a directly given award; its reason as written. */
export function awardDeclinedNotice(f: { award: string; organization: string; reason?: string | null; locale?: Locale }): { subject: string; text: string } {
  const t = emailT(f.locale ?? DEFAULT_LOCALE);
  return { subject: t("awardNotice.declinedSubject", { award: f.award, organization: f.organization }), text: `${t("awardNotice.declined", { award: f.award, organization: f.organization })}${f.reason ? `\n\n${t("awardNotice.reason", { reason: f.reason })}` : ""}\n\n${t("awardNotice.choice")}` };
}

export interface MemberDigestFields {
  workspace: string;
  /** The in-app notifications since the last digest, as lines ("- title: message"). */
  lines: string[];
  /** How many there were in all (the lines are the first 50). */
  total: number;
  /** Outside deadlines of the next `days` days, as lines ("- date label: title (funder)"). */
  deadlines: string[];
  deadlineTotal: number;
  days: number;
  link: string;
  locale?: Locale;
}

/** The daily or weekly digest of what happened in a workspace. */
export function memberDigestEmail(f: MemberDigestFields): { subject: string; text: string } {
  const t = emailT(f.locale ?? DEFAULT_LOCALE);
  const deadlines = f.deadlineTotal ? `\n\n${t("memberDigest.deadlines", { days: f.days })}\n${f.deadlines.join("\n")}` : "";
  const intro = f.total ? `${t("memberDigest.intro", { workspace: f.workspace })}\n\n${f.lines.join("\n")}${f.total > f.lines.length ? `\n${t("memberDigest.more", { count: f.total - f.lines.length })}` : ""}` : t("memberDigest.nothing", { workspace: f.workspace });
  const subject = f.total ? t("memberDigest.subjectUpdates", { workspace: f.workspace, count: f.total }) : t("memberDigest.subjectDeadlines", { workspace: f.workspace, count: f.deadlineTotal, days: f.days });
  return { subject, text: `${intro}${deadlines}\n\n${f.link}` };
}

/** A scheduled report's period in words: "week 46 of 2026", "November 2026". */
export function reportPeriodWords(key: string, locale: Locale = DEFAULT_LOCALE): string {
  const w = /^(\d{4})-W(\d{2})$/.exec(key);
  if (w) return emailT(locale)("scheduledReport.week", { week: Number(w[2]), year: w[1]! });
  const [y, m] = key.split("-");
  const month = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  // English reads "November 2026", as before; Spanish "noviembre de 2026".
  return locale === DEFAULT_LOCALE ? `${month.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${y}` : month.toLocaleString("es-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** The email that a scheduled report's file is ready. */
export function scheduledReportEmail(f: { view: string; workspace: string; cadence: "weekly" | "monthly"; period: string; rows: number; truncated: boolean; max: number; total: number; days: number; link: string; locale?: Locale }): RenderedEmail {
  const locale = f.locale ?? DEFAULT_LOCALE;
  const t = emailT(locale);
  const rows = f.truncated ? t("scheduledReport.rowsTruncated", { count: f.rows, max: f.max, total: f.total }) : t("scheduledReport.rows", { count: f.rows });
  const parts = [t("scheduledReport.ready", { view: f.view, workspace: f.workspace, period: reportPeriodWords(f.period, locale), rows }), t("scheduledReport.download", { days: f.days }), f.link, t("scheduledReport.why")];
  const text = parts.join("\n\n");
  const html = parts.map((p) => (p === f.link ? `<p><a href="${escapeHtml(f.link)}">${escapeHtml(t("scheduledReport.link"))}</a></p>` : `<p>${escapeHtml(p)}</p>`)).join("");
  return { subject: t("scheduledReport.subject", { view: f.view, cadence: f.cadence }), text, html };
}
