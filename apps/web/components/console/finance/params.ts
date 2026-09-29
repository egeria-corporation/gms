// SPDX-License-Identifier: AGPL-3.0-or-later
// Server-side helpers for finance pages: URL paging/filter parsing and role checks. Pure (no React).
import type { WorkspaceRole } from '@gms/domain';

export type SearchParams = Record<string, string | string[] | undefined>;

export const PAGE_SIZES = [25, 50, 100] as const;

export function str(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : undefined;
}

/** `?page=` (1-based) and `?size=`; clamps to sane values. */
export function paging(sp: SearchParams): { page: number; pageSize: number; offset: number } {
  const size = Number(str(sp, 'size') ?? 25);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(size) ? size : 25;
  const page = Math.max(1, Math.min(10_000, Math.floor(Number(str(sp, 'page') ?? 1)) || 1));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** Only values from `allowed` pass; anything else is treated as "all". */
export function oneOf<T extends string>(sp: SearchParams, key: string, allowed: readonly T[]): T | undefined {
  const v = str(sp, key);
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** Escapes LIKE wildcards in a user search term. */
export function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export const FINANCE_WRITE: readonly WorkspaceRole[] = ['owner', 'admin', 'finance'];
export const FINANCE_READ: readonly WorkspaceRole[] = ['owner', 'admin', 'finance', 'auditor'];
export const PROGRAM_WRITE: readonly WorkspaceRole[] = ['owner', 'admin', 'program_officer'];
export const PROGRAM_READ: readonly WorkspaceRole[] = ['owner', 'admin', 'program_officer', 'auditor'];
export const AWARDS_READ: readonly WorkspaceRole[] = ['owner', 'admin', 'program_officer', 'finance', 'auditor'];

export function can(role: WorkspaceRole | null, roles: readonly WorkspaceRole[]): boolean {
  return Boolean(role && roles.includes(role));
}

export function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Today's date (YYYY-MM-DD) in a timezone. */
export function todayIn(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
