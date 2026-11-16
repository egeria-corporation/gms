// SPDX-License-Identifier: AGPL-3.0-only
// Import from a spreadsheet (v1.7.0): the five steps of the import wizard, for people and agents
// alike (REST: /gms/imports; the same authorization for both).
//
//   sources  which sources this workspace can use (CSV and XLSX always; Google Sheets and Airtable
//            when Composio is configured for them) and whether each is connected;
//   read     read the source, drop sensitive columns, and suggest a mapping (the saved one first);
//   preview  the dry run: every row checked and keyed, rows imported before skipped, a
//            reconciliation of counts and money by year, stored as a run with its log;
//   commit   write the run's rows in batches (call again until `done`); idempotent per row key;
//   runs     the run, its log and links to what was created.
//
// Targets: an applicant's outside applications (anyone who may edit applications) and a funder's
// grant history (workspace admins, signed in). Grant history payments are recorded as paid
// elsewhere through the tranche machine (scheduled → due → settled, resolve mode): never through
// Passport, never as a disbursed amount, never moving money.
//
// Sensitive data first: the source table is screened (packages/importers/src/sensitive.ts) before
// a sample is shown, a mapping is suggested or a row is stored. A run keeps the dropped columns'
// names only.
//
// Importer adapters (v1.9.0, packages/importers/src/adapters): grant history from another grants
// system. A file from Good Grants, SurveyMonkey Apply, Submittable, Foundant GLM, SmartSimple or
// OpenWater is recognised by its header row (or named by the person) and gets that system's preset
// mapping; the rows it says were never awarded are set aside. Fluxx and Zengine are read through
// their APIs with the funder's own credentials (./import-pullers.ts), 5,000 rows a run, resuming
// where the last run stopped. The screen still runs first on every table, whatever the adapter.
import { airtableRefFrom, ConnectorAuthError, ConnectorScopeError, ConnectorScopeUnverifiedError, ConnectorUnavailableError, isAirtableTableId, SourceReadError, spreadsheetIdFrom } from "@gms/connectors";
import {
  ADAPTER_KEYS,
  ADAPTERS,
  adapterMapping,
  adaptersFor,
  adapterView,
  columnsFingerprint,
  detectAdapter,
  DROP_REASON_TEXT,
  FILE_ADAPTERS,
  setAsideNotAwarded,
  tableFromJson,
  MAX_IMPORT_ROWS,
  planImport,
  screenColumns,
  SourceTableError,
  suggestMapping,
  tableFromCsv,
  tableFromGrid,
  tableFromRecords,
  TARGET_KEYS,
  TARGETS,
  withAlreadyImported,
  type AdapterKey,
  type DroppedColumn,
  type HistoryRecord,
  type ImportAdapter,
  type ImportTarget,
  type MoneyLine,
  type OutsideRecord,
  type Problem,
  type SourceKind,
  type SourceTable,
  type TargetKey,
} from "@gms/importers";
import { MAX_XLSX_BYTES, readXlsx } from "@gms/importers/xlsx";
import type { ExternalPaymentRecord } from "@gms/payments";
import { z } from "zod";
import { forbidden } from "../auth/verify.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { awardImportContext, importedAwardRow, type AwardImportContext } from "./analytics.ts";
import { audit, authorize, guardWrite, importsArePeoples, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import { deleteCredentials, pullerAdapter, pullerSources, pullSource } from "./import-pullers.ts";
import { insertImportedOutside, OUTSIDE_ROLES } from "./outside.ts";
import { RepoError, type Row } from "./repos/types.ts";
import { applyTrancheUpdate } from "./tranches.ts";

/** Rows written per commit call: a batch stays well inside one Worker request's subrequest budget. */
export const COMMIT_BATCH: Record<TargetKey, number> = { outside_applications: 50, award_history: 20 };
/** A preview not committed within this long is deleted. */
export const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
/** At most this many previews wait per workspace; older ones are deleted first. */
export const MAX_OPEN_PREVIEWS = 10;
/** Rows written to the run log per insert request. */
const ROWS_PER_INSERT = 500;
/** Row keys looked up per request (each key is 64 characters of the query string). */
const KEYS_PER_LOOKUP = 150;

type Run = Row<"import_runs">;
type LogRow = Row<"import_rows">;

const SOURCE_LABEL: Record<SourceKind, string> = { csv: "CSV file", xlsx: "Excel workbook", google_sheets: "Google Sheets", airtable: "Airtable", json: "JSON export", fluxx: "Fluxx", zengine: "Zengine" };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ------------------------------------------------------------------------------------ input

const fileName = z.string().trim().max(200).optional();
export const sourceInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("csv"), text: z.string().min(1).max(5_000_000), fileName }).strict(),
  z.object({ kind: z.literal("xlsx"), base64: z.string().min(1).max(Math.ceil((MAX_XLSX_BYTES * 4) / 3) + 4), fileName, sheet: z.string().min(1).max(200).optional() }).strict(),
  z.object({ kind: z.literal("google_sheets"), url: z.string().trim().min(1).max(2000), sheet: z.string().min(1).max(200).optional() }).strict(),
  z.object({ kind: z.literal("airtable"), url: z.string().trim().min(1).max(2000), table: z.string().min(1).max(200).optional() }).strict(),
  // An export in JSON (OpenWater gives one): an array of records.
  z.object({ kind: z.literal("json"), text: z.string().min(1).max(5_000_000), fileName }).strict(),
  // Read through the system's API with the funder's own credentials; `startPage` continues a source larger than one run.
  z.object({ kind: z.literal("fluxx"), startPage: z.number().int().min(1).max(100_000).optional() }).strict(),
  z.object({ kind: z.literal("zengine"), formId: z.string().regex(/^\d{1,12}$/), startPage: z.number().int().min(1).max(100_000).optional() }).strict(),
]);
export const targetInput = z.enum(TARGET_KEYS as [TargetKey, ...TargetKey[]]);
/** Which grants system's export this is (its preset mapping); omitted, the file is recognised by its header row when it can be. */
export const adapterInput = z.enum(ADAPTER_KEYS as [AdapterKey, ...AdapterKey[]]);
export const readInput = z.object({ target: targetInput, source: sourceInput, adapter: adapterInput.optional() }).strict();
export const previewInput = z
  .object({
    target: targetInput,
    source: sourceInput,
    adapter: adapterInput.optional(),
    /** Which column fills each field (field key → column header). */
    mapping: z.record(z.string().regex(/^[A-Za-z]{1,40}$/), z.string().max(300)),
    /** Remember this mapping for the next file with the same columns (or the same sheet or table). */
    saveMapping: z.boolean().default(true),
  })
  .strict();

