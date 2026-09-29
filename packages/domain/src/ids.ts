// SPDX-License-Identifier: AGPL-3.0-or-later
/** Workspace-prefixed human reference numbers, e.g. HRF-2027-00042. */
export function workspacePrefix(name: string): string {
  const words = name.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean);
  const initials = words
    .filter((w) => !/^(the|of|and|for)$/i.test(w))
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (initials || 'GMS').slice(0, 4);
}

export function referenceNumber(prefix: string, year: number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(5, '0')}`;
}

export function slugify(input: string, max = 60): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export function formatEin(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  return d.length === 9 ? `${d.slice(0, 2)}-${d.slice(2)}` : null;
}
