// SPDX-License-Identifier: AGPL-3.0-only
// Platform API /api/v1/* generated from the action registry (+ friendly REST aliases over the same capabilities).
//   POST /api/v1/actions/{actionId}      any action the caller's audience may call (body = input)
//   GET  /api/v1/openapi.json            OpenAPI 3.1 (one operation per action + the aliases)
//   GET  /api/v1/workflows.arazzo.yaml   Arazzo 1.0 workflows
// Behaviors: RFC 9457 problem+json for every error, Idempotency-Key → ctx.idempotencyKey, ETag / If-Match /
// If-None-Match, RateLimit + RateLimit-Policy (+ Retry-After on 429), approval_required → 202 + Location.
import { withRls } from '@gms/db';
import { DomainError, isDomainError } from '@gms/domain';
import { authenticate, insufficientScope, rateLimitHeaders, unauthorized, type AuthResult } from './auth';
import {
  allowlistAllows,
  callAction,
  findCapability,
  invokeCapability,
  roleAllows,
  scopesAllow,
  visibleCapabilities,
  type Capability,
  type InvokeResult,
} from './catalog';
import { errorResponse, isRecord, json, readJson, sha256Hex, text, trimOrigin, type AgentEnv, type HeaderMap } from './env';
import { arazzoYaml, openApiDocument } from './openapi';

export interface ApiAlias {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  /** OpenAPI path template relative to /api/v1, e.g. /applications/{applicationId}. */
  path: string;
  operationId: string;
  summary: string;
  /** Candidate capabilities in priority order (e.g. staff view first, then the applicant's own view). */
  caps: string[];
  /** Maps path params + query + body to the capability input. */
  input: (p: { params: Record<string, string>; query: URLSearchParams; body: Record<string, unknown> }) => Record<string, unknown>;
  /** Path params that become input fields (documented as path parameters). */
  pathParams: string[];
  /** Query params documented for GET operations. */
  queryParams?: { name: string; description: string; schema: Record<string, unknown> }[];
  etag?: 'form' | 'lastModified';
  /** Picks the single item out of a list result (e.g. get_status → applications[0]). */
  pick?: (out: unknown) => unknown;
}

