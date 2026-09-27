// SPDX-License-Identifier: AGPL-3.0-only
// Framework-agnostic CommonGrants route handling (`/common-grants/*`).
//
// Reads always run under RLS via `withRls(ctx.claims, …, ctx.db)`, so anonymous callers only see
// published public data. Writes never touch tables: they call `ctx.executor.execute(actionId, …)`.
import { sql, withRls, type Database, type RequestClaims, type Tx } from '@gms/db';
import type { RawBuilder } from 'kysely';
import { DomainError, fromPgError, isDomainError, isUuid, zonedTimeToUtc } from '@gms/domain';
import { z } from 'zod';
import {
  asRecord,
  internalAppStatusesFor,
  internalAwardStatusesFor,
  isPublicOpportunityStatus,
  PUBLIC_OPPORTUNITY_STATUSES,
  toCgApplication,
  toCgAward,
  toCgCompetition,
  toCgForm,
  toCgFormResponse,
  toCgOpportunity,
  type ApplicationRow,
  type AwardMapContext,
  type AwardRow,
  type CompetitionRow,
  type FormResponseRow,
  type MapContext,
  type OpportunityRow,
} from './mappers';
import { decimalToCents } from './money';
import { buildOpenApi } from './openapi';
import {
  dateBound,
  filteredEnvelope,
  offsetOf,
  okEnvelope,
  paginatedEnvelope,
  paginationInfo,
  parseApplicationSearch,
  parseAwardSearch,
  parseOpportunitySearch,
  parsePagination,
  sortInfoOf,
  type Pagination,
} from './pagination';
import { badRequest, CACHE_NONE, CACHE_PRIVATE, CACHE_PUBLIC, HttpError, json, problem, readJsonBody } from './http';
import type { CgCompetition, CgForm } from './types';

// ---------------------------------------------------------------------------------------
// Context

export interface CgWorkspace {
  id: string;
  slug: string;
  name: string;
  timezone: string;
}

export interface CgExecutor {
  execute(actionId: string, input: unknown, ctx: unknown): Promise<unknown>;
}

export interface CgContext {
  workspace: CgWorkspace;
  /** Public origin of this workspace, e.g. "http://halcyon.localhost:3000". */
  origin: string;
  db: Database;
  /** Verified claims (anon or a signed-in user / agent token). */
  claims: RequestClaims;
  executor?: CgExecutor;
  actionContext?: unknown;
}

/** Action ids the CommonGrants write routes call. The app implements them. */
export const CG_ACTIONS = {
  start: 'applications.start',
  saveAnswers: 'applications.save_answers',
  submit: 'applications.submit',
} as const;

const PREFIX = '/common-grants';

// ---------------------------------------------------------------------------------------
// Routing

interface RouteMatch {
  request: Request;
  url: URL;
  params: string[];
  ctx: CgContext;
}

type RouteHandler = (m: RouteMatch) => Promise<Response>;

interface Route {
  method: 'GET' | 'POST' | 'PUT';
  pattern: RegExp;
  handler: RouteHandler;
}

const SEG = '([^/]+)';
const routes: Route[] = [
  { method: 'GET', pattern: /^\/openapi\.json$/, handler: openApiRoute },
  { method: 'GET', pattern: /^\/opportunities$/, handler: listOpportunities },
  { method: 'POST', pattern: /^\/opportunities\/search$/, handler: searchOpportunities },
  { method: 'GET', pattern: new RegExp(`^/opportunities/${SEG}$`), handler: readOpportunity },
  { method: 'GET', pattern: /^\/forms$/, handler: listForms },
  { method: 'GET', pattern: new RegExp(`^/forms/${SEG}$`), handler: readForm },
  { method: 'GET', pattern: /^\/competitions$/, handler: listCompetitions },
  { method: 'GET', pattern: new RegExp(`^/competitions/${SEG}$`), handler: readCompetition },
  { method: 'GET', pattern: /^\/awards$/, handler: listAwards },
  { method: 'POST', pattern: /^\/awards\/search$/, handler: searchAwards },
  { method: 'GET', pattern: new RegExp(`^/awards/${SEG}$`), handler: readAward },
  { method: 'POST', pattern: /^\/applications\/start$/, handler: startApplication },
  { method: 'POST', pattern: /^\/applications\/search$/, handler: searchApplications },
  { method: 'GET', pattern: new RegExp(`^/applications/${SEG}$`), handler: readApplication },
  { method: 'GET', pattern: new RegExp(`^/applications/${SEG}/forms/${SEG}$`), handler: readFormResponse },
  { method: 'PUT', pattern: new RegExp(`^/applications/${SEG}/forms/${SEG}$`), handler: saveFormResponse },
  { method: 'PUT', pattern: new RegExp(`^/applications/${SEG}/submit$`), handler: submitApplication },
];

function routePath(url: URL): string | null {
  const idx = url.pathname.indexOf(PREFIX);
  if (idx < 0) return null;
  const rest = url.pathname.slice(idx + PREFIX.length);
  if (rest !== '' && !rest.startsWith('/')) return null;
  return rest.replace(/\/+$/, '') || '/';
}

