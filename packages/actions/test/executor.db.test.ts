// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { createTestDatabase, createUser, type TestDatabase, type TestUser } from '@gms/db/testing';
import { DomainError, type Actor } from '@gms/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createExecutor, decideApproval, defineAction, type ActionContext, type ActionDeps } from '../src';

let t: TestDatabase;
let owner: TestUser;
let applicant: TestUser;
let ws: { id: string; slug: string; name: string; timezone: string };

const stubDeps = (): ActionDeps =>
  ({
    mailer: { name: 'dev-outbox', send: async () => ({ provider: 'dev-outbox', messageId: 'x' }) },
    storage: {} as ActionDeps['storage'],
    scanner: { name: 'noop', scan: async () => ({ status: 'not_scanned' }) },
    secrets: {} as ActionDeps['secrets'],
    llm: null,
    diligence: {} as ActionDeps['diligence'],
    auth: null,
    paymentRail: async () => {
      throw new Error('no rail');
    },
    origin: (slug) => `http://${slug ?? 'root'}.localhost:3000`,
    clock: () => new Date(),
  }) as ActionDeps;

// Test actions ---------------------------------------------------------------
const renameProgram = defineAction({
  id: 'test.rename_program',
  title: 'Rename program',
  description: 'Renames a program.',
  input: z.object({ programId: z.string().uuid(), name: z.string().min(1) }),
  output: z.object({ id: z.string(), name: z.string() }),
  scopes: ['pipeline:read'],
  roles: ['owner', 'admin', 'program_officer'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const before = await ctx.db.selectFrom('programs').select(['id', 'name']).where('id', '=', input.programId).executeTakeFirstOrThrow();
    const row = await ctx.db
      .updateTable('programs')
      .set({ name: input.name })
      .where('id', '=', input.programId)
      .returning(['id', 'name'])
      .executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'program', entityId: row.id, before, after: row });
    ctx.emit('program.renamed', { type: 'program', id: row.id }, { name: row.name });
    return row;
  },
});

const consequential = defineAction({
  id: 'test.consequential',
  title: 'Do something consequential',
  description: 'An R2 action used in tests.',
  input: z.object({ note: z.string() }),
  output: z.object({ ok: z.boolean(), by: z.string() }),
  scopes: ['applications:submit'],
  roles: ['authenticated'],
  riskTier: 'R2',
  idempotent: true,
  async preview(input) {
    return { title: 'Consequential thing', summary: input.note, fields: [{ label: 'Note', value: input.note }] };
  },
  async run(_input, ctx) {
    ctx.audit({ entityType: 'test', entityId: null, after: { ran: true } });
    return { ok: true, by: ctx.actor.name };
  },
});

const humanOnly = defineAction({
  id: 'test.approve_money',
  title: 'Approve money',
  description: 'An R3 action.',
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  scopes: [],
  roles: ['owner', 'admin', 'finance'],
  riskTier: 'R3',
  idempotent: false,
  stepUp: true,
  async run() {
    return { ok: true };
  },
});

function ctxFor(user: TestUser, extra: Partial<ActionContext> = {}): ActionContext {
  return {
    workspace: ws,
    actor: { type: 'human', id: user.id, name: user.name },
    roles: extra.roles ?? [],
    scopes: '*',
    claims: { role: 'authenticated', sub: user.id, email: user.email, aal: 'aal1' },
    aal: 'aal1',
    requestId: randomUUID(),
    channel: 'test',
    ...extra,
  };
}

let programId: string;
let clientId: string;

