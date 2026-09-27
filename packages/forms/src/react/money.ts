// SPDX-License-Identifier: AGPL-3.0-only
// Dollar input <-> integer cents, and the small input masks (EIN, UEI, phone) used by the
// renderers. React-free so it can be unit tested in node.

/**
 * Parses what someone typed in a dollar box into integer cents.
 * Accepts "$12,500", "12500.5", " 12,500.50 ", "(1,000)" is not accepted. Returns:
 * - `null` for a blank box (the answer is cleared),
 * - `undefined` when the text is not an amount (the renderer keeps the raw text so validation can explain).
 */
export function parseDollarsToCents(input: string): number | null | undefined {
  const cleaned = input.replace(/[\s$,]/g, '').replace(/^usd/i, '').replace(/usd$/i, '');
  if (cleaned === '') return null;
  if (!/^-?(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(cleaned)) return undefined;
  const negative = cleaned.startsWith('-');
  const body = negative ? cleaned.slice(1) : cleaned;
  const [whole = '0', frac = ''] = body.split('.');
  const cents = Number(whole || '0') * 100 + Number(frac.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents)) return undefined;
  return negative ? -cents : cents;
}

/** Formats cents for an input box: 1250000 → "12,500", 1250050 → "12,500.50" (no currency symbol). */
export function formatCentsForInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '';
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const wholeText = whole.toLocaleString('en-US');
  return `${negative ? '-' : ''}${wholeText}${frac ? `.${String(frac).padStart(2, '0')}` : ''}`;
}

/** The text a currency box should show for a stored value (raw text is kept for invalid entries). */
export function currencyDisplayValue(value: unknown): string {
  if (typeof value === 'number') return formatCentsForInput(value);
  if (typeof value === 'string') return value;
  return '';
}

/** Parses a plain number box. Blank → null, not a number → undefined. */
export function parseNumberInput(input: string, integer = false): number | null | undefined {
  const cleaned = input.replace(/[\s,]/g, '');
  if (cleaned === '') return null;
  if (!/^-?(\d+(\.\d+)?|\.\d+)$/.test(cleaned)) return undefined;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return undefined;
  if (integer && !Number.isInteger(n)) return undefined;
  return n;
}

/** Formats digits as an EIN while typing: "123456789" → "12-3456789". */
export function formatEin(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

/** UEIs are 12 capital letters and digits. */
export function normalizeUei(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
}
