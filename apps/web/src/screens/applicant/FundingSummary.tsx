// SPDX-License-Identifier: AGPL-3.0-only
// Funding summary (v1.7): applications to funders on this GMS and anywhere else, by fiscal year.
// How many were submitted, decided, awarded and declined, the win rate (awarded ÷ decided), and the
// amount asked against the amount awarded. Exports as a spreadsheet, and as a one-page PDF for the
// board. The fiscal year's first month is a workspace setting.
import { Link } from "react-router";
import { ChartColumn, Download, FileText } from "lucide-react";
import type { FundingYear } from "../../api/writeKeep.ts";
import { useWKMutation, useWKQuery } from "../../api/writeKeepHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Loaded } from "../../components/applicant.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { DataTable, EmptyState, ErrorBanner, type Column } from "../../components/ui.tsx";
import { downloadBlob } from "../../lib/browser.ts";
import { formatMoney } from "../../lib/format.ts";
import { MONTHS } from "../../lib/writeKeep.ts";

export const winRateText = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

export default function FundingSummary() {
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const query = useWKQuery((api) => api.fundingSummary(), [ws.id]);
  const exporter = useWKMutation(async (api, format: "csv" | "pdf") => {
    const f = await api.exportSummary(format);
    downloadBlob(f.blob, f.filename);
    return true;
  });
  const columns: Column<FundingYear>[] = [
    { key: "fy", header: "Fiscal year", cell: (y) => <span className="b">{y.label}</span>, sort: (y) => y.fiscalYear },
    { key: "sub", header: "Submitted", numeric: true, cell: (y) => y.submitted, sort: (y) => y.submitted },
    { key: "dec", header: "Decided", numeric: true, cell: (y) => y.decided, sort: (y) => y.decided },
    { key: "aw", header: "Awarded", numeric: true, cell: (y) => y.awarded, sort: (y) => y.awarded },
    { key: "dc", header: "Declined", numeric: true, cell: (y) => y.declined, sort: (y) => y.declined },
    { key: "wr", header: "Win rate", numeric: true, cell: (y) => winRateText(y.winRate), sort: (y) => y.winRate },
    { key: "ask", header: "Asked", numeric: true, cell: (y) => formatMoney(y.asked), sort: (y) => Number(y.asked.amount) },
    { key: "amt", header: "Awarded amount", numeric: true, cell: (y) => formatMoney(y.awardedAmount), sort: (y) => Number(y.awardedAmount.amount) },
  ];
  return (
    <>
      <title>{`Funding summary — ${ws.name}`}</title>
      <ApplicantShell active="Funding summary">
        <main className="main">
          <div className="ph">
            <div>
              <div className="title">
                <h1>Funding summary</h1>
              </div>
              <div className="meta">
                <span>Every application, on this GMS and anywhere else, by fiscal year. Only your team sees this.</span>
              </div>
            </div>
            <div className="actions">
              <button type="button" className="btn btn-secondary" disabled={exporter.state === "saving"} onClick={() => void exporter.run("csv")}>
                <Download className="ic" aria-hidden="true" />
                Spreadsheet (CSV)
              </button>
              <button type="button" className="btn btn-primary" disabled={exporter.state === "saving"} onClick={() => void exporter.run("pdf")}>
                <FileText className="ic" aria-hidden="true" />
                One-page PDF for the board
              </button>
            </div>
          </div>
          {exporter.error ? <ErrorBanner error={exporter.error} title="The export did not start" /> : null}
          <Loaded query={query} label="Counting your applications">
            {(s) => {
              const current = s.years[0];
              return s.years.length === 0 ? (
                <div className="card">
                  <EmptyState icon={ChartColumn} title="Nothing to count yet">
                    The summary fills in as applications are submitted and decided.
                  </EmptyState>
                </div>
              ) : (
                <>
                  {current && (
                    <section aria-label={`${current.label} at a glance`} style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "14px" }}>
                      <div className="stat">
                        <span className="stat-l">Submitted, {current.label}</span>
                        <span className="stat-v">{current.submitted}</span>
                      </div>
                      <div className="stat">
                        <span className="stat-l">Win rate</span>
                        <span className="stat-v">{winRateText(current.winRate)}</span>
                        <span className="stat-d">
                          {current.awarded} awarded of {current.decided} decided
                        </span>
                      </div>
                      <div className="stat">
                        <span className="stat-l">Asked</span>
                        <span className="stat-v">{formatMoney(current.asked)}</span>
                      </div>
                      <div className="stat">
                        <span className="stat-l">Awarded</span>
                        <span className="stat-v">{formatMoney(current.awardedAmount)}</span>
                      </div>
                    </section>
                  )}
                  <DataTable label="Funding by fiscal year" columns={columns} rows={s.years} rowKey={(y) => String(y.fiscalYear)} empty={null} />
                  <p className="small muted">
                    The fiscal year starts in {MONTHS[s.fiscalYearStartMonth - 1]}. A workspace admin can change it in <Link to={`${base}/settings`}>Settings</Link>. Win rate is awarded divided by decided; applications still waiting are not counted against it.
                  </p>
                </>
              );
            }}
          </Loaded>
        </main>
      </ApplicantShell>
    </>
  );
}
