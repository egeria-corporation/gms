// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { backoffDelay, DEFAULT_RETRY, fetchWithRetry, parseRetryAfter } from '../src/http';
import { assertMercuryEnvironmentAllowed, KeyedMutex, MercuryApiError, RailConfigurationError } from '../src/payments/common';
import { MercuryRail } from '../src/payments/mercury';
import { applyMergePatch, centsToDollars, diffMergePatch, dollarsToCents, maskAccountNumber, parseMercuryEvent } from '../src/payments/mercury-wire';
import eventFixture from './fixtures/mercury/event.json';
import { MercuryEmulator } from './mercury-emulator';

const noSleep = async () => {};

function rail(emu: MercuryEmulator, extra: Partial<ConstructorParameters<typeof MercuryRail>[0]> = {}) {
  return new MercuryRail({ token: emu.token, environment: 'sandbox', fetch: emu.fetch, sleep: noSleep, ...extra });
}

describe('amount and field mapping', () => {
  it('converts dollars ↔ cents without float drift', () => {
    expect(dollarsToCents(0.29)).toBe(29);
    expect(dollarsToCents(-1250.5)).toBe(-125050);
    expect(dollarsToCents(12345.67)).toBe(1234567);
    expect(centsToDollars(1234567)).toBe(12345.67);
    expect(centsToDollars(29)).toBe(0.29);
    expect(() => centsToDollars(1.5)).toThrow(RangeError);
  });

  it('masks account numbers to the last four digits', () => {
    expect(maskAccountNumber('0000009876')).toBe('9876');
    expect(maskAccountNumber('12')).toBeNull();
    expect(maskAccountNumber(null)).toBeNull();
  });

  it('parses recorded Mercury events and applies merge patches', () => {
    const e = parseMercuryEvent(JSON.stringify(eventFixture));
    expect(e).toMatchObject({ type: 'transaction.updated', resourceType: 'transaction', mergePatch: { status: 'sent' } });
    expect(() => parseMercuryEvent('not json')).toThrow();
    expect(() => parseMercuryEvent('{"id":1}')).toThrow();
    expect(applyMergePatch({ a: 1, b: { c: 2, d: 3 } }, { a: null, b: { c: 5 } })).toEqual({ b: { c: 5, d: 3 } });
    expect(diffMergePatch({ status: 'pending', x: 1 }, { status: 'sent', x: 1 })).toEqual({
      mergePatch: { status: 'sent' },
      previousValues: { status: 'pending' },
      changedPaths: ['status'],
    });
  });
});

