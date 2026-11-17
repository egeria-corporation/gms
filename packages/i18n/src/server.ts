// SPDX-License-Identifier: AGPL-3.0-only
// The catalogs the API and jobs Workers read, loaded at once: emails, documents' fixed text, share
// cards and notification titles (`email`), and API error messages (`errors`). A message is needed
// synchronously there. Only these two namespaces: the web app's own (`public`, `shared`,
// `applicant`, `funder`, `extras`) never ship in a server Worker. Never import this from the web app's
// screens: it would put Spanish in every English visitor's download.
import type { Catalog } from "./catalogs.ts";
import { createTranslator, type Translate } from "./translate.ts";
import type { Locale } from "./locales.ts";
import enEmail from "../catalogs/en/email.json";
import enErrors from "../catalogs/en/errors.json";
import esEmail from "../catalogs/es/email.json";
import esErrors from "../catalogs/es/errors.json";

/** The namespaces a server Worker reads. */
export type ServerNamespace = "email" | "errors";

export const SERVER_CATALOGS: Record<Locale, Record<ServerNamespace, Catalog>> = {
  en: { email: enEmail, errors: enErrors },
  es: { email: esEmail, errors: esErrors },
};

/** A translator for one language and server namespace, ready at once. */
export function serverTranslator<N extends ServerNamespace>(locale: Locale, ns: N): Translate<N> {
  return createTranslator(locale, ns, SERVER_CATALOGS[locale][ns], SERVER_CATALOGS.en[ns]);
}
