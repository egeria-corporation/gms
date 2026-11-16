// SPDX-License-Identifier: AGPL-3.0-only
// The language an email is written in (docs/i18n.md): its fixed words come from the `email`
// catalog, in the recipient's language, English when none is given. What people wrote (a funder's
// edited template, a title, a message) is never translated. Every catalog is loaded at once here
// (`@gms/i18n/server`): emails are written in Workers, never in the browser.
import { DEFAULT_LOCALE, formatDateIn, type Key, type Locale, type Values } from "@gms/i18n";
import { serverTranslator } from "@gms/i18n/server";
import { escapeHtml } from "./render.ts";

export type { Locale } from "@gms/i18n";

export type EmailKey = Key<"email">;
export type EmailT = ReturnType<typeof emailT>;

/** The `email` catalog's messages in a language. */
export const emailT = (locale: Locale = DEFAULT_LOCALE) => serverTranslator(locale, "email");

/**
 * A calendar date (`YYYY-MM-DD`) as the email's language writes it. English keeps the date as the
 * GMS has always printed it; Spanish spells it out ("15 de noviembre de 2026"). Anything that is
 * not a plain date is left as given.
 */
export function emailDate(locale: Locale, value: string): string {
  if (locale === DEFAULT_LOCALE || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return formatDateIn(locale, value, "medium") ?? value;
}

/** A relative day, for the `{when, select, …}` messages: `days` is always the number to print. */
export function whenOf(days: number): { when: "today" | "tomorrow" | "yesterday" | "future" | "past"; days: number } {
  if (days === 0) return { when: "today", days: 0 };
  if (days === 1) return { when: "tomorrow", days: 1 };
  if (days === -1) return { when: "yesterday", days: 1 };
  return days > 0 ? { when: "future", days } : { when: "past", days: -days };
}

// Private-use characters stand in for HTML while a message is escaped.
const SLOT = (i: number) => `${i}`;

/**
 * A message for the HTML part: every value and the message's own words escaped, then each `html`
 * value put in as markup (a link the template built itself).
 */
export function htmlMessage(t: EmailT, key: EmailKey, values: Values, html: Record<string, string>): string {
  const names = Object.keys(html);
  const text = t(key, { ...values, ...Object.fromEntries(names.map((n, i) => [n, SLOT(i)])) });
  return names.reduce((out, n, i) => out.split(SLOT(i)).join(html[n]!), escapeHtml(text));
}

export { DEFAULT_LOCALE };
