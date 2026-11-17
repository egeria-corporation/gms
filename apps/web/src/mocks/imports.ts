// SPDX-License-Identifier: AGPL-3.0-only
// The import wizard's port in the browser (VITE_USE_MOCKS=true). It runs the same framework as the
// API (@gms/importers): sensitive columns dropped first, the targets' validators, row keys, the
// reconciliation, saved mappings and the idempotent run log, all in page memory. Outside
// applications are written to the outside-applications mock store, so they appear in the
// Applications list; grant history is kept in this store only. Google Sheets and Airtable are
// stand-ins with one spreadsheet and one base. Importer adapters (v1.9.0) run as on the server: a
// grants system's preset and its never-awarded rows set aside; Fluxx and Zengine are stand-ins
// with a few made-up records; zip files are matched by path and kept by name and size only.
// Imported history (v1.12.0): a funder's past applications, reviews and reports are written to the
// history store (mocks/history.ts), linked as the server links them.
import {
  ADAPTERS,
  adapterMapping,
  checkSoql,
  presetSoql,
  SALESFORCE_PRESET_DEFS,
  salesforcePresetsFor,
  SoqlRefusedError,
  adaptersFor,
  adapterView,
  ATTACHMENT_MISS_TEXT,
  baseName,
  columnsFingerprint,
  detectAdapter,
  DROP_REASON_TEXT,
  FILE_ADAPTERS,
  FLUXX,
  idKey,
  isPastTarget,
  matchAttachments,
  rowKey,
  mimeFor,
  setAsideNotAwarded,
  tableFromJson,
  ZENGINE,
  MAX_IMPORT_ROWS,
  planImport,
  screenColumns,
  SourceTableError,
  suggestMapping,
  tableFromCsv,
  tableFromGrid,
  tableFromRecords,
  TARGETS,
  withAlreadyImported,
  type AdapterKey,
  type DroppedColumn,
  type ImportAdapter as Adapter,
  type ImportTarget as Target,
  type OutsideRecord,
  type PlannedRow,
  type SourceTable,
} from "@gms/importers";
import type { Session } from "../auth/types.ts";
import { ApiError } from "../api/client.ts";
import type { ConnectedApp, ImportCommitted, ImportFile, ImportPreview, ImportPuller, ImportRead, ImportRun, ImportRunDetail, ImportsApi, ImportSourceInput, ImportSources, ImportTarget } from "../api/imports.ts";
import type { OutsideApi } from "../api/outside.ts";
import type { OutsideStore } from "./outside.ts";
import { attachMockHistoryFile, seedHistoryStore, writeMockHistory, type HistoryStore, type MockAwardLinks } from "./history.ts";

/** The stand-in spreadsheet and base. Their links are shown in the wizard's help in mock mode. */
export const MOCK_SHEET_ID = "1MockSheetAbCdEfGhIjKlMnOpQrStUvWxYz012345";
export const MOCK_AIRTABLE_BASE = "appMockBaseAbCdEf";
const MOCK_AIRTABLE_TABLE = "tblMockTableAbCdE";

interface MockRunRow {
  line: number;
  key: string;
  outcome: "create" | "skip" | "error";
  reason: string | null;
  problems: { field?: string; message: string }[];
  record: unknown;
  title: string;
  subtitle: string | null;
  entity: { type: "outside_application" | "award" | "history_application" | "history_review" | "history_report"; id: string } | null;
  written: boolean;
}

export interface ImportsStore {
  runs: { run: ImportRun; workspaceId: string; rows: MockRunRow[]; ref: { kind: string; ref: string | null } }[];
  /** Written row keys by workspace and target: what makes a re-run skip. */
  written: Map<string, string>;
  mappings: Map<string, Record<string, string>>;
  connected: Record<ConnectedApp, boolean>;
  /** Salesforce records read in mock mode, under the grants preset's column names. */
  salesforce: Record<string, string>[];
  sheets: Record<string, Record<string, string[][]>>;
  airtable: Record<string, { tables: { id: string; name: string; fields: string[] }[]; records: Record<string, { id: string; fields: Record<string, unknown> }[]> }>;
  /** Grant history written in mock mode (there is no mock awards store to share). */
  awards: { id: string; title: string; recipientName: string; amountMinor: number; paidMinor: number | null }[];
  /** Fluxx and Zengine: connected or not, per workspace (no credential is kept in mock mode). */
  pullers: Record<string, Partial<Record<ImportPuller, { instance: string | null; at: string }>>>;
  fluxxGrants: Record<string, string>[];
  fluxxReports: Record<string, string>[];
  zengine: { forms: { id: string; name: string; workspaceId: string; workspaceName: string }[]; columns: string[]; records: Record<string, string>[] };
  /** Files attached from a zip: names and sizes only. */
  files: (ImportFile & { runId: string })[];
  /** Imported history: past applications, reviews and reports. */
  history: HistoryStore;
}

