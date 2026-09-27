// SPDX-License-Identifier: AGPL-3.0-only
// The seed's fixed "now" anchor and date helpers. Relative dates are computed from the anchor only,
// so a run with the same anchor (GMS_SEED_NOW) produces the same data.
import { zonedTimeToUtc } from '@gms/domain';

const DAY = 86_400_000;

/**
 * The anchor instant: `GMS_SEED_NOW` (YYYY-MM-DD → 12:00 UTC that day, or a full ISO timestamp),
 * else today's date at 12:00 UTC.
 */
export function resolveAnchor(raw: string | undefined = process.env.GMS_SEED_NOW, today: Date = new Date()): Date {
  const v = raw?.trim();
  if (v) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T12:00:00.000Z`);
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new RangeError(`GMS_SEED_NOW is not a date: ${v}`);
    return d;
  }
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 12, 0, 0));
}

export class Clock {
  constructor(readonly anchor: Date) {}

  /** Instant `days` (may be fractional/negative) from the anchor. */
  at(days: number, hours = 0): Date {
    return new Date(this.anchor.getTime() + days * DAY + hours * 3_600_000);
  }

  /** ISO timestamp `days` from the anchor. */
  iso(days: number, hours = 0): string {
    return this.at(days, hours).toISOString();
  }

  /** YYYY-MM-DD `days` from the anchor. */
  date(days: number): string {
    return this.at(days).toISOString().slice(0, 10);
  }

  /** Whole days between the anchor and an instant (positive = in the future). */
  daysUntil(when: Date | string): number {
    return Math.round((new Date(when).getTime() - this.anchor.getTime()) / DAY);
  }
}

/** Wall-clock time in a zone → ISO UTC, e.g. pt('2026-12-05T17:00') for 5 pm Pacific. */
export function zoned(local: string, tz: string): string {
  return zonedTimeToUtc(local, tz).toISOString();
}

export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY).toISOString();
}

export function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/** A uniformly spread instant between two ISO timestamps, at position f in [0, 1]. */
export function between(fromIso: string, toIso: string, f: number): string {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  return new Date(a + Math.max(0, Math.min(1, f)) * (b - a)).toISOString();
}
