// SPDX-License-Identifier: AGPL-3.0-only
// Applicant dashboard: Passport readiness, applications in flight, payments and reports from the
// grants on record, the latest shared message and open tasks.
import { Link } from "react-router";
import { CircleCheck, CircleDashed, CircleX, Info, Search } from "lucide-react";
import type { ApplicantApi, ApplicantReadiness, AwardDetail, MyApplication, Task, Thread } from "../../api/applicant.ts";
import { useApplicantQuery } from "../../api/applicantHooks.ts";
import { useAppConfig, usePassportFlags } from "../../api/launchHooks.ts";
import { useIsPhone } from "../../app/usePhone.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { accentOf, Avatar, closesPhrase, firstName, FunderChip, greeting, Loaded, timeAgo } from "../../components/applicant.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { LevelBadge, StatusBadge, VerificationBadge } from "../../components/status.tsx";
import { EmptyState, Notice } from "../../components/ui.tsx";
import { formatDate, formatMinor } from "../../lib/format.ts";

const OPEN: MyApplication["status"][] = ["draft", "submitted", "screening", "under_review", "revision_requested", "interview", "recommended", "waitlisted"];

export interface DashboardData {
  readiness: ApplicantReadiness;
  applications: MyApplication[];
  awards: AwardDetail[];
  threads: Thread[];
  tasks: Task[];
  /** Parts that could not be loaded this time; the rest of the dashboard still shows. */
  missing: string[];
}

export async function loadDashboard(api: ApplicantApi): Promise<DashboardData> {
  // One list failing must not blank the whole dashboard: it shows empty, with a note saying so.
  const missing: string[] = [];
  const or = <T,>(what: string, read: Promise<T[]>): Promise<T[]> =>
    read.catch(() => {
      missing.push(what);
      return [] as T[];
    });
  const [readiness, applications, awardList, tasks] = await Promise.all([api.readiness(), or("applications", api.applications()), or("grants", api.awards()), or("tasks", api.tasks())]);
  const active = applications.filter((a) => OPEN.includes(a.status));
  const [awards, threads] = await Promise.all([
    Promise.all(awardList.filter((w) => w.status !== "cancelled").map((w) => api.award(w.id))),
    Promise.all(active.slice(0, 5).map((a) => api.threads(a.id).catch(() => [] as Thread[]))),
  ]);
  return { readiness, applications: active, awards, threads: threads.flat(), tasks, missing };
}

const CHECK = {
  pass: { cls: "rc-pass", icon: CircleCheck, word: "Passes" },
  fail: { cls: "rc-fail", icon: CircleX, word: "Needs attention" },
  unknown: { cls: "rc-unk", icon: CircleDashed, word: "Unknown" },
} as const;

