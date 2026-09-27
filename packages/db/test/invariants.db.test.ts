// SPDX-License-Identifier: AGPL-3.0-only
// SQL invariants (triggers, CHECK constraints, append-only tables) plus regression tests for the
// security fixes in supabase/migrations/20260927000700_rls_fixes.sql. Every scenario rolls back.
import type { RawBuilder } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Tx } from '../src/client';
import { createTestDatabase, type TestDatabase } from '../src/testing';
import { actAs, actAsService, attempt, scenario } from './rls-harness';
import { buildWorld, detId, put, type Principal, type World } from './world';

let t: TestDatabase;
let w: World;

beforeAll(async () => {
  t = await createTestDatabase('gms_invariants');
  w = await buildWorld(t.db);
});

afterAll(async () => {
  await t?.drop();
});

const as = (trx: Tx, p: Principal, extra: Record<string, unknown> = {}) => actAs(trx, { ...w.claims(p), ...extra });
const run = (trx: Tx, q: RawBuilder<unknown>) => attempt(trx, () => q.execute(trx));
const one = async <T>(trx: Tx, q: RawBuilder<T>): Promise<T> => (await q.execute(trx)).rows[0]!;

/** Inserts (service) an award tree root + amendments and returns their ids. */
async function awardTree(trx: Tx, tag: string) {
  const base = { workspace_id: w.wsA, applicant_org_id: w.ids.org1, program_id: w.ids.program1, status: 'active' };
  const root = detId(`${tag}:root`);
  await put(trx, 'awards', { ...base, id: root, reference: `${tag}-R`, title: 'Root', amount_cents: 10_000 });
  const child = async (name: string, amount: number, amendment_status: string) => {
    const id = detId(`${tag}:${name}`);
    await put(trx, 'awards', {
      ...base,
      id,
      parent_award_id: root,
      kind: 'amendment',
      amendment_status,
      reference: `${tag}-${name}`,
      title: name,
      amount_cents: amount,
    });
    return id;
  };
  return {
    root,
    approved: await child('approved', 5_000, 'approved'),
    draft: await child('draft', 3_000, 'draft'),
    rejected: await child('rejected', 2_000, 'rejected'),
  };
}

const pay = (trx: Tx, id: string, award: string | undefined, amount: number, extra: Record<string, unknown> = {}) =>
  attempt(trx, () => put(trx, 'payments', { id, workspace_id: w.wsA, award_id: award, amount_cents: amount, ...extra }));

describe('payment ceiling', () => {
  it('limits live payments on an award tree to the original plus approved amendments', async () => {
    await scenario(t.db, async (trx) => {
      const a = await awardTree(trx, 'ceil');
      expect(await pay(trx, detId('p1'), a.root, 10_000)).toBe('ok');
      expect(await pay(trx, detId('p2'), a.approved, 5_000)).toBe('ok'); // 15_000 = 10_000 + approved 5_000
      // Draft (3_000) and rejected (2_000) amendments do not add headroom.
      expect(await pay(trx, detId('p3'), a.root, 1)).toBe('payment_ceiling');
      expect(await pay(trx, detId('p3'), a.draft, 1)).toBe('payment_ceiling');
      // Raising an existing payment above the ceiling is refused too.
      expect(await run(trx, sql`update public.payments set amount_cents = 10_001 where id = ${detId('p1')}`)).toBe('payment_ceiling');
      // Failing (or cancelling) a payment frees its headroom.
      await sql`update public.payments set status = 'failed' where id = ${detId('p2')}`.execute(trx);
      expect(await pay(trx, detId('p3'), a.root, 4_000)).toBe('ok');
      await sql`update public.payments set status = 'cancelled' where id = ${detId('p3')}`.execute(trx);
      expect(await pay(trx, detId('p4'), a.root, 5_000)).toBe('ok');
      expect(await pay(trx, detId('p5'), a.root, 1)).toBe('payment_ceiling');
      // Approving the draft amendment raises the ceiling.
      await sql`update public.awards set amendment_status = 'approved' where id = ${a.draft}`.execute(trx);
      expect(await pay(trx, detId('p5'), a.root, 3_000)).toBe('ok');
      expect(await pay(trx, detId('p6'), a.root, 1)).toBe('payment_ceiling');
    });
  });

  it('is enforced under RLS for finance users too', async () => {
    await scenario(t.db, async (trx) => {
      const a = await awardTree(trx, 'ceilrls');
      await as(trx, 'financeA');
      expect(await pay(trx, detId('r1'), a.root, 15_000)).toBe('ok');
      expect(await pay(trx, detId('r2'), a.approved, 1)).toBe('payment_ceiling');
    });
  });
});

