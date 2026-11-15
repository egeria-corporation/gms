// SPDX-License-Identifier: AGPL-3.0-only
// The share card a link preview shows: 1200x627 PNG with the OpenGrants mark and the site's
// address, a line above the title (the funder), the title, an optional line of detail, the amount
// and a status label, in the theme's colours and the bundled Ubuntu and Lato fonts.
import { Font } from "./font.ts";
import { decodePng, encodePng } from "./png.ts";
import { Canvas, Path, cleanText, layoutRun, rgb, runPath, type Rgb, type Rgba } from "./raster.ts";

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 627;

/** Theme colours from apps/web/src/theme/tokens.css (a test holds them to the stylesheet). */
export const CARD_COLOURS = {
  "--og-teal": "#29A79F",
  "--og-navy-dark": "#0D2A43",
  "--og-teal-dark": "#145450",
  "--og-teal-soft": "#E1F8F6",
  "--og-mint-light": "#B3FFEC",
  "--og-blue-light": "#D2E1F9",
  "--og-white": "#FFFFFF",
  "--og-gray-100": "#EEF3F3",
  "--og-gray-200": "#D6DEDE",
  "--og-gray-600": "#4A5C5A",
  "--og-gray-800": "#1E2D2B",
} as const;
const C = (token: keyof typeof CARD_COLOURS): Rgb => rgb(CARD_COLOURS[token]);

/** How a status label is drawn; the label's words carry the meaning, the colour only repeats it. */
export type Tone = "open" | "upcoming" | "closed" | "neutral";
const TONES: Record<Tone, { bg: Rgb; fg: Rgb; border?: Rgb }> = {
  open: { bg: C("--og-mint-light"), fg: C("--og-teal-dark") },
  upcoming: { bg: C("--og-blue-light"), fg: C("--og-navy-dark") },
  closed: { bg: C("--og-gray-100"), fg: C("--og-gray-800"), border: C("--og-gray-200") },
  neutral: { bg: C("--og-white"), fg: C("--og-gray-800"), border: C("--og-gray-200") },
};

export interface CardText {
  /** The site's address, beside the OpenGrants mark. */
  site: string;
  /** The line above the title: the funder, or what the card is about. */
  eyebrow: string;
  title: string;
  detail?: string | null;
  amount?: string | null;
  status?: { label: string; tone: Tone } | null;
  /** A short line top right, such as that the funder is not verified. */
  note?: string | null;
}

export interface CardAssets {
  display: Font;
  body: Font;
  bodyBold: Font;
  mark: Rgba | null;
}

/** The files a card is drawn with, at the paths the web app serves them from. */
export const CARD_FILES = { display: "/fonts/Ubuntu-Bold.ttf", body: "/fonts/Lato-Regular.ttf", bodyBold: "/fonts/Lato-Bold.ttf", mark: "/brand/opengrants-icon-color.png" } as const;

export async function loadCardAssets(read: (path: string) => Uint8Array | null): Promise<CardAssets> {
  const font = (path: string) => {
    const bytes = read(path);
    if (!bytes) throw new Error(`${path} is missing`);
    return new Font(bytes);
  };
  const markBytes = read(CARD_FILES.mark);
  // The card is still useful without the mark's image: the address is drawn either way.
  const mark = markBytes ? await decodePng(markBytes).catch(() => null) : null;
  return { display: font(CARD_FILES.display), body: font(CARD_FILES.body), bodyBold: font(CARD_FILES.bodyBold), mark };
}

const width = (fonts: Font[], s: string, size: number) => layoutRun(fonts, s, size).width;

/** The text, cut to fit with an ellipsis when it is wider than `max` (or always, with `force`). */
export function fit(fonts: Font[], text: string, size: number, max: number, force = false): string {
  const clean = cleanText(text);
  if (!force && width(fonts, clean, size) <= max) return clean;
  const chars = [...clean];
  while (chars.length && width(fonts, `${chars.join("").trimEnd()}\u2026`, size) > max) chars.pop();
  return `${chars.join("").trimEnd()}\u2026`;
}

