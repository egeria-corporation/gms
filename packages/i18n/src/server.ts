// SPDX-License-Identifier: AGPL-3.0-only
// Every catalog, loaded at once: for the Workers (API, jobs, the front Worker), where a message is
// needed synchronously and the bundle's size does not reach a person's browser. Never import this
// from the web app's screens: it would put the Spanish catalogs in every English visitor's download.
import type { Catalog, Namespace } from "./catalogs.ts";
import { createTranslator, type Translate } from "./translate.ts";
import type { Locale } from "./locales.ts";
import enPublic from "../catalogs/en/public.json";
import enShared from "../catalogs/en/shared.json";
import enApplicant from "../catalogs/en/applicant.json";
import enFunder from "../catalogs/en/funder.json";
import enEmail from "../catalogs/en/email.json";
import enErrors from "../catalogs/en/errors.json";
import esPublic from "../catalogs/es/public.json";
import esShared from "../catalogs/es/shared.json";
import esApplicant from "../catalogs/es/applicant.json";
import esFunder from "../catalogs/es/funder.json";
import esEmail from "../catalogs/es/email.json";
import esErrors from "../catalogs/es/errors.json";

export const ALL_CATALOGS: Record<Locale, Record<Namespace, Catalog>> = {
  en: { public: enPublic, shared: enShared, applicant: enApplicant, funder: enFunder, email: enEmail, errors: enErrors },
  es: { public: esPublic, shared: esShared, applicant: esApplicant, funder: esFunder, email: esEmail, errors: esErrors },
};

/** A translator for one language and namespace, ready at once. */
export function serverTranslator<N extends Namespace>(locale: Locale, ns: N): Translate<N> {
  return createTranslator(locale, ns, ALL_CATALOGS[locale][ns], ALL_CATALOGS.en[ns]);
}
