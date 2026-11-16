// SPDX-License-Identifier: AGPL-3.0-only
// The web build's catalog step (Node only, used by apps/web/vite.config.ts). Every message with a
// placeholder, plural or tag is parsed at build time into FormatJS message elements, and the
// browser bundle takes `intl-messageformat` without its parser (about 7 KB gzipped less). Plain
// messages stay as text. The JSON stays JSON, so Vite still splits each catalog into its own chunk.
import { createRequire } from "node:module";
import { parse } from "@formatjs/icu-messageformat-parser";

const CATALOG = /[\\/]packages[\\/]i18n[\\/]catalogs[\\/](en|es)[\\/]([a-z]+)\.json$/;

/** One catalog's JSON with each message that needs formatting replaced by its parsed elements. */
export function precompileCatalog(json: string, file = "catalog"): string {
  const messages = JSON.parse(json) as Record<string, string>;
  const out: Record<string, unknown> = {};
  for (const [key, message] of Object.entries(messages)) {
    if (typeof message !== "string") throw new Error(`${file}: ${key} is not a string`);
    try {
      out[key] = message.includes("{") || message.includes("<") ? parse(message) : message;
    } catch (error) {
      throw new Error(`${file}: ${key} is not a valid ICU message (${(error as Error).message})`);
    }
  }
  return JSON.stringify(out);
}

interface ChunkInfo {
  facadeModuleId?: string | null;
  moduleIds?: readonly string[];
}

interface CatalogPlugin {
  name: string;
  enforce: "pre";
  config(): {
    resolve: { alias: { find: RegExp; replacement: string }[] };
    build: { rolldownOptions: { output: { chunkFileNames: (chunk: ChunkInfo) => string } } };
  };
  transform(code: string, id: string): { code: string; map: null } | null;
}

/** `assets/i18n-es-public-<hash>.js` for a catalog chunk, so a reader (and the bundle-size test) can tell a language's chunks apart. */
export function chunkFileName(chunk: ChunkInfo): string {
  const id = chunk.facadeModuleId ?? (chunk.moduleIds?.length === 1 ? chunk.moduleIds[0] : undefined);
  const m = id ? CATALOG.exec(id.split("?")[0]!) : null;
  return m ? `assets/i18n-${m[1]}-${m[2]}-[hash].js` : "assets/[name]-[hash].js";
}

/** The Vite plugin: precompiled catalogs, and the parser-free formatter. */
export function i18nCatalogs(): CatalogPlugin {
  // Resolved from intl-messageformat's own location, the copy the bundle actually uses.
  const fromHere = createRequire(import.meta.url);
  const formatterEntry = fromHere.resolve("intl-messageformat");
  const noParser = createRequire(formatterEntry).resolve("@formatjs/icu-messageformat-parser/no-parser.js");
  return {
    name: "gms-i18n-catalogs",
    enforce: "pre",
    config: () => ({
      resolve: { alias: [{ find: /^@formatjs\/icu-messageformat-parser$/, replacement: noParser }] },
      build: { rolldownOptions: { output: { chunkFileNames: chunkFileName } } },
    }),
    transform(code, id) {
      const file = id.split("?")[0]!;
      return CATALOG.test(file) ? { code: precompileCatalog(code, file), map: null } : null;
    },
  };
}
