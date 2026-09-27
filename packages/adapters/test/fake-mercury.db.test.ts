// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { sql } from '@gms/db';
import { createTestDatabase, type TestDatabase } from '@gms/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeMercury, fakeMercuryControls, fakeMercuryWebhookSecret, type FakeMercuryControls } from '../src/payments/fake-mercury';
import { applyMergePatch } from '../src/payments/mercury-wire';
import { MercuryApiError } from '../src/payments/common';
import { verifyMercurySignature, verifyMercurySignatureDetailed } from '../src/payments/verify';

let tdb: TestDatabase;

async function workspace(): Promise<string> {
  const ws = await tdb.db
    .insertInto('workspaces')
    .values({ slug: `f-${randomUUID().slice(0, 8)}`, name: 'Fake WS' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return ws.id;
}

async function readyRecipient(rail: FakeMercury, c: FakeMercuryControls, name = 'Cedar Hollow Food Pantry'): Promise<string> {
  const inv = await rail.createRecipientInvite({ contactEmail: 'pay@grantee.example', name, paymentMethods: ['ach'], requireTaxDocument: false, sendEmail: false });
  return (await c.completeInvite(inv.inviteId)).recipientId!;
}

beforeAll(async () => {
  tdb = await createTestDatabase('gms_adapters_fake');
});
afterAll(async () => {
  await tdb?.drop();
});

describe('FakeMercury', () => {
  it('shares state across instances (web, worker, dev controls) via the database', async () => {
    const ws = await workspace();
    const c = fakeMercuryControls(ws, tdb.db);
    const [acct] = await c.seedAccounts([{ name: 'Operating', mask: '1111', availableCents: 1_000_00 }]);
    const other = new FakeMercury({ workspaceId: ws, db: () => tdb.db });
    expect((await other.listAccounts()).map((a) => a.id)).toEqual([acct!.id]);
    // Re-seeding by name updates in place.
    await c.seedAccounts([{ name: 'Operating', mask: '1111', availableCents: 2_000_00 }]);
    expect((await other.listAccounts())[0]!.availableCents).toBe(2_000_00);
  });

  it('namespaces objects per workspace', async () => {
    const a = await workspace();
    const b = await workspace();
    const ca = fakeMercuryControls(a, tdb.db);
    await ca.seedAccounts([{ name: 'A', mask: '2222', availableCents: 100 }]);
    const railA = new FakeMercury({ workspaceId: a, db: tdb.db });
    const railB = new FakeMercury({ workspaceId: b, db: tdb.db });
    const inv = await railA.createRecipientInvite({ contactEmail: 'x@a.example', name: 'X', paymentMethods: ['ach'], requireTaxDocument: false, sendEmail: false });
    expect(inv.inviteId.startsWith(`fm_${a.replace(/-/g, '').slice(0, 8)}_`)).toBe(true);
    expect(await railB.listAccounts()).toEqual([]);
    await expect(railB.getRecipientInvite(inv.inviteId)).rejects.toBeInstanceOf(MercuryApiError);
    const rows = await sql<{ id: string }>`select id from gms_private.fake_rail_objects where starts_with(id, ${`${a}:`})`.execute(tdb.db);
    expect(rows.rows.length).toBeGreaterThanOrEqual(2);
    expect(() => new FakeMercury({ workspaceId: 'not-a-uuid', db: tdb.db })).toThrow();
  });

  it('never stores more than the last four digits of an account', async () => {
    const ws = await workspace();
    const c = fakeMercuryControls(ws, tdb.db);
    await expect(c.seedAccounts([{ name: 'Bad', mask: '123456789', availableCents: 1 }])).rejects.toThrow(/last four/);
  });

  it('decreases balances when transactions are created and restores them on failure', async () => {
    const ws = await workspace();
    const c = fakeMercuryControls(ws, tdb.db);
    const rail = new FakeMercury({ workspaceId: ws, db: tdb.db });
    const [acct] = await c.seedAccounts([{ name: 'Operating', mask: '3333', availableCents: 10_000_00 }]);
    const rid = await readyRecipient(rail, c);
    const req = await rail.requestSendMoney(acct!.id, { recipientId: rid, amountCents: 2_500_00, paymentMethod: 'ach', idempotencyKey: 'k-1' });
    expect((await rail.listAccounts())[0]!.availableCents).toBe(10_000_00); // pending approval: no money moves
    const { transaction } = await c.approveRequest(req.requestId);
    expect((await rail.listAccounts())[0]!.availableCents).toBe(7_500_00);
    const failed = await c.failTransaction(transaction.id, 'Recipient account closed');
    expect(failed.status).toBe('failed');
    expect(failed.raw.reasonForFailure).toBe('Recipient account closed');
    expect((await rail.listAccounts())[0]!.availableCents).toBe(10_000_00);
    // Balance events are recorded for the account.
    const balanceEvents = (await rail.listEvents()).filter((e) => e.type === 'checkingAccount.balance.updated');
    expect(balanceEvents.length).toBe(2);
  });

  it('refuses approval with insufficient funds and invalid state transitions', async () => {
    const ws = await workspace();
    const c = fakeMercuryControls(ws, tdb.db);
    const rail = new FakeMercury({ workspaceId: ws, db: tdb.db });
    const [acct] = await c.seedAccounts([{ name: 'Small', mask: '4444', availableCents: 100 }]);
    const rid = await readyRecipient(rail, c);
    const req = await rail.requestSendMoney(acct!.id, { recipientId: rid, amountCents: 500, paymentMethod: 'ach', idempotencyKey: 'k-2' });
    await expect(c.approveRequest(req.requestId)).rejects.toMatchObject({ status: 409, code: 'insufficient_funds' });
    const rejected = await c.rejectRequest(req.requestId);
    expect(rejected.status).toBe('rejected');
    await expect(c.approveRequest(req.requestId)).rejects.toMatchObject({ status: 409 });
    const inv = await rail.createRecipientInvite({ contactEmail: 'late@grantee.example', name: 'Late', paymentMethods: ['ach'], requireTaxDocument: false, sendEmail: false });
    expect((await c.expireInvite(inv.inviteId)).status).toBe('expired');
    await expect(c.completeInvite(inv.inviteId)).rejects.toMatchObject({ status: 409 });
  });

  it('records events whose merge patches rebuild the transaction', async () => {
    const ws = await workspace();
    const c = fakeMercuryControls(ws, tdb.db);
    const rail = new FakeMercury({ workspaceId: ws, db: tdb.db });
    const [acct] = await c.seedAccounts([{ name: 'Operating', mask: '5555', availableCents: 1_000_000 }]);
    const rid = await readyRecipient(rail, c);
    const req = await rail.requestSendMoney(acct!.id, { recipientId: rid, amountCents: 12_345, paymentMethod: 'ach', idempotencyKey: 'k-3' });
    const { transaction } = await c.approveRequest(req.requestId);
    await c.settleTransaction(transaction.id);
    const events = (await rail.listEvents()).filter((e) => e.resourceId === transaction.id);
    let doc: unknown = {};
    for (const e of events) doc = applyMergePatch(doc, e.mergePatch);
    const current = await rail.getTransaction(acct!.id, transaction.id);
    expect(doc).toMatchObject({ id: transaction.id, status: 'sent', amount: -123.45, postedAt: current.postedAt });
    // Events are ordered and support timestamp cursors.
    const since = await rail.listEvents({ since: new Date(Date.parse(events[0]!.occurredAt) - 1).toISOString() });
    expect(since.map((e) => e.id)).toContain(events[0]!.id);
    expect(await rail.listEvents({ limit: 1 })).toHaveLength(1);
  });

  it('emits webhooks signed with the workspace secret that the real verifier accepts', async () => {
    const ws = await workspace();
    const c = fakeMercuryControls(ws, tdb.db);
    const rail = new FakeMercury({ workspaceId: ws, db: tdb.db });
    const [acct] = await c.seedAccounts([{ name: 'Operating', mask: '6666', availableCents: 1_000_000 }]);
    const rid = await readyRecipient(rail, c);
    const req = await rail.requestSendMoney(acct!.id, { recipientId: rid, amountCents: 100_00, paymentMethod: 'ach', idempotencyKey: 'k-4' });
    const { transaction } = await c.approveRequest(req.requestId);
    await c.settleTransaction(transaction.id);
    const reg = await rail.createWebhook({ url: 'http://localhost:3000/webhooks/mercury', eventTypes: [] });
    expect(reg.secret).toBe(fakeMercuryWebhookSecret(ws));
    const hook = await c.emitWebhook('transaction.updated', transaction.id);
    expect(verifyMercurySignature(hook.rawBody, hook.headers, reg.secret)).toBe(true);
    expect(verifyMercurySignature(hook.rawBody, hook.headers, fakeMercuryWebhookSecret(await workspace()))).toBe(false);
    const evt = rail.parseWebhook(hook.rawBody);
    expect(evt).toMatchObject({ type: 'transaction.updated', resourceId: transaction.id, mergePatch: { status: 'sent' } });
    expect(hook.rawBody).not.toContain('seq');
    // Stale emission (replay) is rejected.
    const old = await c.emitWebhook('transaction.created', transaction.id, { now: new Date(Date.now() - 10 * 60_000) });
    expect(verifyMercurySignatureDetailed(old.rawBody, old.headers, reg.secret)).toEqual({ ok: false, reason: 'stale_timestamp' });
    // Balance webhooks can be synthesized for accounts.
    const bal = await c.emitWebhook('checkingAccount.balance.updated', acct!.id);
    expect(rail.parseWebhook(bal.rawBody).resourceType).toBe('account');
  });

  it('lists state and resets a workspace', async () => {
    const ws = await workspace();
    const c = fakeMercuryControls(ws, tdb.db);
    const rail = new FakeMercury({ workspaceId: ws, db: tdb.db });
    await c.seedAccounts([{ name: 'Operating', mask: '7777', availableCents: 1 }]);
    await readyRecipient(rail, c);
    const state = await c.listState();
    expect(state.accounts).toHaveLength(1);
    expect(state.invites[0]!.status).toBe('completed');
    expect(state.recipients).toHaveLength(1);
    await c.reset();
    expect((await c.listState()).accounts).toHaveLength(0);
  });

  it('serializes concurrent idempotent requests to a single request', async () => {
    const ws = await workspace();
    const c = fakeMercuryControls(ws, tdb.db);
    const rail = new FakeMercury({ workspaceId: ws, db: tdb.db });
    const [acct] = await c.seedAccounts([{ name: 'Operating', mask: '8888', availableCents: 1_000_000 }]);
    const rid = await readyRecipient(rail, c);
    const input = { recipientId: rid, amountCents: 1_00, paymentMethod: 'ach' as const, idempotencyKey: 'same-key' };
    const results = await Promise.all([1, 2, 3, 4].map(() => rail.requestSendMoney(acct!.id, input)));
    expect(new Set(results.map((r) => r.requestId)).size).toBe(1);
    expect((await c.listState()).requests).toHaveLength(1);
  });
});
