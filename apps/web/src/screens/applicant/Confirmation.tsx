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
import { LevelBadge } from "../../components/status.tsx";
import { Notice } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";

const load = async (api: ApplicantApi, id: string) => {
  const [app, status, list] = await Promise.all([api.application(id), api.applicationStatus(id), api.applications()]);
  return { app, status, summary: list.find((a) => a.id === app.id) };
};

export default function Confirmation() {
  const ws = useWorkspace("applicant");
  const base = `/w/${ws.handle}`;
  const { appId = "" } = useParams();
  const query = useApplicantQuery((api) => load(api, appId), [appId, ws.id]);
  if (query.status === "error" && isNotFound(query.error)) return <NotFound />;

  return (
    <>
      <title>{`Submitted — ${ws.name}`}</title>
      <ApplicantShell active="Applications">
        <main className="main" style={{ alignItems: "center" }}>
          <div className="crumbs" style={{ alignSelf: "flex-start" }}>
            <Link to={base}>Dashboard</Link>
            <span>›</span>
            <Link to={`${base}/applications`}>Applications</Link>
            <span>›</span>
            <span>Submitted</span>
          </div>
          <Loaded query={query}>
            {({ app, status, summary }) =>
              !app.submittedAt ? (
                <Notice tone="info" title="This application has not been submitted yet">
                  <Link to={`${base}/applications/${app.id}/edit`}>Continue editing</Link>
                </Notice>
              ) : (
                <div className="card" style={{ width: "100%", maxWidth: "760px", padding: "40px 44px", display: "flex", flexDirection: "column", gap: "22px", alignItems: "center", textAlign: "center", marginTop: "24px" }}>
                  <span style={{ width: "64px", height: "64px", borderRadius: "50%", background: "var(--s-ok-bg)", color: "var(--s-ok-fg)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    <Check className="ic ic-xl" aria-hidden="true" />
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}>
                    <FunderChip name={summary?.funder.name} accent={accentOf(summary?.funder.brand)} />
                    <h1 style={{ fontSize: "26px" }}>Submitted to {summary?.funder.name ?? "the funder"}</h1>
                    <p className="muted">{[app.title, summary?.opportunity.title, summary?.stage.label].filter(Boolean).join(" · ")}</p>
                  </div>
                  <dl className="kv" style={{ gridTemplateColumns: "160px minmax(0, 1fr)", textAlign: "left", width: "100%", maxWidth: "520px", fontSize: "15px" }}>
                    <dt>Submitted</dt>
                    <dd>{formatDate(app.submittedAt)}</dd>
                    <dt>Application id</dt>
                    <dd>
                      <span className="mono" style={{ fontSize: "14px" }}>
                        {app.id}
                      </span>
                    </dd>
                    <dt>Attached from Passport</dt>
                    <dd className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                      <LevelBadge level={app.verificationLevel} />
                      <span>attestation · payee status (bank name and last four digits only)</span>
                    </dd>
                    {app.eligibility && (
                      <>
                        <dt>Eligibility</dt>
                        <dd>{app.eligibility.eligible === true ? "All rules pass" : app.eligibility.eligible === false ? "A rule did not pass; the funder will review it" : "Some rules need a person to review"}</dd>
                      </>
                    )}
                  </dl>
                  <div style={{ width: "100%", maxWidth: "640px", display: "flex", flexDirection: "column", gap: "10px", textAlign: "left" }}>
                    <span className="eyebrow">What happens next</span>
                    <div className="stp" aria-label="Competition stages" style={{ flexWrap: "wrap", rowGap: "8px" }}>
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
                    <p className="small muted">{summary?.funder.name ?? "The funder"} screens for eligibility first, then assigns reviewers. You’ll see each step and any message on the status page.</p>
                  </div>
                  <div className="row" style={{ gap: "12px", marginTop: "6px", flexWrap: "wrap", justifyContent: "center" }}>
                    <Link to={`${base}/applications/${app.id}`} className="btn btn-primary btn-lg">
                      View status
                    </Link>
                    <Link to={base} className="btn btn-secondary btn-lg">
                      Back to dashboard
                    </Link>
                  </div>
                  <p className="notice" style={{ justifyContent: "center" }}>
                    <Mail className="ic" aria-hidden="true" />
                    An acknowledgment is sent to your organization’s primary email in Passport.
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
