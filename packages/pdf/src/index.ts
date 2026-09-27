// SPDX-License-Identifier: AGPL-3.0-only
export {
  documentHash,
  pdfDocuments,
  PDF_DOCUMENT_KEYS,
  renderPdf,
  type PdfDocumentDef,
  type PdfDocumentKey,
  type PdfDocumentPropsMap,
} from './render';
export { resolveBrand, type Brand, type ResolvedBrand } from './brand';
export { previewBrand, previewProps } from './fixtures';
export type { Installment, ReportingRequirement, SignatureParty, SignatureRecord } from './components';
export type { AwardLetterProps, AwardTerms, GrantAgreementProps } from './documents/awards';
export type {
  ApplicationPacketProps,
  EligibilityResult,
  PacketAnswer,
  PacketAttachment,
} from './documents/application-packet';
export type { RemittanceAdviceProps } from './documents/remittance';
export type { BoardBookProps, BoardRecommendation } from './documents/board-book';
