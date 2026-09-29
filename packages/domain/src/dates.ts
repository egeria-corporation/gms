// SPDX-License-Identifier: AGPL-3.0-or-later
// Timezone-aware deadline helpers. Deadlines are stored as timestamptz and displayed in the workspace timezone.

/** Returns the UTC offset (minutes) of `tz` at the given instant. */
function tzOffsetMinutes(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Converts a wall-clock time in `tz` (e.g. "2026-12-05T17:00") to a UTC Date. */
export function zonedTimeToUtc(local: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(local.trim());
  if (!m) throw new RangeError(`invalid local time: ${local}`);
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
  let offset = tzOffsetMinutes(tz, new Date(guess));
  let utc = guess - offset * 60000;
  const offset2 = tzOffsetMinutes(tz, new Date(utc));
  if (offset2 !== offset) {
    offset = offset2;
    utc = guess - offset * 60000;
  }
  return new Date(utc);
}

/** Formats an instant as wall-clock time in `tz`, e.g. "Dec 5, 2026, 5:00 PM PST". */
export function formatInZone(
  iso: string | Date | null | undefined,
  tz: string,
  opts: { dateOnly?: boolean; withZone?: boolean } = {},
): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(opts.dateOnly ? {} : { hour: 'numeric', minute: '2-digit' }),
    ...(opts.withZone !== false && !opts.dateOnly ? { timeZoneName: 'short' } : {}),
  }).format(d);
}

/** Formats a DATE column ("2027-02-13") without timezone shifting. */
export function formatDateOnly(date: string | null | undefined): string {
  if (!date) return '—';
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(Date.UTC(y!, m! - 1, d!)),
  );
}

export function toLocalInputValue(iso: string | null | undefined, tz: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export interface DeadlineState {
  /** Hard close (plus grace) has not passed. */
  open: boolean;
  /** Past the published deadline but inside the grace window. */
  inGrace: boolean;
  effectiveCloseAt: Date | null;
}

/** Server-side deadline rule: closes_at + grace minutes, or a per-applicant extension if later. */
export function deadlineState(
  now: Date,
  opts: { opensAt?: string | null; closesAt?: string | null; graceMinutes?: number; extensionAt?: string | null },
): DeadlineState {
  if (opts.opensAt && now < new Date(opts.opensAt)) return { open: false, inGrace: false, effectiveCloseAt: null };
  if (!opts.closesAt) return { open: true, inGrace: false, effectiveCloseAt: null };
  const close = new Date(opts.closesAt);
  const graceEnd = new Date(close.getTime() + (opts.graceMinutes ?? 0) * 60000);
  const ext = opts.extensionAt ? new Date(opts.extensionAt) : null;
  const effective = ext && ext > graceEnd ? ext : graceEnd;
  return { open: now <= effective, inGrace: now > close && now <= effective, effectiveCloseAt: effective };
}

export function relativeTime(iso: string | Date, now = new Date()): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const diff = (d.getTime() - now.getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 45) return rtf.format(Math.round(diff), 'second');
  if (abs < 2700) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 64800) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 2592000) return rtf.format(Math.round(diff / 86400), 'day');
  if (abs < 31536000) return rtf.format(Math.round(diff / 2592000), 'month');
  return rtf.format(Math.round(diff / 31536000), 'year');
}

/**
 * The date ("2027-03-05") `days` business days after the instant `from`, counted from its calendar day in `tz`.
 * Skips Saturdays and Sundays (not bank holidays), so it's an estimate.
 */
export function addBusinessDays(from: string | Date, days: number, tz: string): string {
  const d = typeof from === 'string' ? new Date(from) : from;
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const [y, m, day] = local.split('-').map(Number);
  const cur = new Date(Date.UTC(y!, m! - 1, day!));
  let left = days;
  while (left > 0) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const wd = cur.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return cur.toISOString().slice(0, 10);
}

/** Fiscal year for a date given the workspace's fiscal year start month (1-12). FY is named by its end year. */
export function fiscalYearOf(date: Date, startMonth = 1): number {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  return startMonth === 1 ? y : m >= startMonth ? y + 1 : y;
}
