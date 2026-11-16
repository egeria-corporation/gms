// SPDX-License-Identifier: AGPL-3.0-only
// "Request a free migration" (the switch pages): the request a visitor sends to OpenGrants, and
// the confirmation they get back. The request carries what the person typed, cleaned and escaped,
// with any number in the note that looks like a bank or identity number removed first. The
// confirmation carries no free text from the form at all (only the system they chose from a
// list), so the form cannot be used to send someone else a message through the GMS.
import { cleanLine, cleanText } from "./direct-award.ts";
import { DEFAULT_LOCALE, emailT, type Locale } from "./i18n.ts";
import { escapeHtml, type RenderedEmail } from "./render.ts";

/** The note is at most this long, as typed. */
export const MIGRATION_NOTE_MAX = 2000;
// The note is cleaned before it reaches these templates: numbers that look like a bank or identity
// number are removed by `stripSensitiveNumbers` in packages/importers/src/sensitive.ts, the same
// words and shapes the importers screen columns with.

/** The request as the person confirmed it: every value already a label or cleaned text. */
export interface MigrationRequestContent {
  name: string;
  email: string;
  organization: string;
  /** The system's name as the form lists it, e.g. "Submittable". */
  system: string;
  /** "1", "2 to 5" … as the form lists them. */
  programs: string;
  pastAwards: string;
  timing: string;
  /** The note after `stripSensitiveNumbers` (@gms/importers); null when there is none. */
  note: string | null;
  /** How many numbers were removed from the note. */
  numbersRemoved: number;
}

const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");

/** The request email to OpenGrants: exactly the preview the person saw. */
export function migrationRequestEmail(c: MigrationRequestContent): RenderedEmail {
  const name = cleanLine(c.name);
  const org = cleanLine(c.organization);
  const system = cleanLine(c.system);
  const subject = cleanLine(`Migration request: ${org} (from ${system})`);
  const intro = `${org} asks for a free migration to the OpenGrants Grant Management System. Reply to this email to reach ${name}.`;
  const facts = [
    `Name: ${name}`,
    `Work email: ${cleanLine(c.email)}`,
    `Organization: ${org}`,
    `Current system: ${system}`,
    `Programs: ${cleanLine(c.programs)}`,
    `Past awards: ${cleanLine(c.pastAwards)}`,
    `Hoping to move: ${cleanLine(c.timing)}`,
  ];
  const note = c.note ? cleanText(c.note) : "";
  const removed = c.numbersRemoved > 0 ? `${c.numbersRemoved} number${c.numbersRemoved === 1 ? "" : "s"} that looked like a bank or identity number ${c.numbersRemoved === 1 ? "was" : "were"} removed from the note before it was sent.` : "";
  const outro = "Sent from the switch pages of OpenGrants GMS.";
  const text = [intro, facts.join("\n"), note ? `Note:\n${note}` : "No note.", ...(removed ? [removed] : []), outro].join("\n\n");
  const html = [paragraphs(intro), `<p>${facts.map(escapeHtml).join("<br>")}</p>`, note ? `<p><strong>Note</strong></p>${paragraphs(note)}` : paragraphs("No note."), ...(removed ? [paragraphs(removed)] : []), paragraphs(outro)].join("\n");
  return { subject, text, html };
}

export interface MigrationConfirmationFields {
  /** How the system reads in a sentence, from the form's list: "Submittable", "spreadsheets or Airtable", "your current system". */
  systemPhrase: string;
  /** The switch page for that system on this GMS; left out unless it is an https URL. */
  pageUrl: string | null;
  /** The language the person asked in (English when absent); `systemPhrase` must already be in it. */
  locale?: Locale;
}

/** How "spreadsheets" and "your current system" read in a language; the other systems are names. */
export const migrationSystemPhrase = (phrase: string, locale: Locale = DEFAULT_LOCALE): string =>
  phrase === "spreadsheets" ? emailT(locale)("migration.phrase.spreadsheets") : phrase === "your current system" ? emailT(locale)("migration.phrase.other") : phrase;

const SAFE_LINK = /^https:\/\/[^\s"'<>]+$/;

/** The confirmation to the person. No text from the form beyond the system chosen from a list. */
export function migrationConfirmationEmail(f: MigrationConfirmationFields): RenderedEmail {
  const system = cleanLine(f.systemPhrase);
  const link = f.pageUrl && SAFE_LINK.test(f.pageUrl) ? f.pageUrl : null;
  const t = emailT(f.locale ?? DEFAULT_LOCALE);
  const subject = t("migration.subject");
  const body = t("migration.body", { system });
  const free = t("migration.free");
  const why = t("migration.why");
  const hello = t("common.hello");
  const moves = t("migration.link");
  const text = [hello, body, free, ...(link ? [`${moves}: ${link}`] : []), why].join("\n\n");
  const html = [paragraphs(hello), paragraphs(body), paragraphs(free), ...(link ? [`<p><a href="${escapeHtml(link)}">${escapeHtml(moves)}</a></p>`] : []), paragraphs(why)].join("\n");
  return { subject, text, html };
}
