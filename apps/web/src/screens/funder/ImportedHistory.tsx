// SPDX-License-Identifier: AGPL-3.0-only
// "Imported history" on a grantee's page and on an award's page (v1.12.0): the past applications,
// reviews and reports the funder brought from the system it used before. Read-only: nothing here
// can be reviewed, decided or paid, and nothing changes. A past application opens in place to show
// its answers and its reviews (a reviewer by name only). The section is left out when there is no
// imported history to show. Outcome and status are always an icon and a label.
import { useState } from "react";
import { Ban, CircleCheck, CircleDashed, CircleHelp, CircleX, Clock, Download, FileClock, History, type LucideIcon } from "lucide-react";
import type { HistoryApplication, HistoryApplicationDetail, HistoryOutcome, HistoryQuery, HistoryReport, HistoryReportState } from "../../api/history.ts";
import { useHistoryApi, useHistoryQuery } from "../../api/historyHooks.ts";
import { ErrorBanner, Loading } from "../../components/ui.tsx";
import { openBlob } from "../../lib/browser.ts";
import { formatDate, formatMinor } from "../../lib/format.ts";
import { t } from "./i18n.ts";

const OUTCOME: Record<HistoryOutcome, { icon: LucideIcon; tone: string; label: () => string }> = {
  awarded: { icon: CircleCheck, tone: "bdg-ok", label: () => t("importedHistory.outcome.awarded") },
  declined: { icon: CircleX, tone: "bdg-neutral", label: () => t("importedHistory.outcome.declined") },
  withdrawn: { icon: Ban, tone: "bdg-neutral", label: () => t("importedHistory.outcome.withdrawn") },
  undecided: { icon: CircleDashed, tone: "bdg-info", label: () => t("importedHistory.outcome.undecided") },
  unknown: { icon: CircleHelp, tone: "bdg-neutral", label: () => t("importedHistory.outcome.unknown") },
};
const REPORT: Record<HistoryReportState, { icon: LucideIcon; tone: string; label: () => string }> = {
  approved: { icon: CircleCheck, tone: "bdg-ok", label: () => t("importedHistory.report.approved") },
  submitted: { icon: CircleCheck, tone: "bdg-done", label: () => t("importedHistory.report.submitted") },
  late: { icon: Clock, tone: "bdg-warn", label: () => t("importedHistory.report.late") },
  not_submitted: { icon: FileClock, tone: "bdg-neutral", label: () => t("importedHistory.report.notSubmitted") },
  unknown: { icon: CircleHelp, tone: "bdg-neutral", label: () => t("importedHistory.report.unknown") },
};

function Badge({ icon: Icon, tone, label, words }: { icon: LucideIcon; tone: string; label: string; words: string | null }) {
  return (
    <span className={`bdg ${tone}`} title={words && words !== label ? t("importedHistory.asExported", { words }) : undefined}>
      <Icon className="ic ic-sm" aria-hidden="true" />
      {label}
    </span>
  );
}

