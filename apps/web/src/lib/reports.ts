// SPDX-License-Identifier: AGPL-3.0-only
// The report builder's words and cell formatting, and the in-browser report engine the mock API
// runs (the same filter → group → sort → cap as apps/api/src/services/report-engine.ts, over the
// fixture rows). A definition only ever names column keys of its data set.
import type { Aggregate, Cell, ColumnInfo, DataSet, DataSetKey, Definition, Filter, OutColumn, ReportResult } from "../api/reports.ts";
import { formatDate, formatMinor } from "./format.ts";
import { intlLocale } from "../i18n/current.ts";

export const PREVIEW_ROWS = 200;
export const CSV_MAX_ROWS = 50_000;
export const MAX_COLUMNS = 30;
export const MAX_GROUP_BY = 2;

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const AGGREGATE_WORDS: Record<Aggregate["fn"], string> = { count: "Count", sum: "Total", avg: "Average" };
export const OP_WORDS: Record<Filter["op"], string> = { eq: "is", in: "is any of", between: "is between" };
export const STOPPED_WORDS: Record<string, string> = {
  owner_left: "Stopped: the person who saved this view no longer reads reports here",
  no_recipients: "Stopped: none of its recipients can read it any more",
  view_private: "Stopped: the view is private, so it goes only to its owner",
};

export const emptyDefinition = (dataSet: DataSetKey, columns: string[] = []): Definition => ({ dataSet, columns, filters: [], groupBy: [], aggregates: [], sort: [] });

export const aggregateKey = (a: Aggregate) => (a.fn === "count" ? "count" : `${a.fn}:${a.column}`);

/** How a schedule reads: "Every Monday" or "On the 1st of every month". */
export function cadenceWords(s: { cadence: "weekly" | "monthly"; weekday: number | null; dayOfMonth: number | null }): string {
  if (s.cadence === "weekly") return `Every ${WEEKDAYS[(s.weekday ?? 1) - 1]}`;
  const d = s.dayOfMonth ?? 1;
  const suffix = d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th";
  return `On the ${d}${suffix} of every month`;
}

/** `under_review` → "Under review". */
export const statusWords = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** A cell as the preview shows it. Money in the row's currency when the report shows one. */
export function displayCell(column: OutColumn, value: Cell, currency?: string | null): string {
  if (value === null || value === "") return "—";
  if (column.type === "money" && typeof value === "number") return formatMinor(value, currency && /^[A-Z]{3}$/.test(currency) ? currency : "USD");
  if (column.type === "date" && typeof value === "string") return formatDate(value);
  if (column.type === "number" && typeof value === "number") return value.toLocaleString(intlLocale());
  return String(value);
}

// ------------------------------------------------------------------------------------ engine (mock mode)

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function resolveDate(token: string, now: Date): string {
  const m = /^(today|startOfYear|endOfYear|startOfMonth|endOfMonth)([+-]\d{1,4})?d?$/.exec(token);
  if (!m) return token;
  const y = now.getUTCFullYear();
  const mo = now.getUTCMonth();
  const base = { today: Date.UTC(y, mo, now.getUTCDate()), startOfYear: Date.UTC(y, 0, 1), endOfYear: Date.UTC(y, 11, 31), startOfMonth: Date.UTC(y, mo, 1), endOfMonth: Date.UTC(y, mo + 1, 0) }[m[1] as "today"];
  return iso(base + Number(m[2] ?? 0) * DAY);
}

export class ReportProblem extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly field: string,
  ) {
    super(message);
  }
}

const numeric = (c: ColumnInfo) => c.type === "number" || c.type === "money";

/** The output columns of a definition, refusing a column the data set does not have. */
export function outColumns(ds: DataSet, d: Definition): OutColumn[] {
  const col = (k: string, field: string) => {
    const c = ds.columns.find((x) => x.key === k);
    if (!c) throw new ReportProblem("unknown_column", `“${k}” is not a column of ${ds.label.toLowerCase()}`, field);
    return c;
  };
  const toOut = (c: ColumnInfo): OutColumn => ({ key: c.key, label: c.label, type: c.type, ...(c.statusKind ? { statusKind: c.statusKind } : {}), ...(c.note ? { note: c.note } : {}) });
  d.columns.forEach((k, i) => col(k, `columns.${i}`));
  d.filters.forEach((f, i) => col(f.column, `filters.${i}.column`));
  const grouped = d.groupBy.length > 0 || d.aggregates.length > 0;
  if (!grouped) return d.columns.map((k) => toOut(col(k, "columns")));
  const aggs = d.aggregates.length ? d.aggregates : [{ fn: "count" as const }];
  return [
    ...d.groupBy.map((k, i) => toOut(col(k, `groupBy.${i}`))),
    ...aggs.map((a, i): OutColumn => {
      if (a.fn === "count") return { key: "count", label: "Count", type: "number" };
      const c = col(a.column ?? "", `aggregates.${i}.column`);
      if (!c.aggregatable) throw new ReportProblem("invalid_aggregate", `${c.label} cannot be added up or averaged`, `aggregates.${i}`);
      return { key: aggregateKey(a), label: `${AGGREGATE_WORDS[a.fn]} ${c.label.toLowerCase()}`, type: a.fn === "avg" && c.type === "number" ? "number" : c.type };
    }),
  ];
}

