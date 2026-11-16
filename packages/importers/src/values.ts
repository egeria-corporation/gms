// SPDX-License-Identifier: AGPL-3.0-only
// Reading one cell as a date, an amount, a yes/no, a web address or a line of text. Each reader
// returns `undefined` for an empty cell and `null` for a cell it cannot read, so a validator can
// tell "not given" from "given but wrong".

/** Currencies without minor units, and with three (ISO 4217); the same lists as @gms/protocol's money.ts. */
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);
export const minorDigits = (currency: string): number => (ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : THREE_DECIMAL.has(currency.toUpperCase()) ? 3 : 2);

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const valid = (y: number, m: number, d: number): string | null => {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== date ? null : date;
};

/**
 * A calendar date as YYYY-MM-DD from `2027-05-01`, `2027/05/01`, `5/1/2027` (month first, as US
 * spreadsheets write it), `May 1, 2027`, `1 May 2027`, or an ISO timestamp.
 */
export function readDate(raw: string | undefined): string | null | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/.exec(v);
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) return valid(+m[3]!, +m[1]!, +m[2]!);
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(v);
  if (m) {
    const month = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase());
    return month < 0 ? null : valid(+m[3]!, month + 1, +m[2]!);
  }
  m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(v);
  if (m) {
    const month = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase());
    return month < 0 ? null : valid(+m[3]!, month + 1, +m[1]!);
  }
  return null;
}

/** A four-digit year (1900–2200), or the year of a date. */
export function readYear(raw: string | undefined): number | null | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  const m = /^(?:FY\s*)?(\d{4})$/i.exec(v);
  if (m) return +m[1]! >= 1900 && +m[1]! <= 2200 ? +m[1]! : null;
  const d = readDate(v);
  return d ? +d.slice(0, 4) : null;
}

/**
 * A non-negative amount in minor units of `currency`: `$25,000`, `25000.00`, `USD 1,200`, `€300`.
 * A negative or fractional amount the currency cannot hold is refused.
 */
export function readAmount(raw: string | undefined, currency: string): number | null | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  const clean = v.replace(/[$€£¥,\s]/g, "").replace(/^(USD|EUR|GBP|CAD|AUD|NZD|JPY|CHF|MXN)/i, "").replace(/(USD|EUR|GBP|CAD|AUD|NZD|JPY|CHF|MXN)$/i, "");
  const m = /^(\d{1,13})(?:\.(\d{1,3}))?$/.exec(clean);
  if (!m) return null;
  const digits = minorDigits(currency);
  const frac = m[2] ?? "";
  if (frac.length > digits && /[1-9]/.test(frac.slice(digits))) return null;
  const value = Number(`${m[1]}${frac.slice(0, digits).padEnd(digits, "0")}`);
  return Number.isSafeInteger(value) ? value : null;
}

/** A three-letter currency code, upper-cased. */
export function readCurrency(raw: string | undefined): string | null | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  if (v === "$") return "USD";
  if (v === "€") return "EUR";
  if (v === "£") return "GBP";
  return /^[A-Za-z]{3}$/.test(v) ? v.toUpperCase() : null;
}

/** Yes or no from yes/no, y/n, true/false, 1/0, x (a ticked box). */
export function readYesNo(raw: string | undefined): boolean | null | undefined {
  const v = raw?.trim().toLowerCase();
  if (!v) return undefined;
  if (["y", "yes", "true", "1", "x", "✓", "checked"].includes(v)) return true;
  if (["n", "no", "false", "0", "unchecked"].includes(v)) return false;
  return null;
}

/** An http(s) address. A bare domain (`example.org/grants`) is read as https. */
export function readUrl(raw: string | undefined): string | null | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  if (v.length > 2000) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : /^[\w-]+(\.[\w-]+)+(\/|$)/.test(v) ? `https://${v}` : v;
  try {
    const u = new URL(withScheme);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** One line of text: format and control characters removed, white space collapsed. */
export const cleanLine = (v: string): string =>
  v
    .replace(/\p{Cf}+/gu, "")
    .replace(/[\t\n\v\f\r\u0085\u2028\u2029]+/g, " ")
    .replace(/\p{Cc}+/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/** Free text that keeps its line breaks; otherwise as {@link cleanLine}. */
export const cleanText = (v: string): string =>
  v
    .replace(/\r\n?|[\u0085\u2028\u2029]/g, "\n")
    .replace(/\p{Cf}+/gu, "")
    .replace(/[\t\v\f]+/g, " ")
    .replace(/[^\P{Cc}\n]+/gu, "")
    .replace(/[ ]+\n/g, "\n")
    .trim();

/** Words compared for matching: lower case, letters and digits only. */
export const fold = (v: string): string =>
  v
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
