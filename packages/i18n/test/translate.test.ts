// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from "vitest";
import { createTranslator, formatCurrency, formatDateIn, formatList, formatMessage, formatNumber, formatParts, loadCatalog, peekCatalog, type Catalog } from "../src/index.ts";
import { precompileCatalog } from "../src/vite.ts";

const en: Catalog = {
  hello: "Hello, {name}",
  days: "{count, plural, one {# day left} other {# days left}}",
  terms: "Read the <link>terms</link> first",
  plain: "Save",
  onlyEnglish: "Not translated yet",
};
const es: Catalog = {
  hello: "Hola, {name}",
  days: "{count, plural, one {Queda # día} other {Quedan # días}}",
  terms: "Lea primero los <link>términos</link>",
  plain: "Guardar",
};

describe("messages", () => {
  // The namespace argument only types keys; these catalogs are passed in directly.
  const tEn = createTranslator("en", "shared", en, en) as unknown as (key: string, values?: Record<string, unknown>) => string;
  const tEs = createTranslator("es", "shared", es, en) as unknown as ((key: string, values?: Record<string, unknown>) => string) & { rich: (key: string, values: Record<string, unknown>) => unknown[] };

  it("fill placeholders", () => {
    expect(tEn("hello", { name: "Ana" })).toBe("Hello, Ana");
    expect(tEs("hello", { name: "Ana" })).toBe("Hola, Ana");
  });

  it("use each language's plural rules, with numbers in the language", () => {
    expect(tEn("days", { count: 1 })).toBe("1 day left");
    expect(tEn("days", { count: 1200 })).toBe("1,200 days left");
    expect(tEs("days", { count: 1 })).toBe("Queda 1 día");
    expect(tEs("days", { count: 0 })).toBe("Quedan 0 días");
    // Spanish has a "many" category for millions; a message without it uses "other".
    expect(tEs("days", { count: 1_000_000 })).toBe("Quedan 1,000,000 días");
  });

  it("render tags through functions (rich text)", () => {
    expect(tEs.rich("terms", { link: (chunks: unknown[]) => ({ a: chunks }) })).toEqual(["Lea primero los ", { a: ["términos"] }]);
  });

  it("fall back to English for a key a language does not have yet, and show an unknown key as itself", () => {
    expect(tEs("onlyEnglish")).toBe("Not translated yet");
    expect(tEs("nope")).toBe("nope");
  });

  it("never throw at the person when a value is missing", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(tEn("hello")).toBe("Hello, {name}");
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it("format the same from a precompiled catalog (the web build) as from text (the Workers)", () => {
    const compiled = JSON.parse(precompileCatalog(JSON.stringify(es))) as Catalog;
    expect(compiled.plain).toBe("Guardar");
    expect(Array.isArray(compiled.days)).toBe(true);
    for (const count of [0, 1, 2, 5_000]) expect(formatMessage("es", "days", compiled.days!, { count })).toBe(formatMessage("es", "days", es.days!, { count }));
    expect(formatParts("es", "terms", compiled.terms!, { link: (c: unknown[]) => c.join("") })).toEqual(["Lea primero los términos"]);
  });
});

describe("catalog loading", () => {
  it("has English shared from the start and loads the rest, English public included, on demand", async () => {
    expect(peekCatalog("en", "shared")).toBeDefined();
    expect(peekCatalog("en", "public")).toBeUndefined();
    await loadCatalog("en", "public");
    expect(peekCatalog("en", "public")).toBeDefined();
    expect(peekCatalog("es", "shared")).toBeUndefined();
    const p1 = loadCatalog("es", "shared");
    expect(loadCatalog("es", "shared")).toBe(p1);
    await p1;
    expect(peekCatalog("es", "shared")).toBeDefined();
  });
});

describe("numbers, money and dates", () => {
  it("follow the language", () => {
    expect(formatCurrency("en", 50000)).toBe("$50,000");
    expect(formatCurrency("es", 50000)).toBe("$50,000");
    expect(formatCurrency("es", 1234.5, "USD", 2)).toBe("$1,234.50");
    expect(formatNumber("es", 1234567)).toBe("1,234,567");
    expect(formatDateIn("en", "2026-11-15", "medium")).toBe("November 15, 2026");
    expect(formatDateIn("es", "2026-11-15", "medium")).toBe("15 de noviembre de 2026");
    expect(formatDateIn("es", "2026-11-15")).toBe("15 de noviembre de 2026");
    expect(formatDateIn("es", "not a date")).toBeNull();
    expect(formatList("es", ["Ana", "Luis", "Marta"])).toBe("Ana, Luis y Marta");
  });
});