describe('payment gates', () => {
  it('a mercury payment cannot be batched unless the payee is ready', async () => {
    await scenario(t.db, async (trx) => {
      const payee = detId('payee:onboarding');
      await put(trx, 'payees', { id: payee, workspace_id: w.wsA, applicant_org_id: w.ids.org2, status: 'onboarding', contact_email: 'p@o2.rls.example' });
      await put(trx, 'payments', { id: detId('g1'), workspace_id: w.wsA, award_id: w.ids.award1, payee_id: payee, amount_cents: 100 });
      expect(await run(trx, sql`update public.payments set status = 'in_batch' where id = ${detId('g1')}`)).toBe('payee_not_ready');
      expect(await run(trx, sql`update public.payments set status = 'awaiting_approval' where id = ${detId('g1')}`)).toBe('payee_not_ready');
      expect(await pay(trx, detId('g2'), w.ids.award1, 100, { payee_id: payee, status: 'in_batch' })).toBe('payee_not_ready');
      // No payee at all is also not ready.
      expect(await pay(trx, detId('g3'), w.ids.award1, 100, { status: 'in_batch' })).toBe('payee_not_ready');
      // Manual rail is not gated on Mercury onboarding.
      expect(await run(trx, sql`update public.payments set rail = 'manual', status = 'in_batch' where id = ${detId('g1')}`)).toBe('ok');
      await sql`update public.payees set status = 'ready' where id = ${payee}`.execute(trx);
      await put(trx, 'payments', { id: detId('g4'), workspace_id: w.wsA, award_id: w.ids.award1, payee_id: payee, amount_cents: 100 });
      expect(await run(trx, sql`update public.payments set status = 'in_batch' where id = ${detId('g4')}`)).toBe('ok');
    });
  });

  it('an active hold on the award tree blocks batching', async () => {
    await scenario(t.db, async (trx) => {
      const a = await awardTree(trx, 'hold');
      await put(trx, 'payments', { id: detId('h1'), workspace_id: w.wsA, award_id: a.root, payee_id: w.ids.payee1, amount_cents: 100 });
      await put(trx, 'payments', { id: detId('h2'), workspace_id: w.wsA, award_id: a.approved, payee_id: w.ids.payee1, amount_cents: 100 });
      await sql`update public.awards set on_hold = true, hold_reason = 'Overdue report' where id = ${a.root}`.execute(trx);
      expect(await run(trx, sql`update public.payments set status = 'in_batch' where id = ${detId('h1')}`)).toBe('award_on_hold');
      expect(await run(trx, sql`update public.payments set status = 'in_batch' where id = ${detId('h2')}`)).toBe('award_on_hold');
      await sql`update public.awards set on_hold = false where id = ${a.root}`.execute(trx);
      expect(await run(trx, sql`update public.payments set status = 'in_batch' where id = ${detId('h1')}`)).toBe('ok');
    });
  });
});

describe('batch maker-checker', () => {
  it('CHECK constraints: the creator cannot approve and the second approver is distinct', async () => {
    await scenario(t.db, async (trx) => {
      const b = w.ids.batch1;
      expect(await run(trx, sql`update public.payment_batches set approved_by = created_by where id = ${b}`)).toBe('23514');
      expect(
        await run(trx, sql`update public.payment_batches set approved_by = ${w.users.adminA.id}, second_approved_by = ${w.users.adminA.id} where id = ${b}`),
      ).toBe('23514');
      expect(
        await run(trx, sql`update public.payment_batches set approved_by = ${w.users.adminA.id}, second_approved_by = created_by where id = ${b}`),
      ).toBe('23514');
      expect(
        await run(trx, sql`update public.payment_batches set approved_by = ${w.users.adminA.id}, second_approved_by = ${w.users.ownerA.id} where id = ${b}`),
      ).toBe('ok');
    });
  });

  it('payment_approvals trigger: the batch creator cannot approve; each approver approves once', async () => {
    await scenario(t.db, async (trx) => {
      const approval = (approver: string, batch = w.ids.batch1) =>
        attempt(trx, () => put(trx, 'payment_approvals', { workspace_id: w.wsA, batch_id: batch, approver_id: approver, decision: 'approve', aal: 'aal2' }));
      expect(await approval(w.users.financeA.id)).toBe('maker_checker');
      expect(await approval(w.users.adminA.id)).toBe('ok');
      expect(await approval(w.users.adminA.id)).toBe('23505');
      expect(await approval(w.users.ownerA.id)).toBe('ok');
    });
  });

  it('payment_approvals insert requires an aal2 session matching the recorded aal', async () => {
    await scenario(t.db, async (trx) => {
      const approve = (aal: string) =>
        attempt(trx, () => put(trx, 'payment_approvals', { workspace_id: w.wsA, batch_id: w.ids.batch1, approver_id: w.users.adminA.id, decision: 'approve', aal }));
      await as(trx, 'adminA', { aal: 'aal1' });
      expect(await approve('aal1')).toBe('42501');
      expect(await approve('aal2')).toBe('42501');
      await as(trx, 'adminA', { aal: 'aal2' });
      expect(await approve('aal1')).toBe('42501');
      expect(await approve('aal2')).toBe('ok');
      // Someone else's approval cannot be recorded.
      expect(
        await attempt(trx, () =>
          put(trx, 'payment_approvals', { workspace_id: w.wsA, batch_id: w.ids.batch1, approver_id: w.users.ownerA.id, decision: 'approve', aal: 'aal2' }),
        ),
      ).toBe('42501');
      // Auditors read but never approve.
      await as(trx, 'auditorA');
      expect(
        await attempt(trx, () =>
          put(trx, 'payment_approvals', { workspace_id: w.wsA, batch_id: w.ids.batch3, approver_id: w.users.auditorA.id, decision: 'approve', aal: 'aal2' }),
        ),
      ).toBe('42501');
    });
  });

  it('[fix 0700] batch approval columns can only follow recorded approvals', async () => {
    await scenario(t.db, async (trx) => {
      await as(trx, 'financeA');
      // batch3 has no approvals: approved_by cannot be written directly.
      expect(await run(trx, sql`update public.payment_batches set approved_by = ${w.users.adminA.id} where id = ${w.ids.batch3}`)).toBe('maker_checker');
      expect(await run(trx, sql`update public.payment_batches set status = 'approved' where id = ${w.ids.batch3}`)).toBe('maker_checker');
      // batch2 has adminA's aal2 approval: recording it is fine.
      expect(
        await run(trx, sql`update public.payment_batches set approved_by = ${w.users.adminA.id}, approved_at = now(), status = 'approved' where id = ${w.ids.batch2}`),
      ).toBe('ok');
      // created_by is fixed; a required second approval cannot be dropped.
      expect(await run(trx, sql`update public.payment_batches set created_by = ${w.users.ownerA.id} where id = ${w.ids.batch1}`)).toBe('maker_checker');
      await actAsService(trx);
      await sql`update public.payment_batches set requires_second_approval = true where id = ${w.ids.batch1}`.execute(trx);
      await as(trx, 'financeA');
      expect(await run(trx, sql`update public.payment_batches set requires_second_approval = false where id = ${w.ids.batch1}`)).toBe('maker_checker');
      // New batches are created by the caller and start unapproved.
      const batch = (created_by: string, extra: Record<string, unknown> = {}) =>
        attempt(trx, () => put(trx, 'payment_batches', { workspace_id: w.wsA, name: 'x', created_by, ...extra }));
      expect(await batch(w.users.ownerA.id)).toBe('maker_checker');
      expect(await batch(w.users.financeA.id, { approved_by: w.users.adminA.id })).toBe('maker_checker');
      expect(await batch(w.users.financeA.id, { status: 'approved' })).toBe('maker_checker');
      expect(await batch(w.users.financeA.id)).toBe('ok');
    });
  });
});

