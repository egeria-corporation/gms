// SPDX-License-Identifier: AGPL-3.0-only
// Admin extras: brand asset uploads, integrations settings (email domain, OpenGrants syndication),
// race-safe first-run setup (F-01…F-05, `pnpm run setup`) and operator view auditing (G-02).
import { randomBytes } from 'node:crypto';
import { sql, type Database } from '@gms/db';
import { DomainError, WORKSPACE_ROLES } from '@gms/domain';
import { FORM_TEMPLATES, templateModel } from '@gms/forms';
import { z } from 'zod';
import { defineAction, getAction, type RunContext } from '../define';
import { zodIssues } from '../executor';
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
  const parsed = action.input.safeParse(raw);
  if (!parsed.success) throw new DomainError('validation_failed', 'The input is not valid.', { action: actionId }, zodIssues(parsed.error));
  // Nested audit entries keep their own action id (the executor would otherwise label them setup.initialize).
  return (await action.run(parsed.data, { ...ctx, audit: (e) => ctx.audit({ ...e, action: e.action ?? actionId }) })) as T;
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

// Report builder (AN-02) ----------------------------------------------------------------------------------------
// One aggregate query per report definition. Every SQL fragment comes from the whitelists below; user values
// are bound parameters. Used by the report builder page (under RLS) and by the export worker
// (exports.request kind "report_definition": `adminExtra.reportDefinitionExport(rt.db, workspaceId, params)`).
export type ReportDatasetKey = 'applications' | 'awards' | 'payments' | 'reports';

export interface ReportDefinition {
  dataset: ReportDatasetKey;
  rows: string;
  cols: string | null;
  measure: string;
  from: string | null;
  to: string | null;
  statuses: string[];
  programId: string | null;
}

export interface ReportResultRow {
  row: string;
  col: string | null;
  value: number;
}

type Frag = ReturnType<typeof sql.raw>;

interface DatasetSql {
  from: (ws: string) => Frag;
  date: Frag;
  status: Frag;
  program: Frag;
  dims: Record<string, (tz: string) => Frag>;
  measures: Record<string, Frag>;
}

const month = (col: string) => (tz: string) => sql`to_char(date_trunc('month', ${sql.raw(col)} at time zone ${tz}), 'YYYY-MM')`;

const REPORT_SQL: Record<ReportDatasetKey, DatasetSql> = {
  applications: {
    from: (ws) => sql`public.applications a
      left join public.opportunities o on o.id = a.opportunity_id
      left join public.programs p on p.id = o.program_id
      where a.workspace_id = ${ws}::uuid`,
    date: sql.raw('a.submitted_at'),
    status: sql.raw('a.status'),
    program: sql.raw('p.id'),
    dims: {
      status: () => sql.raw('a.status'),
      opportunity: () => sql.raw(`coalesce(o.title, 'No opportunity')`),
      program: () => sql.raw(`coalesce(p.name, 'No program')`),
      month: month('a.submitted_at'),
      channel: () => sql.raw(`case coalesce(a.submitted_via, a.created_via) when 'agent' then 'AI agent' when 'api' then 'API' else 'Web' end`),
    },
    measures: { count: sql.raw('count(*)'), requested: sql.raw('coalesce(sum(a.requested_amount_cents), 0)') },
  },
  awards: {
    from: (ws) => sql`public.awards a
      join public.workspaces w on w.id = a.workspace_id
      left join public.opportunities o on o.id = a.opportunity_id
      left join public.programs p on p.id = a.program_id
      left join lateral (select ad.county from public.org_addresses ad where ad.org_id = a.applicant_org_id order by (ad.kind = 'mailing') desc limit 1) c on true
      where a.workspace_id = ${ws}::uuid and a.kind = 'original'`,
    date: sql.raw('a.start_date'),
    status: sql.raw('a.status'),
    program: sql.raw('p.id'),
    dims: {
      status: () => sql.raw('a.status'),
      program: () => sql.raw(`coalesce(p.name, 'No program')`),
      fiscal_year: () => sql.raw(`'FY ' || coalesce(a.fiscal_year, analytics.fiscal_year(coalesce(a.start_date, a.created_at::date), w.fiscal_year_start_month))`),
      opportunity: () => sql.raw(`coalesce(o.title, 'No opportunity')`),
      county: () => sql.raw(`coalesce(nullif(trim(c.county), ''), 'Unknown')`),
    },
    measures: { count: sql.raw('count(*)'), amount: sql.raw('coalesce(sum(a.amount_cents), 0)'), disbursed: sql.raw('coalesce(sum(a.disbursed_cents), 0)') },
  },
  payments: {
    from: (ws) => sql`public.payments pm
      join public.awards a on a.id = pm.award_id
      left join public.programs p on p.id = a.program_id
      where pm.workspace_id = ${ws}::uuid`,
    date: sql.raw('pm.sent_at'),
    status: sql.raw('pm.status'),
    program: sql.raw('p.id'),
    dims: {
      status: () => sql.raw('pm.status'),
      method: () => sql.raw('pm.method'),
      program: () => sql.raw(`coalesce(p.name, 'No program')`),
      month: month('pm.sent_at'),
      rail: () => sql.raw('pm.rail'),
    },
    measures: { count: sql.raw('count(*)'), amount: sql.raw('coalesce(sum(pm.amount_cents), 0)') },
  },
  reports: {
    from: (ws) => sql`public.report_requirements r
      join public.awards a on a.id = r.award_id
      left join public.programs p on p.id = a.program_id
      where r.workspace_id = ${ws}::uuid`,
    date: sql.raw('r.due_date'),
    status: sql.raw('r.status'),
    program: sql.raw('p.id'),
    dims: {
      status: () => sql.raw('r.status'),
      kind: () => sql.raw('r.kind'),
      program: () => sql.raw(`coalesce(p.name, 'No program')`),
      month: () => sql.raw(`to_char(date_trunc('month', r.due_date), 'YYYY-MM')`),
    },
    measures: { count: sql.raw('count(*)') },
  },
};

