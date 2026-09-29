// SPDX-License-Identifier: AGPL-3.0-or-later
// Custom deployment requests (hosted service): owners/admins file them under RLS, the event reaches the outbox, and
// only the system actor (operator console) changes their status. Also: operators.add bootstraps an operator.
import { randomUUID } from 'node:crypto';
import { createTestDatabase, createUser, type TestDatabase, type TestUser } from '@gms/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createExecutor, systemContext, type ActionContext, type ActionDeps } from '../src';

let t: TestDatabase;
let owner: TestUser;
let officer: TestUser;
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

function ctxFor(user: TestUser, role: 'owner' | 'program_officer'): ActionContext {
  return {
    workspace: ws,
    actor: { type: 'human', id: user.id, name: user.name },
    roles: [role],
    scopes: '*',
    claims: { role: 'authenticated', sub: user.id, email: user.email, aal: 'aal2' },
    aal: 'aal2',
    requestId: randomUUID(),
    channel: 'test',
  };
}

const REQUEST = { kind: 'custom_domain', desiredDomain: 'Grants.Example.org', details: 'We would like our own domain.', contactEmail: 'Owner@Example.org' };

beforeAll(async () => {
  t = await createTestDatabase('gms_deploy_requests');
  owner = await createUser(t.db, { name: 'Olga Owner' });
  officer = await createUser(t.db, { name: 'Pat Officer' });
  ws = await t.db.insertInto('workspaces').values({ slug: 'deployws', name: 'Deploy Foundation' }).returning(['id', 'slug', 'name', 'timezone']).executeTakeFirstOrThrow();
  await t.db
    .insertInto('workspace_members')
    .values([
      { workspace_id: ws.id, user_id: owner.id, role: 'owner' },
      { workspace_id: ws.id, user_id: officer.id, role: 'program_officer' },
    ])
    .execute();
});

afterAll(async () => {
  await t?.drop();
});

describe('deployments.request', () => {
  it('records the request for an owner, normalizes the domain and email, audits it and emits the event', async () => {
    const ex = createExecutor(stubDeps(), { db: t.db });
    const out = await ex.run<{ id: string }>('deployments.request', REQUEST, ctxFor(owner, 'owner'));
    const row = await t.db.selectFrom('deployment_requests').selectAll().where('id', '=', out.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ workspace_id: ws.id, requested_by: owner.id, kind: 'custom_domain', desired_domain: 'grants.example.org', contact_email: 'owner@example.org', status: 'new' });
    const events = await t.db.selectFrom('outbox').select(['event_type', 'entity_id']).where('entity_id', '=', out.id).execute();
    expect(events).toEqual([{ event_type: 'deployment.requested', entity_id: out.id }]);
    const audit = await t.db.selectFrom('audit_log').select('action').where('entity_id', '=', out.id).execute();
    expect(audit.map((a) => a.action)).toContain('deployments.request');
  });

  it('refuses people who are not owners or admins', async () => {
    const ex = createExecutor(stubDeps(), { db: t.db });
    await expect(ex.run('deployments.request', REQUEST, ctxFor(officer, 'program_officer'))).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('rejects a malformed domain with a field error', async () => {
    const ex = createExecutor(stubDeps(), { db: t.db });
    await expect(ex.run('deployments.request', { ...REQUEST, desiredDomain: 'not a domain' }, ctxFor(owner, 'owner'))).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('deployments.set_status', () => {
  it('is system-only and audited', async () => {
    const ex = createExecutor(stubDeps(), { db: t.db });
    const { id } = await ex.run<{ id: string }>('deployments.request', REQUEST, ctxFor(owner, 'owner'));
    await expect(ex.run('deployments.set_status', { requestId: id, status: 'closed', operatorEmail: 'ops@gms.example' }, ctxFor(owner, 'owner'))).rejects.toMatchObject({ code: 'forbidden' });
    await ex.run('deployments.set_status', { requestId: id, status: 'in_review', operatorEmail: 'ops@gms.example' }, systemContext(ws));
    const row = await t.db.selectFrom('deployment_requests').select('status').where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.status).toBe('in_review');
  });
});

describe('operators.add', () => {
  it('makes an existing person an operator, idempotently, and only for the system actor', async () => {
    const ex = createExecutor(stubDeps(), { db: t.db });
    await expect(ex.run('operators.add', { email: owner.email, fullName: owner.name }, ctxFor(owner, 'owner'))).rejects.toMatchObject({ code: 'forbidden' });
    const first = await ex.run<{ userId: string; created: boolean }>('operators.add', { email: owner.email.toUpperCase(), fullName: owner.name }, systemContext(null));
    const again = await ex.run<{ userId: string; created: boolean }>('operators.add', { email: owner.email, fullName: owner.name }, systemContext(null));
    expect(first).toEqual({ userId: owner.id, created: true });
    expect(again).toEqual({ userId: owner.id, created: false });
    const ops = await t.db.selectFrom('platform_operators').select(['user_id', 'role']).execute();
    expect(ops).toEqual([{ user_id: owner.id, role: 'operator' }]);
  });
});
