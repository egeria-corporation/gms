// SPDX-License-Identifier: AGPL-3.0-only
// Analytics: committed against paid by program (paid amounts are the figures last read from
// Passport), one cycle's funnel, and the exports: the 990-PF grant list, the CommonGrants bundle,
// and a CSV import of awards from another system with column mapping and a dry run.
import { downloadBlob } from "../../lib/browser.ts";
import { useState } from "react";
import { ChartColumn, Download, FileSpreadsheet, TriangleExclamationPoint, Upload } from "lucide-react";
import { Link } from "react-router";
import { STATUS, VerificationBadge, statusLook } from "../../components/status.tsx";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { CsvImportResult, CycleReport, Portfolio } from "../../api/funderMoney.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { EmptyState, ErrorBanner, Field, Loading, Notice, PageHeader, Tabs, TabPanel } from "../../components/ui.tsx";
import { PortfolioExtras } from "./AnalyticsExtras.tsx";
import { formatMinor } from "../../lib/format.ts";
import { dateTime } from "./shared.tsx";
import { t } from "./i18n.ts";

type Tab = "portfolio" | "cycle" | "exports";
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.min(100, Math.round((part / whole) * 1000) / 10)}%` : "0%");
const words = (key: string) => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const TARGETS: { key: string; readonly label: string; required?: boolean }[] = [
  { key: "recipientName", get label() { return t("funderAnalytics.target.recipientName"); }, required: true },
  { key: "title", get label() { return t("funderAnalytics.target.title"); }, required: true },
  { key: "awardedAmount", get label() { return t("funderAnalytics.target.awardedAmount"); }, required: true },
  { key: "recipientEin", get label() { return t("funderAnalytics.target.recipientEin"); } },
  { key: "startDate", get label() { return t("funderAnalytics.target.startDate"); } },
  { key: "endDate", get label() { return t("funderAnalytics.target.endDate"); } },
  { key: "status", get label() { return t("funderAnalytics.target.status"); } },
];

/** A count's name: an application or report status, a payment bucket, or the words of its key. */
const applicationCount = (k: string) => (k in STATUS.application ? statusLook("application", k).label : words(k));
const reportCount = (k: string) => (k in STATUS.requirement ? statusLook("requirement", k).label : words(k));
const PAYMENT_COUNT: Record<string, () => string> = {
  due: () => t("funderAnalytics.payment.due"),
  held: () => t("funderAnalytics.payment.held"),
  inFlight: () => t("funderAnalytics.payment.inFlight"),
  settled: () => t("funderAnalytics.payment.settled"),
};
const paymentCount = (k: string) => PAYMENT_COUNT[k]?.() ?? words(k);
const ELIGIBILITY_COUNT: Record<string, () => string> = {
  true: () => t("funderAnalytics.eligibility.eligible"),
  false: () => t("funderAnalytics.eligibility.notEligible"),
  unknown: () => t("funderAnalytics.eligibility.unknown"),
};
const asWritten = (k: string) => k;

function Counts({ title, counts, name = words }: { title: string; counts: Record<string, unknown>; name?: (key: string) => string }) {
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
            <span>{name(k)}</span>
            <div className="trk" role="img" aria-label={t("funderAnalytics.countOf", { label: name(k), n })}>
              <div className="f1" style={{ width: pct(n, max) }} />
            </div>
            <span className="num b">{n}</span>
          </div>
        ))}
        {!rows.length && <span className="muted small">{t("funderAnalytics.nothingToCountYet")}</span>}
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
          <span className="stat-l">{t("funderAnalytics.budget")}</span>
          <span className="stat-v">{formatMinor(data.totals.budgetMinor)}</span>
        </div>
        <div className="stat">
          <span className="stat-l">{t("funderAnalytics.committed")}</span>
          <span className="stat-v">{formatMinor(data.totals.committedMinor)}</span>
          <span className="stat-d">{t("funderAnalytics.awards", { awards: data.totals.awards })}</span>
        </div>
        <div className="stat">
          <span className="stat-l">{t("funderAnalytics.paid")}</span>
          <span className="stat-v">{formatMinor(data.totals.paidMinor)}</span>
          <span className="stat-d">{data.paidAsOf ? t("funderAnalytics.readFromPassport", { dateTime: dateTime(data.paidAsOf) }) : t("funderAnalytics.notReadFromPassport")}</span>
        </div>
        <div className="stat">
          <span className="stat-l">{t("funderAnalytics.committedNotYetPaid")}</span>
          <span className="stat-v">{formatMinor(data.totals.committedMinor - data.totals.paidMinor)}</span>
        </div>
      </div>
      <section className="card" aria-labelledby="by-program-h">
        <div className="card-h">
          <h2 id="by-program-h" style={{ fontSize: "16px" }}>
            {t("funderAnalytics.committedVsPaidBy")}
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
                <div className="trk" role="img" aria-label={p.budgetMinor !== null ? t("funderAnalytics.paidCommittedOfBudget", { name: p.name, paid: formatMinor(p.paidMinor), committed: formatMinor(p.committedNotPaidMinor), budget: formatMinor(p.budgetMinor) }) : t("funderAnalytics.paidCommitted", { name: p.name, paid: formatMinor(p.paidMinor), committed: formatMinor(p.committedNotPaidMinor) })} style={over ? { outline: "2px solid #C53030", outlineOffset: "1px" } : undefined}>
                  <div className="f1" style={{ width: pct(p.paidMinor, scale) }} />
                  <div className="f2" style={{ width: pct(p.committedNotPaidMinor, scale) }} />
                </div>
                <span className={`num ${over ? "var-neg b" : ""}`}>{over ? t("funderAnalytics.over", { amount: formatMinor(p.overBudgetMinor) }) : `${formatMinor(p.committedMinor)}${p.budgetMinor !== null ? ` / ${formatMinor(p.budgetMinor)}` : ""}`}</span>
              </div>
            );
          })}
          {!data.programs.length && <span className="muted">{t("funderAnalytics.noProgramsYet")}</span>}
          <div className="row small muted" style={{ gap: "16px" }}>
            <span className="row">
              <span style={{ width: "10px", height: "10px", background: "var(--og-teal-dark)", display: "inline-block" }} aria-hidden="true" /> {t("funderAnalytics.paid")}
            </span>
            <span className="row">
              <span style={{ width: "10px", height: "10px", background: "var(--og-teal-light)", display: "inline-block" }} aria-hidden="true" /> {t("funderAnalytics.committedNotYetPaid")}
            </span>
          </div>
        </div>
      </section>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "16px" }}>
        <Counts title={t("funderAnalytics.applications")} counts={data.applications} name={applicationCount} />
        <Counts title={t("funderAnalytics.reporting")} counts={data.reporting} name={reportCount} />
        <Counts title={t("funderAnalytics.payments")} counts={data.payments} name={paymentCount} />
      </div>
    </div>
  );
}

function CyclePanel({ competitionId }: { competitionId: string }) {
  const report = useApiQuery((api) => api.cycleReport(competitionId), [competitionId]);
  if (report.status === "loading") return <Loading label={t("funderAnalytics.loadingTheCycle")} />;
  if (report.status === "error") return <ErrorBanner error={report.error} onRetry={report.reload} />;
  const c: CycleReport = report.data;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "16px" }}>
        <div className="stat">
          <span className="stat-l">{t("funderAnalytics.started")}</span>
          <span className="stat-v">{c.started}</span>
        </div>
        <div className="stat">
          <span className="stat-l">{t("funderAnalytics.submitted")}</span>
          <span className="stat-v">{c.submitted}</span>
          <span className="stat-d">{c.submitRate === null ? "—" : t("funderAnalytics.ofStarted", { round: Math.round(c.submitRate * 100) })}</span>
        </div>
        <div className="stat">
          <span className="stat-l">{t("funderAnalytics.requestedAwarded")}</span>
          <span className="stat-v" style={{ fontSize: "20px" }}>
            {formatMinor(c.requestedMinor)} / {formatMinor(c.awardedMinor)}
          </span>
        </div>
        <div className="stat">
          <span className="stat-l">{t("funderAnalytics.medianDaysToDecision")}</span>
          <span className="stat-v">{c.medianDaysToDecision ?? "—"}</span>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px" }}>
        <Counts title={t("funderAnalytics.byStage")} counts={Object.fromEntries(c.stages.map((s) => [s.label, s.applications]))} name={asWritten} />
        <Counts title={t("funderAnalytics.byStatus")} counts={c.byStatus} name={applicationCount} />
        <Counts title={t("funderAnalytics.eligibilityResult")} counts={{ true: c.eligibility.true ?? 0, false: c.eligibility.false ?? 0, unknown: c.eligibility.unknown ?? 0 }} name={(k) => ELIGIBILITY_COUNT[k]!()} />
        <Counts title={t("funderAnalytics.passportLevelAtSubmission")} counts={c.byLevel} name={asWritten} />
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
  const ready = columns.length > 0 && TARGETS.filter((item) => item.required).every((item) => mapping[item.key]);
  const go = async (dryRun: boolean) => {
    const out = await run.run(dryRun);
    if (out) setResult(out);
  };
  return (
    <section className="card" aria-labelledby="import-h">
      <div className="card-h">
        <div>
          <h3 id="import-h">{t("funderAnalytics.importAwardsFromA")}</h3>
          <p className="small muted">{t("funderAnalytics.forBringingHistoryFrom")}</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {run.error !== null && <ErrorBanner error={run.error} />}
        <Field id="import-file" label={t("funderAnalytics.csvFile")} help={t("funderAnalytics.theFirstRowMust")}>
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
        <Field id="import-text" label={t("funderAnalytics.orPasteCsvText")}>
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
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("funderAnalytics.columnMappingScrollable")}>
            <table className="tbl" aria-label={t("funderAnalytics.columnMapping")}>
              <thead>
                <tr>
                  <th>{t("funderAnalytics.gmsField")}</th>
                  <th>{t("funderAnalytics.csvColumn")}</th>
                </tr>
              </thead>
              <tbody>
                {TARGETS.map((targetRow) => (
                  <tr key={targetRow.key}>
                    <td>
                      <label htmlFor={`map-${targetRow.key}`}>
                        {targetRow.label}
                        {targetRow.required && <span className="req"> *</span>}
                      </label>
                    </td>
                    <td>
                      <select
                        className="sel"
                        id={`map-${targetRow.key}`}
                        value={mapping[targetRow.key] ?? ""}
                        onChange={(e) =>
                          setMapping((m) => {
                            const next = { ...m };
                            if (e.target.value) next[targetRow.key] = e.target.value;
                            else delete next[targetRow.key];
                            return next;
                          })
                        }
                        style={{ height: "30px", maxWidth: "280px" }}
                      >
                        <option value="">{t("funderAnalytics.notMapped")}</option>
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
          <Notice tone={result.failed ? "warn" : "ok"} title={result.dryRun ? t("funderAnalytics.dryRunOfRows", { ok: result.rows - result.failed, total: result.rows }) : t("funderAnalytics.importedOfRows", { created: result.created, total: result.rows })}>
            {result.failed > 0 && t("funderAnalytics.rowsHaveProblemsFirst", { failed: result.failed, row: String(result.results.find((r) => !r.ok)?.row ?? ""), error: result.results.find((r) => !r.ok)?.error })}
            {result.failed > 0 && result.unmatchedRecipients > 0 && " "}
            {result.unmatchedRecipients > 0 && t("funderAnalytics.recipientsAreNotOn", { count: result.unmatchedRecipients })}
          </Notice>
        )}
      </div>
      <div className="card-f">
        <button type="button" className="btn btn-secondary" disabled={!ready || run.state === "saving"} onClick={() => go(true)}>
          {t("funderAnalytics.dryRun")}
        </button>
        <button type="button" className="btn btn-primary" disabled={!ready || !result?.dryRun || run.state === "saving"} onClick={() => go(false)}>
          <Upload className="ic" aria-hidden="true" />
          {t("funderAnalytics.import")}
        </button>
        {!result?.dryRun && <span className="help">{t("funderAnalytics.runADryRun")}</span>}
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
            <h3 id="pf-h">{t("funderAnalytics.n990PfPartXv")}</h3>
            <p className="small muted">{t("funderAnalytics.grantsPaidDuringThe")}</p>
          </div>
          <div className="row">
            <label className="lbl" htmlFor="pf-year">
              {t("funderAnalytics.year")}
            </label>
            <input className="inp" id="pf-year" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} style={{ width: "88px" }} />
            <button type="button" className="btn btn-secondary" disabled={year.length !== 4 || csv.state === "saving"} onClick={() => csv.run()}>
              <Download className="ic" aria-hidden="true" />
              {t("funderAnalytics.downloadCsv")}
            </button>
          </div>
        </div>
        {(list.status === "error" || csv.error !== null) && (
          <div className="card-b">
            <ErrorBanner error={list.error ?? csv.error} />
          </div>
        )}
        {list.data?.warnings?.length ? (
          <div className="card-b">
            <div className="bnr bnr-warn" role="note">
              <TriangleExclamationPoint className="ic" aria-hidden="true" />
              <div>
                <div className="t">{t("funderAnalytics.checkBeforeFiling")}</div>
                {list.data.warnings.map((w) => (
                  <div key={w} className="d">
                    {w}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
        {list.data && (
          <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label={t("funderAnalytics.n990PfGrantList")}>
            <table className="tbl" aria-label={t("funderAnalytics.n990PfGrantList2")}>
              <thead>
                <tr>
                  <th>{t("funderAnalytics.recipient")}</th>
                  <th>{t("funderAnalytics.purpose")}</th>
                  <th className="num">{t("funderAnalytics.paid")}</th>
                  <th className="num">{t("funderAnalytics.approvedForFuturePayment")}</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((i) => (
                  <tr key={i.awardId}>
                    <td>
                      <div className="row wrap" style={{ gap: "6px" }}>
                        <span className="b">{i.recipientName}</span>
                        <VerificationBadge verification={i.recipientVerification} />
                      </div>
                    </td>
                    <td>{i.purpose}</td>
                    <td className="num">{formatMinor(i.paidMinor, i.currency)}</td>
                    <td className="num">{formatMinor(i.approvedForFuturePaymentMinor, i.currency)}</td>
                  </tr>
                ))}
                {!list.data.items.length && (
                  <tr>
                    <td colSpan={4} className="muted">
                      {t("funderAnalytics.noAwardsFor", { year })}
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="b">
                    {t("funderAnalytics.total")}
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
            <h3 id="bundle-h">{t("funderAnalytics.exportEverything")}</h3>
            <p className="small muted">{t("funderAnalytics.aCommongrantsJsonBundle")}</p>
          </div>
          <button type="button" className="btn btn-secondary" disabled={bundle.state === "saving"} onClick={() => bundle.run()}>
            <Download className="ic" aria-hidden="true" />
            {t("funderAnalytics.exportBundle")}
          </button>
        </div>
        {bundle.error !== null && (
          <div className="card-b">
            <ErrorBanner error={bundle.error} />
          </div>
        )}
        {bundle.state === "saved" && (
          <div className="card-b">
            <Notice tone="ok" title={t("funderAnalytics.exportWritten")}>
              {t("funderAnalytics.theBundleWasWritten")}
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
      <title>{t("funderAnalytics.analytics", { name: ws.name })}</title>
      <FunderShell active="Analytics">
        <main className="main">
          <PageHeader crumbs={[{ label: ws.name, to: base }, { label: t("funderAnalytics.analytics2") }]} title={t("funderAnalytics.analytics2")} meta={page.data ? <span>{t("funderAnalytics.asOf", { dateTime: dateTime(page.data.portfolio.asOf) })}</span> : undefined} actions={<Link className="btn btn-secondary" to={`${base}/report-builder`}><FileSpreadsheet className="ic" aria-hidden="true" /> {t("funderAnalytics.reportBuilder")}</Link>} />
          {page.status === "loading" && <Loading label={t("funderAnalytics.loadingAnalytics")} />}
          {page.status === "error" && <ErrorBanner error={page.error} onRetry={page.reload} />}
          {page.data && (
            <>
              <Tabs
                label={t("funderAnalytics.analyticsViews")}
                idPrefix="analytics"
                active={tab}
                onChange={setTab}
                tabs={[
                  { key: "portfolio", label: t("funderAnalytics.portfolio") },
                  { key: "cycle", label: t("funderAnalytics.cycle") },
                  { key: "exports", label: t("funderAnalytics.exportsImport") },
                ]}
              />
              <TabPanel idPrefix="analytics" tab="portfolio" active={tab}>
                <PortfolioPanel data={page.data.portfolio} />
                <PortfolioExtras />
              </TabPanel>
              <TabPanel idPrefix="analytics" tab="cycle" active={tab}>
                {!current ? (
                  <div className="card">
                    <EmptyState icon={ChartColumn} title={t("funderAnalytics.noCompetitionsYet")}>
                      {t("funderAnalytics.cycleMetricsAppearOnce")}
                    </EmptyState>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div className="row">
                      <label className="lbl" htmlFor="cycle-pick">
                        {t("funderAnalytics.competition")}
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