function Detail({ id }: { id: string }) {
  const d = useHistoryQuery((api) => api.application(id), [id]);
  if (d.status === "loading") return <Loading label={t("importedHistory.loadingApplication")} />;
  if (d.status === "error") return <ErrorBanner error={d.error} onRetry={d.reload} />;
  const a: HistoryApplicationDetail = d.data;
  return (
    <div className="col" style={{ gap: "12px" }}>
      {a.answers.length > 0 ? (
        <dl className="kv" aria-label={t("importedHistory.answersOf", { title: a.title })}>
          {a.answers.map((x, i) => (
            <div key={i} style={{ display: "contents" }}>
              <dt>{x.question}</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>{x.answer}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="small muted">{t("importedHistory.noAnswers")}</p>
      )}
      {a.includes.reviews && (
        <div className="col" style={{ gap: "6px" }}>
          <h4 className="lbl">{t("importedHistory.reviews", { count: a.reviews.length })}</h4>
          {a.reviews.length === 0 && <p className="small muted">{t("importedHistory.noReviews")}</p>}
          {a.reviews.map((r) => (
            <div key={r.id} className="card card-b" style={{ padding: "10px 12px" }}>
              <div className="row wrap" style={{ gap: "8px" }}>
                <span className="b">{r.reviewerName ?? t("importedHistory.unnamedReviewer")}</span>
                {r.totalScore !== null && <span className="small">{t("importedHistory.totalScore", { score: r.totalScore })}</span>}
                {r.recommendation && <span className="tag">{r.recommendation}</span>}
                {r.reviewedOn && <span className="small muted">{formatDate(r.reviewedOn)}</span>}
              </div>
              {r.scores.length > 0 && (
                <ul className="small" style={{ margin: "6px 0 0", paddingLeft: "18px" }} aria-label={t("importedHistory.criterionScores")}>
                  {r.scores.map((s) => (
                    <li key={s.criterion}>{s.outOf === null ? t("importedHistory.criterionScore", { criterion: s.criterion, score: s.score }) : t("importedHistory.criterionScoreOutOf", { criterion: s.criterion, score: s.score, outOf: s.outOf })}</li>
                  ))}
                </ul>
              )}
              {r.comment && <p className="small" style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{r.comment}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ApplicationRow({ a, showOrganization }: { a: HistoryApplication; showOrganization: boolean }) {
  const [open, setOpen] = useState(false);
  const o = OUTCOME[a.outcome];
  const panel = `history-app-${a.id}`;
  return (
    <>
      <tr>
        <td>
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((v) => !v)}>
            {a.title}
          </button>
          <div className="small muted">{[showOrganization ? a.organizationName : null, a.callTitle ?? a.programName].filter(Boolean).join(" · ")}</div>
        </td>
        <td>{a.submittedOn ? formatDate(a.submittedOn) : "—"}</td>
        <td>
          <Badge icon={o.icon} tone={o.tone} label={o.label()} words={a.outcomeLabel} />
        </td>
        <td className="num">{formatMinor(a.requestedAmountMinor, a.currency)}</td>
        <td className="num">{formatMinor(a.awardedAmountMinor, a.currency)}</td>
        <td className="num">{a.reviewCount}</td>
      </tr>
      {open && (
        <tr id={panel}>
          <td colSpan={6}>
            <Detail id={a.id} />
          </td>
        </tr>
      )}
    </>
  );
}

function ReportRow({ r }: { r: HistoryReport }) {
  const api = useHistoryApi();
  const s = REPORT[r.state];
  return (
    <tr>
      <td>
        <span className="b">{r.title}</span>
        {(r.award?.title ?? r.awardTitle) && <div className="small muted">{r.award?.title ?? r.awardTitle}</div>}
      </td>
      <td>{r.dueOn ? formatDate(r.dueOn) : "—"}</td>
      <td>{r.submittedOn ? formatDate(r.submittedOn) : "—"}</td>
      <td>
        <Badge icon={s.icon} tone={s.tone} label={s.label()} words={r.stateLabel} />
      </td>
      <td>
        {r.file ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void api.file("report", r.id, r.file!.id).then((b) => openBlob(b, r.file!.name))}>
            <Download className="ic ic-sm" aria-hidden="true" />
            {t("importedHistory.openFile", { name: r.file.name })}
          </button>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
    </tr>
  );
}

/** The section, for one organization (`{ organization }`) or one award (`{ award }`). */
export function ImportedHistory({ query }: { query: HistoryQuery }) {
  const key = "organization" in query ? `o:${query.organization}` : `a:${query.award}`;
  const list = useHistoryQuery((api) => api.list(query), [key]);
  if (list.status === "loading") return null;
  if (list.status === "error") return null;
  const { applications, reports } = list.data;
  if (!applications.length && !reports.length) return null;
  const systems = [...new Set([...applications, ...reports].map((x) => x.sourceSystem?.system).filter((x): x is string => !!x))];
  const showOrganization = "award" in query;
  return (
    <section className="card" aria-labelledby={`imported-history-${key}`}>
      <div className="card-h">
        <div className="col" style={{ gap: "2px" }}>
          <h3 id={`imported-history-${key}`} className="row" style={{ gap: "6px" }}>
            <History className="ic" aria-hidden="true" />
            {t("importedHistory.title")}
          </h3>
          <span className="small muted">{systems.length ? t("importedHistory.fromSystems", { systems: systems.join(", ") }) : t("importedHistory.fromYourOldSystem")}</span>
        </div>
        <span className="bdg bdg-neutral">
          <History className="ic ic-sm" aria-hidden="true" />
          {t("importedHistory.readOnly")}
        </span>
      </div>
      <div className="card-b">
        <p className="help" style={{ marginTop: 0 }}>
          {t("importedHistory.notLive")}
        </p>
      </div>
      {applications.length > 0 && (
        <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label={t("importedHistory.pastApplicationsScrollable")}>
          <table className="tbl" aria-label={t("importedHistory.pastApplications")}>
            <thead>
              <tr>
                <th>{t("importedHistory.application")}</th>
                <th>{t("importedHistory.submitted")}</th>
                <th>{t("importedHistory.outcome")}</th>
                <th className="num">{t("importedHistory.requested")}</th>
                <th className="num">{t("importedHistory.awarded")}</th>
                <th className="num">{t("importedHistory.reviewsColumn")}</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((a) => (
                <ApplicationRow key={a.id} a={a} showOrganization={showOrganization} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {reports.length > 0 && (
        <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label={t("importedHistory.pastReportsScrollable")}>
          <table className="tbl" aria-label={t("importedHistory.pastReports")}>
            <thead>
              <tr>
                <th>{t("importedHistory.report")}</th>
                <th>{t("importedHistory.due")}</th>
                <th>{t("importedHistory.submitted")}</th>
                <th>{t("importedHistory.status")}</th>
                <th>{t("importedHistory.file")}</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <ReportRow key={r.id} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
