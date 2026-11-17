// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// The English bundle against v1.10.0, before internationalization (build/bundle-baseline.json):
//   - the first page grows by less than 40 KB gzipped;
//   - each area's catalog (public, shared, applicant, funder, extras) is a chunk of its own, loaded only with
//     that area's screens (shared is the app shell's, so it comes with the first page);
//   - everything an English visitor can download grows by less than 60 KB gzipped (the screens' text
//     moved into the catalogs, so this is the framework plus what the catalogs add).
// An English visitor downloads nothing for Spanish.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { measureBundle, type BundleSize } from "../build/bundle-size.ts";
import baseline from "../build/bundle-baseline.json";
import enPublic from "@gms/i18n/catalogs/en/public.json";
import enShared from "@gms/i18n/catalogs/en/shared.json";
import enApplicant from "@gms/i18n/catalogs/en/applicant.json";
import enFunder from "@gms/i18n/catalogs/en/funder.json";
import enExtras from "@gms/i18n/catalogs/en/extras.json";

/** The first page alone (the entry and what index.html preloads). */
export const FIRST_PAGE_BUDGET_BYTES = 40 * 1024;
/** Everything an English visitor can download (every screen's chunk). */
export const BUDGET_BYTES = 60 * 1024;
/** The areas whose catalogs are each a chunk of their own (`extras`: the parts both kinds use that no first page needs, v1.12.0). */
const AREAS = { public: enPublic, shared: enShared, applicant: enApplicant, funder: enFunder, extras: enExtras } as const;
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
  const assets = () => readdirSync(join(outDir, "assets")).filter((f) => f.endsWith(".js"));
  const read = (f: string) => readFileSync(join(outDir, "assets", f), "utf8");
  const html = () => readFileSync(join(outDir, "index.html"), "utf8");
  /** A few of a catalog's longer plain messages, as they appear in a chunk. */
  const samples = (catalog: Record<string, string>) =>
    Object.values(catalog)
      .filter((v) => v.length > 40 && /^[A-Za-z ,.]+$/.test(v))
      .slice(0, 12);

  it("grew by less than 40 KB gzipped on the first page, and by less than 60 KB over every screen", () => {
    expect(size.initial - baseline.initial).toBeLessThan(FIRST_PAGE_BUDGET_BYTES);
    expect(size.total - baseline.total).toBeLessThan(BUDGET_BYTES);
  });

  it("puts each area's catalog in a chunk of its own, loaded only with that area's screens", () => {
    const page = html();
    for (const [area, catalog] of Object.entries(AREAS)) {
      const own = assets().filter((f) => f.startsWith(`i18n-en-${area}-`));
      expect(own, area).toHaveLength(1);
      const chunk = own[0]!;
      // Its messages are in its chunk and in no other.
      const words = samples(catalog);
      expect(words.length, area).toBeGreaterThan(3);
      for (const w of words) expect(read(chunk), `${area}: ${w}`).toContain(w);
      for (const f of assets().filter((x) => x !== chunk && !x.startsWith("i18n-es-"))) for (const w of words) expect(read(f).includes(w), `${area} message in ${f}: ${w}`).toBe(false);
      const imported = assets().filter((f) => new RegExp(`from"\\./${chunk.replace(/[.-]/g, "\\$&")}"`).test(read(f)));
      if (area === "shared") {
        // The app shell's own words: preloaded with the first page.
        expect(page).toContain(chunk);
      } else {
        // Loaded on demand, never with the first page, and no chunk imports it outright.
        expect(page, area).not.toContain(chunk);
        expect(imported, area).toEqual([]);
      }
    }
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