export async function runReportDefinition(db: Database, workspaceId: string, timeZone: string, c: ReportDefinition): Promise<ReportResultRow[]> {
  const d = REPORT_SQL[c.dataset];
  const rowExpr = (d.dims[c.rows] ?? d.dims.status!)(timeZone);
  const colExpr = c.cols && d.dims[c.cols] ? d.dims[c.cols]!(timeZone) : sql`null`;
  const measure = d.measures[c.measure] ?? d.measures.count!;
  const filters: Frag[] = [];
  if (c.from) filters.push(sql`${d.date} >= (${c.from}::date)`);
  if (c.to) filters.push(sql`${d.date} < (${c.to}::date + 1)`);
  if (c.statuses.length) filters.push(sql`${d.status} = any(${c.statuses}::text[])`);
  if (c.programId) filters.push(sql`${d.program} = ${c.programId}::uuid`);
  const where = filters.length ? sql` and ${sql.join(filters, sql` and `)}` : sql``;
  const r = await sql<{ row: string | null; col: string | null; value: number | string }>`
    select coalesce((${rowExpr})::text, '—') as row, (${colExpr})::text as col, (${measure})::bigint as value
    from ${d.from(workspaceId)}${where}
    group by 1, 2
    order by 1, 2
    limit 2000`.execute(db);
  return r.rows.map((x) => ({ row: x.row ?? '—', col: x.col, value: Number(x.value) }));
}

/** Rows for a CSV/XLSX export of a saved or ad-hoc report definition (params as stored on the export). */
export async function reportDefinitionExport(db: Database, workspaceId: string, params: Record<string, unknown>): Promise<Record<string, string | number | null>[]> {
  const str = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : null);
  const dataset = (Object.keys(REPORT_SQL) as ReportDatasetKey[]).find((k) => k === params.dataset) ?? 'applications';
  const d = REPORT_SQL[dataset];
  const rows = str('rows') && d.dims[str('rows')!] ? str('rows')! : 'status';
  const colsRaw = str('cols');
  const cols = colsRaw && d.dims[colsRaw] && colsRaw !== rows ? colsRaw : null;
  const measure = str('measure') && d.measures[str('measure')!] ? str('measure')! : 'count';
  const date = (k: string) => (str(k) && /^\d{4}-\d{2}-\d{2}$/.test(str(k)!) ? str(k) : null);
  const ws = await db.selectFrom('workspaces').select('timezone').where('id', '=', workspaceId).executeTakeFirst();
  const result = await runReportDefinition(db, workspaceId, ws?.timezone ?? 'UTC', {
    dataset,
    rows,
    cols,
    measure,
    from: date('from'),
    to: date('to'),
    statuses: Array.isArray(params.statuses) ? params.statuses.map(String).filter((s) => /^[a-z_]{1,40}$/.test(s)) : [],
    programId: str('programId') && /^[0-9a-f-]{36}$/i.test(str('programId')!) ? str('programId') : null,
  });
  return result.map((r) => ({ [rows]: r.row, ...(cols ? { [cols]: r.col } : {}), [measure]: r.value }));
}
