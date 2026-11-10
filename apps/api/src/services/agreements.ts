// SPDX-License-Identifier: AGPL-3.0-only
// Grant agreements (build spec §4 E-sign, §10.1, §11.5): first-party click-to-sign. A signature
// is a typed name, an attestation, the network address, the time and the SHA-256 of the document
// that was sent. Signing is a human gate: only a signed-in person can do it, never an agent.
import { DEFAULT_AGREEMENT_TEMPLATE, DEFAULT_AWARD_LETTER_TEMPLATE, renderAgreement, renderAwardLetter, renderExecutedAgreement, sha256Hex, type PrintedSignature } from "@gms/documents";
import { MissingFieldError, type MergeFields } from "@gms/notify";
import { agreementMachine, executeAgreement, voidRefusal, type AgreementAction, type AgreementContext, type AgreementStatus, type AwardStatus, type SignatureRecord, type TrancheCondition, type TrancheStatus } from "@gms/workflow";
import { z } from "zod";
import { ApiError, notFound } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { passportFacts, primaryEmail, sendLetter } from "./apply.ts";
import { STAFF_ROLES, accessAward, agreementSummary, awardDetail, currencyOf, fundingOf, grantPorts, humanOnly, keyDatesOf, latestAgreement, minorOf, printMoney, readDefaults, type Agreement, type Award } from "./awards.ts";
import { checkSigner } from "./organization.ts";
import { audit, authorize, required, type ServiceContext, type ServiceWorkspace } from "./context.ts";

async function parties(ctx: ServiceContext, award: Award) {
  const funder = required(await ctx.repos.table("workspaces").one({ id: award.workspace_id }), "Workspace");
  const recipient = award.recipient_workspace_id ? await ctx.repos.table("workspaces").one({ id: award.recipient_workspace_id }) : null;
  return { funder, recipient };
}

export async function awardFields(ctx: ServiceContext, award: Award): Promise<{ fields: MergeFields; funderName: string; accent: string | undefined; recipientEmail: string | null; recipientHandle: string | null }> {
  const { funder, recipient } = await parties(ctx, award);
  const period = keyDatesOf(award).periodOfPerformance ?? {};
  const minor = minorOf(fundingOf(award).awardedAmount) ?? 0;
  const conditions = award.conditions.filter((c) => c !== "noAgreementRequired");
  const name = recipient?.display_name ?? (award.recipient_individual as { name?: string } | null)?.name ?? "the Grantee";
  return {
    fields: {
      funder: { name: funder.display_name },
      recipient: { name },
      award: { title: award.title, amount: printMoney(minor, currencyOf(award)), startDate: period.startDate ?? "the date this agreement is executed", endDate: period.endDate ?? "the date agreed in writing", conditions: conditions.length ? conditions.join("; ") : "No special conditions." },
      links: { award: recipient ? `${ctx.config.webBaseUrl}/w/${recipient.handle}/grants/${apiId("award", award.id)}/offer` : ctx.config.webBaseUrl },
    },
    funderName: funder.display_name,
    accent: (funder.brand as { accent?: string } | null)?.accent,
    recipientEmail: recipient ? primaryEmail(passportFacts(recipient).org) : null,
    recipientHandle: recipient?.handle ?? null,
  };
}

/** The agreement text for this row: its pinned template version, or the built-in standard agreement. */
async function bodyOf(ctx: ServiceContext, g: Agreement): Promise<string> {
  if (!g.template_id) return DEFAULT_AGREEMENT_TEMPLATE;
  return required(await ctx.repos.table("templates").one({ id: g.template_id }), "Agreement template").body;
}

const meta = (g: Agreement, funderName: string, accent: string | undefined) => ({ funderName, accent, createdAt: g.created_at, reference: `${apiId("agreement", g.id)} v${g.version}` });
const pdfPath = (g: Agreement, name: string) => `agreements/${g.workspace_id}/${g.id}/v${g.version}-${name}.pdf`;