describe('form versions', () => {
  it('published versions are immutable; only published -> retired with identical content', async () => {
    await scenario(t.db, async (trx) => {
      const fv = w.ids.fv1;
      expect(await run(trx, sql`update public.form_versions set json_schema = '{"type":"string"}' where id = ${fv}`)).toBe('immutable_form_version');
      expect(await run(trx, sql`update public.form_versions set field_meta = '{}' where id = ${fv}`)).toBe('immutable_form_version');
      expect(await run(trx, sql`update public.form_versions set status = 'draft' where id = ${fv}`)).toBe('immutable_form_version');
      expect(await run(trx, sql`update public.form_versions set status = 'retired', json_schema = '{}' where id = ${fv}`)).toBe('immutable_form_version');
      expect(await run(trx, sql`delete from public.form_versions where id = ${fv}`)).toBe('immutable_form_version');
      expect(await run(trx, sql`update public.form_versions set status = 'retired' where id = ${fv}`)).toBe('ok');
      // Retired is final too.
      expect(await run(trx, sql`update public.form_versions set status = 'published' where id = ${fv}`)).toBe('immutable_form_version');
      expect(await run(trx, sql`delete from public.form_versions where id = ${fv}`)).toBe('immutable_form_version');
    });
  });

  it('drafts are editable and deletable (by form writers under RLS)', async () => {
    await scenario(t.db, async (trx) => {
      const draft = detId('fv:draft');
      await put(trx, 'form_versions', { id: draft, workspace_id: w.wsA, form_id: w.ids.form1, version: 7, status: 'draft' });
      await as(trx, 'programOfficerA');
      expect(await run(trx, sql`update public.form_versions set json_schema = '{"type":"object","title":"v7"}' where id = ${draft}`)).toBe('ok');
      expect(await run(trx, sql`update public.form_versions set status = 'published', published_at = now() where id = ${draft}`)).toBe('ok');
      expect(await run(trx, sql`update public.form_versions set json_schema = '{}' where id = ${draft}`)).toBe('immutable_form_version');
      const draft2 = detId('fv:draft2');
      await actAsService(trx);
      await put(trx, 'form_versions', { id: draft2, workspace_id: w.wsA, form_id: w.ids.form1, version: 8, status: 'draft' });
      await as(trx, 'programOfficerA');
      expect(await run(trx, sql`delete from public.form_versions where id = ${draft2}`)).toBe('ok');
    });
  });
});