const num = (v: string | null) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
const list = (v: string | null) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export const API_ALIASES: ApiAlias[] = [
  {
    method: 'GET',
    path: '/opportunities',
    operationId: 'searchOpportunities',
    summary: 'Search published opportunities',
    caps: ['search_opportunities'],
    pathParams: [],
    queryParams: [
      { name: 'q', description: 'Keywords', schema: { type: 'string' } },
      { name: 'status', description: 'open (default), forecasted, closed or any', schema: { type: 'string' } },
      { name: 'cause', description: 'Cause term', schema: { type: 'string' } },
      { name: 'geography', description: 'Geography term', schema: { type: 'string' } },
      { name: 'applicantType', description: 'Applicant type', schema: { type: 'string' } },
      { name: 'limit', description: '1–100', schema: { type: 'integer' } },
      { name: 'cursor', description: 'Page cursor', schema: { type: 'string' } },
    ],
    input: ({ query }) =>
      clean({
        query: query.get('q') ?? undefined,
        status: query.get('status') ?? undefined,
        cause: query.get('cause') ?? undefined,
        geography: query.get('geography') ?? undefined,
        applicantType: query.get('applicantType') ?? undefined,
        limit: num(query.get('limit')),
        cursor: query.get('cursor') ?? undefined,
      }),
  },
  {
    method: 'GET',
    path: '/opportunities/{opportunityId}',
    operationId: 'getOpportunity',
    summary: 'Get an opportunity (id or slug)',
    caps: ['get_opportunity'],
    pathParams: ['opportunityId'],
    input: ({ params }) => (isUuid(params.opportunityId!) ? { opportunityId: params.opportunityId } : { slug: params.opportunityId }),
  },
  {
    method: 'POST',
    path: '/opportunities/{opportunityId}/eligibility',
    operationId: 'checkEligibility',
    summary: 'Check eligibility answers',
    caps: ['check_eligibility'],
    pathParams: ['opportunityId'],
    input: ({ params, body }) => ({ ...body, opportunityId: params.opportunityId }),
  },
  {
    method: 'GET',
    path: '/opportunities/{opportunityId}/form',
    operationId: 'getOpportunityForm',
    summary: 'Get the application form for an opportunity',
    caps: ['get_application_form'],
    pathParams: ['opportunityId'],
    input: ({ params, query }) => clean({ opportunityId: params.opportunityId, competitionId: query.get('competitionId') ?? undefined }),
  },
  {
    method: 'GET',
    path: '/applications',
    operationId: 'listApplications',
    summary: 'List applications (staff: the pipeline; applicants: their own)',
    caps: ['query_pipeline', 'get_status'],
    pathParams: [],
    queryParams: [
      { name: 'opportunityId', description: 'Staff: filter by opportunity', schema: { type: 'string', format: 'uuid' } },
      { name: 'status', description: 'Staff: comma-separated statuses', schema: { type: 'string' } },
      { name: 'q', description: 'Staff: keywords', schema: { type: 'string' } },
      { name: 'limit', description: '1–100', schema: { type: 'integer' } },
      { name: 'cursor', description: 'Page cursor', schema: { type: 'string' } },
    ],
    input: ({ query }) =>
      clean({ opportunityId: query.get('opportunityId') ?? undefined, status: list(query.get('status')), query: query.get('q') ?? undefined, limit: num(query.get('limit')), cursor: query.get('cursor') ?? undefined }),
  },
  {
    method: 'POST',
    path: '/applications',
    operationId: 'startApplication',
    summary: 'Start (or resume) an application',
    caps: ['start_application'],
    pathParams: [],
    input: ({ body }) => body,
  },
  {
    method: 'GET',
    path: '/applications/{applicationId}',
    operationId: 'getApplication',
    summary: 'Get an application (staff view or the applicant’s status view)',
    caps: ['get_application', 'get_status'],
    pathParams: ['applicationId'],
    input: ({ params }) => ({ applicationId: params.applicationId }),
    etag: 'lastModified',
    pick: (out) => (isRecord(out) && Array.isArray(out.applications) ? out.applications[0] : out),
  },
  {
    method: 'GET',
    path: '/applications/{applicationId}/form',
    operationId: 'getApplicationForm',
    summary: 'Get the forms, current answers and etags of an application',
    caps: ['get_application_form'],
    pathParams: ['applicationId'],
    input: ({ params }) => ({ applicationId: params.applicationId }),
  },
  {
    method: 'PATCH',
    path: '/applications/{applicationId}/forms/{formId}',
    operationId: 'saveAnswers',
    summary: 'Save answers (partial update; If-Match: the form etag)',
    caps: ['save_answers'],
    pathParams: ['applicationId', 'formId'],
    input: ({ params, body }) => ({ ...body, applicationId: params.applicationId, formId: params.formId }),
    etag: 'form',
  },
  {
    method: 'POST',
    path: '/applications/{applicationId}/validate',
    operationId: 'validateApplication',
    summary: 'Check an application against the submission rules',
    caps: ['validate_application'],
    pathParams: ['applicationId'],
    input: ({ params }) => ({ applicationId: params.applicationId }),
  },
  {
    method: 'POST',
    path: '/applications/{applicationId}/attachments',
    operationId: 'uploadAttachment',
    summary: 'Get a signed upload URL for an attachment',
    caps: ['upload_attachment'],
    pathParams: ['applicationId'],
    input: ({ params, body }) => ({ ...body, applicationId: params.applicationId }),
  },
  {
    method: 'POST',
    path: '/applications/{applicationId}/submit',
    operationId: 'submitApplication',
    summary: 'Ask to submit (202 approval_required: the person confirms in GMS)',
    caps: ['request_submission'],
    pathParams: ['applicationId'],
    input: ({ params, body }) => ({ ...body, applicationId: params.applicationId }),
  },
  {
    method: 'GET',
    path: '/awards',
    operationId: 'listAwards',
    summary: 'List awards (staff) or my grants (applicants)',
    caps: ['list_awards', 'list_my_awards'],
    pathParams: [],
    input: ({ query }) => clean({ status: list(query.get('status')), limit: num(query.get('limit')), cursor: query.get('cursor') ?? undefined }),
  },
  {
    method: 'GET',
    path: '/payments',
    operationId: 'listPayments',
    summary: 'Payment batches (staff with payments:read) or my payment status (applicants)',
    caps: ['list_payments', 'get_payment_status'],
    pathParams: [],
    input: ({ query }) => clean({ status: list(query.get('status')), awardId: query.get('awardId') ?? undefined }),
  },
  {
    method: 'POST',
    path: '/payments/batches',
    operationId: 'proposePaymentBatch',
    summary: 'Propose a DRAFT payment batch (approval is people-only)',
    caps: ['propose_payment_batch'],
    pathParams: [],
    input: ({ body }) => body,
  },
  {
    method: 'GET',
    path: '/reports',
    operationId: 'listReports',
    summary: 'Overdue reports (staff) or my required reports (grantees)',
    caps: ['list_overdue_reports', 'list_reports'],
    pathParams: [],
    input: ({ query }) => clean({ awardId: query.get('awardId') ?? undefined }),
  },
  {
    method: 'PUT',
    path: '/reports/{requirementId}',
    operationId: 'saveReport',
    summary: 'Save a grant report draft',
    caps: ['reports_save'],
    pathParams: ['requirementId'],
    input: ({ params, body }) => ({ ...body, requirementId: params.requirementId }),
  },
  {
    method: 'POST',
    path: '/reports/{requirementId}/submit',
    operationId: 'submitReport',
    summary: 'Ask to submit a grant report (202: the person confirms)',
    caps: ['submit_report'],
    pathParams: ['requirementId'],
    input: ({ params, body }) => ({ ...body, requirementId: params.requirementId }),
  },
  {
    method: 'GET',
    path: '/approval-requests',
    operationId: 'listApprovalRequests',
    summary: 'Confirmation requests (staff: the foundation’s; applicants: waiting on me)',
    caps: ['get_approval_requests', 'list_requests'],
    pathParams: [],
    input: ({ query }) => clean({ status: query.get('status') ?? undefined }),
  },
  {
    method: 'GET',
    path: '/approval-requests/{approvalRequestId}',
    operationId: 'getApprovalRequest',
    summary: 'Get one confirmation request (poll after a 202)',
    caps: ['get_approval_request'],
    pathParams: ['approvalRequestId'],
    input: ({ params }) => ({ approvalRequestId: params.approvalRequestId }),
    etag: 'lastModified',
  },
  {
    method: 'POST',
    path: '/exports',
    operationId: 'runReport',
    summary: 'Start an export / report job',
    caps: ['run_report'],
    pathParams: [],
    input: ({ body }) => body,
  },
  {
    method: 'GET',
    path: '/exports/{exportId}',
    operationId: 'getExportStatus',
    summary: 'Poll an export job',
    caps: ['get_export_status'],
    pathParams: ['exportId'],
    input: ({ params }) => ({ exportId: params.exportId }),
  },
];

