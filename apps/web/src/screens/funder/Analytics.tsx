// SPDX-License-Identifier: AGPL-3.0-only
// Analytics: committed against paid by program (paid amounts are the figures last read from
// Passport), one cycle's funnel, and the exports: the 990-PF grant list, the CommonGrants bundle,
// and a CSV import of awards from another system with column mapping and a dry run.
import { downloadBlob } from "../../lib/browser.ts";
import { useState } from "react";
import { ChartColumn, Download, TriangleExclamationPoint, Upload } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { CsvImportResult, CycleReport, Portfolio } from "../../api/funderMoney.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { EmptyState, ErrorBanner, Field, Loading, Notice, PageHeader, Tabs, TabPanel } from "../../components/ui.tsx";
import { formatMinor } from "../../lib/format.ts";
import { dateTime } from "./shared.tsx";

type Tab = "portfolio" | "cycle" | "exports";
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.min(100, Math.round((part / whole) * 1000) / 10)}%` : "0%");
const words = (key: string) => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const TARGETS: { key: string; label: string; required?: boolean }[] = [
  { key: "recipientName", label: "Recipient name", required: true },
  { key: "title", label: "Award title", required: true },
  { key: "awardedAmount", label: "Awarded amount", required: true },
  { key: "recipientEin", label: "Recipient EIN" },
  { key: "startDate", label: "Period start" },
  { key: "endDate", label: "Period end" },
  { key: "status", label: "Status" },
];

function Counts({ title, counts }: { title: string; counts: Record<string, unknown> }) {
  const rows = Object.entries(counts).filter((e): e is [string, number] => typeof e[1] === "number");
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <section className="card" aria-label={title}>
      <div className="card-h">
        <h3>{title}</h3>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {rows.map(([k, n]) => (
          <div className="bar-h" key={k}>
            <span>{words(k)}</span>
            <div className="trk" role="img" aria-label={`${words(k)}: ${n}`}>
              <div className="f1" style={{ width: pct(n, max) }} />
            </div>
            <span className="num b">{n}</span>
          </div>
        ))}
        {!rows.length && <span className="muted small">Nothing to count yet.</span>}
      </div>
    </section>
  );
}

function PortfolioPanel({ data }: { data: Portfolio }) {
  const scale = Math.max(1, ...data.programs.map((p) => Math.max(p.budgetMinor ?? 0, p.committedMinor)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "16px" }}>
        <div className="stat">
          <span className="stat-l">Budget</span>
          <span className="stat-v">{formatMinor(data.totals.budgetMinor)}</span>
        </div>
        <div className="stat">
          <span className="stat-l">Committed</span>
          <span className="stat-v">{formatMinor(data.totals.committedMinor)}</span>
          <span className="stat-d">{data.totals.awards} awards</span>
        </div>
        <div className="stat">
          <span className="stat-l">Paid</span>
          <span className="stat-v">{formatMinor(data.totals.paidMinor)}</span>
          <span className="stat-d">{data.paidAsOf ? `Read from Passport ${dateTime(data.paidAsOf)}` : "Not read from Passport yet"}</span>
        </div>
        <div className="stat">
          <span className="stat-l">Committed, not yet paid</span>
          <span className="stat-v">{formatMinor(data.totals.committedMinor - data.totals.paidMinor)}</span>
        </div>
      </div>
      <section className="card" aria-labelledby="by-program-h">
        <div className="card-h">
          <h2 id="by-program-h" style={{ fontSize: "16px" }}>
            Committed vs paid by program
          </h2>
        </div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {data.programs.map((p) => {
            const over = p.overBudgetMinor > 0;
            return (
              <div className="bar-h" key={p.programId ?? p.name}>
                <span className={over ? "b var-neg row" : "b"}>
                  {over && <TriangleExclamationPoint className="ic" aria-hidden="true" />}
                  {p.name}
                </span>
                <div className="trk" role="img" aria-label={`${p.name}: ${formatMinor(p.paidMinor)} paid, ${formatMinor(p.committedNotPaidMinor)} committed and not yet paid${p.budgetMinor !== null ? `, of a ${formatMinor(p.budgetMinor)} budget` : ""}`} style={over ? { outline: "2px solid #C53030", outlineOffset: "1px" } : undefined}>
                  <div className="f1" style={{ width: pct(p.paidMinor, scale) }} />
                  <div className="f2" style={{ width: pct(p.committedNotPaidMinor, scale) }} />
                </div>
                <span className={`num ${over ? "var-neg b" : ""}`}>{over ? `+${formatMinor(p.overBudgetMinor)} over` : `${formatMinor(p.committedMinor)}${p.budgetMinor !== null ? ` / ${formatMinor(p.budgetMinor)}` : ""}`}</span>
              </div>
            );
          })}
          {!data.programs.length && <span className="muted">No programs yet.</span>}
          <div className="row small muted" style={{ gap: "16px" }}>
            <span className="row">
              <span style={{ width: "10px", height: "10px", background: "var(--og-teal-dark)", display: "inline-block" }} aria-hidden="true" /> Paid
            </span>
            <span className="row">
              <span style={{ width: "10px", height: "10px", background: "var(--og-teal-light)", display: "inline-block" }} aria-hidden="true" /> Committed, not yet paid
            </span>
          </div>
        </div>
      </section>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "16px" }}>
        <Counts title="Applications" counts={data.applications} />
        <Counts title="Reporting" counts={data.reporting} />
        <Counts title="Payments" counts={data.payments} />
      </div>
    </div>
  );
}

function CyclePanel({ competitionId }: { competitionId: string }) {
  const report = useApiQuery((api) => api.cycleReport(competitionId), [competitionId]);
  if (report.status === "loading") return <Loading label="Loading the cycle" />;
  if (report.status === "error") return <ErrorBanner error={report.error} onRetry={report.reload} />;
  const c: CycleReport = report.data;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "16px" }}>
        <div className="stat">
          <span className="stat-l">Started</span>
          <span className="stat-v">{c.started}</span>
        </div>
        <div className="stat">
          <span className="stat-l">Submitted</span>
          <span className="stat-v">{c.submitted}</span>
          <span className="stat-d">{c.submitRate === null ? "—" : `${Math.round(c.submitRate * 100)}% of started`}</span>
        </div>
        <div className="stat">
          <span className="stat-l">Requested / awarded</span>
          <span className="stat-v" style={{ fontSize: "20px" }}>
            {formatMinor(c.requestedMinor)} / {formatMinor(c.awardedMinor)}
          </span>
        </div>
        <div className="stat">
          <span className="stat-l">Median days to decision</span>
          <span className="stat-v">{c.medianDaysToDecision ?? "—"}</span>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px" }}>
        <Counts title="By stage" counts={Object.fromEntries(c.stages.map((s) => [s.label, s.applications]))} />
        <Counts title="By status" counts={c.byStatus} />
        <Counts title="Eligibility result" counts={{ Eligible: c.eligibility.true ?? 0, "Not eligible": c.eligibility.false ?? 0, Unknown: c.eligibility.unknown ?? 0 }} />
        <Counts title="Passport level at submission" counts={c.byLevel} />
      </div>
    </div>
  );
}

function ImportPanel() {
  const [csv, setCsv] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const columns = (csv.split(/\r?\n/)[0] ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const run = useApiMutation((api, dryRun: boolean) => api.importAwardsCsv({ csv, mapping, dryRun }));
  const ready = columns.length > 0 && TARGETS.filter((t) => t.required).every((t) => mapping[t.key]);
  const go = async (dryRun: boolean) => {
    const out = await run.run(dryRun);
    if (out) setResult(out);
  };
  return (
    <section className="card" aria-labelledby="import-h">
      <div className="card-h">
        <div>
          <h3 id="import-h">Import awards from a CSV</h3>
          <p className="small muted">For bringing history from another system. Map each column, run a dry run, then import.</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {run.error !== null && <ErrorBanner error={run.error} />}
        <Field id="import-file" label="CSV file" help="The first row must hold the column names. Do not include bank or identity details.">
          <input
            className="inp"
            id="import-file"
            type="file"
            accept=".csv,text/csv"
            style={{ height: "auto", padding: "8px 10px" }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              setResult(null);
              setCsv(file ? await file.text() : "");
            }}
          />
        </Field>
        <Field id="import-text" label="Or paste CSV text">
          <textarea
            className="ta mono"
            id="import-text"
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setResult(null);
            }}
          />
        </Field>
        {columns.length > 0 && (
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Column mapping, scrollable">
            <table className="tbl" aria-label="Column mapping">
              <thead>
                <tr>
                  <th>GMS field</th>
                  <th>CSV column</th>
                </tr>
              </thead>
              <tbody>
                {TARGETS.map((t) => (
                  <tr key={t.key}>
                    <td>
                      <label htmlFor={`map-${t.key}`}>
                        {t.label}
                        {t.required && <span className="req"> *</span>}
                      </label>
                    </td>
                    <td>
                      <select
                        className="sel"
                        id={`map-${t.key}`}
                        value={mapping[t.key] ?? ""}
                        onChange={(e) =>
                          setMapping((m) => {
                            const next = { ...m };
                            if (e.target.value) next[t.key] = e.target.value;
                            else delete next[t.key];
                            return next;
                          })
                        }
                        style={{ height: "30px", maxWidth: "280px" }}
                      >
                        <option value="">Not mapped</option>
                        {columns.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result && (
          <Notice tone={result.failed ? "warn" : "ok"} title={result.dryRun ? `Dry run: ${result.rows - result.failed} of ${result.rows} rows would import` : `Imported ${result.created} of ${result.rows} rows`}>
            {result.failed > 0 && `${result.failed} rows have problems (first: row ${result.results.find((r) => !r.ok)?.row}, ${result.results.find((r) => !r.ok)?.error}). `}
            {result.unmatchedRecipients > 0 && `${result.unmatchedRecipients} recipients are not on the GMS yet and would be imported by name only.`}
          </Notice>
        )}
      </div>
      <div className="card-f">
        <button type="button" className="btn btn-secondary" disabled={!ready || run.state === "saving"} onClick={() => go(true)}>
          Dry run
        </button>
        <button type="button" className="btn btn-primary" disabled={!ready || !result?.dryRun || run.state === "saving"} onClick={() => go(false)}>
          <Upload className="ic" aria-hidden="true" />
          Import
        </button>
        {!result?.dryRun && <span className="help">Run a dry run first.</span>}
      </div>
    </section>
  );
}

function ExportsPanel() {
  const [year, setYear] = useState(String(new Date().getUTCFullYear()));
  const list = useApiQuery((api) => api.grantList990(Number(year)), [year]);
  const csv = useApiMutation(async (api) => {
    downloadBlob(await api.grantList990Csv(Number(year)), `990pf-part-xv-${year}.csv`);
    return true;
  });
  const bundle = useApiMutation((api) => api.exportBundle());
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <section className="card" aria-labelledby="pf-h">
        <div className="card-h">
          <div>
            <h3 id="pf-h">990-PF Part XV grant list</h3>
            <p className="small muted">Grants paid during the year and approved for future payment. Paid amounts are the figures last read from Passport.</p>
          </div>
          <div className="row">
            <label className="lbl" htmlFor="pf-year">
              Year
            </label>
            <input className="inp" id="pf-year" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} style={{ width: "88px" }} />
            <button type="button" className="btn btn-secondary" disabled={year.length !== 4 || csv.state === "saving"} onClick={() => csv.run()}>
              <Download className="ic" aria-hidden="true" />
              Download CSV
            </button>
          </div>
        </div>
        {(list.status === "error" || csv.error !== null) && (
          <div className="card-b">
            <ErrorBanner error={list.error ?? csv.error} />
          </div>
        )}
        {list.data && (
          <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label="990-PF grant list, scrollable">
            <table className="tbl" aria-label="990-PF grant list">
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Purpose</th>
                  <th className="num">Paid</th>
                  <th className="num">Approved for future payment</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((i) => (
                  <tr key={i.awardId}>
                    <td className="b">{i.recipientName}</td>
                    <td>{i.purpose}</td>
                    <td className="num">{formatMinor(i.paidMinor, i.currency)}</td>
                    <td className="num">{formatMinor(i.approvedForFuturePaymentMinor, i.currency)}</td>
                  </tr>
                ))}
                {!list.data.items.length && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No awards for {year}.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="b">
                    Total
                  </td>
                  <td className="num b">{formatMinor(list.data.totals.paidMinor)}</td>
                  <td className="num b">{formatMinor(list.data.totals.approvedForFuturePaymentMinor)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
      <section className="card" aria-labelledby="bundle-h">
        <div className="card-h">
          <div>
            <h3 id="bundle-h">Export everything</h3>
            <p className="small muted">A CommonGrants JSON bundle (opportunities, competitions, forms, applications, awards) plus the GMS records and an attachments manifest.</p>
          </div>
          <button type="button" className="btn btn-secondary" disabled={bundle.state === "saving"} onClick={() => bundle.run()}>
            <Download className="ic" aria-hidden="true" />
            Export bundle
          </button>
        </div>
        {bundle.error !== null && (
          <div className="card-b">
            <ErrorBanner error={bundle.error} />
          </div>
        )}
        {bundle.state === "saved" && (
          <div className="card-b">
            <Notice tone="ok" title="Export written">
              The bundle was written to this workspace’s exports. Files are listed in the ledger.
            </Notice>
          </div>
        )}
      </section>
      <ImportPanel />
    </div>
  );
}

export default function Analytics() {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const [tab, setTab] = useState<Tab>("portfolio");
  const page = useApiQuery(async (api) => {
    const [portfolio, competitions] = await Promise.all([api.portfolio(), api.listCompetitions()]);
    return { portfolio, competitions };
  }, []);
  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const competitions = page.data?.competitions ?? [];
  const current = competitionId ?? competitions[0]?.id ?? null;

  return (
    <>
      <title>{`Analytics — ${ws.name}`}</title>
      <FunderShell active="Analytics">
        <main className="main">
          <PageHeader crumbs={[{ label: ws.name, to: base }, { label: "Analytics" }]} title="Analytics" meta={page.data ? <span>As of {dateTime(page.data.portfolio.asOf)}</span> : undefined} />
          {page.status === "loading" && <Loading label="Loading analytics" />}
          {page.status === "error" && <ErrorBanner error={page.error} onRetry={page.reload} />}
          {page.data && (
            <>
              <Tabs
                label="Analytics views"
                idPrefix="analytics"
                active={tab}
                onChange={setTab}
                tabs={[
                  { key: "portfolio", label: "Portfolio" },
                  { key: "cycle", label: "Cycle" },
                  { key: "exports", label: "Exports & import" },
                ]}
              />
              <TabPanel idPrefix="analytics" tab="portfolio" active={tab}>
                <PortfolioPanel data={page.data.portfolio} />
              </TabPanel>
              <TabPanel idPrefix="analytics" tab="cycle" active={tab}>
                {!current ? (
                  <div className="card">
                    <EmptyState icon={ChartColumn} title="No competitions yet">
                      Cycle metrics appear once a competition has applications.
                    </EmptyState>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div className="row">
                      <label className="lbl" htmlFor="cycle-pick">
                        Competition
                      </label>
                      <select className="sel" id="cycle-pick" value={current} onChange={(e) => setCompetitionId(e.target.value)} style={{ maxWidth: "360px" }}>
                        {competitions.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title}
                          </option>
                        ))}
                      </select>
                    </div>
                    {tab === "cycle" && <CyclePanel competitionId={current} />}
                  </div>
                )}
              </TabPanel>
              <TabPanel idPrefix="analytics" tab="exports" active={tab}>
                {tab === "exports" && <ExportsPanel />}
              </TabPanel>
            </>
          )}
        </main>
      </FunderShell>
    </>
  );
}