const unprintable = (e: unknown) => {
  if (e instanceof MissingFieldError) return new ApiError(422, "missing_merge_fields", "The agreement template uses merge fields that have no value for this award", e.fields.map((f) => ({ code: "missing_field", field: f, detail: `{{${f}}} has no value` })));
  return e;
};

/** Render the document the parties sign. Deterministic for one agreement version. */
async function renderUnsigned(ctx: ServiceContext, g: Agreement, award: Award): Promise<Uint8Array> {
  const f = await awardFields(ctx, award);
  try {
    return await renderAgreement(await bodyOf(ctx, g), f.fields, meta(g, f.funderName, f.accent));
  } catch (e) {
    throw unprintable(e);
  }
}

async function renderExecuted(ctx: ServiceContext, g: Agreement, award: Award): Promise<Uint8Array> {
  const f = await awardFields(ctx, award);
  const sig = (party: string, s: SignatureRecord): PrintedSignature => ({ party, name: s.name, at: s.at, ip: s.ip, documentSha256: s.documentSha256 });
  return renderExecutedAgreement(await bodyOf(ctx, g), f.fields, meta(g, f.funderName, f.accent), {
    signedDocumentSha256: g.document_sha256!,
    executedAt: g.executed_at!,
    signatures: [sig(`Grantee: ${String((f.fields.recipient as MergeFields).name)}`, g.grantee_signature as unknown as SignatureRecord), sig(`Funder: ${f.funderName}`, g.funder_signature as unknown as SignatureRecord)],
  });
}

async function store(ctx: ServiceContext, g: Agreement, name: string, bytes: Uint8Array, sha256: string, award: Award): Promise<string | null> {
  if (!ctx.ports.storage) return null;
  const stored = await ctx.ports.storage.put(pdfPath(g, name), bytes, "application/pdf");
  await ctx.repos.table("documents").insert({ workspace_id: g.workspace_id, owner_workspace_id: g.workspace_id, subject_type: "agreement", subject_id: g.id, name: `${award.title} - grant agreement v${g.version} (${name}).pdf`.slice(0, 250), mime: "application/pdf", size: bytes.byteLength, sha256, storage: stored.storage, path: stored.path, uploaded_by: ctx.actor.userId });
  return stored.path;
}

export const agreementView = (g: Agreement) => ({
  ...agreementSummary(g),
  awardId: apiId("award", g.award_id),
  templateId: g.template_id,
  granteeSignature: g.grantee_signature ? { name: (g.grantee_signature as { name: string }).name, at: (g.grantee_signature as { at: string }).at } : null,
  funderSignature: g.funder_signature ? { name: (g.funder_signature as { name: string }).name, at: (g.funder_signature as { at: string }).at } : null,
  hasStoredPdf: !!g.rendered_pdf_path,
  createdAt: g.created_at,
});

/** Who may see an agreement: the funder and the recipient of its award. */
async function access(ctx: ServiceContext, agreementId: string, scope: "awards:read" | "agreements:write"): Promise<{ agreement: Agreement; award: Award; side: "funder" | "recipient"; ws: ServiceWorkspace }> {
  await authorize(ctx, { scope });
  const agreement = await ctx.repos.table("agreements").one({ id: agreementId });
  if (!agreement) throw notFound("Agreement");
  try {
    const found = await accessAward(ctx, agreement.award_id, scope);
    return { agreement, ...found };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) throw notFound("Agreement");
    throw e;
  }
}

async function transition(ctx: ServiceContext, g: Agreement, action: AgreementAction, side: "applicant" | "funder", machineCtx: AgreementContext): Promise<Agreement> {
  const r = await agreementMachine.transition({ id: g.id, status: g.status as AgreementStatus }, action, { id: ctx.actor.id, kind: side }, { ...machineCtx, now: ctx.now().toISOString() }, grantPorts(ctx, g.workspace_id));
  if (!r.ok) throw new ApiError(r.code === "actor_not_allowed" ? 403 : 409, r.code, r.reason);
  return required(await ctx.repos.table("agreements").one({ id: g.id }), "Agreement");
}

