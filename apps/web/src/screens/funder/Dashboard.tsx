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
import { DigestPrompt } from "../../components/DigestPrompt.tsx";
import { EmptyState, ErrorBanner, Loading, PageHeader } from "../../components/ui.tsx";
import { formatDate, formatMinor } from "../../lib/format.ts";
import { ActivityTimeline } from "../../components/ActivityTimeline.tsx";
import { ApprovalCard } from "./Approvals.tsx";
import { timeAgo, usePeople } from "./shared.tsx";
import { publishedNotTaking } from "./applicationsStatus.tsx";
import { useFundFilter } from "../../components/FundSwitcher.tsx";
import { intlLocale } from "../../i18n/index.tsx";
import { t } from "./i18n.ts";

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
  const done = useApiMutation((api, task: Task) => api.updateTask(task.id, { done: true }));

  // The fund chosen in the switcher: programs, their opportunities, competitions, applications and awards.
  const fund = useFundFilter();
  const inFund = (() => {
    if (!fund.current) return null;
    const programIds = new Set((programs.data ?? []).filter(fund.keepProgram).map((p) => p.id));
    const oppIds = new Set((opportunities.data ?? []).filter((o) => o.programId && programIds.has(o.programId)).map((o) => o.id));
    const compIds = new Set((competitions.data ?? []).filter((c) => oppIds.has(c.opportunityId)).map((c) => c.id));
    return { programIds, oppIds, compIds };
  })();
  const fundPrograms = inFund ? programs.data?.filter((p) => inFund.programIds.has(p.id)) : programs.data;
  const fundOpportunities = inFund ? opportunities.data?.filter((o) => inFund.oppIds.has(o.id)) : opportunities.data;
  const fundCompetitions = inFund ? competitions.data?.filter((c) => inFund.compIds.has(c.id)) : competitions.data;
  const fundApps = inFund ? apps.data?.items.filter((a) => inFund.compIds.has(a.competitionId)) : apps.data?.items;
  const fundAwards = inFund ? awards.data?.filter((a) => a.programId && inFund.programIds.has(a.programId)) : awards.data;
  const counts: Record<string, number> = inFund ? (fundApps ?? []).reduce<Record<string, number>>((m, a) => ({ ...m, [a.status]: (m[a.status] ?? 0) + 1 }), {}) : (apps.data?.counts ?? {});
  const open = OPEN.reduce((n, s) => n + (counts[s] ?? 0), 0);
  const appIds = inFund ? new Set((fundApps ?? []).map((a) => a.id)) : null;
  const reviewsOpen = assignments.data?.filter((a) => ["assigned", "coi_declared", "in_progress"].includes(a.status) && (!appIds || appIds.has(a.applicationId))) ?? [];
  const toCountersign = fundAwards?.filter((a) => a.status === "accepted").length ?? 0;
  const firstRun = programs.status === "ready" && programs.data.length === 0;
  // Published opportunities applicants can find but cannot apply to yet.
  const notTaking = fundOpportunities && competitions.data ? fundOpportunities.filter((o) => publishedNotTaking(o, competitions.data!)) : [];
  const today = new Date();

  return (
    <>
      <title>{t("funderDashboard.dashboard", { name: ws.name })}</title>
      <FunderShell active="Dashboard" firstRun={firstRun}>
        <main className="main">
          <PageHeader
            crumbs={[{ label: ws.name, to: base }, { label: t("funderDashboard.dashboard2") }]}
            title={t("funderDashboard.dashboard2")}
            meta={
              <>
                <span>{today.toLocaleDateString(intlLocale(), { weekday: "long", month: "short", day: "numeric", year: "numeric" })}</span>
                <span>·</span>
                <span>{t("funderDashboard.openCompetitions", { count: fundCompetitions?.filter((c) => c.status === "open").length ?? 0 })}</span>
                {fund.current && (
                  <>
                    <span>·</span>
                    <span>{fund.current.name}</span>
                  </>
                )}
              </>
            }
            actions={
              <>
                <Link to={`${base}/opportunities/new`} className="btn btn-secondary">
                  {t("funderDashboard.newOpportunity")}
                </Link>
                <Link to={`${base}/programs`} className="btn btn-primary">
                  {t("funderDashboard.programs")}
                </Link>
              </>
            }
          />
          <DigestPrompt workspaceId={ws.id} digest="funder_activity" settingsTo="/notifications" />

          {firstRun ? (
            <div className="card">
              <EmptyState
                icon={Briefcase}
                title={t("funderDashboard.startWithAProgram")}
                actions={
                  <Link to={`${base}/programs`} className="btn btn-primary">
                    {t("funderDashboard.createAProgram")}
                  </Link>
                }
              >
                {t("funderDashboard.aProgramHoldsA")}
              </EmptyState>
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "16px" }}>
                <Link to={`${base}/applications`} className="stat" style={{ textDecoration: "none" }}>
                  <span className="stat-l">{t("funderDashboard.openApplications")}</span>
                  <span className="stat-v">{apps.status === "ready" ? open : "—"}</span>
                  <span className="stat-d">
                    <Eye className="ic ic-sm" aria-hidden="true" />
                    {t("funderDashboard.underReviewNeedScreening", { under_review: counts.under_review ?? 0, submitted: counts.submitted ?? 0 })}
                  </span>
                </Link>
                <Link to={`${base}/reviews/assign`} className="stat" style={{ textDecoration: "none" }}>
                  <span className="stat-l">{t("funderDashboard.reviewsOutstanding")}</span>
                  <span className="stat-v">{assignments.status === "ready" ? reviewsOpen.length : "—"}</span>
                  <span className="stat-d">
                    <ClipboardCheck className="ic ic-sm" aria-hidden="true" />
                    {t("funderDashboard.reviewers", { size: new Set(reviewsOpen.map((a) => a.reviewerUserId)).size })}
                  </span>
                </Link>
                <Link to={`${base}/awards`} className="stat" style={{ textDecoration: "none" }}>
                  <span className="stat-l">{t("funderDashboard.agreementsToCountersign")}</span>
                  <span className="stat-v">{awards.status === "ready" ? toCountersign : "—"}</span>
                  <span className="stat-d">
                    <Gavel className="ic ic-sm" aria-hidden="true" />
                    {t("funderDashboard.awards", { count: fundAwards?.length ?? 0 })}
                  </span>
                </Link>
                <Link to={`${base}/approvals`} className="stat" style={{ textDecoration: "none" }}>
                  <span className="stat-l">{t("funderDashboard.agentRequests")}</span>
                  <span className="stat-v">{approvals.status === "ready" ? approvals.data.length : "—"}</span>
                  <span className="stat-d">
                    <Bot className="ic ic-sm" aria-hidden="true" />
                    {t("funderDashboard.awaitingAPerson")}
                  </span>
                </Link>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
                <div className="col" style={{ gap: "20px" }}>
                  <section className="card" aria-labelledby="pipeline-h">
                    <div className="card-h">
                      <h3 id="pipeline-h">{t("funderDashboard.pipeline")}</h3>
                      <Link to={`${base}/applications`} className="small b">
                        {t("funderDashboard.allApplications")}
                      </Link>
                    </div>
                    <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                      {(competitions.status === "loading" || apps.status === "loading") && <Loading label={t("funderDashboard.loadingThePipeline")} />}
                      {apps.status === "error" && <ErrorBanner error={apps.error} onRetry={apps.reload} />}
                      {fundCompetitions?.length === 0 && <p className="muted">{fund.current ? t("funderDashboard.noCompetitionsInYet", { name: fund.current.name }) : t("funderDashboard.noCompetitionsYetOpen")}</p>}
                      {fundCompetitions?.map((c) => {
                        const mine = fundApps?.filter((a) => a.competitionId === c.id) ?? [];
                        const decided = mine.filter((a) => ["accepted", "declined", "waitlisted"].includes(a.status)).length;
                        return (
                          <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                            <div className="row" style={{ justifyContent: "space-between" }}>
                              <Link to={`${base}/competitions/${c.id}`} className="b" style={{ color: "#0D2A43" }}>
                                {c.title}
                              </Link>
                              <span className="small muted">{t("funderDashboard.received", { count: mine.length })}</span>
                            </div>
                            <div className="pipe" role="group" aria-label={t("funderDashboard.pipelineByStage", { title: c.title })}>
                              {c.stages.map((s, i) => {
                                const n = mine.filter((a) => a.stage === s.key && !["accepted", "declined", "waitlisted"].includes(a.status)).length;
                                return (
                                  <Link key={s.key} to={`${base}/applications?stage=${encodeURIComponent(s.key)}`} style={{ flex: Math.max(n, 1), background: STAGE_COLORS[i % STAGE_COLORS.length] }} title={t("funderDashboard.stageCount", { label: s.label, n })}>
                                    {s.label} {n}
                                  </Link>
                                );
                              })}
                              <Link to={`${base}/competitions/${c.id}/panel`} style={{ flex: Math.max(decided, 1), background: "#D6DEDE", color: "#1E2D2B" }} title={t("funderDashboard.decided", { decided })}>
                                {t("funderDashboard.decided2", { decided })}
                              </Link>
                            </div>
                            <div className="row small muted" style={{ gap: "14px", flexWrap: "wrap" }}>
                              {c.stages.map((s) => (
                                <span key={s.key}>
                                  {t("funderDashboard.closes", { label: s.label, date: formatDate(s.closes) })}
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
                      <h3 id="programs-h">{t("funderDashboard.committedVsPaidBy")}</h3>
                      <Link to={`${base}/analytics`} className="small b">
                        {t("funderDashboard.analytics")}
                      </Link>
                    </div>
                    <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                      {fundPrograms?.map((p) => {
                        const mine = fundAwards?.filter((a) => a.programId === p.id && a.status !== "cancelled") ?? [];
                        const committed = mine.reduce((n, a) => n + (a.awardedAmountMinor ?? 0), 0);
                        const paid = mine.reduce((n, a) => n + (a.disbursedAmountMinor ?? 0), 0);
                        const budget = p.budgetAmountMinor ?? 0;
                        const pct = (n: number) => (budget ? `${Math.min(100, (n / budget) * 100)}%` : "0%");
                        return (
                          <div key={p.id} className="bar-h">
                            <Link to={`${base}/programs/${p.id}`} className="b" style={{ color: "#0D2A43" }}>
                              {p.name}
                            </Link>
                            <div className="trk" role="img" aria-label={t("funderDashboard.committedPaidOf", { amount: formatMinor(committed), amount2: formatMinor(paid), amount3: formatMinor(budget) })}>
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
                        <span>{t("funderDashboard.darkPaidFromPassport")}</span>
                        <span>{t("funderDashboard.lightCommittedNotYet")}</span>
                      </div>
                    </div>
                  </section>

                  <section className="card" aria-labelledby="tasks-h">
                    <div className="card-h">
                      <h3 id="tasks-h">{t("funderDashboard.myTasks")}</h3>
                      <span className="small muted">{t("funderDashboard.open", { count: (tasks.data?.length ?? 0) + notTaking.length })}</span>
                    </div>
                    {tasks.status === "error" && <ErrorBanner error={tasks.error} onRetry={tasks.reload} />}
                    {done.error !== null && <ErrorBanner error={done.error} />}
                    {tasks.data?.length === 0 && notTaking.length === 0 && <div className="card-b muted">{t("funderDashboard.nothingWaitingOnYou")}</div>}
                    <ul>
                      {notTaking.map((o) => (
                        <li key={`open-${o.id}`} className="row" style={{ gap: "12px", padding: "10px 20px", borderBottom: "1px solid var(--border-1)" }}>
                          <CirclePause className="ic" aria-hidden="true" />
                          <Link to={`${base}/opportunities/${o.id}/edit#applications`} className="grow" style={{ color: "var(--fg-2)" }}>
                            {t("funderDashboard.openApplicationsFor", { title: o.title })}
                          </Link>
                          <span className="small muted">{t("funderDashboard.publishedNotTakingApplications")}</span>
                        </li>
                      ))}
                      {tasks.data?.map((task) => {
                        const overdue = task.dueAt !== null && Date.parse(task.dueAt) < today.getTime();
                        return (
                          <li key={task.id} className="row" style={{ gap: "12px", padding: "10px 20px", borderBottom: "1px solid #EEF3F3" }}>
                            <input type="checkbox" aria-label={t("funderDashboard.done", { title: task.title })} checked={false} onChange={async () => (await done.run(task)) && tasks.reload()} />
                            {task.subjectType === "application" && task.subjectId ? (
                              <Link to={`${base}/applications/${task.subjectId}`} className="grow" style={{ color: "#1E2D2B" }}>
                                {task.title}
                              </Link>
                            ) : (
                              <span className="grow">{task.title}</span>
                            )}
                            {task.dueAt && <span className={overdue ? "small b" : "small muted"} style={overdue ? { color: "#9B1C1C" } : undefined}>{overdue ? t("funderDashboard.overdue") : ""}{formatDate(task.dueAt)}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                </div>

                <div className="col" style={{ gap: "20px" }}>
                  <section className="card" aria-labelledby="approvals-h">
                    <div className="card-h">
                      <h3 id="approvals-h">{t("funderDashboard.approvals")}</h3>
                      <Link to={`${base}/approvals`} className="small b">
                        {t("funderDashboard.allApprovals")}
                      </Link>
                    </div>
                    <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      {approvals.status === "error" && <ErrorBanner error={approvals.error} onRetry={approvals.reload} />}
                      {approvals.data?.length === 0 && <p className="muted small">{t("funderDashboard.noAgentRequestsAre")}</p>}
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
                      <h3 id="alerts-h">{t("funderDashboard.payeeAlerts")}</h3>
                      <Link to={`${base}/payments/due`} className="small b">
                        {t("funderDashboard.payments")}
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
                      {alerts.data && !alerts.data.length && <p className="muted small">{t("funderDashboard.noHoldsDestinationChanges")}</p>}
                      {payments.data && (
                        <p className="small muted">
                          {facilitatedPayments ? t("funderDashboard.dueReadyBlocked", { amount: formatMinor(payments.data.totals.dueMinor), releasable: payments.data.totals.releasable, blocked: payments.data.totals.blocked }) : t("funderDashboard.dueToFix", { amount: formatMinor(payments.data.totals.dueMinor), blocked: payments.data.totals.blocked })}
                        </p>
                      )}
                    </div>
                  </section>

                  <section className="card" aria-labelledby="activity-h">
                    <div className="card-h">
                      <h3 id="activity-h">{t("funderDashboard.recentActivity")}</h3>
                      <Link to={`${base}/settings/mcp#ledger`} className="small b">
                        {t("funderDashboard.ledger")}
                      </Link>
                    </div>
                    <div className="card-b">
                      {activity.status === "loading" && <Loading label={t("funderDashboard.loadingActivity")} />}
                      {activity.status === "error" && <ErrorBanner error={activity.error} onRetry={activity.reload} />}
                      {activity.data && <ActivityTimeline events={activity.data.items.slice(0, 6)} personName={(id) => person(id)?.name} when={(iso) => timeAgo(iso)} empty={t("funderDashboard.activityEmpty")} />}
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
