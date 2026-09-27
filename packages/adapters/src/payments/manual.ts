// SPDX-License-Identifier: AGPL-3.0-only
// ManualRail: for workspaces that pay grants outside GMS (their own bank portal, checks, a fiscal host).
// Nothing is sent from here; staff record payments (one by one or via CSV import) and GMS tracks them.
import { DomainError, parseMoneyToCents, type PaymentMethod } from '@gms/domain';
import { csvCell, parseCsv, toCsv } from '../csv';
import type {
  PaymentRail,
  RailAccount,
  RailEvent,
  RailTransaction,
  RecipientInvite,
  SendMoneyRequest,
  WebhookRegistration,
} from '../types';

export const MANUAL_RAIL_MESSAGE = 'This workspace pays grants outside GMS; record payments instead';

function manualOnly(): DomainError {
  return new DomainError('precondition_failed', MANUAL_RAIL_MESSAGE, { rail: 'manual' });
}

export class ManualRail implements PaymentRail {
  readonly name = 'manual' as const;
  readonly environment = 'none' as const;

  async listAccounts(): Promise<RailAccount[]> {
    return [];
  }
  async createRecipientInvite(): Promise<RecipientInvite> {
    throw manualOnly();
  }
  async getRecipientInvite(): Promise<RecipientInvite> {
    throw manualOnly();
  }
  async requestSendMoney(): Promise<SendMoneyRequest> {
    throw manualOnly();
  }
  async getSendMoneyRequest(): Promise<SendMoneyRequest> {
    throw manualOnly();
  }
  async getTransaction(): Promise<RailTransaction> {
    throw manualOnly();
  }
  async listTransactions(): Promise<RailTransaction[]> {
    return [];
  }
  async updateTransaction(): Promise<void> {
    throw manualOnly();
  }
  async uploadTransactionAttachment(): Promise<void> {
    throw manualOnly();
  }
  async listEvents(): Promise<RailEvent[]> {
    return [];
  }
  async createWebhook(): Promise<WebhookRegistration> {
    throw manualOnly();
  }
  verifyWebhook(): boolean {
    return false;
  }
  parseWebhook(): RailEvent {
    throw manualOnly();
  }

  /** Validates and normalizes a payment made elsewhere (the action layer persists it). */
  recordPayment(input: ManualPaymentInput): ManualPaymentRecord {
    const issues = validateManualPayment(input);
    if (issues.length) {
      throw new DomainError('validation_failed', 'The payment record needs attention', {}, issues.map((m) => ({ pointer: `/${m.field}`, message: m.message })));
    }
    return {
      awardReference: input.awardReference.trim(),
      payeeName: input.payeeName.trim(),
      amountCents: input.amountCents,
      currency: (input.currency ?? 'USD').toUpperCase(),
      method: input.method ?? 'manual',
      paidOn: input.paidOn,
      reference: input.reference?.trim() || null,
      memo: input.memo?.trim() || null,
    };
  }
}

export interface ManualPaymentInput {
  awardReference: string;
  payeeName: string;
  amountCents: number;
  currency?: string;
  method?: PaymentMethod;
  /** YYYY-MM-DD */
  paidOn: string;
  reference?: string | null;
  memo?: string | null;
}

export interface ManualPaymentRecord {
  awardReference: string;
  payeeName: string;
  amountCents: number;
  currency: string;
  method: PaymentMethod;
  paidOn: string;
  reference: string | null;
  memo: string | null;
}

function validateManualPayment(p: ManualPaymentInput): { field: string; message: string }[] {
  const out: { field: string; message: string }[] = [];
  if (!p.awardReference?.trim()) out.push({ field: 'awardReference', message: 'Award reference is required' });
  if (!p.payeeName?.trim()) out.push({ field: 'payeeName', message: 'Payee name is required' });
  if (!Number.isSafeInteger(p.amountCents) || p.amountCents <= 0) out.push({ field: 'amountCents', message: 'Amount must be more than $0.00' });
  if (!isValidDate(p.paidOn)) out.push({ field: 'paidOn', message: 'Paid on must be a date (YYYY-MM-DD)' });
  if (p.currency && !/^[A-Za-z]{3}$/.test(p.currency)) out.push({ field: 'currency', message: 'Currency must be a 3-letter ISO code' });
  return out;
}

// ---------------------------------------------------------------------------
// CSV export / import
// ---------------------------------------------------------------------------
export const PAYMENT_CSV_COLUMNS = ['payment_id', 'award_reference', 'payee_name', 'amount', 'currency', 'method', 'paid_on', 'reference', 'memo', 'status'] as const;
const REQUIRED_IMPORT_COLUMNS = ['award_reference', 'payee_name', 'amount', 'paid_on'] as const;

export interface PaymentCsvRow {
  paymentId?: string | null;
  awardReference: string;
  payeeName: string;
  amountCents: number;
  currency?: string;
  method?: PaymentMethod | null;
  paidOn?: string | null;
  reference?: string | null;
  memo?: string | null;
  status?: string | null;
}

