// SPDX-License-Identifier: AGPL-3.0-only
// Applicant organizations (the applicant commons), EIN lookup, document vault.
import { randomUUID } from 'node:crypto';
import { sql } from '@gms/db';
import { DomainError, formatEin } from '@gms/domain';
import { z } from 'zod';
import { defineAction } from '../define';
import { found, IdOut, Ok, uid, uuid } from './lib';

const Ein = z
  .string()
  .trim()
  .transform((v, c) => {
    const f = formatEin(v);
    if (!f) {
      c.addIssue({ code: 'custom', message: 'An EIN has 9 digits, like 12-3456789.' });
      return z.NEVER;
    }
    return f;
  });

const OrgType = z.enum(['nonprofit_501c3', 'fiscally_sponsored', 'nonprofit_other', 'government', 'tribal', 'school', 'for_profit', 'individual']);

export const IrsLookupOut = z.object({
  status: z.enum(['found', 'not_found', 'warning']),
  ein: z.string(),
  record: z
    .object({
      name: z.string(),
      city: z.string().nullable(),
      state: z.string().nullable(),
      subsection: z.string().nullable(),
      status: z.string(),
      pub78: z.boolean(),
      deductibility: z.string().nullable(),
    })
    .nullable(),
  message: z.string(),
  alreadyRegistered: z.boolean(),
});

export const lookupEin = defineAction({
  id: 'orgs.lookup_ein',
  title: 'Look up an EIN',
  description:
    'Looks up a U.S. EIN in the IRS exempt-organization data GMS has imported. Returns found (with legal name and city to prefill), not_found, or warning (for example, revoked status). Read-only.',
  input: z.object({ ein: Ein }),
  output: IrsLookupOut,
  scopes: ['profile:read'],
  roles: ['authenticated'],
  riskTier: 'R0',
  idempotent: true,
  requiresWorkspace: false,
  async run(input, ctx) {
    const rec = await ctx.db.selectFrom('irs_exempt_orgs').selectAll().where('ein', '=', input.ein).executeTakeFirst();
    const registered = await ctx.db.selectFrom('applicant_orgs').select('id').where('ein', '=', input.ein).executeTakeFirst();
    if (!rec) {
      return {
        status: 'not_found' as const,
        ein: input.ein,
        record: null,
        alreadyRegistered: Boolean(registered),
        message:
          'We could not find this EIN in the IRS list we use. That is okay — you can still continue. If you are fiscally sponsored, choose that option and enter your sponsor’s EIN.',
      };
    }
    const warn = rec.status !== 'active';
    return {
      status: warn ? ('warning' as const) : ('found' as const),
      ein: input.ein,
      alreadyRegistered: Boolean(registered),
      record: {
        name: rec.name,
        city: rec.city,
        state: rec.state,
        subsection: rec.subsection,
        status: rec.status,
        pub78: rec.pub78,
        deductibility: rec.deductibility,
      },
      message: warn
        ? `The IRS lists this organization’s exempt status as ${rec.status}. You can continue, but the foundation may ask for more information.`
        : `We found ${rec.name}${rec.city ? ` in ${rec.city}, ${rec.state}` : ''}. We filled in what we could — please check it.`,
    };
  },
});

const AddressIn = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(2).max(50),
  postalCode: z.string().trim().min(3).max(20),
  county: z.string().trim().max(100).optional().nullable(),
});

const OrgIn = z.object({
  legalName: z.string().trim().min(1).max(300),
  dbaName: z.string().trim().max(300).optional().nullable(),
  ein: Ein.optional().nullable(),
  uei: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{12}$/, 'A UEI has 12 letters and numbers.')
    .optional()
    .nullable()
    .or(z.literal('')),
  orgType: OrgType,
  mission: z.string().trim().max(2000).optional().nullable(),
  annualBudgetCents: z.number().int().min(0).optional().nullable(),
  website: z.string().trim().max(300).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email().optional().nullable().or(z.literal('')),
  counties: z.array(z.string().max(80)).max(50).default([]),
  fiscalSponsorName: z.string().trim().max(300).optional().nullable(),
  fiscalSponsorEin: Ein.optional().nullable(),
  address: AddressIn.optional(),
});

