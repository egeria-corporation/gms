// SPDX-License-Identifier: AGPL-3.0-only
// Reporting & compliance: what grantees owe and when, the queue of reports received (including
// ones a grantee chose to share from another funder), and the review of one report. Accepting a
// report can make a tranche due, and the screen says so before and after.
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useServices } from "../../app/services.tsx";
import { Bell, CircleCheck, ClipboardCheck, Mail, RotateCcw, Share2, TriangleAlert } from "lucide-react";
import type { JsonObject } from "@gms/forms";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { Requirement, Submission } from "../../api/funderMoney.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { ReasonDialog } from "../../components/payments.tsx";
import { RequirementsCalendar, type CalendarItem } from "../../components/RequirementsCalendar.tsx";
import { FunderShell } from "../../components/shells.tsx";
import type { Verification } from "../../api/types.ts";
import { StatusBadge, VerificationBadge } from "../../components/status.tsx";
import { EmptyState, ErrorBanner, Field, Loading, Notice, PageHeader, Tabs, TabPanel } from "../../components/ui.tsx";
import { FormView } from "../../forms/FormView.tsx";
import { daysUntil, formatDate } from "../../lib/format.ts";
import { dateTime } from "./shared.tsx";
import { OpenDataPanel } from "./OpenDataPanel.tsx";
import { t } from "./i18n.ts";

type Tab = "due" | "received";
const nameOf = (r: { recipient?: Record<string, unknown> | null }) => (typeof r.recipient?.name === "string" ? r.recipient.name : t("funderReporting.grantee"));
const planOf = (r: Requirement): number[] => (Array.isArray(r.reminderPlan) ? (r.reminderPlan as unknown[]).filter((n): n is number => typeof n === "number") : []);
const planText = (plan: number[]) => plan.map((n) => (n === 0 ? t("funderReporting.plan.onDueDate") : n < 0 ? t("funderReporting.plan.before", { count: -n }) : t("funderReporting.plan.after", { count: n }))).join(", ");

function dueText(r: Requirement, now: Date): string {
  const days = daysUntil(r.dueAt, now);
  if (days === null) return t("funderReporting.due.none");
  if (days < 0) return t("funderReporting.due.late", { count: -days });
  if (days === 0) return t("funderReporting.due.today");
  return t("funderReporting.due.in", { count: days });
}

function ReminderPlanDialog({ requirement, onClose, onSaved }: { requirement: Requirement; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(planOf(requirement).join(", "));
  const parsed = text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  const valid = parsed.length > 0 && parsed.every((n) => Number.isInteger(n) && n >= -365 && n <= 365);
  const save = useApiMutation((api) => api.updateRequirement(requirement.id, { reminderPlan: parsed }));
  return (
    <Dialog open onClose={onClose} labelledBy="plan-title">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await save.run()) onSaved();
        }}
      >
        <div className="hd">
          <div>
            <h2 id="plan-title">{t("funderReporting.reminderPlan")}</h2>
            <p className="small muted">
              {requirement.title} · {nameOf(requirement)}{" "}
              {((v) => (v ? <VerificationBadge verification={v} /> : null))((requirement.recipient as { verification?: Verification } | null | undefined)?.verification)}
            </p>
          </div>
        </div>
        <div className="bd">
          {save.error !== null && <ErrorBanner error={save.error} />}
          <Field id="plan-days" label={t("funderReporting.daysRelativeToThe")} required help={t("funderReporting.commaSeparatedNegativeNumbers")}>
            <input className="inp" id="plan-days" value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <p className={valid ? "help" : "err-msg"} role="status">
            {valid ? t("funderReporting.remindersGoOut", { planText: planText(parsed) }) : t("funderReporting.enterWholeNumbersBetween")}
          </p>
        </div>
        <div className="ft">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("funderReporting.cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!valid || save.state === "saving"}>
            {t("funderReporting.savePlan")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ReportBody({ submission }: { submission: Submission }) {
  const first = submission.formResponses[0];
  const form = useApiQuery(async (api) => (first ? api.getForm(first.formId, first.formVersion) : null), [first?.formId, first?.formVersion]);
  if (!first) return <p className="muted">{t("funderReporting.thisReportHasNo")}</p>;
  if (form.status === "loading") return <Loading label={t("funderReporting.loadingTheReport")} />;
  if (form.status === "error" || !form.data)
    return (
      <dl className="kv">
        {Object.entries(first.response).map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{k}</dt>
            <dd>{typeof v === "string" ? v : JSON.stringify(v)}</dd>
          </div>
        ))}
      </dl>
    );
  const f = form.data;
  return <FormView form={{ id: f.id, version: f.version, title: f.title, jsonSchema: f.jsonSchema, uiSchema: f.uiSchema, mappingFromCommonGrants: f.mappingFromCommonGrants, mappingToCommonGrants: f.mappingToCommonGrants, fieldMeta: f.fieldMeta }} response={first.response as JsonObject} provenance={first.provenance as Record<string, string>} mode="funder" />;
}