describe('append-only tables', () => {
  const tables: [string, string][] = [
    ['audit_log', 'audit:A'],
    ['application_submissions', 'submission1'],
    ['status_history', 'history1'],
    ['signatures', 'signature1'],
    ['payment_approvals', 'approval:batch2'],
  ];
  for (const [table, name] of tables) {
    it(`${table} rejects update and delete, even for the service role`, async () => {
      await scenario(t.db, async (trx) => {
        const id = w.ids[name]!;
        expect(await run(trx, sql`update ${sql.table(`public.${table}`)} set id = id where id = ${id}`)).toBe('append_only');
        expect(await run(trx, sql`delete from ${sql.table(`public.${table}`)} where id = ${id}`)).toBe('append_only');
      });
    });
  }
});

describe('awards.disbursed_cents', () => {
  it('sums sent and reconciled payments across the award tree', async () => {
    await scenario(t.db, async (trx) => {
      const a = await awardTree(trx, 'disb');
      const disbursed = async () =>
        (await one(trx, sql<{ d: number }>`select disbursed_cents as d from public.awards where id = ${a.root}`)).d;
      await put(trx, 'payments', { id: detId('d1'), workspace_id: w.wsA, award_id: a.root, amount_cents: 4_000 });
      await put(trx, 'payments', { id: detId('d2'), workspace_id: w.wsA, award_id: a.approved, amount_cents: 3_000 });
      await put(trx, 'payments', { id: detId('d3'), workspace_id: w.wsA, award_id: a.root, amount_cents: 1_000, rail: 'manual', status: 'sent' });
      expect(await disbursed()).toBe(1_000);
      await sql`update public.payments set status = 'sent' where id = ${detId('d1')}`.execute(trx);
      expect(await disbursed()).toBe(5_000);
      await sql`update public.payments set status = 'reconciled' where id = ${detId('d2')}`.execute(trx);
      expect(await disbursed()).toBe(8_000);
      await sql`update public.payments set status = 'failed' where id = ${detId('d1')}`.execute(trx);
      expect(await disbursed()).toBe(4_000);
      await sql`update public.payments set amount_cents = 500 where id = ${detId('d3')}`.execute(trx);
      expect(await disbursed()).toBe(3_500);
      // Amendments keep their own disbursed_cents at zero; the tree total lives on the root.
      expect((await one(trx, sql<{ d: number }>`select disbursed_cents as d from public.awards where id = ${a.approved}`)).d).toBe(0);
    });
  });
});

describe('applications guard', () => {
  it('applicants cannot award, review or re-own their application; staff can move it', async () => {
    await scenario(t.db, async (trx) => {
      const app = w.ids.app1;
      await sql`update public.applications set status = 'in_progress', submitted_at = null where id = ${app}`.execute(trx);
      await as(trx, 'applicant');
      const upd = (set: string) => run(trx, sql`update public.applications set ${sql.raw(set)} where id = ${app}`);
      expect(await upd(`status = 'under_review'`)).toBe('42501');
      expect(await upd(`status = 'awarded'`)).toBe('42501');
      expect(await upd(`applicant_user_id = '${w.users.otherApplicant.id}'`)).toBe('42501');
      expect(await upd(`applicant_org_id = '${w.ids.org2}'`)).toBe('42501');
      expect(await upd(`reference_number = 'X-1'`)).toBe('42501');
      expect(await upd(`competition_id = '${w.ids.compLeaf}'`)).toBe('42501');
      expect(await upd(`tags = '{vip}'`)).toBe('42501');
      expect(await upd(`opportunity_id = '${w.ids.oppLeaf}'`)).toBe('42501'); // fix 0700
      expect(await upd(`title = 'Better title'`)).toBe('ok');
      expect(await upd(`status = 'submitted', submitted_at = now()`)).toBe('ok');
      expect(await upd(`status = 'awarded'`)).toBe('42501');
      expect(await upd(`status = 'withdrawn'`)).toBe('ok');
      await as(trx, 'programOfficerA');
      expect(await upd(`status = 'under_review'`)).toBe('ok');
      expect(await upd(`status = 'awarded'`)).toBe('ok');
    });
  });

  it('[fix 0700] viewer collaborators cannot update or withdraw', async () => {
    await scenario(t.db, async (trx) => {
      await sql`update public.application_collaborators set role = 'viewer' where id = ${w.ids.collab1}`.execute(trx);
      await as(trx, 'collaborator');
      expect(await run(trx, sql`update public.applications set status = 'withdrawn' where id = ${w.ids.app1}`)).toBe('rows:0');
      expect((await sql`select 1 from public.applications where id = ${w.ids.app1}`.execute(trx)).rows).toHaveLength(1);
    });
  });

  it('[fix 0700] applicants can only apply to published opportunities', async () => {
    await scenario(t.db, async (trx) => {
      await as(trx, 'applicant');
      const apply = (opp: string | undefined, comp: string | undefined, ref: string) =>
        attempt(trx, () =>
          put(trx, 'applications', {
            workspace_id: w.wsA,
            opportunity_id: opp,
            competition_id: comp,
            applicant_org_id: w.ids.org1,
            applicant_user_id: w.users.applicant.id,
            reference_number: ref,
          }),
        );
      expect(await apply(w.ids.oppDraft, w.ids.compDraft, 'D-1')).toBe('42501');
      expect(await apply(w.ids.opp1, w.ids.compLeaf, 'D-2')).toBe('42501'); // competition of another opportunity
      expect(await apply(w.ids.oppLeaf, w.ids.compLeaf, 'D-3')).toBe('ok');
    });
  });
});

