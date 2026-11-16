// SPDX-License-Identifier: AGPL-3.0-only
// The funder and reviewer screens' messages: the `funder` namespace (docs/i18n.md). One translator
// for every function in these files, components and helpers alike, like `translator("public")`:
// it reads the page's language at each call (the routes remount on a change).
//
// Loading: every screen a route renders from these files, and every component another screen
// borrows (SettingsNav), calls `useFunderMessages()` first. That suspends the screen until the
// namespace is here (routes render inside Suspense), so nothing below it, render or the queries it
// starts, ever runs without the catalog. `t` itself never suspends: it is also called from event
// handlers and from query callbacks after an await, where React's `use` must not run.
import { Fragment, createElement, type ReactNode } from "react";
import { createTranslator, loadCatalog, peekCatalog, type Key, type Translate, type Values } from "@gms/i18n";
import { getLocale } from "../../i18n/current.ts";
import { useT, type RichValues, type T } from "../../i18n/index.tsx";

/** Call first in a funder route's component: suspends until the `funder` catalog is loaded. */
export function useFunderMessages(): void {
  useT("funder");
}

/** The translator for the current language. Should the catalog be missing (a screen that skipped `useFunderMessages`), it starts loading and the English (or the key) shows meanwhile. */
function current(): Translate<"funder"> {
  const locale = getLocale();
  if (!peekCatalog(locale, "funder") || !peekCatalog("en", "funder")) void loadCatalog(locale, "funder").catch(() => undefined);
  return createTranslator(locale, "funder");
}

/** `t("funderApplications.applications3")`, `t("x.count", { count })`, `t.rich("x.link", { link: (c) => <Link …>{c}</Link> })`. */
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
