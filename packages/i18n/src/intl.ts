// SPDX-License-Identifier: AGPL-3.0-only
// Numbers, money and dates in a language, through `Intl` (never by hand). Dates are calendar dates
// in UTC unless a time zone is given, as the GMS stores deadlines.
import { INTL_LOCALE, type Locale } from "./locales.ts";

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat>(key: string, make: () => T): T {
  let f = cache.get(key) as T | undefined;
  if (!f) cache.set(key, (f = make()));
  return f;
}

/** "1,234" / "1,234" (US Spanish groups the same way). */
export const formatNumber = (locale: Locale, n: number, options: Intl.NumberFormatOptions = {}): string =>
  cached(`n${locale}${JSON.stringify(options)}`, () => new Intl.NumberFormat(INTL_LOCALE[locale], options)).format(n);

/** "$50,000" in both languages; whole units unless `fractionDigits` says otherwise. */
export const formatCurrency = (locale: Locale, amount: number, currency = "USD", fractionDigits = 0): string =>
  cached(`c${locale}${currency}${fractionDigits}`, () => new Intl.NumberFormat(INTL_LOCALE[locale], { style: "currency", currency, minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })).format(amount);

/** A date or date-time from an ISO string (a bare date is read as that day in UTC), a Date, or epoch milliseconds. */
function toTime(value: string | number | Date): number {
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  return Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
}

export type DateStyle = "short" | "medium" | "long";
const DATE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  // "Nov 15, 2026" / "15 de noviembre de 2026" (Spanish spells the month out, below)
  short: { month: "short", day: "numeric", year: "numeric" },
  // "November 15, 2026" / "15 de noviembre de 2026"
  medium: { dateStyle: "long" },
  // "Sunday, November 15, 2026" / "domingo, 15 de noviembre de 2026"
  long: { dateStyle: "full" },
};

// Spanish writes the month in full even in the short style: "15 de noviembre de 2026" reads
// naturally where "15 nov 2026" reads like a form field.
const SHORT_IN_FULL: ReadonlySet<Locale> = new Set(["es"]);

/** A calendar date; null when the value cannot be read. */
export function formatDateIn(locale: Locale, value: string | number | Date, style: DateStyle = "short", timeZone = "UTC"): string | null {
  const t = toTime(value);
  if (Number.isNaN(t)) return null;
  const options = style === "short" && SHORT_IN_FULL.has(locale) ? DATE_OPTIONS.medium : DATE_OPTIONS[style];
  return cached(`d${locale}${style}${timeZone}`, () => new Intl.DateTimeFormat(INTL_LOCALE[locale], { ...options, timeZone })).format(t);
}

/** Any other date or time shape, in the language. */
export const formatDateTimeIn = (locale: Locale, value: string | number | Date, options: Intl.DateTimeFormatOptions): string | null => {
  const t = toTime(value);
  return Number.isNaN(t) ? null : cached(`t${locale}${JSON.stringify(options)}`, () => new Intl.DateTimeFormat(INTL_LOCALE[locale], options)).format(t);
};

/** "Ana, Luis and Marta" / "Ana, Luis y Marta". */
export const formatList = (locale: Locale, items: readonly string[], type: "conjunction" | "disjunction" = "conjunction"): string =>
  new Intl.ListFormat(INTL_LOCALE[locale], { type }).format(items);
