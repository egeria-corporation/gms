// SPDX-License-Identifier: AGPL-3.0-only
// The dry run. A source table goes through four steps, in this order, before anything is stored:
//   1. sensitive columns are dropped (./sensitive.ts); from here on only kept columns exist;
//   2. the mapping is cleaned against the kept columns;
//   3. every row is checked by the target's validator;
//   4. every row gets a key, and rows already imported (or repeated within the source) are skipped.
// The result is a plan: each row's outcome (create, skip or error) and a reconciliation with the
// counts and the money totals by year. Committing the plan is the API's job (apps/api).
import { screenColumns, type DroppedColumn } from "./sensitive.ts";
import type { SourceKind, SourceTable } from "./table.ts";
import { cleanMapping, requiredFields, type ImportTarget, type Mapping, type MoneyLine, type Problem } from "./target.ts";

export type Outcome = "create" | "skip" | "error";

export interface PlannedRow<F extends string = string, N = unknown> {
  line: number;
  /** Hex SHA-256 identifying the row for idempotency (see {@link rowKey}). */
  key: string;
  outcome: Outcome;
  /** Why a row is skipped, in plain words. */
  reason: string | null;
  problems: Problem<F>[];
  record: N | null;
  money: MoneyLine[];
  title: string;
  subtitle: string | null;
}

export interface Total {
  outcome: Outcome;
  kind: MoneyLine["kind"];
  currency: string;
  /** Null for rows without a year. */
  year: number | null;
  amountMinor: number;
  rows: number;
}

export interface Reconciliation {
  rows: number;
  create: number;
  skip: number;
  error: number;
  /** Money by outcome, kind, currency and year, sorted by year (rows without a year last). */
  totals: Total[];
}

export interface Plan<F extends string = string, N = unknown> {
  /** The columns that may be read, in source order. Dropped columns are not in it. */
  columns: string[];
  dropped: DroppedColumn[];
  mapping: Mapping<F>;
  /** Fields the request mapped to a column that is not there (or was dropped). */
  unknownColumns: F[];
  /** Required fields the mapping leaves out. A plan with any cannot be committed. */
  missingRequired: F[];
  rows: PlannedRow<F, N>[];
  reconciliation: Reconciliation;
}

export interface PlanSource {
  kind: SourceKind;
  /** The source's identity for row ids: a spreadsheet and sheet, an Airtable base and table. Null for an uploaded file. */
  ref: string | null;
}

/** Earlier imports of the same rows, by key: when they were imported. */
export type AlreadyImported = ReadonlyMap<string, string | null>;

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** JSON with object keys sorted, so equal records give equal text. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(v as Record<string, unknown>)
    .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

/**
 * A row's key. With an id (a mapped "Row ID" column, or the source's own record id) the key is the
 * target, the source and the id, so the row is recognised even after it changes. Without one it is
 * the target and the record's content, so the same row imported again from any source (a re-saved
 * CSV, the same sheet) is recognised, and a changed row is a new one.
 */
export async function rowKey(target: string, basis: { id: string; scope: string } | { content: unknown }): Promise<string> {
  return sha256Hex("id" in basis ? `${target}\nid\n${basis.scope}\n${basis.id}` : `${target}\nrow\n${canonicalJson(basis.content)}`);
}

export function reconcile(rows: readonly Pick<PlannedRow, "outcome" | "money">[]): Reconciliation {
  const totals = new Map<string, Total>();
  for (const r of rows) {
    for (const m of r.money) {
      const k = `${r.outcome}|${m.kind}|${m.currency}|${m.year ?? ""}`;
      const t = totals.get(k) ?? { outcome: r.outcome, kind: m.kind, currency: m.currency, year: m.year, amountMinor: 0, rows: 0 };
      t.amountMinor += m.amountMinor;
      t.rows += 1;
      totals.set(k, t);
    }
  }
  const order: Record<Outcome, number> = { create: 0, skip: 1, error: 2 };
  return {
    rows: rows.length,
    create: rows.filter((r) => r.outcome === "create").length,
    skip: rows.filter((r) => r.outcome === "skip").length,
    error: rows.filter((r) => r.outcome === "error").length,
    totals: [...totals.values()].sort((a, b) => order[a.outcome] - order[b.outcome] || a.kind.localeCompare(b.kind) || a.currency.localeCompare(b.currency) || (a.year ?? 9999) - (b.year ?? 9999)),
  };
}

const when = (at: string | null) => (at ? ` on ${at.slice(0, 10)}` : "");

/** Steps 1 to 4 above. `already` lists keys imported before (looked up by the caller). */
export async function planImport<F extends string, N>(input: { target: ImportTarget<F, N>; table: SourceTable; mapping: Record<string, unknown>; source: PlanSource; already?: AlreadyImported }): Promise<Plan<F, N>> {
  const { target, table, source } = input;
  const screened = screenColumns(table.header, table.rows.map((r) => r.cells));
  const columns = screened.keep.map((i) => table.header[i]!);
  const { mapping, unknownColumns } = cleanMapping(target, columns, input.mapping);
  const missingRequired = requiredFields(target).filter((f) => !mapping[f]);
  const index = new Map<F, number>();
  for (const [field, column] of Object.entries(mapping) as [F, string][]) index.set(field, table.header.indexOf(column));
  const idColumn = (mapping as Record<string, string | undefined>).sourceId;
  const scope = source.ref ?? `${source.kind}:${idColumn ?? ""}`;
  const seen = new Map<string, number>();
  const rows: PlannedRow<F, N>[] = [];
  for (const r of table.rows) {
    const values: Partial<Record<F, string>> = {};
    for (const [field, at] of index) {
      const v = (r.cells[at] ?? "").trim();
      if (v) values[field] = v;
    }
    const check = target.check(values);
    const id = idColumn ? (values as Record<string, string | undefined>).sourceId : r.id;
    const key = await rowKey(target.key, id ? { id, scope: idColumn ? scope : (source.ref ?? source.kind) } : { content: check.record ?? values });
    let outcome: Outcome = check.problems.length || missingRequired.length ? "error" : "create";
    let reason: string | null = null;
    if (outcome === "create") {
      const first = seen.get(key);
      if (first !== undefined) {
        outcome = "skip";
        reason = id ? `The same row ID as row ${first}` : `The same as row ${first}`;
      } else if (input.already?.has(key)) {
        outcome = "skip";
        reason = `Imported already${when(input.already.get(key) ?? null)}`;
      } else seen.set(key, r.line);
    }
    rows.push({ line: r.line, key, outcome, reason, problems: check.problems, record: outcome === "error" ? null : check.record, money: check.money, title: check.title, subtitle: check.subtitle });
  }
  return { columns, dropped: screened.dropped, mapping, unknownColumns, missingRequired, rows, reconciliation: reconcile(rows) };
}

/**
 * Which saved mapping a file gets back: files with the same columns (in any order, any case) share
 * one, so next year's export of the same spreadsheet maps itself.
 */
export async function columnsFingerprint(columns: readonly string[]): Promise<string> {
  return `columns:${(await sha256Hex([...new Set(columns.map((c) => c.trim().toLowerCase()))].sort().join("\n"))).slice(0, 32)}`;
}
