// SPDX-License-Identifier: AGPL-3.0-only
// The web app's language: one current locale for the page, the hook screens translate with, and
// the switch. Catalogs live in packages/i18n; docs/i18n.md says how to add and use a message.
import { Fragment, createElement, use, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_QUERY, chooseLocale, cookieValue, createTranslator, loadCatalog, localeCookie, peekCatalog, type Key, type Locale, type Namespace, type Values } from "@gms/i18n";
import { getLocale, subscribeLocale } from "./current.ts";

export type { Key, Locale, Namespace, Values } from "@gms/i18n";
export { LANGUAGE_NAMES, LOCALES, isLocale } from "@gms/i18n";
export { changeLocale, getLocale, intlLocale, translate } from "./current.ts";

/** The language this browser starts in: `?lang=`, then the cookie, then the browser's languages (a saved preference is applied once the person is known). */
export function initialLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  return chooseLocale({
    query: new URLSearchParams(window.location.search).get(LOCALE_QUERY),
    cookie: cookieValue(document.cookie, LOCALE_COOKIE),
    languages: navigator.languages,
  });
}

/** Remember the language on this device (signed in or not). */
export function rememberLocale(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.cookie = localeCookie(locale, { secure: window.location.protocol === "https:" });
}

/** The current language; the component re-renders when it changes. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

/** Placeholder values; a tag's function gets the tag's contents and returns what to show. */
export type RichValues = Record<string, string | number | bigint | boolean | Date | null | undefined | ReactNode | ((chunks: ReactNode[]) => ReactNode)>;

export interface T<N extends Namespace> {
  /** The message as text. Every string with a variable is one message with a placeholder: never concatenate. */
  (key: Key<N>, values?: Values): string;
  /** The message with elements: `t.rich("terms", { link: (chunks) => <Link to="/terms">{chunks}</Link> })`. */
  rich(key: Key<N>, values: RichValues): ReactNode;
  readonly locale: Locale;
}

function bind<N extends Namespace>(locale: Locale, ns: N): T<N> {
  const translate = createTranslator(locale, ns);
  const t = ((key: Key<N>, values?: Values) => translate(key, values)) as T<N>;
  Object.defineProperties(t, {
    rich: {
      value: (key: Key<N>, values: RichValues) => translate.rich(key, values as Values).map((part, i) => createElement(Fragment, { key: i }, part as ReactNode)),
    },
    locale: { value: locale },
  });
  return t;
}

/**
 * The translator for one namespace: `const t = useT("public"); t("signIn.title")`. Keys are typed
 * from the English catalog. A namespace not loaded yet suspends the screen until it is (the routes
 * already render inside Suspense); `public` and `shared` are always loaded.
 */
export function useT<N extends Namespace>(ns: N): T<N> {
  const locale = useLocale();
  const catalog = peekCatalog(locale, ns) ?? use(loadCatalog(locale, ns));
  // The catalog is a dependency so the translator is rebuilt once a namespace arrives.
  return useMemo(() => bind(locale, ns), [locale, ns, catalog]);
}

/**
 * Call first in a screen that shows a public screen's part (a card, a label, a message) outside the
 * public routes: suspends until the `public` catalog is loaded, as the public routes do.
 */
export function usePublicMessages(): void {
  useT("public");
}

/**
 * A translator for module scope, for `public` and `shared` (loaded before any screen that reads them renders): it reads the current
 * language at each call, so `const t = translator("public")` at the top of a file is safe in any
 * function there. Screens redraw on a language change because the routes remount (app/App.tsx).
 * Never call it while a module loads (a label table built once would stay in one language): build
 * such tables in a function, or use getters.
 */
export function translator<N extends "public" | "shared">(ns: N): T<N> {
  const t = ((key: Key<N>, values?: Values) => createTranslator(getLocale(), ns)(key, values)) as T<N>;
  Object.defineProperties(t, {
    rich: { value: (key: Key<N>, values: RichValues) => bind(getLocale(), ns).rich(key, values) },
    locale: { get: getLocale },
  });
  return t;
}
