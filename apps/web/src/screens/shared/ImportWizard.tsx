// SPDX-License-Identifier: AGPL-3.0-only
// The import wizard: a funder's grant history or an applicant's applications, from a CSV or Excel
// file, Google Sheets or Airtable. Source → connect (for an app, when needed) → pick → map with
// suggestions → check every row (the reconciliation, and the columns left out) → import → summary.
// The server drops columns that look like bank or identity details before anything comes back;
// this screen only ever sees the columns that may be imported, and names the ones left out.
import { useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowLeft, Check, CircleCheck, CircleSlash, Database, FileSpreadsheet, Link2, Link2Off, ShieldCheck, Sheet, TriangleExclamationPoint, Upload } from "lucide-react";
import { useCurrentWorkspace } from "../../app/workspace.tsx";
import { fileSource, targetFor, type ConnectedApp, type ImportCommitted, type ImportPreview, type ImportPreviewRow, type ImportRead, type ImportRunDetail, type ImportSourceInput, type ImportTotal } from "../../api/imports.ts";
import { useImportsApi, useImportsQuery } from "../../api/importsHooks.ts";
import { ApplicantShell, FunderShell } from "../../components/shells.tsx";
import { ErrorBanner, Field, Loading, Notice, PageHeader } from "../../components/ui.tsx";
import { formatMinor } from "../../lib/format.ts";

type Step = "source" | "connect" | "pick" | "map" | "check" | "import" | "done";
type Choice = "file" | ConnectedApp;
const STEP_LABEL: Record<Step, string> = { source: "Source", connect: "Connect", pick: "Choose", map: "Match columns", check: "Check", import: "Import", done: "Done" };
const APP_LABEL: Record<ConnectedApp, string> = { google_sheets: "Google Sheets", airtable: "Airtable" };
const KIND_LABEL: Record<string, string> = { ask: "Asked", awarded: "Awarded", paid: "Paid (recorded as paid elsewhere)" };

