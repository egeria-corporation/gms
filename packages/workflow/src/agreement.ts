// SPDX-License-Identifier: AGPL-3.0-only
import { createMachine } from "./machine.ts";
import type { AgreementStatus } from "./statuses.ts";

export type AgreementAction = "send" | "sign" | "countersign" | "execute" | "void";

/** Click-to-sign audit record (typed name + checkbox + IP + timestamp + document SHA-256). */
export interface SignatureRecord {
  name: string;
  userId: string;
  attested: boolean;
  ip: string;
  at: string;
  documentSha256: string;
  /** Which rule let this person sign for their organization (grantee signatures). */
  authority?: { rule: "passport_representative" | "admin_role"; reason: string | null; representativeId: string | null; verificationLevel: string | null };
}

export interface AgreementContext {
  /** send: the rendered PDF exists and is hashed. */
  documentSha256?: string | null;
  signature?: SignatureRecord;
  /** void: why. */
  reason?: string;
  now?: string;
}

function signatureRefusal(ctx: AgreementContext): string | null {
  const s = ctx.signature;
  if (!s) return "A signature record is required.";
  if (!s.name.trim()) return "Type your full legal name to sign.";
  if (!s.attested) return "Check the attestation box to sign.";
  if (!s.ip || !s.at) return "The signature must record the IP address and time.";
  if (!ctx.documentSha256 || s.documentSha256 !== ctx.documentSha256) return "The signed document hash does not match the agreement that was sent.";
  return null;
}

export const agreementMachine = createMachine<AgreementStatus, AgreementAction, AgreementContext>({
  subjectType: "agreement",
  statuses: ["draft", "sent", "signed_by_grantee", "countersigned", "executed", "voided"],
  terminal: ["executed", "voided"],
  transitions: {
    send: {
      from: ["draft"],
      to: "sent",
      actors: ["funder"],
      guard: (ctx) => (ctx.documentSha256 ? null : "Render the agreement PDF before sending it."),
      patch: (c) => ({ document_sha256: c.documentSha256 }),
    },
    sign: { from: ["sent"], to: "signed_by_grantee", actors: ["applicant"], guard: signatureRefusal, patch: (c) => ({ grantee_signature: c.signature }) },
    countersign: { from: ["signed_by_grantee"], to: "countersigned", actors: ["funder"], guard: signatureRefusal, patch: (c) => ({ funder_signature: c.signature }) },
    execute: { from: ["countersigned"], to: "executed", actors: ["funder", "system"], patch: (c) => ({ executed_at: c.now ?? null }), events: ["agreement.executed"] },
    // Voiding an executed agreement is refused: `executed` is not in `from`. See `voidRefusal`.
    void: {
      from: ["draft", "sent", "signed_by_grantee", "countersigned"],
      to: "voided",
      actors: ["funder"],
      guard: (ctx) => (ctx.reason?.trim() ? null : "A reason is required to void an agreement."),
      patch: (c) => ({ void_reason: c.reason }),
    },
  },
});

/** The specific message for the one refusal users hit most. */
export function voidRefusal(status: AgreementStatus): string | null {
  if (status === "executed") return "An executed agreement cannot be voided. Issue an amendment instead.";
  if (status === "voided") return "This agreement is already voided.";
  return null;
}
