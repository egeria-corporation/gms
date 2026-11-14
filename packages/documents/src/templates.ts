// SPDX-License-Identifier: AGPL-3.0-only
// The documents the GMS renders: award letter, grant agreement (with the click-to-sign audit
// record once signed) and application snapshot. Bodies are markdown with `{{merge.fields}}`
// (the `@gms/notify` renderer); a missing field fails the render instead of printing a blank.
import { merge, type MergeFields } from "@gms/notify";
import { parseMarkdown, renderPdf, type Block } from "./pdf.ts";

export const DEFAULT_AGREEMENT_TEMPLATE = `# Grant Agreement

This agreement is between {{funder.name}} ("Funder") and {{recipient.name}} ("Grantee").

## 1. Purpose and amount

The Funder awards {{award.amount}} to the Grantee for "{{award.title}}".

## 2. Grant period

The grant period runs from {{award.startDate}} to {{award.endDate}}.

## 3. Payment

Payments follow the schedule attached to this award in OpenGrants GMS and are made through OpenGrants Passport to the payment destination the Grantee has verified there. The Funder does not hold or edit the Grantee's bank details.

## 4. Use of funds

Funds are restricted to the approved purpose and budget. The Grantee will ask the Funder before making a material change to the purpose, budget or period.

## 5. Reporting

The Grantee will submit the reports and documents listed as requirements on this award by their due dates.

## 6. Conditions

{{award.conditions}}

## 7. Signatures

Each party signs electronically. A signature records the signer's typed name, the time, the network address and the SHA-256 hash of this document.
`;

export const DEFAULT_AWARD_LETTER_TEMPLATE = `# Award notification

Dear {{recipient.name}},

{{funder.name}} is pleased to offer an award of {{award.amount}} for "{{award.title}}".

The grant period runs from {{award.startDate}} to {{award.endDate}}. To accept, open the award in OpenGrants GMS, accept the offer and sign the grant agreement. Payments begin once the agreement is executed by both parties.

Sincerely,

{{funder.name}}
`;

/** A click-to-sign record as printed on the executed agreement. Never more than this. */
export interface PrintedSignature {
  party: string;
  name: string;
  at: string;
  ip: string;
  documentSha256: string;
}

export interface RenderMeta {
  /** Funder display name, printed in the header. */
  funderName: string;
  accent?: string;
  /** ISO timestamp: the document's date. Part of the bytes, so keep it stable for one version. */
  createdAt: string;
  /** e.g. `awd_…` or `agr_… v1`, printed in the footer. */
  reference: string;
}

/** Merge a markdown body. Values cannot add structure: line breaks inside a value become spaces. */
export function mergeDocument(body: string, fields: MergeFields): string {
  return merge(body, fields, (v) => v.replace(/\s*\r?\n\s*/g, " "));
}

export async function renderAwardLetter(body: string, fields: MergeFields, meta: RenderMeta): Promise<Uint8Array> {
  return renderPdf({ title: "Award notification", header: meta.funderName, footer: meta.reference, accent: meta.accent, createdAt: meta.createdAt, blocks: parseMarkdown(mergeDocument(body, fields)) });
}

/** The agreement as sent for signature: this is the document whose hash the signers attest to. */
export async function renderAgreement(body: string, fields: MergeFields, meta: RenderMeta): Promise<Uint8Array> {
  return renderPdf({ title: "Grant agreement", header: meta.funderName, footer: meta.reference, accent: meta.accent, createdAt: meta.createdAt, blocks: parseMarkdown(mergeDocument(body, fields)) });
}

/**
 * The executed agreement: the same text followed by the signature block and audit record.
 * `signedDocumentSha256` is the hash of the unsigned rendering both parties signed.
 */
export async function renderExecutedAgreement(body: string, fields: MergeFields, meta: RenderMeta, audit: { signedDocumentSha256: string; signatures: PrintedSignature[]; executedAt: string }): Promise<Uint8Array> {
  const blocks: Block[] = [...parseMarkdown(mergeDocument(body, fields)), { type: "rule" }, { type: "heading", level: 2, text: "Signature record" }];
  for (const s of audit.signatures) {
    blocks.push({ type: "heading", level: 3, text: s.party });
    blocks.push({ type: "fields", rows: [["Signed by", s.name], ["Signed at (UTC)", s.at], ["Network address", s.ip], ["Document SHA-256", s.documentSha256]] });
  }
  blocks.push({ type: "fields", rows: [["Executed at (UTC)", audit.executedAt], ["Signed document SHA-256", audit.signedDocumentSha256]] });
  blocks.push({ type: "paragraph", text: "Signed electronically in OpenGrants GMS. Each signer typed their name and confirmed their authority to sign; the record above is held in the GMS audit ledger." });
  return renderPdf({ title: "Grant agreement (executed)", header: meta.funderName, footer: `${meta.reference} · executed`, accent: meta.accent, createdAt: meta.createdAt, blocks });
}

