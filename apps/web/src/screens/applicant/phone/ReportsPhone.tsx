// SPDX-License-Identifier: AGPL-3.0-only
// Reports at phone width, as the 390px artboard draws it: one card per requirement under "Due
// across funders", then the selected report in a single card with a full-width submit, then
// sharing. Same data and report logic as the desktop screen (../report.tsx).
import type { CSSProperties } from "react";
import { useSearchParams } from "react-router";
import { ClipboardCheck } from "lucide-react";
import { useApplicantQuery } from "../../../api/applicantHooks.ts";
import type { MyRequirement } from "../../../api/applicantMore.ts";
import { useWorkspace } from "../../../app/workspace.tsx";
import { accentOf, FunderChip } from "../../../components/applicant.tsx";
import { PhoneShell } from "../../../components/PhoneShell.tsx";
import { StatusBadge } from "../../../components/status.tsx";
import { EmptyState, ErrorBanner, Loading } from "../../../components/ui.tsx";
import { actionFor, byUrgency, duePhrase, ReportForm, ReportLoading, ReturnedBanner, ShareReport, useReport, useReports, type ReportsData } from "../report.tsx";
import { t, useApplicantText } from "../i18n.ts";

function Editor({ requirement, data, onChanged }: { requirement: MyRequirement; data: ReportsData; onChanged: () => void }) {
  const report = useReport(requirement, onChanged);
  const org = useApplicantQuery((api) => api.organization(), []);
  const l = report.loaded;
  const funder = requirement.funder?.name ?? t("reports.yourFunder");
  const blockers = report.showAll || report.serverErrors.length ? report.errors : [];
  return (
    <>
      <section className="card" id="editor" tabIndex={-1} aria-labelledby="ed-h">
        <div className="card-h" style={{ padding: "14px 16px", flexWrap: "wrap" }}>
          <div>
            <h3 id="ed-h" style={{ fontSize: "16px" }}>
              {requirement.title}
            </h3>
            <p className="small muted">
              {funder} · {duePhrase(requirement).text}
            </p>
          </div>
          {l ? <StatusBadge kind="submission" status={l.submission.status} /> : <StatusBadge kind="requirement" status={requirement.status} />}
        </div>
        <div className="card-b" style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <ReportLoading report={report} />
          {report.status === "idle" && !l && (
            <>
              <p className="small muted">{t("reportsPhone.startingFillsInWhatPassportAnd")}</p>
              <button className="btn btn-primary btn-lg btn-block" type="button" onClick={report.start}>
                {actionFor(requirement)?.label ?? t("reportsPhone.startReport")}
              </button>
            </>
          )}
          {l && (
            <>
              <ReturnedBanner submission={l.submission} funder={funder} />
              <ReportForm report={report} passportUrl={org.status === "ready" ? org.data.editUrl : null} />
              <span className="notice" role="status" aria-live="polite">
                {report.save.state === "saving" && t("reportsPhone.saving")}
                {report.save.state === "saved" && t("reportsPhone.saved")}
                {report.save.state === "error" && t("reportsPhone.yourLastChangeWasNotSaved")}
              </span>
              {blockers.length > 0 && (
                <p className="small b" role="alert" style={{ color: "var(--s-dng-fg)" }}>
                  {t("reportsPhone.notSubmittedFix", { count: blockers.length })}
                </p>
              )}
              {report.submit.error && !blockers.length ? <ErrorBanner error={report.submit.error} title={t("reportsPhone.theReportWasNotSubmitted")} /> : null}
              {report.editable && (
                <button className="btn btn-primary btn-lg btn-block" type="button" disabled={report.submit.state === "sending" || !l.def} onClick={() => void report.send()}>
                  {report.submit.state === "sending" ? t("reportsPhone.submitting") : l.submission.status === "returned" ? t("reportsPhone.resubmitReport") : t("reportsPhone.submitReport")}
                </button>
              )}
            </>
          )}
        </div>
      </section>
      {l && <ShareReport loaded={l} requirement={requirement} funders={data.funders} onShared={onChanged} />}
    </>
  );
}

export default function ReportsPhone() {
  useApplicantText();
  const ws = useWorkspace("applicant");
  const query = useReports(ws.id);
  const [params, setParams] = useSearchParams();
  const list = query.status === "ready" ? [...query.data.requirements].sort(byUrgency) : [];
  const selected = list.find((r) => r.id === params.get("r")) ?? list[0] ?? null;
  return (
    <>
      <title>{t("reports.pageTitle", { workspace: ws.name })}</title>
      <PhoneShell title={t("reportsPhone.reports")} active="Reports">
        <main className="main" style={{ flex: 1 }}>
          {query.status === "loading" && <Loading label={t("reportsPhone.loadingReports")} />}
          {query.status === "error" && <ErrorBanner error={query.error} onRetry={query.reload} />}
          {query.status === "ready" && list.length === 0 && (
            <div className="card">
              <EmptyState icon={ClipboardCheck} title={t("reportsPhone.nothingToReportYet")}>
                {t("reportsPhone.whenAGrantIsActiveThe")}
              </EmptyState>
            </div>
          )}
          {query.status === "ready" && list.length > 0 && (
            <>
              <section style={{ display: "flex", flexDirection: "column", gap: "10px" }} aria-labelledby="due-h">
                <h2 id="due-h" style={{ fontSize: "20px" }}>
                  {t("reportsPhone.dueAcrossFunders")}
                </h2>
                {list.map((r) => {
                  const action = actionFor(r);
                  const attention = r.status === "due" || r.status === "overdue" || r.status === "returned";
                  return (
                    <div
                      key={r.id}
                      className="card"
                      style={{ "--tenant": accentOf(r.funder?.brand) ?? "var(--og-gray-600)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px", ...(attention ? { borderColor: "var(--s-warn-bd)" } : {}) } as CSSProperties}
                    >
                      <FunderChip name={r.funder?.name} accent={accentOf(r.funder?.brand)} style={{ alignSelf: "flex-start" }} />
                      <div className="b" style={{ fontSize: "16px", color: "var(--og-navy-dark)" }}>
                        {r.title} · {r.award?.title ?? t("reportsPhone.grant")}
                      </div>
                      <div className="row" style={{ justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                        <span className="small muted">
                          {duePhrase(r).text}
                          {r.releasesTrancheId ? ` · ${t("reportsPhone.releasesPayment")}` : ""}
                        </span>
                        <StatusBadge kind="requirement" status={r.status} />
                      </div>
                      {action && (
                        <button className={`btn btn-lg btn-block ${r.id === selected?.id ? "btn-secondary" : action.primary ? "btn-primary" : "btn-secondary"}`} type="button" aria-pressed={r.id === selected?.id} onClick={() => { setParams({ r: r.id }); document.getElementById("editor")?.scrollIntoView({ block: "start" }); }}>
                          {r.id === selected?.id ? t("reportsPhone.openBelow") : action.label}
                          <span className="sr">
                            {": "}
                            {r.funder?.name ? t("reportsPhone.srFor", { title: r.title, funder: r.funder.name }) : t("reportsPhone.srForFunder", { title: r.title })}
                          </span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </section>
              {selected && <Editor key={selected.id} requirement={selected} data={query.data} onChanged={query.reload} />}
            </>
          )}
        </main>
      </PhoneShell>
    </>
  );
}
