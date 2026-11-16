// SPDX-License-Identifier: AGPL-3.0-only
// The page's current language, without React: lib/ formatters and the front Worker read it here.
// The Worker serves many requests from one module, so it never sets this: it passes the request's
// language to each formatter instead (edge/meta.ts).
import { DEFAULT_LOCALE, INTL_LOCALE, createTranslator, loadCatalogs, loadedNamespaces, type Key, type Locale, type Namespace, type Values } from "@gms/i18n";

let current: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();

export const getLocale = (): Locale => current;

/** The tag to hand `Intl` (`"en-US"`, `"es-US"`), for code that formats with `Intl` itself. */
export const intlLocale = (locale: Locale = current): string => INTL_LOCALE[locale];

export const subscribeLocale = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * Show the page in a language: loads its catalogs (the namespaces already in use, plus `public` and
 * `shared`), then switches every screen at once and sets `<html lang>`. English needs no download.
 */
export async function changeLocale(locale: Locale): Promise<void> {
  const namespaces = Array.from(new Set<Namespace>(["public", "shared", ...loadedNamespaces(current)]));
  await loadCatalogs(locale, namespaces);
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  if (locale === current) return;
  current = locale;
  for (const listener of listeners) listener();
}

/**
 * Outside a component (a label table, a formatter in lib/): the message in the current language,
 * or in `locale` when given (the front Worker, after loading that language's catalogs). Only for
 * `public` and `shared`, which are always loaded. Screens remount on a language change
 * (app/App.tsx), so a value computed here is never stale on screen.
 */
export function translate<N extends "public" | "shared">(ns: N, key: Key<N>, values?: Values, locale: Locale = current): string {
  return createTranslator(locale, ns)(key, values);
}
