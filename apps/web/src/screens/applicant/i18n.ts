// SPDX-License-Identifier: AGPL-3.0-only
// The applicant screens' text: the `applicant` catalog (packages/i18n/catalogs/{en,es}/applicant.json,
// docs/i18n.md). `t` reads the page's current language at each call, like `translator("public")`,
// so a file takes it once at the top and uses it in components and helpers alike. The catalog is
// loaded on demand: every screen (and every component shown outside the applicant screens, such as
// the form renderer) calls `useApplicantText()` first, which suspends until the catalog is there.
import { Fragment, createElement, type ReactNode } from "react";
import { createTranslator, loadCatalog, type Key, type Values } from "@gms/i18n";
import { getLocale, useT, type RichValues, type T } from "../../i18n/index.tsx";

type K = Key<"applicant">;

/** An applicant message in the current language: `t("dashboard.title")`, `t.rich("…", { link: (c) => <Link>{c}</Link> })`. */
export const t = ((key: K, values?: Values) => createTranslator(getLocale(), "applicant")(key, values)) as T<"applicant">;
Object.defineProperties(t, {
  rich: {
    value: (key: K, values: RichValues) =>
      createTranslator(getLocale(), "applicant")
        .rich(key, values as Values)
        .map((part, i) => createElement(Fragment, { key: i }, part as ReactNode)),
  },
  locale: { get: getLocale },
});

// Start loading the catalog as soon as a screen that uses it is imported, so it is usually there
// before the first render and nothing waits for it. (A failed load is tried again by the hook.)
void loadCatalog(getLocale(), "applicant").catch(() => undefined);

/** Makes the applicant catalog ready (suspends the screen until it is) and returns its translator. */
export function useApplicantText(): T<"applicant"> {
  return useT("applicant");
}
