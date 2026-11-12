// SPDX-License-Identifier: AGPL-3.0-only
// An award's Payments tab: the schedule, each tranche's readiness and what blocks it, release
// through Passport, recording a payment made elsewhere, the approved budget against actuals, and
// the requirements that gate later tranches. The disbursed amount is always the figure last read
// from Passport; this screen never adds to it.
import { useState } from "react";
import { useAppConfig } from "../../api/launchHooks.ts";
import { PaymentsOffNotice, RECORD_OUTSIDE_LABEL } from "../../components/launch.tsx";
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
import { EmptyState, ErrorBanner, Field, Loading, Notice, PageHeader, ReadinessChecklist, TabPanel } from "../../components/ui.tsx";
import { formatDate, formatMinor, parseDollars } from "../../lib/format.ts";
import { dateTime } from "./shared.tsx";

const OPEN = ["due", "ready", "held"];
const NOT_STARTED = ["scheduled", "due", "ready", "held"];

interface DraftLine {
  amount: string;
  type: TrancheCondition["type"];
  date: string;
  requirementId: string;
}

function ScheduleEditor({ schedule, requirements, onClose, onSaved }: { schedule: Schedule; requirements: Requirement[]; onClose: () => void; onSaved: () => void }) {
  const editable = schedule.tranches.filter((t) => NOT_STARTED.includes(t.status));
  const fixed = schedule.tranches.filter((t) => !NOT_STARTED.includes(t.status) && t.status !== "cancelled");
  const left = (schedule.awardedAmountMinor ?? 0) - fixed.reduce((n, t) => n + t.amountMinor, 0);
  const [lines, setLines] = useState<DraftLine[]>(() =>
    (editable.length ? editable : [null]).map((t) => {
      const c = (t?.condition ?? { type: "manual" }) as TrancheCondition;
      return { amount: t ? String(t.amountMinor / 100) : "", type: c.type, date: c.type === "onDate" ? c.date : "", requirementId: c.type === "onReportAccepted" ? c.requirementId : "" };
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
            <h2 id="schedule-title">Edit the payment schedule</h2>
            <p className="small muted">Only tranches that have not started can change. They must add up to {formatMinor(left, schedule.currency)}.</p>
          </div>
        </div>
        <div className="bd">
          {save.error !== null && <ErrorBanner error={save.error} />}
          {lines.map((l, i) => (
            <fieldset key={i} className="card" style={{ padding: "12px 16px", margin: 0 }}>
              <legend className="small b">Tranche {fixed.length + i + 1}</legend>
              <div className="fld-row">
                <Field id={`sch-amount-${i}`} label="Amount (USD)" required>
                  <input className="inp" id={`sch-amount-${i}`} inputMode="decimal" value={l.amount} onChange={(e) => set(i, { amount: e.target.value })} />
                </Field>
                <Field id={`sch-cond-${i}`} label="Becomes due" required>
                  <select className="sel" id={`sch-cond-${i}`} value={l.type} onChange={(e) => set(i, { type: e.target.value as DraftLine["type"] })}>
                    <option value="onExecution">On agreement execution</option>
                    <option value="onReportAccepted">When a report is accepted</option>
                    <option value="onDate">On a date</option>
                    <option value="manual">Manually</option>
                  </select>
                </Field>
              </div>
              {l.type === "onDate" && (
                <Field id={`sch-date-${i}`} label="Date" required>
                  <input className="inp" id={`sch-date-${i}`} type="date" value={l.date} onChange={(e) => set(i, { date: e.target.value })} style={{ maxWidth: "220px" }} />
                </Field>
              )}
              {l.type === "onReportAccepted" && (
                <Field id={`sch-req-${i}`} label="Report" required>
                  <select className="sel" id={`sch-req-${i}`} value={l.requirementId} onChange={(e) => set(i, { requirementId: e.target.value })}>
                    <option value="">Choose a requirement</option>
                    {requirements.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title} · due {formatDate(r.dueAt)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {lines.length > 1 && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLines((rows) => rows.filter((_, n) => n !== i))}>
                  <Trash2 className="ic" aria-hidden="true" />
                  Remove tranche {fixed.length + i + 1}
                </button>
              )}
            </fieldset>
          ))}
          <button type="button" className="btn btn-secondary" style={{ alignSelf: "flex-start" }} onClick={() => setLines((rows) => [...rows, { amount: "", type: "manual", date: "", requirementId: "" }])}>
            <Plus className="ic" aria-hidden="true" />
            Add tranche
          </button>
          <p className={total === left ? "help" : "err-msg"} role="status">
            {formatMinor(total, schedule.currency)} of {formatMinor(left, schedule.currency)} scheduled{total === left ? "" : " · amounts must add up"}
          </p>
        </div>
        <div className="ft">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!complete || total !== left || save.state === "saving"}>
            Save schedule
          </button>
        </div>
      </form>
    </Dialog>
  );
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
  const blocked = r ? releaseBlockedReason(r) : "Checking readiness";
  const { facilitatedPayments } = useAppConfig();
  const external = row.external as { reference?: string; paidAt?: string; destinationLast4?: string } | null;
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
            Tranche {row.seq} · {formatMinor(row.amountMinor, row.currency)}
          </h3>
          <p className="small muted">
            {conditionLabel(row.condition, requirementTitle)}
            {row.dueAt ? ` · due ${formatDate(row.dueAt)}` : ""}
          </p>
        </div>
        <StatusBadge kind="tranche" status={row.status} />
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {row.status === "scheduled" && !note && <p className="muted small">Not due yet. It becomes due {conditionLabel(row.condition, requirementTitle).replace(/^./, (c) => c.toLowerCase())}, and is paid only when a person releases it.</p>}
        {note && <Notice tone="ok" title={note} />}
        {(unhold.error !== null || hold.error !== null || cancel.error !== null) && <ErrorBanner error={unhold.error ?? hold.error ?? cancel.error} />}
        {open && readiness.status === "loading" && <Loading label="Checking readiness" />}
        {open && readiness.status === "error" && <ErrorBanner error={readiness.error} onRetry={readiness.reload} />}
        {r?.banner && <HoldBanner banner={r.banner} />}
        {row.status === "held" && !r?.banner && <Notice tone="warn" title="Held by your team">This tranche stays out of the due list until someone lifts the hold.</Notice>}
        {r && <ReadinessChecklist checklist={checklistOf(r)} title="Readiness" />}
        {["initiated", "releasing", "settled", "returned", "failed"].includes(row.status) && (
          <div className="tl tl-sm">
            {row.releasedAt && (
              <div className="tl-i tl-person">
                <span className="dot">
                  <Send className="ic" aria-hidden="true" />
                </span>
                <div>
                  <div className="what">{row.mode === "resolve" ? "Recorded as paid outside Passport" : "Released through Passport"}</div>
                  <div className="who">
                    {dateTime(row.releasedAt)}
                    {external?.reference ? ` · ${external.reference} · destination •••• ${external.destinationLast4}` : ""}
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
                  <div className="what">{row.passportStatus === "unverified" ? "Settled here · not verified by Passport" : "Settled"}</div>
                  <div className="who">{row.passportStatus === "unverified" ? "Passport could not match the destination; this amount is not in the disbursed total." : "Confirmed by Passport"}</div>
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
                Release
              </button>
            )}
            {row.status !== "held" && (
              <button type="button" className={facilitatedPayments ? "btn btn-secondary" : "btn btn-primary"} onClick={() => setDialog("external")}>
                <Banknote className="ic" aria-hidden="true" />
                {facilitatedPayments ? "Record external payment" : RECORD_OUTSIDE_LABEL}
              </button>
            )}
            {row.status === "held" && row.holdReason === "manual" && (
              <button type="button" className="btn btn-secondary" disabled={unhold.state === "saving"} onClick={async () => (await unhold.run()) && done("Hold lifted")}>
                Lift hold
              </button>
            )}
            {row.status !== "held" && (
              <button type="button" className="btn btn-ghost" onClick={() => setDialog("hold")}>
                <Hand className="ic" aria-hidden="true" />
                Hold
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => setDialog("cancel")}>
              Cancel tranche
            </button>
            {facilitatedPayments && blocked && row.status !== "held" && (
              <span className="help" id={`blocked-${row.id}`}>
                {blocked}
              </span>
            )}
          </div>
        )}
      </div>
      {dialog === "release" && r && <ReleaseDialog readiness={r} awardTitle={row.award?.title ?? ""} recipientName={recipientName} onClose={() => setDialog(null)} onDone={() => done("Released. Passport will confirm when it settles.")} />}
      {dialog === "external" && <RecordExternalDialog tranche={row} recipientName={recipientName} onClose={() => setDialog(null)} onDone={(unverified) => done(unverified ? "Recorded here as unverified: Passport could not match the destination." : "Recorded as paid")} />}
      {dialog === "hold" && (
        <ReasonDialog
          title={`Hold tranche ${row.seq}`}
          label="Why is this tranche on hold?"
          action="Hold tranche"
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            if (await hold.run(reason)) done("Tranche held");
            else setDialog(null);
          }}
        />
      )}
      {dialog === "cancel" && (
        <ReasonDialog
          title={`Cancel tranche ${row.seq}`}
          label="Why is this tranche cancelled?"
          action="Cancel tranche"
          danger
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            if (await cancel.run(reason)) done("Tranche cancelled");
            else setDialog(null);
          }}
        />
      )}
    </section>
  );
}

