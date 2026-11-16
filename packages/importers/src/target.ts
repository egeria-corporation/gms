// SPDX-License-Identifier: AGPL-3.0-only
// An import target: the fields a row can fill, which of them are required, words that suggest a
// column for each, and the validator that turns one row's mapped text into the record to create.
// Targets live in ./targets; the framework (./plan.ts) is the same for every one of them.
import { fold } from "./values.ts";

export type TargetKey = "outside_applications" | "award_history";
export const TARGET_KEYS: readonly TargetKey[] = ["outside_applications", "award_history"];

export type FieldKind = "text" | "longtext" | "date" | "year" | "money" | "currency" | "choice" | "yesno" | "url" | "id";

export interface FieldSpec<F extends string = string> {
  key: F;
  /** What the field is called on screen. */
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** Header words that suggest this field, folded (lower case, letters and digits). */
  synonyms: readonly string[];
  /** One plain sentence under the field in the mapping step. */
  help?: string;
}

export interface Problem<F extends string = string> {
  field?: F;
  message: string;
}

/** Money a row carries, for the reconciliation totals. */
export interface MoneyLine {
  kind: "ask" | "awarded" | "paid";
  amountMinor: number;
  currency: string;
  /** The year it belongs to (the deadline, award or payment year), or null when the row has none. */
  year: number | null;
}

export interface RowCheck<F extends string, N> {
  problems: Problem<F>[];
  /** The record to create; null when the row has a problem. */
  record: N | null;
  money: MoneyLine[];
  /** How the row is named in previews. */
  title: string;
  subtitle: string | null;
}

export interface ImportTarget<F extends string = string, N = unknown> {
  key: TargetKey;
  /** What one record is called, singular and plural. */
  noun: { one: string; many: string };
  fields: readonly FieldSpec<F>[];
  check(values: Partial<Record<F, string>>): RowCheck<F, N>;
}

/** The fields a mapping must name before a run can be checked. */
export const requiredFields = <F extends string>(t: ImportTarget<F>): F[] => t.fields.filter((f) => f.required).map((f) => f.key);

export type Mapping<F extends string = string> = Partial<Record<F, string>>;

/**
 * A first guess at which column fills which field: a header equal to a field's label or one of its
 * synonyms first, then a header that contains one of them. Each header is used once, and fields
 * are taken in the target's order (most specific first), so "Internal deadline" is not taken by
 * the full deadline.
 */
export function suggestMapping<F extends string>(target: ImportTarget<F>, header: readonly string[], saved?: Mapping<F> | null): Mapping<F> {
  const out: Mapping<F> = {};
  const used = new Set<string>();
  const present = new Set(header);
  if (saved) {
    for (const f of target.fields) {
      const h = saved[f.key];
      if (h && present.has(h) && !used.has(h)) {
        out[f.key] = h;
        used.add(h);
      }
    }
  }
  const folded = header.map((h) => ({ h, f: fold(h) }));
  const words = (f: FieldSpec<F>) => [fold(f.label), ...f.synonyms];
  for (const pass of ["exact", "contains"] as const) {
    for (const f of target.fields) {
      if (out[f.key]) continue;
      const hit = folded.find(({ h, f: fh }) => !used.has(h) && fh && words(f).some((w) => (pass === "exact" ? fh === w : ` ${fh} `.includes(` ${w} `))));
      if (hit) {
        out[f.key] = hit.h;
        used.add(hit.h);
      }
    }
  }
  return out;
}

/** Keeps only fields of the target that name a column of the header. */
export function cleanMapping<F extends string>(target: ImportTarget<F>, header: readonly string[], mapping: Record<string, unknown>): { mapping: Mapping<F>; unknownColumns: F[] } {
  const out: Mapping<F> = {};
  const unknownColumns: F[] = [];
  const present = new Set(header);
  for (const f of target.fields) {
    const v = mapping[f.key];
    if (typeof v !== "string" || !v.trim()) continue;
    if (present.has(v)) out[f.key] = v;
    else unknownColumns.push(f.key);
  }
  return { mapping: out, unknownColumns };
}
