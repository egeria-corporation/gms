// SPDX-License-Identifier: AGPL-3.0-only
// Report builder: pick a data set, its columns, filters, grouping and sort; preview the first 200
// rows; download up to 50,000 as CSV; save the view (private or shared with the workspace) and
// schedule it weekly or monthly to colleagues. Six starter views ship with every workspace. The
// scheduled email links here (`?file=<id>`): the file is downloaded signed in, never attached.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { CalendarClock, ChartColumn, Download, FileSpreadsheet, Lock, Play, Plus, Save, Trash2, Users, X } from "lucide-react";
import type { Aggregate, Cell, ColumnInfo, DataSet, DataSetKey, Definition, Filter, ReportResult, ReportView, ViewList } from "../../api/reports.ts";
import { useReportsMutation, useReportsQuery } from "../../api/reportsHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { StatusBadge } from "../../components/status.tsx";
import { EmptyState, ErrorBanner, Field, Loading, Notice, PageHeader, SaveNote } from "../../components/ui.tsx";
import { downloadBlob } from "../../lib/browser.ts";
import { formatDate, parseDollars } from "../../lib/format.ts";
import { AGGREGATE_WORDS, CSV_MAX_ROWS, MAX_GROUP_BY, OP_WORDS, STOPPED_WORDS, WEEKDAYS, aggregateKey, cadenceWords, displayCell, emptyDefinition, outColumns } from "../../lib/reports.ts";

const OPS_FOR: Record<ColumnInfo["type"], Filter["op"][]> = { text: ["eq", "in"], status: ["eq", "in"], number: ["eq", "between"], money: ["between", "eq"], date: ["between", "eq"] };

function defaultDefinition(ds: DataSet): Definition {
  return emptyDefinition(ds.key, ds.columns.slice(0, 4).map((c) => c.key));
}

/** A filter's value as a person types it: money in dollars, everything else as written. */
function FilterRow({ ds, filter, index, onChange, onRemove }: { ds: DataSet; filter: Filter; index: number; onChange: (f: Filter) => void; onRemove: () => void }) {
  const col = ds.columns.find((c) => c.key === filter.column) ?? ds.columns[0]!;
  const ops = OPS_FOR[col.type];
  const money = col.type === "money";
  const toText = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : money && typeof v === "number" ? String(v / 100) : String(v));
  const fromText = (s: string): string | number | undefined => {
    if (!s.trim()) return undefined;
    if (money) return parseDollars(s) ?? undefined;
    if (col.type === "number") return Number.isFinite(Number(s)) ? Number(s) : undefined;
    return s.trim();
  };
  const reset = (column: string, op?: Filter["op"]): Filter => {
    const c = ds.columns.find((x) => x.key === column)!;
    const o = op ?? OPS_FOR[c.type][0]!;
    return o === "eq" ? { column, op: o, value: c.values?.[0] ?? null } : o === "in" ? { column, op: o, values: c.values?.slice(0, 1) ?? [] } : { column, op: o };
  };
  const id = `rb-filter-${index}`;
  return (
    <div className="row" style={{ gap: "8px", flexWrap: "wrap" }} role="group" aria-label={`Filter ${index + 1}`}>
      <select className="sel" aria-label={`Filter ${index + 1} column`} value={filter.column} onChange={(e) => onChange(reset(e.target.value))} style={{ maxWidth: "200px" }}>
        {ds.columns.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>
      <select className="sel" aria-label={`Filter ${index + 1} condition`} value={filter.op} onChange={(e) => onChange(reset(filter.column, e.target.value as Filter["op"]))} style={{ maxWidth: "150px" }}>
        {ops.map((o) => (
          <option key={o} value={o}>
            {OP_WORDS[o]}
          </option>
        ))}
      </select>
      {filter.op === "eq" && col.values && (
        <select className="sel" aria-label={`Filter ${index + 1} value`} value={String(filter.value ?? "")} onChange={(e) => onChange({ ...filter, value: e.target.value })} style={{ maxWidth: "200px" }}>
          {col.values.map((v) => (
            <option key={v} value={v}>
              {v.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase())}
            </option>
          ))}
        </select>
      )}
      {filter.op === "eq" && !col.values && <input className="inp" id={id} aria-label={`Filter ${index + 1} value`} value={toText(filter.value)} onChange={(e) => onChange({ ...filter, value: fromText(e.target.value) ?? null })} style={{ maxWidth: "200px" }} placeholder={col.type === "date" ? "YYYY-MM-DD" : money ? "Dollars" : ""} />}
      {filter.op === "in" && col.values && (
        <select className="sel" multiple aria-label={`Filter ${index + 1} values`} value={filter.values.map(String)} onChange={(e) => onChange({ ...filter, values: [...e.target.selectedOptions].map((o) => o.value) })} style={{ maxWidth: "220px", height: "84px" }}>
          {col.values.map((v) => (
            <option key={v} value={v}>
              {v.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase())}
            </option>
          ))}
        </select>
      )}
      {filter.op === "in" && !col.values && <input className="inp" aria-label={`Filter ${index + 1} values, separated by commas`} value={filter.values.join(", ")} onChange={(e) => onChange({ ...filter, values: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} style={{ maxWidth: "260px" }} placeholder="One, another" />}
      {filter.op === "between" && (
        <>
          <input className="inp" aria-label={`Filter ${index + 1} from`} value={toText(filter.from)} onChange={(e) => onChange({ ...filter, from: fromText(e.target.value) })} style={{ maxWidth: "150px" }} placeholder={col.type === "date" ? "From (YYYY-MM-DD)" : money ? "From ($)" : "From"} />
          <span className="small muted">and</span>
          <input className="inp" aria-label={`Filter ${index + 1} to`} value={toText(filter.to)} onChange={(e) => onChange({ ...filter, to: fromText(e.target.value) })} style={{ maxWidth: "150px" }} placeholder={col.type === "date" ? "To (YYYY-MM-DD)" : money ? "To ($)" : "To"} />
        </>
      )}
      <button type="button" className="iconbtn" aria-label={`Remove filter ${index + 1}`} onClick={onRemove}>
        <X className="ic" aria-hidden="true" />
      </button>
    </div>
  );
}

