// SPDX-License-Identifier: AGPL-3.0-only
// The languages the GMS speaks, and how a request's language is chosen. Shared by the web app (the
// browser), the front Worker (page meta) and the API (emails), so all three pick the same language
// from the same inputs. See docs/i18n.md.

export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** The cookie that remembers a visitor's choice (signed in or not), and the query parameter that sets it for one page. */
export const LOCALE_COOKIE = "gms_lang";
export const LOCALE_QUERY = "lang";
/** A year: the choice is a convenience, not a secret, and is renewed each time the person switches. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The locale passed to `Intl` for numbers, money and dates. US Spanish: dollars read "$50,000" and
 * dates "15 de noviembre de 2026", which suits nonprofits in the US and reads naturally in Latin America.
 */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-US", es: "es-US" };

/** The name of each language in itself, for the switcher. Spanish is marked beta until a native speaker has reviewed the catalog. */
export const LANGUAGE_NAMES: Record<Locale, string> = { en: "English", es: "Español (beta)" };

export const isLocale = (value: unknown): value is Locale => typeof value === "string" && (LOCALES as readonly string[]).includes(value);

/** "es-MX" → "es", "EN" → "en"; null for a language the GMS does not speak. */
export function localeFromTag(tag: string | null | undefined): Locale | null {
  const primary = tag?.trim().split(/[-_]/)[0]?.toLowerCase();
  return isLocale(primary) ? primary : null;
}

/**
 * The best supported language in an `Accept-Language` header: the highest `q` wins, ties keep the
 * header's order, `q=0` and `*` are ignored. Null when the header names nothing the GMS speaks.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q === undefined ? 1 : Number(q.slice(2));
      return { locale: localeFromTag(tag), weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((r): r is { locale: Locale; weight: number; index: number } => r.locale !== null && r.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  return ranked[0]?.locale ?? null;
}

/** The first supported language in a browser's `navigator.languages` (already in the person's order). */
export function localeFromLanguages(languages: readonly string[] | null | undefined): Locale | null {
  for (const tag of languages ?? []) {
    const locale = localeFromTag(tag);
    if (locale) return locale;
  }
  return null;
}

/** One cookie's value from a `Cookie` header or `document.cookie`. */
export function cookieValue(cookies: string | null | undefined, name: string): string | null {
  for (const part of (cookies ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export interface LocaleInputs {
  /** A signed-in person's saved preference (null when they never chose). */
  preference?: string | null;
  /** `?lang=` on the address. */
  query?: string | null;
  /** The `gms_lang` cookie. */
  cookie?: string | null;
  /** The request's `Accept-Language` header (servers). */
  acceptLanguage?: string | null;
  /** `navigator.languages` (the browser's equivalent of the header). */
  languages?: readonly string[] | null;
}

/**
 * The language to show, in this order: a signed-in person's saved preference; then `?lang=`; then
 * the cookie; then the browser's languages (`Accept-Language`); then English. A value the GMS does
 * not speak is skipped, never an error.
 */
export function chooseLocale(inputs: LocaleInputs): Locale {
  if (isLocale(inputs.preference)) return inputs.preference;
  const query = localeFromTag(inputs.query);
  if (query) return query;
  if (isLocale(inputs.cookie)) return inputs.cookie;
  return localeFromAcceptLanguage(inputs.acceptLanguage) ?? localeFromLanguages(inputs.languages) ?? DEFAULT_LOCALE;
}

/** The `Set-Cookie` / `document.cookie` value that remembers a choice on this device. */
export function localeCookie(locale: Locale, opts: { secure?: boolean } = {}): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${opts.secure ? "; Secure" : ""}`;
}
