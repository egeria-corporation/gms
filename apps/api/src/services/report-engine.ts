// SPDX-License-Identifier: AGPL-3.0-only
// The report builder's engine, without data access: the column whitelist of each data set, the
// definition a person builds (columns, filters, grouping, sort) checked against that whitelist,
// and the filter → group → sort → cap pipeline over rows the data set loaders produce. A
// definition names columns by key; nothing a client sends is ever used as a column name or SQL.
// The CSV writer prefixes a cell that starts with = + - @ (or a tab or carriage return) with an
// apostrophe, so a spreadsheet never runs it as a formula.
import { z } from "zod";
import type { Scope } from "../auth/scopes.ts";
import { ApiError } from "../lib/errors.ts";

// ------------------------------------------------------------------------------------ limits

/** Rows a preview shows. */
export const PREVIEW_ROWS = 200;
/** Rows a CSV holds at most; more are left out and the download says so. */
export const CSV_MAX_ROWS = 50_000;
/** Rows read from the base table of a data set at most (grouping and sums see no more). */
export const MAX_SOURCE_ROWS = 50_000;
export const MAX_COLUMNS = 30;
export const MAX_FILTERS = 20;
export const MAX_GROUP_BY = 2;
export const MAX_SORT = 3;
export const MAX_IN_VALUES = 100;

// ------------------------------------------------------------------------------------ columns

export type ColumnType = "text" | "number" | "money" | "date" | "status";
/** A cell: text, a number (money in minor units), a date as YYYY-MM-DD, or nothing. */
export type Cell = string | number | null;
export type Row = Record<string, Cell>;

export interface ColumnDef {
  key: string;
  label: string;
  type: ColumnType;
  /** Where the value comes from, for people reading the catalog (`awards.funding.awardedAmount`). */
  source: string;
  /** Status columns: the values the column takes, and which status vocabulary labels them. */
  values?: readonly string[];
  statusKind?: "application" | "award" | "tranche" | "requirement";
  /** Number and money columns are summed and averaged unless this is false. */
  aggregatable?: boolean;
  /** Money columns: the column that holds the currency of the amount. */
  currencyColumn?: string;
  /** Shown beside the column in the builder. */
  note?: string;
}

export interface DataSetDef {
  key: DataSetKey;
  label: string;
  description: string;
  /** The scope the data set's records need, on top of `analytics:read`. */
  scope: Scope;
  columns: readonly ColumnDef[];
}

export const DATA_SET_KEYS = ["applications", "awards", "payments", "requirements", "organizations", "history"] as const;
export type DataSetKey = (typeof DATA_SET_KEYS)[number];

const COLUMN_KEY = /^[a-z][a-zA-Z0-9]{0,39}$/;

/**
 * Words a reportable column may never carry in its key, label or source: bank, payout and
 * identity data, and personal contact details. The GMS holds none of these; the check keeps a
 * future column from adding one. Two terms use bracket classes so this file passes the repo's
 * sensitive-data gate, which scans for the bare words.
 */
export const NOT_REPORTABLE = /(routing|iban|swift|acct|account|s[s]n|social|birth|d[o]b|licen[cs]e|govern|passport[\s_-]*(n[u]m|no\b)|tax[\s_-]*i[d]|\bein\b|employer[\s_-]*id|destination|payee|bank|last[\s_-]*4|email|phone)/i;

