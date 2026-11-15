// SPDX-License-Identifier: AGPL-3.0-only
// The import wizard's port in the browser (VITE_USE_MOCKS=true). It runs the same framework as the
// API (@gms/importers): sensitive columns dropped first, the targets' validators, row keys, the
// reconciliation, saved mappings and the idempotent run log, all in page memory. Outside
// applications are written to the outside-applications mock store, so they appear in the
// Applications list; grant history is kept in this store only. Google Sheets and Airtable are
// stand-ins with one spreadsheet and one base.
import {
  columnsFingerprint,
  DROP_REASON_TEXT,
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
  type DroppedColumn,
  type ImportTarget as Target,
  type OutsideRecord,
  type PlannedRow,
  type SourceTable,
} from "@gms/importers";
import type { Session } from "../auth/types.ts";
import { ApiError } from "../api/client.ts";
import type { ConnectedApp, ImportCommitted, ImportPreview, ImportRead, ImportRun, ImportRunDetail, ImportsApi, ImportSourceInput, ImportSources, ImportTarget } from "../api/imports.ts";
import type { OutsideApi } from "../api/outside.ts";
import type { OutsideStore } from "./outside.ts";

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
  entity: { type: "outside_application" | "award"; id: string } | null;
  written: boolean;
}

export interface ImportsStore {
  runs: { run: ImportRun; workspaceId: string; rows: MockRunRow[] }[];
  /** Written row keys by workspace and target: what makes a re-run skip. */
  written: Map<string, string>;
  mappings: Map<string, Record<string, string>>;
  connected: Record<ConnectedApp, boolean>;
  sheets: Record<string, Record<string, string[][]>>;
  airtable: Record<string, { tables: { id: string; name: string; fields: string[] }[]; records: Record<string, { id: string; fields: Record<string, unknown> }[]> }>;
  /** Grant history written in mock mode (there is no mock awards store to share). */
  awards: { id: string; title: string; recipientName: string; amountMinor: number; paidMinor: number | null }[];
}

export function seedImportsStore(): ImportsStore {
  return {
    runs: [],
    written: new Map(),
    mappings: new Map(),
    connected: { google_sheets: false, airtable: false },
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

const SOURCE_LABEL = { csv: "CSV file", xlsx: "Excel workbook", google_sheets: "Google Sheets", airtable: "Airtable" } as const;
const clone = <T>(v: T): T => structuredClone(v);
const invalid = (code: string, message: string) => new ApiError(422, message, [{ code }]);

export function createMockImportsApi(opts: MockImportsOptions): ImportsApi {
  const store = opts.store;
  const now = () => (opts.now ?? (() => new Date()))();

  async function where(target: ImportTarget) {
    if (!(await opts.session())) throw new ApiError(401, "Sign in to continue");
    const ws = opts.workspace();
    if (!ws) throw new ApiError(400, "Open a workspace first");
    if ((target === "award_history") !== (ws.kind === "funder")) throw new ApiError(403, target === "award_history" ? "Grant history is imported into funder workspaces" : "Applications are imported into applicant workspaces");
    if (target === "award_history" && ws.role !== "admin") throw new ApiError(403, "Only a workspace admin can import grant history");
    return ws;
  }

  async function load(source: ImportSourceInput): Promise<{ table: SourceTable; label: string; ref: string | null; extra: Partial<ImportRead["source"]> }> {
    try {
      if (source.kind === "csv") return { table: tableFromCsv(source.text), label: source.fileName || "Pasted CSV", ref: null, extra: {} };
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
        ],
      };
    },

    async read(target, source): Promise<ImportRead> {
      const ws = await where(target);
      const src = await load(source);
      const s = screenColumns(src.table.header, src.table.rows.map((r) => r.cells));
      const columns = s.keep.map((i) => ({ name: src.table.header[i]!, samples: [...new Set(src.table.rows.map((r) => (r.cells[i] ?? "").trim()).filter(Boolean))].slice(0, 3) }));
      const ref = src.ref ?? (await columnsFingerprint(columns.map((c) => c.name)));
      const exact = store.mappings.get(mappingKey(ws.id, target, source.kind, ref));
      const similar = exact ? null : [...store.mappings.entries()].reverse().find(([k]) => k.startsWith(`${ws.id}|${target}|${source.kind}|`))?.[1];
      const t = TARGETS[target] as unknown as Target;
      return {
        target,
        source: { kind: source.kind, label: src.label, ...src.extra },
        rows: src.table.rows.length,
        columns,
        dropped: dropped(s.dropped),
        mapping: suggestMapping(t, columns.map((c) => c.name), exact ?? similar ?? null) as Record<string, string>,
        savedMapping: exact ? "this_source" : similar ? "similar_source" : null,
        fields: fields(target),
      };
    },

    async preview({ target, source, mapping, saveMapping }): Promise<ImportPreview> {
      const ws = await where(target);
      const src = await load(source);
      const t = TARGETS[target] as unknown as Target<string, unknown>;
      let plan = await planImport({ target: t, table: src.table, mapping, source: { kind: source.kind, ref: src.ref } });
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
      };
      const rows: MockRunRow[] = plan.rows.map((r: PlannedRow) => ({ line: r.line, key: r.key, outcome: r.outcome, reason: r.reason, problems: r.problems, record: r.outcome === "create" ? r.record : null, title: r.title, subtitle: r.subtitle, entity: null, written: false }));
      run.progress = progressOf(rows);
      store.runs.push({ run, workspaceId: ws.id, rows });
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
        else {
          const rec = row.record as { title: string; recipientName: string; awardedAmountMinor: number; payment: { amountMinor: number } | null };
          id = `awd_${crypto.randomUUID()}`;
          store.awards.push({ id, title: rec.title, recipientName: rec.recipientName, amountMinor: rec.awardedAmountMinor, paidMinor: rec.payment?.amountMinor ?? null });
        }
        store.written.set(k, now().toISOString());
        Object.assign(row, { written: true, record: null, entity: { type: r.run.target === "outside_applications" ? "outside_application" : "award", id } });
        wrote++;
      }
      const progress = progressOf(r.rows);
      if (progress.toWrite === 0 && !r.run.finishedAt) r.run.finishedAt = now().toISOString();
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
  };
}
