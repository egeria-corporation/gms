// SPDX-License-Identifier: AGPL-3.0-or-later
// Instants (timestamptz) <-> CommonGrants events.
// CG `SingleDateEvent` carries a plain `date` + `time` with no zone, so we emit wall-clock values
// in the workspace timezone and name the zone in `description`. Reading an event back requires the
// same timezone, which the caller always knows (it is the workspace's).
import { formatInZone, zonedTimeToUtc } from '@gms/domain';
import type { CgDateRangeEvent, CgEvent, CgSingleDateEvent } from './types';

export function localParts(iso: string | Date, tz: string): { date: string; time: string } {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

/** A timestamptz as a CG singleDate event in the workspace timezone. */
export function instantEvent(name: string, iso: string, tz: string, what?: string): CgSingleDateEvent {
  const { date, time } = localParts(iso, tz);
  const when = formatInZone(iso, tz);
  return {
    name,
    eventType: 'singleDate',
    date,
    time,
    description: `${what ? `${what}: ` : ''}${when}. Times are in ${tz}.`,
  };
}

/** A DATE column as a CG singleDate event (no time). */
export function dateEvent(name: string, date: string, description?: string): CgSingleDateEvent {
  return { name, eventType: 'singleDate', date: date.slice(0, 10), ...(description ? { description } : {}) };
}

export function dateRangeEvent(name: string, start: string, end: string, description?: string): CgDateRangeEvent {
  return { name, eventType: 'dateRange', startDate: start.slice(0, 10), endDate: end.slice(0, 10), ...(description ? { description } : {}) };
}

/**
 * Reads an event back into a UTC ISO instant using the workspace timezone.
 * A date without a time resolves to `defaultTime` (start of day unless told otherwise).
 */
export function eventToInstant(ev: CgEvent | null | undefined, tz: string, defaultTime = '00:00:00'): string | null {
  if (!ev) return null;
  let date: string;
  let time: string | undefined;
  if (ev.eventType === 'singleDate') {
    date = ev.date;
    time = ev.time;
  } else if (ev.eventType === 'dateRange') {
    date = ev.startDate;
    time = ev.startTime;
  } else {
    return null;
  }
  const t = (time ?? defaultTime).replace(/(Z|[+-]\d{2}:\d{2})$/, '').replace(/\.\d+$/, '');
  return zonedTimeToUtc(`${date.slice(0, 10)}T${t}`, tz).toISOString();
}

/** Reads the date part of an event (YYYY-MM-DD). */
export function eventToDate(ev: CgEvent | null | undefined): string | null {
  if (!ev) return null;
  if (ev.eventType === 'singleDate') return ev.date.slice(0, 10);
  if (ev.eventType === 'dateRange') return ev.startDate.slice(0, 10);
  return null;
}
