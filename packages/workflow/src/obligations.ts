// SPDX-License-Identifier: AGPL-3.0-only
// The obligations of an outside award (v1.7.0): reports, expected payments, payments received and
// conditions, each with the statuses its kind can be in and the moves between them. The service
// runs every move as guard → write → ledger (changeStatus); this module is the guard. A series
// ("every N months from start until grant end") is expanded here, at most 60 instances.

export const OBLIGATION_KINDS = ["report", "payment_expected", "payment_received", "condition"] as const;
export type ObligationKind = (typeof OBLIGATION_KINDS)[number];
export const OBLIGATION_STATUSES = ["upcoming", "due", "submitted", "received", "done", "missed"] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

/** Where each kind's status may move. `submitted` is reached only by marking a report submitted. */
export const OBLIGATION_EDGES: Readonly<Record<ObligationKind, Partial<Record<ObligationStatus, readonly ObligationStatus[]>>>> = {
  report: { upcoming: ["due", "submitted", "missed"], due: ["submitted", "missed"], missed: ["submitted"], submitted: ["done", "due"], done: ["submitted"] },
  payment_expected: { upcoming: ["due", "received", "missed"], due: ["received", "missed"], missed: ["received"], received: ["due"] },
  payment_received: { received: [] },
  condition: { upcoming: ["due", "done", "missed"], due: ["done", "missed"], missed: ["done"], done: ["due"] },
};

/** An obligation in one of these counts as settled for the closeout. */
export const SETTLED_STATUSES: readonly ObligationStatus[] = ["done", "received"];
/** A series makes at most this many instances (contract). */
export const MAX_SERIES_INSTANCES = 60;

/** The first status a new obligation of this kind has. */
export const initialStatus = (kind: ObligationKind): ObligationStatus => (kind === "payment_received" ? "received" : "upcoming");

/** Null when `from → to` is allowed for this kind, else why not. */
export function obligationMoveRefusal(kind: ObligationKind, from: ObligationStatus, to: ObligationStatus): string | null {
  const allowed = OBLIGATION_EDGES[kind]?.[from] ?? [];
  if (allowed.includes(to)) return null;
  const said = (s: string) => s.replace(/_/g, " ");
  const list = allowed.map(said);
  const options = list.length > 1 ? `${list.slice(0, -1).join(", ")} or ${list.at(-1)}` : list[0];
  return allowed.length ? `This ${said(kind)} is ${said(from)}; it can become ${options}.` : `This ${said(kind)} is ${said(from)} and does not change.`;
}

const addMonths = (iso: string, months: number): string => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(d, last))).toISOString().slice(0, 10);
};

/**
 * The dates of a series: `startOn`, then every `everyMonths` months, up to and including `endOn`.
 * A day past the end of a shorter month lands on its last day (31 Jan + 1 month = 28/29 Feb), and
 * later dates keep the start's day. Throws past `max` instances, so a mistyped period is refused
 * rather than cut short.
 */
export function seriesDates(startOn: string, endOn: string, everyMonths: number, max = MAX_SERIES_INSTANCES): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endOn)) throw new RangeError("Dates are YYYY-MM-DD");
  if (!Number.isInteger(everyMonths) || everyMonths < 1) throw new RangeError("A series repeats every 1 or more months");
  if (endOn < startOn) throw new RangeError("A series ends after it starts");
  const out: string[] = [];
  for (let k = 0; ; k++) {
    const d = addMonths(startOn, k * everyMonths);
    if (d > endOn) break;
    if (out.length === max) throw new RangeError(`A series makes at most ${max} dates`);
    out.push(d);
  }
  return out;
}
