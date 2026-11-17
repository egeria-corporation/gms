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
import { fiscalYearName, monthName } from "./labels.ts";
import { t, useApplicantText } from "./i18n.ts";

export const winRateText = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

export default function FundingSummary() {
  useApplicantText();
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const query = useWKQuery((api) => api.fundingSummary(), [ws.id]);
  const exporter = useWKMutation(async (api, format: "csv" | "pdf") => {
    const f = await api.exportSummary(format);
    downloadBlob(f.blob, f.filename);
    return true;
  });
  const columnsFor = (startMonth: number): Column<FundingYear>[] => [
    { key: "fy", header: t("fundingSummary.col.fiscalYear"), cell: (y) => <span className="b">{fiscalYearName(y.fiscalYear, startMonth)}</span>, sort: (y) => y.fiscalYear },
    { key: "sub", header: t("fundingSummary.col.submitted"), numeric: true, cell: (y) => y.submitted, sort: (y) => y.submitted },
    { key: "dec", header: t("fundingSummary.col.decided"), numeric: true, cell: (y) => y.decided, sort: (y) => y.decided },
    { key: "aw", header: t("fundingSummary.col.awarded"), numeric: true, cell: (y) => y.awarded, sort: (y) => y.awarded },
    { key: "dc", header: t("fundingSummary.col.declined"), numeric: true, cell: (y) => y.declined, sort: (y) => y.declined },
    { key: "wr", header: t("fundingSummary.winRate"), numeric: true, cell: (y) => winRateText(y.winRate), sort: (y) => y.winRate },
    { key: "ask", header: t("fundingSummary.asked"), numeric: true, cell: (y) => formatMoney(y.asked), sort: (y) => Number(y.asked.amount) },
    { key: "amt", header: t("fundingSummary.col.awardedAmount"), numeric: true, cell: (y) => formatMoney(y.awardedAmount), sort: (y) => Number(y.awardedAmount.amount) },
  ];
  return (
    <>
      <title>{t("fundingSummary.pageTitle", { workspace: ws.name })}</title>
      <ApplicantShell active="Funding summary">
        <main className="main">
          <div className="ph">
            <div>
              <div className="title">
                <h1>{t("fundingSummary.fundingSummary")}</h1>
              </div>
              <div className="meta">
                <span>{t("fundingSummary.everyApplicationOnThisGmsAnd")}</span>
              </div>
            </div>
            <div className="actions">
              <button type="button" className="btn btn-secondary" disabled={exporter.state === "saving"} onClick={() => void exporter.run("csv")}>
                <Download className="ic" aria-hidden="true" />
                {t("fundingSummary.spreadsheetCsv")}
              </button>
              <button type="button" className="btn btn-primary" disabled={exporter.state === "saving"} onClick={() => void exporter.run("pdf")}>
                <FileText className="ic" aria-hidden="true" />
                {t("fundingSummary.onePagePdfForTheBoard")}
              </button>
            </div>
          </div>
          {exporter.error ? <ErrorBanner error={exporter.error} title={t("fundingSummary.theExportDidNotStart")} /> : null}
          <Loaded query={query} label={t("fundingSummary.countingYourApplications")}>
            {(s) => {
              const current = s.years[0];
              return s.years.length === 0 ? (
                <div className="card">
                  <EmptyState icon={ChartColumn} title={t("fundingSummary.nothingToCountYet")}>
                    {t("fundingSummary.theSummaryFillsInAsApplications")}
                  </EmptyState>
                </div>
              ) : (
                <>
                  {current && (
                    <section aria-label={t("fundingSummary.atAGlance", { year: fiscalYearName(current.fiscalYear, s.fiscalYearStartMonth) })} style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "14px" }}>
                      <div className="stat">
                        <span className="stat-l">{t("fundingSummary.submittedIn", { year: fiscalYearName(current.fiscalYear, s.fiscalYearStartMonth) })}</span>
                        <span className="stat-v">{current.submitted}</span>
                      </div>
                      <div className="stat">
                        <span className="stat-l">{t("fundingSummary.winRate")}</span>
                        <span className="stat-v">{winRateText(current.winRate)}</span>
                        <span className="stat-d">
                          {t("fundingSummary.awardedOfDecided", { awarded: current.awarded, decided: current.decided })}
                        </span>
                      </div>
                      <div className="stat">
                        <span className="stat-l">{t("fundingSummary.asked")}</span>
                        <span className="stat-v">{formatMoney(current.asked)}</span>
                      </div>
                      <div className="stat">
                        <span className="stat-l">{t("fundingSummary.awarded")}</span>
                        <span className="stat-v">{formatMoney(current.awardedAmount)}</span>
                      </div>
                    </section>
                  )}
                  <DataTable label={t("fundingSummary.fundingByFiscalYear")} columns={columnsFor(s.fiscalYearStartMonth)} rows={s.years} rowKey={(y) => String(y.fiscalYear)} empty={null} />
                  <p className="small muted">
                    {t.rich("fundingSummary.footnote", { month: monthName(s.fiscalYearStartMonth), link: (chunks) => <Link to={`${base}/settings`}>{chunks}</Link> })}
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