/** Create the draft agreement of an award. Used by decisions.commit and by `POST /awards/{id}/agreements`. */
export async function draftAgreement(ctx: ServiceContext, award: Award, templateId?: string | null): Promise<Agreement> {
  const current = await latestAgreement(ctx, award.id);
  if (current && current.status !== "voided") throw new ApiError(409, "agreement_exists", `This award already has an agreement that is ${current.status.replace(/_/g, " ")}. Void it before drafting another`);
  let pinned = templateId ?? null;
  if (!pinned && award.program_id) pinned = readDefaults(await ctx.repos.table("programs").one({ id: award.program_id })).agreementTemplateId ?? null;
  if (pinned) {
    const t = await ctx.repos.table("templates").one({ id: pinned });
    if (!t || t.kind !== "agreement" || (t.workspace_id !== null && t.workspace_id !== award.workspace_id)) throw new ApiError(422, "invalid_template", "That is not an agreement template of this workspace");
  }
  const row = await ctx.repos.table("agreements").insert({ workspace_id: award.workspace_id, award_id: award.id, template_id: pinned, version: (current?.version ?? 0) + 1, status: "draft" });
  // Render once now so a template that cannot print for this award is caught at drafting.
  await renderUnsigned(ctx, row, award);
  await audit(ctx, "agreement.drafted", "agreement", row.id, { awardId: award.id, version: row.version, templateId: pinned }, award.workspace_id);
  return row;
}

export const createAgreementInput = z.object({ templateId: z.uuid().optional() }).strict();

export async function createAgreement(ctx: ServiceContext, awardId: string, input: z.output<typeof createAgreementInput>) {
  await authorize(ctx, { scope: "agreements:write", kind: "funder", roles: STAFF_ROLES });
  const { award, side } = await accessAward(ctx, awardId, "agreements:write");
  if (side !== "funder") throw notFound("Award");
  if (["cancelled", "completed"].includes(award.status)) throw new ApiError(409, "invalid_status", `An award that is ${award.status} cannot get a new agreement`);
  return agreementView(await draftAgreement(ctx, award, input.templateId));
}

export async function getAgreement(ctx: ServiceContext, agreementId: string) {
  return agreementView((await access(ctx, agreementId, "awards:read")).agreement);
}

export const sendAgreementInput = z.object({ message: z.string().trim().max(5000).optional() }).strict();

/** Send the draft for signature: the document is rendered and hashed, and that hash is what both parties sign. */
export async function sendAgreement(ctx: ServiceContext, agreementId: string, _input: z.output<typeof sendAgreementInput> = {}) {
  await authorize(ctx, { scope: "agreements:write", kind: "funder", roles: STAFF_ROLES });
  const { agreement, award, side } = await access(ctx, agreementId, "agreements:write");
  if (side !== "funder") throw notFound("Agreement");
  const bytes = await renderUnsigned(ctx, agreement, award);
  const sha256 = await sha256Hex(bytes);
  const sent = await transition(ctx, agreement, "send", "funder", { documentSha256: sha256 });
  const path = await store(ctx, sent, "unsigned", bytes, sha256, award);
  if (path) await ctx.repos.table("agreements").update({ id: sent.id }, { rendered_pdf_path: path });
  const f = await awardFields(ctx, award);
  const letter = await sendLetter(ctx, "award_agreement", f.recipientEmail, f.fields, { type: "agreement", id: sent.id, workspaceId: award.workspace_id });
  return { ...agreementView(required(await ctx.repos.table("agreements").one({ id: sent.id }), "Agreement")), letter };
}

