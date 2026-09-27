// SPDX-License-Identifier: AGPL-3.0-only
// MercuryRail: the real Mercury API client (sandbox in development; production only behind an explicit
// double opt-in). fetch-based with an injectable fetch for tests. Docs: https://docs.mercury.com/reference
//
//   Base URLs   sandbox https://api-sandbox.mercury.com/api/v1/   production https://api.mercury.com/api/v1/
//   Auth        Authorization: Bearer <token>   (Mercury tokens look like "secret-token:mercury_sandbox_…")
//   Payments    POST /account/{id}/request-send-money creates an approval request (pendingApproval → approved |
//               rejected | cancelled) that a person approves inside Mercury. Once approved, the resulting
//               transaction carries `requestId`; we find it via GET /account/{id}/transactions?requestId=…
//   Webhooks    Mercury-Signature: t=<ts>,v1=<hex hmac-sha256("<ts>.<body>")>, see ./verify.ts
//
// Safety: GMS v1 never performs direct sends (POST /account/{id}/transactions). `sendMoneyDirect` is a
// documented stub gated by GMS_FEATURE_MERCURY_DIRECT_SEND that always throws.
import {
  fetchWithRetry,
  isRecord,
  readJson,
  redact,
  type FetchLike,
  type RetryPolicy,
} from '../http';
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
import { assertMercuryEnvironmentAllowed, KeyedMutex, MercuryApiError, RailConfigurationError, validateSendMoneyInput, type MercuryEnvironment } from './common';
import {
  centsToDollars,
  mapAccount,
  mapEvent,
  mapInvite,
  mapRequest,
  mapTransaction,
  MERCURY_BASE_URLS,
  parseMercuryEvent,
  wirePurpose,
  type MercuryAccountJson,
  type MercuryEventJson,
  type MercuryInviteJson,
  type MercurySendMoneyRequestJson,
  type MercuryTransactionJson,
} from './mercury-wire';
import { verifyMercurySignature } from './verify';

export interface MercuryRailOptions {
  /** API token, read by the app from the SecretStore. Never logged or included in errors. */
  token: string;
  environment: MercuryEnvironment;
  fetch?: FetchLike;
  /** Overrides the base URL (tests only). */
  baseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  retry?: Partial<RetryPolicy>;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

type Query = Record<string, string | number | undefined>;

/** Shared across instances so two rails for the same workspace in one process still serialize per recipient. */
const recipientLocks = new KeyedMutex();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T|$)/;

export class MercuryRail implements PaymentRail {
  readonly name = 'mercury' as const;
  readonly environment: MercuryEnvironment;
  readonly #token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly opts: MercuryRailOptions;
  /** requestId → idempotencyKey for requests created by this process (Mercury does not echo the key). */
  private readonly keys = new Map<string, string>();

  constructor(opts: MercuryRailOptions) {
    const env = opts.env ?? process.env;
    assertMercuryEnvironmentAllowed(opts.environment, env);
    if (!opts.token) throw new RailConfigurationError('Mercury API token is missing.');
    if (opts.environment === 'sandbox' && /mercury_production/i.test(opts.token)) {
      throw new RailConfigurationError('A production Mercury token was supplied for the sandbox environment; refusing.');
    }
    if (opts.environment === 'production' && /mercury_sandbox/i.test(opts.token)) {
      throw new RailConfigurationError('A sandbox Mercury token was supplied for the production environment.');
    }
    this.environment = opts.environment;
    this.#token = opts.token;
    this.baseUrl = (opts.baseUrl ?? MERCURY_BASE_URLS[opts.environment]).replace(/\/?$/, '/');
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.opts = opts;
  }

  /** Never serialize the token. */
  toJSON(): Record<string, unknown> {
    return { name: this.name, environment: this.environment, baseUrl: this.baseUrl };
  }