function ReadinessCard({ readiness, base }: { readiness: ApplicantReadiness; base: string }) {
  const failing = readiness.checks.find((c) => c.state === "fail");
  // Whether funders on this site can pay through Passport at all. Where they cannot, a missing
  // payee holds nothing up, and the card must not say it does.
  const { facilitatedPayments } = useAppConfig();
  const passportFlags = usePassportFlags();
  return (
    <section className="card" aria-labelledby="ready-h">
      <div className="card-h">
        <div className="row" style={{ gap: "10px" }}>
          <h2 id="ready-h" style={{ fontSize: "18px" }}>
            {readiness.linked ? "Passport readiness" : "Readiness"}
          </h2>
          {readiness.linked ? <LevelBadge level={readiness.level} /> : <VerificationBadge verification={{ source: "self_declared", level: null }} />}
        </div>
        <Link to={`${base}/organization`} className="small b">
          View organization
        </Link>
      </div>
      <div className="card-b" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "14px" }}>
        {readiness.checks.map((c) => {
          const look = CHECK[c.state];
          return (
            <div key={c.key} className={`rc-row ${look.cls}`} style={{ display: "flex", gap: "10px", border: "0", padding: "0" }}>
              <look.icon className="ic" role="img" aria-label={look.word} />
              <div>
                <div className="l">{c.label}</div>
                <div className="r">{c.reason}</div>
              </div>
            </div>
          );
        })}
      </div>
      {!readiness.linked && (
        <div className="card-f">
          {passportFlags.linking ? (
            <>
              <Link to="/onboarding/applicant" className="btn btn-primary">
                Connect Passport
              </Link>
              <span className="help">Optional. Your organization record, documents and payee status come from Passport, and funders see you as verified.</span>
            </>
          ) : (
            <span className="help">Funders see the details you entered in Settings, marked as not verified.</span>
          )}
        </div>
      )}
      {readiness.linked && failing && (
        <div className="card-f">
          {failing.fixHref ? (
            // Opens Passport itself, where the fix is made.
            <a href={failing.fixHref} className="btn btn-primary">
              {failing.key === "payee_verified" ? "Verify payee in Passport" : "Fix in Passport"}
            </a>
          ) : (
            <Link to={`${base}/organization`} className="btn btn-primary">
              See what is needed
            </Link>
          )}
          <span className="help">
            {failing.key !== "payee_verified"
              ? failing.reason
              : facilitatedPayments
                ? "Awards can be offered, but a funder cannot pay through Passport until your payee is verified (L3)."
                : "Funders on this site pay outside the GMS, so this holds nothing up today. A verified payee (L3) is needed where a funder pays through Passport."}
          </span>
        </div>
      )}
      {readiness.summary.unknown > 0 && readiness.linked && (
        <div className="card-b" style={{ paddingTop: 0 }}>
          <div className="bnr bnr-neu">
            <Info className="ic" aria-hidden="true" />
            <div>
              <div className="t">Some checks can’t be confirmed right now</div>
              <div className="d">Applications stay editable; anything that depends on an unknown check waits until Passport answers.</div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ApplicationCard({ app, base }: { app: MyApplication; base: string }) {
  const editable = app.status === "draft" || app.status === "revision_requested";
  const closes = editable ? closesPhrase(app.stage.closes) : null;
  return (
    <Link
      to={`${base}/applications/${app.id}${editable ? "/edit" : ""}`}
      className="card"
      style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: "8px", textDecoration: "none", color: "inherit" }}
    >
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
        <FunderChip name={app.funder.name} accent={accentOf(app.funder.brand)} />
        <StatusBadge kind="application" status={app.status} />
      </div>
      <h3 style={{ fontSize: "17px" }}>{app.title}</h3>
      <div className="row" style={{ gap: "14px", flexWrap: "wrap", fontSize: "14px", color: "var(--og-gray-600)" }}>
        {app.opportunity.title && <span>{app.opportunity.title}</span>}
        <span>·</span>
        <span>{app.stage.label} stage</span>
        {closes && (
          <>
            <span>·</span>
            <span className="b" style={closes.urgent ? { color: "var(--s-warn-fg)" } : undefined}>
              {closes.text}
            </span>
          </>
        )}
        {!editable && app.submittedAt && (
          <>
            <span>·</span>
            <span>Submitted {formatDate(app.submittedAt)}</span>
          </>
        )}
        {editable && (
          <span style={{ marginLeft: "auto" }}>
            {app.forms.complete} of {app.forms.total} forms complete
          </span>
        )}
      </div>
    </Link>
  );
}

const CONDITION: Record<string, string> = { onExecution: "on execution", onReportAccepted: "after report accepted", onDate: "on a date", manual: "released by funder" };

