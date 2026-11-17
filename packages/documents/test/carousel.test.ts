// SPDX-License-Identifier: AGPL-3.0-only
// The award kit's carousel (v1.12.0): 6 to 10 portrait pages of 1080 × 1350, the same bytes for the
// same input, the title and language set, and long or unencodable text kept on the page.
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { CAROUSEL_MAX_PAGES, CAROUSEL_MIN_PAGES, CAROUSEL_PAGE, renderCarouselPdf, type CarouselPage } from "../src/index.ts";

const page = (n: number, extra: Partial<CarouselPage> = {}): CarouselPage => ({ heading: `Page ${n} heading`, body: [`What page ${n} says.`], alt: `Page ${n}`, ...extra });
const pages = (n: number) => Array.from({ length: n }, (_, i) => page(i + 1));
const input = (n: number) => ({ title: "Riverbend Community Foundation awarded Alder Creek Family Services a grant", pages: pages(n), footer: "gms.opengrants.io/f/riverbend/awards/alder-creek-family-services-7k2m9x4qp1ad", createdAt: "2027-05-19T16:00:00.000Z", lang: "en-US" });

describe("renderCarouselPdf", () => {
  it.each([CAROUSEL_MIN_PAGES, 8, CAROUSEL_MAX_PAGES])("draws %i pages of 1080 × 1350", async (n) => {
    const doc = await PDFDocument.load(await renderCarouselPdf(input(n)));
    expect(doc.getPageCount()).toBe(n);
    for (const p of doc.getPages()) expect(p.getSize()).toEqual({ width: CAROUSEL_PAGE.width, height: CAROUSEL_PAGE.height });
    expect(doc.getTitle()).toBe("Riverbend Community Foundation awarded Alder Creek Family Services a grant");
  });

  it("refuses fewer than 6 or more than 10 pages", async () => {
    await expect(renderCarouselPdf(input(5))).rejects.toThrow(RangeError);
    await expect(renderCarouselPdf(input(11))).rejects.toThrow(RangeError);
  });

  it("gives the same bytes for the same input, and writes the language", async () => {
    const a = await renderCarouselPdf(input(7));
    const b = await renderCarouselPdf(input(7));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(new TextDecoder("latin1").decode(a)).toContain("/Lang (en-US)");
  });

  it("keeps a long heading, a long paragraph and characters the standard fonts lack on the page", async () => {
    const long = "Mobile health navigation for rural families across the valley ".repeat(12);
    const doc = await renderCarouselPdf({ ...input(6), pages: [page(1, { heading: long, body: [long, long, long] }), page(2, { heading: "Für ✓ Gesundheit — «salud»", body: ["Emoji 🌱 and Ω are replaced, not fatal."] }), ...pages(4)] });
    expect((await PDFDocument.load(doc)).getPageCount()).toBe(6);
  });
});
