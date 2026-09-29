// SPDX-License-Identifier: AGPL-3.0-or-later
// oauth.grant_consent: an applicant can consent to a DCR or CIMD client they cannot see under agent_clients_select,
// through gms.oauth_client_public (non-secret columns only, OAuth clients of this tenant or workspace-less ones).
import { randomUUID } from 'node:crypto';
import { sql } from '@gms/db';
import { createTestDatabase, createUser, type TestDatabase, type TestUser } from '@gms/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createExecutor, type ActionContext, type ActionDeps } from '../src';

let t: TestDatabase;
let applicant: TestUser;
let ws: { id: string; slug: string; name: string; timezone: string };
let other: { id: string; slug: string; name: string; timezone: string };
let dcrId: string;
let cimdId: string;
let foreignDcrId: string;
let patId: string;

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

function ctxFor(user: TestUser, workspace = ws): ActionContext {
  return {
    workspace,
    actor: { type: 'human', id: user.id, name: user.name },
    roles: [],
    scopes: '*',
    claims: { role: 'authenticated', sub: user.id, email: user.email, aal: 'aal1' },
    aal: 'aal1',
    requestId: randomUUID(),
    channel: 'test',
  };
}

async function addClient(values: {
  workspace_id: string | null;
  registration: 'dcr' | 'cimd' | 'manual';
  kind?: 'oauth_client' | 'pat_client';
  owner_user_id?: string;
}): Promise<string> {
  const ref = values.registration === 'cimd' ? `https://agent-${randomUUID()}.example/client.json` : `dcr_${randomUUID()}`;
  const r = await t.db
    .insertInto('agent_clients')
    .values({
      client_id: ref,
      client_secret_hash: 'deadbeef',
      name: `Agent ${ref.slice(-6)}`,
      kind: values.kind ?? 'oauth_client',
      scopes: ['opportunities:read', 'applications:read', 'applications:write', 'pipeline:read'],
      redirect_uris: ['http://127.0.0.1:43110/callback'],
      ...values,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return r.id;
}

beforeAll(async () => {
  t = await createTestDatabase('gms_oauth_consent');
  applicant = await createUser(t.db, { name: 'Maya Chen' });
  ws = await t.db.insertInto('workspaces').values({ slug: 'consentws', name: 'Consent Foundation' }).returning(['id', 'slug', 'name', 'timezone']).executeTakeFirstOrThrow();
  other = await t.db.insertInto('workspaces').values({ slug: 'otherws', name: 'Other Foundation' }).returning(['id', 'slug', 'name', 'timezone']).executeTakeFirstOrThrow();
  dcrId = await addClient({ workspace_id: ws.id, registration: 'dcr' });
  cimdId = await addClient({ workspace_id: null, registration: 'cimd' });
  foreignDcrId = await addClient({ workspace_id: other.id, registration: 'dcr' });
  const stranger = await createUser(t.db, { name: 'Sam Stranger' });
  patId = await addClient({ workspace_id: null, registration: 'manual', kind: 'pat_client', owner_user_id: stranger.id });
});

afterAll(async () => {
  await t?.drop();
});

describe('oauth.grant_consent', () => {
  it('records a grant for a DCR client the applicant cannot see under RLS, with only consentable scopes', async () => {
    const ex = createExecutor(stubDeps(), { db: t.db });
    const out = await ex.run<{ grantId: string; scopes: string[] }>(
      'oauth.grant_consent',
      { clientId: dcrId, scopes: ['opportunities:read', 'applications:write', 'pipeline:read', 'payments:approve'], durationDays: 30 },
      ctxFor(applicant),
    );
    // Staff scopes are dropped for a non-staff person; unregistered/unknown scopes are dropped too.
    expect(out.scopes).toEqual(['opportunities:read', 'applications:write']);
    const g = await t.db.selectFrom('agent_grants').selectAll().where('id', '=', out.grantId).executeTakeFirstOrThrow();
    expect(g).toMatchObject({ client_id: dcrId, user_id: applicant.id, workspace_id: ws.id, status: 'active', scopes: out.scopes });
    const audit = await t.db.selectFrom('audit_log').selectAll().where('action', '=', 'oauth.grant_consent').where('entity_id', '=', out.grantId).execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_type: 'human', actor_id: applicant.id, risk_tier: 'R3' });
  });

  it('records a grant for a workspace-less CIMD client and replaces an earlier consent', async () => {
    const ex = createExecutor(stubDeps(), { db: t.db });
    const first = await ex.run<{ grantId: string }>('oauth.grant_consent', { clientId: cimdId, scopes: ['applications:read'] }, ctxFor(applicant));
    const second = await ex.run<{ grantId: string }>('oauth.grant_consent', { clientId: cimdId, scopes: ['opportunities:read'] }, ctxFor(applicant));
    const rows = await t.db.selectFrom('agent_grants').select(['id', 'status']).where('client_id', '=', cimdId).orderBy('created_at').execute();
    expect(rows).toEqual([
      { id: first.grantId, status: 'revoked' },
      { id: second.grantId, status: 'active' },
    ]);
  });

  it('refuses clients of another tenant, non-OAuth clients, and paused clients', async () => {
    const ex = createExecutor(stubDeps(), { db: t.db });
    await expect(ex.run('oauth.grant_consent', { clientId: foreignDcrId, scopes: ['opportunities:read'] }, ctxFor(applicant))).rejects.toMatchObject({ code: 'not_found' });
    await expect(ex.run('oauth.grant_consent', { clientId: patId, scopes: ['opportunities:read'] }, ctxFor(applicant))).rejects.toMatchObject({ code: 'not_found' });
    const paused = await addClient({ workspace_id: ws.id, registration: 'dcr' });
    await t.db.updateTable('agent_clients').set({ status: 'paused' }).where('id', '=', paused).execute();
    await expect(ex.run('oauth.grant_consent', { clientId: paused, scopes: ['opportunities:read'] }, ctxFor(applicant))).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('gms.oauth_client_public exposes no secret columns and needs a signed-in person', async () => {
    const cols = await sql<{ column_name: string }>`
      select unnest(p.proargnames) as column_name from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'gms' and p.proname = 'oauth_client_public'`.execute(t.db);
    const names = cols.rows.map((r) => r.column_name);
    expect(names).toEqual(expect.arrayContaining(['id', 'name', 'logo_url', 'homepage_url', 'scopes', 'status']));
    expect(names).not.toContain('client_secret_hash');
    expect(names).not.toContain('redirect_uris');
    // No claims (anonymous) → nothing.
    const anon = await sql<{ id: string }>`select id from gms.oauth_client_public(${dcrId}::uuid, ${ws.id}::uuid)`.execute(t.db);
    expect(anon.rows).toHaveLength(0);
  });
});
