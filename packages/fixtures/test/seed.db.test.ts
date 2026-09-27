// SPDX-License-Identifier: AGPL-3.0-only
// Seeds a fresh database with the full demo data set and checks the counts and invariants the demos and
// E2E tests rely on. Also checks --minimal mode and that seeding twice is refused.
import { currentTotpForFactor } from '@gms/adapters';
import { sql } from '@gms/db';
import { createTestDatabase, type TestDatabase } from '@gms/db/testing';
import type { RawBuilder } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Runtime } from '@gms/actions';
import { DEMO_TOTP_SECRETS, DEMO_USERS, DemoDataExistsError, SEED_IDS, seed, totpNow, type SeedResult } from '../src/index';

process.env.GMS_AUTH_MODE = 'test';

const ANCHOR = new Date('2026-09-27T12:00:00.000Z');
let t: TestDatabase;
let runtime: Runtime;
let result: SeedResult;

async function count(q: RawBuilder<unknown>): Promise<number> {
  const r = await q.execute(t.db);
  return Number((r.rows[0] as { n?: number } | undefined)?.n ?? 0);
}

beforeAll(async () => {
  t = await createTestDatabase('gms_seed');
  const { createRuntime } = await import('@gms/actions');
  runtime = createRuntime({ db: t.db });
  result = await seed({ runtime, now: ANCHOR, documents: false });
});

afterAll(async () => {
  await t?.drop();
});