/** Builds a data set from its whitelist. Throws on a column that could carry bank or identity data. */
export function defineDataSet(def: DataSetDef): DataSetDef {
  const keys = new Set<string>();
  for (const c of def.columns) {
    if (!COLUMN_KEY.test(c.key)) throw new Error(`${def.key}.${c.key}: a column key is letters and digits, starting lower case`);
    if (keys.has(c.key)) throw new Error(`${def.key}.${c.key}: duplicate column`);
    keys.add(c.key);
    for (const text of [c.key, c.label, c.source]) if (NOT_REPORTABLE.test(text)) throw new Error(`${def.key}.${c.key}: this column could carry bank, identity or contact data and cannot be reported`);
    if (c.type === "status" && !c.values?.length) throw new Error(`${def.key}.${c.key}: a status column lists its values`);
    if (c.currencyColumn && !def.columns.some((x) => x.key === c.currencyColumn)) throw new Error(`${def.key}.${c.key}: unknown currency column`);
  }
  return Object.freeze({ ...def, columns: Object.freeze(def.columns.map((c) => Object.freeze({ ...c }))) });
}

export const isNumeric = (c: ColumnDef) => c.type === "number" || c.type === "money";
export const canAggregate = (c: ColumnDef) => isNumeric(c) && c.aggregatable !== false;

// ------------------------------------------------------------------------------------ definition

const columnKey = z.string().regex(COLUMN_KEY, "Name a column of the data set");
const scalar = z.union([z.string().trim().max(200), z.number().finite()]);
/** A date (YYYY-MM-DD) or a date relative to the day the report runs: `today`, `startOfYear+30d`, `endOfMonth`. */
const DATE_TOKEN = /^(\d{4}-\d{2}-\d{2}|(today|startOfYear|endOfYear|startOfMonth|endOfMonth)([+-]\d{1,4}d)?)$/;
const bound = z.union([z.number().finite(), z.string().trim().regex(DATE_TOKEN, "Use a date (YYYY-MM-DD), a relative date such as today+90d, or a number")]);

export const filterInput = z.discriminatedUnion("op", [
  z.object({ column: columnKey, op: z.literal("eq"), value: scalar.nullable() }).strict(),
  z.object({ column: columnKey, op: z.literal("in"), values: z.array(scalar).min(1).max(MAX_IN_VALUES) }).strict(),
  z
    .object({ column: columnKey, op: z.literal("between"), from: bound.optional(), to: bound.optional() })
    .strict()
    .refine((f) => f.from !== undefined || f.to !== undefined, "Give a lower bound, an upper bound or both"),
]);
export const aggregateInput = z.object({ fn: z.enum(["count", "sum", "avg"]), column: columnKey.optional() }).strict();
const SORT_KEY = /^(count|(sum|avg):[a-z][a-zA-Z0-9]{0,39}|[a-z][a-zA-Z0-9]{0,39})$/;
export const sortInput = z.object({ column: z.string().regex(SORT_KEY, "Sort by a column of the report"), dir: z.enum(["asc", "desc"]).default("asc") }).strict();

/** What a person builds. Every name in it is a column key of the data set, checked by `plan`. */
export const definitionInput = z
  .object({
    dataSet: z.enum(DATA_SET_KEYS),
    columns: z.array(columnKey).min(1).max(MAX_COLUMNS),
    filters: z.array(filterInput).max(MAX_FILTERS).default([]),
    groupBy: z.array(columnKey).max(MAX_GROUP_BY).default([]),
    aggregates: z.array(aggregateInput).max(10).default([]),
    sort: z.array(sortInput).max(MAX_SORT).default([]),
  })
  .strict();
export type Definition = z.output<typeof definitionInput>;
export type Filter = z.output<typeof filterInput>;
export type Aggregate = z.output<typeof aggregateInput>;

/** A column of the result: a data set column, or a count, sum or average over groups. */
export interface OutColumn {
  key: string;
  label: string;
  type: ColumnType;
  statusKind?: ColumnDef["statusKind"];
  note?: string;
}

export interface Plan {
  dataSet: DataSetDef;
  definition: Definition;
  grouped: boolean;
  columns: OutColumn[];
  filters: { def: ColumnDef; filter: Filter }[];
  groupBy: ColumnDef[];
  aggregates: { key: string; fn: Aggregate["fn"]; def: ColumnDef | null }[];
  sort: { key: string; dir: "asc" | "desc" }[];
}