function templateRegex(path: string): { re: RegExp; names: string[] } {
  const names: string[] = [];
  const re = new RegExp(`^${path.replace(/\{([A-Za-z]+)\}/g, (_m, n: string) => (names.push(n), '([^/]+)'))}/?$`);
  return { re, names };
}
const COMPILED = API_ALIASES.map((a) => ({ alias: a, ...templateRegex(a.path) }));

function idempotencyKey(req: Request): string | null {
  const k = req.headers.get('idempotency-key');
  if (k === null) return null;
  const v = k.trim().replace(/^"|"$/g, '');
  if (!v || v.length > 255 || !/^[\x21-\x7e]+$/.test(v)) throw new DomainError('validation_failed', 'Idempotency-Key must be 1–255 visible ASCII characters.');
  return v;
}

function etagOf(value: string): string {
  return `"${sha256Hex(value).slice(0, 32)}"`;
}

function stripEtag(v: string): string {
  return v.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
}

function matchesEtag(header: string | null, current: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header.split(',').some((h) => stripEtag(h) === stripEtag(current));
}

function resultResponse(r: InvokeResult, env: AgentEnv, headers: HeaderMap, pick?: (o: unknown) => unknown, etag?: string | null): Response {
  if (r.status === 'approval_required') {
    const body = { status: r.status, approvalRequestId: r.approvalRequestId, confirmUrl: r.confirmUrl, expiresAt: r.expiresAt, preview: r.preview, message: r.summary };
    return json(body, 202, { ...headers, location: `${trimOrigin(env.origin)}/api/v1/approval-requests/${r.approvalRequestId}` });
  }
  const out = pick ? pick(r.output) : r.output;
  return json(out, 200, { ...headers, ...(etag ? { etag } : {}) });
}

