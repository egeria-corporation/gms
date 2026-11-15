// SPDX-License-Identifier: AGPL-3.0-only
// A JSON export (OpenWater gives one) as a table: an array of objects, or an object holding one
// array of them. Each object is one row; its keys are the columns. A nested object is read by its
// name or value; anything else nested is left blank, never guessed at.
import { SourceTableError, tableFromRecords, type SourceTable } from "../table.ts";

function flat(v: unknown): unknown {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return Array.isArray(v) ? v.map(flat).filter((x) => typeof x === "string" || typeof x === "number" || typeof x === "boolean") : v;
  const o = v as Record<string, unknown>;
  for (const k of ["name", "label", "title", "value", "displayValue"]) if (typeof o[k] === "string" || typeof o[k] === "number") return o[k];
  return null;
}

export function tableFromJson(text: string, opts: { maxRows?: number } = {}): SourceTable {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new SourceTableError("unreadable", "The file is not valid JSON");
  }
  let list: unknown = parsed;
  if (!Array.isArray(list) && list && typeof list === "object") list = Object.values(list as Record<string, unknown>).find(Array.isArray);
  if (!Array.isArray(list)) throw new SourceTableError("unreadable", "The JSON file holds no list of records");
  const objects = list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
  if (!objects.length) throw new SourceTableError("empty", "The JSON file has no records");
  // No row id here: the export's own id is a column like any other, mapped to Row ID by the person
  // (the OpenWater preset does), so a row is keyed the same way a CSV row is.
  const records = objects.map((o) => ({ id: "", fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, flat(v)])) }));
  return tableFromRecords(records, [], opts);
}