// ------------------------------------------------------------------------------------ access

/** Who may import into a target. The same check for the web app, API clients and agents. */
async function importWorkspace(ctx: ServiceContext, target: TargetKey): Promise<ServiceWorkspace> {
  return target === "outside_applications" ? authorize(ctx, { scope: "applications:write", kind: "applicant", roles: OUTSIDE_ROLES }) : authorize(ctx, { scope: "workspace:admin", kind: "funder", roles: ["admin"], person: true });
}

const targetOf = (t: string): TargetKey => {
  if (!(TARGET_KEYS as readonly string[]).includes(t)) throw notFound("Import run");
  return t as TargetKey;
};

// ------------------------------------------------------------------------------------ sources

interface LoadedSource {
  kind: SourceKind;
  table: SourceTable;
  label: string;
  /** The source's identity for row ids and saved mappings; null for an uploaded file. */
  ref: string | null;
  sheets?: string[];
  sheet?: string;
  tables?: { id: string; name: string }[];
  tableId?: string;
  /** Fluxx and Zengine: where the next run starts (null when read to the end), and how many records the source holds. */
  nextPage?: number | null;
  total?: number | null;
}

const NOT_CONNECTED: Record<"google_sheets" | "airtable", string> = { google_sheets: "Connect Google Sheets first", airtable: "Connect Airtable first" };

/** What a failed read means for the person importing. Nothing here repeats a provider's own error text. */
function sourceError(e: unknown, kind: SourceKind): never {
  if (e instanceof ApiError) throw e;
  if (e instanceof SourceTableError) {
    const code = { empty: "empty_source", too_many_rows: "too_many_rows", too_many_columns: "too_many_columns", no_header: "no_header", unreadable: "unreadable_file" }[e.code];
    throw new ApiError(422, code, e.message);
  }
  if (e instanceof SourceReadError) throw new ApiError(422, "source_not_readable", e.message);
  if (e instanceof ConnectorScopeError) throw new ApiError(422, "connector_scope_rejected", e.message);
  if (e instanceof ConnectorScopeUnverifiedError) throw new ApiError(422, "connector_scope_unverified", e.message);
  if (e instanceof ConnectorAuthError) throw new ApiError(409, "source_not_connected", kind === "google_sheets" || kind === "airtable" ? NOT_CONNECTED[kind] : "Connect the source first");
  if (e instanceof ConnectorUnavailableError) throw new ApiError(503, "connector_unavailable", "Composio could not be reached. Nothing was read; try again in a few minutes");
  throw e;
}