export const createOrg = defineAction({
  id: 'orgs.create',
  title: 'Set up an organization',
  description:
    'Creates an applicant organization profile and makes the signed-in person its admin. Use orgs.lookup_ein first to prefill from IRS data. If the EIN is already registered, ask that organization’s admin to invite you instead.',
  input: OrgIn,
  output: IdOut,
  scopes: ['profile:write'],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: true,
  requiresWorkspace: false,
  async run(input, ctx) {
    const me = uid(ctx);
    if (input.orgType === 'fiscally_sponsored' && (!input.fiscalSponsorName || !input.fiscalSponsorEin)) {
      throw new DomainError('validation_failed', 'Tell us about your fiscal sponsor.', {}, [
        ...(!input.fiscalSponsorName ? [{ pointer: '/fiscalSponsorName', message: 'Enter your fiscal sponsor’s legal name.' }] : []),
        ...(!input.fiscalSponsorEin ? [{ pointer: '/fiscalSponsorEin', message: 'Enter your fiscal sponsor’s EIN.' }] : []),
      ]);
    }
    const id = randomUUID();
    try {
      await ctx.db
        .insertInto('applicant_orgs')
        .values({
          id,
          legal_name: input.legalName,
          dba_name: input.dbaName ?? null,
          ein: input.ein ?? null,
          uei: input.uei || null,
          org_type: input.orgType,
          mission: input.mission ?? null,
          annual_budget_cents: input.annualBudgetCents ?? null,
          website: input.website ?? null,
          phone: input.phone ?? null,
          email: input.email || null,
          counties: input.counties,
          fiscal_sponsor_name: input.fiscalSponsorName ?? null,
          fiscal_sponsor_ein: input.fiscalSponsorEin ?? null,
          created_by: me,
        })
        .execute();
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new DomainError('conflict', 'An organization with this EIN is already set up in GMS. Ask its admin to invite you as a collaborator.', {}, [
          { pointer: '/ein', message: 'This EIN is already registered.' },
        ]);
      }
      throw err;
    }
    await ctx.db.insertInto('applicant_org_members').values({ org_id: id, user_id: me, role: 'org_admin' }).execute();
    let verified = false;
    if (input.ein) {
      const v = await sql<{ verified: boolean }>`select * from gms_private.verify_org_ein(${id}::uuid, null)`.execute(ctx.db);
      verified = Boolean(v.rows[0]?.verified);
    }
    if (input.address) {
      await ctx.db
        .insertInto('org_addresses')
        .values({
          org_id: id,
          kind: 'mailing',
          line1: input.address.line1,
          line2: input.address.line2 ?? null,
          city: input.address.city,
          state: input.address.state,
          postal_code: input.address.postalCode,
          county: input.address.county ?? null,
        })
        .execute();
    }
    ctx.audit({ entityType: 'applicant_org', entityId: id, after: { legalName: input.legalName, ein: input.ein ?? null, verified } });
    return { id };
  },
});