describe('MercuryRail', () => {
  it('uses the sandbox base URL and a Bearer token', async () => {
    const emu = new MercuryEmulator();
    emu.seedAccount('Ops', '9876', 100_00);
    const seen: string[] = [];
    const r = new MercuryRail({
      token: emu.token,
      environment: 'sandbox',
      sleep: noSleep,
      fetch: (input, init) => {
        seen.push(String(input));
        return emu.fetch(input, init);
      },
    });
    const accounts = await r.listAccounts();
    expect(seen[0]).toMatch(/^https:\/\/api-sandbox\.mercury\.com\/api\/v1\/accounts\?/);
    expect(emu.calls[0]!.headers.authorization).toBe(`Bearer ${emu.token}`);
    expect(accounts[0]).toMatchObject({ mask: '9876', availableCents: 100_00 });
  });

  it('refuses production unless both flags are set, and mismatched tokens', () => {
    expect(() => new MercuryRail({ token: 't', environment: 'production', env: {} })).toThrow(RailConfigurationError);
    expect(() => new MercuryRail({ token: 't', environment: 'production', env: { MERCURY_ENV: 'production' } })).toThrow(RailConfigurationError);
    expect(() => new MercuryRail({ token: 't', environment: 'production', env: { GMS_ALLOW_MERCURY_PRODUCTION: 'true' } })).toThrow(RailConfigurationError);
    expect(() => assertMercuryEnvironmentAllowed('production', { MERCURY_ENV: 'production', GMS_ALLOW_MERCURY_PRODUCTION: 'true' })).not.toThrow();
    expect(() => new MercuryRail({ token: 'secret-token:mercury_production_abc', environment: 'sandbox' })).toThrow(/production Mercury token/);
    expect(() => new MercuryRail({ token: '', environment: 'sandbox' })).toThrow(RailConfigurationError);
  });

  it('never includes the token in errors or serialization', async () => {
    const emu = new MercuryEmulator();
    const r = rail(emu);
    emu.failNext(400, 1, {}, { errors: { errorCode: 'bad', message: `token ${emu.token} rejected` } });
    const err = (await r.listAccounts().catch((e: unknown) => e)) as MercuryApiError;
    expect(err).toBeInstanceOf(MercuryApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('bad');
    expect(err.message).not.toContain(emu.token);
    expect(JSON.stringify(err)).not.toContain(emu.token);
    expect(JSON.stringify(r)).not.toContain(emu.token);
    expect(Object.values(r).join(' ')).not.toContain(emu.token);
    const wrong = new MercuryRail({ token: 'secret-token:mercury_sandbox_wrong', environment: 'sandbox', fetch: emu.fetch, sleep: noSleep });
    await expect(wrong.listAccounts()).rejects.toMatchObject({ status: 401 });
  });

  it('retries 429/5xx with backoff, honoring Retry-After', async () => {
    const emu = new MercuryEmulator();
    emu.seedAccount('Ops', '1234', 1);
    const sleeps: number[] = [];
    const r = rail(emu, { sleep: async (ms) => void sleeps.push(ms), random: () => 0.5 });
    emu.failNext(429, 1, { 'retry-after': '2' });
    emu.failNext(503, 1);
    const accounts = await r.listAccounts();
    expect(accounts).toHaveLength(1);
    expect(sleeps[0]).toBe(2000);
    expect(sleeps[1]).toBe(backoffDelay(1, DEFAULT_RETRY, () => 0.5));
    expect(emu.calls).toHaveLength(3);
  });

  it('gives up after max attempts and does not retry invites on 5xx', async () => {
    const emu = new MercuryEmulator();
    const r = rail(emu);
    emu.failNext(500, 10);
    await expect(r.listAccounts()).rejects.toMatchObject({ status: 500 });
    expect(emu.calls).toHaveLength(DEFAULT_RETRY.maxAttempts);
    const emu2 = new MercuryEmulator();
    const r2 = rail(emu2);
    emu2.failNext(502, 1);
    await expect(r2.createRecipientInvite({ contactEmail: 'a@b.example', name: 'A', paymentMethods: ['ach'], requireTaxDocument: false, sendEmail: false })).rejects.toMatchObject({ status: 502 });
    expect(emu2.calls).toHaveLength(1);
  });

  it('sends amounts in dollars, wire purpose, and serializes sends per recipient', async () => {
    const emu = new MercuryEmulator();
    const acct = emu.seedAccount('Ops', '1234', 10_000_00);
    const r = rail(emu);
    const inv = await r.createRecipientInvite({ contactEmail: 'a@b.example', name: 'A', paymentMethods: ['ach', 'domesticWire'], requireTaxDocument: false, sendEmail: false });
    emu.completeInvite(inv.inviteId);
    const rid = (await r.getRecipientInvite(inv.inviteId)).recipientId!;
    let inFlight = 0;
    let maxInFlight = 0;
    const slow = new MercuryRail({
      token: emu.token,
      environment: 'sandbox',
      sleep: noSleep,
      fetch: async (input, init) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((res) => setTimeout(res, 10));
        try {
          return await emu.fetch(input, init);
        } finally {
          inFlight--;
        }
      },
    });
    await Promise.all([1, 2, 3].map((i) => slow.requestSendMoney(acct, { recipientId: rid, amountCents: 100_050 + i, paymentMethod: 'domesticWire', idempotencyKey: `k${i}` })));
    expect(maxInFlight).toBe(1);
    const sends = emu.calls.filter((c) => c.path.endsWith('/request-send-money'));
    expect((sends[0]!.body as { amount: number }).amount).toBe(1000.51);
    expect((sends[0]!.body as { purpose: unknown }).purpose).toEqual({ simple: { category: 'other', additionalInfo: 'Grant payment' } });
    await expect(slow.requestSendMoney(acct, { recipientId: rid, amountCents: 0, paymentMethod: 'ach', idempotencyKey: 'z' })).rejects.toThrow(RangeError);
  });

  it('keeps direct send as a disabled stub', async () => {
    const emu = new MercuryEmulator();
    const input = { recipientId: 'r', amountCents: 1, paymentMethod: 'ach' as const, idempotencyKey: 'k' };
    await expect(rail(emu, { env: {} }).sendMoneyDirect('a', input)).rejects.toThrow(/disabled/);
    await expect(rail(emu, { env: { GMS_FEATURE_MERCURY_DIRECT_SEND: 'true' } }).sendMoneyDirect('a', input)).rejects.toThrow(/not implemented in v1/);
    expect(emu.calls).toHaveLength(0);
  });

  it('pages events by cursor and by timestamp', async () => {
    const emu = new MercuryEmulator();
    const acct = emu.seedAccount('Ops', '1234', 10_000_00);
    const r = rail(emu);
    const inv = await r.createRecipientInvite({ contactEmail: 'a@b.example', name: 'A', paymentMethods: ['ach'], requireTaxDocument: false, sendEmail: false });
    emu.completeInvite(inv.inviteId);
    const rid = (await r.getRecipientInvite(inv.inviteId)).recipientId!;
    for (let i = 0; i < 3; i++) {
      const req = await r.requestSendMoney(acct, { recipientId: rid, amountCents: 100 + i, paymentMethod: 'ach', idempotencyKey: `e${i}` });
      emu.settleTransaction(emu.approveRequest(req.requestId));
    }
    const all = await r.listEvents();
    expect(all).toHaveLength(9);
    expect((await r.listEvents({ since: all[4]!.id })).map((e) => e.id)).toEqual(all.slice(5).map((e) => e.id));
    expect(await r.listEvents({ limit: 2 })).toHaveLength(2);
    const byTime = await r.listEvents({ since: '2000-01-01T00:00:00Z' });
    expect(byTime.map((e) => e.id)).toEqual(all.map((e) => e.id));
  });
});

