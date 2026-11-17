// SPDX-License-Identifier: AGPL-3.0-only
// An award's Payments tab: the schedule, each tranche's readiness and what blocks it, release
// through Passport, recording a payment made elsewhere, the approved budget against actuals, and
// the requirements that gate later tranches. The disbursed amount is always the figure last read
// from Passport; this screen never adds to it.
import { useState } from "react";
import { useAppConfig } from "../../api/launchHooks.ts";
import { PaymentsOffNotice, recordOutsideLabel } from "../../components/launch.tsx";
import { Link, useParams } from "react-router";
import { Banknote, Calendar, CircleCheck, Hand, Plus, Send, Trash2 } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import { AwardTabs, useAwardTab } from "./AwardSections.tsx";
import type { BudgetVariance, Requirement, Schedule, Tranche, TrancheCondition, TrancheReadiness, TrancheRow } from "../../api/funderMoney.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { conditionLabel, HoldBanner, ReasonDialog, RecordExternalDialog, ReleaseDialog, checklistOf, releaseBlockedReason } from "../../components/payments.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { StatusBadge, VerificationBadge, WorkspaceName } from "../../components/status.tsx";
// F2: the "In QuickBooks" status of a settled payment.
import { InQuickBooks } from "../../components/InQuickBooks.tsx";
import { EmptyState, ErrorBanner, Field, Loading, Notice, PageHeader, ReadinessChecklist, TabPanel } from "../../components/ui.tsx";
import { formatDate, formatMinor, parseDollars } from "../../lib/format.ts";
import { dateTime } from "./shared.tsx";
import { t, useFunderMessages } from "./i18n.ts";

const OPEN = ["due", "ready", "held"];
const NOT_STARTED = ["scheduled", "due", "ready", "held"];

interface DraftLine {
  amount: string;
  type: TrancheCondition["type"];
  date: string;
  requirementId: string;
}

