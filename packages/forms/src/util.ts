// SPDX-License-Identifier: AGPL-3.0-only
// Small helpers shared by the forms core. Not part of the public API surface beyond the types.
import { formatMoney } from '@gms/domain';

/** Response data: a flat object keyed by field id (composites are nested objects, repeaters arrays of rows). */
export type ResponseData = Record<string, unknown>;

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isPlainObject(a)) {
    if (!isPlainObject(b)) return false;
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

/** `undefined`, `null`, blank strings, empty arrays and empty objects count as "not answered". */
export function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (isPlainObject(v)) return Object.keys(v).every((k) => isEmptyValue(v[k]));
  return false;
}

/**
 * Removes unanswered values so JSON Schema `required` treats them as missing.
 * Array elements are kept in place (rows stay at the same index, so pointers stay stable).
 */
export function pruneEmpty(data: ResponseData): ResponseData {
  const out: ResponseData = {};
  for (const [k, v] of Object.entries(data)) {
    const p = pruneValue(v);
    if (p !== undefined) out[k] = p;
  }
  return out;
}

function pruneValue(v: unknown): unknown {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return v.trim() === '' ? undefined : v;
  if (Array.isArray(v)) {
    if (v.length === 0) return undefined;
    return v.map((x) => {
      if (isPlainObject(x)) return pruneEmpty(x);
      return x;
    });
  }
  if (isPlainObject(v)) {
    const o = pruneEmpty(v);
    return Object.keys(o).length ? o : undefined;
  }
  return v;
}

export function escapePointerSegment(s: string): string {
  return s.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function parsePointer(pointer: string): string[] {
  if (pointer === '' || pointer === '/') return [];
  return pointer
    .replace(/^\//, '')
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function toPointer(segments: readonly (string | number)[]): string {
  return segments.length ? '/' + segments.map((s) => escapePointerSegment(String(s))).join('/') : '';
}

export function getAtPointer(data: unknown, pointer: string): unknown {
  let cur: unknown = data;
  for (const seg of parsePointer(pointer)) {
    if (Array.isArray(cur)) cur = cur[Number(seg)];
    else if (isPlainObject(cur)) cur = cur[seg];
    else return undefined;
  }
  return cur;
}

/** Reads a dotted path such as `organization.address.city`. */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Writes a dotted path, creating objects on the way. */
export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split('.');
  let cur: Record<string, unknown> = obj;
  segs.forEach((seg, i) => {
    if (i === segs.length - 1) {
      cur[seg] = value;
      return;
    }
    const next = cur[seg];
    if (isPlainObject(next)) cur = next;
    else {
      const created: Record<string, unknown> = {};
      cur[seg] = created;
      cur = created;
    }
  });
}

export function money(cents: number, currency = 'USD'): string {
  return formatMoney(cents, currency, { compact: true });
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2027-03-15" → "March 15, 2027" (no time zone shifts). */
export function formatIsoDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

/** Joins with commas and a final "and"/"or". */
export function listJoin(items: readonly string[], word: 'and' | 'or' = 'and'): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} ${word} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, ${word} ${items[items.length - 1]}`;
}
