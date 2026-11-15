// SPDX-License-Identifier: AGPL-3.0-only
// Anonymized review: what a reviewer in an anonymized stage reads instead of who applied. Pure
// functions over plain values; the API decides who is anonymized and supplies the terms to hide
// (the organization's names, website and email domains, EIN). Staff never pass through here.

/** What a name, website or EIN in free text is replaced with. */
export const APPLICANT_PLACEHOLDER = "[applicant]";

/** The stable short code an application shows as in an anonymized stage: "A-1001", "A-1002", ... */
export function applicantCode(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new RangeError("sequence must be a positive integer");
  return `A-${1000 + sequence}`;
}

/** How the application is named to an anonymized reviewer. */
export const anonymousName = (code: string): string => `Applicant ${code}`;

/** The neutral name an attachment shows under; the file itself stays. The extension says nothing about who applied. */
export function neutralFileName(index: number, original?: unknown): string {
  const ext = typeof original === "string" ? /\.([A-Za-z0-9]{1,8})$/.exec(original.trim())?.[1] : undefined;
  return `Attachment ${index}${ext ? `.${ext.toLowerCase()}` : ""}`;
}

export interface IdentityTerms {
  /** Names and name-like words (the organization's names, its workspace handle). */
  names: string[];
  /** Web and email domains, without `www.`. */
  domains: string[];
  /** Identifying numbers such as the EIN, digits only. */
  numbers: string[];
}

/** Shortest name (in characters, after trimming) that is redacted from free text. Shorter ones would erase ordinary words. */
export const MIN_NAME_LENGTH = 3;
/** A domain's own label ("aldercreekfs" in aldercreekfs.org) is hidden as a word when at least this long. */
export const MIN_DOMAIN_LABEL_LENGTH = 6;

const LEGAL_SUFFIX = /[\s,]+(inc\.?|incorporated|llc|l\.l\.c\.|ltd\.?|limited|corp\.?|corporation|co\.?|company|pbc|nfp)$/i;

/** The forms of a name worth hiding: as given, without a legal suffix ("Inc."), with "&" read as "and" and back. */
function nameVariants(name: string): string[] {
  const base = name.replace(/\s+/g, " ").trim();
  if (!base) return [];
  const out = new Set<string>([base]);
  const bare = base.replace(LEGAL_SUFFIX, "").trim();
  if (bare) out.add(bare);
  for (const v of [...out]) {
    if (v.includes("&")) out.add(v.replace(/\s*&\s*/g, " and "));
    if (/\band\b/i.test(v)) out.add(v.replace(/\s+and\s+/gi, " & "));
    if (/^the\s+/i.test(v)) out.add(v.replace(/^the\s+/i, ""));
  }
  return [...out].filter((v) => v.length >= MIN_NAME_LENGTH);
}

/** A website or address as its bare host: "https://www.Alder.org/about" and "alder.org" both give "alder.org". */
export function domainOf(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const at = v.lastIndexOf("@");
  const host = at >= 0 ? v.slice(at + 1) : (() => {
    try {
      return new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(v) ? v : `https://${v}`).hostname;
    } catch {
      return "";
    }
  })();
  const bare = host.replace(/^www\./, "").replace(/\.$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(bare) ? bare : null;
}

