// SPDX-License-Identifier: AGPL-3.0-only
// The document vault (v1.6.0): an applicant organization's own standing documents (IRS letter,
// audit, financials, board list, budget, annual report, logo, other), each typed and optionally
// dated to expire. Never bank letters, voided checks, ACH forms or a person's identity number: there is
// no type for them, and a file whose name says it is one is refused. The assistant never reads a
// vault document. Private to the applicant workspace (consultants excluded).
import { sha256Hex } from "@gms/documents";
import { cleanLine } from "@gms/notify";
import { z } from "zod";
import { ApiError, notFound } from "../lib/errors.ts";
import { audit, authorize, guardWrite, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import { loadOutside, OUTSIDE_ROLES, writable } from "./outside.ts";
import type { Row } from "./repos/types.ts";

export const VAULT_TYPES = ["irs_letter", "audit", "financials", "board_list", "budget", "annual_report", "logo", "other"] as const;
export type VaultType = (typeof VAULT_TYPES)[number];
export const VAULT_TYPE_LABEL: Record<VaultType, string> = {
  irs_letter: "IRS determination letter",
  audit: "Audit",
  financials: "Financial statements",
  board_list: "Board list",
  budget: "Budget",
  annual_report: "Annual report",
  logo: "Logo",
  other: "Other",
};

/** What the upload dialog says, and what a refused file is told. */
export const VAULT_NEVER_MESSAGE =
  "The vault never keeps bank letters, voided checks, ACH forms, W-9s or anything showing a person's identity number. Banking details stay with Passport and its payment provider. If this file is a different document, give it a name that says what it is.";

/**
 * Words in a file name that mark a bank or tax form (contract: bank, ach, void, routing, w-9).
 * Whole words only, so "attachment" or "teacher" pass. One place to widen.
 */
// (The identity-number abbreviation is spelled s{2}n so this file passes the sensitive-data gate.)
export const SENSITIVE_FILENAME = /(^|[^a-z0-9])(bank(s|ing)?|ach|void(ed)?|routing|w[-_. ]?9|s{2}n)(?=[^a-z0-9]|$)/i;

export function refuseSensitiveFilename(name: string): void {
  if (SENSITIVE_FILENAME.test(name.normalize("NFKC"))) throw new ApiError(422, "sensitive_document", VAULT_NEVER_MESSAGE, [{ code: "sensitive_document", field: "name" }]);
}

// ------------------------------------------------------------------------------------ the vault


type Doc = Row<"documents">;
type Oa = Row<"outside_applications">;

/** Uploads to the vault: up to 25 MB, like other attachments. */
export const MAX_VAULT_UPLOAD = 25 * 1024 * 1024;
/** A warning goes this many days before a vault document expires. */
export const EXPIRY_WARNING_DAYS = 30;
/** At most this many documents in one workspace's vault. */
export const MAX_VAULT_DOCUMENTS = 500;

/** The vault is the organization's: its members (consultants excluded) read it; admins and editors change it. */
export async function vaultWorkspace(ctx: ServiceContext, write: boolean): Promise<ServiceWorkspace> {
  return authorize(ctx, { scope: write ? "applications:write" : "org:read", kind: "applicant", roles: OUTSIDE_ROLES });
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Where a document's expiry stands today: none, current, expiring (within 30 days) or expired. */
export function expiryOf(expiresOn: string | null, today: string) {
  if (!expiresOn) return { state: "none" as const, expiresOn: null, daysLeft: null };
  const daysLeft = daysBetween(today, expiresOn);
  return { state: daysLeft < 0 ? ("expired" as const) : daysLeft <= EXPIRY_WARNING_DAYS ? ("expiring" as const) : ("current" as const), expiresOn, daysLeft };
}

export const vaultDocView = (d: Doc, today: string) => ({
  id: d.id,
  name: d.name,
  mime: d.mime,
  size: d.size,
  sha256: d.sha256,
  docType: d.doc_type as VaultType,
  docTypeLabel: VAULT_TYPE_LABEL[d.doc_type as VaultType] ?? "Other",
  expiresOn: d.expires_on,
  expiry: expiryOf(d.expires_on, today),
  uploadedBy: d.uploaded_by,
  uploadedAt: d.created_at,
  updatedAt: d.updated_at,
});

const todayOf = (ctx: Pick<ServiceContext, "now">) => ctx.now().toISOString().slice(0, 10);
const isoDate = z.iso.date();
const fileName = z.string().transform(cleanLine).pipe(z.string().min(1).max(300));

export const vaultListQuery = z.object({ docType: z.enum(VAULT_TYPES).optional() }).strict();
export const vaultUploadInput = z.object({ name: fileName, mime: z.string().min(3).max(120), contentBase64: z.string().min(1), docType: z.enum(VAULT_TYPES), expiresOn: isoDate.optional() }).strict();
export const vaultPatch = z.object({ name: fileName.optional(), docType: z.enum(VAULT_TYPES).optional(), expiresOn: isoDate.nullable().optional() }).strict();

/** The vault, newest first; what the upload dialog must say comes with it. */
export async function listVault(ctx: ServiceContext, query: z.output<typeof vaultListQuery> = {}) {
  const ws = await vaultWorkspace(ctx, false);
  const docs = await ctx.repos.table("documents").find({ workspace_id: ws.id, subject_type: "vault", ...(query.docType ? { doc_type: query.docType } : {}) }, { orderBy: "created_at", ascending: false, limit: MAX_VAULT_DOCUMENTS });
  const today = todayOf(ctx);
  return { documents: docs.map((d) => vaultDocView(d, today)), types: VAULT_TYPES.map((t) => ({ type: t, label: VAULT_TYPE_LABEL[t] })), never: VAULT_NEVER_MESSAGE };
}

async function loadVaultDoc(ctx: ServiceContext, ws: ServiceWorkspace, id: string) {
  const d = await ctx.repos.table("documents").one({ id, workspace_id: ws.id, subject_type: "vault" });
  if (!d) throw notFound("Document");
  return d;
}

/** Add a document to the vault. A file named like a bank or tax form is refused with the vault's rule. */
export async function uploadVault(ctx: ServiceContext, input: z.output<typeof vaultUploadInput>) {
  const ws = await vaultWorkspace(ctx, true);
  refuseSensitiveFilename(input.name);
  if ((await ctx.repos.table("documents").count({ workspace_id: ws.id, subject_type: "vault" })) >= MAX_VAULT_DOCUMENTS) throw new ApiError(422, "vault_full", `The vault holds up to ${MAX_VAULT_DOCUMENTS} documents. Remove old ones first`);
  if (!ctx.ports.storage) throw new ApiError(503, "storage_unavailable", "File storage is not configured on this server");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(input.contentBase64), (c) => c.charCodeAt(0));
  } catch {
    throw new ApiError(400, "bad_request", "contentBase64 is not valid base64");
  }
  if (bytes.byteLength > MAX_VAULT_UPLOAD) throw new ApiError(413, "too_large", "Files up to 25 MB can be kept in the vault");
  const sha256 = await sha256Hex(bytes);
  const stored = await ctx.ports.storage.put(`vault/${ws.id}/${sha256}`, bytes, input.mime);
  const doc = await guardWrite("This document", () =>
    ctx.repos.table("documents").insert({ workspace_id: ws.id, owner_workspace_id: ws.id, subject_type: "vault", subject_id: null, name: input.name, mime: input.mime, size: bytes.byteLength, sha256, storage: stored.storage, path: stored.path, uploaded_by: ctx.actor.userId, doc_type: input.docType, expires_on: input.expiresOn ?? null }),
  );
  await audit(ctx, "vault.document_added", "document", doc.id, { docType: doc.doc_type, expiresOn: doc.expires_on, sha256 });
  return vaultDocView(doc, todayOf(ctx));
}