export function seedImportsStore(): ImportsStore {
  return {
    runs: [],
    written: new Map(),
    mappings: new Map(),
    connected: { google_sheets: false, airtable: false, salesforce: false },
    salesforce: [
      { "Record ID": "006000000000001AAA", "Grant name": "Youth mentoring", Funder: "Cedar Fund", StageName: "Prospecting", Ask: "15000", Deadline: "2027-08-01" },
      { "Record ID": "006000000000002AAA", "Grant name": "Clinic van", Funder: "Harbor Trust", StageName: "Closed Won", Ask: "40000", Deadline: "2027-03-15" },
    ],
    sheets: {
      [MOCK_SHEET_ID]: {
        "Pipeline 2027": [
          ["Grant", "Funder", "Stage", "Deadline", "Ask"],
          ["Youth mentoring", "Cedar Fund", "Drafting", "2027-08-01", "15000"],
          ["Clinic van", "Harbor Trust", "Prospect", "2027-10-15", "40000"],
        ],
      },
    },
    airtable: {
      [MOCK_AIRTABLE_BASE]: {
        tables: [{ id: MOCK_AIRTABLE_TABLE, name: "Grants", fields: ["Name", "Funder", "Due"] }],
        records: { [MOCK_AIRTABLE_TABLE]: [{ id: "recMockAAAAAAAAA1", fields: { Name: "Food pantry", Funder: "Oak Fund", Due: "2027-09-01" } }] },
      },
    },
    awards: [],
    pullers: {},
    fluxxGrants: [
      { "Fluxx ID": "4101", "Request ID": "R-23-0101", Organization: "Harbor Food Bank", "Project title": "Cold storage", "Amount requested": "30000", "Amount awarded": "25000", Granted: "Yes", Status: "granted", "Approved on": "2023-05-02", "Grant begins": "2023-06-01", "Grant ends": "2024-05-31", "Closed on": "2024-07-01", "Amount paid": "25000.00", "Last paid on": "2023-06-15" },
      { "Fluxx ID": "4102", "Request ID": "R-23-0102", Organization: "Valley Singers", "Project title": "Spring tour", "Amount requested": "8000", "Amount awarded": "", Granted: "No", Status: "declined", "Approved on": "", "Grant begins": "", "Grant ends": "", "Closed on": "", "Amount paid": "", "Last paid on": "" },
      { "Fluxx ID": "4103", "Request ID": "R-24-0007", Organization: "Northside Youth Sports", "Project title": "Coaching clinics", "Amount requested": "12000", "Amount awarded": "12000", Granted: "Yes", Status: "granted", "Approved on": "2024-02-10", "Grant begins": "2024-03-01", "Grant ends": "2025-02-28", "Closed on": "", "Amount paid": "6000.00", "Last paid on": "2024-03-05" },
    ],
    // Reports on the grant requests above (request_report), for past reports.
    fluxxReports: [
      { "Report Fluxx ID": "7101", "Grant Fluxx ID": "4101", Organization: "Harbor Food Bank", "Project title": "Cold storage", "Report type": "Final report", "Due on": "2024-08-31", "Approved on": "2024-09-12", Status: "approved" },
      { "Report Fluxx ID": "7102", "Grant Fluxx ID": "4103", Organization: "Northside Youth Sports", "Project title": "Coaching clinics", "Report type": "Interim report", "Due on": "2024-09-01", "Approved on": "", Status: "new" },
    ],
    zengine: {
      forms: [{ id: "42", name: "Community grants", workspaceId: "7", workspaceName: "Grantmaking" }],
      columns: ["Zengine record ID", "Record name", "Organization", "Project title", "Amount Awarded", "Status"],
      records: [
        { "Zengine record ID": "900101", "Record name": "CG-101", Organization: "Riverside Neighbors", "Project title": "Creek cleanup", "Amount Awarded": "5000", Status: "Awarded" },
        { "Zengine record ID": "900102", "Record name": "CG-102", Organization: "Elm Street Seniors", "Project title": "Lunch club", "Amount Awarded": "", Status: "Declined" },
      ],
    },
    files: [],
    history: seedHistoryStore(),
  };
}