function toApiError(err: unknown, env: AgentEnv, auth: AuthResult | null, instance: string, headers: HeaderMap): Response {
  if (isDomainError(err)) {
    const required = (err.details.requiredScopes as string[] | undefined) ?? [];
    if (err.code === 'unauthenticated' && !auth?.principal) return errorResponse(unauthorized(env, 'api', undefined, required), instance, headers);
    if (err.code === 'insufficient_scope') {
      return errorResponse(insufficientScope(env, 'api', required, auth && auth.ctx.scopes !== '*' ? (auth.ctx.scopes as string[]) : []), instance, headers);
    }
  }
  return errorResponse(err, instance, headers);
}

/** Chooses the first candidate capability this caller can use (staff view before the applicant view). */
function chooseCapability(names: string[], auth: AuthResult): Capability {
  const caps = names.map((n) => findCapability(n)).filter((c): c is Capability => Boolean(c));
  const usable = caps.find((c) => roleAllows(c, auth.ctx) && scopesAllow(c, auth.ctx) && allowlistAllows(c, auth.principal));
  if (usable) return usable;
  // Nothing fits: report against the most general candidate (last) so the error names the right scopes.
  const fallback = caps[caps.length - 1];
  if (!fallback) throw new DomainError('not_found', 'Unknown operation.');
  return fallback;
}

async function currentFormEtag(env: AgentEnv, auth: AuthResult, applicationId: string, formId: string): Promise<string | null> {
  const row = await withRls(
    auth.ctx.claims,
    (trx) => trx.selectFrom('form_responses').select('etag').where('application_id', '=', applicationId).where('form_id', '=', formId).executeTakeFirst(),
    env.runtime.db,
  );
  return row?.etag ?? null;
}