export const updateOrg = defineAction({
  id: 'orgs.update',
  title: 'Update organization profile',
  description: 'Updates an organization profile the signed-in person administers. Changing the EIN re-runs IRS verification.',
  input: OrgIn.partial().extend({ orgId: uuid }),
  output: Ok,
  scopes: ['profile:write'],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: true,
  requiresWorkspace: false,
  async run(input, ctx) {
    const before = found(await ctx.db.selectFrom('applicant_orgs').selectAll().where('id', '=', input.orgId).executeTakeFirst(), 'organization');
    const patch: Record<string, unknown> = {};
    const map: [keyof typeof input, string][] = [
      ['legalName', 'legal_name'],
      ['dbaName', 'dba_name'],
      ['orgType', 'org_type'],
      ['mission', 'mission'],
      ['annualBudgetCents', 'annual_budget_cents'],
      ['website', 'website'],
      ['phone', 'phone'],
      ['counties', 'counties'],
      ['fiscalSponsorName', 'fiscal_sponsor_name'],
      ['fiscalSponsorEin', 'fiscal_sponsor_ein'],
    ];
    for (const [k, col] of map) if (input[k] !== undefined) patch[col] = input[k];
    if (input.email !== undefined) patch.email = input.email || null;
    if (input.uei !== undefined) patch.uei = input.uei || null;
    if (Object.keys(patch).length) {
      const r = await ctx.db.updateTable('applicant_orgs').set(patch).where('id', '=', input.orgId).executeTakeFirst();
      if (!Number(r.numUpdatedRows)) throw new DomainError('forbidden', 'Only an organization admin can change the profile.');
    }
    if (input.ein !== undefined && input.ein !== before.ein && input.ein) {
      await sql`select * from gms_private.verify_org_ein(${input.orgId}::uuid, ${input.ein})`.execute(ctx.db);
      patch.ein = input.ein;
    }
    if (input.address) {
      await ctx.db
        .insertInto('org_addresses')
        .values({
          org_id: input.orgId,
          kind: 'mailing',
          line1: input.address.line1,
          line2: input.address.line2 ?? null,
          city: input.address.city,
          state: input.address.state,
          postal_code: input.address.postalCode,
          county: input.address.county ?? null,
        })
        .onConflict((oc) =>
          oc.columns(['org_id', 'kind']).doUpdateSet({
            line1: input.address!.line1,
            line2: input.address!.line2 ?? null,
            city: input.address!.city,
            state: input.address!.state,
            postal_code: input.address!.postalCode,
            county: input.address!.county ?? null,
          }),
        )
        .execute();
    }
    ctx.audit({ entityType: 'applicant_org', entityId: input.orgId, before: { legalName: before.legal_name, ein: before.ein }, after: patch });
    return { ok: true as const };
  },
});

// Document vault ----------------------------------------------------------------------
const DOC_TYPES = ['determination_letter', 'audit', 'financial_statement', 'form_990', 'budget', 'board_list', 'fiscal_sponsor_agreement', 'w9', 'other'] as const;
export const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel (.xlsx)',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word (.docx)',
  'text/csv': 'CSV',
  'image/png': 'PNG image',
  'image/jpeg': 'JPEG image',
};
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function safeFileName(name: string): string {
  const cleaned = name.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(-120);
  return cleaned || 'file';
}

const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/** Accepts MIME types or file extensions ("pdf", ".xlsx") in `accept`. */
export function assertUploadAllowed(contentType: string, sizeBytes: number, opts: { accept?: string[]; maxBytes?: number } = {}): void {
  const accept = opts.accept?.length
    ? [...new Set(opts.accept.map((a) => (a.includes('/') ? a : (EXT_TO_MIME[a.replace(/^\./, '').toLowerCase()] ?? a))))]
    : Object.keys(ALLOWED_UPLOAD_TYPES);
  if (!accept.includes(contentType) || !ALLOWED_UPLOAD_TYPES[contentType]) {
    const names = accept.map((t) => ALLOWED_UPLOAD_TYPES[t] ?? t).join(', ');
    throw new DomainError('validation_failed', `That file type is not accepted here. Use ${names}.`, {}, [{ pointer: '/contentType', message: `Accepted: ${names}` }]);
  }
  const max = Math.min(opts.maxBytes ?? MAX_UPLOAD_BYTES, MAX_UPLOAD_BYTES);
  if (sizeBytes > max) {
    throw new DomainError('validation_failed', `That file is too large. The limit is ${Math.round(max / 1024 / 1024)} MB.`, {}, [
      { pointer: '/sizeBytes', message: `Max ${Math.round(max / 1024 / 1024)} MB` },
    ]);
  }
}