export async function handleCommonGrants(request: Request, ctx: CgContext): Promise<Response> {
  const url = new URL(request.url);
  const instance = url.pathname;
  try {
    const path = routePath(url);
    const method = request.method.toUpperCase() === 'HEAD' ? 'GET' : request.method.toUpperCase();
    if (path !== null) {
      const allowed: string[] = [];
      for (const r of routes) {
        const m = r.pattern.exec(path);
        if (!m) continue;
        if (r.method !== method) {
          allowed.push(r.method);
          continue;
        }
        const params = m.slice(1).map((p) => decodeURIComponent(p));
        const res = await r.handler({ request, url, params, ctx });
        if (request.method.toUpperCase() === 'HEAD') return new Response(null, { status: res.status, headers: res.headers });
        return res;
      }
      if (allowed.length) {
        const allow = [...new Set(allowed.flatMap((a) => (a === 'GET' ? ['GET', 'HEAD'] : [a])))].join(', ');
        return problem(new HttpError(405, 'not_found', `${request.method} is not supported on ${instance}. Allowed: ${allow}.`), instance, { allow });
      }
    }
    return problem(new DomainError('not_found', `No CommonGrants route matches ${request.method} ${instance}.`), instance);
  } catch (err) {
    const e = isDomainError(err) ? err : (fromPgError(err) ?? err);
    if (!isDomainError(e)) console.error('[commongrants] unexpected error', err);
    const headers: Record<string, string> = isDomainError(e) && e.code === 'unauthenticated' ? { 'www-authenticate': wwwAuthenticate(ctx) } : {};
    return problem(e, instance, headers);
  }
}

// ---------------------------------------------------------------------------------------
// Shared helpers

function isSignedIn(claims: RequestClaims): boolean {
  return claims.role === 'authenticated' && typeof claims.sub === 'string' && claims.sub.length > 0;
}

function wwwAuthenticate(ctx: CgContext): string {
  return `Bearer resource_metadata="${ctx.origin.replace(/\/$/, '')}/.well-known/oauth-protected-resource"`;
}

function requireUser(ctx: CgContext): void {
  if (!isSignedIn(ctx.claims)) throw new DomainError('unauthenticated', 'Sign in or send a bearer token to use the application routes.');
}

function cacheFor(ctx: CgContext): Record<string, string> {
  return isSignedIn(ctx.claims) ? { 'cache-control': CACHE_PRIVATE, vary: 'Authorization, Cookie' } : { 'cache-control': CACHE_PUBLIC, vary: 'Authorization, Cookie' };
}

function mapCtx(ctx: CgContext): MapContext {
  return { origin: ctx.origin, timezone: ctx.workspace.timezone };
}

function rls<T>(ctx: CgContext, fn: (trx: Tx) => Promise<T>): Promise<T> {
  return withRls(ctx.claims, fn, ctx.db);
}

function notFound(what: string, id: string): DomainError {
  return new DomainError('not_found', `${what} ${id} was not found or is not public.`);
}

function requireUuid(id: string, what: string): string {
  if (!isUuid(id)) throw notFound(what, id);
  return id;
}

type Cond = RawBuilder<boolean>;
const FALSE: Cond = sql<boolean>`false`;

/** `col = any(values)` / `not (col = any(values))` for a CG StringArrayFilter. */
function inList(col: RawBuilder<unknown>, op: 'in' | 'notIn', values: readonly string[], cast: 'text' | 'uuid' = 'text'): Cond {
  if (!values.length) return op === 'in' ? FALSE : sql<boolean>`true`;
  const arr = cast === 'uuid' ? sql`${[...values]}::uuid[]` : sql`${[...values]}::text[]`;
  return op === 'in' ? sql<boolean>`${col} = any(${arr})` : sql<boolean>`not (${col} = any(${arr}))`;
}

function uuidValues(values: readonly string[], field: string, errors: string[]): string[] {
  const ok = values.filter((v) => isUuid(v));
  if (ok.length !== values.length) errors.push(`${field}: ignored values that are not UUIDs.`);
  return ok;
}

function dateRangeCond(
  col: RawBuilder<unknown>,
  f: { operator: 'between' | 'outside'; value: { min: string; max: string } },
  tz: string,
): Cond {
  const lo = dateBound(f.value.min, tz, 'start', zonedTimeToUtc);
  const hi = dateBound(f.value.max, tz, 'end', zonedTimeToUtc);
  const upper = hi.inclusive ? sql<boolean>`${col} <= ${hi.at}::timestamptz` : sql<boolean>`${col} < ${hi.at}::timestamptz`;
  const within = sql<boolean>`(${col} >= ${lo.at}::timestamptz and ${upper})`;
  return f.operator === 'between' ? within : sql<boolean>`(${col} is not null and not ${within})`;
}

function moneyRangeCond(
  col: RawBuilder<unknown>,
  currencyCol: RawBuilder<unknown>,
  f: { operator: 'between' | 'outside'; value: { min: { amount: string; currency: string }; max: { amount: string; currency: string } } },
  field: string,
): Cond {
  let min: number;
  let max: number;
  try {
    min = decimalToCents(f.value.min.amount);
    max = decimalToCents(f.value.max.amount);
  } catch (e) {
    throw badRequest(`${field}: ${(e as Error).message}`, [{ pointer: `/filters/${field}/value`, message: (e as Error).message }]);
  }
  const cur = f.value.min.currency.toUpperCase();
  if (f.value.max.currency.toUpperCase() !== cur) {
    throw badRequest(`${field}: min and max must use the same currency.`, [{ pointer: `/filters/${field}/value`, message: 'Currencies differ.' }]);
  }
  const within = sql<boolean>`(${col} >= ${min} and ${col} <= ${max})`;
  return f.operator === 'between'
    ? sql<boolean>`(${currencyCol} = ${cur} and ${within})`
    : sql<boolean>`(${currencyCol} = ${cur} and ${col} is not null and not ${within})`;
}

function orderExpr(col: RawBuilder<unknown>, dir: 'asc' | 'desc'): RawBuilder<unknown> {
  return dir === 'asc' ? sql`${col} asc nulls last` : sql`${col} desc nulls last`;
}

// ---------------------------------------------------------------------------------------
// Executor bridge

type ExecOutcome = { kind: 'ok'; output: unknown } | { kind: 'approval'; body: Record<string, unknown> };

function unwrapExecution(result: unknown): ExecOutcome {
  const o = asRecord(result);
  if (o.status === 'approval_required') {
    const body: Record<string, unknown> = { status: 'approval_required', approvalRequestId: o.approvalRequestId, confirmUrl: o.confirmUrl };
    if (o.expiresAt) body.expiresAt = o.expiresAt;
    return { kind: 'approval', body };
  }
  if (o.status === 'ok' && 'output' in o) return { kind: 'ok', output: o.output };
  return { kind: 'ok', output: result };
}

