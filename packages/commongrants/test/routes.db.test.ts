// SPDX-License-Identifier: AGPL-3.0-only
// Contract tests: call handleCommonGrants() against a real database under RLS and validate every
// response body against the CommonGrants SDK zod schemas (Opportunity, envelopes) or the
// core-0.4-derived schemas in src/schemas.ts (models the SDK does not ship).
import { randomUUID } from 'node:crypto';
import { ErrorSchema, NotFoundSchema, OpportunityBaseSchema, UnauthorizedSchema } from '@common-grants/sdk/schemas';
import { claimsFor, createTestDatabase, createUser, type TestDatabase, type TestUser } from '@gms/db/testing';
import type { RequestClaims } from '@gms/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GmsOpportunitySchema, handleCommonGrants, type CgContext, type CgExecutor } from '../src';
import { ResponseSchemas } from '../src/schemas';

const ORIGIN = 'http://halcyon.localhost:3000';
const BASE = `${ORIGIN}/common-grants`;

let t: TestDatabase;
let staff: TestUser;
let applicant: TestUser;
let outsider: TestUser;
let ws: { id: string; slug: string; name: string; timezone: string };
let otherWs: { id: string; slug: string; name: string; timezone: string };

const ids = {
  forecast: '',
  open: '',
  closed: '',
  draft: '',
  noFeed: '',
  unlisted: '',
  otherWsOpen: '',
  competition: '',
  draftCompetition: '',
  form: '',
  formVersion: '',
  draftOnlyForm: '',
  org: '',
  application: '',
  otherApplication: '',
  award: '',
  draftAward: '',
  completedAward: '',
};

interface ExecCall {
  actionId: string;
  input: Record<string, unknown>;
  ctx: unknown;
}
const calls: ExecCall[] = [];

