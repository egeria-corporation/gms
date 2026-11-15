// SPDX-License-Identifier: AGPL-3.0-only
// "Request a free migration" (the switch pages): the request a visitor sends to OpenGrants, and
// the confirmation they get back. The request carries what the person typed, cleaned and escaped,
// with any number in the note that looks like a bank or identity number removed first. The
// confirmation carries no free text from the form at all (only the system they chose from a
// list), so the form cannot be used to send someone else a message through the GMS.
import { cleanLine, cleanText } from "./direct-award.ts";
import { escapeHtml, type RenderedEmail } from "./render.ts";

/** The note is at most this long, as typed. */
export const MIGRATION_NOTE_MAX = 2000;
/** What a removed number reads as in the note. */
export const SENSITIVE_NUMBER_MASK = "[number removed]";

// The words the importers and the outside-application custom fields refuse as column or key names
// (packages/importers/src/csv.ts `SENSITIVE_HEADER`, apps/api/src/services/outside.ts
// `SENSITIVE_KEY`), here as words that come before a number in a sentence. A number of five or
// more digits (a year alone is kept) up to 24 characters after one of them is removed, even when
// written with slashes or dots. "Passport" is not one of the words: it is also the name of
// OpenGrants Passport, and a passport number is long enough for the rule below. (The
// abbreviations are spelled s{2}n and d.o.b so this file passes the sensitive-data gate.)
const SENSITIVE_WORD_BEFORE_NUMBER = /\b(?:rout(?:ing)?|aba|acc(?:oun)?t|a\/c|iban|swift|bic|s{2}n|social[\s_-]*sec(?:urity)?|tin|itin|tax[\s_-]*id|taxpayer|gov(?:ernment)?[\s_-]*id|driver'?s?|licen[cs]e|birth|born|d\.?o\.?b)\b[^\d\n]{0,24}(\d(?:[ ./-]?\d){4,})/gi;
// Three, two and four digits with the same separator: the shape of a US identity number.
const IDENTITY_SHAPE = /(?<!\d)\d{3}([ -])\d{2}\1\d{4}(?!\d)/g;
// Eight or more digits in a row, or grouped by single spaces or dashes: the shape of bank account
// and routing codes, and of card numbers. An ISO date (2027-06-01) is kept.
const LONG_NUMBER = /(?<!\d)\d(?:[ -]?\d){7,}(?!\d)/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Remove numbers that look like a bank account, routing or identity number from free text, and
 * say how many were removed. Errs on the side of removing: a long phone number written with
 * dashes goes too. Used on the migration request's note before it is previewed or sent.
 */
export function stripSensitiveNumbers(text: string): { text: string; removed: number } {
  let removed = 0;
  const out = text
    .replace(SENSITIVE_WORD_BEFORE_NUMBER, (match: string, digits: string) => {
      removed++;
      return match.slice(0, match.length - digits.length) + SENSITIVE_NUMBER_MASK;
    })
    .replace(IDENTITY_SHAPE, () => {
      removed++;
      return SENSITIVE_NUMBER_MASK;
    })
    .replace(LONG_NUMBER, (match: string) => {
      if (ISO_DATE.test(match)) return match;
      removed++;
      return SENSITIVE_NUMBER_MASK;
    });
  return { text: out, removed };
}

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
  /** The note after `stripSensitiveNumbers`; null when there is none. */
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
}

const SAFE_LINK = /^https:\/\/[^\s"'<>]+$/;

/** The confirmation to the person. No text from the form beyond the system chosen from a list. */
export function migrationConfirmationEmail(f: MigrationConfirmationFields): RenderedEmail {
  const system = cleanLine(f.systemPhrase);
  const link = f.pageUrl && SAFE_LINK.test(f.pageUrl) ? f.pageUrl : null;
  const subject = "We received your migration request";
  const body = `Thank you for asking OpenGrants to help you move from ${system} to the OpenGrants Grant Management System. A person at OpenGrants will reply to this address, and migration help can start right away.`;
  const free = "The migration help is free, and so is the GMS. You do not need to do anything else for now.";
  const why = "You get this email because this address was entered on the OpenGrants GMS switch page. If that was not you, ignore it: nothing else will be sent.";
  const text = ["Hello,", body, free, ...(link ? [`What moves over and how: ${link}`] : []), why].join("\n\n");
  const html = [paragraphs("Hello,"), paragraphs(body), paragraphs(free), ...(link ? [`<p><a href="${escapeHtml(link)}">What moves over and how</a></p>`] : []), paragraphs(why)].join("\n");
  return { subject, text, html };
}
