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
import { formatList } from "@gms/i18n";
import { t, useApplicantText } from "./i18n.ts";
import { readinessWords } from "../../lib/readinessText.ts";
import { YourProfilePanel } from "./YourProfilePanel.tsx";

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

/** A part of the dashboard that could not be loaded, by name. */
const missingPart = (what: string): string =>
  what === "applications" ? t("dashboard.part.applications") : what === "grants" ? t("dashboard.part.grants") : what === "tasks" ? t("dashboard.part.tasks") : what;

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
  pass: { cls: "rc-pass", icon: CircleCheck, get word() { return t("dashboard.check.pass"); } },
  fail: { cls: "rc-fail", icon: CircleX, get word() { return t("dashboard.check.fail"); } },
  unknown: { cls: "rc-unk", icon: CircleDashed, get word() { return t("dashboard.check.unknown"); } },
};

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
            {readiness.linked ? t("dashboard.passportReadiness") : t("dashboard.readiness")}
          </h2>
          {readiness.linked ? <LevelBadge level={readiness.level} /> : <VerificationBadge verification={{ source: "self_declared", level: null }} />}
        </div>
        <Link to={`${base}/organization`} className="small b">
          {t("dashboard.viewOrganization")}
        </Link>
      </div>
      <div className="card-b" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "14px" }}>
        {readiness.checks.map((c) => {
          const look = CHECK[c.state];
          return (
            <div key={c.key} className={`rc-row ${look.cls}`} style={{ display: "flex", gap: "10px", border: "0", padding: "0" }}>
              <look.icon className="ic" role="img" aria-label={look.word} />
              <div>
                <div className="l">{readinessWords(c).label}</div>
                <div className="r">{readinessWords(c).reason}</div>
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
                {t("dashboard.connectPassport")}
              </Link>
              <span className="help">{t("dashboard.optionalYourOrganizationRecordDocumentsAnd")}</span>
            </>
          ) : (
            <span className="help">{t("dashboard.fundersSeeTheDetailsYouEntered")}</span>
          )}
        </div>
      )}
      {readiness.linked && failing && (
        <div className="card-f">
          {failing.fixHref ? (
            // Opens Passport itself, where the fix is made.
            <a href={failing.fixHref} className="btn btn-primary">
              {failing.key === "payee_verified" ? t("dashboard.verifyPayeeInPassport") : t("dashboard.fixInPassport")}
            </a>
          ) : (
            <Link to={`${base}/organization`} className="btn btn-primary">
              {t("dashboard.seeWhatIsNeeded")}
            </Link>
          )}
          <span className="help">
            {failing.key !== "payee_verified"
              ? readinessWords(failing).reason
              : facilitatedPayments
                ? t("dashboard.awardsCanBeOfferedButA")
                : t("dashboard.fundersOnThisSitePayOutside")}
          </span>
        </div>
      )}
      {readiness.summary.unknown > 0 && readiness.linked && (
        <div className="card-b" style={{ paddingTop: 0 }}>
          <div className="bnr bnr-neu">
            <Info className="ic" aria-hidden="true" />
            <div>
              <div className="t">{t("dashboard.someChecksCantBeConfirmedRight")}</div>
              <div className="d">{t("dashboard.applicationsStayEditableAnythingThatDepends")}</div>
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
        <span>{t("dashboard.stage", { stage: app.stage.label })}</span>
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
            <span>{t("dashboard.submittedOn", { date: formatDate(app.submittedAt) })}</span>
          </>
        )}
        {editable && (
          <span style={{ marginLeft: "auto" }}>
            {t("dashboard.formsComplete", { complete: app.forms.complete, total: app.forms.total })}
          </span>
        )}
      </div>
    </Link>
  );
}

/** When a tranche is released, in the page's language. */
const CONDITION: Record<string, () => string> = {
  onExecution: () => t("dashboard.condition.onExecution"),
  onReportAccepted: () => t("dashboard.condition.onReportAccepted"),
  onDate: () => t("dashboard.condition.onDate"),
  manual: () => t("dashboard.condition.manual"),
};
export const conditionLabel = (type: unknown): string => CONDITION[String(type)]?.() ?? "";

