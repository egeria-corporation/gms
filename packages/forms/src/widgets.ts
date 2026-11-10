// SPDX-License-Identifier: AGPL-3.0-only
// Custom widgets (§10.2): value shapes and validation. One implementation, used by the built-in
// interpreter (`validate.ts`, runs on Workers) and by the Ajv keywords (`ajv.ts`, Node tooling).
import { getPath, isPlainObject } from "./pointer.ts";
import type { Json, WidgetName, WidgetOptions } from "./types.ts";

export interface WidgetIssue {
  /** Pointer relative to the widget value ("" = the value itself). */
  path: string;
  message: string;
  type: string;
}

/** CommonGrants `Money`: decimal string amount + ISO 4217 currency. */
export interface Money {
  amount: string;
  currency: string;
}
export interface BudgetRow {
  category: string;
  label?: string;
  amount: Money;
  notes?: string;
}

const DECIMAL = /^-?\d+(\.\d+)?$/;
const CURRENCY = /^[A-Z]{3}$/;

export function isMoney(v: unknown): v is Money {
  return (
    isPlainObject(v) &&
    typeof v.amount === "string" &&
    DECIMAL.test(v.amount) &&
    typeof v.currency === "string" &&
    CURRENCY.test(v.currency)
  );
}

/** Decimal string → integer minor units (two decimal places; extra precision is rounded). */
export function toMinor(amount: string): number {
  const neg = amount.startsWith("-");
  const [whole = "0", frac = ""] = amount.replace(/^-/, "").split(".");
  const cents = Number(whole) * 100 + Math.round(Number("0." + (frac || "0")) * 100);
  return neg ? -cents : cents;
}

