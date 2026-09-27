// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { renderToBuffer } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import { resolveBrand, type Brand, type ResolvedBrand } from './brand';
import { ApplicationPacket, type ApplicationPacketProps } from './documents/application-packet';
import {
  AwardLetter,
  GrantAgreement,
  type AwardLetterProps,
  type GrantAgreementProps,
} from './documents/awards';
import { BoardBook, type BoardBookProps } from './documents/board-book';
import { RemittanceAdvice, type RemittanceAdviceProps } from './documents/remittance';
import { previewProps } from './fixtures';

export interface PdfDocumentPropsMap {
  award_letter: AwardLetterProps;
  agreement: GrantAgreementProps;
  application_packet: ApplicationPacketProps;
  remittance: RemittanceAdviceProps;
  board_book: BoardBookProps;
}

export type PdfDocumentKey = keyof PdfDocumentPropsMap;

export interface PdfDocumentDef<P> {
  name: string;
  /** Spec reference (H-02 …). */
  spec: string;
  element: (props: P, brand: ResolvedBrand) => ReactElement;
  previewProps: P;
}

type Registry = { [K in PdfDocumentKey]: PdfDocumentDef<PdfDocumentPropsMap[K]> };

export const pdfDocuments: Registry = {
  award_letter: {
    name: 'Award letter',
    spec: 'H-02',
    element: (p, b) => <AwardLetter brand={b} p={p} />,
    previewProps: previewProps.award_letter,
  },
  agreement: {
    name: 'Grant agreement',
    spec: 'H-02',
    element: (p, b) => <GrantAgreement brand={b} p={p} />,
    previewProps: previewProps.agreement,
  },
  application_packet: {
    name: 'Application packet',
    spec: 'H-03',
    element: (p, b) => <ApplicationPacket brand={b} p={p} />,
    previewProps: previewProps.application_packet,
  },
  remittance: {
    name: 'Remittance advice',
    spec: 'H-04',
    element: (p, b) => <RemittanceAdvice brand={b} p={p} />,
    previewProps: previewProps.remittance,
  },
  board_book: {
    name: 'Board book',
    spec: 'H-05',
    element: (p, b) => <BoardBook brand={b} p={p} />,
    previewProps: previewProps.board_book,
  },
};

export const PDF_DOCUMENT_KEYS = Object.keys(pdfDocuments) as PdfDocumentKey[];

/** Renders a branded PDF. Uses only built-in PDF fonts; nothing is fetched except an optional https logo. */
export async function renderPdf<K extends PdfDocumentKey>(
  doc: K,
  props: PdfDocumentPropsMap[K],
  brand: Brand,
): Promise<Uint8Array> {
  const def = pdfDocuments[doc] as PdfDocumentDef<PdfDocumentPropsMap[K]> | undefined;
  if (!def) throw new Error(`Unknown PDF document: ${String(doc)}`);
  const buf = await renderToBuffer(
    def.element(props, resolveBrand(brand)) as Parameters<typeof renderToBuffer>[0],
  );
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** SHA-256 hex digest of document bytes (used to pin signatures to an exact document version). */
export function documentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
