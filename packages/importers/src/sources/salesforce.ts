// SPDX-License-Identifier: AGPL-3.0-only
// Salesforce as an import source (v1.12.0): read-only, once, at the person's request, through the
// same framework as every other source (sensitive columns dropped first, a dry run with its
// reconciliation, then the commit, 5,000 rows a run). The records are read through Composio
// (@gms/connectors, apps.ts) with one SOQL SELECT and its next pages; nothing is ever written.
//
// The person picks what to read: a preset for the Nonprofit Success Pack's grant Opportunities
// (record types named like "Grant") or for Accounts, or a SOQL query of their own. A query of their
// own is checked here first: one SELECT, nothing that writes or locks (FOR UPDATE, FOR VIEW, FOR
// REFERENCE, UPDATE TRACKING, UPDATE VIEWSTAT), nothing that reads past what is there today (ALL
// ROWS, USING SCOPE), no field it cannot name (FIELDS()) and no field whose name suggests bank or
// identity details, and a LIMIT of one past the run's cap.
import { isSensitiveHeader } from "../sensitive.ts";
import { MAX_IMPORT_ROWS, SourceTableError, tableFromRecords, type SourceTable } from "../table.ts";
import type { TargetKey } from "../target.ts";

export type SalesforcePreset = "npsp_grants" | "accounts";
export const SALESFORCE_PRESETS: readonly SalesforcePreset[] = ["npsp_grants", "accounts"];
/** A query of the person's own is at most this long. */
export const MAX_SOQL_LENGTH = 4000;

/** The targets a preset is read for. Past reviews and past reports have none: NPSP keeps neither as an Opportunity or an Account. */
type PresetTarget = "outside_applications" | "award_history" | "history_applications";

interface PresetColumn {
  /** The field as SOQL names it (a relationship as `Account.Name`). */
  field: string;
  /** The column the person maps, per target: the words the target's fields already recognise. */
  header: Partial<Record<PresetTarget, string>>;
}

interface PresetDef {
  label: string;
  /** The targets this preset is offered for; for any other target a query of the person's own is the way. */
  targets: readonly PresetTarget[];
  object: string;
  where: string | null;
  /** More conditions for one target: grant history takes only the grants that were won. */
  whereFor?: Partial<Record<TargetKey, string>>;
  orderBy: string;
  columns: readonly PresetColumn[];
}

const same = (h: string): Record<PresetTarget, string> => ({ outside_applications: h, award_history: h, history_applications: h });

/**
 * Nonprofit Success Pack (NPSP) fields on a grant Opportunity, as NPSP documents them. For a
 * nonprofit the Account is the funder; for a funder that tracks the grants it made, the grantee.
 * Orgs without NPSP do not have the `npsp__` fields: use the Accounts preset or a query of your own.
 */
export const SALESFORCE_PRESET_DEFS: Record<SalesforcePreset, PresetDef> = {
  npsp_grants: {
    label: "Grants (Nonprofit Success Pack Opportunities)",
    // Past applications (imported history) are every grant Opportunity, won or not.
    targets: ["outside_applications", "award_history", "history_applications"],
    object: "Opportunity",
    where: "RecordType.Name LIKE '%Grant%'",
    whereFor: { award_history: "IsWon = true" },
    orderBy: "CloseDate DESC",
    columns: [
      { field: "Id", header: same("Record ID") },
      { field: "Name", header: { outside_applications: "Grant name", award_history: "Grant name", history_applications: "Application title" } },
      { field: "Account.Name", header: { outside_applications: "Funder", award_history: "Organization", history_applications: "Organization" } },
      // Salesforce's stages (Prospecting, Closed Won…) are not the GMS's: for applications and past
      // applications the column keeps Salesforce's own name, so it is mapped only if the person chooses to.
      { field: "StageName", header: { outside_applications: "StageName", award_history: "Status", history_applications: "StageName" } },
      { field: "Amount", header: same("Amount awarded") },
      { field: "npsp__Requested_Amount__c", header: { outside_applications: "Ask", award_history: "Amount requested", history_applications: "Amount requested" } },
      { field: "CloseDate", header: { outside_applications: "Close date", award_history: "Award date", history_applications: "Close date" } },
      { field: "npsp__Next_Grant_Deadline_Due_Date__c", header: same("Deadline") },
      { field: "npsp__Grant_Period_Start_Date__c", header: same("Grant start") },
      { field: "npsp__Grant_Period_End_Date__c", header: same("Grant end") },
      { field: "npsp__Grant_Program_Area_s__c", header: same("Program") },
      { field: "npsp__Grant_Requirements_Website__c", header: same("Listing URL") },
      { field: "CurrencyIsoCode", header: same("Currency") },
      { field: "RecordType.Name", header: same("Record type") },
      { field: "Description", header: same("Description") },
    ],
  },
  accounts: {
    label: "Accounts (organizations)",
    targets: ["outside_applications", "award_history"],
    object: "Account",
    where: null,
    orderBy: "Name ASC",
    columns: [
      { field: "Id", header: same("Record ID") },
      { field: "Name", header: { outside_applications: "Funder", award_history: "Organization", history_applications: "Organization" } },
      { field: "Type", header: same("Type") },
      { field: "Website", header: same("Website") },
      { field: "BillingCity", header: same("City") },
      { field: "BillingState", header: same("State") },
      { field: "BillingCountry", header: same("Country") },
      { field: "Description", header: same("Description") },
    ],
  },
};

