// SPDX-License-Identifier: AGPL-3.0-only
// The language a request asks in (docs/i18n.md): `?lang=`, then the `gms_lang` cookie the web app's
// switcher sets on this site, then `Accept-Language`, then English. The signed-in person's saved
// preference is copied into the cookie by the web app, so it is not read again here.
import { chooseLocale, cookieValue, LOCALE_COOKIE, LOCALE_QUERY, type Locale } from "@gms/i18n";

export interface LocaleRequest {
  url: string;
  header(name: string): string | undefined;
}

export function requestLocale(req: LocaleRequest): Locale {
  let query: string | null = null;
  try {
    query = new URL(req.url).searchParams.get(LOCALE_QUERY);
  } catch {
    query = null;
  }
  return chooseLocale({ query, cookie: cookieValue(req.header("cookie"), LOCALE_COOKIE), acceptLanguage: req.header("accept-language") ?? null });
}