describe('status CHECK constraints', () => {
  const cases: [string, string][] = [
    ['workspaces', 'ws:A'],
    ['opportunities', 'opp1'],
    ['competitions', 'comp1'],
    ['applications', 'app1'],
    ['review_assignments', 'assignment1'],
    ['awards', 'award1'],
    ['agreements', 'agreement1'],
    ['payees', 'payee1'],
    ['payment_batches', 'batch1'],
    ['payments', 'payment1'],
    ['report_submissions', 'report1'],
  ];
  for (const [table, name] of cases) {
    it(`${table}.status rejects unknown values`, async () => {
      await scenario(t.db, async (trx) => {
        expect(await run(trx, sql`update ${sql.table(`public.${table}`)} set status = 'bogus' where id = ${w.ids[name]!}`)).toBe('23514');
      });
    });
  }
  it('inserts with an unknown status are rejected', async () => {
    await scenario(t.db, async (trx) => {
      expect(await pay(trx, detId('bogus'), w.ids.award1, 1, { status: 'paid' })).toBe('23514');
      expect(await attempt(trx, () => put(trx, 'workspaces', { slug: 'bogus-ws', name: 'x', status: 'deleted' }))).toBe('23514');
      expect(
        await attempt(trx, () => put(trx, 'form_versions', { workspace_id: w.wsA, form_id: w.ids.form2, version: 1, status: 'archived' })),
      ).toBe('23514');
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Regression tests for supabase/migrations/20260927000700_rls_fixes.sql
// ---------------------------------------------------------------------------------------------
describe('[fix 0700] security regressions', () => {
  it('collaborators cannot move their row to another application or promote themselves', async () => {
    await scenario(t.db, async (trx) => {
      // A second application (another applicant's) in workspace A.
      const victim = detId('app:victim');
      await put(trx, 'applications', {
        id: victim,
        workspace_id: w.wsA,
        opportunity_id: w.ids.opp1,
        competition_id: w.ids.comp1,
        applicant_user_id: w.users.otherApplicant.id,
        reference_number: 'VICTIM-1',
      });
      const viewerRow = detId('collab:viewer');
      await put(trx, 'application_collaborators', {
        id: viewerRow,
        workspace_id: w.wsA,
        application_id: w.ids.app1,
        user_id: w.users.outsider.id,
        email: w.users.outsider.email,
        role: 'viewer',
        status: 'invited',
      });
      await as(trx, 'collaborator');
      expect(await run(trx, sql`update public.application_collaborators set application_id = ${victim} where id = ${w.ids.collab1}`)).toBe('42501');
      await as(trx, 'outsider');
      expect(await run(trx, sql`update public.application_collaborators set application_id = ${victim}, status = 'active' where id = ${viewerRow}`)).toBe(
        '42501',
      );
      expect(await run(trx, sql`update public.application_collaborators set role = 'editor' where id = ${viewerRow}`)).toBe('42501');
      expect(await run(trx, sql`update public.application_collaborators set status = 'active' where id = ${viewerRow}`)).toBe('ok');
      // An (active) viewer cannot invite editors either.
      expect(
        await attempt(trx, () =>
          put(trx, 'application_collaborators', {
            workspace_id: w.wsA,
            application_id: w.ids.app1,
            user_id: w.users.outsider.id,
            email: 'alt@rls.example',
            role: 'editor',
            status: 'active',
          }),
        ),
      ).toBe('42501');
      // ...and still cannot read the victim application.
      expect((await sql`select 1 from public.applications where id = ${victim}`.execute(trx)).rows).toHaveLength(0);
    });
  });

  it('reviewers cannot re-point assignments or reverse a recusal', async () => {
    await scenario(t.db, async (trx) => {
      const victim = detId('app:victim2');
      await put(trx, 'applications', {
        id: victim,
        workspace_id: w.wsA,
        opportunity_id: w.ids.opp1,
        competition_id: w.ids.comp1,
        applicant_user_id: w.users.otherApplicant.id,
        reference_number: 'VICTIM-2',
        status: 'submitted',
      });
      await as(trx, 'reviewerA');
      expect(await run(trx, sql`update public.review_assignments set application_id = ${victim} where id = ${w.ids.assignment2}`)).toBe('42501');
      expect(await run(trx, sql`update public.review_assignments set reviewer_id = ${w.users.reviewerA2.id} where id = ${w.ids.assignment2}`)).toBe(
        '42501',
      );
      expect(await run(trx, sql`update public.review_assignments set status = 'submitted' where id = ${w.ids.assignment1}`)).toBe('ok');
      expect(await run(trx, sql`update public.review_assignments set status = 'recused' where id = ${w.ids.assignment2}`)).toBe('ok');
      expect(await run(trx, sql`update public.review_assignments set status = 'in_progress' where id = ${w.ids.assignment2}`)).toBe('42501');
      expect((await sql`select 1 from public.applications where id = ${victim}`.execute(trx)).rows).toHaveLength(0);
      await as(trx, 'programOfficerA');
      expect(await run(trx, sql`update public.review_assignments set status = 'not_started' where id = ${w.ids.assignment2}`)).toBe('ok');
    });
  });

  it('rows cannot reference parents in another workspace', async () => {
    await scenario(t.db, async (trx) => {
      await put(trx, 'workspace_members', { workspace_id: w.wsB, user_id: w.users.financeA.id, role: 'finance' });
      // adminB countersigning workspace A's agreement under workspace B.
      await as(trx, 'adminB', { aal: 'aal2' });
      expect(
        await attempt(trx, () =>
          put(trx, 'signatures', {
            workspace_id: w.wsB,
            agreement_id: w.ids.agreement3,
            signer_id: w.users.adminB.id,
            signer_role: 'foundation',
            typed_name: 'Bob',
            attestation: 'x',
            document_hash: 'sha256:agreement',
          }),
        ),
      ).toBe('cross_workspace_reference');
      // Finance in B paying against A's award (would consume its ceiling / disbursed_cents).
      await as(trx, 'financeA');
      expect(await pay(trx, detId('xws'), w.ids.award1, 1, { workspace_id: w.wsB })).toBe('cross_workspace_reference');
      expect(await pay(trx, detId('xws2'), w.ids.award1, 1)).toBe('ok');
    });
  });

  it('application snapshots can only be added while the application is editable', async () => {
    await scenario(t.db, async (trx) => {
      const snapshot = (receipt: string) =>
        attempt(trx, () =>
          put(trx, 'application_submissions', {
            workspace_id: w.wsA,
            application_id: w.ids.app1,
            competition_id: w.ids.comp1,
            submitted_by: w.users.applicant.id,
            responses: '{}',
            receipt_number: receipt,
            content_hash: 'h',
          }),
        );
      await as(trx, 'applicant');
      expect(await snapshot('LATE-1')).toBe('42501'); // under_review
      await actAsService(trx);
      await sql`update public.applications set status = 'in_progress' where id = ${w.ids.app1}`.execute(trx);
      await as(trx, 'applicant');
      expect(await snapshot('ON-TIME-1')).toBe('ok');
    });
  });

  it('grantees can sign an agreement but not rewrite it; signatures bind to its hash', async () => {
    await scenario(t.db, async (trx) => {
      await as(trx, 'applicant');
      const ag = w.ids.agreement3;
      expect(await run(trx, sql`update public.agreements set body_md = 'Terms (edited)' where id = ${ag}`)).toBe('42501');
      expect(await run(trx, sql`update public.agreements set document_hash = 'sha256:other' where id = ${ag}`)).toBe('42501');
      expect(await run(trx, sql`update public.agreements set award_id = ${w.ids.award2} where id = ${ag}`)).toBe('42501');
      const sign = (hash: string) =>
        attempt(trx, () =>
          put(trx, 'signatures', {
            workspace_id: w.wsA,
            agreement_id: ag,
            signer_id: w.users.applicant.id,
            signer_role: 'grantee',
            typed_name: 'Maya Applicant',
            attestation: 'I agree',
            document_hash: hash,
          }),
        );
      expect(await sign('sha256:something-else')).toBe('42501');
      expect(await sign('sha256:agreement')).toBe('ok');
      expect(await run(trx, sql`update public.agreements set status = 'signed' where id = ${ag}`)).toBe('ok');
    });
  });

  it('uploads cannot mark themselves clean or attach to other orgs’ reports', async () => {
    await scenario(t.db, async (trx) => {
      await sql`update public.applications set status = 'in_progress' where id = ${w.ids.app1}`.execute(trx);
      await as(trx, 'applicant');
      const upload = (path: string, extra: Record<string, unknown>) =>
        attempt(trx, () =>
          put(trx, 'attachments', {
            workspace_id: w.wsA,
            file_name: 'f.pdf',
            content_type: 'application/pdf',
            size_bytes: 10,
            storage_path: path,
            uploaded_by: w.users.applicant.id,
            ...extra,
          }),
        );
      expect(await upload('a/clean.pdf', { application_id: w.ids.app1, scan_status: 'clean' })).toBe('scan_status');
      expect(await upload('a/ok.pdf', { application_id: w.ids.app1 })).toBe('ok');
      expect(await run(trx, sql`update public.attachments set scan_status = 'clean' where storage_path = 'a/ok.pdf'`)).toBe('scan_status');
      expect(await run(trx, sql`update public.org_documents set scan_status = 'clean' where id = ${w.ids['orgdoc:org1']!}`)).toBe('scan_status');
      await as(trx, 'otherApplicant');
      expect(await upload('b/report.pdf', { report_submission_id: w.ids.report1 })).toBe('42501');
    });
  });

  it('reviewers, finance and auditors cannot forge status history', async () => {
    await scenario(t.db, async (trx) => {
      for (const p of ['reviewerA', 'financeA', 'auditorA', 'applicant'] as const) {
        await as(trx, p);
        expect(
          await attempt(trx, () =>
            put(trx, 'status_history', {
              workspace_id: w.wsA,
              application_id: w.ids.app1,
              from_status: 'under_review',
              to_status: 'awarded',
              actor_id: w.userId(p),
            }),
          ),
        ).toBe('42501');
      }
      await as(trx, 'programOfficerA');
      expect(
        await attempt(trx, () =>
          put(trx, 'status_history', { workspace_id: w.wsA, application_id: w.ids.app1, to_status: 'awarded', actor_id: w.users.programOfficerA.id }),
        ),
      ).toBe('ok');
    });
  });

  it('applicants can mark staff messages read but not rewrite them', async () => {
    await scenario(t.db, async (trx) => {
      await as(trx, 'applicant');
      expect(await run(trx, sql`update public.messages set body = 'We will fund you in full' where id = ${w.ids.message1}`)).toBe('42501');
      expect(await run(trx, sql`update public.messages set read_by_applicant_at = now() where id = ${w.ids.message1}`)).toBe('ok');
      expect(await run(trx, sql`update public.threads set subject = 'Edited' where id = ${w.ids.thread1}`)).toBe('42501');
    });
  });

  it('org admins cannot forge EIN verification', async () => {
    await scenario(t.db, async (trx) => {
      await as(trx, 'applicant');
      expect(await run(trx, sql`update public.applicant_orgs set ein_verified_at = now() where id = ${w.ids.org1}`)).toBe('42501');
      expect(await run(trx, sql`update public.applicant_orgs set mission = 'Art' where id = ${w.ids.org1}`)).toBe('ok');
    });
  });

  it('an org creator can bootstrap membership once (no infinite policy recursion)', async () => {
    await scenario(t.db, async (trx) => {
      const org = detId('org:new');
      await as(trx, 'outsider');
      expect(await attempt(trx, () => put(trx, 'applicant_orgs', { id: org, legal_name: 'New Org', created_by: w.users.outsider.id }))).toBe('ok');
      const join = () => attempt(trx, () => put(trx, 'applicant_org_members', { org_id: org, user_id: w.users.outsider.id, role: 'org_admin' }));
      expect(await join()).toBe('ok');
      // Add a second admin, then leave: the creator cannot re-add themselves.
      expect(await attempt(trx, () => put(trx, 'applicant_org_members', { org_id: org, user_id: w.users.spare.id, role: 'org_admin' }))).toBe('ok');
      expect(await run(trx, sql`delete from public.applicant_org_members where org_id = ${org} and user_id = ${w.users.outsider.id}`)).toBe('ok');
      expect(await join()).toBe('42501');
    });
  });

  it('owners of personal agent clients cannot move them into a workspace', async () => {
    await scenario(t.db, async (trx) => {
      const client = detId('client:pat');
      await as(trx, 'outsider');
      expect(
        await attempt(trx, () => put(trx, 'agent_clients', { id: client, client_id: 'pat-outsider', name: 'Mine', owner_user_id: w.users.outsider.id, kind: 'pat_client' })),
      ).toBe('ok');
      expect(await run(trx, sql`update public.agent_clients set workspace_id = ${w.wsA} where id = ${client}`)).toBe('42501');
      expect(await run(trx, sql`update public.agent_clients set kind = 'agent_account' where id = ${client}`)).toBe('42501');
      expect(await run(trx, sql`update public.agent_clients set name = 'Renamed' where id = ${client}`)).toBe('ok');
    });
  });

  it('request roles can only write audit entries about themselves', async () => {
    await scenario(t.db, async (trx) => {
      const audit = (entry: Record<string, unknown>) =>
        run(trx, sql`select gms_private.append_audit(${JSON.stringify({ workspace_id: w.wsA, action: 'test', ...entry })}::jsonb)`);
      await as(trx, 'applicant');
      expect(await audit({ actor_type: 'human', actor_id: w.users.ownerA.id })).toBe('42501');
      expect(await audit({ actor_type: 'system' })).toBe('42501');
      expect(await audit({ actor_type: 'agent', actor_id: w.ids['client:A'], on_behalf_of: w.users.ownerA.id })).toBe('42501');
      expect(await audit({ actor_type: 'human', actor_id: w.users.applicant.id })).toBe('ok');
      expect(await audit({ actor_type: 'agent', actor_id: w.ids['client:A'], on_behalf_of: w.users.applicant.id })).toBe('ok');
      await actAsService(trx);
      expect(await audit({ actor_type: 'system' })).toBe('ok');
    });
  });

  it('public_awards shows the full awarded amount to anonymous visitors, for active workspaces only', async () => {
    await scenario(t.db, async (trx) => {
      await put(trx, 'awards', {
        workspace_id: w.wsA,
        parent_award_id: w.ids.award1,
        kind: 'amendment',
        amendment_status: 'approved',
        reference: 'AWD-0001-A1',
        title: 'Supplement',
        amount_cents: 250_000,
      });
      await as(trx, 'anon');
      const amount = async () => (await sql<{ a: number }>`select amount_cents as a from public.public_awards where id = ${w.ids.award1}`.execute(trx)).rows;
      expect(await amount()).toEqual([{ a: 2_250_000 }]);
      // Holds and notes never leave the database.
      const cols = await sql<{ c: string }>`select column_name as c from information_schema.columns where table_schema = 'public' and table_name = 'public_awards'`.execute(trx);
      expect(cols.rows.map((r) => r.c)).not.toEqual(expect.arrayContaining(['hold_reason']));
      expect(cols.rows.map((r) => r.c)).not.toEqual(expect.arrayContaining(['relationship_note']));
      const writes = await one(
        trx,
        sql<{ n: number }>`select count(*)::int as n from unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
          where has_table_privilege('gms_anon', 'public.public_awards', p) or has_table_privilege('gms_authenticated', 'public.public_awards', p)`,
      );
      expect(writes.n).toBe(0);
      await actAsService(trx);
      await sql`update public.workspaces set status = 'suspended' where id = ${w.wsA}`.execute(trx);
      await as(trx, 'anon');
      expect(await amount()).toEqual([]);
    });
  });

  it('demographics are never readable row-by-row by staff', async () => {
    await scenario(t.db, async (trx) => {
      for (const p of ['ownerA', 'adminA', 'programOfficerA', 'financeA', 'auditorA', 'reviewerA', 'boardA'] as const) {
        await as(trx, p);
        expect((await sql`select 1 from public.demographic_responses`.execute(trx)).rows).toHaveLength(0);
      }
    });
  });

  it('reviewers read content only through gms.reviewer_submission (blind fields masked)', async () => {
    await scenario(t.db, async (trx) => {
      await as(trx, 'reviewerA');
      expect((await sql`select 1 from public.form_responses`.execute(trx)).rows).toHaveLength(0);
      expect((await sql`select 1 from public.application_submissions`.execute(trx)).rows).toHaveLength(0);
      const r = await one(trx, sql<{ responses: Record<string, Record<string, unknown>>; org_profile: unknown; blind: boolean }>`
        select responses, org_profile, blind from gms.reviewer_submission(${w.ids.app1})`);
      expect(r.blind).toBe(true);
      expect(r.org_profile).toEqual({});
      expect(r.responses[w.ids.form1!]).toEqual({ mission: 'Murals' });
      await as(trx, 'reviewerA2');
      expect((await sql`select * from gms.reviewer_submission(${w.ids.app1})`.execute(trx)).rows).toHaveLength(0);
    });
  });

  it('blind review also hides identifying answers the form author did not flag, and attachment names', async () => {
    await scenario(t.db, async (trx) => {
      // Unflagged identifying fields: an EIN, a contact email mapped to CommonGrants, an attestation, and a file.
      // Published versions are immutable, so the submission points at a new version with this field metadata.
      const meta = JSON.stringify({
        name: { blind: true },
        mission: { type: 'long_text' },
        ein: { type: 'ein', blind: false },
        contact: { type: 'text', cgMapping: 'contact.email' },
        attest: { type: 'attestation' },
        budget: { type: 'file_upload' },
      });
      const fv = await one(trx, sql<{ id: string }>`
        insert into public.form_versions
        select (jsonb_populate_record(null::public.form_versions,
          to_jsonb(v) || jsonb_build_object('id', gen_random_uuid(), 'version', v.version + 100, 'field_meta', ${meta}::jsonb))).*
        from public.form_versions v where v.id = ${w.ids.fv1}
        returning id`);
      // Submissions are append-only; a newer snapshot is what reviewers see.
      const responses = JSON.stringify({
        [w.ids.form1!]: {
          name: 'Maya',
          mission: 'Murals',
          ein: '84-1234567',
          contact: 'maya@riverbend.example',
          attest: { agreed: true, name: 'Maya Chen' },
          budget: [{ fileId: 'f1', name: 'riverbend-budget.xlsx', size: 10 }],
        },
      });
      await sql`
        insert into public.application_submissions
        select (jsonb_populate_record(null::public.application_submissions,
          to_jsonb(s) || jsonb_build_object(
            'id', gen_random_uuid(), 'submitted_at', s.submitted_at + interval '1 minute',
            'receipt_number', s.receipt_number || '-blind', 'responses', ${responses}::jsonb,
            'form_versions', jsonb_build_array(jsonb_build_object('formVersionId', ${fv.id}::text))))).*
        from public.application_submissions s where s.application_id = ${w.ids.app1}
        order by s.submitted_at desc limit 1`.execute(trx);
      await as(trx, 'reviewerA');
      const r = await one(trx, sql<{ responses: Record<string, Record<string, unknown>> }>`
        select responses from gms.reviewer_submission(${w.ids.app1})`);
      expect(r.responses[w.ids.form1!]).toEqual({ mission: 'Murals', budget: [{ fileId: 'f1', name: 'Attachment 1.xlsx', size: 10 }] });
    });
  });
});
