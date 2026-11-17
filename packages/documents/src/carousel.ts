// SPDX-License-Identifier: AGPL-3.0-only
// A document carousel for a grant announcement (v1.12.0, the award kit): 6 to 10 portrait pages of
// 1080 × 1350, the size LinkedIn and Instagram show a carousel at, built with pdf-lib and the
// standard fonts so it runs in a Worker. Each page is a heading, a few short paragraphs and a
// small line at the bottom, in the theme's colours, with no logo. The caller words every page and
// gives each page's alt text, which the kit lists beside the download (pdf-lib cannot tag a PDF, so
// the alt text cannot live inside it). Deterministic for a fixed input.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/** Page size in PDF points: 1080 × 1350, a 4:5 portrait. */
export const CAROUSEL_PAGE = { width: 1080, height: 1350 } as const;
/** A carousel has at least this many pages and at most `CAROUSEL_MAX_PAGES`. */
export const CAROUSEL_MIN_PAGES = 6;
export const CAROUSEL_MAX_PAGES = 10;

export interface CarouselPage {
  /** A short line above the heading, such as "Grant announcement". */
  eyebrow?: string | null;
  heading: string;
  /** Paragraphs, each wrapped to the page. Long text is cut with an ellipsis rather than overflowing. */
  body: string[];
  /** What a screen reader user is told the page shows: listed in the kit, never drawn. */
  alt: string;
}

export interface CarouselInput {
  /** The document's title (its metadata; viewers show it instead of the file name). */
  title: string;
  pages: CarouselPage[];
  /** Drawn at the bottom of every page, e.g. the award page's address. */
  footer?: string;
  /** "2 / 7", in the document's language. */
  pageLabel?: (page: number, total: number) => string;
  /** ISO timestamp written as the creation and modification date. */
  createdAt: string;
  /** BCP 47 language, e.g. `en-US`. */
  lang?: string;
}

// Theme tokens (apps/web/src/theme/tokens.css): --og-navy-dark, --og-teal-dark, --og-teal,
// --og-teal-soft, --og-gray-600, --og-white.
const NAVY = rgb(0x0d / 255, 0x2a / 255, 0x43 / 255);
const TEAL_DARK = rgb(0x14 / 255, 0x54 / 255, 0x50 / 255);
const TEAL = rgb(0x29 / 255, 0xa7 / 255, 0x9f / 255);
const TEAL_SOFT = rgb(0xe1 / 255, 0xf8 / 255, 0xf6 / 255);
const GRAY = rgb(0x4a / 255, 0x5c / 255, 0x5a / 255);
const WHITE = rgb(1, 1, 1);

const PAD = 96;
const WIDTH = CAROUSEL_PAGE.width - 2 * PAD;
const HEADING_SIZES: readonly number[] = [84, 72, 60, 52];
const BODY_SIZES: readonly number[] = [44, 38, 34, 30];
const SMALLEST_HEADING = 52;
const SMALLEST_BODY = 30;