/** Words in at most `maxLines` lines of `max` wide; the last line ends in an ellipsis when text is left. */
export function wrap(fonts: Font[], text: string, size: number, max: number, maxLines: number): { lines: string[]; truncated: boolean } {
  const words = cleanText(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let i = 0;
  while (i < words.length && lines.length < maxLines) {
    let line = words[i++]!;
    while (i < words.length && width(fonts, `${line} ${words[i]}`, size) <= max) line += ` ${words[i++]}`;
    lines.push(line);
  }
  let truncated = i < words.length;
  for (let k = 0; k < lines.length; k++) {
    const last = k === lines.length - 1;
    const over = width(fonts, lines[k]!, size) > max;
    if (over || (last && truncated)) lines[k] = fit(fonts, lines[k]!, size, max, last && truncated);
    if (over) truncated = true;
  }
  return { lines, truncated };
}

const PAD = 72;
const TEXT_WIDTH = CARD_WIDTH - 2 * PAD;
const TITLE_SIZES: [size: number, lineHeight: number][] = [
  [68, 78],
  [58, 68],
  [50, 60],
];

/** Draws the card and encodes it as PNG. */
export async function renderCard(text: CardText, assets: CardAssets): Promise<Uint8Array> {
  const c = new Canvas(CARD_WIDTH, CARD_HEIGHT);
  c.verticalGradient(C("--og-teal-soft"), C("--og-white"));
  c.fillRect(0, CARD_HEIGHT - 10, CARD_WIDTH, 10, C("--og-teal"));
  const display = [assets.display, assets.bodyBold, assets.body];
  const body = [assets.body, assets.bodyBold, assets.display];
  const bodyBold = [assets.bodyBold, assets.body, assets.display];
  const draw = (fonts: Font[], s: string, x: number, baseline: number, size: number, colour: Rgb) => {
    const run = layoutRun(fonts, s, size);
    c.fill(runPath(run, x, baseline, size), colour);
    return run.width;
  };

  // The mark: the OpenGrants icon and the site's address.
  let x = PAD;
  if (assets.mark) {
    const h = 46;
    const w = Math.round((h * assets.mark.width) / assets.mark.height);
    c.drawImage(assets.mark, PAD, 50, w, h);
    x += w + 16;
  }
  const siteWidth = draw(display, fit(display, text.site, 30, 520), x, 85, 30, C("--og-navy-dark"));
  if (text.note) {
    const room = CARD_WIDTH - PAD - (x + siteWidth + 40);
    if (room > 120) {
      const note = fit(body, text.note, 24, room);
      draw(body, note, CARD_WIDTH - PAD - width(body, note, 24), 84, 24, C("--og-gray-600"));
    }
  }

  draw(bodyBold, fit(bodyBold, text.eyebrow, 32, TEXT_WIDTH), PAD, 178, 32, C("--og-teal-dark"));

  // The title, as large as fits in its lines.
  const maxLines = text.detail ? 2 : 3;
  let title = { size: 0, lineHeight: 0, lines: [] as string[] };
  for (const [size, lineHeight] of TITLE_SIZES) {
    const w = wrap(display, text.title, size, TEXT_WIDTH, maxLines);
    title = { size, lineHeight, lines: w.lines };
    if (!w.truncated) break;
  }
  let y = 212 + title.size * 0.72;
  title.lines.forEach((line, i) => draw(display, line, PAD, y + i * title.lineHeight, title.size, C("--og-navy-dark")));
  y += Math.max(0, title.lines.length - 1) * title.lineHeight;

  if (text.detail) {
    y += 62;
    for (const line of wrap(body, text.detail, 30, TEXT_WIDTH, 2).lines) {
      draw(body, line, PAD, y, 30, C("--og-gray-600"));
      y += 42;
    }
  }

  // The bottom row: the amount, then the status label.
  const row = 560;
  let bx = PAD;
  if (text.amount) bx += draw(display, fit(display, text.amount, 46, TEXT_WIDTH - 360), PAD, row, 46, C("--og-navy-dark")) + 28;
  if (text.status) {
    const [size, padX, ph] = [26, 24, 52];
    const label = fit(bodyBold, text.status.label, size, CARD_WIDTH - PAD - bx - 2 * padX);
    const pw = width(bodyBold, label, size) + 2 * padX;
    const top = row - 16 - ph / 2;
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
  return encodePng(c.data, CARD_WIDTH, CARD_HEIGHT);
}