function ResultTable({ result }: { result: ReportResult }) {
  const currencyAt = result.columns.findIndex((c) => c.key === "currency");
  if (!result.rows.length)
    return (
      <EmptyState icon={FileSpreadsheet} title="No rows match">
        Loosen a filter or pick another data set.
      </EmptyState>
    );
  const cell = (v: Cell, i: number, row: Cell[]) => {
    const c = result.columns[i]!;
    if (c.type === "status" && c.statusKind && typeof v === "string") return <StatusBadge kind={c.statusKind} status={v} />;
    return displayCell(c, v, currencyAt >= 0 ? (row[currencyAt] as string | null) : null);
  };
  return (
    <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Report preview, scrollable">
      <table className="tbl tbl-compact" aria-label="Report preview">
        <thead>
          <tr>
            {result.columns.map((c) => (
              <th key={c.key} className={c.type === "money" || c.type === "number" ? "num" : undefined} title={c.note}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, r) => (
            <tr key={r}>
              {row.map((v, i) => (
                <td key={i} className={result.columns[i]!.type === "money" || result.columns[i]!.type === "number" ? "num" : undefined}>
                  {cell(v, i, row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SaveDialog({ initial, onClose, onSaved }: { initial: { name: string; definition: Definition }; onClose: () => void; onSaved: (v: ReportView) => void }) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"private" | "workspace">("private");
  const save = useReportsMutation((api, input: Parameters<typeof api.createView>[0]) => api.createView(input));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = await save.run({ name, description: description.trim() || null, visibility, definition: initial.definition });
    if (v) onSaved(v);
  };
  return (
    <Dialog open onClose={onClose} labelledBy="rb-save-title">
      <form onSubmit={submit} noValidate>
        <div className="hd">
          <h2 id="rb-save-title">Save view</h2>
        </div>
        <div className="bd">
          {save.error !== null && <ErrorBanner error={save.error} />}
          <Field id="rb-save-name" label="Name" required>
            <input className="inp" id="rb-save-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </Field>
          <Field id="rb-save-description" label="Description" help="Optional. Shown with the view.">
            <textarea className="ta" id="rb-save-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
          </Field>
          <fieldset className="col" style={{ border: 0, padding: 0, margin: 0, gap: "8px" }}>
            <legend className="lbl">Who sees it</legend>
            <label className="row">
              <input type="radio" name="rb-visibility" checked={visibility === "private"} onChange={() => setVisibility("private")} />
              <Lock className="ic ic-sm" aria-hidden="true" /> Only me
            </label>
            <label className="row">
              <input type="radio" name="rb-visibility" checked={visibility === "workspace"} onChange={() => setVisibility("workspace")} />
              <Users className="ic ic-sm" aria-hidden="true" /> Shared with the workspace
            </label>
          </fieldset>
        </div>
        <div className="ft">
          <SaveNote state={save.state === "saving" ? "saving" : "idle"} />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.state === "saving" || !name.trim()}>
            Save view
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ScheduleDialog({ view, onClose, onSaved }: { view: ReportView; onClose: () => void; onSaved: (v: ReportView) => void }) {
  const recipients = useReportsQuery((api) => api.recipients(view.id), [view.id]);
  const [cadence, setCadence] = useState<"weekly" | "monthly">(view.schedule?.cadence ?? "monthly");
  const [weekday, setWeekday] = useState(view.schedule?.weekday ?? 1);
  const [dayOfMonth, setDayOfMonth] = useState(view.schedule?.dayOfMonth ?? 1);
  const [chosen, setChosen] = useState<string[]>(view.schedule?.recipients.map((r) => r.userId) ?? []);
  const save = useReportsMutation((api, input: Parameters<typeof api.setSchedule>[1]) => api.setSchedule(view.id, input));
  const stop = useReportsMutation((api) => api.stopSchedule(view.id));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = await save.run(cadence === "weekly" ? { cadence, weekday, recipientUserIds: chosen } : { cadence, dayOfMonth, recipientUserIds: chosen });
    if (v) onSaved(v);
  };
  return (
    <Dialog open onClose={onClose} labelledBy="rb-schedule-title">
      <form onSubmit={submit} noValidate>
        <div className="hd">
          <h2 id="rb-schedule-title">Schedule “{view.name}”</h2>
        </div>
        <div className="bd">
          {(save.error ?? stop.error) !== null && <ErrorBanner error={save.error ?? stop.error} />}
          <p className="small muted" style={{ margin: 0 }}>
            The CSV is kept for 30 days. Each person gets an email with the row count and a link to download it here, signed in. The file is never attached, and it goes only to members of this workspace who can read reports.
          </p>
          <fieldset className="col" style={{ border: 0, padding: 0, margin: 0, gap: "8px" }}>
            <legend className="lbl">How often</legend>
            <div className="row" style={{ gap: "16px" }}>
              <label className="row">
                <input type="radio" name="rb-cadence" checked={cadence === "weekly"} onChange={() => setCadence("weekly")} /> Weekly
              </label>
              <label className="row">
                <input type="radio" name="rb-cadence" checked={cadence === "monthly"} onChange={() => setCadence("monthly")} /> Monthly
              </label>
            </div>
          </fieldset>
          {cadence === "weekly" ? (
            <Field id="rb-weekday" label="On">
              <select className="sel" id="rb-weekday" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {WEEKDAYS.map((w, i) => (
                  <option key={w} value={i + 1}>
                    {w}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field id="rb-day" label="Day of the month" help="1 to 28, so every month has it. Files go out early in the morning (13:00 UTC).">
              <input className="inp" id="rb-day" type="number" min={1} max={28} value={dayOfMonth} onChange={(e) => setDayOfMonth(Math.min(28, Math.max(1, Number(e.target.value) || 1)))} />
            </Field>
          )}
          <fieldset className="col" style={{ border: 0, padding: 0, margin: 0, gap: "6px" }}>
            <legend className="lbl">Send to</legend>
            {recipients.status === "loading" && <Loading label="Loading members" />}
            {recipients.status === "error" && <ErrorBanner error={recipients.error} onRetry={recipients.reload} />}
            {recipients.data?.map((r) => (
              <label key={r.userId} className="row">
                <input type="checkbox" checked={chosen.includes(r.userId)} onChange={() => setChosen((c) => (c.includes(r.userId) ? c.filter((x) => x !== r.userId) : [...c, r.userId]))} />
                {r.name} <span className="small muted">{r.role.replace(/_/g, " ")}</span>
              </label>
            ))}
            {view.visibility === "private" && <span className="help">A private view goes only to you. Share it with the workspace to send it to colleagues.</span>}
          </fieldset>
        </div>
        <div className="ft">
          <SaveNote state={save.state === "saving" ? "saving" : "idle"} />
          {view.schedule && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={async () => {
                const v = await stop.run();
                if (v) onSaved(v);
              }}
            >
              Stop schedule
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.state === "saving" || !chosen.length}>
            Save schedule
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ViewButton({ view, active, onPick }: { view: ReportView; active: boolean; onPick: () => void }) {
  return (
    <li>
      <button type="button" className={active ? "fchip on" : "fchip"} aria-pressed={active} onClick={onPick} style={{ width: "100%", height: "auto", minHeight: "30px", padding: "6px 10px", justifyContent: "flex-start", textAlign: "left", flexWrap: "wrap" }}>
        <span className="grow">{view.name}</span>
        {!view.starter && (
          <span className="small muted row" style={{ gap: "4px" }}>
            {view.visibility === "workspace" ? <Users className="ic ic-sm" aria-hidden="true" /> : <Lock className="ic ic-sm" aria-hidden="true" />}
            {view.visibility === "workspace" ? "Shared" : "Private"}
          </span>
        )}
        {view.schedule && (
          <span className="small muted row" style={{ gap: "4px", width: "100%" }}>
            <CalendarClock className="ic ic-sm" aria-hidden="true" />
            {view.schedule.active ? cadenceWords(view.schedule) : "Schedule stopped"}
          </span>
        )}
      </button>
    </li>
  );
}

export default function ReportBuilder() {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const [params, setParams] = useSearchParams();
  const fileId = params.get("file");
  const page = useReportsQuery(async (a) => {
    const [dataSets, views, files] = await Promise.all([a.dataSets(), a.listViews(), a.listFiles()]);
    return { dataSets, views, files };
  }, []);
  const [definition, setDefinition] = useState<Definition | null>(null);
  const [current, setCurrent] = useState<ReportView | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [dialog, setDialog] = useState<"save" | "schedule" | null>(null);
  const preview = useReportsMutation((a, d: Definition) => a.preview(d));
  const download = useReportsMutation(async (a, d: Definition, name: string) => {
    const f = await a.exportCsv(d, name);
    downloadBlob(f.blob, f.filename);
    return f;
  });
  const fileDownload = useReportsMutation(async (a, id: string) => {
    const f = await a.downloadFile(id);
    downloadBlob(f.blob, f.filename);
    return f;
  });
  const update = useReportsMutation((a, id: string, d: Definition) => a.updateView(id, { definition: d }));
  const remove = useReportsMutation((a, id: string) => a.deleteView(id));

  const dataSets = page.data?.dataSets ?? [];
  const ds = useMemo(() => dataSets.find((d) => d.key === definition?.dataSet) ?? null, [dataSets, definition?.dataSet]);
  // Start on the first data set the person can read.
  useEffect(() => {
    if (!definition && dataSets.length) {
      const first = dataSets.find((d) => d.available) ?? dataSets[0]!;
      setDefinition(defaultDefinition(first));
    }
  }, [dataSets, definition]);

  const out = useMemo(() => {
    if (!ds || !definition) return [];
    try {
      return outColumns(ds, definition);
    } catch {
      return [];
    }
  }, [ds, definition]);

  const setViews = (fn: (v: ViewList) => ViewList) => page.data && page.set({ ...page.data, views: fn(page.data.views) });
  const pick = (v: ReportView) => {
    setCurrent(v);
    setDefinition(structuredClone(v.definition));
    setResult(null);
    void preview.run(v.definition).then((r) => r && setResult(r));
  };
  const change = (d: Definition) => {
    setDefinition(d);
    setResult(null);
  };

  if (page.status === "loading" || (page.status === "ready" && !definition))
    return (
      <FunderShell active="Analytics">
        <main className="main">
          <Loading label="Loading the report builder" />
        </main>
      </FunderShell>
    );
  if (page.status === "error")
    return (
      <FunderShell active="Analytics">
        <main className="main">
          <ErrorBanner error={page.error} onRetry={page.reload} />
        </main>
      </FunderShell>
    );

  const d = definition!;
  const set = ds!;
  const grouped = d.groupBy.length > 0 || d.aggregates.length > 0;
  const aggregatable = set.columns.filter((c) => c.aggregatable);
  const views = page.data!.views;
  const files = page.data!.files;
  const sentFile = fileId ? files.find((f) => f.id === fileId) : undefined;
  const name = current?.name ?? `${set.label} report`;
  const changed = current && !current.starter && JSON.stringify(current.definition) !== JSON.stringify(d);
  const toggleColumn = (key: string) => change({ ...d, columns: d.columns.includes(key) ? d.columns.filter((k) => k !== key) : [...d.columns, key] });
  const setGroup = (i: number, key: string) => {
    const g = [...d.groupBy];
    if (key) g[i] = key;
    else g.splice(i, 1);
    const groupBy = [...new Set(g.filter(Boolean))].slice(0, MAX_GROUP_BY);
    change({ ...d, groupBy, aggregates: groupBy.length && !d.aggregates.length ? [{ fn: "count" }] : groupBy.length ? d.aggregates : [], sort: [] });
  };
  const addAggregate = (a: Aggregate) => !d.aggregates.some((x) => aggregateKey(x) === aggregateKey(a)) && change({ ...d, aggregates: [...d.aggregates, a] });

  return (
    <>
      <title>{`Report builder — ${ws.name}`}</title>
      <FunderShell active="Analytics">
        <main className="main">
          <PageHeader crumbs={[{ label: ws.name, to: base }, { label: "Analytics", to: `${base}/analytics` }, { label: "Report builder" }]} title="Report builder" meta={<span>Your workspace’s own records. Amounts are as recorded in the GMS; Passport’s disbursed amounts are shown apart and never added up.</span>} />
          {fileId && (
            <div style={{ marginBottom: "16px" }}>
              {sentFile ? (
                <Notice tone="ok" title={`Your scheduled report “${sentFile.viewName}” is ready`}>
                  <span className="row" style={{ gap: "12px", flexWrap: "wrap" }}>
                    {sentFile.rows.toLocaleString("en-US")} rows · kept until {formatDate(sentFile.expiresAt)}
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => void fileDownload.run(sentFile.id)}>
                      <Download className="ic" aria-hidden="true" /> Download the file
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams({}, { replace: true })}>
                      Dismiss
                    </button>
                  </span>
                </Notice>
              ) : (
                <Notice tone="warn" title="That scheduled file is not available">
                  Scheduled files are kept for 30 days and only for the people they were sent to. Run the view again for a new file.
                </Notice>
              )}
              {fileDownload.error !== null && <ErrorBanner error={fileDownload.error} />}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 280px) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
            <aside className="card" aria-label="Report views">
              <div className="card-b col" style={{ gap: "16px" }}>
                <section aria-labelledby="rb-starters">
                  <h2 id="rb-starters" className="lbl">
                    Starter views
                  </h2>
                  <ul className="col" style={{ listStyle: "none", padding: 0, margin: "8px 0 0", gap: "6px" }}>
                    {views.starters.map((v) => (
                      <ViewButton key={v.id} view={v} active={current?.id === v.id} onPick={() => pick(v)} />
                    ))}
                  </ul>
                </section>
                <section aria-labelledby="rb-saved">
                  <h2 id="rb-saved" className="lbl">
                    Saved views
                  </h2>
                  {views.saved.length ? (
                    <ul className="col" style={{ listStyle: "none", padding: 0, margin: "8px 0 0", gap: "6px" }}>
                      {views.saved.map((v) => (
                        <ViewButton key={v.id} view={v} active={current?.id === v.id} onPick={() => pick(v)} />
                      ))}
                    </ul>
                  ) : (
                    <p className="small muted">Nothing saved yet. Build a report and save it to find it here.</p>
                  )}
                </section>
                {files.length > 0 && (
                  <section aria-labelledby="rb-files">
                    <h2 id="rb-files" className="lbl">
                      Sent to you
                    </h2>
                    <ul className="col" style={{ listStyle: "none", padding: 0, margin: "8px 0 0", gap: "6px" }}>
                      {files.map((f) => (
                        <li key={f.id} className="row small" style={{ justifyContent: "space-between", gap: "8px" }}>
                          <span>
                            {f.viewName} · {f.period}
                          </span>
                          <button type="button" className="iconbtn" aria-label={`Download ${f.viewName}, ${f.period}`} onClick={() => void fileDownload.run(f.id)}>
                            <Download className="ic" aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            </aside>

            <div className="col" style={{ gap: "16px", minWidth: 0 }}>
              <section className="card" aria-labelledby="rb-build">
                <div className="card-h">
                  <h2 id="rb-build" style={{ fontSize: "16px" }}>
                    {current ? current.name : "Build a report"}
                  </h2>
                  {current?.starter && <span className="tag">Starter view · read only</span>}
                  {current && !current.starter && current.schedule && (
                    <span className="small muted row" style={{ gap: "4px" }}>
                      <CalendarClock className="ic ic-sm" aria-hidden="true" />
                      {current.schedule.active ? `${cadenceWords(current.schedule)} to ${current.schedule.recipients.length} ${current.schedule.recipients.length === 1 ? "person" : "people"}` : (STOPPED_WORDS[current.schedule.stoppedReason ?? ""] ?? "Schedule stopped")}
                    </span>
                  )}
                </div>
                <div className="card-b col" style={{ gap: "16px" }}>
                  <Field id="rb-dataset" label="Data set" help={set.description}>
                    <select
                      className="sel"
                      id="rb-dataset"
                      value={d.dataSet}
                      onChange={(e) => {
                        setCurrent(null);
                        change(defaultDefinition(dataSets.find((x) => x.key === (e.target.value as DataSetKey))!));
                      }}
                      style={{ maxWidth: "320px" }}
                    >
                      {dataSets.map((x) => (
                        <option key={x.key} value={x.key} disabled={!x.available}>
                          {x.label}
                          {x.available ? "" : " (not available to you)"}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <fieldset className="col" style={{ border: 0, padding: 0, margin: 0, gap: "8px" }}>
                    <legend className="lbl">Columns</legend>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "6px 16px" }}>
                      {set.columns.map((c) => (
                        <label key={c.key} className="row small" title={c.source}>
                          <input type="checkbox" checked={d.columns.includes(c.key)} onChange={() => toggleColumn(c.key)} disabled={d.columns.length === 1 && d.columns.includes(c.key)} />
                          {c.label}
                          {c.note && <span className="muted">(read only)</span>}
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <fieldset className="col" style={{ border: 0, padding: 0, margin: 0, gap: "8px" }}>
                    <legend className="lbl">Filters</legend>
                    {d.filters.map((f, i) => (
                      <FilterRow key={i} ds={set} filter={f} index={i} onChange={(nf) => change({ ...d, filters: d.filters.map((x, j) => (j === i ? nf : x)) })} onRemove={() => change({ ...d, filters: d.filters.filter((_, j) => j !== i) })} />
                    ))}
                    <span className="help">Dates are YYYY-MM-DD, or relative to the day the report runs: today, today+90d, startOfYear, endOfYear.</span>
                    <div>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => change({ ...d, filters: [...d.filters, { column: set.columns[0]!.key, op: "eq", value: null }] })}>
                        <Plus className="ic" aria-hidden="true" /> Add filter
                      </button>
                    </div>
                  </fieldset>

                  <div className="fld-row">
                    <Field id="rb-group-1" label="Group by">
                      <select className="sel" id="rb-group-1" value={d.groupBy[0] ?? ""} onChange={(e) => setGroup(0, e.target.value)}>
                        <option value="">No grouping</option>
                        {set.columns.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field id="rb-group-2" label="Then by">
                      <select className="sel" id="rb-group-2" value={d.groupBy[1] ?? ""} onChange={(e) => setGroup(1, e.target.value)} disabled={!d.groupBy.length}>
                        <option value="">Nothing else</option>
                        {set.columns
                          .filter((c) => c.key !== d.groupBy[0])
                          .map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.label}
                            </option>
                          ))}
                      </select>
                    </Field>
                  </div>

                  {grouped && (
                    <fieldset className="col" style={{ border: 0, padding: 0, margin: 0, gap: "8px" }}>
                      <legend className="lbl">Summaries</legend>
                      <div className="filterbar">
                        {d.aggregates.map((a) => (
                          <span key={aggregateKey(a)} className="chip">
                            {a.fn === "count" ? "Count" : `${AGGREGATE_WORDS[a.fn]} ${set.columns.find((c) => c.key === a.column)?.label.toLowerCase() ?? a.column}`}
                            <button type="button" className="iconbtn" aria-label={`Remove ${a.fn === "count" ? "count" : `${AGGREGATE_WORDS[a.fn].toLowerCase()} of ${a.column}`}`} onClick={() => change({ ...d, aggregates: d.aggregates.filter((x) => aggregateKey(x) !== aggregateKey(a)), sort: [] })} style={{ width: "20px", height: "20px" }}>
                              <X className="ic ic-sm" aria-hidden="true" />
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                        <label className="sr" htmlFor="rb-agg">
                          Add a summary
                        </label>
                        <select
                          className="sel"
                          id="rb-agg"
                          value=""
                          onChange={(e) => {
                            const [fn, column] = e.target.value.split(":") as [Aggregate["fn"], string | undefined];
                            if (fn) addAggregate(fn === "count" ? { fn } : { fn, column: column! });
                          }}
                          style={{ maxWidth: "320px" }}
                        >
                          <option value="">Add a summary…</option>
                          <option value="count">Count</option>
                          {aggregatable.flatMap((c) => [
                            <option key={`sum:${c.key}`} value={`sum:${c.key}`}>
                              Total {c.label.toLowerCase()}
                            </option>,
                            <option key={`avg:${c.key}`} value={`avg:${c.key}`}>
                              Average {c.label.toLowerCase()}
                            </option>,
                          ])}
                        </select>
                      </div>
                    </fieldset>
                  )}

                  <div className="fld-row">
                    <Field id="rb-sort" label="Sort by">
                      <select className="sel" id="rb-sort" value={d.sort[0]?.column ?? ""} onChange={(e) => change({ ...d, sort: e.target.value ? [{ column: e.target.value, dir: d.sort[0]?.dir ?? "asc" }] : [] })}>
                        <option value="">As stored</option>
                        {out.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field id="rb-dir" label="Order">
                      <select className="sel" id="rb-dir" value={d.sort[0]?.dir ?? "asc"} disabled={!d.sort.length} onChange={(e) => change({ ...d, sort: d.sort.map((s, i) => (i === 0 ? { ...s, dir: e.target.value as "asc" | "desc" } : s)) })}>
                        <option value="asc">Smallest or earliest first</option>
                        <option value="desc">Largest or latest first</option>
                      </select>
                    </Field>
                  </div>

                  {(preview.error ?? download.error ?? update.error ?? remove.error) !== null && <ErrorBanner error={preview.error ?? download.error ?? update.error ?? remove.error} />}
                  <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-primary" onClick={() => void preview.run(d).then((r) => r && setResult(r))} disabled={preview.state === "saving"}>
                      <Play className="ic" aria-hidden="true" /> Preview
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => void download.run(d, name)} disabled={download.state === "saving"}>
                      <Download className="ic" aria-hidden="true" /> Download CSV
                    </button>
                    {(!current || current.starter || !current.mine) && (
                      <button type="button" className="btn btn-secondary" onClick={() => setDialog("save")}>
                        <Save className="ic" aria-hidden="true" /> {current ? "Save a copy" : "Save view"}
                      </button>
                    )}
                    {current?.mine && changed && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={async () => {
                          const v = await update.run(current.id, d);
                          if (v) {
                            setCurrent(v);
                            setViews((l) => ({ ...l, saved: l.saved.map((x) => (x.id === v.id ? v : x)) }));
                          }
                        }}
                      >
                        <Save className="ic" aria-hidden="true" /> Save changes
                      </button>
                    )}
                    {current?.mine && (
                      <button type="button" className="btn btn-secondary" onClick={() => setDialog("schedule")}>
                        <CalendarClock className="ic" aria-hidden="true" /> {current.schedule ? "Change schedule" : "Schedule"}
                      </button>
                    )}
                    {current && !current.starter && (current.mine || current.visibility === "workspace") && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={async () => {
                          if (!window.confirm(`Remove “${current.name}”? Its schedule stops and its files are removed.`)) return;
                          const r = await remove.run(current.id);
                          if (r) {
                            setViews((l) => ({ ...l, saved: l.saved.filter((x) => x.id !== current.id) }));
                            setCurrent(null);
                          }
                        }}
                      >
                        <Trash2 className="ic" aria-hidden="true" /> Remove
                      </button>
                    )}
                    <SaveNote state={update.state} savedText="Changes saved" />
                  </div>
                  <span className="help">A download holds up to {CSV_MAX_ROWS.toLocaleString("en-US")} rows. Cells that start with = + - or @ are written so a spreadsheet does not run them.</span>
                </div>
              </section>

              <section className="card" aria-labelledby="rb-preview">
                <div className="card-h">
                  <h2 id="rb-preview" style={{ fontSize: "16px" }}>
                    Preview
                  </h2>
                  {result && <span className="small muted">{result.truncated ? `Showing the first ${result.rows.length.toLocaleString("en-US")} of ${result.total.toLocaleString("en-US")} ${grouped ? "groups" : "rows"}` : `${result.total.toLocaleString("en-US")} ${grouped ? (result.total === 1 ? "group" : "groups") : result.total === 1 ? "row" : "rows"}`}</span>}
                </div>
                <div className="card-b col" style={{ gap: "12px" }}>
                  {result?.warnings.map((w) => (
                    <Notice key={w} tone="warn" title="Note">
                      {w}
                    </Notice>
                  ))}
                  {preview.state === "saving" && <Loading label="Running the report" />}
                  {result ? (
                    <ResultTable result={result} />
                  ) : (
                    preview.state !== "saving" && (
                      <EmptyState icon={ChartColumn} title="Nothing to show yet">
                        Choose columns and filters, then press Preview to see the first 200 rows.
                      </EmptyState>
                    )
                  )}
                </div>
              </section>
            </div>
          </div>
          {dialog === "save" && (
            <SaveDialog
              initial={{ name: current ? (current.starter ? current.name : `${current.name} (copy)`) : "", definition: d }}
              onClose={() => setDialog(null)}
              onSaved={(v) => {
                setDialog(null);
                setCurrent(v);
                setViews((l) => ({ ...l, saved: [...l.saved, v].sort((a, b) => a.name.localeCompare(b.name)) }));
              }}
            />
          )}
          {dialog === "schedule" && current && (
            <ScheduleDialog
              view={current}
              onClose={() => setDialog(null)}
              onSaved={(v) => {
                setDialog(null);
                setCurrent(v);
                setViews((l) => ({ ...l, saved: l.saved.map((x) => (x.id === v.id ? v : x)) }));
              }}
            />
          )}
        </main>
      </FunderShell>
    </>
  );
}
