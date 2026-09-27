// SPDX-License-Identifier: AGPL-3.0-only
// Server-side reads and view helpers shared by the grantmaking console, the reviewer workspace and the
// board portal. Everything here reads under RLS (callers pass the `trx` from `rls()`); mutations never
// happen here (they go through `act()` in 'use server' files).
import 'server-only';
import type { Tx } from '@gms/db';
import { sql } from '@gms/db';
import { APPLICATION_STATUS, formatDateOnly, formatInZone, formatMoney, type Actor, type ApplicationStatus } from '@gms/domain';
import type { Brand as EmailBrand } from '@gms/email';
import { compileForm, FormModelSchema, type CompiledForm, type FieldMeta } from '@gms/forms';
import type { ApplicationPacketProps, Brand as PdfBrand, PacketAnswer } from '@gms/pdf';
import { config } from './config';
import type { Tenant } from './tenant';

// Brands ---------------------------------------------------------------------------------------
export function emailBrand(tenant: Tenant): EmailBrand {
  return {
    displayName: tenant.brand.displayName,
    logoUrl: null,
    primaryColor: tenant.brand.primaryColor,
    accentColor: tenant.brand.accentColor,
    headingFont: tenant.brand.headingFont,
    sourceUrl: config.sourceUrl,
  };
}

export function pdfBrand(tenant: Tenant): PdfBrand {
  return { displayName: tenant.brand.displayName, logoUrl: null, primaryColor: tenant.brand.primaryColor, accentColor: tenant.brand.accentColor, sourceUrl: config.sourceUrl };
}

// Table URL state -----------------------------------------------------------------------------------
export type SearchParams = Record<string, string | string[] | undefined>;

export interface TableParams {
  page: number;
  pageSize: number;
  sort: string;
  dir: 'asc' | 'desc';
  q: string;
}

/** Reads DataTable state from the URL (`page`, `size`, `sort`, `dir`, `q`); unknown sort keys fall back to the default. */
export function tableParams(sp: SearchParams, opts: { sortable: readonly string[]; sort: string; dir?: 'asc' | 'desc'; pageSizes?: readonly number[] }): TableParams {
  const s = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const sizes = opts.pageSizes ?? [25, 50, 100];
  const size = Number(s('size'));
  const page = Math.max(1, Math.floor(Number(s('page')) || 1));
  const sort = s('sort');
  const dir = s('dir');
  return {
    page,
    pageSize: sizes.includes(size) ? size : sizes[0]!,
    sort: sort && opts.sortable.includes(sort) ? sort : opts.sort,
    dir: dir === 'asc' || dir === 'desc' ? dir : (opts.dir ?? 'desc'),
    q: (s('q') ?? '').trim().slice(0, 200),
  };
}

export function listParam(sp: SearchParams, key: string): string[] {
  const v = sp[key];
  if (!v) return [];
  return (Array.isArray(v) ? v : v.split(',')).map((x) => x.trim()).filter(Boolean);
}

export function oneParam(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string | undefined | null): v is string => Boolean(v && UUID_RE.test(v));

export interface SavedViewRow {
  id: string;
  name: string;
  shared: boolean;
  mine: boolean;
  query: string;
}

/** Saved table views for a console surface (own + shared). `config.query` is the URL query string. */
export async function savedViews(trx: Tx, workspaceId: string, surface: string, userId: string): Promise<SavedViewRow[]> {
  const rows = await trx
    .selectFrom('saved_views')
    .select(['id', 'name', 'shared', 'user_id', 'config'])
    .where('workspace_id', '=', workspaceId)
    .where('surface', '=', surface)
    .orderBy('name')
    .execute();
  return rows.map((r) => ({ id: r.id, name: r.name, shared: r.shared, mine: r.user_id === userId, query: String((r.config as { query?: unknown } | null)?.query ?? '') }));
}

// People ------------------------------------------------------------------------------------------
export interface TeamMember {
  userId: string;
  memberId: string;
  name: string;
  email: string;
  role: string;
  reviewCapacity: number | null;
}

