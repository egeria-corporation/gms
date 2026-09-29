// SPDX-License-Identifier: AGPL-3.0-or-later
// A tiny, deterministic placeholder PDF (one page of Helvetica text). The seed stores one per agreement and
// records its SHA-256, so signature hashes bind to real bytes without rendering the full agreement template.
import { createHash } from 'node:crypto';

function escapePdf(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, '-').replace(/([\\()])/g, '\\$1');
}

export function placeholderPdf(title: string, lines: readonly string[]): Uint8Array {
  const text = [
    'BT /F1 18 Tf 72 740 Td',
    `(${escapePdf(title)}) Tj`,
    '/F1 11 Tf 0 -28 Td 14 TL',
    ...lines.map((l) => `(${escapePdf(l)}) '`),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
