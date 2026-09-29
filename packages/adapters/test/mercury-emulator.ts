// SPDX-License-Identifier: AGPL-3.0-or-later
// In-memory emulation of the Mercury HTTP API, built from recorded-shape JSON fixtures, used as the `fetch`
// of MercuryRail in unit and contract tests. It implements the documented semantics GMS relies on.
import accountFixture from './fixtures/mercury/account.json';
import eventFixture from './fixtures/mercury/event.json';
import inviteFixture from './fixtures/mercury/invite.json';
import requestFixture from './fixtures/mercury/send-money-request.json';
import transactionFixture from './fixtures/mercury/transaction.json';
import webhookFixture from './fixtures/mercury/webhook.json';

type Json = Record<string, unknown>;

export interface RecordedCall {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: unknown;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export class MercuryEmulator {
  readonly calls: RecordedCall[] = [];
  readonly accounts = new Map<string, Json>();
  readonly invites = new Map<string, Json>();
  readonly recipients = new Map<string, Json>();
  readonly requests = new Map<string, Json & { idempotencyKey: string }>();
  readonly transactions = new Map<string, Json>();
  readonly events: Json[] = [];
  readonly webhooks = new Map<string, Json>();
  private seq = 0;
  private failures: { status: number; headers?: Record<string, string>; body?: Json }[] = [];