export async function teamMembers(trx: Tx, workspaceId: string, roles?: readonly string[]): Promise<TeamMember[]> {
  let q = trx
    .selectFrom('workspace_members as m')
    .innerJoin('profiles as p', 'p.id', 'm.user_id')
    .select(['m.id as member_id', 'm.user_id', 'm.role', 'm.review_capacity', 'p.full_name', 'p.email'])
    .where('m.workspace_id', '=', workspaceId)
    .where('m.status', '=', 'active');
  if (roles?.length) q = q.where('m.role', 'in', [...roles]);
  const rows = await q.orderBy('p.full_name').execute();
  return rows.map((r) => ({ userId: r.user_id, memberId: r.member_id, name: r.full_name || r.email, email: r.email, role: r.role, reviewCapacity: r.review_capacity }));
}

// Actors ---------------------------------------------------------------------------------------------
export interface AuditRow {
  id: string;
  occurred_at: string;
  actor_type: string;
  actor_name: string | null;
  on_behalf_of_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  before: unknown;
  after: unknown;
}

/** ActorBadge input from an audit row: person, "Agent — acting for …", or the system gear. */
export function auditActor(r: Pick<AuditRow, 'actor_type' | 'actor_name' | 'on_behalf_of_name'>): Pick<Actor, 'type' | 'name' | 'onBehalfOfName'> {
  if (r.actor_type === 'agent') return { type: 'agent', name: r.actor_name ?? 'AI agent', onBehalfOfName: r.on_behalf_of_name ?? null };
  if (r.actor_type === 'system') return { type: 'system', name: 'GMS' };
  return { type: 'human', name: r.actor_name ?? 'Someone' };
}

const ACTION_LABELS: Record<string, string> = {
  'applications.start': 'started the application',
  'applications.save_answers': 'saved answers',
  'applications.submit': 'submitted the application',
  'applications.withdraw': 'withdrew the application',
  'applications.advance': 'moved it to Under review',
  'applications.mark_ineligible': 'marked it ineligible',
  'applications.request_info': 'asked the applicant for more information',
  'applications.grant_extension': 'granted a deadline extension',
  'applications.mark_duplicate': 'changed the duplicate link',
  'applications.dismiss_duplicate': 'marked a possible duplicate as distinct',
  'applications.screen_eligibility': 'recorded an eligibility screening',
  'applications.tag': 'changed tags',
  'competitions.invite_applicants': 'invited the applicant to the next stage',
  'decisions.recommend': 'recorded a recommendation',
  'decisions.record_final': 'recorded the final decision',
  'decisions.bulk_decline': 'declined the application',
  'awards.draft': 'drafted the award',
  'messages.send': 'sent a message',
  'notes.add': 'added an internal note',
  'review.assign': 'assigned reviewers',
  'review.auto_assign': 'assigned reviewers automatically',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, ' ');
}

/** Audit entries about one application (entity rows plus bulk actions that list it). */
export async function applicationAudit(trx: Tx, workspaceId: string, applicationId: string, limit = 100): Promise<AuditRow[]> {
  const r = await sql<AuditRow>`
    select id, occurred_at, actor_type, actor_name, on_behalf_of_name, action, entity_type, entity_id, before, after
    from public.audit_log
    where workspace_id = ${workspaceId}::uuid
      and (
        (entity_type = 'application' and entity_id = ${applicationId}::uuid)
        or (entity_type = 'application' and entity_id is null and after -> 'ids' ? ${applicationId})
        or (entity_type = 'decision' and after ->> 'applicationId' = ${applicationId})
      )
      and action <> 'applications.save_answers'
    order by occurred_at desc
    limit ${limit}`.execute(trx);
  return r.rows;
}

// Forms & answers ------------------------------------------------------------------------------------------
const compiledCache = new Map<string, CompiledForm>();