function BudgetPanel({ awardId }: { awardId: string }) {
  const variance = useApiQuery((api) => api.getVariance(awardId), [awardId]);
  if (variance.status === "loading") return <Loading label="Loading the budget" />;
  if (variance.status === "error") return <ErrorBanner error={variance.error} onRetry={variance.reload} />;
  const v: BudgetVariance = variance.data;
  if (!v.hasApprovedBudget)
    return (
      <div className="card">
        <EmptyState icon={Banknote} title="No approved budget">
          The approved budget is set from the application’s budget when the award is made. Actuals arrive with the grantee’s reports.
        </EmptyState>
      </div>
    );
  return (
    <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Approved budget against actuals, scrollable">
      <table className="tbl bud" aria-label="Approved budget against actuals">
        <thead>
          <tr>
            <th>Category</th>
            <th className="num">Approved</th>
            <th className="num">Actual to date</th>
            <th className="num">Remaining</th>
            <th className="num">Spent</th>
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
            <td>Total</td>
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
        <EmptyState icon={Calendar} title="No requirements">
          Reports and other requirements come from the program’s defaults when the award is made.
        </EmptyState>
      </div>
    );
  return (
    <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Requirements, scrollable">
      <table className="tbl" aria-label="Requirements">
        <thead>
          <tr>
            <th>Requirement</th>
            <th>Due</th>
            <th>Status</th>
            <th>Releases</th>
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
              <td>{r.releasesTrancheId ? "A tranche when accepted" : <span className="muted">—</span>}</td>
              <td>
                <Link to={`${base}/reporting`} className="small b">
                  Open in Reporting
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
  const recipientName = first?.recipient?.name ?? "the grantee";
  const title = first?.award?.title ?? "Award";
  const requirementTitle = (id: string) => d?.requirements.find((r) => r.id === id)?.title.toLowerCase();
  const live: Tranche[] = d?.schedule.tranches.filter((t) => t.status !== "cancelled") ?? [];

  return (
    <>
      <title>{`Payments — ${title}`}</title>
      <FunderShell active="Awards">
        <main className="main">
          <PageHeader
            crumbs={[{ label: "Awards", to: `${base}/awards` }, { label: title, to: `${base}/awards/${awardId}/agreement` }, { label: "Payments" }]}
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
                  Agreement
                </Link>
                {d && (
                  <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
                    Edit schedule
                  </button>
                )}
              </>
            }
          />
          {page.status === "loading" && <Loading label="Loading payments" />}
          {page.status === "error" && <ErrorBanner error={page.error} onRetry={page.reload} />}
          {d && (
            <>
              <div className="amounts">
                <div>
                  <div className="stat-l">Awarded</div>
                  <div className="stat-v">{formatMinor(d.schedule.awardedAmountMinor, d.schedule.currency)}</div>
                </div>
                <div>
                  <div className="stat-l">Disbursed</div>
                  <div className="stat-v">{formatMinor(d.schedule.disbursedAmountMinor ?? 0, d.schedule.currency)}</div>
                  <div className="stat-d">{d.schedule.disbursedAsOf ? `Read from Passport ${dateTime(d.schedule.disbursedAsOf)}` : "Not read from Passport yet"}</div>
                </div>
                <div>
                  <div className="stat-l">Remaining</div>
                  <div className="stat-v">{formatMinor((d.schedule.awardedAmountMinor ?? 0) - (d.schedule.disbursedAmountMinor ?? 0), d.schedule.currency)}</div>
                </div>
                <div>
                  <div className="stat-l">Tranches</div>
                  <div className="stat-v">{live.length}</div>
                </div>
              </div>
              <AwardTabs active={tab} onChange={setTab} counts={{ payments: d.rows.filter((r) => OPEN.includes(r.status)).length, requirements: d.requirements.length }} />
              <TabPanel idPrefix="award" tab="payments" active={tab}>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {!facilitatedPayments && <PaymentsOffNotice />}
                  {!d.rows.length && (
                    <div className="card">
                      <EmptyState icon={Banknote} title="No payment schedule yet">
                        Add tranches with Edit schedule. Nothing is paid until a person releases a tranche.
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
