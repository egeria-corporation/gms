// SPDX-License-Identifier: AGPL-3.0-only
// An importer adapter knows one grants system's export: how to recognise it from its header row,
// which column fills which field of a target (a preset the person confirms), which rows are not
// grant history (applications that were never awarded), and how the system names the PDFs and
// files it puts in a zip. Adapters only describe; the framework (../plan.ts) still does the work,
// and the sensitive screen (../sensitive.ts) still runs first on every table, whatever adapter is
// chosen. Nothing here reads a PDF's contents.
import type { TargetKey } from "../target.ts";

export type AdapterKey = "good_grants" | "sm_apply" | "submittable" | "foundant_glm" | "smartsimple" | "openwater" | "fluxx" | "zengine";
/** Systems whose export is a file the person downloads and drops in. */
export const FILE_ADAPTER_KEYS = ["good_grants", "sm_apply", "submittable", "foundant_glm", "smartsimple", "openwater"] as const satisfies readonly AdapterKey[];
/** Systems the GMS reads through their API, with the funder's own credentials, read-only. */
export const API_ADAPTER_KEYS = ["fluxx", "zengine"] as const satisfies readonly AdapterKey[];
export const ADAPTER_KEYS: readonly AdapterKey[] = [...FILE_ADAPTER_KEYS, ...API_ADAPTER_KEYS];

export type FileAdapterKey = (typeof FILE_ADAPTER_KEYS)[number];
export type ApiAdapterKey = (typeof API_ADAPTER_KEYS)[number];

export interface HeaderSignature {
  /** Folded headers that only this system's exports carry. A file must have one to be recognised. */
  strong: readonly string[];
  /** Folded headers its exports usually carry; each adds to the match. */
  usual: readonly string[];
}

/** Folded header candidates per field, most specific first. The first one present fills the field. */
export type Preset = Readonly<Partial<Record<string, readonly string[]>>>;

export interface ImportAdapter {
  key: AdapterKey;
  /** The system's name as its customers know it. */
  system: string;
  via: "file" | "api";
  /** What to export from the system, in plain steps (the picker shows them). */
  steps: readonly string[];
  /** The file types read for this system. An older binary .xls is never read; save it as CSV or .xlsx. */
  accepts: readonly ("csv" | "xlsx" | "json")[];
  /** What the system's zip download holds, when it has one, and how to read a record's id from a path. */
  attachments: { description: string; idPattern?: RegExp } | null;
  signature: HeaderSignature;
  /** Presets per target. A target with none is not offered for this system. */
  presets: Partial<Record<TargetKey, Preset>>;
  /**
   * Grant history only: the rows that were never awarded. A row is set aside when one of these
   * columns (folded headers), or the column mapped to Status, holds one of `notAwarded` (folded),
   * or when its amount awarded is blank or zero.
   */
  decision: { columns: readonly string[]; notAwarded: readonly string[] };
  /** The system's public pages this adapter was built from, as of November 2026. */
  sources: readonly string[];
  /**
   * Whether those pages give the export's exact column names. When they do not, the signature and
   * the preset match loosely and the person confirms every field before anything is checked.
   */
  headersConfirmed: boolean;
}

/** Words that mean "never awarded" in most systems' status and decision columns (folded). */
export const COMMON_NOT_AWARDED = ["declined", "decline", "rejected", "not funded", "not awarded", "unsuccessful", "withdrawn", "ineligible", "denied", "cancelled", "canceled", "draft", "in progress", "incomplete", "not submitted", "disqualified", "not selected"] as const;