async function execute(ctx: CgContext, actionId: string, input: unknown): Promise<ExecOutcome> {
  if (!ctx.executor) throw new DomainError('unavailable', 'Application actions are not available on this server.');
  return unwrapExecution(await ctx.executor.execute(actionId, input, ctx.actionContext));
}

function accepted(body: Record<string, unknown>): Response {
  return json(okEnvelope(body, 'A person needs to confirm this in GMS before it takes effect.', 202), 202, { 'cache-control': CACHE_PRIVATE });
}

// ---------------------------------------------------------------------------------------
// OpenAPI

async function openApiRoute({ ctx }: RouteMatch): Promise<Response> {
  return json(buildOpenApi(ctx.origin), 200, { 'cache-control': CACHE_PUBLIC });
}

// ---------------------------------------------------------------------------------------
// Opportunities

function oppBase(trx: Tx, ctx: CgContext) {
  return trx
    .selectFrom('opportunities as o')
    .leftJoin('programs as p', 'p.id', 'o.program_id')
    .where('o.workspace_id', '=', ctx.workspace.id)
    .where('o.status', 'in', [...PUBLIC_OPPORTUNITY_STATUSES])
    .where(sql<boolean>`o.distribution -> 'cgFeed' = 'true'::jsonb`);
}

const OPP_COLUMNS = [
  'o.id',
  'o.slug',
  'o.title',
  'o.status',
  'o.summary',
  'o.description_md',
  'o.eligibility_md',
  'o.funding_total_cents',
  'o.award_min_cents',
  'o.award_max_cents',
  'o.expected_award_count',
  'o.currency',
  'o.applicant_types',
  'o.cause_terms',
  'o.geography_terms',
  'o.forecast_at',
  'o.opens_at',
  'o.closes_at',
  'o.decision_expected_on',
  'o.created_at',
  'o.last_modified_at',
  'p.name as program_name',
] as const;

const OPP_SORT_COLUMNS: Record<string, string> = {
  lastModifiedAt: 'o.last_modified_at',
  createdAt: 'o.created_at',
  title: 'o.title',
  'status.value': 'o.status',
  'keyDates.closeDate': 'o.closes_at',
  'funding.maxAwardAmount': 'o.award_max_cents',
  'funding.minAwardAmount': 'o.award_min_cents',
  'funding.totalAmountAvailable': 'o.funding_total_cents',
  'funding.estimatedAwardCount': 'o.expected_award_count',
};

async function queryOpportunities(
  ctx: CgContext,
  conds: Cond[],
  sort: { col: string; dir: 'asc' | 'desc' },
  page: Pagination,
): Promise<{ rows: OpportunityRow[]; total: number }> {
  return rls(ctx, async (trx) => {
    const base = () => {
      let q = oppBase(trx, ctx).where('o.visibility', '=', 'public');
      for (const c of conds) q = q.where(c);
      return q;
    };
    const countRow = await base().select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await base()
      .select([...OPP_COLUMNS])
      .orderBy(orderExpr(sql.ref(sort.col), sort.dir))
      .orderBy('o.id')
      .limit(page.pageSize)
      .offset(offsetOf(page))
      .execute();
    return { rows, total: Number(countRow?.n ?? 0) };
  });
}

async function listOpportunities({ url, ctx }: RouteMatch): Promise<Response> {
  const page = parsePagination(url.searchParams);
  const { rows, total } = await queryOpportunities(ctx, [], { col: 'o.last_modified_at', dir: 'desc' }, page);
  const mc = mapCtx(ctx);
  return json(paginatedEnvelope(rows.map((r) => toCgOpportunity(r, mc)), paginationInfo(page, total)), 200, cacheFor(ctx));
}

