// SPDX-License-Identifier: AGPL-3.0-only
// A notification's title in a language. The REST `title` is the English sentence made from the event
// type, as before; `titleLocalized` (another language) and the digest emails take the same title
// from the email catalog (`notification.title.<event type>`). An event type the catalog does not
// name keeps its English sentence.
import { DEFAULT_LOCALE, type Key, type Locale } from "@gms/i18n";
import { SERVER_CATALOGS, serverTranslator } from "@gms/i18n/server";

/** "application.status.changed" → "Application status changed": the English title of an event type. */
export const sentence = (type: string): string => {
  const s = type.replace(/[._]/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** The title of an event in `locale`, with the name of what it is about when there is one. */
export function notificationTitle(locale: Locale, type: string, subject?: string | null): string {
  const t = serverTranslator(locale, "email");
  const key = `notification.title.${type}`;
  const title = key in SERVER_CATALOGS[locale].email ? t(key as Key<"email">) : locale === DEFAULT_LOCALE ? sentence(type) : notificationTitle(DEFAULT_LOCALE, type);
  return subject ? t("notification.title.withSubject", { title, subject }) : title;
}
