// SPDX-License-Identifier: AGPL-3.0-or-later
// Helpers shared by the analytics screens (AN-01…AN-03).
import { APPLICATION_STATUS, type ApplicationStatus } from '@gms/domain';

/** Same rule as analytics.fiscal_year(): FYs are named by the calendar year they end in. */
export function fiscalYearOf(date: Date, startMonth: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' }).formatToParts(date);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  return startMonth <= 1 ? y : y + (m >= startMonth ? 1 : 0);
}

export function fiscalYearLabel(fy: number, startMonth: number): string {
  if (startMonth <= 1) return `FY ${fy}`;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `FY ${fy} (${months[startMonth - 1]} ${fy - 1} – ${months[(startMonth + 10) % 12]} ${fy})`;
}

export function statusLabel(s: string): string {
  return APPLICATION_STATUS[s as ApplicationStatus]?.label ?? s.replace(/_/g, ' ');
}

export function monthLabel(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y!, (m ?? 1) - 1, 1)));
}

/**
 * Simple outlines of the three fictional counties the demo foundation serves (Alder, Bramble, Cinder).
 * Drawn by hand for the inline-SVG CountyMap (no map tiles). Other counties appear in the table only.
 */
export const COUNTY_VIEWBOX = '0 0 400 260';
export const COUNTY_SHAPES: { id: string; name: string; path: string }[] = [
  { id: 'alder', name: 'Alder County', path: 'M18 34 L96 22 L172 18 L184 72 L186 122 L166 164 L150 204 L92 198 L30 190 L24 118 Z' },
  { id: 'bramble', name: 'Bramble County', path: 'M172 18 L256 26 L334 36 L344 76 L340 112 L262 116 L186 122 L184 72 Z' },
  { id: 'cinder', name: 'Cinder County', path: 'M186 122 L262 116 L340 112 L356 170 L372 232 L262 240 L150 242 L150 204 L166 164 Z' },
];

export function countyKey(name: string): string {
  return name.toLowerCase().replace(/\s+county$/, '').trim();
}