/** The standard fonts encode Windows-1252 only: anything else becomes `?` instead of failing. */
function safeFor(font: PDFFont) {
  const encodable = new Set(font.getCharacterSet());
  return (text: string) => {
    let out = "";
    for (const ch of text.normalize("NFC")) {
      const code = ch.codePointAt(0)!;
      if (code === 0x09 || code === 0x0a || code === 0x0d || code === 0xa0) out += " ";
      else if (code < 0x20 || code === 0x7f) continue;
      else out += encodable.has(code) ? ch : "?";
    }
    return out.replace(/\s+/g, " ").trim();
  };
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ").filter(Boolean)) {
    let w = word;
    // A token wider than the line (an address) is broken by characters.
    while (font.widthOfTextAtSize(w, size) > width) {
      let cut = w.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
      if (line) lines.push(line);
      lines.push(w.slice(0, cut));
      line = "";
      w = w.slice(cut);
    }
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** At most `max` lines; the last one ends in an ellipsis when text is left over. */
function clamp(lines: string[], max: number, font: PDFFont, size: number, width: number): string[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  let last = `${kept[max - 1]!}…`;
  while (last.length > 1 && font.widthOfTextAtSize(last, size) > width) last = `${last.slice(0, -2).trimEnd()}…`;
  kept[max - 1] = last;
  return kept;
}

function drawPage(page: PDFPage, p: CarouselPage, n: number, total: number, fonts: { regular: PDFFont; bold: PDFFont }, input: CarouselInput) {
  const { width: W, height: H } = CAROUSEL_PAGE;
  const safe = safeFor(fonts.regular);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: n === 1 ? NAVY : TEAL_SOFT });
  page.drawRectangle({ x: 0, y: 0, width: W, height: 18, color: TEAL });
  const ink = n === 1 ? WHITE : NAVY;
  const soft = n === 1 ? TEAL_SOFT : GRAY;
  let y = H - PAD - 20;

  if (p.eyebrow) {
    const eyebrow = clamp(wrap(safe(p.eyebrow), fonts.bold, 34, WIDTH), 1, fonts.bold, 34, WIDTH)[0] ?? "";
    page.drawText(eyebrow, { x: PAD, y, size: 34, font: fonts.bold, color: n === 1 ? TEAL : TEAL_DARK });
    y -= 34 + 40;
  }

  // The heading, as large as fits in four lines.
  let heading: string[] = [];
  let hs = SMALLEST_HEADING;
  for (const size of HEADING_SIZES) {
    heading = wrap(safe(p.heading), fonts.bold, size, WIDTH);
    hs = size;
    if (heading.length <= 4) break;
  }
  heading = clamp(heading, 5, fonts.bold, hs, WIDTH);
  for (const line of heading) {
    y -= hs;
    page.drawText(line, { x: PAD, y, size: hs, font: fonts.bold, color: ink });
    y -= hs * 0.22;
  }
  y -= 56;

  // The body: as large as lets every paragraph fit above the footer.
  const bottom = 210;
  const paragraphs = p.body.map(safe).filter(Boolean);
  let layout: { size: number; blocks: string[][] } = { size: SMALLEST_BODY, blocks: [] };
  for (const size of BODY_SIZES) {
    const blocks = paragraphs.map((t) => wrap(t, fonts.regular, size, WIDTH));
    const height = blocks.reduce((h, b) => h + b.length * size * 1.35 + size * 0.8, 0);
    layout = { size, blocks };
    if (y - height >= bottom) break;
  }
  const step = layout.size * 1.35;
  const room = Math.max(1, Math.floor((y - bottom) / step));
  let used = 0;
  for (const block of layout.blocks) {
    const left = room - used;
    if (left <= 0) break;
    const lines = clamp(block, left, fonts.regular, layout.size, WIDTH);
    for (const line of lines) {
      y -= step;
      page.drawText(line, { x: PAD, y, size: layout.size, font: fonts.regular, color: ink });
    }
    used += lines.length;
    y -= layout.size * 0.8;
  }

  // The bottom line: the address on the left, the page number on the right.
  const label = safe(input.pageLabel ? input.pageLabel(n, total) : `${n} / ${total}`);
  const lw = fonts.bold.widthOfTextAtSize(label, 28);
  page.drawText(label, { x: W - PAD - lw, y: 92, size: 28, font: fonts.bold, color: soft });
  if (input.footer) {
    const footer = clamp(wrap(safe(input.footer), fonts.regular, 26, WIDTH - lw - 40), 1, fonts.regular, 26, WIDTH - lw - 40)[0] ?? "";
    page.drawText(footer, { x: PAD, y: 92, size: 26, font: fonts.regular, color: soft });
  }
}

/** Renders the carousel. Refuses fewer than 6 or more than 10 pages. */
export async function renderCarouselPdf(input: CarouselInput): Promise<Uint8Array> {
  const total = input.pages.length;
  if (total < CAROUSEL_MIN_PAGES || total > CAROUSEL_MAX_PAGES) throw new RangeError(`A carousel has ${CAROUSEL_MIN_PAGES} to ${CAROUSEL_MAX_PAGES} pages, not ${total}`);
  const at = new Date(input.createdAt);
  if (Number.isNaN(at.getTime())) throw new RangeError("createdAt must be an ISO timestamp");
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setTitle(input.title);
  pdf.setProducer("OpenGrants GMS");
  pdf.setCreator("OpenGrants GMS");
  pdf.setCreationDate(at);
  pdf.setModificationDate(at);
  if (input.lang) {
    pdf.setLanguage(input.lang);
    pdf.catalog.getOrCreateViewerPreferences().setDisplayDocTitle(true);
  }
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  input.pages.forEach((p, i) => drawPage(pdf.addPage([CAROUSEL_PAGE.width, CAROUSEL_PAGE.height]), p, i + 1, total, fonts, input));
  return pdf.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}
