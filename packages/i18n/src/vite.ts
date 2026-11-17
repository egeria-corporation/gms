// SPDX-License-Identifier: AGPL-3.0-only
// The web build's catalog step (Node only, used by apps/web/vite.config.ts). Every message with a
// placeholder, plural or tag is parsed at build time into FormatJS message elements, and the
// browser bundle takes `intl-messageformat` without its parser (about 7 KB gzipped less). Plain
// messages stay as text. The JSON stays JSON, so Vite still splits each catalog into its own chunk.
//
// In a production build the keys are shortened too: every key is given a short id (its place among
// all English keys, in base 36), in the catalogs and in the web app's code alike, so the bundle
// carries "1x" instead of "accountSettings.theAgentLosesAccessTo" twice. This is why a key in code
// is always a string literal: a key built at run time in a translation call (`t(`step.${name}`)`)
// stops the build. Only the translation calls' arguments are inspected for that.
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { parse } from "@formatjs/icu-messageformat-parser";

const CATALOG = /[\\/]packages[\\/]i18n[\\/]catalogs[\\/](en|es)[\\/]([a-z]+)\.json$/;

/**
 * Namespaces only Workers read (`@gms/i18n/server`): emails, documents' fixed text, share cards and
 * API errors. In the web build each is an empty catalog with no short ids, so an English visitor's
 * download carries none of their text and their keys never meet the web app's code.
 */
export const SERVER_ONLY_NAMESPACES: readonly string[] = ["email", "errors"];

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
  for (const f of readdirSync(catalogDir).filter((n) => n.endsWith(".json") && !SERVER_ONLY_NAMESPACES.includes(n.slice(0, -5))).sort()) for (const k of Object.keys(JSON.parse(readFileSync(new URL(f, catalogDir), "utf8")))) keys.add(k);
  return new Map([...keys].sort().map((k, i) => [k, i.toString(36)]));
}

const KEY_LITERAL = /(["'])([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+)\1/g;
const KEY_HEAD = /^[a-z][A-Za-z0-9]*\.[A-Za-z0-9_.]*$/;

/**
 * The names the web app gives its translators: `const t = useT(…)` or `translator(…)`, the screens'
 * own `t` (screens/funder/i18n.ts, screens/applicant/i18n.ts), `tr` and `s` beside a second
 * namespace, `translate(ns, key)` and the front Worker's `m(locale, key)`. `.rich` calls count too.
 */
export const TRANSLATION_CALLS: ReadonlySet<string> = new Set(["t", "tr", "s", "m", "translate"]);

/** An ESTree node, as `this.parse` (Rolldown) or `parseAst` gives it. */
interface Node {
  type: string;
  [field: string]: unknown;
}
/** Parses one module of the web app into ESTree. */
export type ParseModule = (code: string, file: string) => unknown;

const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null && typeof (value as Node).type === "string";
const nameOf = (node: unknown): string | undefined => (isNode(node) && node.type === "Identifier" ? (node.name as string) : undefined);

/** Is this call a translation, `t(…)` or `t.rich(…)`? */
function isTranslation(call: Node): boolean {
  const callee = call.callee as Node;
  const name = nameOf(callee) ?? (callee.type === "MemberExpression" && nameOf(callee.property) === "rich" ? nameOf(callee.object) : undefined);
  return name !== undefined && TRANSLATION_CALLS.has(name);
}

/** The fixed start of each key an argument builds at run time: `` `step.${x}` `` and `"step." + x` give "step.". */
function* runTimeHeads(arg: unknown): Generator<string> {
  if (!isNode(arg)) return;
  switch (arg.type) {
    case "TemplateLiteral":
      if ((arg.expressions as unknown[]).length) yield ((arg.quasis as Node[])[0]!.value as { cooked?: string; raw: string }).cooked ?? "";
      return;
    case "BinaryExpression":
      if (arg.operator === "+") {
        const left = arg.left as Node;
        if (left.type === "Literal" && typeof left.value === "string") yield left.value;
        else yield* runTimeHeads(left);
      }
      return;
    case "ConditionalExpression":
      yield* runTimeHeads(arg.consequent);
      yield* runTimeHeads(arg.alternate);
      return;
    case "LogicalExpression":
      yield* runTimeHeads(arg.left);
      yield* runTimeHeads(arg.right);
      return;
    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "TSTypeAssertion":
      yield* runTimeHeads(arg.expression);
      return;
    default:
      return;
  }
}

/** Every call in the module that translates, wherever it sits. */
function* translationCalls(node: unknown): Generator<Node> {
  if (Array.isArray(node)) {
    for (const item of node) yield* translationCalls(item);
    return;
  }
  if (!isNode(node)) return;
  if (node.type === "CallExpression" && isTranslation(node)) yield node;
  for (const [field, value] of Object.entries(node)) if (field !== "type" && typeof value === "object" && value !== null) yield* translationCalls(value);
}

/**
 * The web app's code with each catalog key (a string literal) replaced by its short id. A key built at
 * run time in a translation call's arguments stops the build; a template literal anywhere else (a
 * file name such as `applications.${format}`, a field path such as `stages.${i}.label`) is not a key
 * and is left alone.
 */
export function shortenKeys(code: string, ids: ReadonlyMap<string, string>, file: string, parse: ParseModule): string {
  if (code.includes("${") || code.includes("+")) {
    for (const call of translationCalls(parse(code, file))) {
      for (const head of (call.arguments as unknown[]).flatMap((arg) => [...runTimeHeads(arg)])) {
        if (!KEY_HEAD.test(head)) continue;
        for (const k of ids.keys()) if (k.startsWith(head)) throw new Error(`${file}: the catalog key \`${head}\${…}\` is built at run time; write each key as a string literal (docs/i18n.md)`);
      }
    }
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
    json: { stringify: boolean; namedExports: boolean };
    build: { rolldownOptions: { output: { chunkFileNames: (chunk: ChunkInfo) => string; codeSplitting: { groups: { name: (id: string) => string | null; debugName: string; test: RegExp }[] } } } };
  };
  transform(this: { parse(code: string, options: { lang: "ts" | "tsx" }): unknown }, code: string, id: string): { code: string; map: null } | null;
}

/** Each catalog is a chunk of its own, also one the first page imports (English `shared`), named by language and namespace. */
export function catalogChunk(id: string): string | null {
  const m = CATALOG.exec(id.split("?")[0]!);
  return m ? `i18n-${m[1]}-${m[2]}` : null;
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
        // A catalog becomes `JSON.parse("…")`: smaller than a named export per message, and quicker to load.
        json: { stringify: true, namedExports: false },
        build: { rolldownOptions: { output: { chunkFileNames: chunkFileName, codeSplitting: { groups: [{ name: catalogChunk, debugName: "i18n catalogs", test: CATALOG }] } } } },
      };
    },
    transform(code, id) {
      const file = id.split("?")[0]!;
      const catalog = CATALOG.exec(file);
      if (catalog) return { code: SERVER_ONLY_NAMESPACES.includes(catalog[2]!) ? "{}" : precompileCatalog(code, file, ids), map: null };
      if (ids && WEB_SOURCE.test(file) && !file.includes("node_modules")) {
        const parse: ParseModule = (source, name) => this.parse(source, { lang: name.endsWith(".tsx") ? "tsx" : "ts" });
        return { code: shortenKeys(code, ids, file, parse), map: null };
      }
      return null;
    },
  };
}
