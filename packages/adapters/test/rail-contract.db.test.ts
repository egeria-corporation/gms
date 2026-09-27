// SPDX-License-Identifier: AGPL-3.0-only
// Contract suite: FakeMercury (DB-backed) and MercuryRail (against the HTTP emulator) must behave the same.
import { randomUUID } from 'node:crypto';
import { createTestDatabase, type TestDatabase } from '@gms/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeMercury, fakeMercuryControls } from '../src/payments/fake-mercury';
import { MercuryApiError } from '../src/payments/common';
import { MercuryRail } from '../src/payments/mercury';
import { signMercuryWebhook } from '../src/payments/verify';
import type { PaymentRail } from '../src/types';
import { MercuryEmulator } from './mercury-emulator';

interface Harness {
  rail: PaymentRail;
  seedAccount(name: string, mask: string, cents: number): Promise<string>;
  completeInvite(inviteId: string, name?: string): Promise<void>;
  approveRequest(requestId: string): Promise<void>;
  settleTransaction(txId: string): Promise<void>;
}

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase('gms_adapters_contract');
});
afterAll(async () => {
  await tdb?.drop();
});

async function fakeHarness(): Promise<Harness> {
  const ws = await tdb.db
    .insertInto('workspaces')
    .values({ slug: `c-${randomUUID().slice(0, 8)}`, name: 'Contract WS' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const controls = fakeMercuryControls(ws.id, tdb.db);
  return {
    rail: new FakeMercury({ workspaceId: ws.id, db: tdb.db }),
    seedAccount: async (name, mask, cents) => (await controls.seedAccounts([{ name, mask, availableCents: cents }]))[0]!.id,
    completeInvite: async (id, name) => {
      await controls.completeInvite(id, { recipientName: name });
    },
    approveRequest: async (id) => {
      await controls.approveRequest(id);
    },
    settleTransaction: async (id) => {
      await controls.settleTransaction(id);
    },
  };
}

async function realHarness(): Promise<Harness> {
  const emu = new MercuryEmulator();
  return {
    rail: new MercuryRail({ token: emu.token, environment: 'sandbox', fetch: emu.fetch, sleep: async () => {} }),
    seedAccount: async (name, mask, cents) => emu.seedAccount(name, mask, cents),
    completeInvite: async (id, name) => emu.completeInvite(id, name),
    approveRequest: async (id) => {
      emu.approveRequest(id);
    },
    settleTransaction: async (id) => emu.settleTransaction(id),
  };
}

describe.each([
  ['FakeMercury', fakeHarness],
  ['MercuryRail (emulated HTTP)', realHarness],
])('PaymentRail contract: %s', (_label, make) => {
  let h: Harness;
  let accountId: string;
  let recipientId: string;

  beforeAll(async () => {
    h = await make();
    accountId = await h.seedAccount('Operating', '4321', 50_000_000);
    const inv = await h.rail.createRecipientInvite({
      contactEmail: 'finance@cedar-hollow.example',
      name: 'Cedar Hollow Food Pantry',
      paymentMethods: ['ach'],
      requireTaxDocument: true,
      sendEmail: false,
    });
    await h.completeInvite(inv.inviteId, 'Cedar Hollow Food Pantry');
    recipientId = (await h.rail.getRecipientInvite(inv.inviteId)).recipientId!;
  });

  it('lists accounts with last-four masks and integer cents', async () => {
    const accounts = await h.rail.listAccounts();
    const a = accounts.find((x) => x.id === accountId)!;
    expect(a.mask).toBe('4321');
    expect(a.availableCents).toBe(50_000_000);
    expect(a.currency).toBe('USD');
    expect(JSON.stringify(accounts)).not.toMatch(/\d{5,}4321/);
  });

  it('runs the invite lifecycle created → completed', async () => {
    const inv = await h.rail.createRecipientInvite({
      contactEmail: 'grants@eastside-music.example',
      name: 'Eastside Youth Music Collective',
      paymentMethods: ['ach', 'check'],
      requireTaxDocument: true,
      sendEmail: false,
    });
    expect(inv.status).toBe('created');
    expect(inv.recipientId).toBeNull();
    expect(inv.onboardingUrl).toMatch(/^https?:\/\//);
    expect(inv.contactEmail).toBe('grants@eastside-music.example');
    const again = await h.rail.getRecipientInvite(inv.inviteId);
    expect(again).toMatchObject({ inviteId: inv.inviteId, status: 'created' });
    await h.completeInvite(inv.inviteId);
    const done = await h.rail.getRecipientInvite(inv.inviteId);
    expect(done.status).toBe('completed');
    expect(done.recipientId).toBeTruthy();
  });

  it('requires a name when no recipientId is given, and 404s unknown invites', async () => {
    await expect(
      h.rail.createRecipientInvite({ contactEmail: 'x@y.example', paymentMethods: ['ach'], requireTaxDocument: false, sendEmail: false }),
    ).rejects.toThrow(RangeError);
    const err = await h.rail.getRecipientInvite('fm_00000000_inv_missing').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MercuryApiError);
    expect((err as MercuryApiError).status).toBe(404);
  });

  it('creates idempotent send-money requests and converts amounts exactly', async () => {
    const key = `pay-${randomUUID()}`;
    const input = { recipientId, amountCents: 1_234_529, paymentMethod: 'ach' as const, idempotencyKey: key, note: 'Grant 2026-001 installment 1' };
    const r1 = await h.rail.requestSendMoney(accountId, input);
    expect(r1).toMatchObject({ status: 'pendingApproval', amountCents: 1_234_529, recipientId, accountId, idempotencyKey: key, transactionId: null });
    const r2 = await h.rail.requestSendMoney(accountId, input);
    expect(r2.requestId).toBe(r1.requestId);
    const conflict = await h.rail.requestSendMoney(accountId, { ...input, amountCents: 1_000 }).catch((e: unknown) => e);
    expect(conflict).toBeInstanceOf(MercuryApiError);
    expect((conflict as MercuryApiError).status).toBe(409);
    // Float-noise amounts survive the dollars round trip.
    const r3 = await h.rail.requestSendMoney(accountId, { ...input, amountCents: 29, idempotencyKey: `${key}-b` });
    expect(r3.amountCents).toBe(29);
  });

  it('links an approved request to its transaction, which settles pending → sent', async () => {
    const key = `pay-${randomUUID()}`;
    const req = await h.rail.requestSendMoney(accountId, { recipientId, amountCents: 250_000, paymentMethod: 'ach', idempotencyKey: key, externalMemo: 'GMS 2026-014' });
    expect((await h.rail.getSendMoneyRequest(accountId, req.requestId)).transactionId).toBeNull();
    await h.approveRequest(req.requestId);
    const approved = await h.rail.getSendMoneyRequest(accountId, req.requestId);
    expect(approved.status).toBe('approved');
    expect(approved.transactionId).toBeTruthy();
    const tx = await h.rail.getTransaction(accountId, approved.transactionId!);
    expect(tx).toMatchObject({ amountCents: -250_000, status: 'pending', requestId: req.requestId, counterpartyId: recipientId, externalMemo: 'GMS 2026-014' });
    await h.settleTransaction(tx.id);
    const sent = await h.rail.getTransaction(accountId, tx.id);
    expect(sent.status).toBe('sent');
    expect(sent.postedAt).toBeTruthy();
    const listed = await h.rail.listTransactions(accountId);
    expect(listed.map((t) => t.id)).toContain(tx.id);

    // Events: transaction.created then transaction.updated with a merge patch.
    const events = (await h.rail.listEvents()).filter((e) => e.resourceId === tx.id);
    expect(events.map((e) => e.type)).toEqual(['transaction.created', 'transaction.updated']);
    expect(events[0]!.resourceType).toBe('transaction');
    expect(events[1]!.mergePatch).toMatchObject({ status: 'sent' });
    const afterFirst = await h.rail.listEvents({ since: events[0]!.id });
    expect(afterFirst.map((e) => e.id)).toContain(events[1]!.id);
    expect(afterFirst.map((e) => e.id)).not.toContain(events[0]!.id);

    // Metadata updates.
    await h.rail.updateTransaction(accountId, tx.id, { note: 'Reconciled by GMS' });
    expect((await h.rail.getTransaction(accountId, tx.id)).note).toBe('Reconciled by GMS');
    await h.rail.uploadTransactionAttachment(accountId, tx.id, { fileName: 'award-letter.pdf', contentType: 'application/pdf', data: new Uint8Array([37, 80, 68, 70]) });
  });

  it('verifies and parses webhooks with the shared scheme', async () => {
    const reg = await h.rail.createWebhook({ url: 'https://gms.example/webhooks/mercury', eventTypes: ['transaction.created', 'transaction.updated'] });
    expect(reg.webhookId).toBeTruthy();
    expect(reg.secret.length).toBeGreaterThan(10);
    const body = JSON.stringify({ id: 'evt-1', resourceType: 'transaction', resourceId: 'txn-1', operationType: 'update', resourceVersion: 2, occurredAt: '2026-09-27T12:00:00Z', mergePatch: { status: 'sent' } });
    const headers = { 'Mercury-Signature': signMercuryWebhook(body, reg.secret) };
    expect(h.rail.verifyWebhook(body, headers, reg.secret)).toBe(true);
    expect(h.rail.verifyWebhook(body.replace('sent', 'failed'), headers, reg.secret)).toBe(false);
    expect(h.rail.parseWebhook(body)).toMatchObject({ id: 'evt-1', type: 'transaction.updated', resourceType: 'transaction', mergePatch: { status: 'sent' } });
  });
});