function fromBase64(b64: string): Uint8Array {
  try {
    const bin = atob(b64.replace(/^data:[^,]*,/, "").replace(/\s+/g, ""));
    if (bin.length > MAX_XLSX_BYTES) throw new SourceTableError("unreadable", "The workbook is larger than 4 MB. Save the sheet you need as a CSV file, or remove other sheets");
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (e) {
    if (e instanceof SourceTableError) throw e;
    throw new SourceTableError("unreadable", "The workbook could not be read");
  }
}

async function loadSource(ctx: ServiceContext, wsId: string, src: z.output<typeof sourceInput>): Promise<LoadedSource> {
  try {
    if (src.kind === "csv") return { kind: "csv", table: tableFromCsv(src.text), label: src.fileName || "Pasted CSV", ref: null };
    if (src.kind === "json") return { kind: "json", table: tableFromJson(src.text), label: src.fileName || "JSON export", ref: null };
    if (src.kind === "fluxx" || src.kind === "zengine") {
      const p = await pullSource(ctx, wsId, src);
      return { kind: src.kind, table: p.table, label: p.label, ref: p.ref, nextPage: p.nextPage, total: p.total };
    }
    if (src.kind === "xlsx") {
      const w = await readXlsx(fromBase64(src.base64), src.sheet ?? null);
      return { kind: "xlsx", table: w.table, label: `${src.fileName || "Workbook"} · ${w.sheet}`, ref: null, sheets: w.sheets, sheet: w.sheet };
    }
    if (src.kind === "google_sheets") {
      const port = ctx.ports.sheets;
      if (!port) throw new ApiError(503, "import_source_not_configured", "Importing from Google Sheets is not set up on this server");
      const id = spreadsheetIdFrom(src.url);
      if (!id) throw new ApiError(422, "invalid_link", "Paste the link of a Google Sheets spreadsheet. It starts with https://docs.google.com/spreadsheets/");
      const sheets = await port.listSheets(wsId, id);
      const sheet = src.sheet ?? sheets[0]!;
      if (!sheets.includes(sheet)) throw new ApiError(422, "sheet_not_found", `The spreadsheet has no sheet named "${clip(sheet, 80)}"`);
      const grid = await port.readSheet(wsId, id, sheet, MAX_IMPORT_ROWS);
      return { kind: "google_sheets", table: tableFromGrid(grid), label: `Google Sheets · ${sheet}`, ref: clip(`${id}/${sheet}`, 300), sheets, sheet };
    }
    const port = ctx.ports.airtable;
    if (!port) throw new ApiError(503, "import_source_not_configured", "Importing from Airtable is not set up on this server");
    const ref = airtableRefFrom(src.url);
    if (!ref) throw new ApiError(422, "invalid_link", "Paste the link of an Airtable base or table. It starts with https://airtable.com/app");
    const tables = await port.listTables(wsId, ref.baseId);
    const wanted = src.table ?? ref.tableId;
    const table = wanted ? tables.find((t) => t.id === wanted || (!isAirtableTableId(wanted) && t.name === wanted)) : tables[0];
    if (!table) throw new ApiError(422, "table_not_found", "The base has no such table");
    const records = await port.listRecords(wsId, ref.baseId, table.id, MAX_IMPORT_ROWS);
    return { kind: "airtable", table: tableFromRecords(records, table.fields), label: `Airtable · ${table.name}`, ref: `${ref.baseId}/${table.id}`, tables: tables.map((t) => ({ id: t.id, name: t.name })), tableId: table.id };
  } catch (e) {
    sourceError(e, src.kind);
  }
}

const droppedView = (d: readonly DroppedColumn[]) => d.map((x) => ({ column: x.column, reason: x.reason, why: DROP_REASON_TEXT[x.reason] }));
const fieldsView = (t: ImportTarget) => t.fields.map((f) => ({ key: f.key, label: f.label, kind: f.kind, required: !!f.required, help: f.help ?? null }));
const sourceView = (s: LoadedSource) => ({
  kind: s.kind,
  label: s.label,
  ...(s.sheets ? { sheets: s.sheets, sheet: s.sheet ?? null } : {}),
  ...(s.tables ? { tables: s.tables, table: s.tableId ?? null } : {}),
  ...(s.kind === "fluxx" || s.kind === "zengine" ? { nextPage: s.nextPage ?? null, total: s.total ?? null } : {}),
});

/**
 * The adapter a read or a check uses: Fluxx and Zengine their own; a file the one the person named,
 * else the system its header row matches (grant history only), else none.
 */
function adapterFor(target: TargetKey, kind: SourceKind, named: AdapterKey | undefined, columns: readonly string[]): { adapter: ImportAdapter | null; detected: ReturnType<typeof detectAdapter> } {
  if (kind === "fluxx" || kind === "zengine") {
    if (named && named !== kind) throw new ApiError(422, "adapter_mismatch", `A ${SOURCE_LABEL[kind]} import is read as ${SOURCE_LABEL[kind]}`);
    return { adapter: pullerAdapter(kind), detected: null };
  }
  if (named && ADAPTERS[named].via === "api") throw new ApiError(422, "adapter_mismatch", `${ADAPTERS[named].system} is read through its API, not from a file`);
  if (named && !ADAPTERS[named].presets[target]) throw new ApiError(422, "adapter_not_for_target", `${ADAPTERS[named].system} exports are imported as a funder's grant history`);
  const detected = target === "award_history" ? detectAdapter(columns, FILE_ADAPTERS) : null;
  return { adapter: named ? ADAPTERS[named] : (detected?.adapter ?? null), detected };
}
const adapterRef = (a: ImportAdapter | null) => (a ? { key: a.key, system: a.system } : null);

/** Which sources this workspace can import from, and whether the connected ones are connected. */
export async function importSources(ctx: ServiceContext, target: TargetKey) {
  const ws = await importWorkspace(ctx, target);
  const canConnect = ws.role === "admin" && ctx.scopes.includes("workspace:admin") && !!ctx.actor.userId;
  const connected = async (port: { status(id: string): Promise<{ connected: boolean }> } | undefined) => (port ? (await port.status(ws.id).catch(() => ({ connected: false }))).connected : false);
  const [sheets, airtable] = await Promise.all([connected(ctx.ports.sheets), connected(ctx.ports.airtable)]);
  const t = TARGETS[target] as unknown as ImportTarget;
  // Fluxx and Zengine: grant history only, offered where the server can store credentials; only a
  // signed-in admin connects or reads them.
  const pullers = target === "award_history" && ctx.config.credentialsKey ? await pullerSources(ctx, ws.id) : [];
  return {
    target,
    maxRows: MAX_IMPORT_ROWS,
    maxXlsxBytes: MAX_XLSX_BYTES,
    fields: fieldsView(t),
    /** The grants systems whose exports have a preset for this target (none for an applicant's applications). */
    adapters: adaptersFor(target).map(adapterView),
    // A source that is not set up on this server is not listed at all.
    sources: [
      { kind: "csv" as const, label: SOURCE_LABEL.csv, connected: true, canConnect: false },
      { kind: "xlsx" as const, label: SOURCE_LABEL.xlsx, connected: true, canConnect: false },
      ...(ctx.ports.sheets ? [{ kind: "google_sheets" as const, label: SOURCE_LABEL.google_sheets, connected: sheets, canConnect }] : []),
      ...(ctx.ports.airtable ? [{ kind: "airtable" as const, label: SOURCE_LABEL.airtable, connected: airtable, canConnect }] : []),
      ...pullers.map((p) => ({ kind: p.provider, label: p.label, connected: p.connected, canConnect: canConnect })),
    ],
  };
}

async function savedMapping(ctx: ServiceContext, wsId: string, target: TargetKey, kind: SourceKind, ref: string) {
  const exact = await ctx.repos.table("import_mappings").one({ workspace_id: wsId, target, source: kind, source_ref: ref });
  if (exact) return { mapping: exact.mapping as Record<string, string>, exact: true };
  const [latest] = await ctx.repos.table("import_mappings").find({ workspace_id: wsId, target, source: kind }, { orderBy: "updated_at", ascending: false, limit: 1 });
  return latest ? { mapping: latest.mapping as Record<string, string>, exact: false } : null;
}

/** Read a source: its columns (sensitive ones dropped first), a few sample values and a suggested mapping. Stores nothing. */
export async function readImportSource(ctx: ServiceContext, input: z.output<typeof readInput>) {
  const ws = await importWorkspace(ctx, input.target);
  const target = TARGETS[input.target] as unknown as ImportTarget;
  const src = await loadSource(ctx, ws.id, input.source);
  const screened = screenColumns(src.table.header, src.table.rows.map((r) => r.cells));
  const columns = screened.keep.map((i) => {
    const samples: string[] = [];
    for (const r of src.table.rows) {
      const v = (r.cells[i] ?? "").trim();
      if (v && !samples.includes(clip(v, 80))) samples.push(clip(v, 80));
      if (samples.length === 3) break;
    }
    return { name: src.table.header[i]!, samples };
  });
  const ref = src.ref ?? (await columnsFingerprint(columns.map((c) => c.name)));
  const saved = await savedMapping(ctx, ws.id, input.target, src.kind, ref);
  const names = columns.map((c) => c.name);
  const { adapter, detected } = adapterFor(input.target, src.kind, input.adapter, names);
  const mapping = adapter ? adapterMapping(adapter, target, names, saved ? (saved.exact ? { exact: saved.mapping } : { similar: saved.mapping }) : {}) : suggestMapping(target, names, saved?.mapping ?? null);
  return {
    target: input.target,
    source: sourceView(src),
    rows: src.table.rows.length,
    columns,
    dropped: droppedView(screened.dropped),
    mapping,
    savedMapping: saved ? (saved.exact ? ("this_source" as const) : ("similar_source" as const)) : null,
    fields: fieldsView(target),
    /** The system whose preset filled the mapping, and the one the header row matched (it may differ from the one named). */
    adapter: adapterRef(adapter),
    detected: detected ? { ...adapterRef(detected.adapter)!, matched: detected.matched.slice(0, 20) } : null,
  };
}

// ------------------------------------------------------------------------------------ runs

type Progress = { toWrite: number; written: number; skipped: number; failed: number };

const statusOf = (r: Run, now: Date) => (r.finished_at ? "done" : r.committed_at ? "importing" : new Date(r.expires_at) <= now ? "expired" : "checked");

function runView(ctx: ServiceContext, r: Run, progress: Progress | null) {
  return {
    id: r.id,
    target: r.target as TargetKey,
    source: r.source as SourceKind,
    sourceLabel: r.source_label,
    mapping: r.mapping as Record<string, string>,
    dropped: droppedView(r.dropped_columns as unknown as DroppedColumn[]),
    reconciliation: r.reconciliation,
    rowsTotal: r.rows_total,
    status: statusOf(r, ctx.now()),
    createdAt: r.created_at,
    committedAt: r.committed_at,
    finishedAt: r.finished_at,
    expiresAt: r.expires_at,
    adapter: r.adapter ? adapterRef(ADAPTERS[r.adapter as AdapterKey] ?? null) : null,
    nextPage: r.source_next_page,
    ...(progress ? { progress } : {}),
  };
}

async function progressOf(ctx: ServiceContext, runId: string): Promise<Progress> {
  const t = ctx.repos.table("import_rows");
  const [toWrite, written, skipped, failed] = await Promise.all([t.count({ run_id: runId, outcome: "create", written_at: null }), t.count({ run_id: runId, outcome: "create" }, { notNull: ["written_at"] }), t.count({ run_id: runId, outcome: "skip" }), t.count({ run_id: runId, outcome: "error" })]);
  return { toWrite, written, skipped, failed };
}

/** What a run log row links to, as the API names it. */
const entityView = (r: LogRow) => (r.entity_id && r.written_at ? { type: r.entity_type as "outside_application" | "award", id: r.entity_type === "award" ? apiId("award", r.entity_id) : r.entity_id } : null);
const logView = (r: LogRow) => ({ line: r.line, outcome: r.outcome as "create" | "skip" | "error", reason: r.reason, problems: r.problems as unknown as Problem[], title: r.title, subtitle: r.subtitle, written: !!r.written_at, entity: entityView(r) });

/** Previews nobody committed: those past their day, and any beyond the newest few. Their rows go with them. */
async function clearStalePreviews(ctx: ServiceContext, wsId: string) {
  const open = await ctx.repos.table("import_runs").find({ workspace_id: wsId, committed_at: null }, { orderBy: "created_at", ascending: false });
  const now = ctx.now();
  const stale = open.filter((r, i) => new Date(r.expires_at) <= now || i >= MAX_OPEN_PREVIEWS - 1).map((r) => r.id);
  if (!stale.length) return;
  await ctx.repos.table("import_rows").remove({ workspace_id: wsId, run_id: stale });
  await ctx.repos.table("import_runs").remove({ workspace_id: wsId, id: stale });
}

/** Keys of these rows that an earlier run wrote, with when. */
async function alreadyImported(ctx: ServiceContext, wsId: string, target: TargetKey, keys: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const unique = [...new Set(keys)];
  for (let i = 0; i < unique.length; i += KEYS_PER_LOOKUP) {
    const hits = await ctx.repos.table("import_rows").find({ workspace_id: wsId, target, row_key: unique.slice(i, i + KEYS_PER_LOOKUP) }, { notNull: ["entity_id"] });
    for (const h of hits) out.set(h.row_key, h.written_at ?? h.updated_at);
  }
  return out;
}

const problemsFor = (p: readonly Problem[]) => p.slice(0, 30).map((x) => ({ ...(x.field ? { field: x.field } : {}), message: clip(x.message, 300) }));
const moneyView = (m: readonly MoneyLine[]) => m.map((x) => ({ kind: x.kind, amountMinor: x.amountMinor, currency: x.currency, year: x.year }));

/**
 * The dry run. Reads the source again (nothing from the read step is trusted), checks every row,
 * skips rows imported before, and stores the run and its log so the commit writes exactly what was
 * shown. Saves the mapping for next time unless asked not to.
 */
export async function previewImport(ctx: ServiceContext, input: z.output<typeof previewInput>) {
  const ws = await importWorkspace(ctx, input.target);
  const target = TARGETS[input.target] as unknown as ImportTarget<string, unknown>;
  const src = await loadSource(ctx, ws.id, input.source);
  let plan = await planImport({ target, table: src.table, mapping: input.mapping, source: { kind: src.kind, ref: src.ref } });
  // The same adapter as the read step (named, or recognised again from the screened columns).
  const { adapter } = adapterFor(input.target, src.kind, input.adapter, plan.columns);
  if (adapter) plan = setAsideNotAwarded(plan, src.table, adapter, target);
  if (plan.missingRequired.length) {
    const labels = plan.missingRequired.map((f) => target.fields.find((x) => x.key === f)?.label ?? f);
    throw new ApiError(422, "mapping_incomplete", `Choose a column for: ${labels.join(", ")}`, plan.missingRequired.map((f) => ({ code: "unmapped", field: f })));
  }
  plan = withAlreadyImported(plan, await alreadyImported(ctx, ws.id, input.target, plan.rows.filter((r) => r.outcome === "create").map((r) => r.key)));
  await clearStalePreviews(ctx, ws.id);

  if (input.saveMapping && Object.keys(plan.mapping).length) {
    const ref = src.ref ?? (await columnsFingerprint(plan.columns));
    const key = { workspace_id: ws.id, target: input.target, source: src.kind, source_ref: ref };
    const existing = await ctx.repos.table("import_mappings").one(key);
    if (existing) await ctx.repos.table("import_mappings").update({ id: existing.id }, { mapping: plan.mapping, updated_by: ctx.actor.userId });
    else await ctx.repos.table("import_mappings").insert({ ...key, mapping: plan.mapping, updated_by: ctx.actor.userId }).catch((e: unknown) => {
      // Saved by someone else a moment ago: theirs stands.
      if (!(e instanceof RepoError && e.kind === "conflict")) throw e;
    });
  }

  const run = await guardWrite("This import", () =>
    ctx.repos.table("import_runs").insert({
      workspace_id: ws.id,
      target: input.target,
      source: src.kind,
      source_label: clip(src.label, 300),
      source_ref: src.ref,
      mapping: plan.mapping,
      dropped_columns: plan.dropped as unknown as Run["dropped_columns"],
      reconciliation: plan.reconciliation as unknown as Run["reconciliation"],
      rows_total: plan.rows.length,
      adapter: adapter?.key ?? null,
      source_next_page: src.nextPage ?? null,
      created_by: ctx.actor.userId,
      expires_at: new Date(ctx.now().getTime() + PREVIEW_TTL_MS).toISOString(),
    }),
  );
  const log = plan.rows.map((r) => ({
    workspace_id: ws.id,
    run_id: run.id,
    target: input.target,
    line: r.line,
    row_key: r.key,
    outcome: r.outcome,
    reason: r.reason ? clip(r.reason, 300) : null,
    problems: problemsFor(r.problems) as unknown as LogRow["problems"],
    record: r.outcome === "create" ? (r.record as LogRow["record"]) : null,
    title: clip(r.title || "(no title)", 300),
    subtitle: r.subtitle ? clip(r.subtitle, 300) : null,
  }));
  for (let i = 0; i < log.length; i += ROWS_PER_INSERT) await guardWrite("This import", () => ctx.repos.table("import_rows").insertMany(log.slice(i, i + ROWS_PER_INSERT)));
  const rec = plan.reconciliation;
  await audit(ctx, "import.checked", "import_run", run.id, { target: input.target, source: src.kind, ...(adapter ? { adapter: adapter.key } : {}), rows: rec.rows, create: rec.create, skip: rec.skip, error: rec.error, droppedColumns: plan.dropped.map((d) => d.column) });
  return {
    run: runView(ctx, run, { toWrite: rec.create, written: 0, skipped: rec.skip, failed: rec.error }),
    source: sourceView(src),
    columns: plan.columns,
    unknownColumns: plan.unknownColumns,
    rows: plan.rows.map((r) => ({ line: r.line, outcome: r.outcome, reason: r.reason, problems: problemsFor(r.problems), title: r.title, subtitle: r.subtitle, money: moneyView(r.money) })),
  };
}

export async function loadRun(ctx: ServiceContext, id: string): Promise<{ ws: ServiceWorkspace; run: Run }> {
  if (!ctx.workspace) throw forbidden("workspace_required", "Name a workspace for this action");
  const run = await ctx.repos.table("import_runs").one({ id, workspace_id: ctx.workspace.id });
  if (!run) throw notFound("Import run");
  const ws = await importWorkspace(ctx, targetOf(run.target));
  return { ws, run };
}

export async function getImportRun(ctx: ServiceContext, id: string) {
  const { run } = await loadRun(ctx, id);
  const rows = await ctx.repos.table("import_rows").find({ run_id: run.id, workspace_id: run.workspace_id }, { orderBy: "line" });
  const progress: Progress = { toWrite: rows.filter((r) => r.outcome === "create" && !r.written_at).length, written: rows.filter((r) => r.outcome === "create" && r.written_at).length, skipped: rows.filter((r) => r.outcome === "skip").length, failed: rows.filter((r) => r.outcome === "error").length };
  return { run: runView(ctx, run, progress), rows: rows.map(logView) };
}

/**
 * A checked import's outcome without its rows, for agents (MCP `get_import_preview`): what would be
 * created, skipped or needs a fix, the amounts by year, and the names of the columns left out as
 * bank or identity data, and which grants system's export it read (with where a Fluxx or Zengine
 * pull continues). The same check as the import screen; importing the rows is a person's.
 */
export async function importPreview(ctx: ServiceContext, id: string) {
  const { run } = await loadRun(ctx, id);
  const view = runView(ctx, run, await progressOf(ctx, run.id));
  return { id: view.id, target: view.target, source: view.source, sourceLabel: view.sourceLabel, status: view.status, rowsTotal: view.rowsTotal, reconciliation: view.reconciliation, droppedColumns: view.dropped.map((d) => d.column), progress: view.progress, createdAt: view.createdAt, expiresAt: view.expiresAt, adapter: view.adapter, nextPage: view.nextPage };
}

export async function listImportRuns(ctx: ServiceContext, target: TargetKey) {
  const ws = await importWorkspace(ctx, target);
  const runs = await ctx.repos.table("import_runs").find({ workspace_id: ws.id, target }, { orderBy: "created_at", ascending: false, limit: 20 });
  return runs.map((r) => runView(ctx, r, null));
}

// ------------------------------------------------------------------------------------ commit

interface WriteDeps {
  funderRecords: Row<"funder_records">[];
  awards: AwardImportContext | null;
}

/** Record what the funder paid on an imported award as paid elsewhere: a resolve-mode tranche, walked through the machine. */
async function recordPaidElsewhere(ctx: ServiceContext, wsId: string, awardId: string, currency: string, p: NonNullable<HistoryRecord["payment"]>) {
  const schedule = (await ctx.repos.table("payment_schedules").one({ award_id: awardId })) ?? (await ctx.repos.table("payment_schedules").insert({ workspace_id: wsId, award_id: awardId, currency, notes: "Imported grant history" }));
  let tranche = await ctx.repos.table("tranches").one({ award_id: awardId, seq: 1 });
  if (!tranche) {
    const id = crypto.randomUUID();
    // Created scheduled like any tranche; its status moves only through the machine below.
    tranche = await ctx.repos.table("tranches").insert({ id, workspace_id: wsId, award_id: awardId, schedule_id: schedule.id, seq: 1, amount_minor: p.amountMinor, currency, condition: { type: "manual" }, status: "scheduled", due_at: null, idempotency_key: `trn_${id}` });
  }
  if (tranche.status !== "scheduled" && tranche.status !== "due") return;
  // The GMS never knew where the money went, so the record has a reference and a date and no
  // destination digits (an ExternalPaymentRecord's last4 is left out on purpose).
  const external: ExternalPaymentRecord = { reference: p.reference, paidAt: p.paidOn };
  await applyTrancheUpdate(ctx, { trancheId: tranche.id, path: tranche.status === "scheduled" ? ["due", "settled"] : ["settled"], patch: { mode: "resolve", external, dueAt: `${p.paidOn}T00:00:00.000Z`, ...(ctx.actor.userId ? { releasedBy: ctx.actor.userId } : {}) }, reason: "imported" }, "funder");
}

async function writeHistory(ctx: ServiceContext, wsId: string, rec: HistoryRecord, deps: WriteDeps, id: string) {
  let award = await ctx.repos.table("awards").one({ id, workspace_id: wsId });
  if (!award) {
    const planned = importedAwardRow(wsId, { recipientName: rec.recipientName, recipientEin: rec.recipientEin, title: rec.title, description: rec.description, amountMinor: rec.awardedAmountMinor, currency: rec.currency, awardDate: rec.awardDate, startDate: rec.startDate, endDate: rec.endDate, status: rec.status, programName: rec.programName }, deps.awards!, id);
    award = await guardWrite("This award", () => ctx.repos.table("awards").insert(planned.row));
    await audit(ctx, "award.imported", "award", award.id, { source: "import", recipientMatched: planned.matched, programMatched: planned.programMatched, paidElsewhere: !!rec.payment });
  }
  if (rec.payment) await recordPaidElsewhere(ctx, wsId, award.id, rec.currency, rec.payment);
}

const COULD_NOT_SAVE = "This row could not be saved. Check its values and import it again";

/**
 * Write one row of the log. The entity's id is claimed on the row first (a unique index allows one
 * written entity per row key, workspace and target), then the entity is created with that id, then
 * the row is marked written. A retried call finds the claim and finishes the same entity.
 */
async function writeRow(ctx: ServiceContext, ws: ServiceWorkspace, run: Run, row: LogRow, deps: WriteDeps): Promise<"written" | "skipped" | "failed"> {
  const rows = ctx.repos.table("import_rows");
  const entityType = run.target === "outside_applications" ? "outside_application" : "award";
  let entityId = row.entity_id;
  if (!entityId) {
    const id = crypto.randomUUID();
    try {
      const [claimed] = await rows.update({ id: row.id, entity_id: null }, { entity_id: id, entity_type: entityType });
      entityId = claimed ? id : ((await rows.one({ id: row.id }))?.entity_id ?? null);
    } catch (e) {
      if (!(e instanceof RepoError && e.kind === "conflict")) throw e;
      await rows.update({ id: row.id }, { outcome: "skip", reason: "Imported already by another import", record: null });
      return "skipped";
    }
    if (!entityId) return "skipped";
  }
  const exists = async () => (run.target === "outside_applications" ? !!(await ctx.repos.table("outside_applications").one({ id: entityId!, workspace_id: ws.id })) : !!(await ctx.repos.table("awards").one({ id: entityId!, workspace_id: ws.id })));
  try {
    if (run.target === "outside_applications") {
      if (!(await exists())) await insertImportedOutside(ctx, ws.id, row.record as unknown as OutsideRecord, deps.funderRecords, entityId);
    } else await writeHistory(ctx, ws.id, row.record as unknown as HistoryRecord, deps, entityId);
  } catch (e) {
    const refused = (e instanceof ApiError && (e.status === 409 || e.status === 422)) || (e instanceof RepoError && e.kind !== "unavailable");
    if (!refused) throw e;
    // A conflict on our own id means the entity was written after all.
    if (!(await exists())) {
      await rows.update({ id: row.id }, { entity_id: null, entity_type: null, outcome: "error", reason: null, record: null, problems: [{ message: COULD_NOT_SAVE }] as unknown as LogRow["problems"] });
      return "failed";
    }
  }
  await rows.update({ id: row.id }, { written_at: ctx.now().toISOString(), record: null });
  return "written";
}

/**
 * Import the next batch of a checked run (call again until `done`). The first call commits the run;
 * a preview older than a day must be checked again. Rows are written once each, whoever calls.
 */
export async function commitImport(ctx: ServiceContext, id: string) {
  // A person imports, on the import screen: agents and API clients may read the check, never commit
  // it, whatever their scopes (there is no MCP tool for it).
  importsArePeoples(ctx);
  const { ws, run: loaded } = await loadRun(ctx, id);
  let run = loaded;
  const target = targetOf(run.target);
  if (run.finished_at) return { run: runView(ctx, run, await progressOf(ctx, run.id)), done: true, wrote: 0 };
  if (!run.committed_at) {
    if (new Date(run.expires_at) <= ctx.now()) throw new ApiError(410, "import_expired", "This check is more than a day old. Check the rows again, then import");
    const [committed] = await ctx.repos.table("import_runs").update({ id: run.id, committed_at: null }, { committed_at: ctx.now().toISOString(), committed_by: ctx.actor.userId });
    if (committed) {
      run = committed;
      await audit(ctx, "import.committed", "import_run", run.id, { target, source: run.source });
    } else run = (await ctx.repos.table("import_runs").one({ id: run.id }))!;
  }
  const batch = await ctx.repos.table("import_rows").find({ run_id: run.id, workspace_id: ws.id, outcome: "create", written_at: null }, { orderBy: "line", limit: COMMIT_BATCH[target] });
  const deps: WriteDeps = {
    funderRecords: target === "outside_applications" ? await ctx.repos.table("funder_records").find({ workspace_id: ws.id }) : [],
    awards: target === "award_history" ? await awardImportContext(ctx, ws.id) : null,
  };
  let wrote = 0;
  for (const row of batch) if ((await writeRow(ctx, ws, run, row, deps)) === "written") wrote++;
  const progress = await progressOf(ctx, run.id);
  if (progress.toWrite === 0) {
    const [finished] = await ctx.repos.table("import_runs").update({ id: run.id, finished_at: null }, { finished_at: ctx.now().toISOString() });
    if (finished) {
      run = finished;
      await audit(ctx, "import.finished", "import_run", run.id, { target, written: progress.written, skipped: progress.skipped, failed: progress.failed });
      // Fluxx or Zengine read to its end: the funder's credentials are no longer needed, so they go.
      if ((run.source === "fluxx" || run.source === "zengine") && run.source_next_page === null) await deleteCredentials(ctx, ws.id, run.source, "finished");
    }
  }
  return { run: runView(ctx, run, progress), done: progress.toWrite === 0, wrote };
}