/** Compiles a stored builder model (form versions are immutable once published, so this caches by id). */
export function compiledFromModel(versionId: string, builderModel: unknown): CompiledForm | null {
  const hit = compiledCache.get(versionId);
  if (hit) return hit;
  const parsed = FormModelSchema.safeParse(builderModel);
  if (!parsed.success) return null;
  try {
    const c = compileForm(parsed.data);
    if (compiledCache.size > 200) compiledCache.clear();
    compiledCache.set(versionId, c);
    return c;
  } catch {
    return null;
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function optionLabel(meta: Pick<FieldMeta, 'options'>, v: unknown): string {
  const o = meta.options?.find((x) => x.value === v);
  return o?.label ?? String(v);
}

/** Display text for one answer, using the form's own labels (no HTML; newlines kept). */
export function answerText(meta: FieldMeta, v: unknown): string {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return '';
  switch (meta.type) {
    case 'currency':
      return typeof v === 'number' ? formatMoney(v, meta.currency ?? 'USD') : String(v);
    case 'number':
      return typeof v === 'number' ? v.toLocaleString('en-US') : String(v);
    case 'date':
      return typeof v === 'string' ? formatDateOnly(v) : String(v);
    case 'yes_no':
      return v === true ? 'Yes' : v === false ? 'No' : String(v);
    case 'select':
      return optionLabel(meta, v);
    case 'multi_select':
    case 'checkbox_group':
      return Array.isArray(v) ? v.map((x) => optionLabel(meta, x)).join(', ') : optionLabel(meta, v);
    case 'name':
      return isObj(v) ? [v.first, v.last].filter(Boolean).join(' ') : String(v);
    case 'address':
      return isObj(v) ? [v.line1, v.line2, [v.city, v.state, v.postal].filter(Boolean).join(', '), v.county ? `${String(v.county)} County` : null].filter(Boolean).join('\n') : String(v);
    case 'file_upload': {
      const files = Array.isArray(v) ? v : [v];
      return files.map((f) => (isObj(f) ? String(f.name ?? 'File') : String(f))).join('\n');
    }
    case 'attestation':
      return isObj(v) ? `${v.agreed ? 'Agreed' : 'Not agreed'}${v.name ? ` — signed by ${String(v.name)}` : ''}` : String(v);
    case 'repeater_table': {
      if (!Array.isArray(v)) return String(v);
      const cols = meta.columns ?? [];
      return v
        .map((row, i) => {
          if (!isObj(row)) return `${i + 1}. ${String(row)}`;
          const cells = cols.length
            ? cols.map((c) => `${c.label}: ${answerText({ ...meta, type: c.type, options: c.options, currency: c.currency, columns: undefined } as FieldMeta, row[c.id]) || '—'}`)
            : Object.entries(row).map(([k, x]) => `${k}: ${String(x)}`);
          return `${i + 1}. ${cells.join('; ')}`;
        })
        .join('\n');
    }
    case 'likert_matrix': {
      if (!isObj(v)) return String(v);
      return (meta.rows ?? Object.keys(v).map((id) => ({ id, label: id })))
        .map((r) => `${r.label}: ${meta.scale?.find((s) => s.value === v[r.id])?.label ?? (v[r.id] === undefined ? '—' : String(v[r.id]))}`)
        .join('\n');
    }
    default:
      return typeof v === 'string' ? v : Array.isArray(v) ? v.map(String).join(', ') : isObj(v) ? JSON.stringify(v) : String(v);
  }
}

/** Flattens answers in form order with page titles as sections (for the packet PDF). */
export function flattenAnswers(compiled: CompiledForm, data: Record<string, unknown>, opts: { formTitle?: string } = {}): PacketAnswer[] {
  const pageTitle = new Map(compiled.pages.map((p) => [p.id, p.title]));
  return Object.entries(compiled.fieldMeta)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([id, m]) => ({
      section: `${opts.formTitle ? `${opts.formTitle} · ` : ''}${pageTitle.get(m.pageId) ?? 'Answers'}`,
      label: m.label,
      value: answerText(m, data[id]),
    }));
}

// Application packet (H-03) ------------------------------------------------------------------------------------
/**
 * Builds the application packet for an application the caller can see under RLS (staff or the
 * applicant). Uses the latest submission snapshot; falls back to in-progress answers.
 */
export async function applicationPacket(trx: Tx, tenant: Tenant, applicationId: string): Promise<ApplicationPacketProps | null> {
  const app = await trx
    .selectFrom('applications as a')
    .innerJoin('opportunities as o', 'o.id', 'a.opportunity_id')
    .leftJoin('applicant_orgs as g', 'g.id', 'a.applicant_org_id')
    .leftJoin('profiles as p', 'p.id', 'a.applicant_user_id')
    .select([
      'a.id',
      'a.applicant_org_id',
      'a.reference_number',
      'a.title',
      'a.status',
      'a.submitted_at',
      'a.requested_amount_cents',
      'a.currency',
      'o.title as opp_title',
      'g.legal_name',
      'g.dba_name',
      'g.ein',
      'g.website',
      'g.mission',
      'g.annual_budget_cents',
      'p.full_name as contact_name',
      'p.email as contact_email',
    ])
    .where('a.id', '=', applicationId)
    .where('a.workspace_id', '=', tenant.id)
    .executeTakeFirst();
  if (!app) return null;
  const sub = await trx.selectFrom('application_submissions').select(['responses', 'form_versions', 'submitted_at']).where('application_id', '=', app.id).orderBy('submitted_at', 'desc').executeTakeFirst();
  let forms: { formId: string; versionId: string; data: Record<string, unknown> }[] = [];
  if (sub) {
    const versions = (Array.isArray(sub.form_versions) ? sub.form_versions : []) as { formId?: string; formVersionId?: string }[];
    const responses = (isObj(sub.responses) ? sub.responses : {}) as Record<string, unknown>;
    forms = versions.filter((v) => v.formVersionId).map((v) => ({ formId: v.formId ?? '', versionId: v.formVersionId!, data: (isObj(responses[v.formId ?? '']) ? responses[v.formId ?? ''] : {}) as Record<string, unknown> }));
  } else {
    const rows = await trx.selectFrom('form_responses').select(['form_id', 'form_version_id', 'data']).where('application_id', '=', app.id).execute();
    forms = rows.map((r) => ({ formId: r.form_id, versionId: r.form_version_id, data: (isObj(r.data) ? r.data : {}) as Record<string, unknown> }));
  }
  const versionRows = forms.length ? await trx.selectFrom('form_versions').select(['id', 'builder_model']).where('id', 'in', forms.map((f) => f.versionId)).execute() : [];
  const answers: PacketAnswer[] = [];
  for (const f of forms) {
    const v = versionRows.find((x) => x.id === f.versionId);
    const compiled = v ? compiledFromModel(v.id, v.builder_model) : null;
    if (!compiled) continue;
    answers.push(...flattenAnswers(compiled, f.data, { formTitle: forms.length > 1 ? compiled.title : undefined }));
  }
  const [attachments, eligibility, address] = await Promise.all([
    trx.selectFrom('attachments').select(['file_name', 'field_path', 'content_type', 'size_bytes']).where('application_id', '=', app.id).where('status', '!=', 'deleted').orderBy('created_at').execute(),
    trx.selectFrom('eligibility_results').select(['question', 'passed', 'source', 'answer']).where('application_id', '=', app.id).orderBy('evaluated_at').execute(),
    app.applicant_org_id
      ? trx.selectFrom('org_addresses').select(['line1', 'line2', 'city', 'state', 'postal_code']).where('org_id', '=', app.applicant_org_id).orderBy('created_at').executeTakeFirst()
      : Promise.resolve(undefined),
  ]);
  return {
    opportunityName: app.opp_title,
    applicationTitle: app.title ?? app.opp_title,
    referenceNumber: app.reference_number,
    statusLabel: APPLICATION_STATUS[app.status as ApplicationStatus]?.label ?? app.status,
    submittedAt: sub?.submitted_at ?? app.submitted_at,
    timeZone: tenant.timezone,
    requestedAmountCents: app.requested_amount_cents,
    currency: app.currency,
    organization: {
      name: app.dba_name || app.legal_name || app.contact_name || 'Individual applicant',
      legalName: app.legal_name,
      ein: app.ein,
      address: address ? [address.line1, address.line2, [address.city, address.state, address.postal_code].filter(Boolean).join(', ')].filter((x): x is string => Boolean(x)) : [],
      website: app.website,
      mission: app.mission,
      annualBudgetCents: app.annual_budget_cents,
      contactName: app.contact_name,
      contactEmail: app.contact_email,
    },
    answers,
    attachments: attachments.map((a) => ({ name: a.file_name, section: a.field_path, contentType: a.content_type, sizeBytes: a.size_bytes })),
    eligibility: eligibility.map((e) => ({ rule: e.question, result: e.passed ? 'pass' : e.source === 'agent' ? 'review' : 'fail', detail: isObj(e.answer) && typeof e.answer.note === 'string' ? e.answer.note : null })),
    generatedAt: new Date().toISOString(),
  };
}

/** Safe filename fragment. */
export function fileSafe(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'file';
}

// Formatting --------------------------------------------------------------------------------------------------
export function when(iso: string | null | undefined, tz: string): string {
  return iso ? formatInZone(iso, tz) : '—';
}

export function pct(n: number | null | undefined, digits = 1): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : `${n.toFixed(digits)}%`;
}

/** Sample standard deviation (population when n < 2 is meaningless → 0). */
export function stddev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** The current fiscal year (calendar year in the workspace timezone). */
export function currentYear(tz: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric' }).format(new Date()));
}