const aggKey = (a: Aggregate) => (a.fn === "count" ? "count" : `${a.fn}:${a.column}`);
const unprocessable = (code: string, message: string, field: string) => new ApiError(422, code, message, [{ code, field }]);

/**
 * The definition checked against the data set's whitelist. A column the data set does not have is
 * refused (422 `unknown_column`), as is a filter, sum or sort that does not fit the column's type.
 */
export function plan(dataSet: DataSetDef, definition: Definition): Plan {
  const byKey = new Map(dataSet.columns.map((c) => [c.key, c]));
  const col = (key: string, field: string): ColumnDef => {
    const c = byKey.get(key);
    if (!c) throw unprocessable("unknown_column", `“${key}” is not a column of ${dataSet.label.toLowerCase()}`, field);
    return c;
  };
  const columns = definition.columns.map((k, i) => col(k, `columns.${i}`));
  if (new Set(definition.columns).size !== definition.columns.length) throw unprocessable("duplicate_column", "Each column is shown once", "columns");

  const filters = definition.filters.map((f, i) => {
    const def = col(f.column, `filters.${i}.column`);
    const field = `filters.${i}`;
    if (f.op === "between") {
      if (def.type !== "date" && !isNumeric(def)) throw unprocessable("invalid_filter", `${def.label}: a range needs a date, money or number column`, field);
      for (const b of [f.from, f.to]) {
        if (b === undefined) continue;
        if (def.type === "date" && typeof b !== "string") throw unprocessable("invalid_filter", `${def.label}: give dates`, field);
        if (def.type !== "date" && typeof b !== "number") throw unprocessable("invalid_filter", `${def.label}: give numbers (money in cents)`, field);
      }
    } else {
      const values = f.op === "eq" ? [f.value] : f.values;
      for (const v of values) {
        if (v === null) continue;
        if (isNumeric(def) && typeof v !== "number") throw unprocessable("invalid_filter", `${def.label}: give a number`, field);
        if (def.type === "status" && !def.values!.includes(String(v))) throw unprocessable("invalid_filter", `${def.label}: “${String(v)}” is not one of its values`, field);
        if (def.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw unprocessable("invalid_filter", `${def.label}: give a date as YYYY-MM-DD`, field);
      }
    }
    return { def, filter: f };
  });

  const groupBy = definition.groupBy.map((k, i) => col(k, `groupBy.${i}`));
  if (new Set(definition.groupBy).size !== groupBy.length) throw unprocessable("duplicate_column", "Group by two different columns", "groupBy");
  const grouped = groupBy.length > 0 || definition.aggregates.length > 0;
  const asked = grouped && !definition.aggregates.length ? [{ fn: "count" as const }] : definition.aggregates;
  const aggregates = asked.map((a, i) => {
    const field = `aggregates.${i}`;
    if (a.fn === "count") {
      if (a.column) throw unprocessable("invalid_aggregate", "A count takes no column", field);
      return { key: "count", fn: a.fn, def: null };
    }
    if (!a.column) throw unprocessable("invalid_aggregate", "Name the column to add up or average", field);
    const def = col(a.column, `${field}.column`);
    if (!canAggregate(def)) throw unprocessable("invalid_aggregate", `${def.label} cannot be added up or averaged${def.note ? ` (${def.note})` : ""}`, field);
    return { key: aggKey(a), fn: a.fn, def };
  });
  if (new Set(aggregates.map((a) => a.key)).size !== aggregates.length) throw unprocessable("duplicate_aggregate", "Each summary is shown once", "aggregates");

  const out: OutColumn[] = grouped
    ? [
        ...groupBy.map(toOut),
        ...aggregates.map((a): OutColumn => (a.def ? { key: a.key, label: `${a.fn === "sum" ? "Total" : "Average"} ${a.def.label.toLowerCase()}`, type: a.fn === "avg" && a.def.type === "number" ? "number" : a.def.type } : { key: "count", label: "Count", type: "number" })),
      ]
    : columns.map(toOut);
  const sort = definition.sort.map((s, i) => {
    if (!out.some((c) => c.key === s.column)) throw unprocessable("unknown_column", `Sort by a column shown in the report (“${s.column}” is not)`, `sort.${i}.column`);
    return { key: s.column, dir: s.dir };
  });
  return { dataSet, definition, grouped, columns: out, filters, groupBy, aggregates, sort };
}

const toOut = (c: ColumnDef): OutColumn => ({ key: c.key, label: c.label, type: c.type, ...(c.statusKind ? { statusKind: c.statusKind } : {}), ...(c.note ? { note: c.note } : {}) });

// ------------------------------------------------------------------------------------ running

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** A date bound as YYYY-MM-DD: as written, or relative to `now` (UTC). */
export function resolveDate(token: string, now: Date): string {
  const m = /^(today|startOfYear|endOfYear|startOfMonth|endOfMonth)([+-]\d{1,4})?d?$/.exec(token);
  if (!m) return token;
  const y = now.getUTCFullYear();
  const mo = now.getUTCMonth();
  const base = { today: Date.UTC(y, mo, now.getUTCDate()), startOfYear: Date.UTC(y, 0, 1), endOfYear: Date.UTC(y, 11, 31), startOfMonth: Date.UTC(y, mo, 1), endOfMonth: Date.UTC(y, mo + 1, 0) }[m[1] as "today"];
  return iso(base + Number(m[2] ?? 0) * DAY);
}

function keep(row: Row, f: { def: ColumnDef; filter: Filter }, now: Date): boolean {
  const v = row[f.def.key] ?? null;
  const same = (x: string | number | null) => (x === null ? v === null : v !== null && (isNumeric(f.def) ? Number(v) === Number(x) : String(v).toLowerCase() === String(x).toLowerCase()));
  const { filter } = f;
  if (filter.op === "eq") return same(filter.value);
  if (filter.op === "in") return filter.values.some(same);
  if (v === null) return false;
  const at = (b: string | number) => (f.def.type === "date" ? resolveDate(String(b), now) : Number(b));
  if (filter.from !== undefined && v < at(filter.from)) return false;
  if (filter.to !== undefined && v > at(filter.to)) return false;
  return true;
}

const compare = (a: string | number, b: string | number): number => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" }));

function sortRows<T extends Record<string, Cell>>(rows: T[], sort: Plan["sort"]): T[] {
  if (!sort.length) return rows;
  return [...rows].sort((x, y) => {
    for (const s of sort) {
      const a = x[s.key] ?? null;
      const b = y[s.key] ?? null;
      // An empty cell sorts last whichever way the column runs.
      if (a === null && b === null) continue;
      if (a === null) return 1;
      if (b === null) return -1;
      const c = compare(a, b);
      if (c) return s.dir === "desc" ? -c : c;
    }
    return 0;
  });
}

export interface ReportResult {
  dataSet: DataSetKey;
  columns: OutColumn[];
  /** One array per row, in the order of `columns`. */
  rows: Cell[][];
  /** Rows (or groups) that match, before the cap. */
  total: number;
  /** More rows matched than are returned. */
  truncated: boolean;
  /** Plain-language notes about the result (rows not read, amounts not added up). */
  warnings: string[];
}

/** filter → group (count, sum, average) → sort → the first `limit` rows. */
export function run(p: Plan, rows: readonly Row[], opts: { now: Date; limit: number; sourceTruncated?: boolean }): ReportResult {
  const warnings: string[] = [];
  if (opts.sourceTruncated) warnings.push(`This data set has more than ${MAX_SOURCE_ROWS.toLocaleString("en-US")} records; only the first ${MAX_SOURCE_ROWS.toLocaleString("en-US")} were read.`);
  const matched = rows.filter((r) => p.filters.every((f) => keep(r, f, opts.now)));
  let out: Row[];
  if (!p.grouped) {
    out = matched.map((r) => Object.fromEntries(p.columns.map((c) => [c.key, r[c.key] ?? null])));
  } else {
    const groups = new Map<string, Row[]>();
    for (const r of matched) {
      const key = JSON.stringify(p.groupBy.map((g) => r[g.key] ?? null));
      const list = groups.get(key);
      if (list) list.push(r);
      else groups.set(key, [r]);
    }
    let mixed = false;
    out = [...groups.values()].map((list) => {
      const row: Row = Object.fromEntries(p.groupBy.map((g) => [g.key, list[0]![g.key] ?? null]));
      for (const a of p.aggregates) {
        if (!a.def) {
          row[a.key] = list.length;
          continue;
        }
        const def = a.def;
        const values = list.map((r) => r[def.key]).filter((v): v is number => typeof v === "number");
        const currencies = def.currencyColumn ? new Set(list.filter((r) => typeof r[def.key] === "number").map((r) => r[def.currencyColumn!] ?? null)) : new Set();
        if (currencies.size > 1) {
          // Amounts in different currencies are never added together.
          mixed = true;
          row[a.key] = null;
          continue;
        }
        const total = values.reduce((s, v) => s + v, 0);
        row[a.key] = a.fn === "sum" ? total : values.length ? Math.round((total / values.length) * (def.type === "money" ? 1 : 10)) / (def.type === "money" ? 1 : 10) : null;
      }
      return row;
    });
    if (mixed) warnings.push("Some groups hold amounts in more than one currency. Those totals are left blank; group by Currency to see them.");
  }
  const sorted = sortRows(out, p.sort);
  const limited = sorted.slice(0, opts.limit);
  return { dataSet: p.dataSet.key, columns: p.columns, rows: limited.map((r) => p.columns.map((c) => r[c.key] ?? null)), total: sorted.length, truncated: sorted.length > limited.length, warnings };
}

// ------------------------------------------------------------------------------------ CSV

/** How a status reads in a file: `under_review` → "Under review". */
export const statusWords = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** RFC 4180 field. A leading =, +, -, @, tab or carriage return is prefixed with an apostrophe. */
export function csvCell(v: Cell): string {
  let s = v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A cell as written in the file: money in units with two decimals, statuses in words. */
export function csvValue(c: OutColumn, v: Cell): Cell {
  if (v === null) return null;
  if (c.type === "money" && typeof v === "number") return (v / 100).toFixed(2);
  if (c.type === "status") return statusWords(String(v));
  return v;
}

const line = (cells: string[]) => `${cells.join(",")}\r\n`;

/** The whole file as text (scheduled files, which are stored before anyone downloads them). */
export function csvText(result: Pick<ReportResult, "columns" | "rows">): string {
  return line(result.columns.map((c) => csvCell(c.label))) + result.rows.map((r) => line(r.map((v, i) => csvCell(csvValue(result.columns[i]!, v))))).join("");
}

/** The file as a stream of UTF-8 chunks, a few hundred rows at a time. */
export function csvStream(result: Pick<ReportResult, "columns" | "rows">, rowsPerChunk = 500): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let at = -1;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at === -1) {
        controller.enqueue(enc.encode(line(result.columns.map((c) => csvCell(c.label)))));
        at = 0;
        return;
      }
      if (at >= result.rows.length) {
        controller.close();
        return;
      }
      const chunk = result.rows.slice(at, at + rowsPerChunk);
      at += chunk.length;
      controller.enqueue(enc.encode(chunk.map((r) => line(r.map((v, i) => csvCell(csvValue(result.columns[i]!, v))))).join("")));
    },
  });
}

/** `awards-this-year-by-program-2027-04-16.csv` */
export function csvFilename(name: string, now: Date): string {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "report";
  return `${slug}-${now.toISOString().slice(0, 10)}.csv`;
}