/** The presets offered for a target, in order. */
export const salesforcePresetsFor = (target: TargetKey): SalesforcePreset[] =>
  SALESFORCE_PRESETS.filter((p) => (SALESFORCE_PRESET_DEFS[p].targets as readonly TargetKey[]).includes(target));

/** Whether a preset is read for a target. */
export const salesforcePresetFits = (preset: SalesforcePreset, target: TargetKey): boolean => salesforcePresetsFor(target).includes(preset);

/** CurrencyIsoCode exists only in multi-currency orgs; the preset leaves it out unless asked. */
const OPTIONAL_FIELDS = new Set(["CurrencyIsoCode"]);

/** The SOQL a preset runs for a target: a plain SELECT, one past the run's cap. */
export function presetSoql(preset: SalesforcePreset, opts: { target?: TargetKey; multiCurrency?: boolean } = {}): string {
  const p = SALESFORCE_PRESET_DEFS[preset];
  const fields = p.columns.map((c) => c.field).filter((f) => opts.multiCurrency || !OPTIONAL_FIELDS.has(f));
  if (opts.target && !salesforcePresetFits(preset, opts.target)) throw new SoqlRefusedError(`${p.label} are not read for this kind of record. Write a SOQL query of your own`);
  const where = [p.where, opts.target ? p.whereFor?.[opts.target] : undefined].filter(Boolean).join(" AND ");
  return `SELECT ${fields.join(", ")} FROM ${p.object}${where ? ` WHERE ${where}` : ""} ORDER BY ${p.orderBy} LIMIT ${MAX_IMPORT_ROWS + 1}`;
}

export class SoqlRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SoqlRefusedError";
  }
}

/** SOQL with its string literals blanked, so a word inside quotes is never read as a clause. */
const withoutLiterals = (q: string) => q.replace(/'(?:\\.|[^'\\])*'/g, "''");

/**
 * Clauses that write, lock or record a view, even inside a SELECT; that read past the records there
 * today (ALL ROWS: deleted and archived ones; USING SCOPE: another filter scope); or that reach
 * fields the query does not name (FIELDS(ALL), FIELDS(CUSTOM), FIELDS(STANDARD)), whose names
 * cannot be checked first. One list to relax.
 */
