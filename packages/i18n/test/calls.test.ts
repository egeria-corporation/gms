// SPDX-License-Identifier: AGPL-3.0-only
// Every message the web app shows is given the values it uses: a `t("key", { … })` call (or a
// conditional choice of keys) names each placeholder, plural, select and tag of the key's English
// message. A missing one would show the raw message and log an error at run time.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TYPE, parse, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { NAMESPACES } from "../src/index.ts";
import { ALL_CATALOGS } from "../src/all.ts";

const src = fileURLToPath(new URL("../../../apps/web/src", import.meta.url));
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : /\.tsx?$/.test(n) ? [join(dir, n)] : []));

function used(elements: MessageFormatElement[], out = new Set<string>()): Set<string> {
  for (const e of elements) {
    if (e.type === TYPE.argument || e.type === TYPE.number || e.type === TYPE.date || e.type === TYPE.time) out.add(e.value);
    else if (e.type === TYPE.plural || e.type === TYPE.select) {
      out.add(e.value);
      for (const o of Object.values(e.options)) used(o.value, out);
    } else if (e.type === TYPE.tag) {
      out.add(e.value);
      used(e.children, out);
    }
  }
  return out;
}

const message = (key: string): string | undefined => {
  for (const ns of NAMESPACES) {
    const m = ALL_CATALOGS.en[ns][key];
    if (typeof m === "string") return m;
  }
  return undefined;
};
/** The values each key's message uses, parsed once per key (a key is called from many places). */
const usesOf = new Map<string, string[]>();
const uses = (key: string, msg: string): string[] => {
  let u = usesOf.get(key);
  if (!u) usesOf.set(key, (u = [...used(parse(msg))]));
  return u;
};
/**
 * What makes this test slow, and how slow: it parses every web source file that calls the catalog
 * with the TypeScript parser (217 files of apps/web/src at v1.12.0, about 0.8 s of parsing on an
 * idle 4-core machine, 1.2 s for the whole test), and that grows with the app. Under load it ran
 * near vitest's 5 s default, so it has a limit sized to that work.
 */
const PARSE_EVERY_SCREEN_MS = 30_000;
const keysOf = (e: ts.Expression | undefined): string[] => (!e ? [] : ts.isStringLiteral(e) ? [e.text] : ts.isConditionalExpression(e) ? [...keysOf(e.whenTrue), ...keysOf(e.whenFalse)] : ts.isParenthesizedExpression(e) ? keysOf(e.expression) : []);

describe("calls to the catalog", () => {
  it("give every message the values it uses", () => {
    const problems: string[] = [];
    for (const file of files(src)) {
      const text = readFileSync(file, "utf8");
      if (!/\b(t|tr|s|m|translate)(\.rich)?\(/.test(text)) continue;
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n) && n.arguments.length) {
          // `translate(ns, key, values)` names its namespace first.
          const translateCall = n.expression.getText(sf) === "translate";
          const keyArg = translateCall ? n.arguments[1] : n.arguments[0];
          for (const key of keysOf(keyArg)) {
            const msg = message(key);
            if (msg === undefined) continue;
            const obj = n.arguments.slice(translateCall ? 2 : 1).find(ts.isObjectLiteralExpression);
            if (obj?.properties.some(ts.isSpreadAssignment)) continue;
            const given = new Set(obj?.properties.map((p) => p.name?.getText(sf)) ?? []);
            const missing = uses(key, msg).filter((a) => !given.has(a));
            if (missing.length) problems.push(`${file.slice(src.length + 1)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} ${key} needs ${missing.join(", ")}`);
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(problems).toEqual([]);
  }, PARSE_EVERY_SCREEN_MS);
});