function ScheduleEditor({ schedule, requirements, onClose, onSaved }: { schedule: Schedule; requirements: Requirement[]; onClose: () => void; onSaved: () => void }) {
  const editable = schedule.tranches.filter((item) => NOT_STARTED.includes(item.status));
  const fixed = schedule.tranches.filter((item) => !NOT_STARTED.includes(item.status) && item.status !== "cancelled");
  const left = (schedule.awardedAmountMinor ?? 0) - fixed.reduce((n, item) => n + item.amountMinor, 0);
  const [lines, setLines] = useState<DraftLine[]>(() =>
    (editable.length ? editable : [null]).map((tr) => {
      const c = (tr?.condition ?? { type: "manual" }) as TrancheCondition;
      return { amount: tr ? String(tr.amountMinor / 100) : "", type: c.type, date: c.type === "onDate" ? c.date : "", requirementId: c.type === "onReportAccepted" ? c.requirementId : "" };
    }),
  );
  const amounts = lines.map((l) => parseDollars(l.amount));
  const total = amounts.reduce<number>((n, a) => n + (a ?? 0), 0);
  const complete = lines.every((l, i) => (amounts[i] ?? 0) > 0 && (l.type !== "onDate" || l.date) && (l.type !== "onReportAccepted" || l.requirementId));
  const save = useApiMutation((api) =>
    api.putSchedule(
      schedule.awardId,
      lines.map((l, i) => ({ amountMinor: amounts[i]!, condition: l.type === "onDate" ? { type: "onDate", date: l.date } : l.type === "onReportAccepted" ? { type: "onReportAccepted", requirementId: l.requirementId } : { type: l.type } })),
    ),
  );
  const set = (i: number, patch: Partial<DraftLine>) => setLines((rows) => rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  return (
    <Dialog open onClose={onClose} labelledBy="schedule-title" size="lg">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await save.run()) onSaved();
        }}
      >
        <div className="hd">
          <div>
            <h2 id="schedule-title">{t("awardPayments.editThePaymentSchedule")}</h2>
            <p className="small muted">{t("awardPayments.onlyTranchesThatHave", { amount: formatMinor(left, schedule.currency) })}</p>
          </div>
        </div>
        <div className="bd">
          {save.error !== null && <ErrorBanner error={save.error} />}
          {lines.map((l, i) => (
            <fieldset key={i} className="card" style={{ padding: "12px 16px", margin: 0 }}>
              <legend className="small b">{t("awardPayments.tranche", { count: fixed.length + i + 1 })}</legend>
              <div className="fld-row">
                <Field id={`sch-amount-${i}`} label={t("awardPayments.amountUsd")} required>
                  <input className="inp" id={`sch-amount-${i}`} inputMode="decimal" value={l.amount} onChange={(e) => set(i, { amount: e.target.value })} />
                </Field>
                <Field id={`sch-cond-${i}`} label={t("awardPayments.becomesDue")} required>
                  <select className="sel" id={`sch-cond-${i}`} value={l.type} onChange={(e) => set(i, { type: e.target.value as DraftLine["type"] })}>
                    <option value="onExecution">{t("awardPayments.onAgreementExecution")}</option>
                    <option value="onReportAccepted">{t("awardPayments.whenAReportIs")}</option>
                    <option value="onDate">{t("awardPayments.onADate")}</option>
                    <option value="manual">{t("awardPayments.manually")}</option>
                  </select>
                </Field>
              </div>
              {l.type === "onDate" && (
                <Field id={`sch-date-${i}`} label={t("awardPayments.date")} required>
                  <input className="inp" id={`sch-date-${i}`} type="date" value={l.date} onChange={(e) => set(i, { date: e.target.value })} style={{ maxWidth: "220px" }} />
                </Field>
              )}
              {l.type === "onReportAccepted" && (
                <Field id={`sch-req-${i}`} label={t("awardPayments.report")} required>
                  <select className="sel" id={`sch-req-${i}`} value={l.requirementId} onChange={(e) => set(i, { requirementId: e.target.value })}>
                    <option value="">{t("awardPayments.chooseARequirement")}</option>
                    {requirements.map((r) => (
                      <option key={r.id} value={r.id}>
                        {t("awardPayments.due", { title: r.title, date: formatDate(r.dueAt) })}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {lines.length > 1 && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLines((rows) => rows.filter((_, n) => n !== i))}>
                  <Trash2 className="ic" aria-hidden="true" />
                  {t("awardPayments.removeTranche", { count: fixed.length + i + 1 })}
                </button>
              )}
            </fieldset>
          ))}
          <button type="button" className="btn btn-secondary" style={{ alignSelf: "flex-start" }} onClick={() => setLines((rows) => [...rows, { amount: "", type: "manual", date: "", requirementId: "" }])}>
            <Plus className="ic" aria-hidden="true" />
            {t("awardPayments.addTranche")}
          </button>
          <p className={total === left ? "help" : "err-msg"} role="status">
            {total === left ? t("awardPayments.ofScheduled", { scheduled: formatMinor(total, schedule.currency), left: formatMinor(left, schedule.currency) }) : t("awardPayments.ofScheduledMustAddUp", { scheduled: formatMinor(total, schedule.currency), left: formatMinor(left, schedule.currency) })}
          </p>
        </div>
        <div className="ft">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("awardPayments.cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!complete || total !== left || save.state === "saving"}>
            {t("awardPayments.saveSchedule")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * How a released tranche reads. A payment recorded as made elsewhere names its reference and the
 * last four digits of the account paid; imported grant history has no digits, so it says "Paid
 * elsewhere" with no bank line.
 */
export function releasedLine(row: Pick<TrancheRow, "mode" | "external">): { what: string; detail: string } {
  if (row.mode !== "resolve") return { what: t("awardPayments.released.passport"), detail: "" };
  const ext = row.external;
  if (!ext?.last4) return { what: t("awardPayments.released.elsewhere"), detail: ext?.reference ? ` · ${ext.reference}` : "" };
  return { what: t("awardPayments.released.outside"), detail: t("awardPayments.released.outsideDetail", { reference: ext.reference, last4: ext.last4 }) };
}

function TrancheCard({ row, requirementTitle, recipientName, onChanged }: { row: TrancheRow; requirementTitle: (id: string) => string | undefined; recipientName: string; onChanged: () => void }) {
  const open = OPEN.includes(row.status);
  const readiness = useApiQuery(async (api): Promise<TrancheReadiness | null> => (open ? api.trancheReadiness(row.id) : null), [row.id, row.status]);
  const [dialog, setDialog] = useState<"release" | "external" | "hold" | "cancel" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const hold = useApiMutation((api, reason: string) => api.holdTranche(row.id, reason));
  const unhold = useApiMutation((api) => api.releaseHold(row.id));
  const cancel = useApiMutation((api, reason: string) => api.cancelTranche(row.id, reason));
  const r = readiness.data ?? null;
  const blocked = r ? releaseBlockedReason(r) : t("awardPayments.checkingReadiness");
  const { facilitatedPayments } = useAppConfig();
  const done = (message: string | null) => {
    setDialog(null);
    setNote(message);
    onChanged();
  };

  return (
    <section className="card" aria-labelledby={`trn-${row.id}`}>
      <div className="card-h">
        <div>
          <h3 id={`trn-${row.id}`}>
            {t("awardPayments.tranche2", { seq: row.seq, amount: formatMinor(row.amountMinor, row.currency) })}
          </h3>
          <p className="small muted">
            {conditionLabel(row.condition, requirementTitle)}
            {row.dueAt ? t("awardPayments.due2", { date: formatDate(row.dueAt) }) : ""}
          </p>
        </div>
        <span className="row" style={{ gap: "6px" }}><StatusBadge kind="tranche" status={row.status} /> <InQuickBooks trancheId={row.id} /></span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {row.status === "scheduled" && !note && <p className="muted small">{t("awardPayments.notDueYetIt", { condition: conditionLabel(row.condition, requirementTitle).replace(/^./, (c) => c.toLowerCase()) })}</p>}
        {note && <Notice tone="ok" title={note} />}
        {(unhold.error !== null || hold.error !== null || cancel.error !== null) && <ErrorBanner error={unhold.error ?? hold.error ?? cancel.error} />}
        {open && readiness.status === "loading" && <Loading label={t("awardPayments.checkingReadiness")} />}
        {open && readiness.status === "error" && <ErrorBanner error={readiness.error} onRetry={readiness.reload} />}
        {r?.banner && <HoldBanner banner={r.banner} />}
        {row.status === "held" && !r?.banner && <Notice tone="warn" title={t("awardPayments.heldByYourTeam")}>{t("awardPayments.thisTrancheStaysOut")}</Notice>}
        {r && <ReadinessChecklist checklist={checklistOf(r)} title={t("awardPayments.readiness")} />}
        {["initiated", "releasing", "settled", "returned", "failed"].includes(row.status) && (
          <div className="tl tl-sm">
            {row.releasedAt && (
              <div className="tl-i tl-person">
                <span className="dot">
                  <Send className="ic" aria-hidden="true" />
                </span>
                <div>
                  <div className="what">{releasedLine(row).what}</div>
                  <div className="who">
                    {dateTime(row.releasedAt)}
                    {releasedLine(row).detail}
                  </div>
                </div>
              </div>
            )}
            {row.status === "settled" && (
              <div className={`tl-i ${row.passportStatus === "unverified" ? "tl-warn" : "tl-ok"}`}>
                <span className="dot">
                  <CircleCheck className="ic" aria-hidden="true" />
                </span>
                <div>
                  <div className="what">{row.passportStatus === "unverified" ? t("awardPayments.settledHereNotVerified") : t("awardPayments.settled")}</div>
                  <div className="who">{row.passportStatus === "unverified" ? t("awardPayments.passportCouldNotMatch") : t("awardPayments.confirmedByPassport")}</div>
                </div>
              </div>
            )}
          </div>
        )}
        {open && (
          <div className="row wrap">
            {facilitatedPayments && row.status !== "held" && (
              <button type="button" className="btn btn-primary" disabled={blocked !== null} onClick={() => setDialog("release")} aria-describedby={blocked ? `blocked-${row.id}` : undefined}>
                <Send className="ic" aria-hidden="true" />
                {t("awardPayments.release")}
              </button>
            )}
            {row.status !== "held" && (
              <button type="button" className={facilitatedPayments ? "btn btn-secondary" : "btn btn-primary"} onClick={() => setDialog("external")}>
                <Banknote className="ic" aria-hidden="true" />
                {facilitatedPayments ? t("awardPayments.recordExternalPayment") : recordOutsideLabel()}
              </button>
            )}
            {row.status === "held" && row.holdReason === "manual" && (
              <button type="button" className="btn btn-secondary" disabled={unhold.state === "saving"} onClick={async () => (await unhold.run()) && done(t("awardPayments.done.holdLifted"))}>
                {t("awardPayments.liftHold")}
              </button>
            )}
            {row.status !== "held" && (
              <button type="button" className="btn btn-ghost" onClick={() => setDialog("hold")}>
                <Hand className="ic" aria-hidden="true" />
                {t("awardPayments.hold")}
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => setDialog("cancel")}>
              {t("awardPayments.cancelTranche")}
            </button>
            {facilitatedPayments && blocked && row.status !== "held" && (
              <span className="help" id={`blocked-${row.id}`}>
                {blocked}
              </span>
            )}
          </div>
        )}
      </div>
      {dialog === "release" && r && <ReleaseDialog readiness={r} awardTitle={row.award?.title ?? ""} recipientName={recipientName} onClose={() => setDialog(null)} onDone={() => done(t("awardPayments.done.released"))} />}
      {dialog === "external" && <RecordExternalDialog tranche={row} recipientName={recipientName} onClose={() => setDialog(null)} onDone={(unverified) => done(unverified ? t("awardPayments.done.unverified") : t("awardPayments.done.recorded"))} />}
      {dialog === "hold" && (
        <ReasonDialog
          title={t("awardPayments.holdTranche", { seq: row.seq })}
          label={t("awardPayments.whyIsThisTranche")}
          action={t("awardPayments.action.hold")}
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            if (await hold.run(reason)) done(t("awardPayments.done.held"));
            else setDialog(null);
          }}
        />
      )}
      {dialog === "cancel" && (
        <ReasonDialog
          title={t("awardPayments.cancelTranche2", { seq: row.seq })}
          label={t("awardPayments.whyIsThisTranche2")}
          action={t("awardPayments.action.cancel")}
          danger
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            if (await cancel.run(reason)) done(t("awardPayments.done.cancelled"));
            else setDialog(null);
          }}
        />
      )}
    </section>
  );
}

function BudgetPanel({ awardId }: { awardId: string }) {
  const variance = useApiQuery((api) => api.getVariance(awardId), [awardId]);
  if (variance.status === "loading") return <Loading label={t("awardPayments.loadingTheBudget")} />;
  if (variance.status === "error") return <ErrorBanner error={variance.error} onRetry={variance.reload} />;
  const v: BudgetVariance = variance.data;
  if (!v.hasApprovedBudget)
    return (
      <div className="card">
        <EmptyState icon={Banknote} title={t("awardPayments.noApprovedBudget")}>
          {t("awardPayments.theApprovedBudgetIs")}
        </EmptyState>
      </div>
    );
  return (
    <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("awardPayments.approvedBudgetAgainstActuals")}>
      <table className="tbl bud" aria-label={t("awardPayments.approvedBudgetAgainstActuals2")}>
        <thead>
          <tr>
            <th>{t("awardPayments.category")}</th>
            <th className="num">{t("awardPayments.approved")}</th>
            <th className="num">{t("awardPayments.actualToDate")}</th>
            <th className="num">{t("awardPayments.remaining")}</th>
            <th className="num">{t("awardPayments.spent")}</th>
          </tr>
        </thead>
        <tbody>
          {v.categories.map((c) => (
            <tr key={c.category}>
              <td>{c.category}</td>
              <td className="num">{formatMinor(c.approvedMinor, v.currency)}</td>
              <td className={`num${c.over ? " over" : ""}`}>{formatMinor(c.actualMinor, v.currency)}</td>
              <td className={`num ${c.varianceMinor < 0 ? "var-neg" : "var-pos"}`}>{formatMinor(c.varianceMinor, v.currency)}</td>
              <td className="num">{c.percentSpent === null ? "—" : `${c.percentSpent}%`}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>{t("awardPayments.total")}</td>
            <td className="num">{formatMinor(v.totals.approvedMinor, v.currency)}</td>
            <td className={`num${v.totals.over ? " over" : ""}`}>{formatMinor(v.totals.actualMinor, v.currency)}</td>
            <td className="num">{formatMinor(v.totals.varianceMinor, v.currency)}</td>
            <td className="num" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function RequirementList({ requirements, base }: { requirements: Requirement[]; base: string }) {
  if (!requirements.length)
    return (
      <div className="card">
        <EmptyState icon={Calendar} title={t("awardPayments.noRequirements")}>
          {t("awardPayments.reportsAndOtherRequirements")}
        </EmptyState>
      </div>
    );
  return (
    <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("awardPayments.requirementsScrollable")}>
      <table className="tbl" aria-label={t("awardPayments.requirements")}>
        <thead>
          <tr>
            <th>{t("awardPayments.requirement")}</th>
            <th>{t("awardPayments.due3")}</th>
            <th>{t("awardPayments.status")}</th>
            <th>{t("awardPayments.releases")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {requirements.map((r) => (
            <tr key={r.id}>
              <td className="b">{r.title}</td>
              <td>{formatDate(r.dueAt)}</td>
              <td>
                <StatusBadge kind="requirement" status={r.status} />
              </td>
              <td>{r.releasesTrancheId ? t("awardPayments.aTrancheWhenAccepted") : <span className="muted">—</span>}</td>
              <td>
                <Link to={`${base}/reporting`} className="small b">
                  {t("awardPayments.openInReporting")}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AwardPayments() {
  useFunderMessages();
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const { awardId = "" } = useParams();
  const [tab, setTab] = useAwardTab("payments", awardId, base);
  const { facilitatedPayments } = useAppConfig();
  const [editing, setEditing] = useState(false);
  const page = useApiQuery(async (api) => {
    const [schedule, rows, requirements] = await Promise.all([api.getSchedule(awardId), api.listTranches({ awardId }), api.listRequirements(awardId)]);
    return { schedule, rows: [...rows].sort((a, b) => a.seq - b.seq), requirements };
  }, [awardId]);
  const d = page.data;
  const first = d?.rows[0];
  const recipientName = first?.recipient?.name ?? t("awardPayments.theGrantee");
  const title = first?.award?.title ?? t("awardPayments.award");
  const requirementTitle = (id: string) => d?.requirements.find((r) => r.id === id)?.title.toLowerCase();
  const live: Tranche[] = d?.schedule.tranches.filter((item) => item.status !== "cancelled") ?? [];

  return (
    <>
      <title>{t("awardPayments.payments", { title })}</title>
      <FunderShell active="Awards">
        <main className="main">
          <PageHeader
            crumbs={[{ label: t("awardPayments.awards"), to: `${base}/awards` }, { label: title, to: `${base}/awards/${awardId}/agreement` }, { label: t("awardPayments.payments2") }]}
            title={title}
            badge={first?.recipient ? <VerificationBadge verification={first.recipient.verification} level={first.recipient.verificationLevel} /> : undefined}
            meta={
              <span>
                {recipientName} <WorkspaceName name={first?.recipient?.workspaceName} />
              </span>
            }
            actions={
              <>
                <Link to={`${base}/awards/${awardId}/agreement`} className="btn btn-secondary">
                  {t("awardPayments.agreement")}
                </Link>
                {d && (
                  <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
                    {t("awardPayments.editSchedule")}
                  </button>
                )}
              </>
            }
          />
          {page.status === "loading" && <Loading label={t("awardPayments.loadingPayments")} />}
          {page.status === "error" && <ErrorBanner error={page.error} onRetry={page.reload} />}
          {d && (
            <>
              <div className="amounts">
                <div>
                  <div className="stat-l">{t("awardPayments.awarded")}</div>
                  <div className="stat-v">{formatMinor(d.schedule.awardedAmountMinor, d.schedule.currency)}</div>
                </div>
                <div>
                  <div className="stat-l">{t("awardPayments.disbursed")}</div>
                  <div className="stat-v">{formatMinor(d.schedule.disbursedAmountMinor ?? 0, d.schedule.currency)}</div>
                  <div className="stat-d">{d.schedule.disbursedAsOf ? t("awardPayments.readFromPassport", { dateTime: dateTime(d.schedule.disbursedAsOf) }) : t("awardPayments.notReadFromPassport")}</div>
                </div>
                <div>
                  <div className="stat-l">{t("awardPayments.remaining")}</div>
                  <div className="stat-v">{formatMinor((d.schedule.awardedAmountMinor ?? 0) - (d.schedule.disbursedAmountMinor ?? 0), d.schedule.currency)}</div>
                </div>
                <div>
                  <div className="stat-l">{t("awardPayments.tranches")}</div>
                  <div className="stat-v">{live.length}</div>
                </div>
              </div>
              <AwardTabs active={tab} onChange={setTab} counts={{ payments: d.rows.filter((r) => OPEN.includes(r.status)).length, requirements: d.requirements.length }} />
              <TabPanel idPrefix="award" tab="payments" active={tab}>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {!facilitatedPayments && <PaymentsOffNotice />}
                  {!d.rows.length && (
                    <div className="card">
                      <EmptyState icon={Banknote} title={t("awardPayments.noPaymentScheduleYet")}>
                        {t("awardPayments.addTranchesWithEdit")}
                      </EmptyState>
                    </div>
                  )}
                  {d.rows
                    .filter((r) => r.status !== "cancelled")
                    .map((row) => (
                      <TrancheCard key={row.id} row={row} requirementTitle={requirementTitle} recipientName={recipientName} onChanged={page.reload} />
                    ))}
                </div>
              </TabPanel>
              <TabPanel idPrefix="award" tab="budget" active={tab}>
                <BudgetPanel awardId={awardId} />
              </TabPanel>
              <TabPanel idPrefix="award" tab="requirements" active={tab}>
                <RequirementList requirements={d.requirements} base={base} />
              </TabPanel>
              {editing && (
                <ScheduleEditor
                  schedule={d.schedule}
                  requirements={d.requirements}
                  onClose={() => setEditing(false)}
                  onSaved={() => {
                    setEditing(false);
                    page.reload();
                  }}
                />
              )}
            </>
          )}
        </main>
      </FunderShell>
    </>
  );
}
