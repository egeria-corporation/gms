// SPDX-License-Identifier: AGPL-3.0-or-later
// Integer cents <-> CommonGrants Money ({ amount: "25000.00", currency: "USD" }).
// Pure string arithmetic: no floats ever touch an amount.
import type { CgMoney } from './types';

export function centsToMoney(cents: number, currency = 'USD'): CgMoney {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`money must be an integer number of cents, got ${cents}`);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return { amount: `${negative ? '-' : ''}${whole}.${frac}`, currency: currency.toUpperCase() };
}

/** Parses a CG decimal string into integer cents. Sub-cent precision (e.g. "1.005") is rejected. */
export function decimalToCents(amount: string): number {
  const m = /^(-?)([0-9]+)(?:\.([0-9]*))?$/.exec(amount.trim());
  if (!m) throw new RangeError(`not a decimal amount: ${amount}`);
  const [, sign, whole, fracRaw = ''] = m;
  const extra = fracRaw.slice(2);
  if (/[1-9]/.test(extra)) throw new RangeError(`amount has sub-cent precision: ${amount}`);
  const frac = fracRaw.slice(0, 2).padEnd(2, '0');
  const cents = Number(whole) * 100 + Number(frac);
  if (!Number.isSafeInteger(cents)) throw new RangeError(`amount out of range: ${amount}`);
  return sign === '-' && cents !== 0 ? -cents : cents;
}

export function moneyToCents(money: CgMoney): { cents: number; currency: string } {
  return { cents: decimalToCents(money.amount), currency: money.currency.toUpperCase() };
}

export function optionalMoney(cents: number | null | undefined, currency: string): CgMoney | undefined {
  return cents === null || cents === undefined ? undefined : centsToMoney(cents, currency);
}

export function optionalCents(money: CgMoney | null | undefined): number | null {
  return money ? decimalToCents(money.amount) : null;
}