async function searchOpportunities({ request, ctx }: RouteMatch): Promise<Response> {
  const req = parseOpportunitySearch(await readJsonBody(request, { optional: true }));
  const f = req.filters;
  const conds: Cond[] = [];
  const errors = [...req.filterErrors];
  const tz = ctx.workspace.timezone;

  if (req.search) {
    const like = `%${req.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(sql<boolean>`(o.search @@ websearch_to_tsquery('english', ${req.search}) or o.title ilike ${like})`);
  }
  if (f.status) {
    const vals = f.status.value.filter((v) => isPublicOpportunityStatus(v));
    if (vals.length !== f.status.value.length) errors.push('status: only forecasted, open and closed are published; other values were ignored.');
    conds.push(inList(sql.ref('o.status'), f.status.operator, vals));
  }
  if (f.closeDateRange) conds.push(dateRangeCond(sql.ref('o.closes_at'), f.closeDateRange, tz));
  if (f.totalFundingAvailableRange)
    conds.push(moneyRangeCond(sql.ref('o.funding_total_cents'), sql.ref('o.currency'), f.totalFundingAvailableRange, 'totalFundingAvailableRange'));
  if (f.minAwardAmountRange) conds.push(moneyRangeCond(sql.ref('o.award_min_cents'), sql.ref('o.currency'), f.minAwardAmountRange, 'minAwardAmountRange'));
  if (f.maxAwardAmountRange) conds.push(moneyRangeCond(sql.ref('o.award_max_cents'), sql.ref('o.currency'), f.maxAwardAmountRange, 'maxAwardAmountRange'));

  const arrayFilter = z.object({ operator: z.enum(['in', 'notIn']), value: z.array(z.string()) });
  for (const [key, col] of [
    ['causeAreas', 'o.cause_terms'],
    ['geography', 'o.geography_terms'],
  ] as const) {
    const raw = f.customFilters?.[key];
    if (!raw) continue;
    const parsed = arrayFilter.safeParse(raw);
    if (!parsed.success) {
      errors.push(`customFilters.${key}: expected { operator: "in" | "notIn", value: string[] }; ignored.`);
      continue;
    }
    const overlap = sql<boolean>`${sql.ref(col)} && ${[...parsed.data.value]}::text[]`;
    conds.push(parsed.data.operator === 'in' ? overlap : sql<boolean>`not (${overlap})`);
  }

  const col = OPP_SORT_COLUMNS[req.sorting.sortBy] ?? 'o.last_modified_at';
  const { rows, total } = await queryOpportunities(ctx, conds, { col, dir: req.sorting.sortOrder }, req.pagination);
  const mc = mapCtx(ctx);
  return json(
    filteredEnvelope(rows.map((r) => toCgOpportunity(r, mc)), paginationInfo(req.pagination, total), sortInfoOf(req), f, errors),
    200,
    { 'cache-control': CACHE_NONE },
  );
}

async function readOpportunity({ params, ctx }: RouteMatch): Promise<Response> {
  const id = requireUuid(params[0]!, 'Opportunity');
  const result = await rls(ctx, async (trx) => {
    const row = await oppBase(trx, ctx).where('o.id', '=', id).select([...OPP_COLUMNS]).executeTakeFirst();
    if (!row) return null;
    const competitions = await loadCompetitions(trx, ctx, { opportunityId: id });
    return { row, competitions };
  });
  if (!result) throw notFound('Opportunity', id);
  const opp = toCgOpportunity(result.row, mapCtx(ctx));
  return json(okEnvelope({ ...opp, competitions: result.competitions }), 200, cacheFor(ctx));
}

// ---------------------------------------------------------------------------------------
// Forms + competitions

interface FormJoinRow {
  competition_id: string;
  form_id: string;
  name: string;
  description: string | null;
  form_created_at: string;
  form_modified_at: string;
  version_id: string;
  version: number;
  json_schema: unknown;
  ui_schema: unknown;
  mapping_to_cg: unknown;
  mapping_from_cg: unknown;
  published_at: string | null;
  version_modified_at: string;
  position: number;
}

/** Published form versions attached to non-draft competitions of public, feed-enabled opportunities. */
async function publicFormRows(trx: Tx, ctx: CgContext, where: { competitionIds?: string[]; formId?: string } = {}): Promise<FormJoinRow[]> {
  let q = trx
    .selectFrom('competition_forms as cf')
    .innerJoin('competitions as c', 'c.id', 'cf.competition_id')
    .innerJoin('opportunities as o', 'o.id', 'c.opportunity_id')
    .innerJoin('forms as f', 'f.id', 'cf.form_id')
    .innerJoin('form_versions as fv', 'fv.id', 'cf.form_version_id')
    .where('cf.workspace_id', '=', ctx.workspace.id)
    .where('fv.status', '=', 'published')
    .where('c.status', '<>', 'draft')
    .where('o.status', 'in', [...PUBLIC_OPPORTUNITY_STATUSES])
    .where(sql<boolean>`o.distribution -> 'cgFeed' = 'true'::jsonb`);
  if (where.competitionIds) {
    if (!where.competitionIds.length) return [];
    q = q.where('cf.competition_id', 'in', where.competitionIds);
  }
  if (where.formId) q = q.where('cf.form_id', '=', where.formId);
  return q
    .select([
      'cf.competition_id',
      'cf.form_id',
      'f.name',
      'f.description',
      'f.created_at as form_created_at',
      'f.last_modified_at as form_modified_at',
      'fv.id as version_id',
      'fv.version',
      'fv.json_schema',
      'fv.ui_schema',
      'fv.mapping_to_cg',
      'fv.mapping_from_cg',
      'fv.published_at',
      'fv.last_modified_at as version_modified_at',
      'cf.position',
    ])
    .orderBy('cf.position')
    .execute();
}

function formFromRow(r: FormJoinRow): CgForm {
  return toCgForm(
    { id: r.form_id, name: r.name, description: r.description, created_at: r.form_created_at, last_modified_at: r.form_modified_at },
    {
      id: r.version_id,
      version: r.version,
      json_schema: r.json_schema,
      ui_schema: r.ui_schema,
      mapping_to_cg: r.mapping_to_cg,
      mapping_from_cg: r.mapping_from_cg,
      published_at: r.published_at,
      last_modified_at: r.version_modified_at,
    },
  );
}

/** One entry per form: the highest published version attached to a public competition. */
function latestForms(rows: FormJoinRow[]): CgForm[] {
  const best = new Map<string, FormJoinRow>();
  for (const r of rows) {
    const cur = best.get(r.form_id);
    if (!cur || r.version > cur.version) best.set(r.form_id, r);
  }
  return [...best.values()].map(formFromRow).sort((a, b) => b.lastModifiedAt.localeCompare(a.lastModifiedAt) || a.id.localeCompare(b.id));
}

async function listForms({ url, ctx }: RouteMatch): Promise<Response> {
  const page = parsePagination(url.searchParams);
  const forms = latestForms(await rls(ctx, (trx) => publicFormRows(trx, ctx)));
  const items = forms.slice(offsetOf(page), offsetOf(page) + page.pageSize);
  return json(paginatedEnvelope(items, paginationInfo(page, forms.length)), 200, cacheFor(ctx));
}

async function readForm({ params, ctx }: RouteMatch): Promise<Response> {
  const id = requireUuid(params[0]!, 'Form');
  const [form] = latestForms(await rls(ctx, (trx) => publicFormRows(trx, ctx, { formId: id })));
  if (!form) throw notFound('Form', id);
  return json(okEnvelope(form), 200, cacheFor(ctx));
}

function compBase(trx: Tx, ctx: CgContext) {
  return trx
    .selectFrom('competitions as c')
    .innerJoin('opportunities as o', 'o.id', 'c.opportunity_id')
    .where('c.workspace_id', '=', ctx.workspace.id)
    .where('c.status', '<>', 'draft')
    .where('o.status', 'in', [...PUBLIC_OPPORTUNITY_STATUSES])
    .where(sql<boolean>`o.distribution -> 'cgFeed' = 'true'::jsonb`);
}

const COMP_COLUMNS = [
  'c.id',
  'c.opportunity_id',
  'c.name',
  'c.description',
  'c.stage_order',
  'c.access',
  'c.status',
  'c.opens_at',
  'c.closes_at',
  'c.grace_minutes',
  'c.created_at',
  'c.last_modified_at',
  'o.applicant_types',
] as const;

async function buildCompetitions(trx: Tx, ctx: CgContext, rows: (CompetitionRow & { applicant_types: string[] })[]): Promise<CgCompetition[]> {
  const formRows = await publicFormRows(trx, ctx, { competitionIds: rows.map((r) => r.id) });
  const mc = mapCtx(ctx);
  return rows.map((r) =>
    toCgCompetition(
      r,
      formRows.filter((f) => f.competition_id === r.id).map(formFromRow),
      mc,
      r.applicant_types,
    ),
  );
}

async function loadCompetitions(trx: Tx, ctx: CgContext, where: { opportunityId?: string; competitionId?: string }): Promise<CgCompetition[]> {
  let q = compBase(trx, ctx);
  if (where.opportunityId) q = q.where('c.opportunity_id', '=', where.opportunityId);
  if (where.competitionId) q = q.where('c.id', '=', where.competitionId);
  const rows = await q.select([...COMP_COLUMNS]).orderBy('c.stage_order').orderBy('c.id').execute();
  return buildCompetitions(trx, ctx, rows);
}

/** GMS extension: CG 0.4 defines only `GET /competitions/{compId}`. */
async function listCompetitions({ url, ctx }: RouteMatch): Promise<Response> {
  const page = parsePagination(url.searchParams);
  const { items, total } = await rls(ctx, async (trx) => {
    const countRow = await compBase(trx, ctx).select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await compBase(trx, ctx)
      .select([...COMP_COLUMNS])
      .orderBy('c.last_modified_at', 'desc')
      .orderBy('c.id')
      .limit(page.pageSize)
      .offset(offsetOf(page))
      .execute();
    return { items: await buildCompetitions(trx, ctx, rows), total: Number(countRow?.n ?? 0) };
  });
  return json(paginatedEnvelope(items, paginationInfo(page, total)), 200, cacheFor(ctx));
}

async function readCompetition({ params, ctx }: RouteMatch): Promise<Response> {
  const id = requireUuid(params[0]!, 'Competition');
  const [comp] = await rls(ctx, (trx) => loadCompetitions(trx, ctx, { competitionId: id }));
  if (!comp) throw notFound('Competition', id);
  return json(okEnvelope(comp), 200, cacheFor(ctx));
}

// ---------------------------------------------------------------------------------------
// Awards

interface AwardQuery {
  conds: (view: AwardView) => Cond[];
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  page: Pagination;
  id?: string;
}

interface AwardView {
  amount: RawBuilder<unknown>;
  status: RawBuilder<unknown>;
  opportunityId: RawBuilder<unknown>;
  createdAt: RawBuilder<unknown>;
  lastModifiedAt: RawBuilder<unknown>;
  title: RawBuilder<unknown>;
  currency: RawBuilder<unknown>;
}

const PUBLIC_AWARD_VIEW: AwardView = {
  amount: sql.ref('a.amount_cents'),
  status: sql.ref('a.status'),
  opportunityId: sql.ref('a.opportunity_id'),
  createdAt: sql.ref('a.created_at'),
  lastModifiedAt: sql.ref('a.last_modified_at'),
  title: sql.ref('a.title'),
  currency: sql.ref('a.currency'),
};

/** Staff see the original award plus approved amendments (same rule as gms_private.award_ceiling_cents). */
const STAFF_AMOUNT = sql<number>`(a.amount_cents + coalesce((select sum(x.amount_cents) from public.awards x where x.parent_award_id = a.id and x.amendment_status = 'approved'), 0))`;
const STAFF_AWARD_VIEW: AwardView = { ...PUBLIC_AWARD_VIEW, amount: STAFF_AMOUNT };

function awardSortCol(view: AwardView, sortBy: string): RawBuilder<unknown> {
  switch (sortBy) {
    case 'createdAt':
    case 'keyDates.awardDate':
      return view.createdAt;
    case 'title':
      return view.title;
    case 'status.value':
      return view.status;
    case 'funding.awardedAmount':
      return view.amount;
    default:
      return view.lastModifiedAt;
  }
}

async function isStaff(trx: Tx, ctx: CgContext): Promise<boolean> {
  if (!isSignedIn(ctx.claims)) return false;
  const r = await sql<{ staff: boolean }>`select gms.is_staff(${ctx.workspace.id}::uuid) as staff`.execute(trx);
  return Boolean(r.rows[0]?.staff);
}

async function queryAwards(ctx: CgContext, aq: AwardQuery): Promise<{ rows: AwardRow[]; total: number }> {
  return rls(ctx, async (trx) => {
    if (await isStaff(trx, ctx)) {
      const view = STAFF_AWARD_VIEW;
      const base = () => {
        let q = trx
          .selectFrom('awards as a')
          .leftJoin('applicant_orgs as g', 'g.id', 'a.applicant_org_id')
          .leftJoin('opportunities as o', 'o.id', 'a.opportunity_id')
          .leftJoin('programs as p', 'p.id', 'a.program_id')
          .leftJoin('applications as ap', 'ap.id', 'a.application_id')
          .where('a.workspace_id', '=', ctx.workspace.id)
          .where('a.kind', '=', 'original')
          .where('a.status', 'in', ['active', 'completed', 'cancelled']);
        if (aq.id) q = q.where('a.id', '=', aq.id);
        for (const c of aq.conds(view)) q = q.where(c);
        return q;
      };
      const countRow = await base().select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
      const rows = await base()
        .select([
          'a.id',
          'a.reference',
          'a.title',
          'a.purpose',
          'a.status',
          STAFF_AMOUNT.as('amount_cents'),
          'a.disbursed_cents',
          'a.currency',
          'a.start_date',
          'a.end_date',
          'a.fiscal_year',
          'a.opportunity_id',
          'o.title as opportunity_title',
          'a.application_id',
          'ap.title as application_title',
          'ap.reference_number as application_reference',
          'p.name as program_name',
          'g.id as org_id',
          'g.legal_name as org_name',
          'g.ein as org_ein',
          'g.uei as org_uei',
          'a.created_at',
          'a.last_modified_at',
        ])
        .orderBy(orderExpr(awardSortCol(view, aq.sortBy), aq.sortOrder))
        .orderBy('a.id')
        .limit(aq.page.pageSize)
        .offset(offsetOf(aq.page))
        .execute();
      return {
        total: Number(countRow?.n ?? 0),
        rows: rows.map(
          (r): AwardRow => ({
            ...r,
            amount_cents: Number(r.amount_cents),
            application_title: r.application_id ? (r.application_title ?? r.application_reference) : null,
            recipient: r.org_id && r.org_name ? { id: r.org_id, legal_name: r.org_name, ein: r.org_ein, uei: r.org_uei } : null,
          }),
        ),
      };
    }

    const view = PUBLIC_AWARD_VIEW;
    const base = () => {
      let q = trx
        .selectFrom('public_awards as a')
        .leftJoin('opportunities as o', 'o.id', 'a.opportunity_id')
        .where('a.workspace_id', '=', ctx.workspace.id);
      if (aq.id) q = q.where('a.id', '=', aq.id);
      for (const c of aq.conds(view)) q = q.where(c);
      return q;
    };
    const countRow = await base().select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await base()
      .select([
        'a.id',
        'a.reference',
        'a.title',
        'a.purpose',
        'a.status',
        'a.amount_cents',
        'a.currency',
        'a.start_date',
        'a.end_date',
        'a.fiscal_year',
        'a.opportunity_id',
        'o.title as opportunity_title',
        'a.program_name',
        'a.recipient_name',
        'a.recipient_city',
        'a.recipient_state',
        'a.recipient_county',
        'a.created_at',
        'a.last_modified_at',
      ])
      .orderBy(orderExpr(awardSortCol(view, aq.sortBy), aq.sortOrder))
      .orderBy('a.id')
      .limit(aq.page.pageSize)
      .offset(offsetOf(aq.page))
      .execute();
    return {
      total: Number(countRow?.n ?? 0),
      rows: rows
        .filter((r) => r.id && r.reference && r.title && r.status && r.created_at && r.last_modified_at)
        .map(
          (r): AwardRow => ({
            id: r.id!,
            reference: r.reference!,
            title: r.title!,
            purpose: r.purpose,
            status: r.status!,
            amount_cents: Number(r.amount_cents ?? 0),
            currency: r.currency ?? 'USD',
            start_date: r.start_date,
            end_date: r.end_date,
            fiscal_year: r.fiscal_year,
            opportunity_id: r.opportunity_id,
            opportunity_title: r.opportunity_title,
            program_name: r.program_name,
            recipient_name: r.recipient_name,
            recipient_city: r.recipient_city,
            recipient_state: r.recipient_state,
            recipient_county: r.recipient_county,
            created_at: r.created_at!,
            last_modified_at: r.last_modified_at!,
          }),
        ),
    };
  });
}

function awardCtx(ctx: CgContext): AwardMapContext {
  return { ...mapCtx(ctx), funder: { id: ctx.workspace.id, name: ctx.workspace.name } };
}

async function listAwards({ url, ctx }: RouteMatch): Promise<Response> {
  const page = parsePagination(url.searchParams);
  const { rows, total } = await queryAwards(ctx, { conds: () => [], sortBy: 'lastModifiedAt', sortOrder: 'desc', page });
  const ac = awardCtx(ctx);
  return json(paginatedEnvelope(rows.map((r) => toCgAward(r, ac)), paginationInfo(page, total)), 200, cacheFor(ctx));
}

async function searchAwards({ request, ctx }: RouteMatch): Promise<Response> {
  const req = parseAwardSearch(await readJsonBody(request, { optional: true }));
  const f = req.filters;
  const errors = [...req.filterErrors];
  const tz = ctx.workspace.timezone;
  const opportunityIds = f.opportunityId ? uuidValues(f.opportunityId.value, 'opportunityId', errors) : [];
  const statuses = f.status ? f.status.value.flatMap(internalAwardStatusesFor) : [];
  if (f.status && statuses.length === 0 && f.status.value.length) errors.push('status: no recognized award statuses (awarded, completed, cancelled).');
  const conds = (view: AwardView): Cond[] => {
    const out: Cond[] = [];
    if (req.search) {
      const like = `%${req.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      out.push(sql<boolean>`(${view.title} ilike ${like} or a.purpose ilike ${like} or a.reference ilike ${like})`);
    }
    if (f.status) out.push(inList(view.status, f.status.operator, statuses));
    if (f.opportunityId) out.push(inList(view.opportunityId, f.opportunityId.operator, opportunityIds, 'uuid'));
    if (f.awardDateRange) out.push(dateRangeCond(view.createdAt, f.awardDateRange, tz));
    if (f.awardedAmountRange) out.push(moneyRangeCond(view.amount, view.currency, f.awardedAmountRange, 'awardedAmountRange'));
    return out;
  };
  const { rows, total } = await queryAwards(ctx, { conds, sortBy: req.sorting.sortBy, sortOrder: req.sorting.sortOrder, page: req.pagination });
  const ac = awardCtx(ctx);
  return json(
    filteredEnvelope(rows.map((r) => toCgAward(r, ac)), paginationInfo(req.pagination, total), sortInfoOf(req), f, errors),
    200,
    { 'cache-control': CACHE_NONE },
  );
}

