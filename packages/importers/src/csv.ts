// SPDX-License-Identifier: AGPL-3.0-only
// CSV in and out: a small RFC 4180 reader and writer and a column mapper. A mapper names, for each
// target field, the CSV column that feeds it; every other column is never read. Columns whose
// header names bank or identity data are refused outright, mapped or not.

/** Rows of cells. Quoted cells may hold commas, quotes ("") and line breaks; blank rows are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  // A byte-order mark is not part of the first header.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

/**
 * One CSV cell. Quoted when it holds a comma, quote or line break; a cell that a spreadsheet would
 * run as a formula (=, +, -, @, tab, carriage return at the start) is prefixed with an apostrophe.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Header names that would carry bank or identity data. Such a column is never imported. */
const SENSITIVE_HEADER = /(rout(ing)?[\s_-]*(no|num|number|#)|acc(oun)?t[\s_-]*(no|num|number|#)|\biban\b|\bswift\b|\bs\.?s\.?n\b|social[\s_-]*sec|birth|\bdob\b|tax[\s_-]*id|gov(ernment)?[\s_-]*id|passport[\s_-]*(no|num|number|#)|driver)/i;
export const isSensitiveHeader = (header: string): boolean => SENSITIVE_HEADER.test(header);

export interface MappedCsv<F extends string> {
  header: string[];
  /** One entry per data row: the mapped values (trimmed), and the 1-based line of the row (the header is line 1). */
  rows: { line: number; values: Partial<Record<F, string>> }[];
  /** Mapped columns that are not in the header. */
  missingColumns: F[];
  /** Columns left out because their header names bank or identity data. */
  refusedColumns: string[];
}

/** Read a CSV through a mapping (target field → column header). Unmapped columns are never read. */
export function mapCsv<F extends string>(text: string, mapping: Partial<Record<F, string>>, opts: { maxRows?: number } = {}): MappedCsv<F> & { tooMany: boolean } {
  const all = parseCsv(text);
  const header = (all[0] ?? []).map((h) => h.trim());
  const refusedColumns = header.filter(isSensitiveHeader);
  const index = new Map<F, number>();
  const missingColumns: F[] = [];
  for (const [field, column] of Object.entries(mapping) as [F, string | undefined][]) {
    if (!column) continue;
    const at = header.indexOf(column.trim());
    if (at < 0 || isSensitiveHeader(column)) missingColumns.push(field);
    else index.set(field, at);
  }
  const data = all.slice(1);
  const max = opts.maxRows ?? Infinity;
  const rows = data.slice(0, max).map((cells, i) => {
    const values: Partial<Record<F, string>> = {};
    for (const [field, at] of index) {
      const v = (cells[at] ?? "").trim();
      if (v) values[field] = v;
    }
    return { line: i + 2, values };
  });
  return { header, rows, missingColumns, refusedColumns, tooMany: data.length > max };
}
