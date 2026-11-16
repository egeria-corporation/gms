// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { chunkFileName, i18nCatalogs, precompileCatalog } from "../src/vite.ts";

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
    expect(plugin.config().resolve.alias[0]!.replacement).toMatch(/no-parser\.js$/);
  });
});
