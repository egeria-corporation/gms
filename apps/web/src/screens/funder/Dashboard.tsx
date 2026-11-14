// SPDX-License-Identifier: AGPL-3.0-only
// Funder dashboard: what needs a person today. Counts, the pipeline of each competition by stage,
// committed money by program, open tasks, agent requests awaiting approval, and payee alerts
// (holds, destination changes, level drops) as Passport reports them. A published opportunity that
// is not taking applications is a task until a competition opens.
import { useAppConfig } from "../../api/launchHooks.ts";
import { Link } from "react-router";
import { Bot, Briefcase, CirclePause, ClipboardCheck, Eye, Gavel, Info } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { Task } from "../../api/funder.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { EmptyState, ErrorBanner, Loading, PageHeader } from "../../components/ui.tsx";
import { formatDate, formatMinor } from "../../lib/format.ts";
import { ActivityTimeline } from "../../components/ActivityTimeline.tsx";
import { ApprovalCard } from "./Approvals.tsx";
import { timeAgo, usePeople } from "./shared.tsx";
import { publishedNotTaking } from "./applicationsStatus.tsx";

const STAGE_COLORS = ["#4A5C5A", "#145450", "#2470B3", "#1E4F8F"];
const OPEN = ["submitted", "screening", "under_review", "revision_requested", "interview", "recommended"];