  constructor(readonly token = 'secret-token:mercury_sandbox_wma_TESTTOKEN123') {}

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, '0')}-4000-8000-${Date.now().toString(16).padStart(12, '0')}`;
  }

  /** The next `times` requests fail with `status` (before routing). */
  failNext(status: number, times = 1, headers?: Record<string, string>, body?: Json): void {
    for (let i = 0; i < times; i++) this.failures.push({ status, headers, body });
  }

  seedAccount(name: string, mask: string, cents: number): string {
    const a = clone(accountFixture) as Json;
    a.id = this.id('acct');
    a.name = name;
    a.accountNumber = `000000${mask}`;
    a.availableBalance = cents / 100;
    a.currentBalance = cents / 100;
    this.accounts.set(a.id as string, a);
    return a.id as string;
  }

  private event(resourceType: string, resourceId: string, operationType: 'create' | 'update', mergePatch: Json, previousValues: Json | null): void {
    const e = clone(eventFixture) as Json;
    e.id = this.id('evt');
    e.resourceType = resourceType;
    e.resourceId = resourceId;
    e.operationType = operationType;
    e.resourceVersion = this.events.filter((x) => x.resourceId === resourceId).length + 1;
    e.occurredAt = new Date().toISOString();
    e.changedPaths = Object.keys(mergePatch);
    e.mergePatch = mergePatch;
    e.previousValues = previousValues;
    this.events.push(e);
  }

  completeInvite(inviteId: string, recipientName?: string): void {
    const inv = this.invites.get(inviteId);
    if (!inv) throw new Error('no invite');
    const rid = this.id('rcp');
    this.recipients.set(rid, { id: rid, name: recipientName ?? inv.name, emails: [inv.contactEmail], status: 'active' });
    inv.status = 'completed';
    inv.recipientId = rid;
  }

  approveRequest(requestId: string): string {
    const r = this.requests.get(requestId);
    if (!r) throw new Error('no request');
    r.status = 'approved';
    r.reviews = [{ userId: 'approver', status: 'approved' }];
    const t = clone(transactionFixture) as Json;
    t.id = this.id('txn');
    t.accountId = r.accountId;
    t.amount = -(r.amount as number);
    t.status = 'pending';
    t.counterpartyId = r.recipientId;
    t.counterpartyName = (this.recipients.get(r.recipientId as string)?.name as string) ?? null;
    t.requestId = r.requestId;
    t.createdAt = new Date().toISOString();
    t.postedAt = null;
    t.note = (r.note as string | undefined) ?? null;
    t.externalMemo = (r.externalMemo as string | undefined) ?? null;
    this.transactions.set(t.id as string, t);
    this.event('transaction', t.id as string, 'create', clone(t), null);
    const acct = this.accounts.get(r.accountId as string)!;
    const prev = { availableBalance: acct.availableBalance, currentBalance: acct.currentBalance };
    acct.availableBalance = Math.round(((acct.availableBalance as number) - (r.amount as number)) * 100) / 100;
    acct.currentBalance = Math.round(((acct.currentBalance as number) - (r.amount as number)) * 100) / 100;
    this.event('checkingAccount', acct.id as string, 'update', { availableBalance: acct.availableBalance, currentBalance: acct.currentBalance }, prev);
    return t.id as string;
  }

  settleTransaction(txId: string): void {
    const t = this.transactions.get(txId)!;
    const prev = { status: t.status, postedAt: t.postedAt };
    t.status = 'sent';
    t.postedAt = new Date().toISOString();
    this.event('transaction', txId, 'update', { status: t.status, postedAt: t.postedAt }, prev);
  }

  readonly fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    const method = (init.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v;
    });
    let body: unknown = null;
    if (typeof init.body === 'string') body = JSON.parse(init.body);
    else if (init.body instanceof FormData) body = init.body;
    const path = url.pathname.replace(/^\/api\/v1/, '');
    this.calls.push({ method, path, query: url.searchParams, headers, body });

    const fail = this.failures.shift();
    if (fail) return json(fail.body ?? { errors: { errorCode: 'unavailable', message: 'try later' } }, fail.status, fail.headers);
    if (headers.authorization !== `Bearer ${this.token}`) return json({ errors: { errorCode: 'unauthorized', message: 'bad token' } }, 401);
    return this.route(method, path, url.searchParams, body);
  };

  private route(method: string, path: string, q: URLSearchParams, body: unknown): Response {
    const b = (body ?? {}) as Json;
    let m: RegExpExecArray | null;
    if (method === 'GET' && path === '/accounts') return json({ accounts: [...this.accounts.values()], page: { nextPage: null, previousPage: null } });

    if (method === 'POST' && path === '/recipients/invites') {
      if (!b.contactEmail || !Array.isArray(b.paymentMethods)) return json({ errors: { errorCode: 'invalid_body', message: 'invalid body' } }, 400);
      const inv = clone(inviteFixture) as Json;
      inv.id = this.id('inv');
      inv.onboardingUrl = `https://app.mercury.example/recipient-onboarding/${inv.id as string}`;
      inv.status = 'created';
      inv.name = b.name ?? null;
      inv.contactEmail = b.contactEmail;
      inv.paymentMethods = b.paymentMethods;
      inv.requireTaxDocument = b.requireTaxDocument;
      inv.recipientId = b.recipientId ?? null;
      inv.notes = b.notes ?? null;
      inv.createdAt = new Date().toISOString();
      this.invites.set(inv.id as string, inv);
      return json(inv, 201);
    }
    if (method === 'GET' && (m = /^\/recipients\/invites\/([^/]+)$/.exec(path))) {
      const inv = this.invites.get(decodeURIComponent(m[1]!));
      return inv ? json(inv) : notFound();
    }
    if (method === 'POST' && (m = /^\/account\/([^/]+)\/request-send-money$/.exec(path))) {
      const accountId = decodeURIComponent(m[1]!);
      const key = b.idempotencyKey as string;
      const existing = [...this.requests.values()].find((r) => r.idempotencyKey === key);
      if (existing) {
        if (existing.accountId !== accountId || existing.recipientId !== b.recipientId || existing.amount !== b.amount) {
          return json({ errors: { errorCode: 'idempotency_conflict', message: 'key reused' } }, 409);
        }
        return json(publicRequest(existing));
      }
      if (!this.accounts.has(accountId)) return notFound();
      if (!this.recipients.has(b.recipientId as string)) return notFound();
      const r: Json & { idempotencyKey: string } = { ...(clone(requestFixture) as Json), idempotencyKey: key };
      r.requestId = this.id('req');
      r.accountId = accountId;
      r.recipientId = b.recipientId;
      r.paymentMethod = b.paymentMethod;
      r.amount = b.amount;
      r.status = 'pendingApproval';
      r.createdAt = new Date().toISOString();
      r.idempotencyKey = key;
      r.note = b.note;
      r.externalMemo = b.externalMemo;
      this.requests.set(r.requestId as string, r);
      return json(publicRequest(r));
    }
    if (method === 'GET' && (m = /^\/request-send-money\/([^/]+)$/.exec(path))) {
      const r = this.requests.get(decodeURIComponent(m[1]!));
      return r ? json(publicRequest(r)) : notFound();
    }
    if (method === 'GET' && (m = /^\/account\/([^/]+)\/transactions$/.exec(path))) {
      const accountId = decodeURIComponent(m[1]!);
      let txs = [...this.transactions.values()].filter((t) => t.accountId === accountId);
      const requestId = q.get('requestId');
      if (requestId) txs = txs.filter((t) => t.requestId === requestId);
      const start = q.get('start');
      if (start) txs = txs.filter((t) => Date.parse(t.createdAt as string) >= Date.parse(start));
      txs.sort((a, b2) => ((a.createdAt as string) < (b2.createdAt as string) ? 1 : -1));
      const offset = Number(q.get('offset') ?? 0);
      const limit = Number(q.get('limit') ?? 1000);
      return json({ total: txs.length, transactions: txs.slice(offset, offset + limit) });
    }
    if (method === 'GET' && (m = /^\/account\/([^/]+)\/transaction\/([^/]+)$/.exec(path))) {
      const t = this.transactions.get(decodeURIComponent(m[2]!));
      return t && t.accountId === decodeURIComponent(m[1]!) ? json(t) : notFound();
    }
    if (method === 'PATCH' && (m = /^\/transaction\/([^/]+)$/.exec(path))) {
      const t = this.transactions.get(decodeURIComponent(m[1]!));
      if (!t) return notFound();
      const prev: Json = {};
      const patch: Json = {};
      if ('note' in b) {
        prev.note = t.note;
        t.note = b.note || null;
        patch.note = t.note;
      }
      if ('categoryId' in b) {
        prev.categoryId = t.categoryId ?? null;
        t.categoryId = b.categoryId;
        patch.categoryId = t.categoryId;
      }
      this.event('transaction', t.id as string, 'update', patch, prev);
      return json(t);
    }
    if (method === 'POST' && (m = /^\/transaction\/([^/]+)\/attachments$/.exec(path))) {
      const t = this.transactions.get(decodeURIComponent(m[1]!));
      if (!t) return notFound();
      if (!(body instanceof FormData) || !body.get('file')) return json({ errors: { errorCode: 'invalid_body', message: 'file required' } }, 400);
      return json({ attachmentId: this.id('att'), downloadUrl: 'https://app.mercury.example/att' });
    }
    if (method === 'GET' && path === '/events') {
      const order = q.get('order') ?? 'asc';
      let list = [...this.events];
      if (order === 'desc') list.reverse();
      const startAfter = q.get('start_after');
      if (startAfter) {
        const idx = list.findIndex((e) => e.id === startAfter);
        list = idx >= 0 ? list.slice(idx + 1) : [];
      }
      const limit = Number(q.get('limit') ?? 1000);
      const page = list.slice(0, limit);
      const nextPage = list.length > limit ? (page[page.length - 1]!.id as string) : null;
      return json({ events: page, page: { nextPage, previousPage: null } });
    }
    if (method === 'POST' && path === '/webhooks') {
      const w = clone(webhookFixture) as Json;
      w.id = this.id('whk');
      w.url = b.url;
      w.eventTypes = b.eventTypes;
      w.secret = `whsec_emulated_${w.id as string}`;
      this.webhooks.set(w.id as string, w);
      return json(w, 201);
    }
    return notFound();
  }
}

function publicRequest(r: Json): Json {
  const { idempotencyKey: _k, note: _n, externalMemo: _e, ...rest } = r;
  return rest;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function notFound(): Response {
  return json({ errors: { errorCode: 'not_found', message: 'not found' } }, 404);
}
