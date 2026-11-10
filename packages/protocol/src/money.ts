// SPDX-License-Identifier: AGPL-3.0-only
// The GMS stores money as integer minor units + ISO currency; CommonGrants `Money` is a decimal string.

export interface Money {
  amount: string;
  currency: string;
}

const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

export const minorUnitDigits = (currency: string): number =>
  ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : THREE_DECIMAL.has(currency.toUpperCase()) ? 3 : 2;

export function toMoney(amountMinor: number, currency: string): Money {
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError(`amount in minor units must be a safe integer, got ${amountMinor}`);
  const digits = minorUnitDigits(currency);
  const sign = amountMinor < 0 ? "-" : "";
  const abs = Math.abs(amountMinor).toString().padStart(digits + 1, "0");
  const amount = digits === 0 ? abs : `${abs.slice(0, -digits)}.${abs.slice(-digits)}`;
  return { amount: sign + amount, currency: currency.toUpperCase() };
}

export function toMinor(money: Money): number {
  const digits = minorUnitDigits(money.currency);
  const m = /^(-?)([0-9]+)(?:\.([0-9]*))?$/.exec(money.amount);
  if (!m) throw new RangeError(`not a decimal amount: ${money.amount}`);
  const frac = m[3] ?? "";
  if (frac.length > digits && /[1-9]/.test(frac.slice(digits))) throw new RangeError(`${money.amount} has more precision than ${money.currency} allows`);
  const value = Number(`${m[2]}${frac.slice(0, digits).padEnd(digits, "0")}`);
  if (!Number.isSafeInteger(value)) throw new RangeError(`amount out of range: ${money.amount}`);
  return m[1] && value !== 0 ? -value : value;
}
