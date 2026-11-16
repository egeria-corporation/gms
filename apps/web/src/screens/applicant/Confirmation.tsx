// SPDX-License-Identifier: AGPL-3.0-only
// Shown right after a submission: what was sent, what was attached from Passport, what happens next.
import { Link, useParams } from "react-router";
import { Check, Mail } from "lucide-react";
import type { ApplicantApi } from "../../api/applicant.ts";
import { useApplicantQuery } from "../../api/applicantHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { accentOf, FunderChip, isNotFound, Loaded } from "../../components/applicant.tsx";
import { NotFound } from "../../components/NotFound.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { LevelBadge, VerificationBadge } from "../../components/status.tsx";
import { Notice } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";
import { t, useApplicantText } from "./i18n.ts";

const load = async (api: ApplicantApi, id: string) => {
  const [app, status, list] = await Promise.all([api.application(id), api.applicationStatus(id), api.applications()]);
  return { app, status, summary: list.find((a) => a.id === app.id) };
};

export default function Confirmation() {
  useApplicantText();
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const { appId = "" } = useParams();
  const query = useApplicantQuery((api) => load(api, appId), [appId, ws.id]);
  if (query.status === "error" && isNotFound(query.error)) return <NotFound />;

  return (
    <>
      <title>{t("confirmation.pageTitle", { workspace: ws.name })}</title>
      <ApplicantShell active="Applications">
        <main className="main" style={{ alignItems: "center" }}>
          <div className="crumbs" style={{ alignSelf: "flex-start" }}>
            <Link to={base}>{t("confirmation.dashboard")}</Link>
            <span>›</span>
            <Link to={`${base}/applications`}>{t("confirmation.applications")}</Link>
            <span>›</span>
            <span>{t("confirmation.submitted")}</span>
          </div>
          <Loaded query={query}>
            {({ app, status, summary }) =>
              !app.submittedAt ? (
                <Notice tone="info" title={t("confirmation.thisApplicationHasNotBeenSubmitted")}>
                  <Link to={`${base}/applications/${app.id}/edit`}>{t("confirmation.continueEditing")}</Link>
                </Notice>
              ) : (
                <div className="card" style={{ width: "100%", maxWidth: "760px", padding: "40px 44px", display: "flex", flexDirection: "column", gap: "22px", alignItems: "center", textAlign: "center", marginTop: "24px" }}>
                  <span style={{ width: "64px", height: "64px", borderRadius: "50%", background: "var(--s-ok-bg)", color: "var(--s-ok-fg)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    <Check className="ic ic-xl" aria-hidden="true" />
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}>
                    <FunderChip name={summary?.funder.name} accent={accentOf(summary?.funder.brand)} />
                    <h1 style={{ fontSize: "26px" }}>{summary?.funder.name ? t("confirmation.submittedTo", { funder: summary.funder.name }) : t("confirmation.submittedToTheFunder")}</h1>
                    <p className="muted">{[app.title, summary?.opportunity.title, summary?.stage.label].filter(Boolean).join(" · ")}</p>
                  </div>
                  <dl className="kv" style={{ gridTemplateColumns: "160px minmax(0, 1fr)", textAlign: "left", width: "100%", maxWidth: "520px", fontSize: "15px" }}>
                    <dt>{t("confirmation.submitted")}</dt>
                    <dd>{formatDate(app.submittedAt)}</dd>
                    <dt>{t("confirmation.applicationId")}</dt>
                    <dd>
                      <span className="mono" style={{ fontSize: "14px" }}>
                        {app.id}
                      </span>
                    </dd>
                    {app.verificationLevel ? (
                      <>
                        <dt>{t("confirmation.attachedFromPassport")}</dt>
                        <dd className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                          <LevelBadge level={app.verificationLevel} />
                          <span>{t("confirmation.attestationPayeeStatusBankNameAnd")}</span>
                        </dd>
                      </>
                    ) : (
                      <>
                        <dt>{t("confirmation.verification")}</dt>
                        <dd className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                          <VerificationBadge verification={{ source: "self_declared", level: null }} />
                          <span>{t("confirmation.theFunderSeesTheDetailsYou")}</span>
                        </dd>
                      </>
                    )}
                    {app.eligibility && (
                      <>
                        <dt>{t("confirmation.eligibility")}</dt>
                        <dd>{app.eligibility.eligible === true ? t("confirmation.allRulesPass") : app.eligibility.eligible === false ? t("confirmation.aRuleDidNotPassThe") : t("confirmation.someRulesNeedAPersonTo")}</dd>
                      </>
                    )}
                  </dl>
                  <div style={{ width: "100%", maxWidth: "640px", display: "flex", flexDirection: "column", gap: "10px", textAlign: "left" }}>
                    <span className="eyebrow">{t("confirmation.whatHappensNext")}</span>
                    <div className="stp" role="group" aria-label={t("confirmation.competitionStages")} style={{ flexWrap: "wrap", rowGap: "8px" }}>
                      {status.stages.map((s, i) => (
                        <span key={s.key} style={{ display: "contents" }}>
                          {i > 0 && <span className={s.state === "upcoming" ? "ln" : "ln done"}></span>}
                          <div className={s.state === "done" ? "s done" : s.state === "current" ? "s on" : "s"}>
                            <span className="n">{s.state === "done" ? <Check className="ic ic-sm" aria-hidden="true" /> : i + 1}</span>
                            {s.label}
                          </div>
                        </span>
                      ))}
                    </div>
                    <p className="small muted">{summary?.funder.name ? t("confirmation.nextSteps", { funder: summary.funder.name }) : t("confirmation.nextStepsTheFunder")}</p>
                  </div>
                  <div className="row" style={{ gap: "12px", marginTop: "6px", flexWrap: "wrap", justifyContent: "center" }}>
                    <Link to={`${base}/applications/${app.id}`} className="btn btn-primary btn-lg">
                      {t("confirmation.viewStatus")}
                    </Link>
                    <Link to={base} className="btn btn-secondary btn-lg">
                      {t("confirmation.backToDashboard")}
                    </Link>
                  </div>
                  <p className="notice" style={{ justifyContent: "center" }}>
                    <Mail className="ic" aria-hidden="true" />
                    {t("confirmation.anAcknowledgmentIsSentToYour")}
                  </p>
                </div>
              )
            }
          </Loaded>
        </main>
      </ApplicantShell>
    </>
  );
}
