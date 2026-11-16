// SPDX-License-Identifier: AGPL-3.0-only
// The message catalogs: one JSON file per language and namespace under ../catalogs. English is the
// source; its keys are the type of every key (a missing key is a type error), and the Spanish files
// must hold the same keys (test/catalogs.test.ts). The English `shared` namespace ships with the
// web app's first page, in a chunk of its own; every other catalog, `public` and all of Spanish
// included, is a chunk of its own loaded on demand, with the screens of its area.
import type { MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import type { Locale } from "./locales.ts";
import type enPublic from "../catalogs/en/public.json";
import enShared from "../catalogs/en/shared.json";
import type enApplicant from "../catalogs/en/applicant.json";
import type enFunder from "../catalogs/en/funder.json";
import type enEmail from "../catalogs/en/email.json";
import type enErrors from "../catalogs/en/errors.json";

export const NAMESPACES = ["public", "shared", "applicant", "funder", "email", "errors"] as const;
export type Namespace = (typeof NAMESPACES)[number];

/** The English source of each namespace: the shape every other language follows. */
export interface Catalogs {
  public: typeof enPublic;
  shared: typeof enShared;
  applicant: typeof enApplicant;
  funder: typeof enFunder;
  email: typeof enEmail;
  errors: typeof enErrors;
}

/** A key of a namespace. Keys are flat, dotted by screen or component: `signIn.title`. */
export type Key<N extends Namespace> = Extract<keyof Catalogs[N], string>;

/**
 * An ICU message as written in the catalog, or as the web build precompiles it (src/vite.ts): an
 * array of message elements, so the browser never ships the message parser.
 */
export type Message = string | MessageFormatElement[];
export type Catalog = Readonly<Record<string, Message>>;

type Loader = () => Promise<{ default: Catalog }>;

// Literal paths, one per file: bundlers split each into its own chunk.
const LOADERS: Record<Locale, Record<Namespace, Loader>> = {
  en: {
    public: () => import("../catalogs/en/public.json"),
    shared: () => Promise.resolve({ default: enShared }),
    applicant: () => import("../catalogs/en/applicant.json"),
    funder: () => import("../catalogs/en/funder.json"),
    email: () => import("../catalogs/en/email.json"),
    errors: () => import("../catalogs/en/errors.json"),
  },
  es: {
    public: () => import("../catalogs/es/public.json"),
    shared: () => import("../catalogs/es/shared.json"),
    applicant: () => import("../catalogs/es/applicant.json"),
    funder: () => import("../catalogs/es/funder.json"),
    email: () => import("../catalogs/es/email.json"),
    errors: () => import("../catalogs/es/errors.json"),
  },
};

const slot = (locale: Locale, ns: Namespace) => `${locale}:${ns}`;
const loaded = new Map<string, Catalog>([[slot("en", "shared"), enShared]]);
const pending = new Map<string, Promise<Catalog>>();

/** The catalog when it is already loaded; undefined otherwise (never starts a load). */
export function peekCatalog(locale: Locale, ns: Namespace): Catalog | undefined {
  return loaded.get(slot(locale, ns));
}

/**
 * Loads one catalog (once: the same promise every call, which is what React's `use` needs). A
 * Spanish catalog also loads its English one, the fallback for any key not yet translated.
 */
export function loadCatalog(locale: Locale, ns: Namespace): Promise<Catalog> {
  const id = slot(locale, ns);
  const ready = loaded.get(id);
  if (ready && (locale === "en" || loaded.has(slot("en", ns)))) return pending.get(id) ?? Promise.resolve(ready);
  let promise = pending.get(id);
  if (!promise) {
    promise = Promise.all([LOADERS[locale][ns](), locale === "en" ? null : loadCatalog("en", ns)]).then(([mod]) => {
      loaded.set(id, mod.default);
      return mod.default;
    });
    pending.set(id, promise);
    // A failed load (offline) may be tried again.
    promise.catch(() => pending.delete(id));
  }
  return promise;
}

/** Loads several namespaces of one language. */
export const loadCatalogs = (locale: Locale, namespaces: readonly Namespace[] = NAMESPACES): Promise<Catalog[]> =>
  Promise.all(namespaces.map((ns) => loadCatalog(locale, ns)));

/** The namespaces already loaded for a language (the web app loads the same ones when the language changes). */
export const loadedNamespaces = (locale: Locale): Namespace[] => NAMESPACES.filter((ns) => loaded.has(slot(locale, ns)));