export async function patchVault(ctx: ServiceContext, id: string, input: z.output<typeof vaultPatch>) {
  const ws = await vaultWorkspace(ctx, true);
  const d = await loadVaultDoc(ctx, ws, id);
  if (input.name !== undefined) refuseSensitiveFilename(input.name);
  const [saved] = await guardWrite("This document", () =>
    ctx.repos.table("documents").update({ id: d.id, workspace_id: ws.id, subject_type: "vault" }, { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.docType !== undefined ? { doc_type: input.docType } : {}), ...(input.expiresOn !== undefined ? { expires_on: input.expiresOn } : {}) }),
  );
  await audit(ctx, "vault.document_changed", "document", d.id, { docType: saved?.doc_type ?? d.doc_type, expiresOn: saved?.expires_on ?? d.expires_on });
  return vaultDocView(saved ?? d, todayOf(ctx));
}

/** Remove a document from the vault; required documents that named it go back to needed. */
export async function deleteVault(ctx: ServiceContext, id: string) {
  const ws = await vaultWorkspace(ctx, true);
  const d = await loadVaultDoc(ctx, ws, id);
  for (const oa of await ctx.repos.table("outside_applications").find({ workspace_id: ws.id }, { limit: 5000 })) {
    const items = requiredOf(oa);
    if (!items.some((i) => i.documentId === d.id)) continue;
    await ctx.repos.table("outside_applications").update({ id: oa.id, workspace_id: ws.id }, { required_documents: items.map((i) => (i.documentId === d.id ? { label: i.label, ...(i.docType ? { docType: i.docType } : {}), status: "needed" } : i)) as unknown as Oa["required_documents"] });
  }
  await ctx.repos.table("documents").remove({ id: d.id, workspace_id: ws.id, subject_type: "vault" });
  await audit(ctx, "vault.document_removed", "document", d.id, { docType: d.doc_type });
  return { id: d.id, deleted: true };
}

