// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  documentHash,
  PDF_DOCUMENT_KEYS,
  pdfDocuments,
  previewBrand,
  renderPdf,
  type PdfDocumentPropsMap,
} from '../src';

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

/** Reads a plain-ASCII value from the PDF Info dictionary (values are stored as indirect objects). */
function infoValue(raw: string, key: string): string | null {
  const ref = new RegExp(`/${key} (\\d+) 0 R`).exec(raw);
  if (!ref) return null;
  const obj = new RegExp(`(?:^|\\n)${ref[1]} 0 obj\\n\\((.*)\\)\\nendobj`).exec(raw);
  return obj ? obj[1]! : null;
}

describe('pdf documents', () => {
  it('registers every document', () => {
    expect([...PDF_DOCUMENT_KEYS].sort()).toEqual(
      ['agreement', 'application_packet', 'award_letter', 'board_book', 'remittance'].sort(),
    );
  });

  for (const key of PDF_DOCUMENT_KEYS) {
    it(`${key} renders a PDF from its preview props`, async () => {
      const bytes = await renderPdf(
        key,
        pdfDocuments[key].previewProps as PdfDocumentPropsMap[typeof key],
        previewBrand,
      );
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.byteLength).toBeGreaterThan(1000);
      expect(latin1(bytes.subarray(0, 5))).toBe('%PDF-');
      const raw = latin1(bytes);
      expect(infoValue(raw, 'Creator')).toBe('GMS');
      expect(infoValue(raw, 'Author')).toBe('Halcyon Ridge Foundation');
      expect(infoValue(raw, 'Title')?.length).toBeGreaterThan(5);
    }, 30_000);
  }

  it('renders an unsigned agreement', async () => {
    const p = pdfDocuments.agreement.previewProps;
    const bytes = await renderPdf(
      'agreement',
      { ...p, signatures: p.signatures.map((s) => ({ ...s, signature: null })) },
      { ...previewBrand, primaryColor: 'not-a-color', logoUrl: 'javascript:alert(1)' },
    );
    expect(latin1(bytes.subarray(0, 5))).toBe('%PDF-');
  }, 30_000);

  it('documentHash is a stable sha256 hex digest', () => {
    const a = new TextEncoder().encode('%PDF-1.3 hello');
    const b = new TextEncoder().encode('%PDF-1.3 hello');
    expect(documentHash(a)).toBe(documentHash(b));
    expect(documentHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(documentHash(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(documentHash(a)).not.toBe(documentHash(new TextEncoder().encode('%PDF-1.3 hellO')));
  });
});