async function readAward({ params, ctx }: RouteMatch): Promise<Response> {
  const id = requireUuid(params[0]!, 'Award');
  const { rows } = await queryAwards(ctx, { conds: () => [], sortBy: 'lastModifiedAt', sortOrder: 'desc', page: { page: 1, pageSize: 1 }, id });
  const row = rows[0];
  if (!row) throw notFound('Award', id);
  return json(okEnvelope(toCgAward(row, awardCtx(ctx))), 200, cacheFor(ctx));
}

// ---------------------------------------------------------------------------------------
// Applications (signed-in callers only; writes go through the executor)

const APP_COLUMNS = [
  'id',
  'competition_id',
  'opportunity_id',
  'applicant_org_id',
  'reference_number',
  'title',
  'status',
  'requested_amount_cents',
  'currency',
  'submitted_at',
  'ai_disclosure',
  'created_at',
  'last_modified_at',
] as const;

const RESPONSE_COLUMNS = ['id', 'application_id', 'form_id', 'form_version_id', 'data', 'etag', 'created_at', 'last_modified_at'] as const;

async function loadApplicationRow(trx: Tx, ctx: CgContext, id: string): Promise<ApplicationRow | undefined> {
  return trx.selectFrom('applications').select([...APP_COLUMNS]).where('id', '=', id).where('workspace_id', '=', ctx.workspace.id).executeTakeFirst();
}

