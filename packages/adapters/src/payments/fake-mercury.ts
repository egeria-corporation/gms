// SPDX-License-Identifier: AGPL-3.0-only
// FakeMercury: a stateful stand-in for Mercury backed by gms_private.fake_rail_objects, so the web app, the
// worker and the /dev simulate controls share one fake bank. Objects are stored as Mercury-shaped JSON and
// mapped with the same code as the real client, so both rails return identical interface objects.
//
// Namespacing: every row key is "<workspaceId>:<objectId>" and object ids are prefixed "fm_<ws8>_", so
// workspaces never collide and one workspace can never read another's objects (lookups include the prefix).
// Writes take a per-workspace advisory lock, which serializes sends per recipient like Mercury's pacing.
import { createHash, randomUUID } from 'node:crypto';
import { getDb, sql, type Database, type Tx } from '@gms/db';
import { deriveKey, hmacHex } from '../crypto';
import type {
  PaymentRail,
  RailAccount,
  RailEvent,
  RailTransaction,
  RecipientInvite,
  RecipientInviteInput,
  SendMoneyInput,
  SendMoneyRequest,
  WebhookRegistration,
} from '../types';
import { MercuryApiError, validateSendMoneyInput } from './common';
import {
  centsToDollars,
  diffMergePatch,
  eventTypeFor,
  mapAccount,
  mapEvent,
  mapInvite,
  mapRequest,
  mapTransaction,
  parseMercuryEvent,
  wirePurpose,
  type MercuryAccountJson,
  type MercuryEventJson,
  type MercuryInviteJson,
  type MercuryRecipientJson,
  type MercurySendMoneyRequestJson,
  type MercuryTransactionJson,
} from './mercury-wire';
import { MERCURY_SIGNATURE_HEADER, signMercuryWebhook, verifyMercurySignature } from './verify';

type Kind = 'account' | 'invite' | 'recipient' | 'request' | 'transaction' | 'event' | 'webhook';
type Exec = Database | Tx;

interface StoredRequest extends MercurySendMoneyRequestJson {
  idempotencyKey: string;
  transactionId: string | null;
  note?: string | null;
  externalMemo?: string | null;
  purpose?: unknown;
}

interface StoredInvite extends MercuryInviteJson {
  organizationNameOnRequest?: string | null;
  sendEmail?: boolean;
}

interface StoredEvent extends MercuryEventJson {
  seq: number;
}

interface StoredWebhook {
  id: string;
  url: string;
  eventTypes: string[] | null;
  status: 'active' | 'paused' | 'disabled';
  createdAt: string;
}

export interface FakeMercuryOptions {
  workspaceId: string;
  db?: Database | (() => Database);
  /** Base for the fake onboarding URL (the app serves /dev/mercury/invites/<id>). */
  onboardingBaseUrl?: string;
}

/** The workspace's fake webhook signing secret (derived from GMS_ENCRYPTION_KEY, so web + worker agree). */
export function fakeMercuryWebhookSecret(workspaceId: string): string {
  return `whsec_fake_${hmacHex(deriveKey('fake-mercury-webhook'), workspaceId).slice(0, 48)}`;
}

function resolveDb(db: FakeMercuryOptions['db']): () => Database {
  if (!db) return () => getDb();
  return typeof db === 'function' ? db : () => db;
}

function notFound(what: string, path: string): MercuryApiError {
  return new MercuryApiError({ status: 404, code: 'not_found', message: `${what} not found`, path });
}

function conflict(code: string, message: string, path: string): MercuryApiError {
  return new MercuryApiError({ status: 409, code, message, path });
}

/** Low-level store shared by the rail and the simulate controls. */
class FakeStore {
  readonly db: () => Database;
  readonly prefix: string;
  readonly idPrefix: string;