/** Exports payments as CSV (amounts in dollars with two decimals). */
export function paymentsToCsv(rows: readonly PaymentCsvRow[]): string {
  return toCsv(
    PAYMENT_CSV_COLUMNS,
    rows.map((r) => [
      csvCell(r.paymentId ?? ''),
      csvCell(r.awardReference),
      csvCell(r.payeeName),
      csvCell(formatDollars(r.amountCents), { numeric: true }),
      csvCell((r.currency ?? 'USD').toUpperCase()),
      csvCell(r.method ?? 'manual'),
      csvCell(r.paidOn ?? ''),
      csvCell(r.reference ?? ''),
      csvCell(r.memo ?? ''),
      csvCell(r.status ?? ''),
    ]),
  );
}

function formatDollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export interface CsvRowError {
  /** 1-based line number in the file (the header is line 1). */
  line: number;
  column?: string;
  message: string;
}

export interface ParsedPaymentsCsv {
  rows: (ManualPaymentRecord & { line: number; paymentId: string | null })[];
  errors: CsvRowError[];
  ignoredColumns: string[];
}

const METHOD_ALIASES: Record<string, PaymentMethod> = {
  ach: 'ach',
  check: 'check',
  cheque: 'check',
  wire: 'domestic_wire',
  domestic_wire: 'domestic_wire',
  'domestic wire': 'domestic_wire',
  international_wire: 'international_wire',
  'international wire': 'international_wire',
  manual: 'manual',
  other: 'manual',
  '': 'manual',
};

function isValidDate(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Accepts YYYY-MM-DD or M/D/YYYY; returns YYYY-MM-DD or null. */
function normalizeDate(s: string): string | null {
  const t = s.trim();
  if (isValidDate(t)) return t;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) {
    const iso = `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
    return isValidDate(iso) ? iso : null;
  }
  return null;
}

/**
 * Parses an import file. Header names are case/space-insensitive. Every row is validated independently;
 * rows with errors are left out of `rows` and reported in `errors` so the UI can show them per line.
 */
export function parsePaymentsCsv(text: string, opts: { maxRows?: number } = {}): ParsedPaymentsCsv {
  const maxRows = opts.maxRows ?? 5_000;
  const table = parseCsv(text);
  const errors: CsvRowError[] = [];
  const rows: ParsedPaymentsCsv['rows'] = [];
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  if (header.length === 0 || (header.length === 1 && header[0] === '')) {
    return { rows, errors: [{ line: 1, message: 'The file is empty' }], ignoredColumns: [] };
  }
  const known = new Set<string>(PAYMENT_CSV_COLUMNS);
  const missing = REQUIRED_IMPORT_COLUMNS.filter((c) => !header.includes(c));
  for (const c of missing) errors.push({ line: 1, column: c, message: `Missing required column "${c}"` });
  const dupes = header.filter((h, i) => h && header.indexOf(h) !== i);
  for (const d of new Set(dupes)) errors.push({ line: 1, column: d, message: `Column "${d}" appears more than once` });
  const ignoredColumns = header.filter((h) => h && !known.has(h));
  if (missing.length || dupes.length) return { rows, errors, ignoredColumns };

  const col = (r: string[], name: string): string => {
    const i = header.indexOf(name);
    return i >= 0 ? (r[i] ?? '').trim() : '';
  };

  const body = table.slice(1);
  if (body.length > maxRows) {
    return { rows, errors: [{ line: 1, message: `The file has ${body.length} rows; the limit is ${maxRows}` }], ignoredColumns };
  }
  body.forEach((r, idx) => {
    const line = idx + 2;
    if (r.every((c) => c.trim() === '')) return;
    const rowErrors: CsvRowError[] = [];
    const awardReference = col(r, 'award_reference');
    const payeeName = col(r, 'payee_name');
    const amountRaw = col(r, 'amount');
    const amountCents = parseMoneyToCents(amountRaw);
    const paidOn = normalizeDate(col(r, 'paid_on'));
    const currency = (col(r, 'currency') || 'USD').toUpperCase();
    const methodRaw = col(r, 'method').toLowerCase();
    const method = METHOD_ALIASES[methodRaw];
    if (!awardReference) rowErrors.push({ line, column: 'award_reference', message: 'Award reference is required' });
    if (!payeeName) rowErrors.push({ line, column: 'payee_name', message: 'Payee name is required' });
    if (amountCents === null) rowErrors.push({ line, column: 'amount', message: `"${amountRaw}" is not an amount in dollars (e.g. 1250.00)` });
    else if (amountCents <= 0) rowErrors.push({ line, column: 'amount', message: 'Amount must be more than $0.00' });
    if (!paidOn) rowErrors.push({ line, column: 'paid_on', message: 'Paid on must be a date (YYYY-MM-DD or M/D/YYYY)' });
    if (!/^[A-Z]{3}$/.test(currency)) rowErrors.push({ line, column: 'currency', message: 'Currency must be a 3-letter code' });
    if (!method) rowErrors.push({ line, column: 'method', message: `Unknown method "${methodRaw}" (use ach, check, wire, international_wire or manual)` });
    if (rowErrors.length) {
      errors.push(...rowErrors);
      return;
    }
    rows.push({
      line,
      paymentId: col(r, 'payment_id') || null,
      awardReference,
      payeeName,
      amountCents: amountCents!,
      currency,
      method: method!,
      paidOn: paidOn!,
      reference: col(r, 'reference') || null,
      memo: col(r, 'memo') || null,
    });
  });
  return { rows, errors, ignoredColumns };
}