/** /api/v1/* */
export async function handleApiV1(req: Request, env: AgentEnv): Promise<Response> {
  const url = new URL(req.url);
  const rel = url.pathname.replace(/^\/api\/v1/, '') || '/';
  const instance = `${trimOrigin(env.origin)}${url.pathname}`;
  let auth: AuthResult | null = null;
  let headers: HeaderMap = {};
  try {
    if (req.method === 'GET' && (rel === '/openapi.json' || rel === '/openapi')) return json(openApiDocument(env), 200, { 'cache-control': 'public, max-age=300' });
    if (req.method === 'GET' && (rel === '/workflows.arazzo.yaml' || rel === '/workflows.arazzo.yml')) {
      return text(arazzoYaml(env), 'application/vnd.oai.workflows+yaml; charset=utf-8', 200, { 'cache-control': 'public, max-age=300' });
    }

    auth = await authenticate(req, env, 'api', { channel: 'api' });
    headers = rateLimitHeaders(auth.rate);
    const ctx = { ...auth.ctx, idempotencyKey: idempotencyKey(req) };

    if (req.method === 'GET' && rel === '/') {
      return json(
        {
          name: `${env.brandName} Platform API`,
          openapi: `${trimOrigin(env.origin)}/api/v1/openapi.json`,
          workflows: `${trimOrigin(env.origin)}/api/v1/workflows.arazzo.yaml`,
          agentGuide: `${trimOrigin(env.origin)}/agents.md`,
          authenticated: Boolean(auth.principal),
        },
        200,
        headers,
      );
    }
    if (req.method === 'GET' && rel === '/actions') {
      const caps = await visibleCapabilities(env, ctx, auth.principal);
      return json({ actions: caps.map((c) => ({ name: c.name, actionId: c.actionId, title: c.title, riskTier: c.tier, scopes: c.scopes })) }, 200, headers);
    }
    const actionMatch = /^\/actions\/([a-z][a-z0-9_.]*)$/.exec(rel);
    if (actionMatch) {
      if (req.method !== 'POST') return errorResponse(new DomainError('validation_failed', 'Use POST with the action input as the JSON body.'), instance, { ...headers, allow: 'POST' });
      const body = (await readJson(req)) ?? {};
      const r = await callAction(env, actionMatch[1]!, body, ctx, auth.principal);
      return resultResponse(r, env, headers);
    }

    for (const { alias, re, names } of COMPILED) {
      const m = re.exec(rel);
      if (!m) continue;
      if (alias.method !== req.method) {
        const allowed = COMPILED.filter((c) => c.re.test(rel)).map((c) => c.alias.method);
        if (allowed.includes(req.method as ApiAlias['method'])) continue;
        return errorResponse(new DomainError('validation_failed', `Use ${allowed.join(' or ')} for ${rel}.`), instance, { ...headers, allow: allowed.join(', ') });
      }
      const params = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1]!)]));
      const rawBody = alias.method === 'GET' ? {} : ((await readJson(req)) ?? {});
      if (!isRecord(rawBody)) throw new DomainError('validation_failed', 'The body must be a JSON object.');
      let input = alias.input({ params, query: url.searchParams, body: rawBody });
      const cap = chooseCapability(alias.caps, auth);

      if (alias.etag === 'form') {
        const current = await currentFormEtag(env, auth, params.applicationId!, params.formId!);
        const ifMatch = req.headers.get('if-match');
        if (ifMatch && current !== null && !matchesEtag(ifMatch, `"${current}"`)) {
          return errorResponse(new DomainError('precondition_failed', 'These answers changed since you loaded them. GET the form again (new ETag) and retry.', { currentEtag: `"${current}"` }), instance, headers);
        }
        if (ifMatch && ifMatch.trim() !== '*' && input.etag === undefined) input = { ...input, etag: stripEtag(ifMatch) };
      }
      const r = await invokeCapability(env, cap, input, ctx, auth.principal);
      let etag: string | null = null;
      if (r.status === 'ok' && alias.etag === 'form' && isRecord(r.output) && typeof r.output.etag === 'string') etag = `"${r.output.etag}"`;
      if (r.status === 'ok' && alias.etag === 'lastModified') {
        const item = alias.pick ? alias.pick(r.output) : r.output;
        const lm = isRecord(item) && typeof item.lastModifiedAt === 'string' ? item.lastModifiedAt : JSON.stringify(item);
        etag = etagOf(lm);
        if (req.method === 'GET' && matchesEtag(req.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers: { ...headers, etag } });
      }
      return resultResponse(r, env, headers, alias.pick, etag);
    }
    return errorResponse(new DomainError('not_found', `No API route for ${req.method} ${url.pathname}. See ${trimOrigin(env.origin)}/api/v1/openapi.json.`), instance, headers);
  } catch (err) {
    return toApiError(err, env, auth, instance, headers);
  }
}