  constructor(
    readonly workspaceId: string,
    db: FakeMercuryOptions['db'],
  ) {
    if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) throw new Error('FakeMercury requires a workspace uuid');
    this.db = resolveDb(db);
    this.prefix = `${workspaceId}:`;
    this.idPrefix = `fm_${workspaceId.replace(/-/g, '').slice(0, 8)}_`;
  }

  newId(kind: string): string {
    return `${this.idPrefix}${kind}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  }

  /** Runs fn in a transaction holding the workspace's fake-bank lock. */
  async write<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
    return this.db()
      .transaction()
      .execute(async (trx) => {
        await sql`select pg_advisory_xact_lock(hashtext(${`fake-mercury:${this.workspaceId}`}))`.execute(trx);
        return fn(trx);
      });
  }

  async get<T>(ex: Exec, kind: Kind, id: string): Promise<T | null> {
    if (!id.startsWith(this.idPrefix)) return null;
    const r = await sql<{ data: T }>`select data from gms_private.fake_rail_objects where kind = ${kind} and id = ${this.prefix + id}`.execute(ex);
    return r.rows[0]?.data ?? null;
  }

  async put(ex: Exec, kind: Kind, id: string, data: object): Promise<void> {
    await sql`insert into gms_private.fake_rail_objects (kind, id, data) values (${kind}, ${this.prefix + id}, ${JSON.stringify(data)}::jsonb)
      on conflict (kind, id) do update set data = excluded.data, updated_at = now()`.execute(ex);
  }

  async list<T>(ex: Exec, kind: Kind): Promise<T[]> {
    const r = await sql<{ data: T }>`select data from gms_private.fake_rail_objects
      where kind = ${kind} and starts_with(id, ${this.prefix}) order by created_at, id`.execute(ex);
    return r.rows.map((row) => row.data);
  }

  async findRequestByKey(ex: Exec, key: string): Promise<StoredRequest | null> {
    const r = await sql<{ data: StoredRequest }>`select data from gms_private.fake_rail_objects
      where kind = 'request' and starts_with(id, ${this.prefix}) and data ->> 'idempotencyKey' = ${key}`.execute(ex);
    return r.rows[0]?.data ?? null;
  }

  async recordEvent(
    ex: Exec,
    input: { resourceType: string; resourceId: string; operationType: 'create' | 'update' | 'delete'; mergePatch: Record<string, unknown>; previousValues?: Record<string, unknown> | null; changedPaths?: string[] },
  ): Promise<StoredEvent> {
    const r = await sql<{ seq: number; version: number }>`select
        coalesce(max((data ->> 'seq')::int), 0) + 1 as seq,
        count(*) filter (where data ->> 'resourceId' = ${input.resourceId})::int + 1 as version
      from gms_private.fake_rail_objects where kind = 'event' and starts_with(id, ${this.prefix})`.execute(ex);
    const event: StoredEvent = {
      id: this.newId('evt'),
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      operationType: input.operationType,
      resourceVersion: Number(r.rows[0]?.version ?? 1),
      occurredAt: new Date().toISOString(),
      changedPaths: input.changedPaths ?? Object.keys(input.mergePatch),
      mergePatch: input.mergePatch,
      previousValues: input.previousValues ?? null,
      seq: Number(r.rows[0]?.seq ?? 1),
    };
    await this.put(ex, 'event', event.id, event);
    return event;
  }

  async updateTransaction(ex: Exec, before: MercuryTransactionJson, after: MercuryTransactionJson): Promise<void> {
    await this.put(ex, 'transaction', after.id, after);
    const d = diffMergePatch(publicTx(before), publicTx(after));
    if (d.changedPaths.length) {
      await this.recordEvent(ex, { resourceType: 'transaction', resourceId: after.id, operationType: 'update', ...d });
    }
  }

  async adjustBalance(ex: Exec, accountId: string, deltaCents: number): Promise<MercuryAccountJson> {
    const acct = await this.get<MercuryAccountJson>(ex, 'account', accountId);
    if (!acct) throw notFound('account', `/account/${accountId}`);
    const next: MercuryAccountJson = {
      ...acct,
      availableBalance: centsToDollars(Math.round(acct.availableBalance * 100) + deltaCents),
      currentBalance: centsToDollars(Math.round(acct.currentBalance * 100) + deltaCents),
    };
    await this.put(ex, 'account', acct.id, next);
    await this.recordEvent(ex, {
      resourceType: 'checkingAccount',
      resourceId: acct.id,
      operationType: 'update',
      mergePatch: { availableBalance: next.availableBalance, currentBalance: next.currentBalance },
      previousValues: { availableBalance: acct.availableBalance, currentBalance: acct.currentBalance },
    });
    return next;
  }
}

/** Transaction JSON as Mercury would expose it (internal bookkeeping fields stripped). */
function publicTx(t: MercuryTransactionJson): Record<string, unknown> {
  const { idempotencyKey: _k, attachments: _a, ...rest } = t as MercuryTransactionJson & { idempotencyKey?: unknown; attachments?: unknown };
  return rest;
}

function publicEvent(e: StoredEvent): MercuryEventJson {
  const { seq: _seq, ...rest } = e;
  return rest;
}

function mapStoredRequest(r: StoredRequest): SendMoneyRequest {
  return mapRequest(r, r.idempotencyKey, r.transactionId);
}

function mapStoredTx(t: MercuryTransactionJson): RailTransaction {
  const key = typeof t.idempotencyKey === 'string' ? t.idempotencyKey : null;
  return { ...mapTransaction(publicTx(t) as MercuryTransactionJson, key) };
}

function inRange(createdAt: string, start?: string, end?: string): boolean {
  const t = Date.parse(createdAt);
  if (start && t < Date.parse(start)) return false;
  if (end) {
    const e = /^\d{4}-\d{2}-\d{2}$/.test(end) ? Date.parse(`${end}T23:59:59.999Z`) : Date.parse(end);
    if (t > e) return false;
  }
  return true;
}

export class FakeMercury implements PaymentRail {
  readonly name = 'fake-mercury' as const;
  readonly environment = 'fake' as const;
  private readonly store: FakeStore;
  private readonly onboardingBaseUrl: string;

  constructor(opts: FakeMercuryOptions) {
    this.store = new FakeStore(opts.workspaceId, opts.db);
    this.onboardingBaseUrl = (opts.onboardingBaseUrl ?? process.env.GMS_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  }

  get workspaceId(): string {
    return this.store.workspaceId;
  }

  async listAccounts(): Promise<RailAccount[]> {
    return (await this.store.list<MercuryAccountJson>(this.store.db(), 'account')).map(mapAccount);
  }

  async createRecipientInvite(input: RecipientInviteInput): Promise<RecipientInvite> {
    if (!input.recipientId && !input.name) throw new RangeError('name is required when recipientId is not given');
    if (!/^[^@\s]+@[^@\s]+$/.test(input.contactEmail)) {
      throw new MercuryApiError({ status: 400, code: 'invalid_body', message: 'contactEmail is invalid', path: '/recipients/invites' });
    }
    return this.store.write(async (trx) => {
      if (input.recipientId && !(await this.store.get(trx, 'recipient', input.recipientId))) {
        throw notFound('recipient', '/recipients/invites');
      }
      const id = this.store.newId('inv');
      const now = new Date();
      const invite: StoredInvite = {
        id,
        onboardingUrl: `${this.onboardingBaseUrl}/dev/mercury/invites/${id}`,
        status: 'created',
        name: input.name ?? null,
        contactEmail: input.contactEmail,
        paymentMethods: [...input.paymentMethods],
        requireTaxDocument: input.requireTaxDocument,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
        recipientId: input.recipientId ?? null,
        notes: input.notes ?? null,
        organizationNameOnRequest: input.organizationNameOnRequest ?? null,
        sendEmail: input.sendEmail,
      };
      await this.store.put(trx, 'invite', id, invite);
      return mapInvite(invite);
    });
  }

  async getRecipientInvite(inviteId: string): Promise<RecipientInvite> {
    const inv = await this.store.get<StoredInvite>(this.store.db(), 'invite', inviteId);
    if (!inv) throw notFound('invite', `/recipients/invites/${inviteId}`);
    return mapInvite(inv);
  }

  async requestSendMoney(accountId: string, input: SendMoneyInput): Promise<SendMoneyRequest> {
    validateSendMoneyInput(input);
    const path = `/account/${accountId}/request-send-money`;
    return this.store.write(async (trx) => {
      const existing = await this.store.findRequestByKey(trx, input.idempotencyKey);
      if (existing) {
        if (existing.accountId !== accountId || existing.recipientId !== input.recipientId || Math.round(existing.amount * 100) !== input.amountCents) {
          throw conflict('idempotency_conflict', 'idempotencyKey was already used for a different request', path);
        }
        return mapStoredRequest(existing);
      }
      if (!(await this.store.get(trx, 'account', accountId))) throw notFound('account', path);
      if (!(await this.store.get(trx, 'recipient', input.recipientId))) throw notFound('recipient', path);
      const request: StoredRequest = {
        requestId: this.store.newId('req'),
        accountId,
        recipientId: input.recipientId,
        paymentMethod: input.paymentMethod,
        amount: centsToDollars(input.amountCents),
        status: 'pendingApproval',
        createdAt: new Date().toISOString(),
        requestedByUserId: 'fake-api-token-user',
        reviews: [],
        memo: input.note ?? null,
        numberOfApproversRequired: 1,
        scheduledSendDate: null,
        idempotencyKey: input.idempotencyKey,
        transactionId: null,
        note: input.note ?? null,
        externalMemo: input.externalMemo ?? null,
        purpose: wirePurpose(input.paymentMethod, input.purpose) ?? null,
      };
      await this.store.put(trx, 'request', request.requestId, request);
      return mapStoredRequest(request);
    });
  }

  async getSendMoneyRequest(_accountId: string, requestId: string): Promise<SendMoneyRequest> {
    const r = await this.store.get<StoredRequest>(this.store.db(), 'request', requestId);
    if (!r) throw notFound('request', `/request-send-money/${requestId}`);
    return mapStoredRequest(r);
  }

  async getTransaction(accountId: string, transactionId: string): Promise<RailTransaction> {
    const t = await this.store.get<MercuryTransactionJson>(this.store.db(), 'transaction', transactionId);
    if (!t || t.accountId !== accountId) throw notFound('transaction', `/account/${accountId}/transaction/${transactionId}`);
    return mapStoredTx(t);
  }

  async listTransactions(accountId: string, opts: { start?: string; end?: string } = {}): Promise<RailTransaction[]> {
    const all = await this.store.list<MercuryTransactionJson>(this.store.db(), 'transaction');
    return all
      .filter((t) => t.accountId === accountId && inRange(t.createdAt, opts.start, opts.end))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .map(mapStoredTx);
  }

  async updateTransaction(_accountId: string, transactionId: string, patch: { note?: string; category?: string }): Promise<void> {
    await this.store.write(async (trx) => {
      const t = await this.store.get<MercuryTransactionJson>(trx, 'transaction', transactionId);
      if (!t) throw notFound('transaction', `/transaction/${transactionId}`);
      const next: MercuryTransactionJson = { ...t };
      if (patch.note !== undefined) next.note = patch.note || null;
      if (patch.category !== undefined) next.categoryId = patch.category || null;
      await this.store.updateTransaction(trx, t, next);
    });
  }

  async uploadTransactionAttachment(
    _accountId: string,
    transactionId: string,
    file: { fileName: string; contentType: string; data: Uint8Array },
  ): Promise<void> {
    await this.store.write(async (trx) => {
      const t = await this.store.get<MercuryTransactionJson & { attachments?: unknown[] }>(trx, 'transaction', transactionId);
      if (!t) throw notFound('transaction', `/transaction/${transactionId}/attachments`);
      const attachments = Array.isArray(t.attachments) ? t.attachments : [];
      attachments.push({
        fileName: file.fileName,
        contentType: file.contentType,
        size: file.data.byteLength,
        sha256: createHash('sha256').update(file.data).digest('hex'),
        attachmentType: 'other',
      });
      await this.store.put(trx, 'transaction', t.id, { ...t, attachments });
    });
  }

  async listEvents(opts: { since?: string; limit?: number } = {}): Promise<RailEvent[]> {
    const events = (await this.store.list<StoredEvent>(this.store.db(), 'event')).sort((a, b) => a.seq - b.seq);
    let from = events;
    if (opts.since) {
      if (/^\d{4}-\d{2}-\d{2}/.test(opts.since)) {
        const since = Date.parse(opts.since);
        from = events.filter((e) => Date.parse(e.occurredAt) > since);
      } else {
        const idx = events.findIndex((e) => e.id === opts.since);
        from = idx >= 0 ? events.slice(idx + 1) : [];
      }
    }
    return from.slice(0, opts.limit ?? 500).map((e) => mapEvent(publicEvent(e)));
  }

  async createWebhook(input: { url: string; eventTypes: string[] }): Promise<WebhookRegistration> {
    return this.store.write(async (trx) => {
      const hook: StoredWebhook = {
        id: this.store.newId('whk'),
        url: input.url,
        eventTypes: input.eventTypes.length ? input.eventTypes : null,
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      await this.store.put(trx, 'webhook', hook.id, hook);
      return { webhookId: hook.id, secret: fakeMercuryWebhookSecret(this.store.workspaceId) };
    });
  }

  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>, secret: string, now?: Date): boolean {
    return verifyMercurySignature(rawBody, headers, secret, now);
  }

  parseWebhook(rawBody: string): RailEvent {
    return parseMercuryEvent(rawBody);
  }
}

// ---------------------------------------------------------------------------
// Simulate controls (used by /dev pages, seeds and tests). Never exposed in production UI.
// ---------------------------------------------------------------------------
export interface FakeMercuryState {
  accounts: RailAccount[];
  invites: RecipientInvite[];
  recipients: MercuryRecipientJson[];
  requests: SendMoneyRequest[];
  transactions: RailTransaction[];
  events: RailEvent[];
  webhooks: StoredWebhook[];
}

export interface FakeMercuryControls {
  seedAccounts(accounts: { name: string; mask: string; availableCents: number }[]): Promise<RailAccount[]>;
  completeInvite(inviteId: string, opts?: { recipientName?: string }): Promise<RecipientInvite>;
  expireInvite(inviteId: string): Promise<RecipientInvite>;
  approveRequest(requestId: string): Promise<{ request: SendMoneyRequest; transaction: RailTransaction }>;
  rejectRequest(requestId: string): Promise<SendMoneyRequest>;
  settleTransaction(txId: string): Promise<RailTransaction>;
  failTransaction(txId: string, reason: string): Promise<RailTransaction>;
  emitWebhook(eventType: string, resourceId: string, opts?: { now?: Date }): Promise<{ rawBody: string; headers: Record<string, string> }>;
  listState(): Promise<FakeMercuryState>;
  /** Removes every fake object of this workspace. */
  reset(): Promise<void>;
}

export function fakeMercuryControls(workspaceId: string, db?: FakeMercuryOptions['db']): FakeMercuryControls {
  const store = new FakeStore(workspaceId, db);

  const mustGet = async <T>(ex: Exec, kind: Kind, id: string): Promise<T> => {
    const v = await store.get<T>(ex, kind, id);
    if (!v) throw notFound(kind, `/${kind}/${id}`);
    return v;
  };

  return {
    async seedAccounts(accounts) {
      return store.write(async (trx) => {
        const existing = await store.list<MercuryAccountJson>(trx, 'account');
        const out: RailAccount[] = [];
        for (const a of accounts) {
          if (!/^\d{4}$/.test(a.mask)) throw new RangeError('mask must be exactly the last four digits');
          if (!Number.isSafeInteger(a.availableCents) || a.availableCents < 0) throw new RangeError('availableCents must be a non-negative integer');
          const prior = existing.find((e) => e.name === a.name);
          const acct: MercuryAccountJson = {
            id: prior?.id ?? store.newId('acct'),
            name: a.name,
            nickname: null,
            // Only the last four digits are ever stored, even in the fake.
            accountNumber: a.mask,
            availableBalance: centsToDollars(a.availableCents),
            currentBalance: centsToDollars(a.availableCents),
            kind: 'checking',
            type: 'mercury',
            status: 'active',
            createdAt: prior?.createdAt ?? new Date().toISOString(),
          };
          await store.put(trx, 'account', acct.id, acct);
          if (prior && (prior.availableBalance !== acct.availableBalance || prior.currentBalance !== acct.currentBalance)) {
            await store.recordEvent(trx, {
              resourceType: 'checkingAccount',
              resourceId: acct.id,
              operationType: 'update',
              mergePatch: { availableBalance: acct.availableBalance, currentBalance: acct.currentBalance },
              previousValues: { availableBalance: prior.availableBalance, currentBalance: prior.currentBalance },
            });
          }
          out.push(mapAccount(acct));
        }
        return out;
      });
    },

    async completeInvite(inviteId, opts = {}) {
      return store.write(async (trx) => {
        const inv = await mustGet<StoredInvite>(trx, 'invite', inviteId);
        if (inv.status !== 'created') throw conflict('invalid_state', `invite is ${inv.status}`, `/recipients/invites/${inviteId}`);
        let recipientId = inv.recipientId ?? null;
        if (!recipientId) {
          const recipient: MercuryRecipientJson = {
            id: store.newId('rcp'),
            name: opts.recipientName ?? inv.organizationNameOnRequest ?? inv.name ?? inv.contactEmail,
            emails: [inv.contactEmail],
            status: 'active',
            defaultPaymentMethod: inv.paymentMethods[0] ?? 'ach',
          };
          await store.put(trx, 'recipient', recipient.id, recipient);
          recipientId = recipient.id;
        }
        const next: StoredInvite = { ...inv, status: 'completed', recipientId };
        await store.put(trx, 'invite', inviteId, next);
        return mapInvite(next);
      });
    },

    async expireInvite(inviteId) {
      return store.write(async (trx) => {
        const inv = await mustGet<StoredInvite>(trx, 'invite', inviteId);
        if (inv.status !== 'created') throw conflict('invalid_state', `invite is ${inv.status}`, `/recipients/invites/${inviteId}`);
        const next: StoredInvite = { ...inv, status: 'expired', expiresAt: new Date().toISOString() };
        await store.put(trx, 'invite', inviteId, next);
        return mapInvite(next);
      });
    },

    async approveRequest(requestId) {
      return store.write(async (trx) => {
        const req = await mustGet<StoredRequest>(trx, 'request', requestId);
        const path = `/request-send-money/${requestId}`;
        if (req.status !== 'pendingApproval') throw conflict('invalid_state', `request is ${req.status}`, path);
        const acct = await mustGet<MercuryAccountJson>(trx, 'account', req.accountId);
        const cents = Math.round(req.amount * 100);
        if (Math.round(acct.availableBalance * 100) < cents) throw conflict('insufficient_funds', 'available balance is too low', path);
        const recipient = await store.get<MercuryRecipientJson>(trx, 'recipient', req.recipientId);
        const tx: MercuryTransactionJson & { idempotencyKey: string } = {
          id: store.newId('txn'),
          accountId: req.accountId,
          amount: centsToDollars(-cents),
          status: 'pending',
          kind: 'outgoingPayment',
          counterpartyId: req.recipientId,
          counterpartyName: recipient?.name ?? null,
          counterpartyNickname: null,
          note: req.note ?? null,
          externalMemo: req.externalMemo ?? null,
          createdAt: new Date().toISOString(),
          postedAt: null,
          requestId: req.requestId,
          reasonForFailure: null,
          paymentMethod: req.paymentMethod,
          idempotencyKey: req.idempotencyKey,
        };
        await store.put(trx, 'transaction', tx.id, tx);
        await store.recordEvent(trx, { resourceType: 'transaction', resourceId: tx.id, operationType: 'create', mergePatch: publicTx(tx), previousValues: null });
        await store.adjustBalance(trx, req.accountId, -cents);
        const next: StoredRequest = {
          ...req,
          status: 'approved',
          transactionId: tx.id,
          reviews: [...(req.reviews ?? []), { userId: 'fake-approver', status: 'approved', reviewedAt: new Date().toISOString() }],
        };
        await store.put(trx, 'request', requestId, next);
        return { request: mapStoredRequest(next), transaction: mapStoredTx(tx) };
      });
    },

    async rejectRequest(requestId) {
      return store.write(async (trx) => {
        const req = await mustGet<StoredRequest>(trx, 'request', requestId);
        if (req.status !== 'pendingApproval') throw conflict('invalid_state', `request is ${req.status}`, `/request-send-money/${requestId}`);
        const next: StoredRequest = {
          ...req,
          status: 'rejected',
          reviews: [...(req.reviews ?? []), { userId: 'fake-approver', status: 'rejected', reviewedAt: new Date().toISOString() }],
        };
        await store.put(trx, 'request', requestId, next);
        return mapStoredRequest(next);
      });
    },

    async settleTransaction(txId) {
      return store.write(async (trx) => {
        const t = await mustGet<MercuryTransactionJson>(trx, 'transaction', txId);
        if (t.status !== 'pending') throw conflict('invalid_state', `transaction is ${t.status}`, `/transaction/${txId}`);
        const next: MercuryTransactionJson = { ...t, status: 'sent', postedAt: new Date().toISOString() };
        await store.updateTransaction(trx, t, next);
        return mapStoredTx(next);
      });
    },

    async failTransaction(txId, reason) {
      return store.write(async (trx) => {
        const t = await mustGet<MercuryTransactionJson>(trx, 'transaction', txId);
        if (t.status !== 'pending' && t.status !== 'sent') throw conflict('invalid_state', `transaction is ${t.status}`, `/transaction/${txId}`);
        const next: MercuryTransactionJson = { ...t, status: 'failed', reasonForFailure: reason };
        await store.updateTransaction(trx, t, next);
        // Money comes back to the account.
        await store.adjustBalance(trx, t.accountId, -Math.round(t.amount * 100));
        return mapStoredTx(next);
      });
    },

    async emitWebhook(eventType, resourceId, opts = {}) {
      const event = await store.write(async (trx) => {
        const events = (await store.list<StoredEvent>(trx, 'event'))
          .filter((e) => e.resourceId === resourceId && eventTypeFor(e) === eventType)
          .sort((a, b) => b.seq - a.seq);
        if (events[0]) return events[0];
        // Synthesize an event for the resource's current state.
        if (eventType.startsWith('transaction.')) {
          const t = await mustGet<MercuryTransactionJson>(trx, 'transaction', resourceId);
          return store.recordEvent(trx, {
            resourceType: 'transaction',
            resourceId,
            operationType: eventType === 'transaction.created' ? 'create' : 'update',
            mergePatch: publicTx(t),
          });
        }
        if (eventType.endsWith('.balance.updated')) {
          const a = await mustGet<MercuryAccountJson>(trx, 'account', resourceId);
          return store.recordEvent(trx, {
            resourceType: eventType.split('.')[0]!,
            resourceId,
            operationType: 'update',
            mergePatch: { availableBalance: a.availableBalance, currentBalance: a.currentBalance },
          });
        }
        throw new RangeError(`unsupported event type: ${eventType}`);
      });
      const rawBody = JSON.stringify(publicEvent(event));
      return {
        rawBody,
        headers: {
          'content-type': 'application/json',
          [MERCURY_SIGNATURE_HEADER]: signMercuryWebhook(rawBody, fakeMercuryWebhookSecret(workspaceId), opts.now),
        },
      };
    },

    async listState() {
      const ex = store.db();
      const [accounts, invites, recipients, requests, transactions, events, webhooks] = await Promise.all([
        store.list<MercuryAccountJson>(ex, 'account'),
        store.list<StoredInvite>(ex, 'invite'),
        store.list<MercuryRecipientJson>(ex, 'recipient'),
        store.list<StoredRequest>(ex, 'request'),
        store.list<MercuryTransactionJson>(ex, 'transaction'),
        store.list<StoredEvent>(ex, 'event'),
        store.list<StoredWebhook>(ex, 'webhook'),
      ]);
      return {
        accounts: accounts.map(mapAccount),
        invites: invites.map(mapInvite),
        recipients,
        requests: requests.map(mapStoredRequest),
        transactions: transactions.map(mapStoredTx),
        events: events.sort((a, b) => a.seq - b.seq).map((e) => mapEvent(publicEvent(e))),
        webhooks,
      };
    },

    async reset() {
      await store.write(async (trx) => {
        await sql`delete from gms_private.fake_rail_objects where starts_with(id, ${store.prefix})`.execute(trx);
      });
    },
  };
}
