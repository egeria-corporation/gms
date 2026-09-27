// SPDX-License-Identifier: AGPL-3.0-only
// Admin extras: brand asset uploads, integrations settings (email domain, OpenGrants syndication),
// race-safe first-run setup (F-01…F-05, `pnpm run setup`) and operator view auditing (G-02).
import { randomBytes } from 'node:crypto';
import { sql } from '@gms/db';
import { DomainError, WORKSPACE_ROLES } from '@gms/domain';
import { FORM_TEMPLATES, templateModel } from '@gms/forms';
import { z } from 'zod';
import { defineAction, getAction, type RunContext } from '../define';
import { Email, found, Ok, uuid, ws } from './lib';

const ADMIN = ['owner', 'admin'] as const;

// Brand assets (S-01) ---------------------------------------------------------------------------------
/** Raster formats only: SVG can carry script, so it is never accepted for logos served from our origin. */
export const BRAND_ASSET_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/x-icon': 'ico' } as const;
export const BRAND_ASSET_MAX_BYTES = 2 * 1024 * 1024;

export const requestBrandAssetUpload = defineAction({
  id: 'brand.request_asset_upload',
  title: 'Upload a logo or favicon',
  description:
    'Returns a short-lived signed URL to upload the workspace logo or favicon (PNG, JPEG, WebP or ICO; up to 2 MB). After uploading, save the returned path with brand.update (logoPath or faviconPath).',
  input: z.object({
    kind: z.enum(['logo', 'favicon']),
    contentType: z.enum(Object.keys(BRAND_ASSET_TYPES) as [keyof typeof BRAND_ASSET_TYPES, ...(keyof typeof BRAND_ASSET_TYPES)[]]),
    sizeBytes: z.number().int().positive().max(BRAND_ASSET_MAX_BYTES, 'Logos can be up to 2 MB.'),
  }),
  output: z.object({ path: z.string(), uploadUrl: z.string(), method: z.string(), headers: z.record(z.string(), z.string()), expiresAt: z.string() }),
  scopes: [],
  roles: ADMIN,
  riskTier: 'R1',
  idempotent: false,
  async run(input, ctx) {
    const w = ws(ctx);
    const path = `${w.id}/${input.kind}-${randomBytes(6).toString('hex')}.${BRAND_ASSET_TYPES[input.contentType]}`;
    const signed = await ctx.deps.storage.createSignedUploadUrl('brand', path, { contentType: input.contentType, maxBytes: input.sizeBytes, expiresInSeconds: 600 });
    ctx.audit({ entityType: 'workspace_brand', entityId: w.id, after: { upload: input.kind, path } });
    return { path, uploadUrl: signed.url, method: signed.method, headers: signed.headers, expiresAt: signed.expiresAt };
  },
});

// Integrations (S-03) ----------------------------------------------------------------------------------
const Hostname = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'Enter a domain like grants.example.org');

export const setEmailDomain = defineAction({
  id: 'integrations.set_email_domain',
  title: 'Set the email sending domain',
  description: 'Sets (or clears) the domain GMS sends email from. The domain starts as pending until its DNS records (SPF, DKIM, DMARC) are verified.',
  input: z.object({ domain: Hostname.nullable() }),
  output: Ok,
  scopes: [],
  roles: ADMIN,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const before = await ctx.db.selectFrom('workspace_settings').select(['email_domain', 'email_domain_status']).where('workspace_id', '=', w.id).executeTakeFirst();
    const status = input.domain ? (input.domain === before?.email_domain ? (before?.email_domain_status ?? 'pending') : 'pending') : 'unverified';
    await ctx.db.updateTable('workspace_settings').set({ email_domain: input.domain, email_domain_status: status }).where('workspace_id', '=', w.id).execute();
    ctx.audit({ entityType: 'workspace_settings', entityId: w.id, before, after: { email_domain: input.domain, email_domain_status: status } });
    return { ok: true as const };
  },
});

export const setOpenGrantsSyndication = defineAction({
  id: 'integrations.set_syndication',
  title: 'Turn OpenGrants syndication on or off',
  description: 'Chooses whether published opportunities are offered to the OpenGrants directory (stub adapter in v1: nothing leaves GMS yet).',
  input: z.object({ enabled: z.boolean() }),
  output: Ok,
  scopes: [],
  roles: ADMIN,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    await ctx.db.updateTable('workspace_settings').set({ opengrants_syndication: input.enabled }).where('workspace_id', '=', w.id).execute();
    ctx.audit({ entityType: 'workspace_settings', entityId: w.id, after: { opengrants_syndication: input.enabled } });
    return { ok: true as const };
  },
});

// First-run setup (F-01…F-05) ---------------------------------------------------------------------------
async function runNested<T>(actionId: string, raw: unknown, ctx: RunContext): Promise<T> {
  const action = found(getAction(actionId), 'action');
  const input = action.input.parse(raw);
  return (await action.run(input, ctx)) as T;
}

const InviteRow = z.object({ email: Email, role: z.enum(WORKSPACE_ROLES).refine((r) => r !== 'owner', 'Invite other owners later, from Team settings.') });

export const SETUP_PAYMENT_CHOICES = ['fake', 'sandbox', 'manual', 'later'] as const;

