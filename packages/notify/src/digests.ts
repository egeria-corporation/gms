// SPDX-License-Identifier: AGPL-3.0-only
// Opt-in content digests (v1.8.0), sent on Mondays to people who turned them on: new matches and
// deadlines for applicants, the week's activity for funder staff. Every email has a plain-text and
// an HTML part, no images and no tracking, a one-click unsubscribe link for that digest alone and
// the `List-Unsubscribe` / `List-Unsubscribe-Post` headers (RFC 8058). Listing titles and funder
// names come from OpenGrants or from what people typed: cleaned, escaped in the HTML part, never a
// link. The only links are the GMS's own. The funder digest carries counts, never applicants' answers.
import { cleanLine } from "./direct-award.ts";
import { escapeHtml, type RenderedEmail } from "./render.ts";

export const CONTENT_DIGESTS = ["new_matches", "deadlines", "funder_activity"] as const;
export type ContentDigest = (typeof CONTENT_DIGESTS)[number];

/** What each digest is called on screen and in the email. */
export const CONTENT_DIGEST_LABEL: Record<ContentDigest, string> = {
  new_matches: "New matches",
  deadlines: "Deadlines",
  funder_activity: "This week's activity",
};

/** Template names (idempotency keys and tags). */
export const CONTENT_DIGEST_TEMPLATE: Record<ContentDigest, string> = {
  new_matches: "digest_new_matches",
  deadlines: "digest_deadlines",
  funder_activity: "digest_funder_activity",
};

/** At most this many matches in one email. */
export const MAX_DIGEST_MATCHES = 10;
/** The deadlines digest looks this many days ahead. */
export const DEADLINE_DIGEST_DAYS = 21;
/** Lines listed in a deadlines digest before "and N more". */
const MAX_DEADLINE_LINES = 40;

export interface DigestFrame {
  /** The workspace, as its members know it. */
  workspace: string;
  /** The web page that turns this one digest off, with no sign-in. */
  unsubscribeLink: string;
  /** The API address a mail app POSTs to for one-click unsubscribe (RFC 8058). */
  oneClickUrl: string;
  /** Where the person changes which emails they get. */
  settingsLink: string;
}

export interface DigestEmail extends RenderedEmail {
  headers: Record<string, string>;
}

