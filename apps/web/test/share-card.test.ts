// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// The share card renderer: size and dimensions, the theme's colours, text that fits, and the
// bundled fonts read correctly.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CARD_COLOURS, CARD_HEIGHT, CARD_WIDTH, fit, loadCardAssets, renderCard, wrap, type CardAssets } from "../src/edge/og/card.ts";
import { Font } from "../src/edge/og/font.ts";
import { decodePng, pngSize } from "../src/edge/og/png.ts";
import { rgb } from "../src/edge/og/raster.ts";

const pub = (p: string) => fileURLToPath(new URL(`../public${p}`, import.meta.url));
const read = (p: string) => {
  try {
    return new Uint8Array(readFileSync(pub(p)));
  } catch {
    return null;
  }
};
const MAX_BYTES = 600 * 1024;

let assets: CardAssets | null = null;
const load = async () => (assets ??= await loadCardAssets(read));

/** The colour at (x, y) of a decoded card. */
const at = (img: { width: number; pixels: Uint8Array }, x: number, y: number) => {
  const i = (y * img.width + x) * 4;
  return [img.pixels[i]!, img.pixels[i + 1]!, img.pixels[i + 2]!];
};
const near = (a: number[], b: readonly number[], tolerance = 3) => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);
/** Pixels in a box that are much darker than the background: drawn text. */
const inked = (img: { width: number; pixels: Uint8Array }, x0: number, y0: number, x1: number, y1: number) => {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (at(img, x, y).reduce((s, v) => s + v, 0) < 300) n++;
  return n;
};

describe("share card", () => {
  it("is a 1200x627 PNG under 600 KB, in the theme's colours, with the text drawn", async () => {
    const png = await renderCard(
      {
        site: "gms.opengrants.io",
        eyebrow: "Riverbend Community Foundation",
        title: "Community Health Grants 2027: navigation, outreach and care coordination in Riverbend County",
        amount: "$50,000 – $150,000",
        status: { label: "Apply by Apr 30, 2027", tone: "open" },
        note: "Not verified with OpenGrants Passport",
      },
      await load(),
    );
    expect(pngSize(png)).toEqual({ width: CARD_WIDTH, height: CARD_HEIGHT });
    expect(png.length).toBeLessThan(MAX_BYTES);
    const img = await decodePng(png);
    expect(img.width).toBe(1200);
    // The teal bar along the bottom, the soft teal at the top, white towards the bottom.
    expect(near(at(img, 600, 622), rgb(CARD_COLOURS["--og-teal"]))).toBe(true);
    expect(near(at(img, 1190, 2), rgb(CARD_COLOURS["--og-teal-soft"]))).toBe(true);
    expect(near(at(img, 1190, 600), rgb(CARD_COLOURS["--og-white"]), 6)).toBe(true);
    // The title, in navy, across its lines; the amount on the bottom row.
    expect(inked(img, 72, 200, 1128, 420)).toBeGreaterThan(20_000);
    expect(inked(img, 72, 510, 500, 575)).toBeGreaterThan(2_000);
    // The mark's icon top left: not background.
    expect(near(at(img, 100, 73), rgb(CARD_COLOURS["--og-teal-soft"]), 20)).toBe(false);
  });

  it("draws a funder card and a card with almost nothing on it", async () => {
    const a = await load();
    for (const text of [
      { site: "gms.opengrants.io", eyebrow: "Grants from", title: "Riverbend Community Foundation", detail: "We fund community-led health, housing and education work across Riverbend County.".repeat(4), status: { label: "2 open calls", tone: "open" as const } },
      { site: "grants.example.org", eyebrow: "", title: "" },
      { site: "gms.opengrants.io", eyebrow: "😀\u202e\u0007", title: "Fonds für Gesundheit — Ñandú 中文", status: { label: "Closed", tone: "closed" as const } },
    ]) {
      const png = await renderCard(text, a);
      expect(pngSize(png)).toEqual({ width: 1200, height: 627 });
      expect(png.length).toBeLessThan(MAX_BYTES);
    }
  });

  it("wraps a long title into its lines and ends the last one with an ellipsis", async () => {
    const { display } = await load();
    const long = "Community Health Grants for navigation outreach and care coordination ".repeat(6);
    const w = wrap([display], long, 68, 1056, 3);
    expect(w.lines).toHaveLength(3);
    expect(w.truncated).toBe(true);
    expect(w.lines[2]!.endsWith("\u2026")).toBe(true);
    expect(wrap([display], "Short title", 68, 1056, 3)).toEqual({ lines: ["Short title"], truncated: false });
    // One word wider than the line is cut too.
    expect(fit([display], "W".repeat(80), 68, 400).endsWith("\u2026")).toBe(true);
  });

  it("reads the bundled fonts: character map, advances and composite glyphs", () => {
    for (const file of ["/fonts/Ubuntu-Bold.ttf", "/fonts/Lato-Regular.ttf", "/fonts/Lato-Bold.ttf"]) {
      const font = new Font(read(file)!);
      expect(font.unitsPerEm).toBeGreaterThan(0);
      for (const ch of "AZaz09$–…é") {
        const g = font.glyph(ch.codePointAt(0)!);
        expect(g, `${file} ${ch}`).toBeGreaterThan(0);
        expect(font.advance(g)).toBeGreaterThan(0);
        expect(font.contours(g).length, `${file} ${ch}`).toBeGreaterThan(0);
      }
      expect(font.contours(font.glyph(32))).toEqual([]);
      expect(font.glyph(0x1f600)).toBe(0);
    }
  });

  it("uses the theme's colours exactly as the stylesheet defines them", () => {
    const tokens = readFileSync(fileURLToPath(new URL("../src/theme/tokens.css", import.meta.url)), "utf8");
    for (const [name, hex] of Object.entries(CARD_COLOURS)) {
      const m = tokens.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`));
      expect(m?.[1]?.toUpperCase(), name).toBe(hex);
    }
  });
});
