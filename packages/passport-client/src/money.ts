// SPDX-License-Identifier: AGPL-3.0-only
// The GMS stores money as integer minor units; Passport and CommonGrants use decimal strings.
import type { Money } from "./types.ts";

export function minorToMoney(minor: number, currency = "USD"): Money {
  if (!Number.isSafeInteger(minor)) throw new Error("amount must be a safe integer of minor units");
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return { amount: `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`, currency };
}

/** Returns null when the string is not a plain decimal with at most two fraction digits. */
export function moneyToMinor(m: Money | null | undefined): number | null {
  if (!m || typeof m.amount !== "string") return null;
  const x = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(m.amount);
  if (!x) return null;
  const minor = Number(x[2]) * 100 + Number((x[3] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? (x[1] ? -minor : minor) : null;
}
