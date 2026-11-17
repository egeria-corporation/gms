// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// The award kit's portrait card (v1.12.0): a 1080 × 1350 PNG in the theme's colours, with both
// names and the program drawn, and the amount only when it is asked for.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CARD_COLOURS, loadCardAssets, type CardAssets } from "../src/edge/og/card.ts";
import { decodePng, pngSize } from "../src/edge/og/png.ts";
import { PORTRAIT_HEIGHT, PORTRAIT_WIDTH, renderPortraitCard, type PortraitText } from "../src/edge/og/portrait.ts";
import { rgb } from "../src/edge/og/raster.ts";

const pub = (p: string) => fileURLToPath(new URL(`../public${p}`, import.meta.url));
const read = (p: string) => {
  try {
    return new Uint8Array(readFileSync(pub(p)));
  } catch {
    return null;
  }
};
let assets: CardAssets | null = null;
const load = async () => (assets ??= await loadCardAssets(read));

const at = (img: { width: number; pixels: Uint8Array }, x: number, y: number) => {
  const i = (y * img.width + x) * 4;
  return [img.pixels[i]!, img.pixels[i + 1]!, img.pixels[i + 2]!];
};
const near = (a: number[], b: readonly number[], tolerance = 3) => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);
const inked = (img: { width: number; pixels: Uint8Array }, x0: number, y0: number, x1: number, y1: number) => {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (at(img, x, y).reduce((s, v) => s + v, 0) < 300) n++;
  return n;
};

const TEXT: PortraitText = {
  site: "gms.opengrants.io",
  eyebrow: "Grant announcement",
  funder: "Riverbend Community Foundation",
  connector: "awarded a grant to",
  recipient: "Alder Creek Family Services",
  program: "Community Health 2027 program",
  detail: "Mobile Health Navigation for Rural Families",
  status: { label: "Awarded in 2027", tone: "neutral" },
};

describe("portrait card", () => {
  it("is a 1080 × 1350 PNG in the theme's colours, with both names drawn", async () => {
    const png = await renderPortraitCard(TEXT, await load());
    if (process.env.PORTRAIT_OUT) writeFileSync(process.env.PORTRAIT_OUT, png);
    expect(pngSize(png)).toEqual({ width: PORTRAIT_WIDTH, height: PORTRAIT_HEIGHT });
    expect(png.length).toBeLessThan(900 * 1024);
    const img = await decodePng(png);
    expect(near(at(img, 540, 1345), rgb(CARD_COLOURS["--og-teal"]))).toBe(true);
    expect(near(at(img, 1070, 4), rgb(CARD_COLOURS["--og-teal-soft"]))).toBe(true);
    // The funder's name and the grantee's name, in navy.
    expect(inked(img, 84, 320, 1000, 500)).toBeGreaterThan(4000);
    expect(inked(img, 84, 580, 1000, 800)).toBeGreaterThan(4000);
  });

  it("draws no amount unless it is given", async () => {
    const without = await decodePng(await renderPortraitCard(TEXT, await load()));
    const withAmount = await decodePng(await renderPortraitCard({ ...TEXT, amount: "$150,000" }, await load()));
    const row = (img: typeof without) => inked(img, 84, 1190, 400, 1270);
    expect(row(withAmount)).toBeGreaterThan(row(without) + 1000);
  });
});
