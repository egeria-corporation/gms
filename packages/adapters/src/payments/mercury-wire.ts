// SPDX-License-Identifier: AGPL-3.0-only
// Mercury JSON shapes (as documented at https://docs.mercury.com/reference) and the mapping to the PaymentRail
// interface types. Shared by MercuryRail and FakeMercury (which stores Mercury-shaped JSON), so both rails
// produce identical interface objects. Amounts on the wire are dollars (2 decimals); GMS uses integer cents.
import type {
  RailAccount,
  RailEvent,
  RailPaymentMethod,
  RailTransaction,
  RailTransactionStatus,
  RecipientInvite,
  RecipientInviteStatus,
  SendMoneyRequest,
  SendMoneyRequestStatus,
} from '../types';
import { isRecord } from '../http';

export const MERCURY_BASE_URLS = {
  sandbox: 'https://api-sandbox.mercury.com/api/v1/',
  production: 'https://api.mercury.com/api/v1/',
} as const;

export interface MercuryAccountJson {
  id: string;
  name: string;
  nickname?: string | null;
  /** Never persisted by GMS; only the last four digits are kept (as `mask`). */
  accountNumber?: string;
  routingNumber?: string;
  availableBalance: number;
  currentBalance: number;
  kind: string;
  type?: string;
  status?: string;
  createdAt?: string;
}

export interface MercuryInviteJson {
  id: string;
  onboardingUrl: string;
  status: RecipientInviteStatus;
  name?: string | null;
  contactEmail: string;
  paymentMethods: string[];
  requireTaxDocument: boolean;
  createdAt: string;
  expiresAt?: string | null;
  recipientId?: string | null;
  notes?: string | null;
}

export interface MercuryRecipientJson {
  id: string;
  name: string;
  emails: string[];
  status: string;
  defaultPaymentMethod?: string;
}

export interface MercurySendMoneyRequestJson {
  requestId: string;
  accountId: string;
  recipientId: string;
  paymentMethod: string;
  amount: number;
  status: SendMoneyRequestStatus;
  createdAt: string;
  requestedByUserId?: string;
  reviews?: { userId?: string; status: 'approved' | 'rejected'; reviewedAt?: string }[];
  memo?: string | null;
  numberOfApproversRequired?: number | null;
  scheduledSendDate?: string | null;
}

export interface MercuryTransactionJson {
  id: string;
  accountId: string;
  amount: number;
  status: RailTransactionStatus;
  kind: string;
  counterpartyId?: string | null;
  counterpartyName?: string | null;
  counterpartyNickname?: string | null;
  note?: string | null;
  externalMemo?: string | null;
  createdAt: string;
  postedAt?: string | null;
  requestId?: string | null;
  reasonForFailure?: string | null;
  [k: string]: unknown;
}

export interface MercuryEventJson {
  id: string;
  resourceType: string;
  resourceId: string;
  operationType: 'create' | 'update' | 'delete';
  resourceVersion: number;
  occurredAt: string;
  changedPaths?: string[];
  mergePatch: Record<string, unknown>;
  previousValues?: Record<string, unknown> | null;
}

/** Dollars (Mercury wire) → integer cents. Rounds away binary float noise (0.29 * 100 = 28.999…). */
export function dollarsToCents(amount: number): number {
  if (!Number.isFinite(amount)) throw new RangeError(`invalid amount: ${amount}`);
  return Math.round(amount * 100);
}

/** Integer cents → dollars for the wire. */
export function centsToDollars(cents: number): number {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`amount must be integer cents, got ${cents}`);
  return Number((cents / 100).toFixed(2));
}

const METHODS: readonly RailPaymentMethod[] = ['ach', 'check', 'domesticWire', 'internationalWire'];

export function toRailMethod(m: string): RailPaymentMethod | null {
  return (METHODS as readonly string[]).includes(m) ? (m as RailPaymentMethod) : null;
}

/** GMS database method names (snake_case) ↔ Mercury method names. */
export function railMethodFromDb(m: 'ach' | 'check' | 'domestic_wire' | 'international_wire'): RailPaymentMethod {
  return ({ ach: 'ach', check: 'check', domestic_wire: 'domesticWire', international_wire: 'internationalWire' } as const)[m];
}

export function dbMethodFromRail(m: RailPaymentMethod): 'ach' | 'check' | 'domestic_wire' | 'international_wire' {
  return ({ ach: 'ach', check: 'check', domesticWire: 'domestic_wire', internationalWire: 'international_wire' } as const)[m];
}

