// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { createTestDatabase, type TestDatabase } from '@gms/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdapters, createMailer, paymentRailFor } from '../src/factory';
import { MercuryRail } from '../src/payments/mercury';
import { AesSecretStore } from '../src/secrets/aes';
import { RailConfigurationError } from '../src/payments/common';
import { GuardedMailer } from '../src/mail/guard';

let tdb: TestDatabase;
const prevAuthMode = process.env.GMS_AUTH_MODE;

beforeAll(async () => {
  tdb = await createTestDatabase('gms_adapters_factory');
  process.env.GMS_AUTH_MODE = 'test';
});
afterAll(async () => {
  if (prevAuthMode === undefined) delete process.env.GMS_AUTH_MODE;
  else process.env.GMS_AUTH_MODE = prevAuthMode;
  await tdb?.drop();
});

async function workspace(): Promise<string> {
  return (await tdb.db.insertInto('workspaces').values({ slug: `w-${randomUUID().slice(0, 8)}`, name: 'W' }).returning('id').executeTakeFirstOrThrow()).id;
}

describe('createAdapters', () => {
  it('uses fakes when nothing is configured (matches pnpm run doctor)', () => {
    const a = createAdapters({ db: () => tdb.db, env: { GMS_AUTH_MODE: 'test' } });
    expect([a.mailer.name, a.storage.name, a.scanner.name, a.secrets.name, a.llm?.name, a.auth.name, a.diligence.name, a.billing.name]).toEqual([
      'dev-outbox',
      'local-filesystem',
      'noop',
      'aes-256-gcm',
      'fake-llm',
      'test-auth',
      'fixtures',
      'stub',
    ]);
  });

  it('selects real adapters from env', () => {
    const a = createAdapters({
      db: () => tdb.db,
      env: {
        RESEND_API_KEY: 're_x',
        SUPABASE_URL: 'https://abcdefgh.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service',
        SUPABASE_ANON_KEY: 'anon',
        CLAMAV_HOST: 'clamd:3310',
        GMS_SECRET_STORE: 'vault',
        ANTHROPIC_API_KEY: 'sk-ant',
        GMS_DILIGENCE_SOURCE: 'live',
      },
    });
    expect([a.mailer.name, a.storage.name, a.scanner.name, a.secrets.name, a.llm?.name, a.auth.name, a.diligence.name]).toEqual([
      'resend',
      'supabase-storage',
      'clamav',
      'supabase-vault',
      'anthropic',
      'supabase-auth',
      'irs-ofac',
    ]);
    expect(a.mailer).toBeInstanceOf(GuardedMailer);
    const b = createAdapters({ db: () => tdb.db, env: { SMTP_URL: 'smtp://localhost:2525', OPENAI_API_KEY: 'sk', SUPABASE_URL: 'https://x.supabase.co', GMS_AUTH_MODE: 'test' } });
    expect([b.mailer.name, b.llm?.name, b.auth.name, b.storage.name]).toEqual(['smtp', 'openai', 'test-auth', 'local-filesystem']);
  });

  it('does not wrap real mailers in production deploys', () => {
    expect(createMailer(() => tdb.db, { RESEND_API_KEY: 'k', GMS_ENV: 'production' })).not.toBeInstanceOf(GuardedMailer);
    expect(createMailer(() => tdb.db, { RESEND_API_KEY: 'k' })).toBeInstanceOf(GuardedMailer);
  });

  it('redirects non-allowlisted mail into the dev outbox with redirected=true', async () => {
    const calls: string[] = [];
    const mailer = createMailer(() => tdb.db, { RESEND_API_KEY: 're_test', GMS_EMAIL_ALLOWLIST: 'qa.example' }, async (url, init) => {
      calls.push(JSON.parse(String(init?.body)).to[0] as string);
      return new Response(JSON.stringify({ id: `msg_${calls.length}` }));
    });
    const r1 = await mailer.send({ to: 'someone@realmail.example', from: 'a@gms.example', subject: 'S', html: '<p/>', text: 't', tags: { kind: 'test' } });
    const r2 = await mailer.send({ to: 'delivered@resend.dev', from: 'a@gms.example', subject: 'S', html: '<p/>', text: 't' });
    const r3 = await mailer.send({ to: 'dev@qa.example', from: 'a@gms.example', subject: 'S', html: '<p/>', text: 't' });
    expect(r1.provider).toBe('dev-outbox');
    expect([r2.provider, r3.provider]).toEqual(['resend', 'resend']);
    expect(calls).toEqual(['delivered@resend.dev', 'dev@qa.example']);
    const row = await tdb.db.selectFrom('dev_outbox').selectAll().where('id', '=', r1.messageId).executeTakeFirstOrThrow();
    expect(row.to_email).toBe('someone@realmail.example');
    expect(row.tags).toMatchObject({ kind: 'test', redirected: 'true' });
  });
});