function Steps({ steps, at }: { steps: Step[]; at: Step }) {
  const i = steps.indexOf(at);
  return (
    <ol className="stp" aria-label="Import steps" style={{ flexWrap: "wrap", rowGap: "8px", marginBottom: "18px" }}>
      {steps.map((s, n) => (
        <li key={s} style={{ display: "contents" }}>
          {n > 0 && <span className={n <= i ? "ln done" : "ln"} aria-hidden="true"></span>}
          <div className={n < i || (s === "done" && at === "done") ? "s done" : n === i ? "s on" : "s"} aria-current={n === i ? "step" : undefined}>
            <span className="n">{n < i || (s === "done" && at === "done") ? <Check className="ic ic-sm" aria-hidden="true" /> : n + 1}</span>
            {STEP_LABEL[s]}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A row's outcome, always as an icon and a label. */
function OutcomeBadge({ outcome, written }: { outcome: string; written?: boolean }) {
  if (outcome === "create")
    return (
      <span className="bdg bdg-ok">
        <CircleCheck className="ic" aria-hidden="true" />
        {written ? "Imported" : "Will be imported"}
      </span>
    );
  if (outcome === "skip")
    return (
      <span className="bdg bdg-neutral">
        <CircleSlash className="ic" aria-hidden="true" />
        Skipped
      </span>
    );
  return (
    <span className="bdg bdg-warn">
      <TriangleExclamationPoint className="ic" aria-hidden="true" />
      Needs a fix
    </span>
  );
}

function Dropped({ dropped }: { dropped: ImportRead["dropped"] }) {
  if (!dropped.length) return null;
  return (
    <Notice tone="warn" title={dropped.length === 1 ? "1 column left out" : `${dropped.length} columns left out`}>
      <p className="small" style={{ margin: "0 0 6px" }}>
        These columns look like bank or identity details, so nothing in them is imported, stored or shown. Only their names are kept, so you can see what was left out.
      </p>
      <ul aria-label="Columns left out" style={{ margin: 0, paddingLeft: "18px" }}>
        {dropped.map((d) => (
          <li key={d.column} className="small">
            <b>{d.column}</b>: {d.why}
          </li>
        ))}
      </ul>
    </Notice>
  );
}

/** Created rows' money by year, one column per kind. */
function Totals({ totals }: { totals: ImportTotal[] }) {
  const created = totals.filter((t) => t.outcome === "create");
  if (!created.length) return null;
  const kinds = [...new Set(created.map((t) => t.kind))];
  const years = [...new Set(created.map((t) => t.year))].sort((a, b) => (a ?? 9999) - (b ?? 9999));
  const currencies = [...new Set(created.map((t) => t.currency))];
  const cell = (year: number | null, kind: string) =>
    currencies
      .map((c) => created.find((t) => t.year === year && t.kind === kind && t.currency === c))
      .filter(Boolean)
      .map((t) => `${formatMinor(t!.amountMinor, t!.currency)} (${t!.rows} row${t!.rows === 1 ? "" : "s"})`)
      .join(" · ") || "—";
  return (
    <div className="tbl-wrap">
      <table className="tbl tbl-compact" aria-label="Amounts by year">
        <thead>
          <tr>
            <th>Year</th>
            {kinds.map((k) => (
              <th key={k} className="num">
                {KIND_LABEL[k] ?? k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={String(y)}>
              <td>{y ?? "No year"}</td>
              {kinds.map((k) => (
                <td key={k} className="num">
                  {cell(y, k)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const FILTERS = [
  ["all", "All rows"],
  ["create", "To import"],
  ["skip", "Skipped"],
  ["error", "Need a fix"],
] as const;
const SHOW = 200;

function RowsTable({ rows, subtitle }: { rows: ImportPreviewRow[]; subtitle: string }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const shown = rows.filter((r) => filter === "all" || r.outcome === filter);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div className="seg" role="group" aria-label="Show rows">
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" className={filter === k ? "on" : undefined} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Rows checked, scrollable" style={{ maxHeight: "360px", overflow: "auto" }}>
        <table className="tbl tbl-compact" aria-label="Rows checked">
          <thead>
            <tr>
              <th className="num">Row</th>
              <th>Title</th>
              <th>{subtitle}</th>
              <th>Check</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, SHOW).map((r) => (
              <tr key={r.line}>
                <td className="num">{r.line}</td>
                <td>{r.title}</td>
                <td>{r.subtitle ?? "—"}</td>
                <td>
                  <OutcomeBadge outcome={r.outcome} />
                </td>
                <td style={{ whiteSpace: "normal" }} className="small">
                  {r.reason ?? (r.problems.map((p) => p.message).join("; ") || "")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > SHOW && <p className="small muted">Showing the first {SHOW} of {shown.length} rows.</p>}
    </div>
  );
}

function SourceOption({ value, chosen, onChoose, icon, title, children, status }: { value: Choice; chosen: Choice | null; onChoose: (c: Choice) => void; icon: ReactNode; title: string; children: ReactNode; status?: ReactNode }) {
  return (
    <label className="card" style={{ display: "flex", gap: "12px", padding: "14px 16px", cursor: "pointer", alignItems: "flex-start", borderColor: chosen === value ? "var(--og-teal-dark)" : undefined }}>
      <input type="radio" name="import-source" value={value} checked={chosen === value} onChange={() => onChoose(value)} style={{ marginTop: "3px" }} />
      <span style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1 }}>
        <span className="row" style={{ gap: "8px", fontWeight: 700 }}>
          {icon}
          {title}
        </span>
        <span className="small muted">{children}</span>
      </span>
      {status}
    </label>
  );
}

export function ImportWizard() {
  const ws = useCurrentWorkspace()!;
  const api = useImportsApi();
  const [params] = useSearchParams();
  const funder = ws.kind === "funder";
  const target = targetFor(ws.kind);
  const base = `/w/${ws.handle}`;
  const noun = funder ? { one: "award", many: "awards", list: "Awards", to: `${base}/awards` } : { one: "application", many: "applications", list: "Applications", to: `${base}/applications` };
  const returned = params.get("connected");
  const sources = useImportsQuery((a) => a.sources(target), [target]);

  const [choice, setChoice] = useState<Choice | null>(returned === "google_sheets" || returned === "airtable" ? returned : null);
  const [step, setStep] = useState<Step>(returned === "google_sheets" || returned === "airtable" ? "pick" : "source");
  const [pasted, setPasted] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [source, setSource] = useState<ImportSourceInput | null>(null);
  const [read, setRead] = useState<ImportRead | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState(true);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [progress, setProgress] = useState<ImportCommitted | null>(null);
  const [detail, setDetail] = useState<ImportRunDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const option = (k: ConnectedApp) => (sources.status === "ready" ? sources.data.sources.find((s) => s.kind === k) : undefined);
  const needsConnect = choice !== null && choice !== "file" && option(choice)?.connected === false;
  const steps: Step[] = useMemo(() => ["source", ...(needsConnect || step === "connect" ? (["connect"] as Step[]) : []), "pick", "map", "check", "import", "done"], [needsConnect, step]);
  const columns = read?.columns ?? [];
  const missing = (read?.fields ?? []).filter((f) => f.required && !mapping[f.key]);

  async function attempt<T>(what: string, run: () => Promise<T>): Promise<T | undefined> {
    setBusy(what);
    setError(null);
    try {
      return await run();
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function readSource(src: ImportSourceInput) {
    const r = await attempt("read", () => api.read(target, src));
    if (!r) return;
    setSource(src);
    setRead(r);
    setMapping(r.mapping);
    setPreview(null);
    setStep("map");
  }

  async function pick() {
    if (choice === "file") {
      const src = file ? await fileSource(file) : { kind: "csv" as const, text: pasted, fileName: "Pasted CSV" };
      return readSource(src);
    }
    if (choice === "google_sheets") return readSource({ kind: "google_sheets", url: link });
    if (choice === "airtable") return readSource({ kind: "airtable", url: link });
  }

  async function connect(app: ConnectedApp) {
    const r = await attempt("connect", () => api.connect(app, `${base}/import?connected=${app}`));
    if (!r) return;
    if (r.connectUrl) window.location.assign(r.connectUrl);
    else {
      sources.reload();
      setStep("pick");
    }
  }

  async function check() {
    if (!source) return;
    const p = await attempt("check", () => api.preview({ target, source, mapping, saveMapping: remember }));
    if (!p) return;
    setPreview(p);
    setStep("check");
  }

  async function importAll() {
    if (!preview) return;
    setStep("import");
    const done = await attempt("import", async () => {
      for (;;) {
        const c = await api.commit(preview.run.id);
        setProgress(c);
        if (c.done) return c;
      }
    });
    if (!done) return;
    const d = await attempt("summary", () => api.run(preview.run.id));
    if (d) setDetail(d);
    setStep("done");
  }

  function restart() {
    setStep("source");
    setChoice(null);
    setFile(null);
    setPasted("");
    setLink("");
    setSource(null);
    setRead(null);
    setPreview(null);
    setProgress(null);
    setDetail(null);
    setError(null);
  }

  const Shell = funder ? FunderShell : ApplicantShell;
  const title = funder ? "Import grant history" : "Import applications";
  const created = detail?.rows.filter((r) => r.entity) ?? [];
  const reconciliation = preview?.run.reconciliation;

  return (
    <>
      <title>{`${title} — ${ws.name}`}</title>
      <Shell active={noun.list}>
        <main className="main">
          <PageHeader
            crumbs={[{ label: ws.name, to: base }, { label: noun.list, to: noun.to }, { label: "Import" }]}
            title={title}
            meta={<span>{funder ? "Past awards to named organizations, with what you paid. Payments are recorded as paid elsewhere: nothing is paid from here." : "Applications you track in a spreadsheet or another app. Only your team sees them."}</span>}
          />
          <Steps steps={steps} at={step} />
          {error ? <ErrorBanner error={error} title={busy === "import" || step === "import" ? "The import stopped" : "That did not work"} /> : null}

          {step === "source" && (
            <section className="card" aria-labelledby="imp-source">
              <div className="card-h">
                <h3 id="imp-source">Where are your {noun.many}?</h3>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {sources.status === "loading" && <Loading label="Loading sources" />}
                {sources.status === "error" && <ErrorBanner error={sources.error} onRetry={sources.reload} />}
                {sources.status === "ready" && (
                  <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
                    <legend className="sr">Source</legend>
                    <SourceOption value="file" chosen={choice} onChoose={setChoice} icon={<FileSpreadsheet className="ic" aria-hidden="true" />} title="A file from your computer">
                      A CSV file or an Excel workbook (.xlsx) with a header row, up to {sources.data.maxRows.toLocaleString("en-US")} rows.
                    </SourceOption>
                    {(["google_sheets", "airtable"] as const)
                      .filter((k) => option(k))
                      .map((k) => (
                        <SourceOption
                          key={k}
                          value={k}
                          chosen={choice}
                          onChoose={setChoice}
                          icon={k === "google_sheets" ? <Sheet className="ic" aria-hidden="true" /> : <Database className="ic" aria-hidden="true" />}
                          title={APP_LABEL[k]}
                          status={
                            option(k)!.connected ? (
                              <span className="bdg bdg-ok">
                                <Link2 className="ic" aria-hidden="true" />
                                Connected
                              </span>
                            ) : (
                              <span className="bdg bdg-neutral">
                                <Link2Off className="ic" aria-hidden="true" />
                                Not connected
                              </span>
                            )
                          }
                        >
                          {k === "google_sheets" ? "Paste the link to a spreadsheet. The GMS only reads it." : "Paste the link to a base or table. The GMS only reads it."}
                        </SourceOption>
                      ))}
                  </fieldset>
                )}
              </div>
              <div className="card-f">
                <button type="button" className="btn btn-primary" disabled={!choice} onClick={() => setStep(needsConnect ? "connect" : "pick")}>
                  Continue
                </button>
                <Link to={noun.to} className="btn btn-ghost">
                  Cancel
                </Link>
              </div>
            </section>
          )}

          {step === "connect" && choice && choice !== "file" && (
            <section className="card" aria-labelledby="imp-connect">
              <div className="card-h">
                <h3 id="imp-connect">Connect {APP_LABEL[choice]}</h3>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <p className="row" style={{ gap: "8px", margin: 0 }}>
                  <ShieldCheck className="ic" aria-hidden="true" />
                  <span>
                    {choice === "google_sheets"
                      ? "You sign in with Google and allow read-only access to spreadsheets. The GMS reads only the sheet you paste the link to and never changes it."
                      : "You sign in with Airtable and allow read-only access to records and table structure. The GMS reads only the table you choose and never changes it."}
                  </span>
                </p>
                {option(choice)?.canConnect ? null : <Notice tone="info" title={`Ask a workspace admin to connect ${APP_LABEL[choice]}`}>Once it is connected, anyone who can import may use it.</Notice>}
              </div>
              <div className="card-f">
                {option(choice)?.canConnect && (
                  <button type="button" className="btn btn-primary" disabled={busy === "connect"} onClick={() => void connect(choice)}>
                    {busy === "connect" ? "Opening…" : `Connect ${APP_LABEL[choice]}`}
                  </button>
                )}
                <button type="button" className="btn btn-ghost" onClick={() => setStep("source")}>
                  <ArrowLeft className="ic" aria-hidden="true" />
                  Back
                </button>
              </div>
            </section>
          )}

          {step === "pick" && choice && (
            <section className="card" aria-labelledby="imp-pick">
              <div className="card-h">
                <h3 id="imp-pick">{choice === "file" ? "Choose the file" : choice === "google_sheets" ? "Which spreadsheet?" : "Which Airtable base?"}</h3>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {returned === choice && (
                  <Notice tone="ok" title={`${APP_LABEL[choice as ConnectedApp]} is connected`}>
                    Paste the link to read from it.
                  </Notice>
                )}
                {choice === "file" ? (
                  <>
                    <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
                      <label className="btn btn-secondary" style={{ cursor: "pointer" }}>
                        <Upload className="ic" aria-hidden="true" />
                        Choose a file
                        <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr" aria-label="Choose a file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                      </label>
                      {file && <span className="small">{file.name}</span>}
                    </div>
                    <Field id="imp-paste" label="Or paste CSV text" help="A header row first, then one row per line.">
                      <textarea id="imp-paste" className="ta mono" style={{ minHeight: "110px", fontSize: "12px" }} value={pasted} onChange={(e) => setPasted(e.target.value)} />
                    </Field>
                  </>
                ) : (
                  <Field id="imp-link" label={choice === "google_sheets" ? "Spreadsheet link" : "Airtable link"} help={choice === "google_sheets" ? "It starts with https://docs.google.com/spreadsheets/" : "It starts with https://airtable.com/app"}>
                    <input id="imp-link" className="inp" value={link} onChange={(e) => setLink(e.target.value)} />
                  </Field>
                )}
              </div>
              <div className="card-f">
                <button type="button" className="btn btn-primary" disabled={busy === "read" || (choice === "file" ? !file && !pasted.trim() : !link.trim())} onClick={() => void pick()}>
                  {busy === "read" ? "Reading…" : choice === "file" ? "Read the file" : "Read it"}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setStep("source")}>
                  <ArrowLeft className="ic" aria-hidden="true" />
                  Back
                </button>
              </div>
            </section>
          )}

          {step === "map" && read && source && (
            <section className="card" aria-labelledby="imp-map">
              <div className="card-h">
                <h3 id="imp-map">Match columns to fields</h3>
                <span className="small muted">
                  {read.source.label} · {read.rows.toLocaleString("en-US")} row{read.rows === 1 ? "" : "s"}
                </span>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <Dropped dropped={read.dropped} />
                {read.source.sheets && read.source.sheets.length > 1 && (
                  <Field id="imp-sheet" label="Sheet">
                    <select id="imp-sheet" className="sel" value={read.source.sheet ?? ""} onChange={(e) => void readSource({ ...(source as Extract<ImportSourceInput, { kind: "xlsx" | "google_sheets" }>), sheet: e.target.value })}>
                      {read.source.sheets.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {read.source.tables && read.source.tables.length > 1 && (
                  <Field id="imp-table" label="Table">
                    <select id="imp-table" className="sel" value={read.source.table ?? ""} onChange={(e) => void readSource({ ...(source as Extract<ImportSourceInput, { kind: "airtable" }>), table: e.target.value })}>
                      {read.source.tables.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {read.savedMapping && (
                  <p className="small muted" style={{ margin: 0 }}>
                    {read.savedMapping === "this_source" ? "Matched as you saved it last time for this source." : "Matched as you saved it for a similar source. Check each field."}
                  </p>
                )}
                <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="lbl">Which column fills each field</legend>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "10px", marginTop: "6px" }}>
                    {read.fields.map((f) => {
                      const col = columns.find((c) => c.name === mapping[f.key]);
                      return (
                        <Field key={f.key} id={`imp-map-${f.key}`} label={f.label} required={f.required} help={col?.samples.length ? `For example: ${col.samples.join(", ")}` : (f.help ?? undefined)}>
                          <select id={`imp-map-${f.key}`} className="sel" value={mapping[f.key] ?? ""} onChange={(e) => setMapping((m) => ({ ...Object.fromEntries(Object.entries(m).filter(([k]) => k !== f.key)), ...(e.target.value ? { [f.key]: e.target.value } : {}) }))}>
                            <option value="">Not in the file</option>
                            {columns.map((c) => (
                              <option key={c.name} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                      );
                    })}
                  </div>
                </fieldset>
                <label className="cb">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  <span>Remember this matching for the next file with these columns</span>
                </label>
                {missing.length > 0 && <p className="small muted">Choose a column for: {missing.map((f) => f.label).join(", ")}.</p>}
              </div>
              <div className="card-f">
                <button type="button" className="btn btn-primary" disabled={missing.length > 0 || busy === "check"} onClick={() => void check()}>
                  {busy === "check" ? "Checking…" : "Check the rows"}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setStep("pick")}>
                  <ArrowLeft className="ic" aria-hidden="true" />
                  Back
                </button>
              </div>
            </section>
          )}

          {step === "check" && preview && reconciliation && (
            <section className="card" aria-labelledby="imp-check">
              <div className="card-h">
                <h3 id="imp-check">Check before importing</h3>
                <span className="small muted">Nothing has been imported yet.</span>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "12px" }} role="group" aria-label="What will happen">
                  <div className="stat">
                    <span className="stat-l">To import</span>
                    <span className="stat-v">{reconciliation.create}</span>
                    <span className="stat-d">
                      <CircleCheck className="ic ic-sm" aria-hidden="true" />
                      New {reconciliation.create === 1 ? noun.one : noun.many}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat-l">Skipped</span>
                    <span className="stat-v">{reconciliation.skip}</span>
                    <span className="stat-d">
                      <CircleSlash className="ic ic-sm" aria-hidden="true" />
                      Imported before, or repeated
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat-l">Need a fix</span>
                    <span className="stat-v">{reconciliation.error}</span>
                    <span className="stat-d">
                      <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
                      Left out; fix them in the source and import again
                    </span>
                  </div>
                </div>
                <Totals totals={reconciliation.totals} />
                <Dropped dropped={preview.run.dropped} />
                <RowsTable rows={preview.rows} subtitle={funder ? "Organization" : "Funder"} />
              </div>
              <div className="card-f">
                <button type="button" className="btn btn-primary" disabled={reconciliation.create === 0} onClick={() => void importAll()}>
                  {`Import ${reconciliation.create} ${reconciliation.create === 1 ? noun.one : noun.many}`}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setStep("map")}>
                  <ArrowLeft className="ic" aria-hidden="true" />
                  Back to matching
                </button>
              </div>
            </section>
          )}

          {step === "import" && preview && (
            <section className="card" aria-labelledby="imp-run">
              <div className="card-h">
                <h3 id="imp-run">Importing</h3>
              </div>
              <div className="card-b">
                {(() => {
                  const p = progress?.run.progress ?? { written: 0, toWrite: preview.run.reconciliation.create };
                  const total = p.written + p.toWrite;
                  return (
                    <div className="mtr">
                      <div className="lbls">
                        <span>
                          Imported <b>{p.written}</b> of <b>{total}</b>
                        </span>
                      </div>
                      <div className="track" role="progressbar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={p.written}>
                        <div className="fill" style={{ width: `${total ? (p.written / total) * 100 : 100}%` }}></div>
                      </div>
                    </div>
                  );
                })()}
              </div>
              {error ? (
                <div className="card-f">
                  <button type="button" className="btn btn-primary" onClick={() => void importAll()}>
                    Continue the import
                  </button>
                </div>
              ) : null}
            </section>
          )}

          {step === "done" && (
            <section className="card" aria-labelledby="imp-done">
              <div className="card-h">
                <h3 id="imp-done">Import finished</h3>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {(() => {
                  const p = detail?.run.progress ?? progress?.run.progress;
                  return (
                    <Notice tone="ok" title={`${p?.written ?? 0} ${(p?.written ?? 0) === 1 ? noun.one : noun.many} imported`}>
                      {p && (p.skipped || p.failed) ? `${p.skipped} skipped, ${p.failed} left out with a problem.` : "Every row to import was imported."}
                    </Notice>
                  );
                })()}
                {!funder && created.length > 0 && (
                  <ul aria-label="Imported applications" style={{ margin: 0, paddingLeft: "18px" }}>
                    {created.slice(0, 20).map((r) => (
                      <li key={r.line}>
                        <Link to={`${base}/outside/${r.entity!.id}`}>{r.title}</Link>
                        {r.subtitle ? <span className="muted"> · {r.subtitle}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
                {funder && <p className="small muted">Imported awards are marked as imported. A payment you recorded shows as paid elsewhere on the award; nothing is paid from here.</p>}
              </div>
              <div className="card-f">
                <Link to={noun.to} className="btn btn-primary">
                  Open {noun.list}
                </Link>
                <button type="button" className="btn btn-ghost" onClick={restart}>
                  Import another
                </button>
              </div>
            </section>
          )}
        </main>
      </Shell>
    </>
  );
}
export default ImportWizard;
