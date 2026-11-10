// SPDX-License-Identifier: AGPL-3.0-only
import { MissingFieldError } from "@gms/notify";
import { describe, expect, it } from "vitest";
import { DEFAULT_AGREEMENT_TEMPLATE, DEFAULT_AWARD_LETTER_TEMPLATE, MemoryFileStorage, R2FileStorage, SupabaseFileStorage, TieredFileStorage, mergeDocument, parseMarkdown, printValue, renderAgreement, renderApplicationSnapshot, renderAwardLetter, renderExecutedAgreement, renderPdf, sha256Hex } from "../src/index.ts";

const FIELDS = {
  funder: { name: "Riverbend Community Foundation" },
  recipient: { name: "Alder Creek Family Services" },
  award: { title: "Mobile Health Navigation for Rural Families", amount: "USD 150,000.00", startDate: "2027-07-01", endDate: "2028-06-30", conditions: "No special conditions." },
};
const META = { funderName: "Riverbend Community Foundation", accent: "#1F6F8B", createdAt: "2027-05-19T16:00:00.000Z", reference: "agr_0190 v1" };
const ascii = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

describe("sha256Hex", () => {
  it("matches the known digest of the empty input and of abc", async () => {
    expect(await sha256Hex(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("storage", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  it("memory and R2 round-trip bytes", async () => {
    const mem = new MemoryFileStorage();
    expect(await mem.get(await mem.put("a/b.pdf", bytes, "application/pdf"))).toEqual(bytes);
    expect(await mem.get({ storage: "r2", path: "missing" })).toBeNull();
    const objects = new Map<string, Uint8Array>();
    const r2 = new R2FileStorage({ put: async (k, v) => void objects.set(k, v), get: async (k) => (objects.has(k) ? { arrayBuffer: async () => objects.get(k)!.buffer as ArrayBuffer } : null) });
    const stored = await r2.put("x.pdf", bytes, "application/pdf");
    expect(stored).toEqual({ storage: "r2", path: "x.pdf" });
    expect(await r2.get(stored)).toEqual(bytes);
  });

  it("Supabase Storage uploads with upsert and reports a refused upload", async () => {
    const calls: unknown[] = [];
    const ok = new SupabaseFileStorage({ storage: { from: (bucket) => ({ upload: async (path, _b, o) => (calls.push([bucket, path, o]), { error: null }), download: async () => ({ data: { arrayBuffer: async () => bytes.buffer as ArrayBuffer }, error: null }) }) } }, "docs");
    const stored = await ok.put("p.pdf", bytes, "application/pdf");
    expect(stored.storage).toBe("supabase");
    expect(calls).toEqual([["docs", "p.pdf", { contentType: "application/pdf", upsert: true }]]);
    expect(await ok.get(stored)).toEqual(bytes);
    const bad = new SupabaseFileStorage({ storage: { from: () => ({ upload: async () => ({ error: { message: "denied" } }), download: async () => ({ data: null, error: { message: "gone" } }) }) } });
    await expect(bad.put("p.pdf", bytes, "application/pdf")).rejects.toThrow("could not be stored");
    expect(await bad.get({ storage: "supabase", path: "p.pdf" })).toBeNull();
  });

  it("tiers by size: small files to Supabase Storage, large to R2", async () => {
    const small = new MemoryFileStorage();
    const large = new MemoryFileStorage();
    small.put = async (path, b, mime) => (small.files.set(path, { bytes: b, mime }), { storage: "supabase" as const, path });
    const tiered = new TieredFileStorage(small, large, 4);
    const a = await tiered.put("small", bytes, "text/plain");
    const b = await tiered.put("large", new Uint8Array(8), "text/plain");
    expect([a.storage, b.storage]).toEqual(["supabase", "r2"]);
    expect(await tiered.get(a)).toEqual(bytes);
    expect((await tiered.get(b))?.byteLength).toBe(8);
  });
});

describe("parseMarkdown", () => {
  it("reads headings, paragraphs, lists and rules, dropping inline markers", () => {
    expect(parseMarkdown("# Title\n\nFirst **bold** line\ncontinues.\n\n- one\n- two\n  more\n\n1. a\n2. b\n\n---\n\n## Next\nSee [docs](https://example.org).")).toEqual([
      { type: "heading", level: 1, text: "Title" },
      { type: "paragraph", text: "First bold line continues." },
      { type: "list", ordered: false, items: ["one", "two more"] },
      { type: "list", ordered: true, items: ["a", "b"] },
      { type: "rule" },
      { type: "heading", level: 2, text: "Next" },
      { type: "paragraph", text: "See docs (https://example.org)." },
    ]);
  });
});

describe("rendering", () => {
  it("produces a PDF, identically for the same input", async () => {
    const a = await renderAgreement(DEFAULT_AGREEMENT_TEMPLATE, FIELDS, META);
    await new Promise((r) => setTimeout(r, 15));
    const b = await renderAgreement(DEFAULT_AGREEMENT_TEMPLATE, FIELDS, META);
    expect(ascii(a).startsWith("%PDF-")).toBe(true);
    expect(await sha256Hex(a)).toBe(await sha256Hex(b));
    expect(a.byteLength).toBeGreaterThan(1500);
  });

  it("changes the bytes when the text, the date or the reference changes", async () => {
    const base = await sha256Hex(await renderAgreement(DEFAULT_AGREEMENT_TEMPLATE, FIELDS, META));
    expect(await sha256Hex(await renderAgreement(DEFAULT_AGREEMENT_TEMPLATE, { ...FIELDS, award: { ...FIELDS.award, amount: "USD 150,001.00" } }, META))).not.toBe(base);
    expect(await sha256Hex(await renderAgreement(DEFAULT_AGREEMENT_TEMPLATE, FIELDS, { ...META, createdAt: "2027-05-20T16:00:00.000Z" }))).not.toBe(base);
    expect(await sha256Hex(await renderAgreement(DEFAULT_AGREEMENT_TEMPLATE, FIELDS, { ...META, reference: "agr_0190 v2" }))).not.toBe(base);
  });

  it("refuses to render with a missing merge field", async () => {
    await expect(renderAwardLetter(DEFAULT_AWARD_LETTER_TEMPLATE, { funder: FIELDS.funder }, META)).rejects.toBeInstanceOf(MissingFieldError);
  });

  it("keeps a merged value from adding structure", () => {
    expect(mergeDocument("Dear {{recipient.name}},", { recipient: { name: "Alder\n# Injected" } })).toBe("Dear Alder # Injected,");
    expect(parseMarkdown(mergeDocument("Dear {{recipient.name}},", { recipient: { name: "Alder\n# Injected" } }))).toEqual([{ type: "paragraph", text: "Dear Alder # Injected," }]);
  });

  it("the executed agreement differs from the signed document and is itself deterministic", async () => {
    const signed = await renderAgreement(DEFAULT_AGREEMENT_TEMPLATE, FIELDS, META);
    const hash = await sha256Hex(signed);
    const audit = {
      signedDocumentSha256: hash,
      executedAt: "2027-05-24T18:00:00.000Z",
      signatures: [
        { party: "Grantee", name: "Maria Santos", at: "2027-05-21T17:02:11.000Z", ip: "203.0.113.7", documentSha256: hash },
        { party: "Funder", name: "Dana Ortiz", at: "2027-05-24T18:00:00.000Z", ip: "198.51.100.9", documentSha256: hash },
      ],
    };
    const executed = await renderExecutedAgreement(DEFAULT_AGREEMENT_TEMPLATE, FIELDS, META, audit);
    expect(await sha256Hex(executed)).not.toBe(hash);
    expect(await sha256Hex(executed)).toBe(await sha256Hex(await renderExecutedAgreement(DEFAULT_AGREEMENT_TEMPLATE, FIELDS, META, audit)));
    expect(executed.byteLength).toBeGreaterThan(signed.byteLength);
  });

  it("paginates long documents and survives characters the standard fonts cannot encode", async () => {
    const blocks = Array.from({ length: 120 }, (_, i) => ({ type: "paragraph" as const, text: `Paragraph ${i}: ${"lorem ipsum dolor sit amet ".repeat(6)} 漢字 \u{1F600} a-very-long-token-${"x".repeat(200)}` }));
    const pdf = ascii(await renderPdf({ title: "Long", createdAt: META.createdAt, blocks: [{ type: "heading", level: 1, text: "Long" }, { type: "list", ordered: true, items: ["one", "two"] }, ...blocks] }));
    expect((pdf.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(3);
    await expect(renderPdf({ title: "x", createdAt: "not a date", blocks: [] })).rejects.toThrow(RangeError);
  });

  it("renders an application snapshot", async () => {
    const pdf = await renderApplicationSnapshot({ title: "Mobile Health Navigation", applicant: "Alder Creek Family Services", opportunity: "Community Health Grants 2027", submittedAt: "2027-04-16T17:00:00.000Z", verificationLevel: "L3", forms: [{ title: "Letter of intent", status: "complete", fields: [["Project title", "Mobile Health Navigation"], ["Requested amount", printValue({ amount: "150000.00", currency: "USD" })]] }, { title: "Empty", status: "notStarted", fields: [] }] }, { ...META, reference: "app_0190" });
    expect(ascii(pdf).startsWith("%PDF-")).toBe(true);
  });

  it("prints JSON answers on one line", () => {
    expect(printValue({ amount: "150000.00", currency: "USD" })).toBe("USD 150000.00");
    expect(printValue(["a", "", "b"])).toBe("a; b");
    expect(printValue("<p>Rich <b>text</b></p>")).toBe("Rich text");
    expect(printValue({ city: "Alder Creek", state: "OR" })).toBe("city: Alder Creek, state: OR");
    expect(printValue(null)).toBe("");
    expect(printValue(true)).toBe("true");
  });
});