export const requestDocumentUpload = defineAction({
  id: 'orgs.request_document_upload',
  title: 'Upload a document to the vault',
  description: 'Returns a short-lived signed URL to upload a document into the organization’s vault (PDF, DOCX, XLSX, CSV, PNG, JPEG; up to 25 MB). Call orgs.confirm_document_upload after the upload finishes.',
  input: z.object({
    orgId: uuid,
    docType: z.enum(DOC_TYPES),
    title: z.string().trim().min(1).max(200),
    fileName: z.string().min(1).max(200),
    contentType: z.string(),
    sizeBytes: z.number().int().positive(),
    expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }),
  output: z.object({ documentId: z.string().uuid(), uploadUrl: z.string(), method: z.string(), headers: z.record(z.string(), z.string()), expiresAt: z.string() }),
  scopes: ['profile:write'],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: false,
  requiresWorkspace: false,
  async run(input, ctx) {
    assertUploadAllowed(input.contentType, input.sizeBytes);
    const id = randomUUID();
    const key = `orgs/${input.orgId}/${id}/${safeFileName(input.fileName)}`;
    await ctx.db
      .insertInto('org_documents')
      .values({
        id,
        org_id: input.orgId,
        doc_type: input.docType,
        title: input.title,
        storage_path: key,
        content_type: input.contentType,
        size_bytes: input.sizeBytes,
        expires_on: input.expiresOn ?? null,
        scan_status: 'pending',
        uploaded_by: uid(ctx),
      })
      .execute();
    const signed = await ctx.deps.storage.createSignedUploadUrl('org-documents', key, { contentType: input.contentType, maxBytes: input.sizeBytes });
    const url = signed.url.startsWith('/') ? `${ctx.deps.origin(ctx.workspace?.slug ?? null)}${signed.url}` : signed.url;
    ctx.audit({ entityType: 'org_document', entityId: id, after: { orgId: input.orgId, docType: input.docType, title: input.title } });
    return { documentId: id, uploadUrl: url, method: signed.method, headers: signed.headers, expiresAt: signed.expiresAt };
  },
});

export const confirmDocumentUpload = defineAction({
  id: 'orgs.confirm_document_upload',
  title: 'Confirm a vault upload',
  description: 'Confirms a finished vault upload; GMS checks the file and scans it when a scanner is configured.',
  input: z.object({ documentId: uuid }),
  output: z.object({ scanStatus: z.string() }),
  scopes: ['profile:write'],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: true,
  requiresWorkspace: false,
  async run(input, ctx) {
    const doc = found(await ctx.db.selectFrom('org_documents').selectAll().where('id', '=', input.documentId).executeTakeFirst(), 'document');
    const head = await ctx.deps.storage.head('org-documents', doc.storage_path);
    if (!head) throw new DomainError('precondition_failed', 'We did not receive the file. Try uploading again.');
    const bytes = await ctx.deps.storage.get('org-documents', doc.storage_path);
    const scan = bytes ? await ctx.deps.scanner.scan(bytes) : { status: 'not_scanned' as const };
    if (doc.scan_status === 'pending') {
      await sql`select gms_private.record_scan('org_document', ${doc.id}::uuid, ${scan.status}, ${null}, ${head.size})`.execute(ctx.db);
    }
    if (scan.status === 'infected') {
      await ctx.deps.storage.delete('org-documents', doc.storage_path);
    }
    ctx.audit({ entityType: 'org_document', entityId: doc.id, after: { scanStatus: scan.status } });
    return { scanStatus: scan.status };
  },
});

export const deleteDocument = defineAction({
  id: 'orgs.delete_document',
  title: 'Remove a vault document',
  description: 'Removes a document from the organization vault. Copies attached to submitted applications are kept.',
  input: z.object({ documentId: uuid }),
  output: Ok,
  scopes: ['profile:write'],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: true,
  requiresWorkspace: false,
  async run(input, ctx) {
    const doc = found(await ctx.db.selectFrom('org_documents').selectAll().where('id', '=', input.documentId).executeTakeFirst(), 'document');
    const r = await ctx.db.deleteFrom('org_documents').where('id', '=', doc.id).executeTakeFirst();
    if (!Number(r.numDeletedRows)) throw new DomainError('forbidden', 'Only an organization admin can remove documents.');
    await ctx.deps.storage.delete('org-documents', doc.storage_path);
    ctx.audit({ entityType: 'org_document', entityId: doc.id, before: { title: doc.title } });
    return { ok: true as const };
  },
});