/** Stub of the app's executor: records calls and performs the writes a real action would (service role). */
const executor: CgExecutor = {
  async execute(actionId, input, actx) {
    const i = input as Record<string, unknown>;
    calls.push({ actionId, input: i, ctx: actx });
    const agent = (actx as { agent?: boolean } | undefined)?.agent === true;
    if (actionId === 'applications.start') {
      const row = await t.db
        .insertInto('applications')
        .values({
          workspace_id: ws.id,
          opportunity_id: ids.open,
          competition_id: String(i.competitionId),
          applicant_org_id: (i.applicantOrgId as string | undefined) ?? null,
          applicant_user_id: applicant.id,
          reference_number: `HRF-2027-${Math.floor(Math.random() * 1e5)}`,
          title: 'Started via CommonGrants',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      // The real executor wraps outputs as { status: 'ok', output }.
      return { status: 'ok', output: { applicationId: row.id } };
    }
    if (actionId === 'applications.save_answers') {
      const version = await t.db.selectFrom('form_versions').select('id').where('form_id', '=', String(i.formId)).executeTakeFirstOrThrow();
      const row = await t.db
        .insertInto('form_responses')
        .values({
          workspace_id: ws.id,
          application_id: String(i.applicationId),
          form_id: String(i.formId),
          form_version_id: version.id,
          data: JSON.stringify(i.answers),
        })
        .onConflict((oc) => oc.columns(['application_id', 'form_id']).doUpdateSet({ data: JSON.stringify(i.answers), etag: 'etag-2' }))
        .returning('etag')
        .executeTakeFirstOrThrow();
      return { etag: row.etag, errors: [{ pointer: '/budget', message: 'Budget is required' }] };
    }
    if (actionId === 'applications.submit') {
      if (agent) {
        return {
          status: 'approval_required',
          approvalRequestId: 'apr_123',
          confirmUrl: `${ORIGIN}/approvals/apr_123`,
          expiresAt: '2026-10-01T00:00:00.000Z',
          preview: { title: 'Submit application' },
        };
      }
      return { status: 'submitted', receiptNumber: 'RCPT-0001', submittedAt: '2026-11-01T00:00:00.000Z' };
    }
    throw new Error(`unexpected action ${actionId}`);
  },
};

function ctxFor(claims: RequestClaims, extra: Partial<CgContext> = {}): CgContext {
  return { workspace: ws, origin: ORIGIN, db: t.db, claims, executor, actionContext: { requestId: 'test' }, ...extra };
}
const anon = (): CgContext => ctxFor({ role: 'anon' });
const as = (u: TestUser, extra: Partial<CgContext> = {}): CgContext => ctxFor(claimsFor(u), extra);

async function call(ctx: CgContext, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await handleCommonGrants(
    new Request(`${BASE}${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
    ctx,
  );
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown> & { items?: Record<string, unknown>[]; data?: Record<string, unknown> }) : {};
  return { res, json };
}

function valid(schema: { safeParse(v: unknown): { success: boolean; error?: { issues: unknown[] } } }, value: unknown) {
  const r = schema.safeParse(value);
  if (!r.success) throw new Error(`CommonGrants contract violation:\n${JSON.stringify(r.error?.issues, null, 2)}\n${JSON.stringify(value, null, 2)}`);
}

function expectProblem(res: Response, json: Record<string, unknown>, status: number) {
  expect(res.status).toBe(status);
  expect(res.headers.get('content-type')).toContain('application/problem+json');
  expect(json).toMatchObject({ status, type: expect.any(String), title: expect.any(String), detail: expect.any(String) });
  valid(ErrorSchema, json);
}

const itemIds = (json: { items?: Record<string, unknown>[] }) => (json.items ?? []).map((i) => i.id as string);

async function insertOpp(workspaceId: string, values: Record<string, unknown>): Promise<string> {
  const row = await t.db
    .insertInto('opportunities')
    .values({ workspace_id: workspaceId, slug: `opp-${randomUUID().slice(0, 8)}`, title: 'Untitled', ...values })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

beforeAll(async () => {
  t = await createTestDatabase('gms_cg');
  staff = await createUser(t.db, { name: 'Pat Officer' });
  applicant = await createUser(t.db, { name: 'Maya Chen' });
  outsider = await createUser(t.db, { name: 'Olu Outsider' });
  ws = await t.db
    .insertInto('workspaces')
    .values({ slug: 'halcyon', name: 'Halcyon Foundation', timezone: 'America/Los_Angeles' })
    .returning(['id', 'slug', 'name', 'timezone'])
    .executeTakeFirstOrThrow();
  otherWs = await t.db.insertInto('workspaces').values({ slug: 'otherfdn', name: 'Other Foundation' }).returning(['id', 'slug', 'name', 'timezone']).executeTakeFirstOrThrow();
  await t.db.insertInto('workspace_members').values({ workspace_id: ws.id, user_id: staff.id, role: 'program_officer' }).execute();
  const program = await t.db.insertInto('programs').values({ workspace_id: ws.id, name: 'Watersheds', slug: 'watersheds' }).returning('id').executeTakeFirstOrThrow();

  ids.forecast = await insertOpp(ws.id, {
    title: 'Forecast: Youth Arts 2028',
    status: 'forecasted',
    description_md: 'Coming soon.',
    forecast_at: '2026-09-01T16:00:00Z',
    last_modified_at: '2026-09-01T00:00:00Z',
  });
  ids.open = await insertOpp(ws.id, {
    slug: 'watershed-restoration',
    title: 'Watershed Restoration Grants',
    status: 'open',
    program_id: program.id,
    summary: 'Restore creeks and wetlands.',
    description_md: 'Grants for community watershed restoration.',
    eligibility_md: 'Nonprofits in the Bay Area.',
    funding_total_cents: 100_000_000,
    award_min_cents: 1_000_000,
    award_max_cents: 5_000_000,
    expected_award_count: 20,
    applicant_types: ['nonprofit_501c3', 'fiscally_sponsored'],
    cause_terms: ['environment'],
    geography_terms: ['ca-bay-area'],
    opens_at: '2026-09-15T16:00:00Z',
    closes_at: '2026-12-06T01:00:00Z',
    decision_expected_on: '2027-02-15',
    last_modified_at: '2026-09-20T00:00:00Z',
  });
  ids.closed = await insertOpp(ws.id, {
    title: 'Closed: Emergency Relief 2026',
    status: 'closed',
    description_md: 'Closed.',
    funding_total_cents: 20_000_000,
    closes_at: '2026-03-01T08:00:00Z',
    cause_terms: ['relief'],
    last_modified_at: '2026-09-10T00:00:00Z',
  });
  ids.draft = await insertOpp(ws.id, { title: 'Draft: secret', status: 'draft', last_modified_at: '2026-09-25T00:00:00Z' });
  ids.noFeed = await insertOpp(ws.id, {
    title: 'Open but not in the CG feed',
    status: 'open',
    distribution: JSON.stringify({ site: true, embed: true, cgFeed: false, openGrants: false }),
    last_modified_at: '2026-09-26T00:00:00Z',
  });
  ids.unlisted = await insertOpp(ws.id, { title: 'Unlisted: invite round', status: 'open', visibility: 'unlisted', last_modified_at: '2026-09-24T00:00:00Z' });
  ids.otherWsOpen = await insertOpp(otherWs.id, { title: 'Other foundation grant', status: 'open' });

  ids.competition = (
    await t.db
      .insertInto('competitions')
      .values({ workspace_id: ws.id, opportunity_id: ids.open, name: 'Full application', status: 'open', opens_at: '2026-09-15T16:00:00Z', closes_at: '2026-12-06T01:00:00Z' })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  ids.draftCompetition = (
    await t.db
      .insertInto('competitions')
      .values({ workspace_id: ws.id, opportunity_id: ids.open, name: 'Stage 2 (draft)', stage_order: 2, status: 'draft' })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;

  ids.form = (await t.db.insertInto('forms').values({ workspace_id: ws.id, name: 'Project proposal', description: 'Tell us about the project.' }).returning('id').executeTakeFirstOrThrow()).id;
  ids.formVersion = (
    await t.db
      .insertInto('form_versions')
      .values({
        workspace_id: ws.id,
        form_id: ids.form,
        version: 1,
        status: 'published',
        published_at: '2026-09-15T00:00:00Z',
        json_schema: JSON.stringify({ type: 'object', properties: { projectTitle: { type: 'string' }, budget: { type: 'number' } }, required: ['projectTitle'] }),
        ui_schema: JSON.stringify({ type: 'VerticalLayout', elements: [{ type: 'Control', scope: '#/properties/projectTitle' }] }),
        mapping_to_cg: JSON.stringify({ title: { field: 'projectTitle' } }),
        mapping_from_cg: JSON.stringify({ projectTitle: { field: 'title' } }),
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  await t.db.insertInto('competition_forms').values({ workspace_id: ws.id, competition_id: ids.competition, form_id: ids.form, form_version_id: ids.formVersion }).execute();

  ids.draftOnlyForm = (await t.db.insertInto('forms').values({ workspace_id: ws.id, name: 'Stage 2 budget' }).returning('id').executeTakeFirstOrThrow()).id;
  const draftVersion = await t.db
    .insertInto('form_versions')
    .values({ workspace_id: ws.id, form_id: ids.draftOnlyForm, version: 1, status: 'draft' })
    .returning('id')
    .executeTakeFirstOrThrow();
  await t.db.insertInto('competition_forms').values({ workspace_id: ws.id, competition_id: ids.draftCompetition, form_id: ids.draftOnlyForm, form_version_id: draftVersion.id }).execute();

  ids.org = (
    await t.db
      .insertInto('applicant_orgs')
      .values({ legal_name: 'Creekside Stewards', ein: '94-7654321', uei: 'ABCDEFGH1234', created_by: applicant.id })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  await t.db.insertInto('applicant_org_members').values({ org_id: ids.org, user_id: applicant.id, role: 'org_admin' }).execute();
  await t.db.insertInto('org_addresses').values({ org_id: ids.org, line1: '1 Creek Rd', city: 'Martinez', state: 'CA', postal_code: '94553', county: 'Contra Costa' }).execute();

  ids.application = (
    await t.db
      .insertInto('applications')
      .values({
        workspace_id: ws.id,
        opportunity_id: ids.open,
        competition_id: ids.competition,
        applicant_org_id: ids.org,
        applicant_user_id: applicant.id,
        reference_number: 'HRF-2027-00001',
        title: 'Restore Alhambra Creek',
        requested_amount_cents: 2_500_000,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  await t.db
    .insertInto('form_responses')
    .values({ workspace_id: ws.id, application_id: ids.application, form_id: ids.form, form_version_id: ids.formVersion, data: JSON.stringify({ projectTitle: 'Alhambra Creek' }), etag: 'etag-1' })
    .execute();
  ids.otherApplication = (
    await t.db
      .insertInto('applications')
      .values({
        workspace_id: ws.id,
        opportunity_id: ids.open,
        competition_id: ids.competition,
        applicant_user_id: outsider.id,
        reference_number: 'HRF-2027-00002',
        title: 'Someone else',
        status: 'submitted',
        submitted_at: '2026-10-20T00:00:00Z',
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;

  const awardBase = { workspace_id: ws.id, opportunity_id: ids.open, program_id: program.id, applicant_org_id: ids.org, currency: 'USD' };
  ids.award = (
    await t.db
      .insertInto('awards')
      .values({
        ...awardBase,
        application_id: ids.application,
        reference: 'HRF-AWD-2027-001',
        title: 'Alhambra Creek restoration',
        purpose: 'Restore 2 miles of creek.',
        amount_cents: 2_500_000,
        disbursed_cents: 1_000_000,
        start_date: '2027-01-01',
        end_date: '2027-12-31',
        fiscal_year: 2027,
        status: 'active',
        hold_reason: 'SECRET HOLD NOTE',
        last_modified_at: '2026-12-01T00:00:00Z',
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  ids.completedAward = (
    await t.db
      .insertInto('awards')
      .values({ ...awardBase, reference: 'HRF-AWD-2026-009', title: 'Creek cleanup 2026', amount_cents: 500_000, status: 'completed', last_modified_at: '2026-06-01T00:00:00Z' })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  ids.draftAward = (
    await t.db
      .insertInto('awards')
      .values({ ...awardBase, reference: 'HRF-AWD-2027-002', title: 'Draft award', amount_cents: 100_000, status: 'draft' })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  // An approved amendment raises the awarded amount staff see (and the public ceiling).
  await t.db
    .insertInto('awards')
    .values({ ...awardBase, parent_award_id: ids.award, kind: 'amendment', amendment_status: 'approved', reference: 'HRF-AWD-2027-001-A1', title: 'Amendment 1', amount_cents: 500_000 })
    .execute();
});

afterAll(async () => {
  await t?.drop();
});

// ---------------------------------------------------------------------------------------

describe('GET /opportunities (required)', () => {
  it('pages public opportunities sorted by lastModifiedAt desc', async () => {
    const { res, json } = await call(anon(), 'GET', '/opportunities?page=1&pageSize=2');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toContain('public');
    valid(ResponseSchemas.opportunityList, json);
    for (const item of json.items ?? []) valid(GmsOpportunitySchema, item);
    expect(itemIds(json)).toEqual([ids.open, ids.closed]);
    expect(json.paginationInfo).toEqual({ page: 1, pageSize: 2, totalItems: 3, totalPages: 2 });

    const p2 = await call(anon(), 'GET', '/opportunities?page=2&pageSize=2');
    valid(ResponseSchemas.opportunityList, p2.json);
    expect(itemIds(p2.json)).toEqual([ids.forecast]);

    const past = await call(anon(), 'GET', '/opportunities?page=9&pageSize=2');
    valid(ResponseSchemas.opportunityList, past.json);
    expect(past.json.items).toEqual([]);
    expect(past.json.paginationInfo).toMatchObject({ page: 9, totalItems: 3 });
  });

  it('defaults to page 1 / pageSize 100', async () => {
    const { json } = await call(anon(), 'GET', '/opportunities');
    expect(json.paginationInfo).toEqual({ page: 1, pageSize: 100, totalItems: 3, totalPages: 1 });
  });

  it('never lists drafts, cgFeed=false, unlisted or other workspaces (anon or staff)', async () => {
    for (const ctx of [anon(), as(staff)]) {
      const { json } = await call(ctx, 'GET', '/opportunities');
      const got = itemIds(json);
      expect(got.sort()).toEqual([ids.forecast, ids.open, ids.closed].sort());
      for (const hidden of [ids.draft, ids.noFeed, ids.unlisted, ids.otherWsOpen]) expect(got).not.toContain(hidden);
    }
  });

  it('staff responses are private', async () => {
    const { res } = await call(as(staff), 'GET', '/opportunities');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it.each(['page=0', 'pageSize=0', 'pageSize=101', 'page=abc', 'pageSize=2.5'])('rejects %s with a 400 problem', async (qs) => {
    const { res, json } = await call(anon(), 'GET', `/opportunities?${qs}`);
    expectProblem(res, json, 400);
  });
});

describe('GET /opportunities/{oppId} (required)', () => {
  it('returns OpportunityDetails with competitions and forms', async () => {
    const { res, json } = await call(anon(), 'GET', `/opportunities/${ids.open}`);
    expect(res.status).toBe(200);
    valid(ResponseSchemas.opportunityRead, json);
    valid(OpportunityBaseSchema, json.data);
    valid(GmsOpportunitySchema, json.data);
    const data = json.data as Record<string, unknown> & { competitions: { id: string; forms: { forms: Record<string, unknown> } }[]; customFields: Record<string, { value: unknown }> };
    expect(data).toMatchObject({
      id: ids.open,
      title: 'Watershed Restoration Grants',
      status: { value: 'open' },
      source: `${ORIGIN}/opportunities/watershed-restoration`,
      funding: { totalAmountAvailable: { amount: '1000000.00', currency: 'USD' }, estimatedAwardCount: 20 },
      keyDates: { closeDate: { eventType: 'singleDate', date: '2026-12-05', time: '17:00:00' } },
    });
    expect(data.customFields.applyUrl?.value).toBe(`${ORIGIN}/opportunities/watershed-restoration/apply`);
    expect(data.customFields.causeAreas?.value).toEqual(['environment']);
    // Programs are staff-only under RLS, so anon callers do not get programName.
    expect(data.customFields.programName).toBeUndefined();
    expect(data.competitions.map((c) => c.id)).toEqual([ids.competition]);
    expect(Object.keys(data.competitions[0]!.forms.forms)).toEqual([ids.form]);
  });

  it('staff get programName', async () => {
    const { json } = await call(as(staff), 'GET', `/opportunities/${ids.open}`);
    expect((json.data as { customFields: Record<string, { value: unknown }> }).customFields.programName?.value).toBe('Watersheds');
  });

  it('serves unlisted opportunities by id', async () => {
    const { res } = await call(anon(), 'GET', `/opportunities/${ids.unlisted}`);
    expect(res.status).toBe(200);
  });

  it.each([
    ['draft', () => ids.draft],
    ['cgFeed=false', () => ids.noFeed],
    ['other workspace', () => ids.otherWsOpen],
    ['missing', () => randomUUID()],
    ['not a uuid', () => 'not-a-uuid'],
  ])('404 problem for %s', async (_label, id) => {
    for (const ctx of [anon(), as(staff)]) {
      const { res, json } = await call(ctx, 'GET', `/opportunities/${id()}`);
      expectProblem(res, json, 404);
      valid(NotFoundSchema, json);
    }
  });
});

describe('POST /opportunities/search (optional)', () => {
  const search = (body: unknown, ctx = anon()) => call(ctx, 'POST', '/opportunities/search', body);

  it('returns a Filtered envelope with sortInfo and filterInfo', async () => {
    const body = { filters: { status: { operator: 'in', value: ['open', 'closed'] } }, sorting: { sortBy: 'title', sortOrder: 'asc' }, pagination: { page: 1, pageSize: 10 } };
    const { res, json } = await search(body);
    expect(res.status).toBe(200);
    valid(ResponseSchemas.opportunitySearch, json);
    expect(itemIds(json)).toEqual([ids.closed, ids.open]);
    expect(json.sortInfo).toEqual({ sortBy: 'title', sortOrder: 'asc' });
    expect(json.filterInfo).toEqual({ filters: body.filters });
  });

  it('filters by status notIn, close date range, funding range and text', async () => {
    const notIn = await search({ filters: { status: { operator: 'notIn', value: ['open'] } } });
    expect(itemIds(notIn.json).sort()).toEqual([ids.forecast, ids.closed].sort());

    // closes 2026-12-05 17:00 in Los Angeles: a date-only max of 2026-12-05 includes it.
    const dec = await search({ filters: { closeDateRange: { operator: 'between', value: { min: '2026-12-01', max: '2026-12-05' } } } });
    valid(ResponseSchemas.opportunitySearch, dec.json);
    expect(itemIds(dec.json)).toEqual([ids.open]);
    const before = await search({ filters: { closeDateRange: { operator: 'between', value: { min: '2026-12-06', max: '2027-01-01' } } } });
    expect(itemIds(before.json)).toEqual([]);
    const outside = await search({ filters: { closeDateRange: { operator: 'outside', value: { min: '2026-12-01', max: '2026-12-31' } } } });
    expect(itemIds(outside.json)).toEqual([ids.closed]);

    const funding = await search({
      filters: { totalFundingAvailableRange: { operator: 'between', value: { min: { amount: '500000', currency: 'USD' }, max: { amount: '2000000', currency: 'USD' } } } },
    });
    expect(itemIds(funding.json)).toEqual([ids.open]);
    const maxAward = await search({ filters: { maxAwardAmountRange: { operator: 'between', value: { min: { amount: '40000', currency: 'USD' }, max: { amount: '50000.00', currency: 'USD' } } } } });
    expect(itemIds(maxAward.json)).toEqual([ids.open]);

    const text = await search({ search: 'watershed' });
    expect(itemIds(text.json)).toEqual([ids.open]);
    const none = await search({ search: 'secret' });
    expect(itemIds(none.json)).toEqual([]);
  });

  it('supports the GMS causeAreas custom filter and reports unknown ones', async () => {
    const { json } = await search({ filters: { customFilters: { causeAreas: { operator: 'in', value: ['relief'] }, colour: { operator: 'eq', value: 'blue' } } } });
    valid(ResponseSchemas.opportunitySearch, json);
    expect(itemIds(json)).toEqual([ids.closed]);
    expect((json.filterInfo as { errors: string[] }).errors).toEqual(['Custom filter "colour" is not supported and was ignored.']);
  });

  it('sorts by close date and paginates from the body', async () => {
    const { json } = await search({ sorting: { sortBy: 'keyDates.closeDate', sortOrder: 'asc' }, pagination: { page: 1, pageSize: 1 } });
    valid(ResponseSchemas.opportunitySearch, json);
    expect(itemIds(json)).toEqual([ids.closed]);
    expect(json.paginationInfo).toEqual({ page: 1, pageSize: 1, totalItems: 3, totalPages: 3 });
  });

  it('never returns drafts even when asked for them', async () => {
    const { json } = await search({ filters: { status: { operator: 'in', value: ['draft'] } } }, as(staff));
    expect(itemIds(json)).toEqual([]);
    expect((json.filterInfo as { errors: string[] }).errors[0]).toContain('only forecasted, open and closed');
  });

  it.each([
    ['not json', '{nope'],
    ['bad operator', { filters: { status: { operator: 'between', value: ['open'] } } }],
    ['bad sortBy', { sorting: { sortBy: 'popularity' } }],
    ['pageSize too big', { pagination: { pageSize: 1000 } }],
    ['sub-cent money', { filters: { totalFundingAvailableRange: { operator: 'between', value: { min: { amount: '0.001', currency: 'USD' }, max: { amount: '1', currency: 'USD' } } } } }],
  ])('400 problem for %s', async (_label, body) => {
    const { res, json } = await search(body);
    expectProblem(res, json, 400);
  });
});

describe('forms and competitions (experimental)', () => {
  it('GET /forms lists only published versions attached to public competitions', async () => {
    const { res, json } = await call(anon(), 'GET', '/forms');
    expect(res.status).toBe(200);
    valid(ResponseSchemas.formList, json);
    expect(itemIds(json)).toEqual([ids.form]);
    expect(json.items?.[0]).toMatchObject({ name: 'Project proposal', version: '1', mappingToCommonGrants: { title: { field: 'projectTitle' } } });
  });

  it('GET /forms/{formId}', async () => {
    const { json } = await call(anon(), 'GET', `/forms/${ids.form}`);
    valid(ResponseSchemas.formRead, json);
    expect(json.data).toMatchObject({ id: ids.form, jsonSchema: { required: ['projectTitle'] } });
    const draft = await call(anon(), 'GET', `/forms/${ids.draftOnlyForm}`);
    expectProblem(draft.res, draft.json, 404);
  });

  it('GET /competitions and /competitions/{compId}', async () => {
    const list = await call(anon(), 'GET', '/competitions');
    valid(ResponseSchemas.competitionList, list.json);
    expect(itemIds(list.json)).toEqual([ids.competition]);

    const { json } = await call(anon(), 'GET', `/competitions/${ids.competition}`);
    valid(ResponseSchemas.competitionRead, json);
    expect(json.data).toMatchObject({ id: ids.competition, opportunityId: ids.open, status: { value: 'open' } });
    const draft = await call(as(staff), 'GET', `/competitions/${ids.draftCompetition}`);
    expectProblem(draft.res, draft.json, 404);
  });
});

describe('awards (experimental)', () => {
  it('anon callers get the public transparency view', async () => {
    const { res, json } = await call(anon(), 'GET', '/awards');
    expect(res.status).toBe(200);
    valid(ResponseSchemas.awardList, json);
    expect(itemIds(json)).toEqual([ids.award, ids.completedAward]);
    const award = json.items![0] as Record<string, unknown> & { funding: Record<string, unknown>; customFields: Record<string, { value: unknown }> };
    expect(Object.keys(award.funding)).toEqual(['awardedAmount']);
    expect(award.customFields.recipientName?.value).toBe('Creekside Stewards');
    expect(award.customFields.recipientLocation?.value).toEqual({ city: 'Martinez', county: 'Contra Costa', state: 'CA' });
    expect(award.recipientOrganizations).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain('SECRET HOLD NOTE');
  });

  // KNOWN SCHEMA BUG (outside this package): public_awards.amount_cents calls
  // gms_private.award_ceiling_cents(), which is not SECURITY DEFINER, so for gms_anon its
  // `select … from public.awards` is filtered by RLS and the public amount is always 0.
  // Fix with a migration (make the function security definer); then flip this to `it`.
  it.fails('anon awardedAmount includes the original award plus approved amendments', async () => {
    const { json } = await call(anon(), 'GET', `/awards/${ids.award}`);
    expect((json.data as { funding: unknown }).funding).toEqual({ awardedAmount: { amount: '30000.00', currency: 'USD' } });
  });

  it('staff get full awards with disbursedAmount and recipient identifiers', async () => {
    const { json } = await call(as(staff), 'GET', `/awards/${ids.award}`);
    valid(ResponseSchemas.awardRead, json);
    expect(json.data).toMatchObject({
      status: { value: 'awarded' },
      funding: { awardedAmount: { amount: '30000.00', currency: 'USD' }, disbursedAmount: { amount: '10000.00', currency: 'USD' } },
      recipientOrganizations: { primary: { id: ids.org, identifiers: { 'org:us:ein': { id: '947654321' }, 'org:us:uei': { id: 'ABCDEFGH1234' } } } },
      application: { id: ids.application, title: 'Restore Alhambra Creek' },
      funders: { primary: { id: ws.id, name: 'Halcyon Foundation' } },
    });
  });

  it('GET /awards/{awdId} hides drafts and amendments', async () => {
    for (const id of [ids.draftAward, randomUUID()]) {
      for (const ctx of [anon(), as(staff)]) {
        const { res, json } = await call(ctx, 'GET', `/awards/${id}`);
        expectProblem(res, json, 404);
      }
    }
  });

  it('POST /awards/search filters by status and awarded amount', async () => {
    const status = await call(anon(), 'POST', '/awards/search', { filters: { status: { operator: 'in', value: ['completed'] } } });
    valid(ResponseSchemas.awardSearch, status.json);
    expect(itemIds(status.json)).toEqual([ids.completedAward]);
    const amount = await call(as(staff), 'POST', '/awards/search', {
      filters: { awardedAmountRange: { operator: 'between', value: { min: { amount: '25000.01', currency: 'USD' }, max: { amount: '1000000', currency: 'USD' } } } },
      sorting: { sortBy: 'funding.awardedAmount', sortOrder: 'desc' },
    });
    valid(ResponseSchemas.awardSearch, amount.json);
    expect(itemIds(amount.json)).toEqual([ids.award]);
    const text = await call(anon(), 'POST', '/awards/search', { search: 'cleanup', filters: { opportunityId: { operator: 'in', value: [ids.open] } } });
    expect(itemIds(text.json)).toEqual([ids.completedAward]);
  });
});

describe('applications (experimental)', () => {
  const routes: [string, string, unknown?][] = [
    ['POST', '/applications/start', { competitionId: randomUUID() }],
    ['GET', '/applications/00000000-0000-4000-8000-000000000000'],
    ['GET', '/applications/00000000-0000-4000-8000-000000000000/forms/00000000-0000-4000-8000-000000000000'],
    ['PUT', '/applications/00000000-0000-4000-8000-000000000000/forms/00000000-0000-4000-8000-000000000000', { a: 1 }],
    ['PUT', '/applications/00000000-0000-4000-8000-000000000000/submit', {}],
    ['POST', '/applications/search', {}],
  ];

  it.each(routes)('anonymous %s %s -> 401 with WWW-Authenticate', async (method, path, body) => {
    const { res, json } = await call(anon(), method, path, body);
    expectProblem(res, json, 401);
    valid(UnauthorizedSchema, json);
    expect(res.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`);
  });

  it('GET /applications/{appId} for the applicant, 404 for others', async () => {
    const { res, json } = await call(as(applicant), 'GET', `/applications/${ids.application}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    valid(ResponseSchemas.applicationRead, json);
    expect(json.data).toMatchObject({
      id: ids.application,
      status: { value: 'inProgress' },
      competitionId: ids.competition,
      opportunityId: ids.open,
      formResponses: { [ids.form]: { formId: ids.form, response: { projectTitle: 'Alhambra Creek' }, status: { value: 'inProgress' } } },
      customFields: { requestedAmount: { value: { amount: '25000.00', currency: 'USD' } } },
    });
    const other = await call(as(applicant), 'GET', `/applications/${ids.otherApplication}`);
    expectProblem(other.res, other.json, 404);
    const outsiderView = await call(as(outsider), 'GET', `/applications/${ids.application}`);
    expectProblem(outsiderView.res, outsiderView.json, 404);
  });

  it('GET /applications/{appId}/forms/{formId}', async () => {
    const { res, json } = await call(as(applicant), 'GET', `/applications/${ids.application}/forms/${ids.form}`);
    valid(ResponseSchemas.formResponseRead, json);
    expect(res.headers.get('etag')).toBe('"etag-1"');
    const missing = await call(as(applicant), 'GET', `/applications/${ids.application}/forms/${ids.draftOnlyForm}`);
    expectProblem(missing.res, missing.json, 404);
  });

  it('POST /applications/start calls applications.start and returns 201', async () => {
    calls.length = 0;
    const { res, json } = await call(as(applicant), 'POST', '/applications/start', { competitionId: ids.competition, organizationId: ids.org, title: 'Ignored title' });
    expect(res.status).toBe(201);
    valid(ResponseSchemas.applicationCreated, json);
    expect(calls).toEqual([{ actionId: 'applications.start', input: { competitionId: ids.competition, applicantOrgId: ids.org }, ctx: { requestId: 'test' } }]);
    expect(json.status).toBe(201);
    expect(res.headers.get('location')).toBe(`${BASE}/applications/${(json.data as { id: string }).id}`);
  });

  it('POST /applications/start 404s for competitions that are not public', async () => {
    calls.length = 0;
    const { res, json } = await call(as(applicant), 'POST', '/applications/start', { competitionId: ids.draftCompetition });
    expectProblem(res, json, 404);
    expect(calls).toEqual([]);
    const bad = await call(as(applicant), 'POST', '/applications/start', { organizationId: ids.org });
    expectProblem(bad.res, bad.json, 400);
  });

  it('PUT /applications/{appId}/forms/{formId} calls applications.save_answers with the If-Match etag', async () => {
    calls.length = 0;
    const answers = { projectTitle: 'Alhambra Creek, phase 2' };
    const { res, json } = await call(as(applicant), 'PUT', `/applications/${ids.application}/forms/${ids.form}`, answers, { 'if-match': '"etag-1"' });
    expect(res.status).toBe(200);
    valid(ResponseSchemas.formResponseRead, json);
    expect(calls).toEqual([
      { actionId: 'applications.save_answers', input: { applicationId: ids.application, formId: ids.form, answers, etag: 'etag-1' }, ctx: { requestId: 'test' } },
    ]);
    expect(res.headers.get('etag')).toBe('"etag-2"');
    expect(json.data).toMatchObject({ response: answers, validationErrors: [{ pointer: '/budget', message: 'Budget is required' }], status: { value: 'inProgress' } });

    const notObject = await call(as(applicant), 'PUT', `/applications/${ids.application}/forms/${ids.form}`, [1, 2]);
    expectProblem(notObject.res, notObject.json, 400);
    const foreign = await call(as(outsider), 'PUT', `/applications/${ids.application}/forms/${ids.form}`, answers);
    expectProblem(foreign.res, foreign.json, 404);
    expect(calls).toHaveLength(1);
  });

  it('PUT /applications/{appId}/submit requires an attestation and calls applications.submit', async () => {
    calls.length = 0;
    const missing = await call(as(applicant), 'PUT', `/applications/${ids.application}/submit`, {});
    expectProblem(missing.res, missing.json, 400);
    expect(calls).toEqual([]);

    const body = { attestation: { typedName: 'Maya Chen', agreed: true }, aiDisclosure: 'Used an assistant to edit.' };
    const { res, json } = await call(as(applicant), 'PUT', `/applications/${ids.application}/submit`, body);
    expect(res.status).toBe(200);
    valid(ResponseSchemas.submitted, json);
    expect(json.data).toEqual({ status: 'submitted', receiptNumber: 'RCPT-0001', submittedAt: '2026-11-01T00:00:00.000Z' });
    expect(calls).toEqual([{ actionId: 'applications.submit', input: { applicationId: ids.application, ...body }, ctx: { requestId: 'test' } }]);
  });

  it('agent submissions return 202 with the approval request', async () => {
    const { res, json } = await call(as(applicant, { actionContext: { agent: true } }), 'PUT', `/applications/${ids.application}/submit`, {
      attestation: { typedName: 'Maya Chen', agreed: true },
    });
    expect(res.status).toBe(202);
    valid(ResponseSchemas.accepted, json);
    expect(json).toMatchObject({
      status: 202,
      data: { status: 'approval_required', approvalRequestId: 'apr_123', confirmUrl: `${ORIGIN}/approvals/apr_123`, expiresAt: '2026-10-01T00:00:00.000Z' },
    });
  });

  it('write routes report 503 when no executor is configured', async () => {
    const { res, json } = await call(as(applicant, { executor: undefined }), 'PUT', `/applications/${ids.application}/forms/${ids.form}`, { a: 1 });
    expectProblem(res, json, 503);
  });

  it('POST /applications/search is scoped by RLS', async () => {
    const mine = await call(as(applicant), 'POST', '/applications/search', { filters: { competitionId: { operator: 'in', value: [ids.competition] } } });
    valid(ResponseSchemas.applicationSearch, mine.json);
    expect(itemIds(mine.json)).not.toContain(ids.otherApplication);
    expect(itemIds(mine.json)).toContain(ids.application);

    const staffView = await call(as(staff), 'POST', '/applications/search', {
      filters: { status: { operator: 'in', value: ['submitted'] } },
      sorting: { sortBy: 'submittedAt', sortOrder: 'desc' },
    });
    valid(ResponseSchemas.applicationSearch, staffView.json);
    expect(itemIds(staffView.json)).toEqual([ids.otherApplication]);
  });
});

describe('routing', () => {
  it('unknown routes are 404 problems', async () => {
    for (const path of ['/nope', '/opportunities/search/extra', '/orgs']) {
      const { res, json } = await call(anon(), 'GET', path);
      expectProblem(res, json, 404);
    }
  });

  it('wrong methods are 405 with Allow', async () => {
    const { res, json } = await call(anon(), 'DELETE', '/opportunities');
    expectProblem(res, json, 405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
  });

  it('HEAD mirrors GET without a body', async () => {
    const res = await handleCommonGrants(new Request(`${BASE}/opportunities`, { method: 'HEAD' }), anon());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('serves the OpenAPI document', async () => {
    const { res, json } = await call(anon(), 'GET', '/openapi.json');
    expect(res.status).toBe(200);
    expect(json.openapi).toBe('3.1.0');
    const paths = json.paths as Record<string, Record<string, { 'x-cg-conformance': string }>>;
    expect(paths['/common-grants/opportunities']?.get?.['x-cg-conformance']).toBe('required');
    expect(paths['/common-grants/opportunities/search']?.post?.['x-cg-conformance']).toBe('optional');
  });
});
