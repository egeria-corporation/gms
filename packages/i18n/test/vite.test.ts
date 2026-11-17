// SPDX-License-Identifier: AGPL-3.0-only
import { parseAst } from "rolldown/parseAst";
import { describe, expect, it } from "vitest";
import { chunkFileName, i18nCatalogs, keyIds, precompileCatalog, shortenKeys, type ParseModule } from "../src/vite.ts";

// The same parser the build uses (Rolldown's `this.parse`).
const parse: ParseModule = (code, file) => parseAst(code, { lang: file.endsWith(".tsx") ? "tsx" : "ts" });
const pluginContext = { parse: (code: string, options: { lang: "ts" | "tsx" }) => parseAst(code, options) };

describe("the web build's catalog step", () => {
  it("parses only the messages that need formatting", () => {
    const out = JSON.parse(precompileCatalog(JSON.stringify({ "a.plain": "Save", "a.var": "Hi {name}", "a.tag": "<b>Bold</b>" })));
    expect(out["a.plain"]).toBe("Save");
    expect(Array.isArray(out["a.var"])).toBe(true);
    expect(Array.isArray(out["a.tag"])).toBe(true);
  });

  it("stops the build on a message that is not valid ICU, naming it", () => {
    expect(() => precompileCatalog(JSON.stringify({ "a.bad": "Hi {name" }), "es/public.json")).toThrow(/es\/public\.json: a\.bad/);
  });

  it("names each catalog chunk by language and namespace", () => {
    expect(chunkFileName({ facadeModuleId: "/r/packages/i18n/catalogs/es/public.json" })).toBe("assets/i18n-es-public-[hash].js");
    expect(chunkFileName({ facadeModuleId: "/r/apps/web/src/screens/public/Landing.tsx" })).toBe("assets/[name]-[hash].js");
  });

  it("transforms catalogs only, and swaps in the parser-free formatter", () => {
    const plugin = i18nCatalogs();
    expect(plugin.transform.call(pluginContext, '{"a.b":"x"}', "/r/apps/web/src/data.json")).toBeNull();
    expect(plugin.transform.call(pluginContext, '{"a.b":"{n}"}', "/r/packages/i18n/catalogs/en/shared.json")?.code).toContain('"type"');
    expect(plugin.config({}, { command: "serve" }).resolve.alias[0]!.replacement).toMatch(/no-parser\.js$/);
  });

  it("shortens keys in a build, the same in the catalog and in the code", () => {
    const ids = new Map([["signIn.title", "a"], ["signIn.sent", "b"]]);
    expect(JSON.parse(precompileCatalog(JSON.stringify({ "signIn.title": "Sign in", "signIn.sent": "Sent to {email}" }), "en/public.json", ids))).toEqual({ a: "Sign in", b: expect.any(Array) });
    expect(shortenKeys('t("signIn.title"); t(\'signIn.sent\', { email }); x("other.key");', ids, "a.ts", parse)).toBe('t("a"); t(\'b\', { email }); x("other.key");');
    expect(() => shortenKeys("t(`signIn.${which}`)", ids, "SignIn.tsx", parse)).toThrow(/SignIn\.tsx: the catalog key `signIn\.\$\{…\}` is built at run time/);
    // Every English key has an id, and no two keys share one.
    const all = keyIds();
    expect(new Set(all.values()).size).toBe(all.size);
    const plugin = i18nCatalogs();
    plugin.config({}, { command: "build" });
    expect(plugin.transform.call(pluginContext, 'const a = t("app.skipLink");', "/r/apps/web/src/app/App.tsx")?.code).toBe(`const a = t("${all.get("app.skipLink")}");`);
    // The Workers' namespaces are empty in the web build and give no keys to shorten.
    expect(plugin.transform.call(pluginContext, '{"letter.decline.subject":"An update"}', "/r/packages/i18n/catalogs/en/email.json")?.code).toBe("{}");
    expect(plugin.transform.call(pluginContext, '{"code.not_found":"Not found"}', "/r/packages/i18n/catalogs/es/errors.json")?.code).toBe("{}");
    expect(all.has("letter.decline.subject")).toBe(false);
  });

  it("looks for run-time keys only in a translation call's arguments", () => {
    const ids = new Map([["signIn.title", "a"], ["applications.title", "b"], ["stages.heading", "c"]]);
    // Not translation calls: a downloaded file's name and a form field's path keep their shape.
    expect(shortenKeys("file(`/x/export.${format}`, `applications.${format}`);", ids, "outside.ts", parse)).toBe("file(`/x/export.${format}`, `applications.${format}`);");
    expect(shortenKeys("const bad = problemFor(err, `stages.${i}.label`); const n = `signIn.${x}`;", ids, "Competition.tsx", parse)).toContain("`stages.${i}.label`");
    expect(shortenKeys('const a = <p>{t("signIn.title")}</p>;', ids, "A.tsx", parse)).toBe('const a = <p>{t("a")}</p>;');
    // In a translation call, each way of building a key at run time stops the build.
    for (const code of [
      "t(`applications.${x}`)",
      "t.rich(`stages.${x}`, {})",
      "tr(ok ? `signIn.${x}` : \"signIn.title\")",
      "s(`signIn.${x}` as Key<\"shared\">)",
      "translate(\"shared\", \"signIn.\" + x)",
      "m(locale, `signIn.${x}`)",
    ]) expect(() => shortenKeys(code, ids, "x.tsx", parse), code).toThrow(/is built at run time/);
    // A template whose start is not a key's start is not a key.
    expect(() => shortenKeys("t(`${x}.title`)", ids, "x.tsx", parse)).not.toThrow();
  });
});
