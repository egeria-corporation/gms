// SPDX-License-Identifier: AGPL-3.0-only
// The award kit's portrait card (v1.12.0): a 1080 × 1350 PNG (4:5, the portrait size Instagram and
// LinkedIn show in full) naming both organizations and the program, drawn with the same canvas,
// fonts and theme colours as the 1200 × 627 share card (./card.ts). The amount is drawn only when
// the caller passes it: the kit hides it until the person asks for it. No logo of either
// organization, as on the share cards; the OpenGrants mark and the site's address are drawn as there.
// It runs anywhere the share card does: the share panel draws it in the browser for download.
import { CARD_COLOURS, fit, wrap, type CardAssets, type Tone } from "./card.ts";
import { encodePng } from "./png.ts";
import { Canvas, Path, layoutRun, rgb, runPath, type Rgb } from "./raster.ts";
import type { Font } from "./font.ts";

export const PORTRAIT_WIDTH = 1080;
export const PORTRAIT_HEIGHT = 1350;

export interface PortraitText {
  /** The site's address, beside the OpenGrants mark. */
  site: string;
  /** The line at the top, e.g. "Grant announcement". */
  eyebrow: string;
  /** The funder's public name. */
  funder: string;
  /** The words between the names, in the page's language, e.g. "awarded a grant to". */
  connector: string;
  /** The grantee's public name. */
  recipient: string;
  /** The program line, already worded ("Community Health 2027 program"), or null. */
  program?: string | null;
  /** What the grant funds. */
  detail?: string | null;
  /** Drawn only when given. */
  amount?: string | null;
  /** A label at the bottom, such as the year. */
  status?: { label: string; tone: Tone } | null;
  /** A short line under the address, such as that the funder is not verified. */
  note?: string | null;
}

const C = (token: keyof typeof CARD_COLOURS): Rgb => rgb(CARD_COLOURS[token]);
const TONES: Record<Tone, { bg: Rgb; fg: Rgb; border?: Rgb }> = {
  open: { bg: C("--og-mint-light"), fg: C("--og-teal-dark") },
  upcoming: { bg: C("--og-blue-light"), fg: C("--og-navy-dark") },
  closed: { bg: C("--og-gray-100"), fg: C("--og-gray-800"), border: C("--og-gray-200") },
  neutral: { bg: C("--og-white"), fg: C("--og-gray-800"), border: C("--og-gray-200") },
};

const PAD = 84;
const TEXT_WIDTH = PORTRAIT_WIDTH - 2 * PAD;
const NAME_SIZES: [size: number, lineHeight: number][] = [
  [76, 86],
  [66, 76],
  [56, 66],
];

const width = (fonts: Font[], s: string, size: number) => layoutRun(fonts, s, size).width;

/** Draws the portrait card and encodes it as PNG. */
export async function renderPortraitCard(text: PortraitText, assets: CardAssets): Promise<Uint8Array<ArrayBuffer>> {
  const c = new Canvas(PORTRAIT_WIDTH, PORTRAIT_HEIGHT);
  c.verticalGradient(C("--og-teal-soft"), C("--og-white"));
  c.fillRect(0, PORTRAIT_HEIGHT - 14, PORTRAIT_WIDTH, 14, C("--og-teal"));
  const display = [assets.display, assets.bodyBold, assets.body];
  const body = [assets.body, assets.bodyBold, assets.display];
  const bodyBold = [assets.bodyBold, assets.body, assets.display];
  const draw = (fonts: Font[], s: string, x: number, baseline: number, size: number, colour: Rgb) => {
    const run = layoutRun(fonts, s, size);
    c.fill(runPath(run, x, baseline, size), colour);
    return run.width;
  };

  // The mark and the address.
  let x = PAD;
  if (assets.mark) {
    const h = 56;
    const w = Math.round((h * assets.mark.width) / assets.mark.height);
    c.drawImage(assets.mark, PAD, 70, w, h);
    x += w + 18;
  }
  draw(display, fit(display, text.site, 34, PORTRAIT_WIDTH - PAD - x), x, 110, 34, C("--og-navy-dark"));
  if (text.note) draw(body, fit(body, text.note, 26, TEXT_WIDTH), PAD, 168, 26, C("--og-gray-600"));

  let y = 270;
  draw(bodyBold, fit(bodyBold, text.eyebrow, 40, TEXT_WIDTH), PAD, y, 40, C("--og-teal-dark"));

  // Both names as large as fits: the funder in two lines, the grantee in three.
  const names = (name: string, maxLines: number) => {
    for (const [size, lineHeight] of NAME_SIZES) {
      const w = wrap(display, name, size, TEXT_WIDTH, maxLines);
      if (!w.truncated) return { size, lineHeight, lines: w.lines };
    }
    const [size, lineHeight] = NAME_SIZES[NAME_SIZES.length - 1]!;
    return { size, lineHeight, lines: wrap(display, name, size, TEXT_WIDTH, maxLines).lines };
  };
  const funder = names(text.funder, 2);
  y += 40;
  for (const line of funder.lines) {
    y += funder.lineHeight;
    draw(display, line, PAD, y, funder.size, C("--og-navy-dark"));
  }
  y += 70;
  for (const line of wrap(body, text.connector, 40, TEXT_WIDTH, 2).lines) {
    draw(body, line, PAD, y, 40, C("--og-gray-600"));
    y += 52;
  }
  const recipient = names(text.recipient, 3);
  y -= 10;
  for (const line of recipient.lines) {
    y += recipient.lineHeight;
    draw(display, line, PAD, y, recipient.size, C("--og-navy-dark"));
  }

  if (text.program) {
    y += 84;
    for (const line of wrap(bodyBold, text.program, 40, TEXT_WIDTH, 2).lines) {
      draw(bodyBold, line, PAD, y, 40, C("--og-teal-dark"));
      y += 52;
    }
    y -= 52;
  }
  if (text.detail) {
    y += 76;
    for (const line of wrap(body, text.detail, 36, TEXT_WIDTH, 3).lines) {
      if (y > 1150) break;
      draw(body, line, PAD, y, 36, C("--og-gray-600"));
      y += 48;
    }
  }

  // The bottom row: the amount when asked for, then the label.
  const row = 1250;
  let bx = PAD;
  if (text.amount) bx += draw(display, fit(display, text.amount, 56, TEXT_WIDTH - 300), PAD, row, 56, C("--og-navy-dark")) + 32;
  if (text.status) {
    const [size, padX, ph] = [30, 28, 60];
    const label = fit(bodyBold, text.status.label, size, PORTRAIT_WIDTH - PAD - bx - 2 * padX);
    const pw = width(bodyBold, label, size) + 2 * padX;
    const top = row - 20 - ph / 2;
    const tone = TONES[text.status.tone];
    const pill = (inset: number, colour: Rgb) => {
      const p = new Path();
      p.roundRect(bx + inset, top + inset, pw - 2 * inset, ph - 2 * inset, ph / 2 - inset);
      c.fill(p, colour);
    };
    if (tone.border) pill(0, tone.border);
    pill(tone.border ? 2 : 0, tone.bg);
    draw(bodyBold, label, bx + padX, top + ph / 2 + size * 0.36, size, tone.fg);
  }
  return encodePng(c.data, PORTRAIT_WIDTH, PORTRAIT_HEIGHT);
}