describe('http helpers', () => {
  it('parses Retry-After seconds and dates', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 5_000)).toBe(5000);
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });

  it('does not retry network errors in rate-limit-only mode', async () => {
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error('ECONNRESET');
    };
    await expect(fetchWithRetry('https://x.example', () => ({}), { fetch: failing, policy: { mode: 'rate-limit-only' }, sleep: noSleep })).rejects.toThrow('ECONNRESET');
    expect(calls).toBe(1);
    calls = 0;
    await expect(fetchWithRetry('https://x.example', () => ({}), { fetch: failing, sleep: noSleep })).rejects.toThrow('ECONNRESET');
    expect(calls).toBe(DEFAULT_RETRY.maxAttempts);
  });
});

describe('KeyedMutex', () => {
  it('runs same-key work sequentially and different keys concurrently', async () => {
    const m = new KeyedMutex();
    const log: string[] = [];
    const task = (k: string, id: string, ms: number) =>
      m.run(k, async () => {
        log.push(`start ${id}`);
        await new Promise((r) => setTimeout(r, ms));
        log.push(`end ${id}`);
      });
    await Promise.all([task('a', '1', 20), task('a', '2', 1), task('b', '3', 1)]);
    expect(log.indexOf('end 1')).toBeLessThan(log.indexOf('start 2'));
    expect(log.indexOf('start 3')).toBeLessThan(log.indexOf('end 1'));
    expect(m.size).toBe(0);
    await expect(m.run('a', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await m.run('a', async () => 42)).toBe(42);
  });
});