export interface MockImportsOptions {
  session: () => Promise<Session | null>;
  store: ImportsStore;
  /** The current workspace: its id, kind and handle. */
  workspace: () => { id: string; kind: "funder" | "applicant"; handle: string; role: string } | null;
  outside: OutsideApi;
  outsideStore: OutsideStore;
  now?: () => Date;
}

const SOURCE_LABEL = { csv: "CSV file", xlsx: "Excel workbook", google_sheets: "Google Sheets", airtable: "Airtable", json: "JSON export", fluxx: "Fluxx", zengine: "Zengine", salesforce: "Salesforce" } as const;
const PULLER_LABEL: Record<ImportPuller, string> = { fluxx: "Fluxx", zengine: "Zengine" };
const clone = <T>(v: T): T => structuredClone(v);
const invalid = (code: string, message: string) => new ApiError(422, message, [{ code }]);

export function createMockImportsApi(opts: MockImportsOptions): ImportsApi {
  const store = opts.store;
  const now = () => (opts.now ?? (() => new Date()))();

  async function where(target: ImportTarget) {
    if (!(await opts.session())) throw new ApiError(401, "Sign in to continue");
    const ws = opts.workspace();
    if (!ws) throw new ApiError(400, "Open a workspace first");
    const funderTarget = target !== "outside_applications";
    if (funderTarget !== (ws.kind === "funder")) throw new ApiError(403, funderTarget ? "Grant history is imported into funder workspaces" : "Applications are imported into applicant workspaces");
    if (funderTarget && ws.role !== "admin") throw new ApiError(403, "Only a workspace admin can import grant history");
    return ws;
  }

  async function load(source: ImportSourceInput, wsId: string, target: ImportTarget): Promise<{ table: SourceTable; label: string; ref: string | null; extra: Partial<ImportRead["source"]> }> {
    try {
      if (source.kind === "csv") return { table: tableFromCsv(source.text), label: source.fileName || "Pasted CSV", ref: null, extra: {} };
      if (source.kind === "json") return { table: tableFromJson(source.text), label: source.fileName || "JSON export", ref: null, extra: {} };
      if (source.kind === "fluxx" || source.kind === "zengine") {
        if (!store.pullers[wsId]?.[source.kind]) throw new ApiError(409, `Connect ${PULLER_LABEL[source.kind]} first`, [{ code: "source_not_connected" }]);
        if ((source.startPage ?? 1) > 1) throw invalid("empty_source", `${PULLER_LABEL[source.kind]} has no more records after the ones imported`);
        if (source.kind === "fluxx") {
          // Past reports read Fluxx's reports; every other target its grant requests (as the server's puller).
          const reports = target === "history_reports";
          const rows = reports ? store.fluxxReports : store.fluxxGrants;
          const records = rows.map((r) => ({ id: (reports ? r["Report Fluxx ID"] : r["Fluxx ID"])!, fields: r }));
          return { table: tableFromRecords(records, Object.keys(rows[0]!)), label: `Fluxx · ${store.pullers[wsId]!.fluxx!.instance ?? "your instance"} · ${reports ? "reports" : "grant requests"} (records 1–${records.length} of ${records.length})`, ref: "fluxx:mock", extra: { nextPage: null, total: records.length } };
        }
        const records = store.zengine.records.map((r) => ({ id: r["Zengine record ID"]!, fields: r }));
        return { table: tableFromRecords(records, store.zengine.columns), label: `Zengine · form ${source.formId} (records 1–${records.length} of ${records.length})`, ref: `zengine:form:${source.formId}`, extra: { nextPage: null, total: records.length } };
      }
      if (source.kind === "xlsx") {
        const { readXlsx } = await import("@gms/importers/xlsx");
        const bin = atob(source.base64);
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        const w = await readXlsx(bytes, source.sheet ?? null);
        return { table: w.table, label: `${source.fileName || "Workbook"} · ${w.sheet}`, ref: null, extra: { sheets: w.sheets, sheet: w.sheet } };
      }
      if (source.kind === "google_sheets") {
        if (!store.connected.google_sheets) throw new ApiError(409, "Connect Google Sheets first", [{ code: "source_not_connected" }]);
        const id = /\/d\/([A-Za-z0-9_-]{20,})/.exec(source.url)?.[1] ?? (/^[A-Za-z0-9_-]{20,}$/.test(source.url.trim()) ? source.url.trim() : null);
        if (!id) throw invalid("invalid_link", "Paste the link of a Google Sheets spreadsheet. It starts with https://docs.google.com/spreadsheets/");
        const book = store.sheets[id];
        if (!book) throw invalid("source_not_readable", "Google Sheets could not open that spreadsheet. Check the link, and that the Google account you connected can open it");
        const sheets = Object.keys(book);
        const sheet = source.sheet ?? sheets[0]!;
        if (!book[sheet]) throw invalid("sheet_not_found", `The spreadsheet has no sheet named "${sheet}"`);
        return { table: tableFromGrid(book[sheet]!), label: `Google Sheets · ${sheet}`, ref: `${id}/${sheet}`, extra: { sheets, sheet } };
      }
      if (source.kind === "salesforce") {
        // Salesforce in mock mode: the records as the grants preset names them, after the server's own
        // read-only check of a query (@gms/importers, sources/salesforce.ts).
        if (!store.connected.salesforce) throw new ApiError(409, "Connect Salesforce first", [{ code: "source_not_connected" }]);
        try {
          if (source.preset) presetSoql(source.preset, { target });
          else checkSoql(source.query ?? "");
        } catch (e) {
          if (e instanceof SoqlRefusedError) throw invalid("invalid_query", e.message);
          throw e;
        }
        return { table: tableFromRecords(store.salesforce.map((r) => ({ id: String(r["Record ID"]), fields: r })), []), label: "Salesforce", ref: source.preset ? `preset:${source.preset}` : "soql", extra: {} };
      }
      if (!store.connected.airtable) throw new ApiError(409, "Connect Airtable first", [{ code: "source_not_connected" }]);
      const baseId = /(app[A-Za-z0-9]{14})/.exec(source.url)?.[1];
      const base = baseId ? store.airtable[baseId] : undefined;
      if (!baseId || !base) throw invalid("invalid_link", "Paste the link of an Airtable base or table. It starts with https://airtable.com/app");
      const t = source.table ? base.tables.find((x) => x.id === source.table || x.name === source.table) : base.tables[0];
      if (!t) throw invalid("table_not_found", "The base has no such table");
      return { table: tableFromRecords(base.records[t.id] ?? [], t.fields), label: `Airtable · ${t.name}`, ref: `${baseId}/${t.id}`, extra: { tables: base.tables.map((x) => ({ id: x.id, name: x.name })), table: t.id } };
    } catch (e) {
      if (e instanceof SourceTableError) throw invalid(e.code, e.message);
      throw e;
    }
  }

  const fields = (target: ImportTarget) => (TARGETS[target] as unknown as Target).fields.map((f) => ({ key: f.key, label: f.label, kind: f.kind, required: !!f.required, help: f.help ?? null }));
  const dropped = (d: DroppedColumn[]) => d.map((x) => ({ column: x.column, reason: x.reason, why: DROP_REASON_TEXT[x.reason] }));
  const mappingKey = (wsId: string, target: string, kind: string, ref: string) => `${wsId}|${target}|${kind}|${ref}`;
  const writtenKey = (wsId: string, target: string, key: string) => `${wsId}|${target}|${key}`;
  const progressOf = (rows: MockRunRow[]) => ({ toWrite: rows.filter((r) => r.outcome === "create" && !r.written).length, written: rows.filter((r) => r.outcome === "create" && r.written).length, skipped: rows.filter((r) => r.outcome === "skip").length, failed: rows.filter((r) => r.outcome === "error").length });
  const runOf = (id: string, wsId: string) => {
    const r = store.runs.find((x) => x.run.id === id && x.workspaceId === wsId);
    if (!r) throw new ApiError(404, "Import run not found");
    return r;
  };

  async function writeOutside(rec: OutsideRecord): Promise<string> {
    const made = await opts.outside.create({
      source: "import",
      title: rec.title,
      funderName: rec.funderName,
      ...(rec.programName ? { programName: rec.programName } : {}),
      ...(rec.loiDue ? { loiDue: rec.loiDue } : {}),
      ...(rec.fullDue ? { fullDue: rec.fullDue } : {}),
      ...(rec.internalDue ? { internalDue: rec.internalDue } : {}),
      ...(rec.listingUrl ? { listingUrl: rec.listingUrl } : {}),
      ...(rec.portalUrl ? { portalUrl: rec.portalUrl } : {}),
      rolling: rec.rolling,
      ...(rec.askAmountMinor !== null ? { askAmount: { amount: (rec.askAmountMinor / 100).toFixed(2), currency: rec.currency } } : {}),
    });
    // The mock's create starts every application drafting; an imported one keeps its stage.
    const a = opts.outsideStore.applications.find((x) => x.id === made.id);
    if (a) a.stage = rec.stage;
    return made.id;
  }

  return {
    async sources(target): Promise<ImportSources> {
      const ws = await where(target);
      const admin = ws.role === "admin";
      return {
        target,
        maxRows: MAX_IMPORT_ROWS,
        maxXlsxBytes: 4 * 1024 * 1024,
        fields: fields(target),
        sources: [
          { kind: "csv", label: SOURCE_LABEL.csv, connected: true, canConnect: false },
          { kind: "xlsx", label: SOURCE_LABEL.xlsx, connected: true, canConnect: false },
          { kind: "google_sheets", label: SOURCE_LABEL.google_sheets, connected: store.connected.google_sheets, canConnect: admin },
          { kind: "airtable", label: SOURCE_LABEL.airtable, connected: store.connected.airtable, canConnect: admin },
          { kind: "salesforce", label: SOURCE_LABEL.salesforce, connected: store.connected.salesforce, canConnect: admin, presets: salesforcePresetsFor(target).map((p) => ({ key: p, label: SALESFORCE_PRESET_DEFS[p].label })) },
          ...(target !== "outside_applications" ? (["fluxx", "zengine"] as const).filter((k) => !!ADAPTERS[k].presets[target]).map((k) => ({ kind: k, label: PULLER_LABEL[k], connected: !!store.pullers[ws.id]?.[k], canConnect: admin })) : []),
        ],
        adapters: adaptersFor(target).map((a) => adapterView(a, target)),
      };
    },

    async read(target, source, named): Promise<ImportRead> {
      const ws = await where(target);
      const src = await load(source, ws.id, target);
      const s = screenColumns(src.table.header, src.table.rows.map((r) => r.cells));
      const columns = s.keep.map((i) => ({ name: src.table.header[i]!, samples: [...new Set(src.table.rows.map((r) => (r.cells[i] ?? "").trim()).filter(Boolean))].slice(0, 3) }));
      const ref = src.ref ?? (await columnsFingerprint(columns.map((c) => c.name)));
      const exact = store.mappings.get(mappingKey(ws.id, target, source.kind, ref));
      const similar = exact ? null : [...store.mappings.entries()].reverse().find(([k]) => k.startsWith(`${ws.id}|${target}|${source.kind}|`))?.[1];
      const t = TARGETS[target] as unknown as Target;
      const names = columns.map((c) => c.name);
      const { adapter, detected } = adapterFor(target, source.kind, named, names);
      return {
        target,
        source: { kind: source.kind, label: src.label, ...src.extra },
        rows: src.table.rows.length,
        columns,
        dropped: dropped(s.dropped),
        mapping: (adapter ? adapterMapping(adapter, t, names, exact ? { exact } : { similar: similar ?? null }) : suggestMapping(t, names, exact ?? similar ?? null)) as Record<string, string>,
        savedMapping: exact ? "this_source" : similar ? "similar_source" : null,
        fields: fields(target),
        adapter: adapter ? { key: adapter.key, system: adapter.system } : null,
        detected: detected ? { key: detected.adapter.key, system: detected.adapter.system, matched: detected.matched } : null,
      };
    },

    async preview({ target, source, mapping, saveMapping, adapter: named }): Promise<ImportPreview> {
      const ws = await where(target);
      const src = await load(source, ws.id, target);
      const t = TARGETS[target] as unknown as Target<string, unknown>;
      let plan = await planImport({ target: t, table: src.table, mapping, source: { kind: source.kind, ref: src.ref } });
      const { adapter } = adapterFor(target, source.kind, named, plan.columns);
      if (adapter) plan = setAsideNotAwarded(plan, src.table, adapter, t);
      if (plan.missingRequired.length) throw invalid("mapping_incomplete", `Choose a column for: ${plan.missingRequired.map((f) => t.fields.find((x) => x.key === f)?.label ?? f).join(", ")}`);
      const already = new Map(plan.rows.filter((r) => store.written.has(writtenKey(ws.id, target, r.key))).map((r) => [r.key, store.written.get(writtenKey(ws.id, target, r.key)) ?? null]));
      plan = withAlreadyImported(plan, already);
      if (saveMapping) store.mappings.set(mappingKey(ws.id, target, source.kind, src.ref ?? (await columnsFingerprint(plan.columns))), plan.mapping as Record<string, string>);
      const at = now();
      const run: ImportRun = {
        id: crypto.randomUUID(),
        target,
        source: source.kind,
        sourceLabel: src.label,
        mapping: plan.mapping as Record<string, string>,
        dropped: dropped(plan.dropped),
        reconciliation: plan.reconciliation,
        rowsTotal: plan.rows.length,
        status: "checked",
        createdAt: at.toISOString(),
        committedAt: null,
        finishedAt: null,
        expiresAt: new Date(at.getTime() + 24 * 3600 * 1000).toISOString(),
        adapter: adapter ? { key: adapter.key, system: adapter.system } : null,
        nextPage: null,
      };
      const rows: MockRunRow[] = plan.rows.map((r: PlannedRow) => ({ line: r.line, key: r.key, outcome: r.outcome, reason: r.reason, problems: r.problems, record: r.outcome === "create" ? r.record : null, title: r.title, subtitle: r.subtitle, entity: null, written: false }));
      run.progress = progressOf(rows);
      store.runs.push({ run, workspaceId: ws.id, rows, ref: { kind: source.kind, ref: src.ref } });
      return clone({ run, source: { kind: source.kind, label: src.label, ...src.extra }, columns: plan.columns, unknownColumns: plan.unknownColumns, rows: plan.rows.map((r) => ({ line: r.line, outcome: r.outcome, reason: r.reason, problems: r.problems, title: r.title, subtitle: r.subtitle, money: r.money })) });
    },

    async commit(runId): Promise<ImportCommitted> {
      const ws = opts.workspace();
      if (!ws) throw new ApiError(400, "Open a workspace first");
      const r = runOf(runId, ws.id);
      await where(r.run.target);
      if (!r.run.committedAt) {
        if (new Date(r.run.expiresAt) <= now()) throw new ApiError(410, "This check is more than a day old. Check the rows again, then import", [{ code: "import_expired" }]);
        r.run.committedAt = now().toISOString();
      }
      let wrote = 0;
      // Small batches, as the API writes them, so the progress bar moves.
      for (const row of r.rows.filter((x) => x.outcome === "create" && !x.written).slice(0, r.run.target === "outside_applications" ? 50 : 20)) {
        const k = writtenKey(ws.id, r.run.target, row.key);
        if (store.written.has(k)) {
          Object.assign(row, { outcome: "skip", reason: "Imported already by another import", record: null });
          continue;
        }
        let id: string;
        if (r.run.target === "outside_applications") id = await writeOutside(row.record as OutsideRecord);
        else if (isPastTarget(r.run.target)) {
          // Imported history: linked as the server links it; a record imported before from another file is skipped.
          id = crypto.randomUUID();
          const system = r.run.adapter ? { key: r.run.adapter.key as AdapterKey, system: r.run.adapter.system } : null;
          if ((await writeMockHistory(store.history, r.run.target, row.record, id, awardLinks(ws.id), system, now().toISOString())) === "skipped") {
            Object.assign(row, { outcome: "skip", reason: "Imported already, from another file of the same export", record: null });
            continue;
          }
        } else {
          const rec = row.record as { title: string; recipientName: string; awardedAmountMinor: number; payment: { amountMinor: number } | null };
          id = `awd_${crypto.randomUUID()}`;
          store.awards.push({ id, title: rec.title, recipientName: rec.recipientName, amountMinor: rec.awardedAmountMinor, paidMinor: rec.payment?.amountMinor ?? null });
        }
        store.written.set(k, now().toISOString());
        const entityType = r.run.target === "outside_applications" ? "outside_application" : r.run.target === "history_applications" ? "history_application" : r.run.target === "history_reviews" ? "history_review" : r.run.target === "history_reports" ? "history_report" : "award";
        Object.assign(row, { written: true, record: null, entity: { type: entityType, id } });
        wrote++;
      }
      const progress = progressOf(r.rows);
      if (progress.toWrite === 0 && !r.run.finishedAt) {
        r.run.finishedAt = now().toISOString();
        // Read to its end: the stand-in forgets the connection, as the server deletes the credentials.
        if ((r.run.source === "fluxx" || r.run.source === "zengine") && r.run.nextPage === null) delete store.pullers[ws.id]?.[r.run.source];
      }
      r.run.status = r.run.finishedAt ? "done" : "importing";
      r.run.progress = progress;
      return clone({ run: r.run, done: progress.toWrite === 0, wrote });
    },

    async run(runId): Promise<ImportRunDetail> {
      const ws = opts.workspace();
      if (!ws) throw new ApiError(400, "Open a workspace first");
      const r = runOf(runId, ws.id);
      await where(r.run.target);
      return clone({ run: { ...r.run, progress: progressOf(r.rows) }, rows: r.rows.map(({ key: _k, record: _r, ...row }) => row) });
    },

    async connect(app): Promise<{ connected: boolean; connectUrl: string | null }> {
      if (!(await opts.session())) throw new ApiError(401, "Sign in to continue");
      const ws = opts.workspace();
      if (!ws || ws.role !== "admin") throw new ApiError(403, "Only a workspace admin can connect an app");
      // Mock mode has no Composio: the connection is made at once.
      store.connected[app] = true;
      return { connected: true, connectUrl: null };
    },

    async connectPuller(provider, credentials) {
      const ws = await where("award_history");
      if (ws.role !== "admin") throw new ApiError(403, "Only a workspace admin can connect an app");
      let instance: string | null = null;
      if (provider === "fluxx") {
        if (!("instanceUrl" in credentials)) throw invalid("bad_request", "Fluxx is connected with your Fluxx address and the application id and secret");
        const host = /^(?:https:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:fluxx\.io|fluxxlabs\.com))\/?$/i.exec(credentials.instanceUrl.trim())?.[1];
        if (!host) throw invalid("invalid_instance", "Paste your Fluxx address. It looks like https://yourfoundation.fluxx.io");
        if (credentials.clientSecret === "wrong") throw invalid("credentials_rejected", "Fluxx did not accept this application id and secret. Nothing was saved");
        instance = `https://${host.toLowerCase()}`;
      } else if (!("token" in credentials) || credentials.token === "wrong") throw invalid("credentials_rejected", "Zengine did not accept this access token. Nothing was saved");
      const at = now().toISOString();
      (store.pullers[ws.id] ??= {})[provider] = { instance, at };
      return { provider, label: PULLER_LABEL[provider], configured: true, connected: true, instance, connectedAt: at, lastReadAt: null };
    },

    async disconnectPuller(provider) {
      const ws = await where("award_history");
      delete store.pullers[ws.id]?.[provider];
      return { provider, label: PULLER_LABEL[provider], configured: true, connected: false, instance: null, connectedAt: null, lastReadAt: null };
    },

    async zengineForms() {
      const ws = await where("award_history");
      if (!store.pullers[ws.id]?.zengine) throw new ApiError(409, "Connect Zengine first", [{ code: "source_not_connected" }]);
      return clone(store.zengine.forms);
    },

    async matchFiles(runId, paths) {
      const { r, adapter, keyOf } = await finishedRun(runId);
      const m = await matchAttachments({ adapter, paths, rows: r.rows.filter((x) => x.written).map((x) => ({ line: x.line, key: x.key, title: x.title })), keyOf });
      const titles = new Map(r.rows.map((x) => [x.line, x.title]));
      return { matched: m.matched.map((x) => ({ ...x, title: titles.get(x.line) ?? "" })), unmatched: m.unmatched.map((x) => ({ path: x.path, name: x.name, why: ATTACHMENT_MISS_TEXT[x.why] })) };
    },

    async attachFile(runId, input) {
      const { r, adapter, keyOf } = await finishedRun(runId);
      const name = baseName(input.path);
      if (/(^|[^a-z0-9])(bank(s|ing)?|ach|void(ed)?|routing|w[-_. ]?9)(?=[^a-z0-9]|$)/i.test(name)) throw invalid("sensitive_document", "Bank and identity documents are never kept in the GMS");
      const [hit] = (await matchAttachments({ adapter, paths: [input.path], rows: r.rows.filter((x) => x.written).map((x) => ({ line: x.line, key: x.key, title: x.title })), keyOf })).matched;
      if (!hit) throw invalid("file_not_matched", "No imported award matches this file's name");
      const award = r.rows.find((x) => x.line === hit.line)!.entity!.id;
      const size = Math.floor((input.contentBase64.length * 3) / 4);
      const existing = store.files.find((f) => f.runId === runId && f.award === award && f.name === name && f.size === size);
      if (existing) return clone({ file: existing, created: false });
      const file = { runId, id: crypto.randomUUID(), name, mime: mimeFor(name), size, line: hit.line, award, createdAt: now().toISOString() };
      store.files.push(file);
      if (isPastTarget(r.run.target)) attachMockHistoryFile(store.history, r.run.target, award, { id: file.id, name, mime: file.mime, size });
      return clone({ file, created: true });
    },

    async files(runId) {
      const ws = opts.workspace();
      if (!ws) throw new ApiError(400, "Open a workspace first");
      runOf(runId, ws.id);
      return clone(store.files.filter((f) => f.runId === runId).map(({ runId: _r, ...f }) => f));
    },
  };

  /** What a mock history import links to: the awards mock grant history imports wrote (mocks have no other awards store to share). */
  function awardLinks(wsId: string): MockAwardLinks {
    const runs = store.runs.filter((x) => x.workspaceId === wsId && x.run.target === "award_history" && x.run.mapping.sourceId);
    return {
      async byExportId(id) {
        if (!id) return null;
        const hits = new Set<string>();
        for (const x of runs) {
          const key = await rowKey("award_history", { id, scope: x.ref.ref ?? `${x.ref.kind}:${x.run.mapping.sourceId}` });
          for (const row of x.rows) if (row.key === key && row.entity) hits.add(row.entity.id);
        }
        const award = hits.size === 1 ? store.awards.find((a) => a.id === [...hits][0]) : undefined;
        return award ? { id: award.id, title: award.title } : null;
      },
      all: store.awards.map((a) => ({ id: a.id, title: a.title, recipientName: a.recipientName })),
    };
  }

  async function finishedRun(runId: string) {
    const ws = opts.workspace();
    if (!ws) throw new ApiError(400, "Open a workspace first");
    const r = runOf(runId, ws.id);
    await where(r.run.target);
    if (r.run.target === "outside_applications" || r.run.target === "history_reviews") throw invalid("files_not_for_target", "Files are attached to imported grant history, past applications and past reports only");
    if (!r.run.finishedAt) throw new ApiError(409, "Finish the import first, then add the files", [{ code: "import_not_finished" }]);
    const adapter = r.run.adapter ? (ADAPTERS[r.run.adapter.key as AdapterKey] ?? null) : null;
    return { r, adapter, keyOf: idKey(r.run.target, r.ref, r.run.mapping.sourceId ?? null) };
  }
}

/** As the server: Fluxx and Zengine their own adapter; a file the one named, else the one its header row matches (grant history only). */
function adapterFor(target: ImportTarget, kind: string, named: AdapterKey | undefined, columns: readonly string[]): { adapter: Adapter | null; detected: ReturnType<typeof detectAdapter> } {
  if (kind === "fluxx" || kind === "zengine") return { adapter: kind === "fluxx" ? FLUXX : ZENGINE, detected: null };
  if (named && (ADAPTERS[named].via === "api" || !ADAPTERS[named].presets[target])) throw new ApiError(422, `${ADAPTERS[named].system} exports are imported as a funder's grant history, from a file`, [{ code: "adapter_not_for_target" }]);
  const detected = target !== "outside_applications" ? detectAdapter(columns, FILE_ADAPTERS.filter((a) => !!a.presets[target])) : null;
  return { adapter: named ? ADAPTERS[named] : (detected?.adapter ?? null), detected };
}