export function Payments({ awards, base, phone }: { awards: AwardDetail[]; base: string; phone: boolean }) {
  const rows = awards.flatMap((w) => w.tranches.map((t) => ({ w, t })));
  if (!rows.length) return null;
  return (
    <section className="card" aria-labelledby="pay-h">
      <div className="card-h">
        <h2 id="pay-h" style={{ fontSize: "18px" }}>
          Payments
        </h2>
        <Link to={`${base}/grants/${rows[0]!.w.id}`} className="small b">
          Open grant
        </Link>
      </div>
      {phone ? (
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {rows.map(({ w, t }) => (
            <Link key={t.id} to={`${base}/grants/${w.id}`} style={{ display: "flex", flexDirection: "column", gap: "6px", textDecoration: "none", color: "inherit" }}>
              <div className="row" style={{ justifyContent: "space-between", gap: "8px" }}>
                <span className="b" style={{ fontSize: "15px" }}>
                  {w.funder.name} · Tranche {t.seq} of {w.tranches.length}
                </span>
                <span className="b num">{formatMinor(t.amountMinor, t.currency)}</span>
              </div>
              <div className="row wrap" style={{ gap: "8px" }}>
                <StatusBadge kind="tranche" status={t.status} />
                <span className="small muted">{CONDITION[String(t.condition.type)] ?? ""}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }} tabIndex={0} role="region" aria-label="Table, scrollable">
          <table className="tbl" style={{ fontSize: "14px" }}>
            <thead>
              <tr>
                <th>Funder</th>
                <th>Tranche</th>
                <th className="num">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ w, t }) => (
                <tr key={t.id}>
                  <td>
                    <FunderChip name={w.funder.name} accent={accentOf(w.funder.brand)} short />
                  </td>
                  <td>
                    {t.seq} of {w.tranches.length} · {CONDITION[String(t.condition.type)] ?? ""}
                  </td>
                  <td className="num">{formatMinor(t.amountMinor, t.currency)}</td>
                  <td>
                    <StatusBadge kind="tranche" status={t.status} />
                    {t.holdReason && <span className="small muted"> {t.holdReason}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ReportsDue({ awards, base }: { awards: AwardDetail[]; base: string }) {
  const rows = awards
    .flatMap((w) => w.requirements.filter((r) => !["accepted", "waived"].includes(r.status)).map((r) => ({ w, r })))
    .sort((a, b) => (a.r.dueAt ?? "9").localeCompare(b.r.dueAt ?? "9"));
  if (!rows.length) return null;
  return (
    <section className="card" aria-labelledby="rep-h">
      <div className="card-h">
        <h2 id="rep-h" style={{ fontSize: "18px" }}>
          Reports due
        </h2>
        <Link to={`${base}/reports`} className="small b">
          All reports
        </Link>
      </div>
      <ul className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "16px 20px" }}>
        {rows.map(({ w, r }) => {
          const tranche = w.tranches.find((t) => t.id === r.releasesTrancheId);
          return (
            <li key={r.id} className="row" style={{ gap: "12px", alignItems: "flex-start" }}>
              <span style={{ flex: "none" }}>
                <StatusBadge kind="requirement" status={r.status} />
              </span>
              <div>
                <Link to={`${base}/reports?r=${encodeURIComponent(r.id)}`} className="b">
                  {r.title} · {w.title}
                </Link>
                <div className="small muted">
                  <FunderChip name={w.funder.name} accent={accentOf(w.funder.brand)} short style={{ height: "20px", fontSize: "11px" }} /> · due {formatDate(r.dueAt)}
                  {tranche ? ` · releases tranche ${tranche.seq}` : ""}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function Messages({ threads, applications, base }: { threads: Thread[]; applications: MyApplication[]; base: string }) {
  const latest = threads
    .flatMap((t) => t.messages.map((m) => ({ t, m })))
    .sort((a, b) => b.m.createdAt.localeCompare(a.m.createdAt))
    .slice(0, 2);
  if (!latest.length) return null;
  const appOf = (t: Thread) => applications.find((a) => a.id === `app_${t.subjectId}`);
  return (
    <section className="card" aria-labelledby="msg-h">
      <div className="card-h">
        <h2 id="msg-h" style={{ fontSize: "18px" }}>
          Messages
        </h2>
        <Link to={`${base}/applications/app_${latest[0]!.t.subjectId}`} className="small b">
          Open thread
        </Link>
      </div>
      <div className="card-b th" style={{ padding: "16px 20px" }}>
        {latest.map(({ t, m }, i) => (
          <div className="msg" key={m.id}>
            <Avatar name={m.author} index={i + 3} />
            <div className="bub">
              <div className="hd">
                <span className="who">{m.author}</span>
                {appOf(t)?.funder.name && <span>· {appOf(t)!.funder.name}</span>}
                <span className="shared-mark">Shared</span>
                <span>· {timeAgo(m.createdAt)}</span>
              </div>
              <div className="bd">{m.body}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Tasks({ tasks, applications, base }: { tasks: Task[]; applications: MyApplication[]; base: string }) {
  if (!tasks.length) return null;
  return (
    <section className="card" aria-labelledby="task-h">
      <div className="card-h">
        <h2 id="task-h" style={{ fontSize: "18px" }}>
          Tasks
        </h2>
        <span className="small muted">{tasks.length} open</span>
      </div>
      <ul className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px 20px" }}>
        {tasks.map((t) => {
          const app = applications.find((a) => a.id === `app_${t.subjectId}`);
          return (
            <li key={t.id} className="cb">
              <span className="c" aria-hidden="true"></span>
              <div className="grow">
                {app ? (
                  <Link to={`${base}/applications/${app.id}/edit`} className="b">
                    {t.title}
                  </Link>
                ) : (
                  <span className="b">{t.title}</span>
                )}
                <div className="small muted">
                  {app?.title}
                  {t.dueAt ? `${app ? " · " : ""}due ${formatDate(t.dueAt)}` : ""}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function Dashboard() {
  const ws = useWorkspace("applicant");
  const phone = useIsPhone();
  const base = `/w/${ws.handle}`;
  const query = useApplicantQuery(loadDashboard, [ws.id]);
  const reportsDue = query.status === "ready" ? query.data.awards.flatMap((w) => w.requirements).filter((r) => ["due", "overdue", "returned"].includes(r.status)).length : 0;
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  return (
    <>
      <title>{`Dashboard — ${ws.name}`}</title>
      <ApplicantShell active="Dashboard">
        <main className="main">
          <div className="ph">
            <div>
              {phone && <span className="eyebrow">{ws.name}</span>}
              <h1>
                {greeting()}, {firstName(ws.member.name)}
              </h1>
              {query.status === "ready" && !phone && (
                <div className="meta">
                  <span>{ws.name}</span>
                  <span>·</span>
                  <span>{count(query.data.applications.length, "active application", "active applications")}</span>
                  <span>·</span>
                  <span>{count(query.data.awards.filter((w) => w.status === "active").length, "active grant", "active grants")}</span>
                  <span>·</span>
                  <span>{count(reportsDue, "report due", "reports due")}</span>
                </div>
              )}
            </div>
            <div className="actions">
              <Link to={`${base}/find`} className="btn btn-primary">
                <Search className="ic" aria-hidden="true" />
                Find funding
              </Link>
            </div>
          </div>

          <Loaded query={query} label="Loading your dashboard">
            {(d) => {
              const nothing = !d.applications.length && !d.awards.length;
              return (
                <>
                  <ReadinessCard readiness={d.readiness} base={base} />
                  {d.missing.length > 0 && (
                    <Notice tone="neu" title={`Your ${d.missing.join(" and ")} could not be loaded just now`}>
                      The rest of the dashboard is up to date. Reload the page to try again.
                    </Notice>
                  )}
                  {nothing && d.missing.length === 0 ? (
                    <div className="card">
                      <EmptyState
                        icon={Search}
                        title="No applications or grants yet"
                        actions={
                          <>
                            <Link to={`${base}/find`} className="btn btn-primary">
                              Find funding
                            </Link>
                            <Link to={`${base}/organization`} className="small b">
                              Review your organization profile
                            </Link>
                          </>
                        }
                      >
                        {d.readiness.linked
                          ? "Your Passport record is ready. Find an opportunity you are eligible for and start an application with your profile already filled in."
                          : "Find an opportunity you are eligible for and start an application. Connect Passport any time to have your profile filled in and verified."}
                      </EmptyState>
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                        <section className="card" aria-labelledby="apps-h">
                          <div className="card-h">
                            <h2 id="apps-h" style={{ fontSize: "18px" }}>
                              Active applications
                            </h2>
                            <Link to={`${base}/applications`} className="small b">
                              View all
                            </Link>
                          </div>
                          <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            {d.applications.length ? (
                              d.applications.map((a) => <ApplicationCard key={a.id} app={a} base={base} />)
                            ) : (
                              <p className="muted">
                                Nothing in progress. <Link to={`${base}/find`}>Find funding</Link>
                              </p>
                            )}
                          </div>
                        </section>
                        <Payments awards={d.awards} base={base} phone={phone} />
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                        <ReportsDue awards={d.awards} base={base} />
                        <Messages threads={d.threads} applications={d.applications} base={base} />
                        <Tasks tasks={d.tasks} applications={d.applications} base={base} />
                      </div>
                    </div>
                  )}
                </>
              );
            }}
          </Loaded>
        </main>
      </ApplicantShell>
    </>
  );
}