export function Payments({ awards, base, phone }: { awards: AwardDetail[]; base: string; phone: boolean }) {
  const rows = awards.flatMap((w) => w.tranches.map((tr) => ({ w, tr })));
  if (!rows.length) return null;
  return (
    <section className="card" aria-labelledby="pay-h">
      <div className="card-h">
        <h2 id="pay-h" style={{ fontSize: "18px" }}>
          {t("dashboard.payments")}
        </h2>
        <Link to={`${base}/grants/${rows[0]!.w.id}`} className="small b">
          {t("dashboard.openGrant")}
        </Link>
      </div>
      {phone ? (
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {rows.map(({ w, tr }) => (
            <Link key={tr.id} to={`${base}/grants/${w.id}`} style={{ display: "flex", flexDirection: "column", gap: "6px", textDecoration: "none", color: "inherit" }}>
              <div className="row" style={{ justifyContent: "space-between", gap: "8px" }}>
                <span className="b" style={{ fontSize: "15px" }}>
                  {w.funder.name} · {t("dashboard.trancheOf", { seq: tr.seq, total: w.tranches.length })}
                </span>
                <span className="b num">{formatMinor(tr.amountMinor, tr.currency)}</span>
              </div>
              <div className="row wrap" style={{ gap: "8px" }}>
                <StatusBadge kind="tranche" status={tr.status} />
                <span className="small muted">{conditionLabel(tr.condition.type)}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }} tabIndex={0} role="region" aria-label={t("dashboard.tableScrollable")}>
          <table className="tbl" style={{ fontSize: "14px" }}>
            <thead>
              <tr>
                <th>{t("dashboard.funder")}</th>
                <th>{t("dashboard.tranche")}</th>
                <th className="num">{t("dashboard.amount")}</th>
                <th>{t("dashboard.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ w, tr }) => (
                <tr key={tr.id}>
                  <td>
                    <FunderChip name={w.funder.name} accent={accentOf(w.funder.brand)} short />
                  </td>
                  <td>
                    {t("dashboard.seqOf", { seq: tr.seq, total: w.tranches.length })} · {conditionLabel(tr.condition.type)}
                  </td>
                  <td className="num">{formatMinor(tr.amountMinor, tr.currency)}</td>
                  <td>
                    <StatusBadge kind="tranche" status={tr.status} />
                    {tr.holdReason && <span className="small muted"> {tr.holdReason}</span>}
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
          {t("dashboard.reportsDue")}
        </h2>
        <Link to={`${base}/reports`} className="small b">
          {t("dashboard.allReports")}
        </Link>
      </div>
      <ul className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "16px 20px" }}>
        {rows.map(({ w, r }) => {
          const tranche = w.tranches.find((tr) => tr.id === r.releasesTrancheId);
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
                  <FunderChip name={w.funder.name} accent={accentOf(w.funder.brand)} short style={{ height: "20px", fontSize: "11px" }} /> · {t("dashboard.dueOn", { date: formatDate(r.dueAt) })}
                  {tranche ? ` · ${t("dashboard.releasesTranche", { seq: tranche.seq })}` : ""}
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
    .flatMap((thread) => thread.messages.map((m) => ({ thread, m })))
    .sort((a, b) => b.m.createdAt.localeCompare(a.m.createdAt))
    .slice(0, 2);
  if (!latest.length) return null;
  const appOf = (thread: Thread) => applications.find((a) => a.id === `app_${thread.subjectId}`);
  return (
    <section className="card" aria-labelledby="msg-h">
      <div className="card-h">
        <h2 id="msg-h" style={{ fontSize: "18px" }}>
          {t("dashboard.messages")}
        </h2>
        <Link to={`${base}/applications/app_${latest[0]!.thread.subjectId}`} className="small b">
          {t("dashboard.openThread")}
        </Link>
      </div>
      <div className="card-b th" style={{ padding: "16px 20px" }}>
        {latest.map(({ thread, m }, i) => (
          <div className="msg" key={m.id}>
            <Avatar name={m.author} index={i + 3} />
            <div className="bub">
              <div className="hd">
                <span className="who">{m.author}</span>
                {appOf(thread)?.funder.name && <span>· {appOf(thread)!.funder.name}</span>}
                <span className="shared-mark">{t("dashboard.shared")}</span>
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
          {t("dashboard.tasks")}
        </h2>
        <span className="small muted">{t("dashboard.openCount", { count: tasks.length })}</span>
      </div>
      <ul className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px 20px" }}>
        {tasks.map((task) => {
          const app = applications.find((a) => a.id === `app_${task.subjectId}`);
          return (
            <li key={task.id} className="cb">
              <span className="c" aria-hidden="true"></span>
              <div className="grow">
                {app ? (
                  <Link to={`${base}/applications/${app.id}/edit`} className="b">
                    {task.title}
                  </Link>
                ) : (
                  <span className="b">{task.title}</span>
                )}
                <div className="small muted">
                  {app?.title}
                  {task.dueAt ? `${app ? " · " : ""}${t("dashboard.dueOn", { date: formatDate(task.dueAt) })}` : ""}
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
  useApplicantText();
  const ws = useWorkspace("applicant");
  const phone = useIsPhone();
  const base = `/w/${ws.handle}`;
  const query = useApplicantQuery(loadDashboard, [ws.id]);
  const reportsDue = query.status === "ready" ? query.data.awards.flatMap((w) => w.requirements).filter((r) => ["due", "overdue", "returned"].includes(r.status)).length : 0;

  return (
    <>
      <title>{t("dashboard.pageTitle", { workspace: ws.name })}</title>
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
                  <span>{t("dashboard.activeApplicationsCount", { count: query.data.applications.length })}</span>
                  <span>·</span>
                  <span>{t("dashboard.activeGrantsCount", { count: query.data.awards.filter((w) => w.status === "active").length })}</span>
                  <span>·</span>
                  <span>{t("dashboard.reportsDueCount", { count: reportsDue })}</span>
                </div>
              )}
            </div>
            <div className="actions">
              <Link to={`${base}/find`} className="btn btn-primary">
                <Search className="ic" aria-hidden="true" />
                {t("dashboard.findFunding")}
              </Link>
            </div>
          </div>

          <YourProfilePanel />
          <Loaded query={query} label={t("dashboard.loadingYourDashboard")}>
            {(d) => {
              const nothing = !d.applications.length && !d.awards.length;
              return (
                <>
                  <ReadinessCard readiness={d.readiness} base={base} />
                  {d.missing.length > 0 && (
                    <Notice tone="neu" title={t("dashboard.missing", { parts: formatList(t.locale, d.missing.map(missingPart)) })}>
                      {t("dashboard.theRestOfTheDashboardIs")}
                    </Notice>
                  )}
                  {nothing && d.missing.length === 0 ? (
                    <div className="card">
                      <EmptyState
                        icon={Search}
                        title={t("dashboard.noApplicationsOrGrantsYet")}
                        actions={
                          <>
                            <Link to={`${base}/find`} className="btn btn-primary">
                              {t("dashboard.findFunding")}
                            </Link>
                            <Link to={`${base}/organization`} className="small b">
                              {t("dashboard.reviewYourOrganizationProfile")}
                            </Link>
                          </>
                        }
                      >
                        {d.readiness.linked
                          ? t("dashboard.yourPassportRecordIsReadyFind")
                          : t("dashboard.findAnOpportunityYouAreEligible")}
                      </EmptyState>
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                        <section className="card" aria-labelledby="apps-h">
                          <div className="card-h">
                            <h2 id="apps-h" style={{ fontSize: "18px" }}>
                              {t("dashboard.activeApplications")}
                            </h2>
                            <Link to={`${base}/applications`} className="small b">
                              {t("dashboard.viewAll")}
                            </Link>
                          </div>
                          <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            {d.applications.length ? (
                              d.applications.map((a) => <ApplicationCard key={a.id} app={a} base={base} />)
                            ) : (
                              <p className="muted">
                                {t("dashboard.nothingInProgress")} <Link to={`${base}/find`}>{t("dashboard.findFunding")}</Link>
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
