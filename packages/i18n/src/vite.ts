// SPDX-License-Identifier: AGPL-3.0-only
// The web build's catalog step (Node only, used by apps/web/vite.config.ts). Every message with a
// placeholder, plural or tag is parsed at build time into FormatJS message elements, and the
// browser bundle takes `intl-messageformat` without its parser (about 7 KB gzipped less). Plain
// messages stay as text. The JSON stays JSON, so Vite still splits each catalog into its own chunk.
//
// In a production build the keys are shortened too: every key is given a short id (its place among
// all English keys, in base 36), in the catalogs and in the web app's code alike, so the bundle
// carries "1x" instead of "accountSettings.theAgentLosesAccessTo" twice. This is why a key in code
// is always a string literal: a key built at run time (`step.${name}`) stops the build.
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { parse } from "@formatjs/icu-messageformat-parser";

const CATALOG = /[\\/]packages[\\/]i18n[\\/]catalogs[\\/](en|es)[\\/]([a-z]+)\.json$/;

/** One catalog's JSON with each message that needs formatting replaced by its parsed elements, and each key by its short id when given. */
export function precompileCatalog(json: string, file = "catalog", ids?: ReadonlyMap<string, string>): string {
  const messages = JSON.parse(json) as Record<string, string>;
  const out: Record<string, unknown> = {};
  for (const [name, message] of Object.entries(messages)) {
    const key = ids?.get(name) ?? name;
    if (typeof message !== "string") throw new Error(`${file}: ${name} is not a string`);
    try {
      out[key] = message.includes("{") || message.includes("<") ? parse(message) : message;
    } catch (error) {
      throw new Error(`${file}: ${name} is not a valid ICU message (${(error as Error).message})`);
    }
  }
  return JSON.stringify(out);
}

/** Every English key, in every namespace, with its short id. */
export function keyIds(catalogDir: URL = new URL("../catalogs/en/", import.meta.url)): Map<string, string> {
  const keys = new Set<string>();
  for (const f of readdirSync(catalogDir).filter((n) => n.endsWith(".json")).sort()) for (const k of Object.keys(JSON.parse(readFileSync(new URL(f, catalogDir), "utf8")))) keys.add(k);
  return new Map([...keys].sort().map((k, i) => [k, i.toString(36)]));
}

const KEY_LITERAL = /(["'])([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+)\1/g;
const KEY_TEMPLATE = /`([a-z][A-Za-z0-9]*\.[A-Za-z0-9_.]*)\$\{/g;

/** The web app's code with each catalog key (a string literal) replaced by its short id. A key built from a template stops the build. */
export function shortenKeys(code: string, ids: ReadonlyMap<string, string>, file = "module"): string {
  for (const m of code.matchAll(KEY_TEMPLATE)) {
    const head = m[1]!;
    for (const k of ids.keys()) if (k.startsWith(head)) throw new Error(`${file}: the catalog key \`${head}\${…}\` is built at run time; write each key as a string literal (docs/i18n.md)`);
  }
  return code.replace(KEY_LITERAL, (all, quote: string, key: string) => {
    const id = ids.get(key);
    return id === undefined ? all : `${quote}${id}${quote}`;
  });
}

interface ChunkInfo {
  facadeModuleId?: string | null;
  moduleIds?: readonly string[];
}

interface CatalogPlugin {
  name: string;
  enforce: "pre";
  config(user: unknown, env: { command: string }): {
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

/** Files of the web app whose catalog keys are shortened in a build. */
const WEB_SOURCE = /[\\/]apps[\\/]web[\\/]src[\\/].*\.(ts|tsx)$/;

/** The Vite plugin: precompiled catalogs, the parser-free formatter, and short keys in a build. */
export function i18nCatalogs(opts: { shortKeys?: boolean } = {}): CatalogPlugin {
  let ids: Map<string, string> | undefined;
  // Resolved from intl-messageformat's own location, the copy the bundle actually uses.
  const fromHere = createRequire(import.meta.url);
  const formatterEntry = fromHere.resolve("intl-messageformat");
  const noParser = createRequire(formatterEntry).resolve("@formatjs/icu-messageformat-parser/no-parser.js");
  return {
    name: "gms-i18n-catalogs",
    enforce: "pre",
    config: (_user, env) => {
      if (env.command === "build" && opts.shortKeys !== false) ids = keyIds();
      return {
        resolve: { alias: [{ find: /^@formatjs\/icu-messageformat-parser$/, replacement: noParser }] },
        build: { rolldownOptions: { output: { chunkFileNames: chunkFileName } } },
      };
    },
    transform(code, id) {
      const file = id.split("?")[0]!;
      if (CATALOG.test(file)) return { code: precompileCatalog(code, file, ids), map: null };
      if (ids && WEB_SOURCE.test(file) && !file.includes("node_modules")) return { code: shortenKeys(code, ids, file), map: null };
      return null;
    },
  };
}