/** Keeps only the last four digits of an account number. Full numbers never leave this function. */
export function maskAccountNumber(accountNumber: string | null | undefined): string | null {
  if (!accountNumber) return null;
  const digits = accountNumber.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export function mapAccount(a: MercuryAccountJson): RailAccount {
  return {
    id: a.id,
    name: a.nickname || a.name,
    mask: maskAccountNumber(a.accountNumber),
    kind: a.kind,
    availableCents: dollarsToCents(a.availableBalance),
    currentCents: dollarsToCents(a.currentBalance),
    currency: 'USD',
  };
}

export function mapInvite(i: MercuryInviteJson): RecipientInvite {
  return {
    inviteId: i.id,
    status: i.status,
    onboardingUrl: i.onboardingUrl,
    recipientId: i.recipientId ?? null,
    contactEmail: i.contactEmail,
    expiresAt: i.expiresAt ?? null,
  };
}

export function mapRequest(r: MercurySendMoneyRequestJson, idempotencyKey: string, transactionId: string | null): SendMoneyRequest {
  return {
    requestId: r.requestId,
    accountId: r.accountId,
    status: r.status,
    amountCents: dollarsToCents(r.amount),
    recipientId: r.recipientId,
    idempotencyKey,
    transactionId,
  };
}

export function mapTransaction(t: MercuryTransactionJson, idempotencyKey: string | null = null): RailTransaction {
  return {
    id: t.id,
    accountId: t.accountId,
    amountCents: dollarsToCents(t.amount),
    status: t.status,
    counterpartyName: t.counterpartyName ?? null,
    counterpartyId: t.counterpartyId ?? null,
    externalMemo: t.externalMemo ?? null,
    note: t.note ?? null,
    kind: t.kind,
    createdAt: t.createdAt,
    postedAt: t.postedAt ?? null,
    requestId: t.requestId ?? null,
    idempotencyKey,
    raw: { ...t },
  };
}

function railResourceType(resourceType: string): RailEvent['resourceType'] {
  if (resourceType === 'transaction') return 'transaction';
  if (/account$/i.test(resourceType)) return 'account';
  return 'other';
}

/** Event type names follow Mercury's webhook naming: transaction.created, checkingAccount.balance.updated, … */
export function eventTypeFor(e: Pick<MercuryEventJson, 'resourceType' | 'operationType'>): string {
  if (e.resourceType === 'transaction') return e.operationType === 'create' ? 'transaction.created' : `transaction.${e.operationType}d`;
  if (/account$/i.test(e.resourceType)) return `${e.resourceType}.balance.updated`;
  return `${e.resourceType}.${e.operationType}`;
}

export function mapEvent(e: MercuryEventJson): RailEvent {
  return {
    id: e.id,
    type: eventTypeFor(e),
    resourceType: railResourceType(e.resourceType),
    resourceId: e.resourceId,
    occurredAt: e.occurredAt,
    mergePatch: e.mergePatch ?? {},
    raw: { ...e },
  };
}

/** Validates the shape of a webhook/event payload and maps it. Throws on malformed input. */
export function parseMercuryEvent(rawBody: string): RailEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error('webhook body is not valid JSON');
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.id !== 'string' ||
    typeof parsed.resourceType !== 'string' ||
    typeof parsed.resourceId !== 'string' ||
    typeof parsed.occurredAt !== 'string' ||
    (parsed.operationType !== 'create' && parsed.operationType !== 'update' && parsed.operationType !== 'delete')
  ) {
    throw new Error('webhook body is not a Mercury event');
  }
  const mergePatch = isRecord(parsed.mergePatch) ? parsed.mergePatch : {};
  return mapEvent({
    id: parsed.id,
    resourceType: parsed.resourceType,
    resourceId: parsed.resourceId,
    operationType: parsed.operationType,
    resourceVersion: typeof parsed.resourceVersion === 'number' ? parsed.resourceVersion : 1,
    occurredAt: parsed.occurredAt,
    changedPaths: Array.isArray(parsed.changedPaths) ? parsed.changedPaths.filter((p): p is string => typeof p === 'string') : [],
    mergePatch,
    previousValues: isRecord(parsed.previousValues) ? parsed.previousValues : null,
  });
}

/**
 * Applies an RFC 7396 JSON Merge Patch (used by Mercury's Events API) to a document. Returns a new object.
 */
export function applyMergePatch(target: unknown, patch: unknown): unknown {
  if (!isRecord(patch)) return patch;
  const result: Record<string, unknown> = isRecord(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete result[k];
    else result[k] = applyMergePatch(result[k], v);
  }
  return result;
}

/** Computes a merge patch (and the previous values) between two flat-ish JSON documents. */
export function diffMergePatch(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { mergePatch: Record<string, unknown>; previousValues: Record<string, unknown>; changedPaths: string[] } {
  const mergePatch: Record<string, unknown> = {};
  const previousValues: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    mergePatch[k] = b === undefined ? null : b;
    previousValues[k] = a === undefined ? null : a;
  }
  return { mergePatch, previousValues, changedPaths: Object.keys(mergePatch) };
}

/** International/domestic wires need a purpose; GMS sends grants as category "other" with a description. */
export function wirePurpose(method: RailPaymentMethod, purpose: string | undefined): { simple: { category: string; additionalInfo: string } } | undefined {
  if (method !== 'domesticWire' && method !== 'internationalWire') return undefined;
  return { simple: { category: 'other', additionalInfo: (purpose ?? 'Grant payment').slice(0, 140) } };
}