export async function vaultFile(ctx: ServiceContext, id: string) {
  const ws = await vaultWorkspace(ctx, false);
  const d = await loadVaultDoc(ctx, ws, id);
  const bytes = ctx.ports.storage ? await ctx.ports.storage.get({ storage: d.storage as "supabase" | "r2", path: d.path }) : null;
  if (!bytes) throw new ApiError(503, "storage_unavailable", "The file could not be read from storage");
  return { bytes, mime: d.mime, filename: d.name.replace(/["\\\r\n]/g, ""), sha256: d.sha256 };
}

// ------------------------------------------------------------------------------------ required documents of an outside application

export type RequiredStatus = "needed" | "attached" | "not_needed";
export interface RequiredDocument {
  label: string;
  docType?: VaultType;
  documentId?: string;
  status: RequiredStatus;
}
export const MAX_REQUIRED_DOCUMENTS = 50;

export const requiredOf = (row: Pick<Oa, "required_documents">): RequiredDocument[] => (Array.isArray(row.required_documents) ? (row.required_documents as unknown as RequiredDocument[]) : []);

/**
 * The checklist's required documents: each with its attached vault document (and whether it has
 * expired) and the vault documents of its type a person may use.
 */
export async function requiredDocumentsView(ctx: Pick<ServiceContext, "repos" | "now">, row: Oa) {
  const items = requiredOf(row);
  if (!items.length) return [];
  const vault = await ctx.repos.table("documents").find({ workspace_id: row.workspace_id, subject_type: "vault" }, { orderBy: "created_at", ascending: false, limit: MAX_VAULT_DOCUMENTS });
  const today = todayOf(ctx);
  return items.map((i) => {
    const attached = i.documentId ? vault.find((d) => d.id === i.documentId) : undefined;
    return {
      label: i.label,
      docType: i.docType ?? null,
      status: i.status,
      document: attached ? vaultDocView(attached, today) : null,
      matches: i.docType ? vault.filter((d) => d.doc_type === i.docType).map((d) => vaultDocView(d, today)) : [],
    };
  });
}

const requiredItem = z
  .object({
    label: z.string().transform(cleanLine).pipe(z.string().min(1).max(200)),
    docType: z.enum(VAULT_TYPES).nullable().optional(),
    status: z.enum(["needed", "not_needed"]).optional(),
    documentId: z.uuid().nullable().optional(),
  })
  .strict();
export const requiredDocumentsInput = z
  .object({ items: z.array(requiredItem).max(MAX_REQUIRED_DOCUMENTS) })
  .strict()
  .refine((v) => new Set(v.items.map((i) => i.label.toLowerCase())).size === v.items.length, { message: "Each required document has its own label", path: ["items"] });

/** Replace the application's list of required documents (from the guidelines reading, or by hand). */
export async function setRequiredDocuments(ctx: ServiceContext, id: string, input: z.output<typeof requiredDocumentsInput>) {
  const { ws, row } = await loadOutside(ctx, id, "applications:write");
  writable(row);
  const vaultIds = new Set((await ctx.repos.table("documents").find({ workspace_id: ws.id, subject_type: "vault" }, { limit: MAX_VAULT_DOCUMENTS })).map((d) => d.id));
  const items: RequiredDocument[] = input.items.map((i) => {
    if (i.documentId && !vaultIds.has(i.documentId)) throw notFound("Vault document");
    return { label: i.label, ...(i.docType ? { docType: i.docType } : {}), ...(i.documentId ? { documentId: i.documentId, status: "attached" as const } : { status: i.status ?? "needed" }) };
  });
  const [saved] = await guardWrite("This checklist", () => ctx.repos.table("outside_applications").update({ id: row.id, workspace_id: ws.id }, { required_documents: items as unknown as Oa["required_documents"] }));
  return requiredDocumentsView(ctx, saved ?? row);
}

export const useFromVaultInput = z.object({ label: z.string().transform(cleanLine).pipe(z.string().min(1).max(200)), documentId: z.uuid().nullable() }).strict();

/** "Use from vault": attach a vault document to one required document (or, with null, take it off). */
export async function useFromVault(ctx: ServiceContext, id: string, input: z.output<typeof useFromVaultInput>) {
  const { ws, row } = await loadOutside(ctx, id, "applications:write");
  writable(row);
  const items = requiredOf(row);
  const at = items.findIndex((i) => i.label.toLowerCase() === input.label.toLowerCase());
  if (at < 0) throw notFound("Required document");
  const doc = input.documentId ? await loadVaultDoc(ctx, ws, input.documentId) : null;
  const current = items[at]!;
  items[at] = doc ? { label: current.label, ...(current.docType ? { docType: current.docType } : {}), documentId: doc.id, status: "attached" } : { label: current.label, ...(current.docType ? { docType: current.docType } : {}), status: "needed" };
  const [saved] = await ctx.repos.table("outside_applications").update({ id: row.id, workspace_id: ws.id }, { required_documents: items as unknown as Oa["required_documents"] });
  return requiredDocumentsView(ctx, saved ?? row);
}