export interface SnapshotForm {
  title: string;
  status: string;
  /** Field label → printed value, in form order. */
  fields: [label: string, value: string][];
}

/** A read-only record of an application as submitted. */
export async function renderApplicationSnapshot(input: { title: string; applicant: string; opportunity: string; submittedAt: string | null; verificationLevel: string | null; forms: SnapshotForm[] }, meta: RenderMeta): Promise<Uint8Array> {
  const blocks: Block[] = [
    { type: "heading", level: 1, text: input.title },
    { type: "fields", rows: [["Applicant", input.applicant], ["Opportunity", input.opportunity], ["Submitted (UTC)", input.submittedAt ?? "Not submitted"], ["Passport level at submit", input.verificationLevel ?? "Not recorded"]] },
  ];
  for (const f of input.forms) {
    blocks.push({ type: "rule" }, { type: "heading", level: 2, text: f.title });
    blocks.push(f.fields.length ? { type: "fields", rows: f.fields } : { type: "paragraph", text: "No answers." });
  }
  return renderPdf({ title: `Application snapshot: ${input.title}`, header: meta.funderName, footer: meta.reference, accent: meta.accent, createdAt: meta.createdAt, blocks });
}

/** Print any JSON answer on one line: money objects as an amount, lists joined, objects flattened. */
export function printValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(printValue).filter(Boolean).join("; ");
  const o = value as Record<string, unknown>;
  if (typeof o.amount === "string" && typeof o.currency === "string") return `${o.currency} ${o.amount}`;
  return Object.entries(o).map(([k, v]) => `${k}: ${printValue(v)}`).join(", ");
}

export interface OutsideSnapshotQuestion {
  phase: "loi" | "full" | "report";
  section: string | null;
  prompt: string;
  /** e.g. "250 words"; null when the funder set none. */
  limit: string | null;
  /** The latest saved answer; empty when none was written. */
  answer: string;
  /** e.g. "212 words · 1,301 characters". */
  counts: string;
}

export interface OutsideSnapshotInput {
  title: string;
  organization: string;
  funder: string | null;
  program: string | null;
  /** ISO timestamp the person says it was submitted; also the PDF's date, so the bytes are stable. */
  submittedAt: string;
  method: string;
  confirmationRef: string | null;
  questions: OutsideSnapshotQuestion[];
}

const PHASE_TITLE: Record<OutsideSnapshotQuestion["phase"], string> = { loi: "Letter of inquiry", full: "Full application", report: "Report" };

/**
 * An outside application as submitted (apply anywhere): every question and its latest answer,
 * for the applicant's own record. The GMS did not submit it; the person did, elsewhere. The same
 * input gives the same bytes, so the stored SHA-256 can be checked by rendering again.
 */
export async function renderOutsideSnapshot(input: OutsideSnapshotInput, meta: { reference: string }): Promise<Uint8Array> {
  const blocks: Block[] = [
    { type: "heading", level: 1, text: input.title },
    {
      type: "fields",
      rows: [
        ["Organization", input.organization],
        ["Funder", input.funder ?? "Not recorded"],
        ...(input.program ? ([["Program", input.program]] as [string, string][]) : []),
        ["Submitted (UTC)", input.submittedAt],
        ["Submitted by", input.method],
        ["Confirmation", input.confirmationRef ?? "None recorded"],
      ],
    },
    { type: "paragraph", text: "A record of what was submitted, kept by the organization in OpenGrants GMS. The application was submitted to the funder directly, not through the GMS." },
  ];
  if (!input.questions.length) blocks.push({ type: "rule" }, { type: "paragraph", text: "No questions were recorded." });
  let phase: OutsideSnapshotQuestion["phase"] | null = null;
  let section: string | null = null;
  input.questions.forEach((q, i) => {
    if (q.phase !== phase) {
      phase = q.phase;
      section = null;
      blocks.push({ type: "rule" }, { type: "heading", level: 2, text: PHASE_TITLE[q.phase] });
    }
    if (q.section && q.section !== section) {
      section = q.section;
      blocks.push({ type: "heading", level: 3, text: q.section });
    }
    blocks.push({ type: "paragraph", text: `${i + 1}. ${q.prompt}${q.limit ? ` (limit: ${q.limit})` : ""}` });
    const paras = q.answer.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    if (paras.length) for (const p of paras) blocks.push({ type: "paragraph", text: p.replace(/\n/g, " ") });
    else blocks.push({ type: "paragraph", text: "No answer." });
    blocks.push({ type: "fields", rows: [["Length", q.counts]] });
  });
  return renderPdf({ title: `As submitted: ${input.title}`, header: input.organization, footer: meta.reference, createdAt: input.submittedAt, blocks });
}