export default function Dashboard() {
  const { facilitatedPayments } = useAppConfig();
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const programs = useApiQuery((api) => api.listPrograms(), []);
  const competitions = useApiQuery((api) => api.listCompetitions(), []);
  const opportunities = useApiQuery((api) => api.listOpportunities(), []);
  const apps = useApiQuery((api) => api.listApplications({ pageSize: 100 }), []);
  const assignments = useApiQuery((api) => api.listAssignments(), []);
  const awards = useApiQuery((api) => api.listAwards(), []);
  const tasks = useApiQuery((api) => api.listTasks({ open: true, mine: true }), []);
  const approvals = useApiQuery((api) => api.listApprovals("pending"), []);
  const alerts = useApiQuery((api) => api.paymentAlerts(), []);
  const payments = useApiQuery((api) => api.paymentsReadiness(), []);
  const activity = useApiQuery((api) => api.listLedger({ pageSize: 6 }), []);
  const { person } = usePeople();
  const done = useApiMutation((api, t: Task) => api.updateTask(t.id, { done: true }));

  const counts = apps.data?.counts ?? {};
  const open = OPEN.reduce((n, s) => n + (counts[s] ?? 0), 0);
  const reviewsOpen = assignments.data?.filter((a) => ["assigned", "coi_declared", "in_progress"].includes(a.status)) ?? [];
  const toCountersign = awards.data?.filter((a) => a.status === "accepted").length ?? 0;
  const firstRun = programs.status === "ready" && programs.data.length === 0;
  // Published opportunities applicants can find but cannot apply to yet.
  const notTaking = opportunities.data && competitions.data ? opportunities.data.filter((o) => publishedNotTaking(o, competitions.data!)) : [];
  const today = new Date();

  return (
    <>
      <title>{`Dashboard — ${ws.name}`}</title>
      <FunderShell active="Dashboard" firstRun={firstRun}>
        <main className="main">
          <PageHeader
            crumbs={[{ label: ws.name, to: base }, { label: "Dashboard" }]}
            title="Dashboard"
            meta={
              <>
                <span>{today.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })}</span>
                <span>·</span>
                <span>{competitions.data?.filter((c) => c.status === "open").length ?? 0} open competitions</span>
              </>
            }
            actions={
              <>
                <Link to={`${base}/opportunities/new`} className="btn btn-secondary">
                  New opportunity
                </Link>
                <Link to={`${base}/programs`} className="btn btn-primary">
                  Programs
                </Link>
              </>
            }
          />

          {firstRun ? (
            <div className="card">
              <EmptyState
                icon={Briefcase}
                title="Start with a program"
                actions={
                  <Link to={`${base}/programs`} className="btn btn-primary">
                    Create a program
                  </Link>
                }
              >
                A program holds a budget, default rubric and templates. Opportunities, competitions and awards hang off it.
              </EmptyState>
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "16px" }}>
                <Link to={`${base}/applications`} className="stat" style={{ textDecoration: "none" }}>
                  <span className="stat-l">Open applications</span>
                  <span className="stat-v">{apps.status === "ready" ? open : "—"}</span>
                  <span className="stat-d">
                    <Eye className="ic ic-sm" aria-hidden="true" />
                    {counts.under_review ?? 0} under review · {counts.submitted ?? 0} need screening
                  </span>
                </Link>
                <Link to={`${base}/reviews/assign`} className="stat" style={{ textDecoration: "none" }}>
                  <span className="stat-l">Reviews outstanding</span>
                  <span className="stat-v">{assignments.status === "ready" ? reviewsOpen.length : "—"}</span>
                  <span className="stat-d">
                    <ClipboardCheck className="ic ic-sm" aria-hidden="true" />
                    {new Set(reviewsOpen.map((a) => a.reviewerUserId)).size} reviewers
                  </span>
                </Link>
                <Link to={`${base}/awards`} className="stat" style={{ textDecoration: "none" }}>
                  <span className="stat-l">Agreements to countersign</span>
                  <span className="stat-v">{awards.status === "ready" ? toCountersign : "—"}</span>
                  <span className="stat-d">
                    <Gavel className="ic ic-sm" aria-hidden="true" />
                    {awards.data?.length ?? 0} awards
                  </span>
                </Link>
                <Link to={`${base}/approvals`} className="stat" style={{ textDecoration: "none" }}>
                  <span className="stat-l">Agent requests</span>
                  <span className="stat-v">{approvals.status === "ready" ? approvals.data.length : "—"}</span>
                  <span className="stat-d">
                    <Bot className="ic ic-sm" aria-hidden="true" />
                    awaiting a person
                  </span>
                </Link>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
                <div className="col" style={{ gap: "20px" }}>
                  <section className="card" aria-labelledby="pipeline-h">
                    <div className="card-h">
                      <h3 id="pipeline-h">Pipeline</h3>
                      <Link to={`${base}/applications`} className="small b">
                        All applications
                      </Link>
                    </div>
                    <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                      {(competitions.status === "loading" || apps.status === "loading") && <Loading label="Loading the pipeline" />}
                      {apps.status === "error" && <ErrorBanner error={apps.error} onRetry={apps.reload} />}
                      {competitions.data?.length === 0 && <p className="muted">No competitions yet. Open one from an opportunity.</p>}
                      {competitions.data?.map((c) => {
                        const mine = apps.data?.items.filter((a) => a.competitionId === c.id) ?? [];
                        const decided = mine.filter((a) => ["accepted", "declined", "waitlisted"].includes(a.status)).length;
                        return (
                          <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                            <div className="row" style={{ justifyContent: "space-between" }}>
                              <Link to={`${base}/competitions/${c.id}`} className="b" style={{ color: "#0D2A43" }}>
                                {c.title}
                              </Link>
                              <span className="small muted">{mine.length} received</span>
                            </div>
                            <div className="pipe" role="group" aria-label={`${c.title} pipeline by stage`}>
                              {c.stages.map((s, i) => {
                                const n = mine.filter((a) => a.stage === s.key && !["accepted", "declined", "waitlisted"].includes(a.status)).length;
                                return (
                                  <Link key={s.key} to={`${base}/applications?stage=${encodeURIComponent(s.key)}`} style={{ flex: Math.max(n, 1), background: STAGE_COLORS[i % STAGE_COLORS.length] }} title={`${s.label}: ${n}`}>
                                    {s.label} {n}
                                  </Link>
                                );
                              })}
                              <Link to={`${base}/competitions/${c.id}/panel`} style={{ flex: Math.max(decided, 1), background: "#D6DEDE", color: "#1E2D2B" }} title={`Decided: ${decided}`}>
                                Decided {decided}
                              </Link>
                            </div>
                            <div className="row small muted" style={{ gap: "14px", flexWrap: "wrap" }}>
                              {c.stages.map((s) => (
                                <span key={s.key}>
                                  {s.label} closes {formatDate(s.closes)}
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  <section className="card" aria-labelledby="programs-h">
                    <div className="card-h">
                      <h3 id="programs-h">Committed vs paid by program</h3>
                      <Link to={`${base}/analytics`} className="small b">
                        Analytics
                      </Link>
                    </div>
                    <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                      {programs.data?.map((p) => {
                        const mine = awards.data?.filter((a) => a.programId === p.id && a.status !== "cancelled") ?? [];
                        const committed = mine.reduce((n, a) => n + (a.awardedAmountMinor ?? 0), 0);
                        const paid = mine.reduce((n, a) => n + (a.disbursedAmountMinor ?? 0), 0);
                        const budget = p.budgetAmountMinor ?? 0;
                        const pct = (n: number) => (budget ? `${Math.min(100, (n / budget) * 100)}%` : "0%");
                        return (
                          <div key={p.id} className="bar-h">
                            <Link to={`${base}/programs/${p.id}`} className="b" style={{ color: "#0D2A43" }}>
                              {p.name}
                            </Link>
                            <div className="trk" role="img" aria-label={`Committed ${formatMinor(committed)}, paid ${formatMinor(paid)} of ${formatMinor(budget)}`}>
                              <div className="f1" style={{ width: pct(paid) }}></div>
                              <div className="f2" style={{ width: pct(Math.max(0, committed - paid)) }}></div>
                            </div>
                            <span className="num small">
                              {formatMinor(committed)} / {formatMinor(budget)}
                            </span>
                          </div>
                        );
                      })}
                      <div className="row small muted" style={{ gap: "14px" }}>
                        <span>Dark: paid (from Passport)</span>
                        <span>Light: committed, not yet paid</span>
                      </div>
                    </div>
                  </section>

                  <section className="card" aria-labelledby="tasks-h">
                    <div className="card-h">
                      <h3 id="tasks-h">My tasks</h3>
                      <span className="small muted">{(tasks.data?.length ?? 0) + notTaking.length} open</span>
                    </div>
                    {tasks.status === "error" && <ErrorBanner error={tasks.error} onRetry={tasks.reload} />}
                    {done.error !== null && <ErrorBanner error={done.error} />}
                    {tasks.data?.length === 0 && notTaking.length === 0 && <div className="card-b muted">Nothing waiting on you.</div>}
                    <ul>
                      {notTaking.map((o) => (
                        <li key={`open-${o.id}`} className="row" style={{ gap: "12px", padding: "10px 20px", borderBottom: "1px solid var(--border-1)" }}>
                          <CirclePause className="ic" aria-hidden="true" />
                          <Link to={`${base}/opportunities/${o.id}/edit#applications`} className="grow" style={{ color: "var(--fg-2)" }}>
                            Open applications for {o.title}
                          </Link>
                          <span className="small muted">Published, not taking applications</span>
                        </li>
                      ))}
                      {tasks.data?.map((t) => {
                        const overdue = t.dueAt !== null && Date.parse(t.dueAt) < today.getTime();
                        return (
                          <li key={t.id} className="row" style={{ gap: "12px", padding: "10px 20px", borderBottom: "1px solid #EEF3F3" }}>
                            <input type="checkbox" aria-label={`Done: ${t.title}`} checked={false} onChange={async () => (await done.run(t)) && tasks.reload()} />
                            {t.subjectType === "application" && t.subjectId ? (
                              <Link to={`${base}/applications/${t.subjectId}`} className="grow" style={{ color: "#1E2D2B" }}>
                                {t.title}
                              </Link>
                            ) : (
                              <span className="grow">{t.title}</span>
                            )}
                            {t.dueAt && <span className={overdue ? "small b" : "small muted"} style={overdue ? { color: "#9B1C1C" } : undefined}>{overdue ? "Overdue · " : ""}{formatDate(t.dueAt)}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                </div>

                <div className="col" style={{ gap: "20px" }}>
                  <section className="card" aria-labelledby="approvals-h">
                    <div className="card-h">
                      <h3 id="approvals-h">Approvals</h3>
                      <Link to={`${base}/approvals`} className="small b">
                        All approvals
                      </Link>
                    </div>
                    <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      {approvals.status === "error" && <ErrorBanner error={approvals.error} onRetry={approvals.reload} />}
                      {approvals.data?.length === 0 && <p className="muted small">No agent requests are waiting.</p>}
                      {approvals.data?.slice(0, 2).map((a) => (
                        <ApprovalCard
                          key={a.id}
                          approval={a}
                          base={base}
                          onResolved={() => {
                            approvals.reload();
                            apps.reload();
                          }}
                        />
                      ))}
                    </div>
                  </section>

                  <section className="card" aria-labelledby="alerts-h">
                    <div className="card-h">
                      <h3 id="alerts-h">Payee alerts</h3>
                      <Link to={`${base}/payments/due`} className="small b">
                        Payments
                      </Link>
                    </div>
                    <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      {alerts.status === "error" && <ErrorBanner error={alerts.error} onRetry={alerts.reload} />}
                      {alerts.data?.slice(0, 4).map((al, i) => (
                        <div key={`${al.kind}-${i}`} className={`bnr ${al.tone === "danger" ? "bnr-dng" : al.tone === "warn" ? "bnr-warn" : "bnr-neu"}`} role="status">
                          <Info className="ic" aria-hidden="true" />
                          <div>
                            <div className="t">{al.title}</div>
                            <div className="d">{al.detail}</div>
                          </div>
                        </div>
                      ))}
                      {alerts.data && !alerts.data.length && <p className="muted small">No holds, destination changes or level drops right now.</p>}
                      {payments.data && (
                        <p className="small muted">
                          {formatMinor(payments.data.totals.dueMinor)} due · {facilitatedPayments ? `${payments.data.totals.releasable} ready to release · ${payments.data.totals.blocked} blocked` : `${payments.data.totals.blocked} with a readiness check to fix`}
                        </p>
                      )}
                    </div>
                  </section>

                  <section className="card" aria-labelledby="activity-h">
                    <div className="card-h">
                      <h3 id="activity-h">Recent activity</h3>
                      <Link to={`${base}/settings/mcp#ledger`} className="small b">
                        Ledger
                      </Link>
                    </div>
                    <div className="card-b">
                      {activity.status === "loading" && <Loading label="Loading activity" />}
                      {activity.status === "error" && <ErrorBanner error={activity.error} onRetry={activity.reload} />}
                      {activity.data && <ActivityTimeline events={activity.data.items.slice(0, 6)} personName={(id) => person(id)?.name} when={(iso) => timeAgo(iso)} empty="Nothing has happened in this workspace yet." />}
                    </div>
                  </section>
                </div>
              </div>
            </>
          )}
        </main>
      </FunderShell>
    </>
  );
}
