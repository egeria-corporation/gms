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

const CHECK = {
  pass: { cls: "rc-pass", icon: CircleCheck, word: "Passes" },
  fail: { cls: "rc-fail", icon: CircleX, word: "Needs attention" },
  unknown: { cls: "rc-unk", icon: CircleDashed, word: "Unknown" },
} as const;

function Readiness({ readiness, base }: { readiness: ApplicantReadiness; base: string }) {
  const passportFlags = usePassportFlags();
  return (
    <section className="card" aria-labelledby="ready-h">
      <div className="card-h" style={{ padding: "14px 16px" }}>
        <h3 id="ready-h" style={{ fontSize: "16px" }}>
          {readiness.linked ? "Passport readiness" : "Readiness"}
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
                  <div className="l">{c.label}</div>
                  <div className="r">{c.reason}</div>
                </div>
                <span></span>
              </li>
            );
          })}
        </ul>
        {readiness.linked ? (
          <Link to={`${base}/organization`} className="btn btn-secondary btn-lg btn-block">
            Manage in Passport
          </Link>
        ) : passportFlags.linking ? (
          <Link to="/onboarding/applicant" className="btn btn-primary btn-lg btn-block">
            Connect Passport
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
          <span className="small muted">{app.submittedAt ? `Submitted ${formatDate(app.submittedAt)}` : app.opportunity.title}</span>
        )}
        {editable && (
          <span className="small muted">
            {app.forms.complete} of {app.forms.total} forms complete
          </span>
        )}
      </div>
    </Link>
  );
}

export default function DashboardPhone() {
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const query = useApplicantQuery(loadDashboard, [ws.id]);
  return (
    <>
      <title>{`Dashboard — ${ws.name}`}</title>
      <PhoneShell title="Dashboard" active="Dashboard">
        <main className="main" style={{ flex: 1 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span className="eyebrow">{ws.name}</span>
            <h2 style={{ fontSize: "22px" }}>
              {greeting()}, {firstName(ws.member.name)}
            </h2>
          </div>
          <Loaded query={query} label="Loading your dashboard">
            {(d) => (
              <>
                <Readiness readiness={d.readiness} base={base} />
                <section style={{ display: "flex", flexDirection: "column", gap: "10px" }} aria-labelledby="apps-h">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <h3 id="apps-h" style={{ fontSize: "16px" }}>
                      Active applications
                    </h3>
                    <Link to={`${base}/find`} className="small b">
                      Find funding
                    </Link>
                  </div>
                  {d.applications.length ? (
                    d.applications.map((a) => <ApplicationCard key={a.id} app={a} base={base} />)
                  ) : (
                    <div className="card">
                      <EmptyState icon={Search} title="Nothing in progress" actions={<Link to={`${base}/find`} className="btn btn-primary">Find funding</Link>}>
                        Start an application with your Passport profile already filled in.
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