export const SOQL_REFUSED_CLAUSES: readonly { re: RegExp; words: string }[] = [
  { re: /\bfor\s+update\b/i, words: "FOR UPDATE" },
  { re: /\bfor\s+view\b/i, words: "FOR VIEW" },
  { re: /\bfor\s+reference\b/i, words: "FOR REFERENCE" },
  { re: /\bupdate\s+tracking\b/i, words: "UPDATE TRACKING" },
  { re: /\bupdate\s+viewstat\b/i, words: "UPDATE VIEWSTAT" },
  { re: /\ball\s+rows\b/i, words: "ALL ROWS" },
  { re: /\busing\s+scope\b/i, words: "USING SCOPE" },
  { re: /\bfields\s*\(/i, words: "FIELDS()" },
];
/** Data-changing verbs. The query endpoint would refuse them anyway (SOQL only reads); they are refused here first. */
const NOT_A_SELECT = /\b(insert|update|delete|upsert|merge|undelete)\b/i;
/** Outside quoted values, SOQL needs only these characters (names, numbers, dates, operators, lists). */
const SOQL_CHARS = /^[A-Za-z0-9_ .,()=<>!:+\-']*$/;
/** Names: a field, a relationship path (`Account.Owner.Name`), an object, a keyword or an alias. */
const NAMES = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g;

/**
 * A query of the person's own, checked: one SELECT and nothing that writes, locks, records a view,
 * reads deleted records or reaches fields it does not name; no comment (SOQL has none, so one
 * could only hide something from this check); and no name, anywhere in the query, that suggests
 * bank or identity details (the same screen every imported column goes through), so such a value
 * never leaves Salesforce. A LIMIT of one past the run's cap is added when it has none. Throws
 * {@link SoqlRefusedError} with a plain sentence.
 */
export function checkSoql(input: string): string {
  const q = input.replace(/\s+/g, " ").trim();
  if (!q) throw new SoqlRefusedError("Write a SOQL query that starts with SELECT");
  if (q.length > MAX_SOQL_LENGTH) throw new SoqlRefusedError(`A query can be up to ${MAX_SOQL_LENGTH} characters`);
  if (/[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/u.test(q)) throw new SoqlRefusedError("The query holds a hidden or control character. Type it again as plain text");
  const bare = withoutLiterals(q);
  if (bare.replace(/''/g, "").includes("'")) throw new SoqlRefusedError("A quote in the query is not closed");
  if (!/^select\s/i.test(bare)) throw new SoqlRefusedError("Only a SELECT query can be run: the GMS only reads from Salesforce");
  if (bare.includes(";")) throw new SoqlRefusedError("Run one query at a time, without a semicolon");
  if (/--|\/\*|\*\/|\/\//.test(bare)) throw new SoqlRefusedError("SOQL has no comments. Take the comment out of the query");
  if (!SOQL_CHARS.test(bare)) throw new SoqlRefusedError("The query holds a character SOQL does not use outside quotes");
  const clause = SOQL_REFUSED_CLAUSES.find((c) => c.re.test(bare));
  if (clause) throw new SoqlRefusedError(`${clause.words} cannot be used here: the GMS reads each record once, as it is today, and only the fields a query names`);
  if (NOT_A_SELECT.test(bare.replace(/\bfrom\s+\w+/gi, ""))) throw new SoqlRefusedError("Only a SELECT query can be run: the GMS only reads from Salesforce");
  if (!/\sfrom\s+[A-Za-z][A-Za-z0-9_]*/i.test(bare)) throw new SoqlRefusedError("Name the object to read with FROM");
  const sensitive = (bare.match(NAMES) ?? []).find((n) => isSensitiveHeader(n));
  if (sensitive) throw new SoqlRefusedError(`${sensitive} looks like bank or identity details, which the GMS never reads. Take it out of the query`);
  return /\blimit\s+\d+/i.test(bare) ? q : `${q} LIMIT ${MAX_IMPORT_ROWS + 1}`;
}

/** The object a query reads (the first FROM), for its label. */
export function soqlObject(q: string): string | null {
  let flat = withoutLiterals(q);
  // Subqueries (child relationships) sit in parentheses; the object read is the outer FROM.
  for (let i = 0; i < 5 && /\([^()]*\)/.test(flat); i++) flat = flat.replace(/\([^()]*\)/g, " ");
  return /\sfrom\s+([A-Za-z][A-Za-z0-9_]*)/i.exec(flat)?.[1] ?? null;
}

/**
 * One record's fields, flat: `Account: { Name }` becomes `Account.Name`. Salesforce's `attributes`
 * and child-relationship subqueries (lists of records) are left out.
 */
export function flattenRecord(rec: Record<string, unknown>, prefix = "", depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k === "attributes") continue;
    const name = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      // A subquery's result ({ totalSize, done, records }) is a list of other records: not a column.
      if (Array.isArray(o.records)) continue;
      if (depth < 3) Object.assign(out, flattenRecord(o, name, depth + 1));
      continue;
    }
    out[name] = v;
  }
  return out;
}

/**
 * Salesforce records as a table. With a preset its columns come in the preset's order under the
 * names the target recognises; otherwise under their SOQL names. Each row keeps the record's Id.
 */
export function tableFromSalesforce(records: readonly Record<string, unknown>[], opts: { preset?: SalesforcePreset; target: TargetKey; maxRows?: number }): SourceTable {
  if (!records.length) throw new SourceTableError("empty", "Salesforce returned no records for that query");
  if (opts.preset && !salesforcePresetFits(opts.preset, opts.target)) throw new SoqlRefusedError(`${SALESFORCE_PRESET_DEFS[opts.preset].label} are not read for this kind of record. Write a SOQL query of your own`);
  const flat = records.map((r) => flattenRecord(r));
  const columns = opts.preset ? SALESFORCE_PRESET_DEFS[opts.preset].columns : null;
  const header = (c: PresetColumn): string | undefined => c.header[opts.target as PresetTarget];
  const rows = flat.map((f, i) => {
    const id = typeof f.Id === "string" && /^[A-Za-z0-9]{15,18}$/.test(f.Id) ? f.Id : `row-${i + 1}`;
    if (!columns) return { id, fields: f };
    const named: Record<string, unknown> = {};
    for (const c of columns) {
      const h = header(c);
      if (h && c.field in f) named[h] = f[c.field];
    }
    return { id, fields: named };
  });
  const order = columns ? columns.map(header).filter((h): h is string => !!h && rows.some((r) => h in r.fields)) : [];
  return tableFromRecords(rows, order, { maxRows: opts.maxRows ?? MAX_IMPORT_ROWS });
}
