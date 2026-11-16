// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { chunkFileName, i18nCatalogs, keyIds, precompileCatalog, shortenKeys } from "../src/vite.ts";

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
    expect(plugin.transform('{"a.b":"x"}', "/r/apps/web/src/data.json")).toBeNull();
    expect(plugin.transform('{"a.b":"{n}"}', "/r/packages/i18n/catalogs/en/shared.json")?.code).toContain('"type"');
    expect(plugin.config({}, { command: "serve" }).resolve.alias[0]!.replacement).toMatch(/no-parser\.js$/);
  });

  it("shortens keys in a build, the same in the catalog and in the code", () => {
    const ids = new Map([["signIn.title", "a"], ["signIn.sent", "b"]]);
    expect(JSON.parse(precompileCatalog(JSON.stringify({ "signIn.title": "Sign in", "signIn.sent": "Sent to {email}" }), "en/public.json", ids))).toEqual({ a: "Sign in", b: expect.any(Array) });
    expect(shortenKeys('t("signIn.title"); t(\'signIn.sent\', { email }); x("other.key");', ids)).toBe('t("a"); t(\'b\', { email }); x("other.key");');
    expect(() => shortenKeys("t(`signIn.${which}`)", ids, "SignIn.tsx")).toThrow(/SignIn\.tsx: the catalog key `signIn\.\$\{…\}` is built at run time/);
    // Every English key has an id, and no two keys share one.
    const all = keyIds();
    expect(new Set(all.values()).size).toBe(all.size);
    const plugin = i18nCatalogs();
    plugin.config({}, { command: "build" });
    expect(plugin.transform('t("app.skipLink")', "/r/apps/web/src/app/App.tsx")?.code).toBe(`t("${all.get("app.skipLink")}")`);
  });
});