describe('full demo seed', () => {
  it('creates the three tenants and six Halcyon opportunities across every status', async () => {
    expect(result.mode).toBe('full');
    const ws = await t.db.selectFrom('workspaces').select('slug').orderBy('slug').execute();
    expect(ws.map((w) => w.slug)).toEqual(['halcyon', 'marigold', 'sunbeam']);
    const opps = await t.db
      .selectFrom('opportunities as o')
      .innerJoin('workspaces as w', 'w.id', 'o.workspace_id')
      .select(['o.slug', 'o.status'])
      .where('w.slug', '=', 'halcyon')
      .execute();
    expect(opps).toHaveLength(6);
    expect(new Set(opps.map((o) => o.status))).toEqual(new Set(['draft', 'forecasted', 'open', 'closed', 'archived']));
    expect(opps.filter((o) => o.status === 'open')).toHaveLength(2);
    expect(opps.find((o) => o.slug === SEED_IDS.alwaysOpen.slug)?.status).toBe('open');
    expect(opps.find((o) => o.slug === SEED_IDS.flagship.slug)?.status).toBe('forecasted');
    const brand = await t.db.selectFrom('workspace_brand as b').innerJoin('workspaces as w', 'w.id', 'b.workspace_id').select(['w.slug', 'b.contrast_warnings']).execute();
    expect(brand.find((b) => b.slug === 'sunbeam')?.contrast_warnings).not.toEqual([]);
  });

  it('has 142 flagship LOIs and ~800 historical applications with immutable snapshots', async () => {
    expect(await count(sql`select count(*)::int as n from applications where opportunity_id = ${SEED_IDS.flagship.opportunityId}::uuid`)).toBe(142);
    const statuses = await t.db.selectFrom('applications').select('status').distinct().where('opportunity_id', '=', SEED_IDS.flagship.opportunityId).execute();
    expect(new Set(statuses.map((s) => s.status))).toEqual(new Set(['in_progress', 'submitted', 'under_review', 'invited_to_next_stage', 'declined', 'withdrawn', 'ineligible']));
    const historical = await count(sql`select count(*)::int as n from applications a join opportunities o on o.id = a.opportunity_id where o.status in ('closed', 'archived')`);
    expect(historical).toBeGreaterThanOrEqual(780);
    expect(historical).toBeLessThanOrEqual(820);
    // Every submitted application has exactly one snapshot with a receipt; in-progress ones have none.
    expect(await count(sql`select count(*)::int as n from applications a where a.submitted_at is not null and not exists (select 1 from application_submissions s where s.application_id = a.id)`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from applications a join application_submissions s on s.application_id = a.id where a.status = 'in_progress'`)).toBe(0);
    await expect(sql`update application_submissions set receipt_number = 'x'`.execute(t.db)).rejects.toThrow(/append-only/);
  });

  it('keeps every award tree within its ceiling and has payments in every status', async () => {
    expect(await count(sql`select count(*)::int as n from payments p join workspaces w on w.id = p.workspace_id where w.slug = 'halcyon'`)).toBe(64);
    const over = await count(sql`
      select count(*)::int as n from awards a
      where a.kind = 'original' and (
        select coalesce(sum(p.amount_cents), 0) from payments p
        where gms_private.award_root(p.award_id) = a.id and p.status not in ('failed', 'cancelled')
      ) > gms_private.award_ceiling_cents(a.id)`);
    expect(over).toBe(0);
    const statuses = await t.db.selectFrom('payments').select('status').distinct().execute();
    expect(new Set(statuses.map((s) => s.status))).toEqual(
      new Set(['scheduled', 'in_batch', 'awaiting_approval', 'awaiting_bank_approval', 'sent', 'failed', 'held', 'reconciled', 'exception', 'cancelled']),
    );
    expect(await count(sql`select count(*)::int as n from recon_exceptions where status = 'open'`)).toBeGreaterThanOrEqual(1);
    // Batched payments only ever go to ready payees.
    expect(await count(sql`select count(*)::int as n from payments p join payees y on y.id = p.payee_id where p.status in ('in_batch', 'awaiting_approval', 'awaiting_bank_approval') and y.status <> 'ready'`)).toBe(0);
  });

  it('has 38 active awards, completed ones, an amendment and a supplement, with signed agreements', async () => {
    const halcyon = (await t.db.selectFrom('workspaces').select('id').where('slug', '=', 'halcyon').executeTakeFirstOrThrow()).id;
    const rows = await t.db.selectFrom('awards').select(['kind', 'status', 'amendment_status']).where('workspace_id', '=', halcyon).execute();
    expect(rows.filter((a) => a.kind === 'original' && a.status === 'active')).toHaveLength(38);
    expect(rows.filter((a) => a.kind === 'original' && a.status === 'completed').length).toBeGreaterThanOrEqual(3);
    expect(rows.some((a) => a.kind === 'amendment' && a.amendment_status === 'approved')).toBe(true);
    expect(rows.some((a) => a.kind === 'supplement')).toBe(true);
    expect(await count(sql`select count(*)::int as n from signatures s join agreements g on g.id = s.agreement_id where s.document_hash <> g.document_hash`)).toBe(0);
    const reports = await t.db.selectFrom('report_requirements').select('status').where('workspace_id', '=', halcyon).execute();
    expect(reports).toHaveLength(25);
    expect(new Set(reports.map((r) => r.status))).toEqual(new Set(['upcoming', 'due', 'overdue', 'submitted', 'accepted', 'revisions_requested']));
  });

  it('has six pending agent approval requests (applicant and staff side)', async () => {
    const reqs = await t.db.selectFrom('approval_requests').select(['audience', 'requester_name', 'status']).where('status', '=', 'awaiting_confirmation').execute();
    expect(reqs).toHaveLength(6);
    expect(reqs.filter((r) => r.audience === 'applicant' && r.requester_name === 'Grant Writer Assistant').length).toBeGreaterThanOrEqual(1);
    expect(reqs.filter((r) => r.audience === 'staff' && r.requester_name === 'Ops Assistant').length).toBeGreaterThanOrEqual(1);
    expect(result.tokens?.grantWriterAssistant.token).toMatch(/^gms_pat_/);
    expect(result.tokens?.opsAssistant.key).toMatch(/^gms_ak_/);
    // Tokens are stored only as hashes.
    const hash = (await import('node:crypto')).createHash('sha256').update(result.tokens!.grantWriterAssistant.token).digest('hex');
    expect(await count(sql`select count(*)::int as n from personal_access_tokens where token_hash = ${hash}`)).toBe(1);
    const agentAudit = await count(sql`select count(*)::int as n from audit_log where actor_type = 'agent' and actor_name = 'Grant Writer Assistant' and on_behalf_of_name = 'Maya Chen'`);
    expect(agentAudit).toBeGreaterThan(0);
  });

  it('gives every workspace member a verified TOTP factor with the documented secret', async () => {
    for (const u of DEMO_USERS.filter((x) => x.workspace !== null)) {
      const f = await sql<{ id: string }>`select f.id from gms_private.test_auth_factors f join auth.users u on u.id = f.user_id where u.email = ${u.email} and f.status = 'verified'`.execute(t.db);
      expect(f.rows, u.email).toHaveLength(1);
    }
    const helen = await sql<{ id: string }>`select f.id from gms_private.test_auth_factors f join auth.users u on u.id = f.user_id where u.email = 'helen@halcyonridge.example'`.execute(t.db);
    expect(await currentTotpForFactor(t.db, helen.rows[0]!.id)).toBe(totpNow(DEMO_TOTP_SECRETS['helen@halcyonridge.example']!));
  });

  it('sets up Maya’s state for the applicant demos', async () => {
    const m = SEED_IDS.maya;
    const org = await t.db.selectFrom('applicant_orgs').selectAll().where('id', '=', m.orgId).executeTakeFirstOrThrow();
    expect(org.ein).toBe('00-0000001');
    expect(org.ein_verified_at).not.toBeNull();
    expect(org.annual_budget_cents).toBe(48_000_000);
    const member = await t.db.selectFrom('applicant_org_members').select('role').where('org_id', '=', m.orgId).where('user_id', '=', m.userId).executeTakeFirstOrThrow();
    expect(member.role).toBe('org_admin');
    expect(await count(sql`select count(*)::int as n from applications where opportunity_id = ${SEED_IDS.alwaysOpen.opportunityId}::uuid and applicant_org_id = ${m.orgId}::uuid`)).toBe(0);
    const award = await t.db.selectFrom('awards').selectAll().where('id', '=', m.awardId).executeTakeFirstOrThrow();
    expect(award.status).toBe('active');
    expect(award.fiscal_year).toBe(2025);
    expect((await t.db.selectFrom('agreements').select('status').where('award_id', '=', m.awardId).executeTakeFirstOrThrow()).status).toBe('countersigned');
    expect((await t.db.selectFrom('payees').select('status').where('applicant_org_id', '=', m.orgId).executeTakeFirstOrThrow()).status).toBe('ready');
    const pays = await t.db.selectFrom('payments').select('status').where('award_id', '=', m.awardId).execute();
    expect(pays.map((p) => p.status)).toContain('sent');
    const req = await t.db.selectFrom('report_requirements').select(['status', 'due_date']).where('id', '=', m.upcomingReportRequirementId).executeTakeFirstOrThrow();
    expect(req.status).toBe('upcoming');
  });

  it('flags Cedar Hollow Food Pantry for sanctions review', async () => {
    const s = await t.db.selectFrom('sanctions_screenings').select('status').where('applicant_org_id', '=', SEED_IDS.orgs.cedarHollow).execute();
    expect(s.map((x) => x.status)).toContain('potential_match');
  });

  it('lets Marcus approve the batch Priya created (maker-checker, one approval under the threshold)', async () => {
    const batch = await t.db.selectFrom('payment_batches').selectAll().where('id', '=', SEED_IDS.batchAwaitingApprovalId).executeTakeFirstOrThrow();
    expect(batch.status).toBe('awaiting_approval');
    expect(batch.requires_second_approval).toBe(false);
    const priya = await t.db.selectFrom('profiles').select('id').where('email', '=', 'priya@halcyonridge.example').executeTakeFirstOrThrow();
    expect(batch.created_by).toBe(priya.id);
    const marcus = await t.db.selectFrom('profiles').select(['id', 'email', 'full_name']).where('email', '=', 'marcus@halcyonridge.example').executeTakeFirstOrThrow();
    const ws = await t.db.selectFrom('workspaces').select(['id', 'slug', 'name', 'timezone']).where('slug', '=', 'halcyon').executeTakeFirstOrThrow();
    const out = await runtime.executor.run<{ status: string }>(
      'payments.approve_batch',
      { batchId: batch.id },
      {
        workspace: ws,
        actor: { type: 'human', id: marcus.id, name: marcus.full_name ?? 'Marcus Webb' },
        roles: ['finance'],
        scopes: '*',
        claims: { role: 'authenticated', sub: marcus.id, email: marcus.email, aal: 'aal2' },
        aal: 'aal2',
        stepUpAt: new Date().toISOString(),
        requestId: 'test',
        channel: 'test',
      },
    );
    expect(out.status).toBe('approved');
  });

  it('lets people confirm their agents’ pending requests (applicant and staff side)', async () => {
    const { decideApproval } = await import('@gms/actions');
    const ws = await t.db.selectFrom('workspaces').select(['id', 'slug', 'name', 'timezone']).where('slug', '=', 'halcyon').executeTakeFirstOrThrow();
    const person = async (email: string) => t.db.selectFrom('profiles').select(['id', 'email', 'full_name']).where('email', '=', email).executeTakeFirstOrThrow();
    const human = (p: { id: string; email: string; full_name: string | null }, roles: ('owner' | 'finance')[]) => ({
      workspace: ws,
      actor: { type: 'human' as const, id: p.id, name: p.full_name ?? p.email },
      roles,
      scopes: '*' as const,
      claims: { role: 'authenticated' as const, sub: p.id, email: p.email, aal: 'aal1' as const },
      aal: 'aal1' as const,
      requestId: 'test',
      channel: 'test' as const,
    });
    const find = (actionId: string) => t.db.selectFrom('approval_requests').select('id').where('action_id', '=', actionId).where('status', '=', 'awaiting_confirmation').executeTakeFirstOrThrow();

    const maya = await person(SEED_IDS.maya.email);
    const report = await decideApproval(runtime.executor, t.db, { approvalRequestId: (await find('reports.submit')).id, decision: 'confirm' }, human(maya, []));
    expect(report).toMatchObject({ status: 'confirmed' });
    // The grantee's submission is recorded. (reports.submit updates report_requirements under the grantee's RLS,
    // which has no update policy for grantees, so the requirement row itself is not changed here.)
    const sub = await t.db.selectFrom('report_submissions').select('status').where('requirement_id', '=', SEED_IDS.maya.upcomingReportRequirementId).executeTakeFirstOrThrow();
    expect(sub.status).toBe('submitted');

    const helen = await person('helen@halcyonridge.example');
    const advance = await decideApproval(runtime.executor, t.db, { approvalRequestId: (await find('applications.advance')).id, decision: 'confirm' }, human(helen, ['owner']));
    expect(advance).toMatchObject({ status: 'confirmed' });
  });

  it('refuses to seed twice', async () => {
    await expect(seed({ runtime, now: ANCHOR, documents: false })).rejects.toBeInstanceOf(DemoDataExistsError);
  });
});

describe('minimal seed', () => {
  let m: TestDatabase;
  afterAll(async () => {
    await m?.drop();
  });

  it('creates only Halcyon, Helen (with a factor) and the brand', async () => {
    m = await createTestDatabase('gms_seed_min');
    const { createRuntime } = await import('@gms/actions');
    const r = await seed({ runtime: createRuntime({ db: m.db }), minimal: true, now: ANCHOR, documents: false });
    expect(r.mode).toBe('minimal');
    expect((await m.db.selectFrom('workspaces').select('slug').execute()).map((w) => w.slug)).toEqual(['halcyon']);
    const members = await m.db.selectFrom('workspace_members').select('role').execute();
    expect(members).toEqual([{ role: 'owner' }]);
    const brand = await m.db.selectFrom('workspace_brand').select(['primary_color', 'heading_font']).executeTakeFirstOrThrow();
    expect(brand).toEqual({ primary_color: '#0F5E5A', heading_font: 'Source Serif 4' });
    expect(await m.db.selectFrom('opportunities').select('id').execute()).toHaveLength(0);
    const factors = await sql<{ n: number }>`select count(*)::int as n from gms_private.test_auth_factors where status = 'verified'`.execute(m.db);
    expect(factors.rows[0]?.n).toBe(1);
  });
});
