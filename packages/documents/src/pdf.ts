// SPDX-License-Identifier: AGPL-3.0-only
// PDF rendering for letters, agreements and application snapshots. Pure JavaScript (pdf-lib with
// the standard 14 fonts): no native code, no Node APIs, so it runs in a Cloudflare Worker.
//
// Output is deterministic: the same document and the same `createdAt` give the same bytes, so a
// stored SHA-256 can be re-verified by rendering again (click-to-sign audit, build spec §4).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "fields"; rows: [label: string, value: string][] }
  | { type: "rule" }
  | { type: "space"; height?: number };

export interface PdfDocumentInput {
  title: string;
  /** Shown in the page header, e.g. the funder's name. */
  header?: string;
  /** Shown in the footer of every page, before the page number. */
  footer?: string;
  /** Tenant accent as `#RRGGBB`; used for the header rule only. */
  accent?: string;
  blocks: Block[];
  /** ISO timestamp written as the document's creation and modification date. */
  createdAt: string;
}

const PAGE = { width: 612, height: 792 }; // US Letter, points
const MARGIN = { top: 72, bottom: 64, left: 72, right: 72 };
const BODY = 10.5;
const LEADING = 1.45;
const INK = rgb(0.118, 0.176, 0.169); // #1E2D2B
const HEADING = rgb(0.051, 0.165, 0.263); // #0D2A43
const MUTED = rgb(0.29, 0.361, 0.353); // #4A5C5A
const RULE = rgb(0.839, 0.871, 0.871); // #D6DEDE

function accentColor(hex: string | undefined) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? "");
  return m ? rgb(parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255) : HEADING;
}

/**
 * A small markdown subset to blocks: `#`/`##`/`###` headings, paragraphs, `-` and `1.` lists,
 * `---` rules. Inline emphasis markers are dropped (the standard fonts carry no inline styles here).
 */
export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (para.length) blocks.push({ type: "paragraph", text: para.join(" ") });
    if (list) blocks.push({ type: "list", ...list });
    para = [];
    list = null;
  };
  const plain = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/(^|[^*])\*([^*]+)\*/g, "$1$2").replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)").trim();
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (!line) flush();
    else if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1]!.length as 1 | 2 | 3, text: plain(heading[2]!) });
    } else if (/^-{3,}$/.test(line)) {
      flush();
      blocks.push({ type: "rule" });
    } else if (bullet || numbered) {
      const ordered = !bullet;
      if (para.length || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push(plain((bullet ?? numbered)![1]!));
    } else if (list) {
      // A continuation line belongs to the last list item.
      list.items[list.items.length - 1] += ` ${plain(line)}`;
    } else para.push(plain(line));
  }
  flush();
  return blocks;
}

class Writer {
  private page!: PDFPage;
  private y = 0;
  private readonly width = PAGE.width - MARGIN.left - MARGIN.right;
  private readonly encodable: Set<number>;

  constructor(
    private readonly pdf: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
    private readonly input: PdfDocumentInput,
  ) {
    this.encodable = new Set(regular.getCharacterSet());
    this.newPage();
  }

  /** The standard fonts encode Windows-1252 only; anything else becomes `?` instead of failing the render. */
  private safe(text: string): string {
    let out = "";
    for (const ch of text) {
      const code = ch.codePointAt(0)!;
      // Tabs and non-breaking spaces become spaces; other control characters are dropped.
      if (code === 0x09 || code === 0xa0) out += " ";
      else if (code < 0x20 || code === 0x7f) continue;
      else out += this.encodable.has(code) ? ch : "?";
    }
    return out;
  }

  private newPage(): void {
    this.page = this.pdf.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - MARGIN.top;
    if (this.input.header) {
      this.page.drawText(this.safe(this.input.header), { x: MARGIN.left, y: PAGE.height - 44, size: 9, font: this.bold, color: HEADING });
      this.page.drawRectangle({ x: MARGIN.left, y: PAGE.height - 54, width: this.width, height: 1.5, color: accentColor(this.input.accent) });
    }
  }

  private need(height: number): void {
    if (this.y - height < MARGIN.bottom) this.newPage();
  }

  private wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const word of this.safe(text).split(/\s+/).filter(Boolean)) {
      let w = word;
      // A single token wider than the line (a URL, a hash) is broken by characters.
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

  private text(text: string, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; indent?: number; after?: number } = {}): void {
    const font = opts.font ?? this.regular;
    const size = opts.size ?? BODY;
    const indent = opts.indent ?? 0;
    const step = size * LEADING;
    for (const line of this.wrap(text, font, size, this.width - indent)) {
      this.need(step);
      this.y -= step;
      this.page.drawText(line, { x: MARGIN.left + indent, y: this.y, size, font, color: opts.color ?? INK });
    }
    this.y -= opts.after ?? 0;
  }

  block(b: Block): void {
    if (b.type === "heading") {
      const size = b.level === 1 ? 17 : b.level === 2 ? 12.5 : 11;
      this.need(size * LEADING * 2);
      this.y -= b.level === 1 ? 2 : 6;
      this.text(b.text, { font: this.bold, size, color: HEADING, after: 4 });
    } else if (b.type === "paragraph") this.text(b.text, { after: 7 });
    else if (b.type === "list") {
      b.items.forEach((item, i) => {
        const step = BODY * LEADING;
        // Room for the first line is secured first, so the marker and that line share a page.
        this.need(step);
        this.page.drawText(this.safe(b.ordered ? `${i + 1}.` : "\u2022"), { x: MARGIN.left + 2, y: this.y - step, size: BODY, font: this.regular, color: INK });
        this.text(item, { indent: 18, after: 2 });
      });
      this.y -= 5;
    } else if (b.type === "fields") {
      for (const [label, value] of b.rows) {
        const step = BODY * LEADING;
        const lines = this.wrap(value || "—", this.regular, BODY, this.width - 170);
        this.need(step * Math.max(1, lines.length));
        this.page.drawText(this.safe(label), { x: MARGIN.left, y: this.y - step, size: BODY, font: this.regular, color: MUTED });
        for (const line of lines.length ? lines : [""]) {
          this.need(step);
          this.y -= step;
          this.page.drawText(line, { x: MARGIN.left + 170, y: this.y, size: BODY, font: this.regular, color: INK });
        }
        this.y -= 2;
      }
      this.y -= 6;
    } else if (b.type === "rule") {
      this.need(14);
      this.y -= 8;
      this.page.drawRectangle({ x: MARGIN.left, y: this.y, width: this.width, height: 0.75, color: RULE });
      this.y -= 6;
    } else this.y -= b.height ?? 10;
  }

  finish(): void {
    const pages = this.pdf.getPages();
    pages.forEach((p, i) => {
      const label = this.safe(`${this.input.footer ? `${this.input.footer} · ` : ""}Page ${i + 1} of ${pages.length}`);
      p.drawText(label, { x: MARGIN.left, y: 36, size: 8, font: this.regular, color: MUTED });
    });
  }
}

/** Render a document to PDF bytes. Deterministic for a fixed input. */
export async function renderPdf(input: PdfDocumentInput): Promise<Uint8Array> {
  const at = new Date(input.createdAt);
  if (Number.isNaN(at.getTime())) throw new RangeError("createdAt must be an ISO timestamp");
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setTitle(input.title);
  pdf.setProducer("OpenGrants GMS");
  pdf.setCreator("OpenGrants GMS");
  pdf.setCreationDate(at);
  pdf.setModificationDate(at);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(pdf, regular, bold, input);
  for (const b of input.blocks) w.block(b);
  w.finish();
  return pdf.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}
