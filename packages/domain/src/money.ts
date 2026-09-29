// SPDX-License-Identifier: AGPL-3.0-or-later
// Money is always integer cents + ISO currency. Never floats in storage or arithmetic.

export interface Money {
  cents: number;
  currency: string;
}

export function money(cents: number, currency = 'USD'): Money {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`money must be an integer number of cents, got ${cents}`);
  return { cents, currency: currency.toUpperCase() };
}

export function sumCents(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    if (!Number.isSafeInteger(v)) throw new RangeError(`not an integer cents value: ${v}`);
    total += v;
  }
  if (!Number.isSafeInteger(total)) throw new RangeError('sum overflow');
  return total;
}

const formatters = new Map<string, Intl.NumberFormat>();
function fmt(currency: string, fraction: boolean): Intl.NumberFormat {
  const key = `${currency}:${fraction}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: fraction ? 2 : 0,
      maximumFractionDigits: fraction ? 2 : 0,
    });
    formatters.set(key, f);
  }
  return f;
}

/** "$12,500.00" or, with compact=true and whole dollars, "$12,500". */
export function formatMoney(cents: number | null | undefined, currency = 'USD', opts: { compact?: boolean } = {}): string {
  if (cents === null || cents === undefined) return '—';
  const whole = cents % 100 === 0;
  return fmt(currency, !(opts.compact && whole)).format(cents / 100);
}

/** "$1.2M", "$450K" for dashboards. */
export function formatMoneyShort(cents: number, currency = 'USD'): string {
  const v = cents / 100;
  const sym = currency === 'USD' ? '$' : `${currency} `;
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (abs >= 1_000) return `${sym}${(v / 1_000).toFixed(abs >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return `${sym}${v.toFixed(0)}`;
}

/** Parses "$12,500.50", "12500.5", "12,500" into cents. Returns null when not a valid amount. */
export function parseMoneyToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }
  const cleaned = input.replace(/[\s$,]/g, '').replace(/^USD/i, '');
  if (!/^-?\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  const sign = whole!.startsWith('-') ? -1 : 1;
  const w = Math.abs(Number(whole));
  return sign * (w * 100 + Number(frac.padEnd(2, '0')));
}

export type PaymentMethod = 'ach' | 'check' | 'domestic_wire' | 'international_wire' | 'manual';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  ach: 'ACH',
  check: 'Check',
  domestic_wire: 'Domestic wire',
  international_wire: 'International wire',
  manual: 'Paid outside GMS',
};

/**
 * Fees shown before approval (per Mercury's published pricing):
 * ACH, domestic wire and RTP are free; international USD wire free (SHA) or $15 (OUR); FX wires 1%.
 */
export function mercuryFeeCents(
  method: PaymentMethod,
  amountCents: number,
  opts: { currency?: string; chargeBearer?: 'SHA' | 'OUR' } = {},
): number {
  const currency = (opts.currency ?? 'USD').toUpperCase();
  switch (method) {
    case 'ach':
    case 'domestic_wire':
    case 'check':
    case 'manual':
      return 0;
    case 'international_wire':
      if (currency !== 'USD') return Math.round(amountCents * 0.01);
      return opts.chargeBearer === 'OUR' ? 1500 : 0;
  }
}

/** Splits an amount into n installments whose sum is exact (remainder on the last). */
export function splitInstallments(totalCents: number, n: number): number[] {
  if (n < 1) throw new RangeError('n must be >= 1');
  const base = Math.floor(totalCents / n);
  const out = Array.from({ length: n }, () => base);
  out[n - 1]! += totalCents - base * n;
  return out;
}