/** The terms that would say who applied, from what the GMS holds about the organization. */
export function identityTerms(input: { names?: readonly (string | null | undefined)[]; websites?: readonly (string | null | undefined)[]; emails?: readonly (string | null | undefined)[]; numbers?: readonly (string | null | undefined)[] }): IdentityTerms {
  const names = new Set<string>();
  const domains = new Set<string>();
  const numbers = new Set<string>();
  for (const n of input.names ?? []) if (typeof n === "string") for (const v of nameVariants(n)) names.add(v);
  for (const w of [...(input.websites ?? []), ...(input.emails ?? [])]) {
    const d = typeof w === "string" ? domainOf(w) : null;
    if (!d) continue;
    domains.add(d);
    const label = d.split(".").slice(-2, -1)[0] ?? "";
    if (label.length >= MIN_DOMAIN_LABEL_LENGTH) names.add(label);
  }
  for (const n of input.numbers ?? []) {
    const digits = typeof n === "string" ? n.replace(/\D/g, "") : "";
    if (digits.length >= 6) numbers.add(digits);
  }
  // Longest first, so "Alder Creek Family Services" is replaced before "Alder Creek".
  const byLength = (a: string, b: string) => b.length - a.length || a.localeCompare(b);
  return { names: [...names].sort(byLength), domains: [...domains].sort(byLength), numbers: [...numbers].sort(byLength) };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NOT_WORD_BEFORE = "(?<![\\p{L}\\p{N}_])";
const NOT_WORD_AFTER = "(?![\\p{L}\\p{N}_])";
/** No part of a longer host or address just before ("notalder.org" is not alder.org). */
const NOT_HOST_BEFORE = "(?<![\\p{L}\\p{N}_.@-])";

/** One pattern for every term, compiled once per set of terms. */
function patternOf(terms: IdentityTerms): RegExp | null {
  const parts: string[] = [];
  for (const d of terms.domains) {
    const host = `(?:[a-z0-9-]+\\.)*${escape(d)}`;
    // An email at the domain, or the domain with any scheme, subdomain and path.
    parts.push(`[\\p{L}\\p{N}._%+-]+@${host}${NOT_WORD_AFTER}`);
    parts.push(`${NOT_HOST_BEFORE}(?:https?:\\/\\/)?${host}(?:\\/[^\\s)\\]"'<>]*)?${NOT_WORD_AFTER}`);
  }
  for (const n of terms.names) parts.push(`${NOT_WORD_BEFORE}${n.split(" ").map(escape).join("[\\s\\u00a0]+")}${NOT_WORD_AFTER}`);
  // An EIN as written, with or without its dash.
  for (const n of terms.numbers) parts.push(`(?<!\\d)${n.length === 9 ? `${n.slice(0, 2)}-?${n.slice(2)}` : escape(n)}(?!\\d)`);
  return parts.length ? new RegExp(parts.join("|"), "giu") : null;
}

const compiled = new WeakMap<IdentityTerms, RegExp | null>();
const patternFor = (terms: IdentityTerms) => {
  if (!compiled.has(terms)) compiled.set(terms, patternOf(terms));
  return compiled.get(terms)!;
};

/** Free text with every name, website, email address and EIN of the organization replaced by "[applicant]". */
export function redactText(text: string, terms: IdentityTerms): string {
  const re = patternFor(terms);
  return re ? text.replace(re, APPLICANT_PLACEHOLDER) : text;
}

/** True when the text names the organization in a way `redactText` would hide. */
export function mentionsApplicant(text: string, terms: IdentityTerms): boolean {
  const re = patternFor(terms);
  if (!re) return false;
  re.lastIndex = 0;
  const hit = re.test(text);
  re.lastIndex = 0;
  return hit;
}

const FILE_NAME_KEYS = ["name", "fileName", "filename", "title", "originalName"];
const isFileRef = (v: Record<string, unknown>) => typeof v.documentId === "string" || typeof v.passportDocumentId === "string";

/**
 * Any value with every string redacted and every file reference renamed ("Attachment 1.pdf"). The
 * reference itself (`documentId`, `passportDocumentId`) is kept: the file stays, under a neutral name.
 */
export function redactValue(value: unknown, terms: IdentityTerms, files: { count: number } = { count: 0 }): unknown {
  if (typeof value === "string") return redactText(value, terms);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, terms, files));
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const fileRef = isFileRef(obj);
    const out: Record<string, unknown> = {};
    const index = fileRef ? ++files.count : 0;
    for (const [k, v] of Object.entries(obj)) {
      if (fileRef && FILE_NAME_KEYS.includes(k)) out[k] = neutralFileName(index, v);
      else if (fileRef && (k === "documentId" || k === "passportDocumentId")) out[k] = v;
      else out[k] = redactValue(v, terms, files);
    }
    return out;
  }
  return value;
}

const unescapePointer = (s: string) => s.replace(/~1/g, "/").replace(/~0/g, "~");

/** Remove the value at a JSON pointer; true when something was there. */
function removeAt(obj: Record<string, unknown>, pointer: string): boolean {
  const segs = pointer.split("/").slice(1).map(unescapePointer);
  if (!segs.length) return false;
  let cur: unknown = obj;
  for (const s of segs.slice(0, -1)) {
    if (!cur || typeof cur !== "object") return false;
    cur = (cur as Record<string, unknown>)[s];
  }
  const last = segs[segs.length - 1]!;
  if (!cur || typeof cur !== "object" || !(last in (cur as object))) return false;
  if (Array.isArray(cur)) cur.splice(Number(last), 1);
  else delete (cur as Record<string, unknown>)[last];
  return true;
}

export interface AnonymizedResponse {
  response: Record<string, unknown>;
  /** JSON pointers of the identifying fields that were removed. */
  hidden: string[];
}

/**
 * A form response as a reviewer in an anonymized stage reads it: identifying fields removed, every
 * remaining answer with the organization's names, website and EIN replaced by "[applicant]", and
 * attachments under neutral names. The input is not modified.
 */
export function anonymizeResponse(response: Record<string, unknown>, opts: { identifying: readonly string[]; terms: IdentityTerms }): AnonymizedResponse {
  const out = structuredClone(response);
  const hidden: string[] = [];
  // Deepest first, so removing a parent never hides that a child was there.
  for (const p of [...opts.identifying].sort((a, b) => b.length - a.length)) if (removeAt(out, p)) hidden.push(p);
  return { response: redactValue(out, opts.terms) as Record<string, unknown>, hidden: hidden.sort() };
}