function Review({ id, releases, onChanged }: { id: string; releases: boolean; onChanged: (note: string) => void }) {
  const sub = useApiQuery((api) => api.getSubmission(id), [id]);
  const accept = useApiMutation((api) => api.acceptSubmission(id));
  const send = useApiMutation((api, note: string) => api.returnSubmission(id, note));
  const [returning, setReturning] = useState(false);
  if (sub.status === "loading") return <Loading label={t("funderReporting.loadingTheReport")} />;
  if (sub.status === "error") return <ErrorBanner error={sub.error} onRetry={sub.reload} />;
  const s = sub.data;
  const open = ["submitted", "under_review"].includes(s.status) && !s.shared;
  return (
    <section className="card" aria-labelledby="review-h">
      <div className="card-h">
        <div>
          <h2 id="review-h" style={{ fontSize: "18px" }}>
            {s.requirement?.title ?? t("funderReporting.report")}
          </h2>
          <p className="small muted">
            {s.submittedAt ? t("funderReporting.submitted", { dateTime: dateTime(s.submittedAt) }) : t("funderReporting.notSubmitted")}
            {s.requirement?.dueAt ? t("funderReporting.due", { date: formatDate(s.requirement.dueAt) }) : ""}
          </p>
        </div>
        <div className="row">
          {s.shared && (
            <span className="shared-mark">
              <Share2 className="ic" aria-hidden="true" />
              {t("funderReporting.sharedByGrantee")}
            </span>
          )}
          <StatusBadge kind="submission" status={s.status} />
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {(accept.error !== null || send.error !== null) && <ErrorBanner error={accept.error ?? send.error} />}
        {s.shared && <Notice title={t("funderReporting.sharedForReference")}>{t("funderReporting.theGranteeChoseTo")}</Notice>}
        {s.reviewNote && <Notice tone="neu" title={t("funderReporting.reviewNote")}>{s.reviewNote}</Notice>}
        <ReportBody submission={s} />
      </div>
      {open && (
        <div className="card-f" style={{ flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={accept.state === "saving"}
            onClick={async () => {
              const out = await accept.run();
              if (out) onChanged(out.trancheDue ? t("funderReporting.done.acceptedTranche") : t("funderReporting.done.accepted"));
            }}
          >
            <CircleCheck className="ic" aria-hidden="true" />
            {t("funderReporting.acceptReport")}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setReturning(true)}>
            <RotateCcw className="ic" aria-hidden="true" />
            {t("funderReporting.returnWithANote")}
          </button>
          <span className="help">{releases ? t("funderReporting.acceptingMakesTheNext") : t("funderReporting.acceptingClosesThisRequirement")}</span>
        </div>
      )}
      {returning && (
        <ReasonDialog
          title={t("funderReporting.returnThisReport")}
          label={t("funderReporting.whatShouldTheGrantee")}
          action={t("funderReporting.action.return")}
          onClose={() => setReturning(false)}
          onSubmit={async (note) => {
            setReturning(false);
            if (await send.run(note)) onChanged(t("funderReporting.done.returned"));
          }}
        />
      )}
    </section>
  );
}

export default function Reporting() {
  // The reminder preview is a design reference with sample content: demo mode only.
  const { mock } = useServices();
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "received" ? "received" : "due";
  const selected = params.get("submission");
  const [note, setNote] = useState<string | null>(null);
  const [plan, setPlan] = useState<Requirement | null>(null);
  const [waiving, setWaiving] = useState<Requirement | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const forms = useApiQuery((api) => api.listForms(), []);
  const page = useApiQuery(async (api) => {
    const [requirements, submissions, awards] = await Promise.all([api.listDueRequirements(), api.listSubmissions(), api.listAwards()]);
    return { requirements, submissions, awards };
  }, []);
  const remind = useApiMutation((api, id: string) => api.remindRequirement(id));
  const waive = useApiMutation((api, id: string, reason: string) => api.waiveRequirement(id, reason));
  const now = new Date();
  const d = page.data;
  const owed = (d?.requirements ?? []).filter((r) => ["scheduled", "due", "overdue"].includes(r.status)).sort((a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9"));
  const received = (d?.submissions ?? []).filter((s) => s.status !== "draft");
  const waiting = received.filter((s) => ["submitted", "under_review"].includes(s.status) && !s.shared).length;
  const overdue = owed.filter((r) => r.status === "overdue");
  const shown = day ? owed.filter((r) => r.dueAt?.slice(0, 10) === day) : owed;
  const calendarItems: CalendarItem[] = [
    ...owed.filter((r) => r.dueAt).map((r) => ({ id: r.id, date: r.dueAt as string, label: t("funderReporting.calendarLabel", { name: nameOf(r), title: r.title }), tone: (r.status === "overdue" ? "overdue" : r.status === "due" ? "due" : "scheduled") as CalendarItem["tone"] })),
    ...received.filter((x) => x.submittedAt).map((x) => ({ id: x.id, date: x.submittedAt as string, label: t("funderReporting.received", { title: x.requirement?.title ?? t("funderReporting.report") }), tone: "received" as const })),
  ];
  const reportForms = (forms.data ?? []).filter((f) => f.purpose === "report");
  const remindAll = async () => {
    let sent = 0;
    for (const r of overdue) if (await remind.run(r.id)) sent++;
    if (sent) setNote(t("funderReporting.done.remindedCount", { count: sent }));
  };
  // A submission names its award; the award names the grantee. A report shared from another
  // funder has no award here.
  const granteeOf = (s: Submission): string => {
    const req = d?.requirements.find((r) => r.id === s.requirementId);
    if (req) return nameOf(req);
    const award = d?.awards.find((a) => a.id === s.awardId);
    const name = award?.recipient?.name;
    return typeof name === "string" && name ? name : s.shared ? t("funderReporting.anotherFundersReport") : t("funderReporting.grantee");
  };
  const requirementFor = (s: Submission) => d?.requirements.find((r) => r.id === s.requirementId);
  const changed = (message: string) => {
    setNote(message);
    page.reload();
  };
  const go = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    setParams(p, { replace: true });
  };

  return (
    <>
      <title>{t("funderReporting.reportingCompliance", { name: ws.name })}</title>
      <FunderShell active="Reporting">
        <main className="main">
          <PageHeader
            crumbs={[{ label: ws.name, to: base }, { label: t("funderReporting.reporting") }]}
            title={t("funderReporting.reportingCompliance2")}
            meta={
              d ? (
                <>
                  <span>{t("funderReporting.overdue", { count: owed.filter((r) => r.status === "overdue").length })}</span>
                  <span>·</span>
                  <span>{t("funderReporting.due2", { count: owed.filter((r) => r.status === "due").length })}</span>
                  <span>·</span>
                  <span>{t("funderReporting.waitingForReview", { waiting })}</span>
                </>
              ) : undefined
            }
          />
          {page.status === "loading" && <Loading label={t("funderReporting.loadingReporting")} />}
          {page.status === "error" && <ErrorBanner error={page.error} onRetry={page.reload} />}
          {note && <Notice tone="ok" title={note} />}
          {(remind.error !== null || waive.error !== null) && <ErrorBanner error={remind.error ?? waive.error} />}
          {d && (
            <>
              <Tabs
                label={t("funderReporting.reportingViews")}
                idPrefix="reporting"
                active={tab}
                onChange={(key) => go({ tab: key, submission: null })}
                tabs={[
                  { key: "due", label: t("funderReporting.owed"), count: owed.length },
                  { key: "received", label: t("funderReporting.received2"), count: waiting },
                ]}
              />
              <TabPanel idPrefix="reporting" tab="due" active={tab}>
                <div style={{ display: "grid", gridTemplateColumns: "400px minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
                  <div className="col" style={{ gap: "16px" }}>
                    <RequirementsCalendar items={calendarItems} today={now} selectedDay={day} onSelectDay={setDay} />
                    {overdue.length > 0 && (
                      <section className="card" id="overdue" style={{ borderColor: "var(--s-dng-bd)" }} aria-labelledby="overdue-h">
                        <div className="card-h">
                          <h3 id="overdue-h">{t("funderReporting.overdue2")}</h3>
                          <span className="bdg bdg-dng">
                            <TriangleAlert className="ic" aria-hidden="true" />
                            {overdue.length}
                          </span>
                        </div>
                        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "13px" }}>
                          {overdue.map((r) => (
                            <div key={r.id}>
                              <div className="b">
                                {nameOf(r)} · {r.title}
                              </div>
                              <div className="small muted">
                                {t("funderReporting.due3", { date: formatDate(r.dueAt), dueText: dueText(r, now) })}
                                {r.releasesTrancheId ? t("funderReporting.itsTrancheStaysScheduled") : ""}
                              </div>
                            </div>
                          ))}
                          <div className="row wrap" style={{ gap: "8px" }}>
                            <button type="button" className="btn btn-primary btn-sm" disabled={remind.state === "saving"} onClick={remindAll}>
                              <Mail className="ic ic-sm" aria-hidden="true" />
                              {t("funderReporting.sendReminderTo", { count: overdue.length })}
                            </button>
                            {mock && (
                              <Link to="/preview/email/report-reminder" className="small b">
                                {t("funderReporting.previewTheReminder")}
                              </Link>
                            )}
                          </div>
                        </div>
                      </section>
                    )}
                    <section className="card" aria-labelledby="report-forms-h">
                      <div className="card-h">
                        <h3 id="report-forms-h">{t("funderReporting.reportForms")}</h3>
                        <Link to={`${base}/forms`} className="small b">
                          {t("funderReporting.openFormBuilder")}
                        </Link>
                      </div>
                      {reportForms.length ? (
                        <ul style={{ display: "flex", flexDirection: "column" }}>
                          {reportForms.map((f) => (
                            <li key={f.id} style={{ padding: "10px 20px", borderBottom: "1px solid var(--og-gray-100)", display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "13px" }}>
                              <div>
                                <div className="b">{f.title}</div>
                                <div className="small muted">
                                  {t(f.publishedAt ? "funderReporting.formPublished" : "funderReporting.formDraft", { version: f.version })}
                                </div>
                              </div>
                              <Link to={`${base}/forms/${f.id}/edit`} className="small b">
                                {t("funderReporting.edit")}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="card-b small muted">{t("funderReporting.noReportFormsYet")}</p>
                      )}
                    </section>
                  </div>
                  <div className="col" style={{ gap: "12px" }}>
                    {day && (
                      <div className="row small" style={{ gap: "8px" }}>
                        <span className="muted">
                          {t("funderReporting.showingWhatIsDue", { date: formatDate(day), count: shown.length })}
                        </span>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDay(null)}>
                          {t("funderReporting.showAll")}
                        </button>
                      </div>
                    )}
                    {!shown.length ? (
                      <div className="card">
                        <EmptyState icon={ClipboardCheck} title={owed.length ? t("funderReporting.nothingIsDueOn") : t("funderReporting.nothingIsOwedRight")}>
                          {t("funderReporting.requirementsAppearHereFrom")}
                        </EmptyState>
                      </div>
                    ) : (
                      <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("funderReporting.requirementsOwedScrollable")}>
                        <table className="tbl" aria-label={t("funderReporting.requirementsOwed")}>
                          <thead>
                            <tr>
                              <th>{t("funderReporting.grantee")}</th>
                              <th>{t("funderReporting.requirement")}</th>
                              <th>{t("funderReporting.due4")}</th>
                              <th>{t("funderReporting.status")}</th>
                              <th>{t("funderReporting.reminders")}</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {shown.map((r) => (
                              <tr key={r.id}>
                                <td>
                                  <div className="ent">
                                    <span className="nm">{nameOf(r)}</span>
                                    {r.award && (
                                      <Link to={`${base}/awards/${r.award.id}/payments`} className="small">
                                        {r.award.title}
                                      </Link>
                                    )}
                                  </div>
                                </td>
                                <td>
                                  {r.title}
                                  {r.releasesTrancheId && <div className="small muted">{t("funderReporting.releasesATrancheWhen")}</div>}
                                </td>
                                <td>
                                  {formatDate(r.dueAt)}
                                  <div className={`small ${r.status === "overdue" ? "var-neg b" : "muted"}`}>{dueText(r, now)}</div>
                                </td>
                                <td>
                                  <StatusBadge kind="requirement" status={r.status} />
                                </td>
                                <td>
                                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPlan(r)}>
                                    {t.rich("funderReporting.plannedRemindersForEdit", { count: planOf(r).length, title: r.title, name: nameOf(r), span: (chunks) => <span className="sr">{chunks}</span> })}
                                  </button>
                                </td>
                                <td>
                                  <div className="row">
                                    <button type="button" className="btn btn-sm btn-secondary" disabled={remind.state === "saving"} onClick={async () => (await remind.run(r.id)) && setNote(t("funderReporting.done.reminded", { name: nameOf(r) }))} >
                                      <Bell className="ic" aria-hidden="true" />
                                      {t.rich("funderReporting.remindAbout", { name: nameOf(r), title: r.title, span: (chunks) => <span className="sr">{chunks}</span> })}
                                    </button>
                                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setWaiving(r)}>
                                      {t.rich("funderReporting.waiveFor", { title: r.title, name: nameOf(r), span: (chunks) => <span className="sr">{chunks}</span> })}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </TabPanel>
              <TabPanel idPrefix="reporting" tab="received" active={tab}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1.3fr)", gap: "20px", alignItems: "start" }}>
                  <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("funderReporting.reportsReceivedScrollable")}>
                    <table className="tbl" aria-label={t("funderReporting.reportsReceived")}>
                      <thead>
                        <tr>
                          <th>{t("funderReporting.report")}</th>
                          <th>{t("funderReporting.received2")}</th>
                          <th>{t("funderReporting.status")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {received.map((s) => (
                          <tr key={s.id} className={selected === s.id ? "sel" : undefined}>
                            <td>
                              <div className="ent">
                                <button type="button" className="btn btn-ghost btn-sm nm" style={{ justifyContent: "flex-start", padding: 0, height: "auto" }} onClick={() => go({ submission: s.id })} aria-current={selected === s.id ? "true" : undefined}>
                                  {s.requirement?.title ?? t("funderReporting.report")}
                                </button>
                                <span className="sub small muted">
                                  {granteeOf(s)}
                                  {s.shared && (
                                    <span className="shared-mark">
                                      <Share2 className="ic" aria-hidden="true" />
                                      {t("funderReporting.sharedByGrantee")}
                                    </span>
                                  )}
                                </span>
                              </div>
                            </td>
                            <td>{formatDate(s.submittedAt)}</td>
                            <td>
                              <StatusBadge kind="submission" status={s.status} />
                            </td>
                          </tr>
                        ))}
                        {!received.length && (
                          <tr>
                            <td colSpan={3} className="muted">
                              {t("funderReporting.noReportsReceivedYet")}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {selected ? (
                    <Review
                      key={selected}
                      id={selected}
                      releases={!!requirementFor(received.find((s) => s.id === selected) ?? ({} as Submission))?.releasesTrancheId}
                      onChanged={(message) => {
                        changed(message);
                      }}
                    />
                  ) : (
                    <div className="card">
                      <EmptyState icon={ClipboardCheck} title={t("funderReporting.chooseAReportTo")}>
                        {t("funderReporting.responsesShowWhereEach")}
                      </EmptyState>
                    </div>
                  )}
                </div>
              </TabPanel>
            </>
          )}
          <OpenDataPanel />
          {plan && (
            <ReminderPlanDialog
              requirement={plan}
              onClose={() => setPlan(null)}
              onSaved={() => {
                setPlan(null);
                changed(t("funderReporting.done.planSaved"));
              }}
            />
          )}
          {waiving && (
            <ReasonDialog
              title={t("funderReporting.waive", { title: waiving.title })}
              label={t("funderReporting.whyIsThisRequirement")}
              action={t("funderReporting.action.waive")}
              onClose={() => setWaiving(null)}
              onSubmit={async (reason) => {
                const r = waiving;
                setWaiving(null);
                if (await waive.run(r.id, reason)) changed(t("funderReporting.done.waived", { title: r.title, name: nameOf(r) }));
              }}
            />
          )}
        </main>
      </FunderShell>
    </>
  );
}