export const initializeWorkspace = defineAction({
  id: 'setup.initialize',
  title: 'Set up a new workspace',
  description:
    'System: race-safe first-run setup. Under an advisory lock it re-checks that no workspace exists (unless allowExisting), runs setup.create_workspace, then optionally creates the first program, a draft form from a template and a draft opportunity, invites the team, and records the payments choice for after sign-in.',
  input: z.object({
    slug: z.string(),
    name: z.string(),
    ownerEmail: z.string(),
    ownerName: z.string(),
    timezone: z.string().optional(),
    primaryColor: z.string().optional(),
    accentColor: z.string().optional(),
    headingFont: z.string().optional(),
    emailSenderName: z.string().optional(),
    emailReplyTo: z.string().trim().email().nullable().optional(),
    allowExisting: z.boolean().default(false),
    program: z.object({ name: z.string().trim().min(1).max(200), causeArea: z.string().trim().max(120).nullable().optional() }).nullable().optional(),
    opportunity: z
      .object({ title: z.string().trim().min(1).max(300), templateKey: z.enum(FORM_TEMPLATES.map((t) => t.key) as [string, ...string[]]) })
      .nullable()
      .optional(),
    invites: z.array(InviteRow).max(20).default([]),
    paymentsChoice: z.enum(SETUP_PAYMENT_CHOICES).default('later'),
  }),
  output: z.object({ workspaceId: z.string().uuid(), ownerId: z.string().uuid(), slug: z.string(), programId: z.string().uuid().nullable(), opportunityId: z.string().uuid().nullable(), invited: z.number() }),
  scopes: [],
  roles: ['system'],
  riskTier: 'R1',
  idempotent: true,
  requiresWorkspace: false,
  async run(input, ctx) {
    // Serializes concurrent setup attempts; the check below then sees any workspace created first.
    await sql`select pg_advisory_xact_lock(hashtext('gms.setup.initialize'))`.execute(ctx.db);
    if (!input.allowExisting) {
      const existing = await ctx.db.selectFrom('workspaces').select('id').limit(1).executeTakeFirst();
      if (existing) throw new DomainError('conflict', 'This GMS is already set up. Sign in instead.');
    }
    const created = await runNested<{ workspaceId: string; ownerId: string }>(
      'setup.create_workspace',
      {
        slug: input.slug,
        name: input.name,
        ownerEmail: input.ownerEmail,
        ownerName: input.ownerName,
        ...(input.timezone ? { timezone: input.timezone } : {}),
        ...(input.primaryColor ? { primaryColor: input.primaryColor } : {}),
        ...(input.accentColor ? { accentColor: input.accentColor } : {}),
        ...(input.headingFont ? { headingFont: input.headingFont } : {}),
        ...(input.emailSenderName ? { emailSenderName: input.emailSenderName } : {}),
      },
      ctx,
    );
    const w = found(await ctx.db.selectFrom('workspaces').select(['id', 'slug', 'name', 'timezone']).where('id', '=', created.workspaceId).executeTakeFirst(), 'workspace');
    if (input.emailReplyTo) await ctx.db.updateTable('workspace_brand').set({ email_reply_to: input.emailReplyTo }).where('workspace_id', '=', w.id).execute();
    // Follow-on steps run as the new owner (inside this service transaction), so created_by / invited_by
    // point at the person who set the workspace up.
    const asOwner: RunContext = { ...ctx, workspace: w, claims: { role: 'authenticated', sub: created.ownerId, email: input.ownerEmail }, roles: ['owner'] };
    let programId: string | null = null;
    let opportunityId: string | null = null;
    if (input.program) {
      programId = (await runNested<{ id: string }>('programs.create', { name: input.program.name, causeArea: input.program.causeArea ?? null, leadUserId: created.ownerId }, asOwner)).id;
    }
    if (input.opportunity) {
      const tpl = FORM_TEMPLATES.find((t) => t.key === input.opportunity!.templateKey)!;
      const form = await runNested<{ formId: string }>('forms.create', { name: tpl.name, kind: tpl.kind, description: tpl.description, model: templateModel(tpl.key) }, asOwner);
      const opp = await runNested<{ id: string; competitionId: string }>('opportunities.create', { title: input.opportunity.title, programId }, asOwner);
      await runNested('competitions.attach_form', { competitionId: opp.competitionId, formId: form.formId }, asOwner);
      opportunityId = opp.id;
    }
    for (const inv of input.invites) {
      if (inv.email === input.ownerEmail.toLowerCase()) continue;
      await runNested('team.invite', inv, asOwner);
    }
    await ctx.db
      .updateTable('workspaces')
      .set({ feature_flags: sql`feature_flags || ${JSON.stringify({ [`setup_payments_${input.paymentsChoice}`]: true })}::jsonb` })
      .where('id', '=', w.id)
      .execute();
    ctx.audit({ entityType: 'workspace', entityId: w.id, action: 'setup.initialize', after: { slug: w.slug, programId, opportunityId, invited: input.invites.length, paymentsChoice: input.paymentsChoice } });
    return { workspaceId: w.id, ownerId: created.ownerId, slug: w.slug, programId, opportunityId, invited: input.invites.length };
  },
});

// Operator console (G-02) ----------------------------------------------------------------------------------
export const recordOperatorView = defineAction({
  id: 'operator.record_view',
  title: 'Record an operator view',
  description: 'System: writes an audit entry in the tenant’s audit log each time a platform operator views tenant data (with or without a support-access grant).',
  input: z.object({ operatorUserId: uuid, operatorEmail: z.string().max(320), view: z.string().max(120), supportGrantId: uuid.nullable() }),
  output: Ok,
  scopes: [],
  roles: ['system'],
  riskTier: 'R1',
  idempotent: false,
  async run(input, ctx) {
    const w = ws(ctx);
    ctx.audit({ entityType: 'workspace', entityId: w.id, action: 'operator.viewed_tenant', after: input });
    return { ok: true as const };
  },
});
