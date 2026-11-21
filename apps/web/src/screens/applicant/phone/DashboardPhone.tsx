// SPDX-License-Identifier: AGPL-3.0-only
// The applicant dashboard at phone width, as the 390px artboard draws it: a greeting, the Passport
// readiness list with one full-width action, one card per active application, then reports,
// payments, messages and tasks. Same data as the desktop dashboard (../Dashboard.tsx).
import { Link } from "react-router";
import { CircleCheck, CircleDashed, CircleX, Clock, Search } from "lucide-react";
import type { ApplicantReadiness, MyApplication } from "../../../api/applicant.ts";
import { useApplicantQuery } from "../../../api/applicantHooks.ts";
import { useWorkspace } from "../../../app/workspace.tsx";
import { accentOf, closesPhrase, firstName, FunderChip, greeting, Loaded } from "../../../components/applicant.tsx";
import { PhoneShell } from "../../../components/PhoneShell.tsx";
import { usePassportFlags } from "../../../api/launchHooks.ts";
import { LevelBadge, VerificationBadge, StatusBadge } from "../../../components/status.tsx";
import { EmptyState } from "../../../components/ui.tsx";
import { formatDate } from "../../../lib/format.ts";
import { loadDashboard, Messages, Payments, ReportsDue, Tasks } from "../Dashboard.tsx";
import { t, useApplicantText } from "../i18n.ts";
import { readinessWords } from "../../../lib/readinessText.ts";
import { YourProfilePanel } from "../YourProfilePanel.tsx";

const CHECK = {
  pass: { cls: "rc-pass", icon: CircleCheck, get word() { return t("dashboard.check.pass"); } },
  fail: { cls: "rc-fail", icon: CircleX, get word() { return t("dashboard.check.fail"); } },
  unknown: { cls: "rc-unk", icon: CircleDashed, get word() { return t("dashboard.check.unknown"); } },
};

function Readiness({ readiness, base }: { readiness: ApplicantReadiness; base: string }) {
  const passportFlags = usePassportFlags();
  return (
    <section className="card" aria-labelledby="ready-h">
      <div className="card-h" style={{ padding: "14px 16px" }}>
        <h3 id="ready-h" style={{ fontSize: "16px" }}>
          {readiness.linked ? t("dashboardPhone.passportReadiness") : t("dashboardPhone.readiness")}
        </h3>
        {readiness.linked ? <LevelBadge level={readiness.level} /> : <VerificationBadge verification={{ source: "self_declared", level: null }} />}
      </div>
      <div className="card-b" style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <ul className="rc" style={{ fontSize: "15px" }}>
          {readiness.checks.map((c, i) => {
            const look = CHECK[c.state];
            return (
              <li key={c.key} className={`rc-row ${look.cls}`} style={{ padding: "8px 0", ...(i === 0 ? { borderTop: 0 } : {}) }}>
                <look.icon className="ic" role="img" aria-label={look.word} />
                <div>
                  <div className="l">{readinessWords(c).label}</div>
                  <div className="r">{readinessWords(c).reason}</div>
                </div>
                <span></span>
              </li>
            );
          })}
        </ul>
        {readiness.linked ? (
          <Link to={`${base}/organization`} className="btn btn-secondary btn-lg btn-block">
            {t("dashboardPhone.manageInPassport")}
          </Link>
        ) : passportFlags.linking ? (
          <Link to="/onboarding/applicant" className="btn btn-primary btn-lg btn-block">
            {t("dashboardPhone.connectPassport")}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function ApplicationCard({ app, base }: { app: MyApplication; base: string }) {
  const editable = app.status === "draft" || app.status === "revision_requested";
  const closes = editable ? closesPhrase(app.stage.closes) : null;
  return (
    <Link to={`${base}/applications/${app.id}${editable ? "/edit" : ""}`} className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px", textDecoration: "none", color: "inherit" }}>
      <FunderChip name={app.funder.name} accent={accentOf(app.funder.brand)} style={{ alignSelf: "flex-start" }} />
      <div style={{ fontWeight: 700, color: "var(--og-navy-dark)", fontSize: "17px", lineHeight: 1.3 }}>{app.title}</div>
      <div className="row wrap" style={{ gap: "8px" }}>
        <span className="small muted">{app.stage.label}</span>
        <StatusBadge kind="application" status={app.status} />
      </div>
      <div className="row" style={{ justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
        {closes ? (
          <span className="row small b" style={{ gap: "5px", ...(closes.urgent ? { color: "var(--s-warn-fg)" } : {}) }}>
            <Clock className="ic" aria-hidden="true" />
            {closes.text}
          </span>
        ) : (
          <span className="small muted">{app.submittedAt ? t("dashboard.submittedOn", { date: formatDate(app.submittedAt) }) : app.opportunity.title}</span>
        )}
        {editable && (
          <span className="small muted">
            {t("dashboard.formsComplete", { complete: app.forms.complete, total: app.forms.total })}
          </span>
        )}
      </div>
    </Link>
  );
}

export default function DashboardPhone() {
  useApplicantText();
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const query = useApplicantQuery(loadDashboard, [ws.id]);
  return (
    <>
      <title>{t("dashboard.pageTitle", { workspace: ws.name })}</title>
      <PhoneShell title={t("dashboardPhone.dashboard")} active="Dashboard">
        <main className="main" style={{ flex: 1 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span className="eyebrow">{ws.name}</span>
            <h2 style={{ fontSize: "22px" }}>
              {greeting()}, {firstName(ws.member.name)}
            </h2>
          </div>
          <YourProfilePanel compact />
          <Loaded query={query} label={t("dashboardPhone.loadingYourDashboard")}>
            {(d) => (
              <>
                <Readiness readiness={d.readiness} base={base} />
                <section style={{ display: "flex", flexDirection: "column", gap: "10px" }} aria-labelledby="apps-h">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <h3 id="apps-h" style={{ fontSize: "16px" }}>
                      {t("dashboardPhone.activeApplications")}
                    </h3>
                    <Link to={`${base}/find`} className="small b">
                      {t("dashboardPhone.findFunding")}
                    </Link>
                  </div>
                  {d.applications.length ? (
                    d.applications.map((a) => <ApplicationCard key={a.id} app={a} base={base} />)
                  ) : (
                    <div className="card">
                      <EmptyState icon={Search} title={t("dashboardPhone.nothingInProgress")} actions={<Link to={`${base}/find`} className="btn btn-primary">{t("dashboardPhone.findFunding")}</Link>}>
                        {d.readiness.linked ? t("dashboardPhone.startAnApplicationWithYourPassport") : t("dashboard.findAnOpportunityYouAreEligible")}
                      </EmptyState>
                    </div>
                  )}
                </section>
                {d.awards.length > 0 && <ReportsDue awards={d.awards} base={base} />}
                {d.awards.length > 0 && <Payments awards={d.awards} base={base} phone />}
                <Messages threads={d.threads} applications={d.applications} base={base} />
                <Tasks tasks={d.tasks} applications={d.applications} base={base} />
              </>
            )}
          </Loaded>
        </main>
      </PhoneShell>
    </>
  );
}