export const signInput = z
  .object({
    /** The signer's full legal name, as typed. */
    name: z.string().trim().min(2).max(200),
    /** The attestation checkbox. Must be true. */
    attest: z.literal(true, { error: "Confirm that you are authorized to sign" }),
    /** The hash shown to the signer; when given it must match the document that was sent. */
    documentSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  })
  .strict();

function signatureOf(ctx: ServiceContext, g: Agreement, input: z.output<typeof signInput>, ip: string): SignatureRecord {
  if (input.documentSha256 && input.documentSha256 !== g.document_sha256) throw new ApiError(409, "document_changed", "The agreement you reviewed is not the one on file. Reload it and sign again");
  return { name: input.name, userId: ctx.actor.userId!, attested: input.attest, ip, at: ctx.now().toISOString(), documentSha256: g.document_sha256 ?? "" };
}

/** The grantee signs. Human-only; the signer must be an admin of the recipient workspace, and the offer must be accepted first. */
export async function signAgreement(ctx: ServiceContext, agreementId: string, input: z.output<typeof signInput>, ip: string) {
  await authorize(ctx, { scope: "agreements:write", kind: "applicant", roles: ["admin"], person: true });
  if (ctx.actor.kind !== "user") throw humanOnly("Signing an agreement");
  const { agreement, award, side } = await access(ctx, agreementId, "agreements:write");
  if (side !== "recipient") throw notFound("Agreement");
  if (award.status === "offered") throw new ApiError(409, "offer_not_accepted", "Accept the award offer before signing the agreement");
  if (award.status !== "accepted") throw new ApiError(409, "invalid_status", `An award that is ${award.status} has no agreement to sign`);
  const signature = signatureOf(ctx, agreement, input, ip);
  // Passport says who may sign for the organization; where it cannot, the admin role stands.
  const authority = await checkSigner(ctx, award.recipient_workspace_id!, input.name);
  const signed = await transition(ctx, agreement, "sign", "applicant", { documentSha256: agreement.document_sha256, signature: { ...signature, authority } });
  await audit(ctx, "agreement.signer_checked", "agreement", agreement.id, { awardId: award.id, rule: authority.rule, reason: authority.reason, representativeId: authority.representativeId }, award.workspace_id);
  return { ...agreementView(signed), signerAuthority: authority };
}

/**
 * The funder countersigns, which executes the agreement: the award becomes active and tranches
 * conditioned on execution become due. The executed PDF (text plus signature record) is rendered,
 * stored and its hash ledgered.
 */
export async function countersignAgreement(ctx: ServiceContext, agreementId: string, input: z.output<typeof signInput>, ip: string) {
  await authorize(ctx, { scope: "agreements:write", kind: "funder", roles: STAFF_ROLES, person: true });
  if (ctx.actor.kind !== "user") throw humanOnly("Countersigning an agreement");
  const { agreement, award, side } = await access(ctx, agreementId, "agreements:write");
  if (side !== "funder") throw notFound("Agreement");
  const countersigned = await transition(ctx, agreement, "countersign", "funder", { documentSha256: agreement.document_sha256, signature: signatureOf(ctx, agreement, input, ip) });

  const tranches = await ctx.repos.table("tranches").find({ award_id: award.id }, { orderBy: "seq" });
  const result = await executeAgreement(
    { agreement: { id: countersigned.id, status: "countersigned" }, award: { id: award.id, status: award.status as AwardStatus, conditions: award.conditions }, tranches: tranches.map((t) => ({ id: t.id, status: t.status as TrancheStatus, condition: t.condition as unknown as TrancheCondition })) },
    { id: ctx.actor.id, kind: "funder" },
    { now: ctx.now().toISOString() },
    grantPorts(ctx, award.workspace_id),
  );
  if (!result.agreement.ok) throw new ApiError(409, result.agreement.code, result.agreement.reason);

  const executed = required(await ctx.repos.table("agreements").one({ id: agreement.id }), "Agreement");
  const bytes = await renderExecuted(ctx, executed, award);
  const executedPdfSha256 = await sha256Hex(bytes);
  const path = await store(ctx, executed, "executed", bytes, executedPdfSha256, award);
  if (path) await ctx.repos.table("agreements").update({ id: executed.id }, { rendered_pdf_path: path });
  await audit(ctx, "agreement.document_executed", "agreement", executed.id, { awardId: award.id, documentSha256: executed.document_sha256, executedPdfSha256, stored: !!path });
  return { ...agreementView(required(await ctx.repos.table("agreements").one({ id: executed.id }), "Agreement")), executedPdfSha256, awardStatus: result.award?.ok ? result.award.to : award.status, tranchesDue: result.tranchesDue.map((id) => apiId("tranche", id)) };
}