export function fromMinor(minor: number): string {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  return `${neg ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export interface BudgetTotals {
  totalMinor: number;
  total: Money | null;
  byCategory: Record<string, number>;
}

/** Totals for a budget table; rows that are not well-formed are skipped. */
export function computeBudgetTotals(rows: unknown): BudgetTotals {
  const byCategory: Record<string, number> = {};
  let totalMinor = 0;
  let currency: string | null = null;
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (!isPlainObject(row) || typeof row.category !== "string" || !isMoney(row.amount)) continue;
      const minor = toMinor(row.amount.amount);
      currency ??= row.amount.currency;
      totalMinor += minor;
      byCategory[row.category] = (byCategory[row.category] ?? 0) + minor;
    }
  }
  return { totalMinor, total: currency ? { amount: fromMinor(totalMinor), currency } : null, byCategory };
}

// ---- rich text ----
const ALLOWED_TAGS = new Set(["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a", "h3", "h4", "blockquote"]);
const VOID_TAGS = new Set(["br"]);
const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

const escapeText = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface SanitizeResult {
  html: string;
  /** What was dropped, e.g. "tag:script", "attr:onclick", "href". Empty when the input was clean. */
  removed: string[];
}

/**
 * Sanitizes rich text to the allowed subset: p br strong b em i u ul ol li a[href] h3 h4 blockquote.
 * Everything else is dropped (script/style with their content); `href` must be http(s) or mailto.
 */
export function sanitizeRichText(input: string): SanitizeResult {
  const removed: string[] = [];
  let src = input.replace(/<!--[\s\S]*?(-->|$)/g, () => {
    removed.push("comment");
    return "";
  });
  src = src.replace(/<(script|style|iframe|object|embed)\b[\s\S]*?(<\/\1\s*>|$)/gi, (_m, tag: string) => {
    removed.push(`tag:${tag.toLowerCase()}`);
    return "";
  });
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  let out = "";
  let last = 0;
  for (let m = tagRe.exec(src); m; m = tagRe.exec(src)) {
    out += escapeText(src.slice(last, m.index));
    last = m.index + m[0].length;
    const closing = m[1] === "/";
    const tag = (m[2] as string).toLowerCase();
    const attrs = m[3] ?? "";
    if (!ALLOWED_TAGS.has(tag)) {
      removed.push(`tag:${tag}`);
      continue;
    }
    if (closing) {
      if (!VOID_TAGS.has(tag)) out += `</${tag}>`;
      continue;
    }
    let href: string | null = null;
    const attrRe = /([a-zA-Z_:][\w:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    for (let a = attrRe.exec(attrs); a; a = attrRe.exec(attrs)) {
      const name = (a[1] as string).toLowerCase();
      if (name === "/") continue;
      const value = a[2] ?? a[3] ?? a[4] ?? "";
      if (tag === "a" && name === "href") {
        if (SAFE_HREF.test(value.trim())) href = value.trim();
        else removed.push("href");
      } else removed.push(`attr:${name}`);
    }
    out += tag === "a" && href !== null ? `<a href="${escapeAttr(href)}" rel="noopener noreferrer">` : `<${tag}>`;
  }
  out += escapeText(src.slice(last));
  return { html: out, removed };
}

export function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, "x");
}

export function countWords(text: string): number {
  const t = stripTags(text).trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}

export function checkWordCount(value: string, limits: { min?: number; max?: number }): WidgetIssue | null {
  const n = countWords(value);
  if (limits.max !== undefined && n > limits.max) {
    return { path: "", message: `must be at most ${limits.max} words (currently ${n})`, type: "wordCount" };
  }
  if (limits.min !== undefined && n < limits.min) {
    return { path: "", message: `must be at least ${limits.min} words (currently ${n})`, type: "wordCount" };
  }
  return null;
}

export const PHONE = /^\+?[0-9(][0-9 ().-]{5,22}[0-9]$/;
export function isPhone(v: string): boolean {
  return PHONE.test(v) && v.replace(/\D/g, "").length >= 7 && v.replace(/\D/g, "").length <= 15;
}

const issue = (path: string, message: string, type = "widget"): WidgetIssue => ({ path, message, type });
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function moneyIssues(value: unknown, opts: WidgetOptions, path = ""): WidgetIssue[] {
  if (!isPlainObject(value)) return [issue(path, "must be a money object with amount and currency", "money")];
  const out: WidgetIssue[] = [];
  if (typeof value.amount !== "string" || !DECIMAL.test(value.amount)) {
    out.push(issue(`${path}/amount`, "must be a decimal string such as \"25000.00\"", "money"));
  } else if (toMinor(value.amount) < 0) {
    out.push(issue(`${path}/amount`, "must not be negative", "money"));
  }
  if (typeof value.currency !== "string" || !CURRENCY.test(value.currency)) {
    out.push(issue(`${path}/currency`, "must be a three-letter ISO 4217 code", "money"));
  } else if (opts.currency && value.currency !== opts.currency) {
    out.push(issue(`${path}/currency`, `must be ${opts.currency}`, "money"));
  }
  return out;
}

function budgetIssues(value: unknown, opts: WidgetOptions, root: unknown): WidgetIssue[] {
  if (!Array.isArray(value)) return [issue("", "must be a list of budget rows", "budgetTable")];
  const out: WidgetIssue[] = [];
  let currency: string | null = opts.currency ?? null;
  value.forEach((row, i) => {
    if (!isPlainObject(row)) {
      out.push(issue(`/${i}`, "must be a budget row", "budgetTable"));
      return;
    }
    if (!nonEmpty(row.category)) out.push(issue(`/${i}/category`, "is required", "budgetTable"));
    else if (opts.categories && !opts.categories.includes(row.category)) {
      out.push(issue(`/${i}/category`, `must be one of: ${opts.categories.join(", ")}`, "budgetTable"));
    }
    const m = moneyIssues(row.amount, {}, `/${i}/amount`);
    out.push(...m);
    if (m.length === 0 && isMoney(row.amount)) {
      currency ??= row.amount.currency;
      if (row.amount.currency !== currency) {
        out.push(issue(`/${i}/amount/currency`, `must be ${currency}`, "budgetTable"));
      }
    }
    if (row.notes !== undefined && typeof row.notes !== "string") out.push(issue(`/${i}/notes`, "must be text", "budgetTable"));
    if (row.label !== undefined && typeof row.label !== "string") out.push(issue(`/${i}/label`, "must be text", "budgetTable"));
  });
  if (out.length > 0) return out;
  let max: number | null = null;
  if (opts.maxTotal !== undefined && DECIMAL.test(opts.maxTotal)) max = toMinor(opts.maxTotal);
  if (opts.maxTotalPath !== undefined) {
    const ref = getPath(root, opts.maxTotalPath);
    const refAmount = isMoney(ref) ? ref.amount : typeof ref === "number" ? String(ref) : ref;
    if (typeof refAmount === "string" && DECIMAL.test(refAmount)) {
      const m = toMinor(refAmount);
      max = max === null ? m : Math.min(max, m);
    }
  }
  const { totalMinor } = computeBudgetTotals(value);
  if (max !== null && totalMinor > max) {
    out.push(
      issue("", `budget total ${fromMinor(totalMinor)} exceeds the requested amount ${fromMinor(max)}`, "budgetTotal"),
    );
  }
  return out;
}

/** Validates a widget value. `root` is the whole response (budget tables compare against it). */
export function validateWidget(widget: WidgetName, value: Json, opts: WidgetOptions = {}, root: unknown = undefined): WidgetIssue[] {
  switch (widget) {
    case "money":
      return moneyIssues(value, opts);
    case "budgetTable":
      return budgetIssues(value, opts, root);
    case "fileRef": {
      if (!isPlainObject(value)) return [issue("", "must be a file reference", "fileRef")];
      const hasDoc = nonEmpty(value.documentId);
      const hasLocker = nonEmpty(value.passportDocumentId);
      if (hasDoc === hasLocker) {
        return [issue("", "must reference exactly one of documentId or passportDocumentId", "fileRef")];
      }
      return [];
    }
    case "richText": {
      if (typeof value !== "string") return [issue("", "must be rich text", "richText")];
      const { removed } = sanitizeRichText(value);
      return removed.length ? [issue("", `contains content that is not allowed (${[...new Set(removed)].join(", ")})`, "richText")] : [];
    }
    case "signature": {
      if (!isPlainObject(value)) return [issue("", "must be a signature", "signature")];
      const out: WidgetIssue[] = [];
      if (!nonEmpty(value.name)) out.push(issue("/name", "type your full legal name", "signature"));
      if (value.attested !== true) out.push(issue("/attested", "the attestation box must be checked", "signature"));
      return out;
    }
    case "address": {
      if (!isPlainObject(value)) return [issue("", "must be an address", "address")];
      const out: WidgetIssue[] = [];
      for (const k of ["line1", "city", "country"] as const) {
        if (!nonEmpty(value[k])) out.push(issue(`/${k}`, "is required", "address"));
      }
      for (const k of ["line2", "region", "postalCode"] as const) {
        if (value[k] !== undefined && value[k] !== null && typeof value[k] !== "string") out.push(issue(`/${k}`, "must be text", "address"));
      }
      return out;
    }
    case "phone":
      return typeof value === "string" && isPhone(value) ? [] : [issue("", "must be a phone number", "phone")];
    case "passportField":
      return [];
  }
}
