// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// An English visitor downloads nothing for Spanish, and the English bundle grew by less than 15 KB
// gzipped with the language framework and its catalogs (build/bundle-baseline.json).
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { measureBundle, type BundleSize } from "../build/bundle-size.ts";
import baseline from "../build/bundle-baseline.json";

/** Everything an English visitor can download (every screen's chunk): the brief's budget. */
export const BUDGET_BYTES = 15 * 1024;
/**
 * The first page alone: the English `public` and `shared` catalogs ship with it (text that used to
 * sit in each screen's own chunk), so it grows more than the whole; held here so it cannot creep.
 */
export const FIRST_PAGE_BUDGET_BYTES = 40 * 1024;
const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), "gms-web-size-"));
let size: BundleSize;

beforeAll(async () => {
  // A production build, as deployed: under vitest NODE_ENV is "test", which would build React's development code.
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await build({ root, mode: "production", configFile: join(root, "vite.config.ts"), logLevel: "error", build: { outDir, emptyOutDir: true } });
  } finally {
    process.env.NODE_ENV = nodeEnv;
  }
  size = measureBundle(outDir, (file) => file.startsWith("i18n-es-"));
}, 120_000);
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

describe("the English bundle", () => {
  it("grew by less than 15 KB gzipped over every screen, and the first page stays under its own budget", () => {
    expect(size.total - baseline.total).toBeLessThan(BUDGET_BYTES);
    expect(size.initial - baseline.initial).toBeLessThan(FIRST_PAGE_BUDGET_BYTES);
  });

  it("puts every Spanish catalog in its own chunk, loaded only on demand", () => {
    expect(size.spanish.length).toBeGreaterThanOrEqual(6);
    const html = readFileSync(join(outDir, "index.html"), "utf8");
    for (const chunk of size.spanish) expect(html).not.toContain(chunk);
    // No English chunk carries a Spanish message.
    const english = readdirSync(join(outDir, "assets")).filter((f) => f.endsWith(".js") && !f.startsWith("i18n-es-"));
    for (const f of english) expect(readFileSync(join(outDir, "assets", f), "utf8")).not.toContain("Saltar al contenido principal");
  });

  it("does not ship the message parser", () => {
    const js = readdirSync(join(outDir, "assets")).filter((f) => f.endsWith(".js"));
    for (const f of js) expect(readFileSync(join(outDir, "assets", f), "utf8")).not.toContain("EXPECT_ARGUMENT_CLOSING_BRACE");
  });
});