const SAFE_LINK = /^https:\/\/[^\s"'<>]+$/;
const assertLink = (link: string) => {
  if (!SAFE_LINK.test(link)) throw new Error("The link must be an https URL");
};
const esc = (v: string) => escapeHtml(v);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The two headers that let a mail app offer "Unsubscribe" and do it with one POST. */
export function unsubscribeHeaders(oneClickUrl: string): Record<string, string> {
  assertLink(oneClickUrl);
  return { "List-Unsubscribe": `<${oneClickUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

function frame(digest: ContentDigest, f: DigestFrame, subject: string, intro: string, bodyText: string[], bodyHtml: string, note?: string | null): DigestEmail {
  for (const link of [f.unsubscribeLink, f.oneClickUrl, f.settingsLink]) assertLink(link);
  const ws = cleanLine(f.workspace);
  const label = CONTENT_DIGEST_LABEL[digest];
  const why = `You get this because you turned on "${label}" for ${ws}. It comes on Mondays, and only when there is something new.`;
  const cleanNote = note ? cleanLine(note) : null;
  const text = ["Hello,", intro, ...bodyText, ...(cleanNote ? [cleanNote] : []), `Change which emails you get: ${f.settingsLink}`, `Stop getting this email: ${f.unsubscribeLink}`, why].join("\n\n");
  const html = [
    "<p>Hello,</p>",
    `<p>${esc(intro)}</p>`,
    bodyHtml,
    ...(cleanNote ? [`<p>${esc(cleanNote)}</p>`] : []),
    `<p><a href="${esc(f.settingsLink)}">Change which emails you get</a> · <a href="${esc(f.unsubscribeLink)}">Stop getting this email</a></p>`,
    `<p>${esc(why)}</p>`,
  ].join("\n");
  return { subject: cleanLine(subject), text, html, headers: unsubscribeHeaders(f.oneClickUrl) };
}

// ------------------------------------------------------------------------------------ new matches

export interface DigestMatch {
  title: string;
  funder: string | null;
  /** As the listing gives it (often YYYY-MM-DD). */
  deadline: string | null;
  amount: string | null;
  /** `gms`: open for applications on this site; `opengrants`: found in the OpenGrants index. */
  source: "gms" | "opengrants";
  /** The GMS's own page for it. */
  link: string;
}

export interface NewMatchesFields extends DigestFrame {
  items: DigestMatch[];
  /** Said under the list, e.g. that OpenGrants could not be reached this week. */
  note?: string | null;
}

export function newMatchesDigestEmail(f: NewMatchesFields): DigestEmail {
  const items = f.items.slice(0, MAX_DIGEST_MATCHES);
  if (!items.length) throw new Error("A digest with nothing new is not sent");
  for (const m of items) assertLink(m.link);
  const ws = cleanLine(f.workspace);
  const n = items.length;
  const intro = `${n === 1 ? "Here is a new funding opportunity" : `Here are ${n} new funding opportunities`} that fit ${ws}. None of them was in an earlier email or is saved already.`;
  const detail = (m: DigestMatch) => [m.deadline ? `Deadline ${cleanLine(m.deadline)}` : null, m.amount ? cleanLine(m.amount) : null, m.source === "gms" ? "Open for applications here" : "From the OpenGrants index"].filter(Boolean).join(" · ");
  const head = (m: DigestMatch) => `${cleanLine(m.title)}${m.funder ? ` (${cleanLine(m.funder)})` : ""}`;
  const text = items.map((m, i) => `${i + 1}. ${head(m)}\n   ${detail(m)}\n   ${m.link}`);
  const html = `<ol>\n${items.map((m) => `<li><a href="${esc(m.link)}">${esc(cleanLine(m.title))}</a>${m.funder ? ` (${esc(cleanLine(m.funder))})` : ""}<br>${esc(detail(m))}</li>`).join("\n")}\n</ol>`;
  return frame("new_matches", f, `${plural(n, "new funding match", "new funding matches")} for ${ws}`, intro, [text.join("\n\n")], html, f.note);
}

// ------------------------------------------------------------------------------------ deadlines

export interface DigestDeadline {
  /** YYYY-MM-DD. */
  date: string;
  /** e.g. "Application due", "Letter of inquiry due", "Report due". */
  label: string;
  title: string;
  funder: string | null;
  link: string;
}

export interface DeadlinesFields extends DigestFrame {
  items: DigestDeadline[];
  /** YYYY-MM-DD, the day the email is written. */
  today: string;
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const relative = (days: number) => (days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`);

export function deadlinesDigestEmail(f: DeadlinesFields): DigestEmail {
  if (!f.items.length) throw new Error("A digest with nothing new is not sent");
  const items = [...f.items].sort((a, b) => a.date.localeCompare(b.date));
  for (const d of items) assertLink(d.link);
  const ws = cleanLine(f.workspace);
  const shown = items.slice(0, MAX_DEADLINE_LINES);
  const more = items.length - shown.length;
  const line = (d: DigestDeadline) => `${cleanLine(d.date)} (${relative(daysBetween(f.today, d.date))}): ${cleanLine(d.label)}, ${cleanLine(d.title)}${d.funder ? ` (${cleanLine(d.funder)})` : ""}`;
  const intro = `${items.length === 1 ? "One deadline is" : `${items.length} deadlines are`} coming up for ${ws} in the next ${DEADLINE_DIGEST_DAYS / 7} weeks.`;
  const text = [...shown.map((d) => `- ${line(d)}\n  ${d.link}`), ...(more > 0 ? [`… and ${more} more`] : [])].join("\n");
  const html = `<ul>\n${shown.map((d) => `<li><a href="${esc(d.link)}">${esc(line(d))}</a></li>`).join("\n")}${more > 0 ? `\n<li>… and ${more} more</li>` : ""}\n</ul>`;
  return frame("deadlines", f, `${plural(items.length, "deadline", "deadlines")} in the next ${DEADLINE_DIGEST_DAYS / 7} weeks: ${ws}`, intro, [text], html);
}

// ------------------------------------------------------------------------------------ funder activity

export interface FunderActivityCounts {
  /** Applications submitted in the last 7 days. */
  newApplications: number;
  /** Reviews not yet submitted that are due in the next 7 days or already late. */
  reviewsDue: number;
  /** Payments due or ready, or scheduled for the next 7 days. */
  paymentsDue: number;
  /** Reports from grantees that are overdue. */
  reportsOverdue: number;
}

export interface FunderActivityFields extends DigestFrame {
  counts: FunderActivityCounts;
  /** The GMS screen for each count. */
  links: Record<keyof FunderActivityCounts, string>;
}

const ACTIVITY: { key: keyof FunderActivityCounts; one: string; many: string; open: string }[] = [
  { key: "newApplications", one: "new application", many: "new applications", open: "Open applications" },
  { key: "reviewsDue", one: "review due", many: "reviews due", open: "Open review assignments" },
  { key: "paymentsDue", one: "payment due", many: "payments due", open: "Open payments due" },
  { key: "reportsOverdue", one: "report overdue", many: "reports overdue", open: "Open reporting" },
];

/** Counts and links only: no applicant, title or answer is ever named. */
export function funderActivityDigestEmail(f: FunderActivityFields): DigestEmail {
  const rows = ACTIVITY.filter((a) => f.counts[a.key] > 0);
  if (!rows.length) throw new Error("A digest with nothing new is not sent");
  for (const a of rows) assertLink(f.links[a.key]);
  const ws = cleanLine(f.workspace);
  const parts = rows.map((a) => plural(f.counts[a.key], a.one, a.many));
  const intro = `Here is what needs your attention at ${ws} this week.`;
  const text = rows.map((a) => `- ${plural(f.counts[a.key], a.one, a.many)}\n  ${a.open}: ${f.links[a.key]}`).join("\n");
  const html = `<ul>\n${rows.map((a) => `<li>${esc(plural(f.counts[a.key], a.one, a.many))}: <a href="${esc(f.links[a.key])}">${esc(a.open)}</a></li>`).join("\n")}\n</ul>`;
  return frame("funder_activity", f, `${ws} this week: ${parts.join(", ")}`, intro, [text], html);
}
