// SPDX-License-Identifier: AGPL-3.0-only
// Every catalog of every language, loaded at once: for the catalog checks and other tests. No
// Worker or screen imports this (the Workers read `./server.ts`, the web app loads on demand).
import type { Catalog, Namespace } from "./catalogs.ts";
import type { Locale } from "./locales.ts";
import enPublic from "../catalogs/en/public.json";
import enShared from "../catalogs/en/shared.json";
import enApplicant from "../catalogs/en/applicant.json";
import enFunder from "../catalogs/en/funder.json";
import enExtras from "../catalogs/en/extras.json";
import esPublic from "../catalogs/es/public.json";
import esShared from "../catalogs/es/shared.json";
import esApplicant from "../catalogs/es/applicant.json";
import esFunder from "../catalogs/es/funder.json";
import esExtras from "../catalogs/es/extras.json";
import { SERVER_CATALOGS } from "./server.ts";

export const ALL_CATALOGS: Record<Locale, Record<Namespace, Catalog>> = {
  en: { public: enPublic, shared: enShared, applicant: enApplicant, funder: enFunder, extras: enExtras, ...SERVER_CATALOGS.en },
  es: { public: esPublic, shared: esShared, applicant: esApplicant, funder: esFunder, extras: esExtras, ...SERVER_CATALOGS.es },
};