export const voidInput = z.object({ reason: z.string().trim().min(1).max(5000) }).strict();

export async function voidAgreement(ctx: ServiceContext, agreementId: string, input: z.output<typeof voidInput>) {
  await authorize(ctx, { scope: "agreements:write", kind: "funder", roles: STAFF_ROLES });
  const { agreement, side } = await access(ctx, agreementId, "agreements:write");
  if (side !== "funder") throw notFound("Agreement");
  const refusal = voidRefusal(agreement.status as AgreementStatus);
  if (refusal) throw new ApiError(409, "invalid_transition", refusal);
  const voided = await transition(ctx, agreement, "void", "funder", { reason: input.reason });
  await audit(ctx, "agreement.void_reason", "agreement", voided.id, { reason: input.reason });
  return agreementView(voided);
}

/** The agreement as a PDF: the executed document once executed, the document sent for signature before that. */
export async function agreementPdf(ctx: ServiceContext, agreementId: string): Promise<{ bytes: Uint8Array; sha256: string; filename: string; executed: boolean }> {
  const { agreement, award } = await access(ctx, agreementId, "awards:read");
  const executed = agreement.status === "executed";
  let bytes: Uint8Array | null = null;
  // The stored file is the record; rendering again is the fallback for installs without file storage.
  if (agreement.rendered_pdf_path && ctx.ports.storage) {
    const doc = await ctx.repos.table("documents").one({ subject_type: "agreement", subject_id: agreement.id, path: agreement.rendered_pdf_path });
    bytes = await ctx.ports.storage.get({ storage: (doc?.storage as "r2" | "supabase" | undefined) ?? "r2", path: agreement.rendered_pdf_path });
  }
  bytes ??= executed ? await renderExecuted(ctx, agreement, award) : await renderUnsigned(ctx, agreement, award);
  return { bytes, sha256: await sha256Hex(bytes), filename: `grant-agreement-${apiId("agreement", agreement.id)}-v${agreement.version}${executed ? "-executed" : ""}.pdf`, executed };
}

/** The award letter as a PDF, for the grantee's records and the funder's files. */
export async function awardLetterPdf(ctx: ServiceContext, awardId: string): Promise<{ bytes: Uint8Array; sha256: string; filename: string }> {
  const { award } = await accessAward(ctx, awardId, "awards:read");
  const f = await awardFields(ctx, award);
  const custom = (await ctx.repos.table("templates").find({ workspace_id: award.workspace_id, kind: "letter", name: "Award letter" }, { orderBy: "version", ascending: false, limit: 1 }))[0];
  let bytes: Uint8Array;
  try {
    bytes = await renderAwardLetter(custom?.body ?? DEFAULT_AWARD_LETTER_TEMPLATE, f.fields, { funderName: f.funderName, accent: f.accent, createdAt: award.created_at, reference: apiId("award", award.id) });
  } catch (e) {
    throw unprintable(e);
  }
  return { bytes, sha256: await sha256Hex(bytes), filename: `award-letter-${apiId("award", award.id)}.pdf` };
}

export { awardDetail };
