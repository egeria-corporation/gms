// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import { Columns3, Download, Inbox } from "lucide-react";
import { useWorkspace } from "../../app/workspace.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { t } from "./i18n.ts";

/** What Applications shows a funder who has no program yet: the four steps to the first application. */
export default function ApplicationsEmpty() {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  return (
    <>
      <title>{t("applicationsEmpty.applications", { name: ws.name })}</title>
      <FunderShell active="Applications" firstRun>
        <main className="main">
          <div className="crumbs">
            <Link to={base}>{ws.name}</Link>
            <span>›</span>
            <span>{t("applicationsEmpty.applications2")}</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>{t("applicationsEmpty.applications2")}</h1>
              </div>
              <div className="meta">
                <span>{t("applicationsEmpty.noCompetitionsYet")}</span>
              </div>
            </div>
            <div className="actions">
              <button className="btn btn-secondary" disabled aria-disabled="true">
                <Columns3 className="ic" aria-hidden="true" />
                {t("applicationsEmpty.columns")}
              </button>
              <button className="btn btn-secondary" disabled aria-disabled="true">
                <Download className="ic" aria-hidden="true" />
                {t("applicationsEmpty.export")}
              </button>
            </div>
          </div>
          <nav className="tabs" aria-label={t("applicationsEmpty.savedViews")}>
            <Link to={`${base}/applications`} className="tab on" aria-current="page">
              {t.rich("applicationsEmpty.all0", { span: (chunks) => <span className="n">{chunks}</span> })}
            </Link>
            <span className="tab" aria-disabled="true">
              {t.rich("applicationsEmpty.needsScreening0", { span: (chunks) => <span className="n">{chunks}</span> })}
            </span>
            <span className="tab" aria-disabled="true">
              {t.rich("applicationsEmpty.reviewComplete0", { span: (chunks) => <span className="n">{chunks}</span> })}
            </span>
            <span className="tab" aria-disabled="true">
              {t.rich("applicationsEmpty.flagged0", { span: (chunks) => <span className="n">{chunks}</span> })}
            </span>
          </nav>
          <div className="card empty" style={{ minHeight: "360px", justifyContent: "center", padding: "64px 24px" }}>
            <Inbox className="ic" aria-hidden="true" />
            <h3 style={{ fontSize: "20px" }}>{t("applicationsEmpty.noApplicationsYet")}</h3>
            <p style={{ fontSize: "15px" }}>
              {t("applicationsEmpty.publishAnOpportunityTo")}
            </p>
            <div className="acts" style={{ marginTop: "10px" }}>
              <Link to={`${base}/programs`} className="btn btn-primary btn-lg">
                {t("applicationsEmpty.createAProgram")}
              </Link>
              <Link to={`${base}/analytics`} className="b" style={{ fontSize: "14px" }}>
                {t("applicationsEmpty.importApplicationsFromCsv")}
              </Link>
            </div>
          </div>
          <div className="card" style={{ padding: "18px 20px", background: "#F7FAFA" }}>
            <div className="eyebrow" style={{ marginBottom: "12px" }}>
              {t("applicationsEmpty.whatHappensNext")}
            </div>
            <div className="stp" role="group" aria-label={t("applicationsEmpty.setupSteps")}>
              <Link to={`${base}/programs`} className="s" style={{ textDecoration: "none" }}>
                <span className="n">1</span>
                <div>
                  <div>{t("applicationsEmpty.program")}</div>
                  <div className="small muted" style={{ fontWeight: 400 }}>
                    {t("applicationsEmpty.budgetDefaultsOwner")}
                  </div>
                </div>
              </Link>
              <div className="ln"></div>
              <Link to={`${base}/opportunities/new`} className="s" style={{ textDecoration: "none" }}>
                <span className="n">2</span>
                <div>
                  <div>{t("applicationsEmpty.opportunity")}</div>
                  <div className="small muted" style={{ fontWeight: 400 }}>
                    {t("applicationsEmpty.fundingDatesWhoCan")}
                  </div>
                </div>
              </Link>
              <div className="ln"></div>
              <Link to={`${base}/forms`} className="s" style={{ textDecoration: "none" }}>
                <span className="n">3</span>
                <div>
                  <div>{t("applicationsEmpty.form")}</div>
                  <div className="small muted" style={{ fontWeight: 400 }}>
                    {t("applicationsEmpty.fieldsPassportPrefillsBudget")}
                  </div>
                </div>
              </Link>
              <div className="ln"></div>
              <Link to={`${base}/opportunities`} className="s" style={{ textDecoration: "none" }}>
                <span className="n">4</span>
                <div>
                  <div>{t("applicationsEmpty.launch")}</div>
                  <div className="small muted" style={{ fontWeight: 400 }}>
                    {t("applicationsEmpty.stagesReviewersChecklistPublic")}
                  </div>
                </div>
              </Link>
            </div>
          </div>
        </main>
      </FunderShell>
    </>
  );
}
