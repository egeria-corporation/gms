// SPDX-License-Identifier: AGPL-3.0-only
// What every import source yields: one header row of named columns and the data rows under it, as
// text. A CSV or XLSX file, a Google Sheets range and an Airtable table all become a SourceTable;
// everything after that (screening, mapping, checking) is the same for each.
import { parseCsv } from "./csv.ts";

/** At most this many data rows in one import run. */
export const MAX_IMPORT_ROWS = 5000;
/** At most this many columns are read from a source. */
export const MAX_IMPORT_COLUMNS = 200;
/** A cell longer than this is cut (no field takes more). */
export const MAX_CELL_LENGTH = 20_000;

export type SourceKind = "csv" | "xlsx" | "google_sheets" | "airtable";
export const SOURCE_KINDS: readonly SourceKind[] = ["csv", "xlsx", "google_sheets", "airtable"];

export interface SourceRow {
  /** 1-based position in the source as a person sees it (the header is row 1 in a spreadsheet). */
  line: number;
  /** The source's own id for the row, when it has one (an Airtable record id). */
  id?: string;
  cells: string[];
}

export interface SourceTable {
  header: string[];
  rows: SourceRow[];
}

export class SourceTableError extends Error {
  constructor(
    readonly code: "empty" | "too_many_rows" | "too_many_columns" | "no_header" | "unreadable",
    message: string,
  ) {
    super(message);
    this.name = "SourceTableError";
  }
}

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? (Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10)) : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : Array.isArray(v) ? v.map(cell).filter(Boolean).join(", ") : "";
  return s.length > MAX_CELL_LENGTH ? s.slice(0, MAX_CELL_LENGTH) : s;
};

/**
 * A table from a grid of cells whose first non-blank row is the header. Blank header cells are
 * named after their column letter; a repeated header gets " (2)", " (3)"… so every column has one
 * name. Wholly blank rows are dropped, and rows past {@link MAX_IMPORT_ROWS} are refused.
 */
export function tableFromGrid(grid: readonly (readonly unknown[])[], opts: { firstLine?: number; maxRows?: number } = {}): SourceTable {
  const max = opts.maxRows ?? MAX_IMPORT_ROWS;
  const start = grid.findIndex((r) => r.some((c) => cell(c).trim() !== ""));
  if (start < 0) throw new SourceTableError("empty", "The source has no rows");
  const rawHeader = grid[start]!.map((c) => cell(c).trim());
  let width = rawHeader.length;
  while (width > 0 && rawHeader[width - 1] === "") width--;
  if (width === 0) throw new SourceTableError("no_header", "The first row has no column names");
  if (width > MAX_IMPORT_COLUMNS) throw new SourceTableError("too_many_columns", `Import at most ${MAX_IMPORT_COLUMNS} columns`);
  const seen = new Map<string, number>();
  const header = rawHeader.slice(0, width).map((h, i) => {
    const base = h || `Column ${columnLetter(i)}`;
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    return n === 1 ? base : `${base} (${n})`;
  });
  const first = opts.firstLine ?? 1;
  const rows: SourceRow[] = [];
  for (let i = start + 1; i < grid.length; i++) {
    const cells = Array.from({ length: width }, (_, c) => cell(grid[i]![c]));
    if (cells.every((c) => c.trim() === "")) continue;
    if (rows.length >= max) throw new SourceTableError("too_many_rows", `Import up to ${max.toLocaleString("en-US")} rows at a time. Split the source and import each part`);
    rows.push({ line: first + i, cells });
  }
  if (!rows.length) throw new SourceTableError("empty", "The source has a header row but no data rows");
  return { header, rows };
}

/** A CSV file as a table (RFC 4180; see {@link parseCsv}). */
export function tableFromCsv(text: string, opts: { maxRows?: number } = {}): SourceTable {
  return tableFromGrid(parseCsv(text), opts);
}

/**
 * Records with named fields (Airtable) as a table. Columns follow `fieldOrder` (the table's schema),
 * then any other field name met in the records; each row keeps the record's id.
 */
export function tableFromRecords(records: readonly { id: string; fields: Record<string, unknown> }[], fieldOrder: readonly string[] = [], opts: { maxRows?: number } = {}): SourceTable {
  const max = opts.maxRows ?? MAX_IMPORT_ROWS;
  if (records.length > max) throw new SourceTableError("too_many_rows", `Import up to ${max.toLocaleString("en-US")} rows at a time. Split the source and import each part`);
  const names: string[] = [...new Set(fieldOrder.map((f) => f.trim()).filter(Boolean))];
  for (const r of records) for (const k of Object.keys(r.fields)) if (k.trim() && !names.includes(k.trim())) names.push(k.trim());
  if (!names.length) throw new SourceTableError("no_header", "The table has no fields");
  if (names.length > MAX_IMPORT_COLUMNS) throw new SourceTableError("too_many_columns", `Import at most ${MAX_IMPORT_COLUMNS} columns`);
  const rows = records
    .map((r, i) => {
      const byName = new Map(Object.entries(r.fields).map(([k, v]) => [k.trim(), v]));
      return { line: i + 1, id: r.id, cells: names.map((n) => cell(byName.get(n))) };
    })
    .filter((r) => r.cells.some((c) => c.trim() !== ""));
  if (!rows.length) throw new SourceTableError("empty", "The table has no records");
  return { header: names, rows };
}

/** A, B, …, Z, AA, AB, … for a 0-based column index. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