function keep(row: Record<string, Cell>, c: ColumnInfo, f: Filter, now: Date): boolean {
  const v = row[c.key] ?? null;
  const same = (x: string | number | null) => (x === null ? v === null : v !== null && (numeric(c) ? Number(v) === Number(x) : String(v).toLowerCase() === String(x).toLowerCase()));
  if (f.op === "eq") return same(f.value);
  if (f.op === "in") return f.values.some(same);
  if (v === null) return false;
  const at = (b: string | number) => (c.type === "date" ? resolveDate(String(b), now) : Number(b));
  if (f.from !== undefined && v < at(f.from)) return false;
  if (f.to !== undefined && v > at(f.to)) return false;
  return true;
}

export function runReport(ds: DataSet, d: Definition, rows: readonly Record<string, Cell>[], opts: { now: Date; limit: number }): ReportResult {
  const columns = outColumns(ds, d);
  const byKey = new Map(ds.columns.map((c) => [c.key, c]));
  const matched = rows.filter((r) => d.filters.every((f) => keep(r, byKey.get(f.column)!, f, opts.now)));
  const warnings: string[] = [];
  let out: Record<string, Cell>[];
  if (d.groupBy.length === 0 && d.aggregates.length === 0) out = matched.map((r) => Object.fromEntries(columns.map((c) => [c.key, r[c.key] ?? null])));
  else {
    const groups = new Map<string, Record<string, Cell>[]>();
    for (const r of matched) {
      const k = JSON.stringify(d.groupBy.map((g) => r[g] ?? null));
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    const aggs = d.aggregates.length ? d.aggregates : [{ fn: "count" as const }];
    let mixed = false;
    out = [...groups.values()].map((list) => {
      const row: Record<string, Cell> = Object.fromEntries(d.groupBy.map((g) => [g, list[0]![g] ?? null]));
      for (const a of aggs) {
        const key = aggregateKey(a);
        if (a.fn === "count") {
          row[key] = list.length;
          continue;
        }
        const c = byKey.get(a.column!)!;
        const values = list.map((r) => r[c.key]).filter((v): v is number => typeof v === "number");
        if (c.type === "money" && new Set(list.map((r) => r.currency ?? null)).size > 1) {
          mixed = true;
          row[key] = null;
          continue;
        }
        const total = values.reduce((s, v) => s + v, 0);
        row[key] = a.fn === "sum" ? total : values.length ? Math.round((total / values.length) * (c.type === "money" ? 1 : 10)) / (c.type === "money" ? 1 : 10) : null;
      }
      return row;
    });
    if (mixed) warnings.push("Some groups hold amounts in more than one currency. Those totals are left blank; group by Currency to see them.");
  }
  for (const s of d.sort) if (!columns.some((c) => c.key === s.column)) throw new ReportProblem("unknown_column", `Sort by a column shown in the report (“${s.column}” is not)`, "sort");
  const sorted = [...out].sort((x, y) => {
    for (const s of d.sort) {
      const a = x[s.column] ?? null;
      const b = y[s.column] ?? null;
      if (a === null && b === null) continue;
      if (a === null) return 1;
      if (b === null) return -1;
      const c = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
      if (c) return s.dir === "desc" ? -c : c;
    }
    return 0;
  });
  const limited = sorted.slice(0, opts.limit);
  return { dataSet: d.dataSet, columns, rows: limited.map((r) => columns.map((c) => r[c.key] ?? null)), total: sorted.length, truncated: sorted.length > limited.length, warnings, asOf: opts.now.toISOString(), limit: opts.limit };
}

/** RFC 4180 field; a leading = + - @ (or tab, carriage return) is prefixed with an apostrophe. */
export function csvCell(v: Cell): string {
  let s = v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvText(r: Pick<ReportResult, "columns" | "rows">): string {
  const value = (c: OutColumn, v: Cell): Cell => (v === null ? null : c.type === "money" && typeof v === "number" ? (v / 100).toFixed(2) : c.type === "status" ? statusWords(String(v)) : v);
  const line = (cells: string[]) => `${cells.join(",")}\r\n`;
  return line(r.columns.map((c) => csvCell(c.label))) + r.rows.map((row) => line(row.map((v, i) => csvCell(value(r.columns[i]!, v))))).join("");
}

export function csvFilename(name: string, now: Date): string {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "report";
  return `${slug}-${now.toISOString().slice(0, 10)}.csv`;
}
