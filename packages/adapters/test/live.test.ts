// SPDX-License-Identifier: AGPL-3.0-only
// Live integration tests. They only run when sandbox credentials exist and NEVER touch Mercury production:
// MercuryRail refuses production without GMS_ALLOW_MERCURY_PRODUCTION, and these tests require MERCURY_ENV=sandbox.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SupabaseAuthAdapter } from '../src/auth/supabase-auth';
import { MercuryRail } from '../src/payments/mercury';

const mercurySandbox = Boolean(process.env.MERCURY_API_TOKEN) && process.env.MERCURY_ENV === 'sandbox';

describe.skipIf(!mercurySandbox)('MercuryRail (live sandbox)', () => {
  const rail = () => new MercuryRail({ token: process.env.MERCURY_API_TOKEN!, environment: 'sandbox' });

  it('lists sandbox accounts with masks only', async () => {
    const accounts = await rail().listAccounts();
    expect(Array.isArray(accounts)).toBe(true);
    for (const a of accounts) expect(a.mask === null || /^\d{4}$/.test(a.mask)).toBe(true);
  });

  it('creates and reads a recipient invite without sending email', async () => {
    const r = rail();
    const inv = await r.createRecipientInvite({
      contactEmail: `gms-live-${randomUUID().slice(0, 8)}@example.com`,
      name: 'GMS Live Test Recipient',
      paymentMethods: ['ach'],
      requireTaxDocument: false,
      sendEmail: false,
      notes: 'Created by the GMS sandbox live test.',
    });
    expect(inv.status).toBe('created');
    expect((await r.getRecipientInvite(inv.inviteId)).inviteId).toBe(inv.inviteId);
  });

  it.skipIf(!process.env.MERCURY_SANDBOX_RECIPIENT_ID)('requests a $1.00 send in the sandbox (idempotent)', async () => {
    const r = rail();
    const [account] = await r.listAccounts();
    const input = { recipientId: process.env.MERCURY_SANDBOX_RECIPIENT_ID!, amountCents: 100, paymentMethod: 'ach' as const, idempotencyKey: `gms-live-${randomUUID()}`, note: 'GMS sandbox live test' };
    const req = await r.requestSendMoney(account!.id, input);
    expect(req.status).toBe('pendingApproval');
    expect(req.amountCents).toBe(100);
    expect((await r.requestSendMoney(account!.id, input)).requestId).toBe(req.requestId);
    expect((await r.getSendMoneyRequest(account!.id, req.requestId)).requestId).toBe(req.requestId);
  });
});

const supabaseLive = Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY) && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe.skipIf(!supabaseLive)('SupabaseAuthAdapter (live)', () => {
  it('ensures a user idempotently and generates a callback link', async () => {
    const auth = new SupabaseAuthAdapter();
    const email = `gms-live-${randomUUID().slice(0, 8)}@example.com`;
    const id = await auth.ensureUser({ email, fullName: 'Live Test' });
    expect(await auth.ensureUser({ email })).toBe(id);
    const link = await auth.generateLink(email, 'http://localhost:3000/app');
    const url = new URL(link);
    expect(url.pathname).toBe('/auth/callback');
    expect(url.searchParams.get('token_hash')).toBeTruthy();
    expect(url.searchParams.get('next')).toBe('/app');
  });
});

describe('SupabaseAuthAdapter (offline)', () => {
  it('requires a URL and a publishable key', () => {
    expect(() => new SupabaseAuthAdapter({ url: '', anonKey: '' })).toThrow(/SUPABASE_URL/);
    const a = new SupabaseAuthAdapter({ url: 'https://abcdefgh.supabase.co', anonKey: 'anon', serviceRoleKey: 'service-secret' });
    expect(a.name).toBe('supabase-auth');
    expect(JSON.stringify(a)).not.toContain('service-secret');
  });

  it('returns null sessions when there are no cookies (no network needed)', async () => {
    const a = new SupabaseAuthAdapter({ url: 'https://abcdefgh.supabase.co', anonKey: 'anon' });
    const jar = { get: () => undefined, set: () => {}, delete: () => {} };
    expect(await a.getSession(jar)).toBeNull();
    expect(await a.handleCallback(new URLSearchParams(), jar)).toBeNull();
  });
});