describe('paymentRailFor', () => {
  const secrets = () => new AesSecretStore(() => tdb.db);

  it('returns null without a connection and ManualRail for manual', async () => {
    const ws = await workspace();
    expect(await paymentRailFor(ws, tdb.db, secrets())).toBeNull();
    await tdb.db.insertInto('bank_connections').values({ workspace_id: ws, provider: 'manual', mode: 'none', environment: 'fake' }).execute();
    expect((await paymentRailFor(ws, tdb.db, secrets()))?.name).toBe('manual');
  });

  it('returns FakeMercury for the fake environment', async () => {
    const ws = await workspace();
    await tdb.db.insertInto('bank_connections').values({ workspace_id: ws, provider: 'mercury', environment: 'fake' }).execute();
    const rail = await paymentRailFor(ws, tdb.db, secrets());
    expect([rail?.name, rail?.environment]).toEqual(['fake-mercury', 'fake']);
  });

  it('points fake onboarding links at the tenant origin it is given', async () => {
    const ws = await workspace();
    await tdb.db.insertInto('bank_connections').values({ workspace_id: ws, provider: 'mercury', environment: 'fake' }).execute();
    const rail = await paymentRailFor(ws, tdb.db, secrets(), { onboardingBaseUrl: 'http://halcyon.localhost:3104/' });
    const invite = await rail!.createRecipientInvite({ contactEmail: 'grantee@example.example', name: 'Grantee', paymentMethods: ['ach'], requireTaxDocument: true, sendEmail: false });
    expect(invite.onboardingUrl).toBe(`http://halcyon.localhost:3104/dev/mercury/invites/${invite.inviteId}`);
  });

  it('returns MercuryRail for sandbox with the token from the SecretStore', async () => {
    const ws = await workspace();
    const ref = await secrets().put('mercury_token', 'secret-token:mercury_sandbox_wma_TESTTOKEN123', { workspaceId: ws });
    await tdb.db.insertInto('bank_connections').values({ workspace_id: ws, provider: 'mercury', environment: 'sandbox', secret_ref: ref }).execute();
    const seen: string[] = [];
    const rail = await paymentRailFor(ws, tdb.db, secrets(), {
      fetch: async (url, init) => {
        seen.push(`${String(url)} ${new Headers(init?.headers).get('authorization') ?? ''}`);
        return new Response(JSON.stringify({ accounts: [], page: { nextPage: null } }));
      },
    });
    expect(rail).toBeInstanceOf(MercuryRail);
    expect(rail?.environment).toBe('sandbox');
    await rail!.listAccounts();
    expect(seen[0]).toMatch(/^https:\/\/api-sandbox\.mercury\.com\/api\/v1\/accounts.* Bearer secret-token:mercury_sandbox_wma_TESTTOKEN123$/);
  });

  it('refuses sandbox without a readable token, and production without the double opt-in', async () => {
    const ws = await workspace();
    await tdb.db.insertInto('bank_connections').values({ workspace_id: ws, provider: 'mercury', environment: 'sandbox' }).execute();
    await expect(paymentRailFor(ws, tdb.db, secrets())).rejects.toBeInstanceOf(RailConfigurationError);
    const ws2 = await workspace();
    const ref = await secrets().put('mercury_token', 'secret-token:mercury_production_x', { workspaceId: ws2 });
    await tdb.db.insertInto('bank_connections').values({ workspace_id: ws2, provider: 'mercury', environment: 'production', secret_ref: ref }).execute();
    await expect(paymentRailFor(ws2, tdb.db, secrets(), { env: {} })).rejects.toThrow(/production is disabled/);
    await expect(paymentRailFor(ws2, tdb.db, secrets(), { env: { MERCURY_ENV: 'production' } })).rejects.toThrow(/production is disabled/);
  });

  it('ignores disconnected connections', async () => {
    const ws = await workspace();
    await tdb.db.insertInto('bank_connections').values({ workspace_id: ws, provider: 'mercury', environment: 'fake', status: 'disconnected' }).execute();
    expect(await paymentRailFor(ws, tdb.db, secrets())).toBeNull();
  });
});