  private async call<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    opts: { query?: Query; body?: unknown; form?: () => FormData; retry?: RetryPolicy['mode'] } = {},
  ): Promise<T> {
    const url = new URL(path.replace(/^\//, ''), this.baseUrl);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const token = this.#token;
    const res = await fetchWithRetry(
      url.toString(),
      () => {
        const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json' };
        let body: RequestInit['body'];
        if (opts.form) body = opts.form();
        else if (opts.body !== undefined) {
          headers['content-type'] = 'application/json';
          body = JSON.stringify(opts.body);
        }
        return { method, headers, body };
      },
      {
        fetch: this.fetchImpl,
        policy: { ...this.opts.retry, mode: opts.retry ?? (method === 'GET' || method === 'PATCH' ? 'transient' : 'rate-limit-only') },
        sleep: this.opts.sleep,
        random: this.opts.random,
        timeoutMs: this.opts.timeoutMs ?? 30_000,
      },
    ).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'network error';
      throw new MercuryApiError({ status: 0, code: 'network_error', message: redact(message, [token]), path: url.pathname });
    });
    const json = await readJson(res);
    if (!res.ok) {
      const { code, message } = errorDetails(json, res.status);
      throw new MercuryApiError({ status: res.status, code, message: redact(message, [token]), path: url.pathname });
    }
    return json as T;
  }

  async listAccounts(): Promise<RailAccount[]> {
    const out: RailAccount[] = [];
    let startAfter: string | undefined;
    for (let page = 0; page < 20; page++) {
      const r = await this.call<{ accounts: MercuryAccountJson[]; page?: { nextPage?: string | null } }>('GET', '/accounts', {
        query: { limit: 1000, start_after: startAfter },
      });
      for (const a of r.accounts ?? []) {
        if (a.status === 'deleted' || a.status === 'archived') continue;
        out.push(mapAccount(a));
      }
      startAfter = r.page?.nextPage ?? undefined;
      if (!startAfter) break;
    }
    return out;
  }

  async createRecipientInvite(input: RecipientInviteInput): Promise<RecipientInvite> {
    if (!input.recipientId && !input.name) throw new RangeError('name is required when recipientId is not given');
    const body = {
      contactEmail: input.contactEmail,
      paymentMethods: input.paymentMethods,
      requireTaxDocument: input.requireTaxDocument,
      sendEmail: input.sendEmail,
      ...(input.recipientId ? { recipientId: input.recipientId } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
      ...(input.organizationNameOnRequest ? { organizationNameOnRequest: input.organizationNameOnRequest } : {}),
    };
    // Not idempotent: only retried when Mercury says it did not process the request (429).
    const r = await this.call<MercuryInviteJson>('POST', '/recipients/invites', { body, retry: 'rate-limit-only' });
    return mapInvite(r);
  }

  async getRecipientInvite(inviteId: string): Promise<RecipientInvite> {
    return mapInvite(await this.call<MercuryInviteJson>('GET', `/recipients/invites/${encodeURIComponent(inviteId)}`));
  }

  /**
   * Creates a send-money approval request. Sends to one recipient are serialized in-process (Mercury rejects
   * identical sends within 24h and recommends pacing); the idempotency key makes retries safe.
   */
  async requestSendMoney(accountId: string, input: SendMoneyInput): Promise<SendMoneyRequest> {
    validateSendMoneyInput(input);
    return recipientLocks.run(`${this.environment}:${input.recipientId}`, async () => {
      const purpose = wirePurpose(input.paymentMethod, input.purpose);
      const body = {
        recipientId: input.recipientId,
        amount: centsToDollars(input.amountCents),
        paymentMethod: input.paymentMethod,
        idempotencyKey: input.idempotencyKey,
        ...(input.note ? { note: input.note } : {}),
        ...(input.externalMemo ? { externalMemo: input.externalMemo } : {}),
        ...(purpose ? { purpose } : {}),
      };
      const r = await this.call<MercurySendMoneyRequestJson>('POST', `/account/${encodeURIComponent(accountId)}/request-send-money`, {
        body,
        retry: 'transient',
      });
      this.keys.set(r.requestId, input.idempotencyKey);
      return mapRequest(r, input.idempotencyKey, null);
    });
  }

  async getSendMoneyRequest(accountId: string, requestId: string): Promise<SendMoneyRequest> {
    const r = await this.call<MercurySendMoneyRequestJson & { idempotencyKey?: string }>(
      'GET',
      `/request-send-money/${encodeURIComponent(requestId)}`,
    );
    let transactionId: string | null = null;
    if (r.status === 'approved') {
      const tx = await this.findTransactionForRequest(r.accountId || accountId, requestId, r.createdAt);
      transactionId = tx?.id ?? null;
    }
    return mapRequest(r, r.idempotencyKey ?? this.keys.get(requestId) ?? '', transactionId);
  }

  private async findTransactionForRequest(accountId: string, requestId: string, createdAt: string | undefined): Promise<MercuryTransactionJson | null> {
    const start = createdAt && ISO_DATE.test(createdAt) ? createdAt.slice(0, 10) : undefined;
    const r = await this.call<{ transactions: MercuryTransactionJson[] }>('GET', `/account/${encodeURIComponent(accountId)}/transactions`, {
      query: { requestId, start, limit: 10 },
    });
    return (r.transactions ?? []).find((t) => t.requestId === requestId) ?? null;
  }

  async getTransaction(accountId: string, transactionId: string): Promise<RailTransaction> {
    const t = await this.call<MercuryTransactionJson>(
      'GET',
      `/account/${encodeURIComponent(accountId)}/transaction/${encodeURIComponent(transactionId)}`,
    );
    return mapTransaction(t);
  }

  async listTransactions(accountId: string, opts: { start?: string; end?: string } = {}): Promise<RailTransaction[]> {
    const out: RailTransaction[] = [];
    const limit = 500;
    for (let offset = 0; offset < 50_000; offset += limit) {
      const r = await this.call<{ total?: number; transactions: MercuryTransactionJson[] }>(
        'GET',
        `/account/${encodeURIComponent(accountId)}/transactions`,
        { query: { start: opts.start, end: opts.end, limit, offset, order: 'desc' } },
      );
      const page = r.transactions ?? [];
      out.push(...page.map((t) => mapTransaction(t)));
      if (page.length < limit) break;
    }
    return out;
  }

  /** Mercury takes `categoryId` (a custom category UUID); `category` maps onto it. */
  async updateTransaction(_accountId: string, transactionId: string, patch: { note?: string; category?: string }): Promise<void> {
    const body: Record<string, unknown> = {};
    if (patch.note !== undefined) body.note = patch.note;
    if (patch.category !== undefined) body.categoryId = patch.category || null;
    if (Object.keys(body).length === 0) return;
    await this.call('PATCH', `/transaction/${encodeURIComponent(transactionId)}`, { body });
  }

  async uploadTransactionAttachment(
    _accountId: string,
    transactionId: string,
    file: { fileName: string; contentType: string; data: Uint8Array },
  ): Promise<void> {
    if (file.data.byteLength > 32 * 1024 * 1024) throw new RangeError('Mercury attachments are limited to 32 MB');
    await this.call('POST', `/transaction/${encodeURIComponent(transactionId)}/attachments`, {
      form: () => {
        const fd = new FormData();
        fd.set('file', new Blob([file.data.slice()], { type: file.contentType }), file.fileName.slice(0, 299));
        fd.set('attachmentType', 'other');
        return fd;
      },
      retry: 'rate-limit-only',
    });
  }

  /**
   * Events API (90-day retention, JSON Merge Patch payloads). `since` is either an event id (cursor, exclusive)
   * or an ISO timestamp (events strictly after it).
   */
  async listEvents(opts: { since?: string; limit?: number } = {}): Promise<RailEvent[]> {
    const limit = Math.max(1, Math.min(opts.limit ?? 500, 10_000));
    const out: MercuryEventJson[] = [];
    if (opts.since && ISO_DATE.test(opts.since)) {
      // Walk backwards from newest until we pass the timestamp, then return ascending.
      const since = Date.parse(opts.since);
      let endBefore: string | undefined;
      outer: for (let page = 0; page < 100; page++) {
        const r = await this.call<{ events: MercuryEventJson[]; page?: { nextPage?: string | null } }>('GET', '/events', {
          query: { limit: 1000, order: 'desc', start_after: endBefore },
        });
        for (const e of r.events ?? []) {
          if (Date.parse(e.occurredAt) <= since) break outer;
          out.push(e);
        }
        endBefore = r.page?.nextPage ?? undefined;
        if (!endBefore) break;
      }
      return out.reverse().slice(0, limit).map(mapEvent);
    }
    let startAfter = opts.since;
    for (let page = 0; page < 100 && out.length < limit; page++) {
      const r = await this.call<{ events: MercuryEventJson[]; page?: { nextPage?: string | null } }>('GET', '/events', {
        query: { limit: Math.min(1000, limit - out.length), order: 'asc', start_after: startAfter },
      });
      out.push(...(r.events ?? []));
      startAfter = r.page?.nextPage ?? undefined;
      if (!startAfter || (r.events ?? []).length === 0) break;
    }
    return out.slice(0, limit).map(mapEvent);
  }

  async createWebhook(input: { url: string; eventTypes: string[] }): Promise<WebhookRegistration> {
    const r = await this.call<{ id: string; secret?: string | null; secretKey?: string | null }>('POST', '/webhooks', {
      body: { url: input.url, eventTypes: input.eventTypes.length ? input.eventTypes : null },
      retry: 'rate-limit-only',
    });
    const secret = r.secret ?? r.secretKey;
    if (!secret) throw new MercuryApiError({ status: 502, code: 'missing_secret', message: 'webhook created without a signing secret', path: '/webhooks' });
    return { webhookId: r.id, secret };
  }

  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>, secret: string, now?: Date): boolean {
    return verifyMercurySignature(rawBody, headers, secret, now);
  }

  parseWebhook(rawBody: string): RailEvent {
    return parseMercuryEvent(rawBody);
  }

  /**
   * NOT IMPLEMENTED IN v1. Direct sends (POST /account/{id}/transactions) move money without an approval step
   * inside Mercury, so GMS v1 only creates approval requests. Kept as a flag-gated stub for a future version.
   */
  async sendMoneyDirect(_accountId: string, _input: SendMoneyInput): Promise<never> {
    const env = this.opts.env ?? process.env;
    if (env.GMS_FEATURE_MERCURY_DIRECT_SEND !== 'true') {
      throw new RailConfigurationError('Direct send is disabled (GMS_FEATURE_MERCURY_DIRECT_SEND is not enabled) and not implemented in v1.');
    }
    throw new RailConfigurationError('Mercury direct send is not implemented in v1; use request-send-money approvals.');
  }
}

function errorDetails(json: unknown, status: number): { code: string; message: string } {
  const fallback = { code: `http_${status}`, message: `request failed with status ${status}` };
  if (!isRecord(json)) return fallback;
  const errors = json.errors;
  if (isRecord(errors)) {
    return {
      code: typeof errors.errorCode === 'string' ? errors.errorCode : fallback.code,
      message: typeof errors.message === 'string' ? errors.message : fallback.message,
    };
  }
  return {
    code: typeof json.errorCode === 'string' ? json.errorCode : typeof json.error === 'string' ? json.error : fallback.code,
    message: typeof json.message === 'string' ? json.message : fallback.message,
  };
}