async function loadResponses(trx: Tx, ids: string[], formId?: string): Promise<FormResponseRow[]> {
  if (!ids.length) return [];
  let q = trx.selectFrom('form_responses').select([...RESPONSE_COLUMNS]).where('application_id', 'in', ids);
  if (formId) q = q.where('form_id', '=', formId);
  return q.orderBy('created_at').execute();
}

async function loadApplication(ctx: CgContext, id: string) {
  return rls(ctx, async (trx) => {
    const app = await loadApplicationRow(trx, ctx, id);
    if (!app) return null;
    return toCgApplication(app, await loadResponses(trx, [id]));
  });
}

async function assertApplicationVisible(ctx: CgContext, id: string): Promise<ApplicationRow> {
  const app = await rls(ctx, (trx) => loadApplicationRow(trx, ctx, id));
  if (!app) throw new DomainError('not_found', `Application ${id} was not found.`);
  return app;
}

function etagHeader(etag: string): string {
  return `"${etag.replace(/"/g, '')}"`;
}

function ifMatch(request: Request): string | undefined {
  const raw = request.headers.get('if-match');
  if (!raw || raw.trim() === '*') return undefined;
  return raw.trim().replace(/^W\//, '').replace(/^"|"$/g, '') || undefined;
}

const StartBody = z.object({
  competitionId: z.uuid(),
  organizationId: z.uuid().nullish(),
  applicantOrgId: z.uuid().nullish(),
  title: z.string().max(300).nullish(),
});

async function startApplication({ request, ctx }: RouteMatch): Promise<Response> {
  requireUser(ctx);
  const parsed = StartBody.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    throw badRequest(
      'Send { competitionId, organizationId? }.',
      parsed.error.issues.map((i) => ({ pointer: '/' + i.path.join('/'), message: i.message })),
    );
  }
  const { competitionId } = parsed.data;
  const applicantOrgId = parsed.data.organizationId ?? parsed.data.applicantOrgId ?? undefined;
  const [competition] = await rls(ctx, (trx) => loadCompetitions(trx, ctx, { competitionId }));
  if (!competition) throw notFound('Competition', competitionId);

  const outcome = await execute(ctx, CG_ACTIONS.start, { competitionId, ...(applicantOrgId ? { applicantOrgId } : {}) });
  if (outcome.kind === 'approval') return accepted(outcome.body);
  const applicationId = asRecord(outcome.output).applicationId;
  if (typeof applicationId !== 'string') throw new DomainError('internal', 'The start action did not return an application id.');
  const app = await loadApplication(ctx, applicationId);
  if (!app) throw new DomainError('internal', 'The new application could not be read back.');
  return json(okEnvelope(app, 'Application started', 201), 201, { 'cache-control': CACHE_PRIVATE, location: `${ctx.origin.replace(/\/$/, '')}${PREFIX}/applications/${app.id}` });
}

