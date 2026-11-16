// SPDX-License-Identifier: AGPL-3.0-only
// The funder and reviewer screens' messages: the `funder` namespace (docs/i18n.md). One translator
// for every function in these files, components and helpers alike, like `translator("public")`:
// it reads the page's language at each call (the routes remount on a change), and while the
// namespace is still loading it suspends the screen, as `useT("funder")` does (routes render inside
// Suspense). Keys stay string literals: the web build shortens them.
import { Fragment, createElement, use, type ReactNode } from "react";
import { createTranslator, loadCatalog, peekCatalog, type Key, type Translate, type Values } from "@gms/i18n";
import { getLocale } from "../../i18n/current.ts";
import type { RichValues, T } from "../../i18n/index.tsx";

/** The translator for the current language, once its catalog (and the English fallback) is here. */
function current(): Translate<"funder"> {
  const locale = getLocale();
  if (!peekCatalog(locale, "funder") || !peekCatalog("en", "funder")) use(loadCatalog(locale, "funder"));
  return createTranslator(locale, "funder");
}

/** `t("applications.title")`, `t("x.count", { count })`, `t.rich("x.link", { link: (c) => <Link …>{c}</Link> })`. */
export const t = ((key: Key<"funder">, values?: Values) => current()(key, values)) as T<"funder">;
Object.defineProperties(t, {
  rich: {
    value: (key: Key<"funder">, values: RichValues) =>
      current()
        .rich(key, values as Values)
        .map((part, i) => createElement(Fragment, { key: i }, part as ReactNode)),
  },
  locale: { get: getLocale },
});