beforeAll(async () => {
  t = await createTestDatabase('gms_exec');
  owner = await createUser(t.db, { name: 'Olive Owner' });
  applicant = await createUser(t.db, { name: 'Maya Chen' });
  const w = await t.db
    .insertInto('workspaces')
    .values({ slug: 'testws', name: 'Test Foundation' })
    .returning(['id', 'slug', 'name', 'timezone'])
    .executeTakeFirstOrThrow();
  ws = w;
  await t.db.insertInto('workspace_members').values({ workspace_id: ws.id, user_id: owner.id, role: 'owner' }).execute();
  programId = (
    await t.db.insertInto('programs').values({ workspace_id: ws.id, name: 'Arts', slug: 'arts' }).returning('id').executeTakeFirstOrThrow()
  ).id;
  clientId = (
    await t.db
      .insertInto('agent_clients')
      .values({ client_id: 'grant-writer', name: 'Grant Writer Assistant', kind: 'pat_client', owner_user_id: applicant.id, scopes: ['applications:submit'] })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
});

afterAll(async () => {
  await t?.drop();
});

describe('action executor', () => {
  it('runs under RLS, writes audit + outbox in the same transaction', async () => {
    const ex = createExecutor(stubDeps(), { db: t.db });
    const out = await ex.run<{ name: string }>('test.rename_program', { programId, name: 'Youth Arts' }, ctxFor(owner, { roles: ['owner'] }));
    expect(out.name).toBe('Youth Arts');
    const audit = await t.db.selectFrom('audit_log').selectAll().where('action', '=', 'test.rename_program').execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_type: 'human', actor_id: owner.id, entity_type: 'program', risk_tier: 'R1' });
    const events = await t.db.selectFrom('outbox').selectAll().where('event_type', '=', 'program.renamed').execute();
    expect(events).toHaveLength(1);
  });

  it('validates input with JSON Pointer issues', async () => {
    const ex = createExecutor(stubDeps(), { db: t.db });
    await expect(ex.run('test.rename_program', { programId: 'nope', name: '' }, ctxFor(owner, { roles: ['owner'] }))).rejects.toMatchObject({
      code: 'validation_failed',
      issues: expect.arrayContaining([expect.objectContaining({ pointer: '/programId' }), expect.objectContaining({ pointer: '/name' })]),
    });
  });

  it('checks roles, then RLS', async () => {
    const ex = createExecutor(stubDeps(), { db: t.db });
    await expect(ex.run('test.rename_program', { programId, name: 'X' }, ctxFor(applicant))).rejects.toMatchObject({ code: 'forbidden' });
    // A caller claiming a role it does not hold is still stopped by RLS (no rows updated -> not found).
    await expect(
      ex.run('test.rename_program', { programId, name: 'X' }, ctxFor(applicant, { roles: ['admin'] })),
    ).rejects.toBeTruthy();
    const p = await t.db.selectFrom('programs').select('name').where('id', '=', programId).executeTakeFirstOrThrow();
    expect(p.name).toBe('Youth Arts');
  });

  it('reports every missing scope for agents', async () => {
    const ex = createExecutor(stubDeps(), { db: t.db });
    const agent: Actor = { type: 'agent', id: clientId, name: 'Ops', agentClientId: clientId, onBehalfOf: owner.id };
    await expect(
      ex.run('test.rename_program', { programId, name: 'Z' }, ctxFor(owner, { roles: ['owner'], actor: agent, scopes: ['applications:read'] })),
    ).rejects.toMatchObject({ code: 'insufficient_scope', details: { requiredScopes: ['pipeline:read'] } });
  });

  it('honors idempotency keys and rejects reuse with different input', async () => {
    const ex = createExecutor(stubDeps(), { db: t.db });
    const c = ctxFor(owner, { roles: ['owner'], idempotencyKey: 'k-1' });
    const a = await ex.execute('test.rename_program', { programId, name: 'Once' }, c);
    const b = await ex.execute('test.rename_program', { programId, name: 'Once' }, c);
    expect(a.status).toBe('ok');
    expect(b).toMatchObject({ status: 'ok', replayed: true });
    const n = await t.db.selectFrom('audit_log').select((eb) => eb.fn.countAll().as('n')).where('action', '=', 'test.rename_program').executeTakeFirstOrThrow();
    expect(Number(n.n)).toBe(2); // the first test + one idempotent run
    await expect(ex.execute('test.rename_program', { programId, name: 'Different' }, c)).rejects.toMatchObject({ code: 'idempotency_mismatch' });
  });

  it('refuses R3 for agents and requires step-up for humans', async () => {
    const ex = createExecutor(stubDeps(), { db: t.db });
    const agent: Actor = { type: 'agent', id: clientId, name: 'Ops', agentClientId: clientId, onBehalfOf: owner.id };
    await expect(ex.run('test.approve_money', {}, ctxFor(owner, { roles: ['owner'], actor: agent, scopes: ['payments:propose'] }))).rejects.toMatchObject({
      code: 'human_only',
    });
    await expect(ex.run('test.approve_money', {}, ctxFor(owner, { roles: ['owner'] }))).rejects.toMatchObject({ code: 'step_up_required' });
    await expect(ex.run('test.approve_money', {}, ctxFor(owner, { roles: ['owner'], aal: 'aal2' }))).rejects.toMatchObject({ code: 'step_up_required' });
    await expect(
      ex.run('test.approve_money', {}, ctxFor(owner, { roles: ['owner'], aal: 'aal2', stepUpAt: new Date(Date.now() - 3600_000).toISOString() })),
    ).rejects.toMatchObject({ code: 'step_up_required' });
    await expect(ex.run('test.approve_money', {}, ctxFor(owner, { roles: ['owner'], aal: 'aal2', stepUpAt: new Date().toISOString() }))).resolves.toEqual({ ok: true });
  });

  it('turns agent R2 calls into approval requests, and runs them once a person confirms', async () => {
    const ex = createExecutor(stubDeps(), { db: t.db });
    const agent: Actor = {
      type: 'agent',
      id: clientId,
      name: 'Grant Writer Assistant',
      agentClientId: clientId,
      onBehalfOf: applicant.id,
      onBehalfOfName: applicant.name,
    };
    const r = await ex.execute('test.consequential', { note: 'submit it' }, ctxFor(applicant, { actor: agent, scopes: ['applications:submit'] }));
    expect(r.status).toBe('approval_required');
    if (r.status !== 'approval_required') return;
    expect(r.confirmUrl).toContain('/portal/confirm/');
    expect(r.preview.fields[0]).toEqual({ label: 'Note', value: 'submit it' });

    // Someone else cannot confirm.
    await expect(
      decideApproval(ex, t.db, { approvalRequestId: r.approvalRequestId, decision: 'confirm' }, ctxFor(owner, { roles: ['owner'] })),
    ).rejects.toBeInstanceOf(DomainError);

    const decided = await decideApproval(ex, t.db, { approvalRequestId: r.approvalRequestId, decision: 'confirm' }, ctxFor(applicant));
    expect(decided.status).toBe('confirmed');
    expect(decided.result).toMatchObject({ status: 'ok', output: { ok: true, by: 'Grant Writer Assistant' } });

    const audit = await t.db
      .selectFrom('audit_log')
      .selectAll()
      .where('approval_request_id', '=', r.approvalRequestId)
      .orderBy('occurred_at')
      .execute();
    const ran = audit.find((a) => a.action === 'test.consequential');
    expect(ran).toMatchObject({ actor_type: 'agent', agent_client_id: clientId, on_behalf_of: applicant.id, on_behalf_of_name: 'Maya Chen' });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['test.consequential.requested', 'approval.confirmed']));

    await expect(
      decideApproval(ex, t.db, { approvalRequestId: r.approvalRequestId, decision: 'confirm' }, ctxFor(applicant)),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('lets a workspace raise (never lower) a tier', async () => {
    const ex = createExecutor(stubDeps(), { db: t.db });
    await t.db
      .updateTable('workspace_settings')
      .set({ action_tier_overrides: JSON.stringify({ 'test.rename_program': 'R2', 'test.approve_money': 'R1' }) })
      .where('workspace_id', '=', ws.id)
      .execute();
    const ex2 = createExecutor(stubDeps(), { db: t.db });
    expect(await ex2.effectiveTier(renameProgram as never, { workspace: ws })).toBe('R2');
    expect(await ex2.effectiveTier(humanOnly as never, { workspace: ws })).toBe('R3');
    expect(await ex.effectiveTier(consequential as never, { workspace: null })).toBe('R2');
  });
});