async function readApplication({ params, ctx }: RouteMatch): Promise<Response> {
  requireUser(ctx);
  const id = params[0]!;
  if (!isUuid(id)) throw new DomainError('not_found', `Application ${id} was not found.`);
  const app = await loadApplication(ctx, id);
  if (!app) throw new DomainError('not_found', `Application ${id} was not found.`);
  return json(okEnvelope(app), 200, { 'cache-control': CACHE_PRIVATE });
}

async function readFormResponse({ params, ctx }: RouteMatch): Promise<Response> {
  requireUser(ctx);
  const [appId, formId] = params as [string, string];
  if (!isUuid(appId) || !isUuid(formId)) throw new DomainError('not_found', 'Form response not found.');
  const result = await rls(ctx, async (trx) => {
    const app = await loadApplicationRow(trx, ctx, appId);
    if (!app) return null;
    const [row] = await loadResponses(trx, [appId], formId);
    return row ? { app, row } : null;
  });
  if (!result) throw new DomainError('not_found', `No saved answers for form ${formId} on application ${appId}.`);
  return json(okEnvelope(toCgFormResponse(result.row, result.app.status)), 200, { 'cache-control': CACHE_PRIVATE, etag: etagHeader(result.row.etag) });
}

const SaveResult = z.object({
  etag: z.string(),
  errors: z.array(z.object({ pointer: z.string(), message: z.string() })).default([]),
});

async function saveFormResponse({ request, params, ctx }: RouteMatch): Promise<Response> {
  requireUser(ctx);
  const [appId, formId] = params as [string, string];
  if (!isUuid(appId) || !isUuid(formId)) throw new DomainError('not_found', 'Application or form not found.');
  const body = await readJsonBody(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('The request body must be a JSON object of form answers.');
  await assertApplicationVisible(ctx, appId);
  const etag = ifMatch(request);
  const outcome = await execute(ctx, CG_ACTIONS.saveAnswers, { applicationId: appId, formId, answers: body, ...(etag ? { etag } : {}) });
  if (outcome.kind === 'approval') return accepted(outcome.body);
  const saved = SaveResult.safeParse(outcome.output);
  if (!saved.success) throw new DomainError('internal', 'The save action returned an unexpected result.');
  const result = await rls(ctx, async (trx) => {
    const app = await loadApplicationRow(trx, ctx, appId);
    const [row] = await loadResponses(trx, [appId], formId);
    return app && row ? { app, row } : null;
  });
  if (!result) throw new DomainError('internal', 'The saved answers could not be read back.');
  const data = toCgFormResponse(result.row, result.app.status, saved.data.errors);
  return json(okEnvelope(data, saved.data.errors.length ? 'Saved with validation errors' : 'Saved'), 200, {
    'cache-control': CACHE_PRIVATE,
    etag: etagHeader(saved.data.etag),
  });
}

const SubmitBody = z.object({
  attestation: z.object({ typedName: z.string().trim().min(1).max(200), agreed: z.literal(true) }),
  aiDisclosure: z.string().max(5000).nullish(),
});

async function submitApplication({ request, params, ctx }: RouteMatch): Promise<Response> {
  requireUser(ctx);
  const appId = params[0]!;
  if (!isUuid(appId)) throw new DomainError('not_found', `Application ${appId} was not found.`);
  const parsed = SubmitBody.safeParse(await readJsonBody(request, { optional: true }));
  if (!parsed.success) {
    throw badRequest(
      'Submitting requires an attestation: { "attestation": { "typedName": "<your full name>", "agreed": true } }.',
      parsed.error.issues.map((i) => ({ pointer: '/' + i.path.join('/'), message: i.message })),
    );
  }
  await assertApplicationVisible(ctx, appId);
  const input = {
    applicationId: appId,
    attestation: { typedName: parsed.data.attestation.typedName, agreed: true as const },
    ...(parsed.data.aiDisclosure ? { aiDisclosure: parsed.data.aiDisclosure } : {}),
  };
  let outcome: ExecOutcome;
  try {
    outcome = await execute(ctx, CG_ACTIONS.submit, input);
  } catch (err) {
    // CG `ApplicationSubmissionError` is a 400 carrying the validation errors.
    if (isDomainError(err) && err.code === 'validation_failed') throw new HttpError(400, 'validation_failed', err.message, err.details, err.issues);
    throw err;
  }
  if (outcome.kind === 'approval') return accepted(outcome.body);
  return json(okEnvelope(outcome.output, 'Application submitted'), 200, { 'cache-control': CACHE_PRIVATE });
}

const APP_SORT_COLUMNS: Record<string, string> = {
  lastModifiedAt: 'a.last_modified_at',
  createdAt: 'a.created_at',
  submittedAt: 'a.submitted_at',
  'status.value': 'a.status',
  opportunityId: 'a.opportunity_id',
  competitionId: 'a.competition_id',
};

async function searchApplications({ request, ctx }: RouteMatch): Promise<Response> {
  requireUser(ctx);
  const req = parseApplicationSearch(await readJsonBody(request, { optional: true }));
  const f = req.filters;
  const errors = [...req.filterErrors];
  const conds: Cond[] = [];
  if (req.search) {
    const like = `%${req.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(sql<boolean>`(a.title ilike ${like} or a.reference_number ilike ${like})`);
  }
  if (f.opportunityId) conds.push(inList(sql.ref('a.opportunity_id'), f.opportunityId.operator, uuidValues(f.opportunityId.value, 'opportunityId', errors), 'uuid'));
  if (f.competitionId) conds.push(inList(sql.ref('a.competition_id'), f.competitionId.operator, uuidValues(f.competitionId.value, 'competitionId', errors), 'uuid'));
  if (f.status) {
    const statuses = [...new Set(f.status.value.flatMap(internalAppStatusesFor))];
    if (!statuses.length && f.status.value.length) errors.push('status: no recognized application statuses.');
    conds.push(inList(sql.ref('a.status'), f.status.operator, statuses));
  }
  if (f.submittedAtRange) conds.push(dateRangeCond(sql.ref('a.submitted_at'), f.submittedAtRange, ctx.workspace.timezone));
  const col = APP_SORT_COLUMNS[req.sorting.sortBy] ?? 'a.last_modified_at';

  const { items, total } = await rls(ctx, async (trx) => {
    const base = () => {
      let q = trx.selectFrom('applications as a').where('a.workspace_id', '=', ctx.workspace.id);
      for (const c of conds) q = q.where(c);
      return q;
    };
    const countRow = await base().select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await base()
      .select(APP_COLUMNS.map((c) => `a.${c}` as const))
      .orderBy(orderExpr(sql.ref(col), req.sorting.sortOrder))
      .orderBy('a.id')
      .limit(req.pagination.pageSize)
      .offset(offsetOf(req.pagination))
      .execute();
    const responses = await loadResponses(
      trx,
      rows.map((r) => r.id),
    );
    return {
      total: Number(countRow?.n ?? 0),
      items: rows.map((r) => toCgApplication(r, responses.filter((x) => x.application_id === r.id))),
    };
  });
  return json(filteredEnvelope(items, paginationInfo(req.pagination, total), sortInfoOf(req), f, errors), 200, { 'cache-control': CACHE_PRIVATE });
}
