// SPDX-License-Identifier: AGPL-3.0-only
// The Payments center. "Due" lists every tranche waiting on a person with its readiness; a release
// is always one tranche at a time, confirmed by a person. "In flight" follows released payments to
// settlement and gathers the alerts: pending destination changes, level drops, unverified
// externally paid tranches, and bank transactions waiting to be matched.
import { useState } from "react";
import { Link } from "react-router";
import { Banknote, CircleCheck, CircleDashed, CircleX, Download, Landmark, Send, RefreshCw } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { BankTransaction, LedgerEvent, PaymentAlert, PaymentsCenterItem, TrancheRow } from "../../api/funderMoney.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { ActivityTimeline, actorOf, describeEvent } from "../../components/ActivityTimeline.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { checklistOf, destinationLabel, HoldBanner, RecordExternalDialog, ReleaseDialog, releaseBlockedReason } from "../../components/payments.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { StatusBadge, VerificationBadge, WorkspaceName } from "../../components/status.tsx";
import { EmptyState, ErrorBanner, Field, Loading, Notice, PageHeader, ReadinessChecklist } from "../../components/ui.tsx";
import { useAppConfig, usePassportFlags } from "../../api/launchHooks.ts";
import { PaymentsOffNotice, recordOutsideLabel } from "../../components/launch.tsx";
import { downloadCsv } from "../../lib/browser.ts";
import { formatDate, formatMinor } from "../../lib/format.ts";
import { dateTime, usePeople } from "./shared.tsx";
import { t } from "./i18n.ts";

const ALERT_TONE = { warn: "bnr-warn", danger: "bnr-dng", neutral: "bnr-neu" } as const;

export type PaymentsView = "due" | "in-flight" | "reconcile" | "ledger";

function ViewSwitch({ base, view, due, inFlight, unmatched }: { base: string; view: PaymentsView; due: number; inFlight: number; unmatched: number }) {
  const tab = (to: PaymentsView, label: React.ReactNode) => (
    <Link to={`${base}/payments/${to}`} className={`tab${view === to ? " on" : ""}`} aria-current={view === to ? "page" : undefined}>
      {label}
    </Link>
  );
  return (
    <nav className="tabs" aria-label={t("paymentsCenter.paymentsViews")}>
      {tab(
        "due",
        <>
          {t.rich("paymentsCenter.due", { due, span: (chunks) => <span className="n">{chunks}</span> })}
        </>,
      )}
      {tab(
        "in-flight",
        <>
          {t.rich("paymentsCenter.inFlightAlerts", { inFlight, span: (chunks) => <span className="n">{chunks}</span> })}
        </>,
      )}
      {tab(
        "reconcile",
        <>
          {t.rich("paymentsCenter.reconcile", { unmatched, span: (chunks) => <span className="n">{chunks}</span> })}
        </>,
      )}
      {tab("ledger", t("paymentsCenter.ledger"))}
    </nav>
  );
}

/** Why a tranche is held, by its reason id; an id this screen does not know reads as its words. */
const HOLD_REASON: Record<string, () => string> = {
  manual: () => t("paymentsCenter.holdReason.manual"),
  destination_change_in_flight: () => t("paymentsCenter.holdReason.destinationChangeInFlight"),
  pending_destination_change: () => t("paymentsCenter.holdReason.pendingDestinationChange"),
  credential_version_stale: () => t("paymentsCenter.holdReason.credentialVersionStale"),
};
const holdReasonLabel = (reason: string) => HOLD_REASON[reason]?.() ?? reason.replace(/_/g, " ");

/** What falls due in the next 30 days, soonest first; tranches waiting on an event have no date. */
function NextThirtyDays({ rows, now }: { rows: TrancheRow[]; now: Date }) {
  const until = new Date(now.getTime() + 30 * 86_400_000);
  const upcoming = rows
    .filter((r) => ["scheduled", "due", "ready", "held"].includes(r.status))
    // Anything already due, ready or held belongs in the window whatever its date says.
    .filter((r) => r.status !== "scheduled" || !r.dueAt || Date.parse(r.dueAt) <= until.getTime())
    .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
  const total = upcoming.reduce((n, r) => n + r.amountMinor, 0);
  const waitsOn = (r: TrancheRow) => {
    const type = (r.condition as { type?: string } | null)?.type;
    if (r.status === "held") return r.holdReason ? t("paymentsCenter.waits.heldBecause", { reason: holdReasonLabel(r.holdReason) }) : t("paymentsCenter.waits.held");
    if (type === "onExecution") return t("paymentsCenter.waits.onExecution");
    if (type === "onReportAccepted") return t("paymentsCenter.waits.onReportAccepted");
    if (type === "onDate") return t("paymentsCenter.waits.onDate");
    return t("paymentsCenter.waits.manual");
  };
  return (
    <section className="card" aria-labelledby="next30-h">
      <div className="card-h">
        <h3 id="next30-h">{t("paymentsCenter.next30Days")}</h3>
        <span className="small muted">{t("paymentsCenter.to", { date: formatDate(until.toISOString()) })}</span>
      </div>
      {!upcoming.length && (
        <div className="card-b">
          <p className="muted small">{t("paymentsCenter.nothingIsScheduledIn")}</p>
        </div>
      )}
      <ul style={{ display: "flex", flexDirection: "column" }}>
        {upcoming.map((r, i) => (
          <li key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: "10px", padding: "10px 20px", borderBottom: i < upcoming.length - 1 ? "1px solid var(--og-gray-100)" : undefined, fontSize: "13px" }}>
            <div>
              <div className="b">
                {r.dueAt ? formatDate(r.dueAt) : t("paymentsCenter.whenItsConditionIs")} · {r.recipient?.name ?? t("paymentsCenter.grantee")}
              </div>
              <div className="small" style={r.status === "held" ? { color: "var(--s-warn-fg)" } : { color: "var(--og-gray-600)" }}>
                {t("paymentsCenter.tranche", { seq: r.seq, waitsOn: waitsOn(r) })}
              </div>
            </div>
            <div className="num b">{formatMinor(r.amountMinor, r.currency)}</div>
          </li>
        ))}
      </ul>
      <div className="card-f" style={{ justifyContent: "space-between" }}>
        <span className="small muted">{t("paymentsCenter.totalInWindow")}</span>
        <span className="b">{formatMinor(total)}</span>
      </div>
    </section>
  );
}

function ReadinessExplained() {
  const { facilitatedPayments } = useAppConfig();
  return (
    <section className="card" aria-labelledby="explained-h">
      <div className="card-h">
        <h3 id="explained-h">{t("paymentsCenter.readinessExplained")}</h3>
      </div>
      <div className="card-b" style={{ paddingTop: "8px" }}>
        <div className="rc">
          <div className="rc-row rc-pass" style={{ borderTop: 0 }}>
            <CircleCheck className="ic" aria-hidden="true" />
            <div>
              <div className="l">{t("paymentsCenter.pass")}</div>
              <div className="r">{t("paymentsCenter.checkedWhenThisPage")}</div>
            </div>
            <span></span>
          </div>
          <div className="rc-row rc-fail">
            <CircleX className="ic" aria-hidden="true" />
            <div>
              <div className="l">{t("paymentsCenter.fail")}</div>
              <div className="r">{facilitatedPayments ? t("paymentsCenter.blocksRelease") : t("paymentsCenter.somethingToSettleWith")} {t("paymentsCenter.theRowSaysWhat")}</div>
            </div>
            <span></span>
          </div>
          <div className="rc-row rc-unk">
            <CircleDashed className="ic" aria-hidden="true" />
            <div>
              <div className="l">{t("paymentsCenter.unknown")}</div>
              <div className="r">{t("paymentsCenter.couldNotBeChecked")} {facilitatedPayments ? t("paymentsCenter.treatedAsBlockingNever") : t("paymentsCenter.neverShownAsA")}</div>
            </div>
            <span></span>
          </div>
        </div>
        <div className="divider" style={{ margin: "10px 0" }}></div>
        <p className="small muted">{t("paymentsCenter.sevenChecksRunPer")}</p>
      </div>
    </section>
  );
}

const ALERT_GROUPS = (): { title: string; kinds: string[]; empty: string }[] => [
  { title: t("paymentsCenter.alerts.destination"), kinds: ["destination_change_pending"], empty: t("paymentsCenter.alerts.destinationEmpty") },
  { title: t("paymentsCenter.alerts.level"), kinds: ["level_below_l3"], empty: t("paymentsCenter.alerts.levelEmpty") },
  { title: t("paymentsCenter.alerts.inactive"), kinds: ["organization_inactive"], empty: t("paymentsCenter.alerts.inactiveEmpty") },
];

function DueItem({ item, row, base, onChanged }: { item: PaymentsCenterItem; row: TrancheRow | undefined; base: string; onChanged: (note: string) => void }) {
  const [dialog, setDialog] = useState<"release" | "external" | null>(null);
  const tr = item.tranche;
  const name = row?.recipient?.name ?? t("paymentsCenter.grantee");
  const { facilitatedPayments } = useAppConfig();
  const blocked = releaseBlockedReason(item);
  return (
    <section className="card" aria-labelledby={`due-${tr.id}`}>
      <div className="card-h">
        <div className="col" style={{ gap: "4px" }}>
          <div className="row wrap">
            <h3 id={`due-${tr.id}`}>{name}</h3>
            <VerificationBadge verification={row?.recipient?.verification} level={row?.recipient?.verificationLevel} />
            <WorkspaceName name={row?.recipient?.workspaceName} />
            <StatusBadge kind="tranche" status={tr.status} />
          </div>
          <p className="small muted">
            {t.rich("paymentsCenter.tranche2", { title: item.award.title, seq: tr.seq, link: (chunks) => <Link to={`${base}/awards/${item.award.id}/payments`}>{chunks}</Link> })}
            {tr.dueAt ? t("paymentsCenter.due2", { date: formatDate(tr.dueAt) }) : ""}
          </p>
        </div>
        <div className="col" style={{ alignItems: "flex-end", gap: "4px" }}>
          <span className="stat-v" style={{ fontSize: "22px" }}>
            {formatMinor(tr.amountMinor, tr.currency)}
          </span>
          <span className="small muted userback-block">{t("paymentsCenter.to2", { destinationLabel: destinationLabel(item.destination) })}</span>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {item.banner && <HoldBanner banner={item.banner} action={<Link to={`${base}/awards/${item.award.id}/payments`}>{t("paymentsCenter.openTranche")}</Link>} />}
        <ReadinessChecklist checklist={checklistOf(item)} title={t("paymentsCenter.readiness")} />
      </div>
      <div className="card-f">
        {facilitatedPayments && (
          <button type="button" className="btn btn-primary" disabled={blocked !== null} onClick={() => setDialog("release")}>
            <Send className="ic" aria-hidden="true" />
            {t("paymentsCenter.release")}
          </button>
        )}
        <button type="button" className={facilitatedPayments ? "btn btn-secondary" : "btn btn-primary"} disabled={tr.status === "held"} onClick={() => setDialog("external")}>
          <Banknote className="ic" aria-hidden="true" />
          {facilitatedPayments ? t("paymentsCenter.recordExternalPayment") : recordOutsideLabel()}
        </button>
        {facilitatedPayments && blocked && <span className="help">{blocked}</span>}
      </div>
      {dialog === "release" && (
        <ReleaseDialog
          readiness={item}
          awardTitle={item.award.title}
          recipientName={name}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            onChanged(t("paymentsCenter.done.released", { amount: formatMinor(tr.amountMinor, tr.currency), name }));
          }}
        />
      )}
      {dialog === "external" && (
        <RecordExternalDialog
          tranche={tr}
          recipientName={name}
          onClose={() => setDialog(null)}
          onDone={(unverified) => {
            setDialog(null);
            onChanged(unverified ? t("paymentsCenter.done.unverified", { name }) : t("paymentsCenter.done.recorded", { name }));
          }}
        />
      )}
    </section>
  );
}

function MatchDialog({ txn, rows, onClose, onDone }: { txn: BankTransaction; rows: TrancheRow[]; onClose: () => void; onDone: () => void }) {
  const proposals = txn.proposals ?? [];
  const [trancheId, setTrancheId] = useState(proposals[0]?.trancheId ?? "");
  const [last4, setLast4] = useState("");
  const match = useApiMutation((api) => api.matchBankTransaction(txn.id, { trancheId, destinationLast4: last4 }));
  const label = (id: string) => {
    const r = rows.find((x) => x.id === id);
    return r ? t("paymentsCenter.trancheAmountLabel", { name: r.recipient?.name ?? t("paymentsCenter.grantee"), seq: r.seq, amount: formatMinor(r.amountMinor, r.currency) }) : id;
  };
  return (
    <Dialog open onClose={onClose} labelledBy="match-title">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await match.run()) onDone();
        }}
      >
        <div className="hd">
          <div>
            <h2 id="match-title">{t("paymentsCenter.matchThisBankTransaction")}</h2>
            <p className="small muted">
              {t("paymentsCenter.posted", { counterpartyName: txn.counterpartyName, amount: formatMinor(txn.amountMinor, txn.currency), date: formatDate(txn.postedAt) })}
            </p>
          </div>
        </div>
        <div className="bd">
          {match.error !== null && <ErrorBanner error={match.error} />}
          <Field id="match-tranche" label={t("paymentsCenter.trancheThisPaid")} required help={t("paymentsCenter.confirmingRecordsTheTranche")}>
            <select className="sel" id="match-tranche" value={trancheId} onChange={(e) => setTrancheId(e.target.value)} required>
              <option value="">{t("paymentsCenter.chooseATranche")}</option>
              {proposals.map((p) => (
                <option key={p.trancheId} value={p.trancheId}>
                  {t("paymentsCenter.match", { label: label(p.trancheId), round: Math.round(p.score * 100) })}
                </option>
              ))}
            </select>
          </Field>
          <Field id="match-last4" label={t("paymentsCenter.destinationLastFourDigits")} required help={t("paymentsCenter.fromYourBanksRecord")}>
            <input className="inp userback-block" id="match-last4" inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} style={{ maxWidth: "160px" }} required />
          </Field>
        </div>
        <div className="ft">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("paymentsCenter.cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!trancheId || !/^\d{4}$/.test(last4) || match.state === "saving"}>
            {t("paymentsCenter.confirmMatch")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function AlertRows({ alerts, base }: { alerts: PaymentAlert[]; base: string }) {
  return (
    <>
      {alerts.map((a, i) => (
        <div key={`${a.kind}-${i}`} className={`bnr ${ALERT_TONE[a.tone]}`} role="status" data-kind={a.kind}>
          <Landmark className="ic" aria-hidden="true" />
          <div>
            <div className="t">{a.title}</div>
            <div className="d">{a.detail}</div>
          </div>
          {a.awardId && (
            <Link to={`${base}/awards/${a.awardId}/payments`} className="act small b">
              {t("paymentsCenter.openTranche")}
            </Link>
          )}
          {!a.awardId && a.recipientWorkspaceId && (
            <Link to={`${base}/grantees/${a.recipientWorkspaceId}`} className="act small b">
              {t("paymentsCenter.granteeRecord")}
            </Link>
          )}
        </div>
      ))}
    </>
  );
}

/** Alerts by cause, as Passport reports them; each group says so when it is empty. */
function Alerts({ alerts, base }: { alerts: PaymentAlert[]; base: string }) {
  const groups = ALERT_GROUPS();
  const grouped = new Set(groups.flatMap((g) => g.kinds));
  const other = alerts.filter((a) => !grouped.has(a.kind));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {groups.map((g) => {
        const rows = alerts.filter((a) => g.kinds.includes(a.kind));
        return (
          <div key={g.title} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <h3 style={{ fontSize: "13px" }}>
              {g.title} <span className="muted">· {rows.length}</span>
            </h3>
            {rows.length ? <AlertRows alerts={rows} base={base} /> : <p className="muted small">{g.empty}</p>}
          </div>
        );
      })}
      {other.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <h3 style={{ fontSize: "13px" }}>
            {t.rich("paymentsCenter.paymentsNeedingAttention", { count: other.length, span: (chunks) => <span className="muted">{chunks}</span> })}
          </h3>
          <AlertRows alerts={other} base={base} />
        </div>
      )}
    </div>
  );
}

function Reconcile({ unmatched, matched, rows, feed, base, onMatch }: { unmatched: BankTransaction[]; matched: BankTransaction[]; rows: TrancheRow[]; feed: { connected: boolean; lastSyncAt: string | null }; base: string; onMatch: (item: BankTransaction) => void }) {
  const label = (id: string | null | undefined) => {
    const r = rows.find((x) => x.id === id);
    return r ? t("paymentsCenter.trancheLabel", { name: r.recipient?.name ?? t("paymentsCenter.grantee"), seq: r.seq }) : "—";
  };
  const proposed = new Set(unmatched.flatMap((b) => (b.proposals ?? []).map((p) => p.trancheId)));
  const waiting = rows.filter((r) => ["due", "ready"].includes(r.status) && !proposed.has(r.id));
  if (!feed.connected) {
    return (
      <div className="card">
        <EmptyState
          icon={Landmark}
          title={t("paymentsCenter.bankFeedNotConnected")}
          actions={
            <Link to={`${base}/settings/mcp#integrations`} className="btn btn-secondary">
              {t("paymentsCenter.connectMercuryReadOnly")}
            </Link>
          }
        >
          {t("paymentsCenter.reconciliationMatchesPaymentsYou")}
        </EmptyState>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
      <section className="card" aria-labelledby="mercury-h">
        <div className="card-h">
          <h2 id="mercury-h" style={{ fontSize: "16px" }}>
            {t("paymentsCenter.mercuryOutboundTransactions")}
          </h2>
          <span className="small muted">{feed.lastSyncAt ? t("paymentsCenter.readOnlySynced", { date: dateTime(feed.lastSyncAt) }) : t("paymentsCenter.readOnly")}</span>
        </div>
        <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label={t("paymentsCenter.mercuryOutboundTransactionsScrollable")}>
          <table className="tbl" aria-label={t("paymentsCenter.mercuryOutboundTransactions")}>
            <thead>
              <tr>
                <th>{t("paymentsCenter.mercuryTransaction")}</th>
                <th className="num">{t("paymentsCenter.amount")}</th>
                <th>{t("paymentsCenter.proposedMatch")}</th>
                <th>{t("paymentsCenter.confidence")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {unmatched.map((b) => {
                const best = b.proposals?.[0];
                return (
                  <tr key={b.id}>
                    <td>
                      <div className="ent">
                        <span className="nm">{b.counterpartyName ?? t("paymentsCenter.unknownCounterparty")}</span>
                        <span className="small muted">
                          {t("paymentsCenter.posted2", { date: formatDate(b.postedAt) })}
                          {b.memo ? ` · ${b.memo}` : ""}
                        </span>
                      </div>
                    </td>
                    <td className="num">{formatMinor(b.amountMinor, b.currency)}</td>
                    <td>{best ? label(best.trancheId) : <span className="muted">{t("paymentsCenter.noMatchProposed")}</span>}</td>
                    <td>{best ? (best.ambiguous ? t("paymentsCenter.scoreAmbiguous", { score: Math.round(best.score * 100) }) : `${Math.round(best.score * 100)}%`) : "—"}</td>
                    <td>
                      <button type="button" className="btn btn-sm btn-secondary" disabled={!b.proposals?.length} onClick={() => onMatch(b)}>
                        {t("paymentsCenter.match2")}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {matched.map((b) => (
                <tr key={b.id}>
                  <td>
                    <div className="ent">
                      <span className="nm">{b.counterpartyName ?? t("paymentsCenter.unknownCounterparty")}</span>
                      <span className="small muted">{t("paymentsCenter.posted2", { date: formatDate(b.postedAt) })}</span>
                    </div>
                  </td>
                  <td className="num">{formatMinor(b.amountMinor, b.currency)}</td>
                  <td>{label(b.matchedTrancheId)}</td>
                  <td>
                    <span className="bdg bdg-ok">
                      <CircleCheck className="ic" aria-hidden="true" />
                      {t("paymentsCenter.matched")}
                    </span>
                  </td>
                  <td className="small muted">{b.matchedAt ? formatDate(b.matchedAt) : ""}</td>
                </tr>
              ))}
              {!unmatched.length && !matched.length && (
                <tr>
                  <td colSpan={5} className="muted">
                    {t("paymentsCenter.noOutboundTransactionsYet")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card" aria-labelledby="unmatched-h">
        <div className="card-h">
          <h3 id="unmatched-h">{t("paymentsCenter.unmatchedTranches", { count: waiting.length })}</h3>
        </div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {!waiting.length && <p className="muted small">{t("paymentsCenter.everyTrancheThatIs")}</p>}
          {waiting.map((r) => (
            <div key={r.id} className="row" style={{ justifyContent: "space-between", gap: "10px" }}>
              <div>
                <Link to={`${base}/awards/${r.awardId}/payments`} className="b">
                  {r.recipient?.name ?? t("paymentsCenter.grantee")}
                </Link>
                <div className="small muted">
                  {t("paymentsCenter.tranche3", { seq: r.seq, amount: formatMinor(r.amountMinor, r.currency) })}
                </div>
              </div>
              <StatusBadge kind="tranche" status={r.status} />
            </div>
          ))}
          <p className="small muted">{t("paymentsCenter.aMatchRecordsThe")}</p>
        </div>
      </section>
    </div>
  );
}

const PAYMENT_SUBJECTS = ["tranche", "award", "disbursement", "payee"];

function PaymentsLedger({ events, personName }: { events: LedgerEvent[]; personName: (id: string) => string | undefined }) {
  const exportCsv = () =>
    downloadCsv(
      [[t("paymentsCenter.csv.when"), t("paymentsCenter.csv.who"), t("paymentsCenter.csv.what"), t("paymentsCenter.csv.subject"), t("paymentsCenter.csv.subjectId")], ...events.map((e) => [e.occurredAt, actorOf(e.actor, personName).name, describeEvent(e.eventType), e.subjectType, e.subjectId])],
      "payments-ledger.csv",
    );
  return (
    <section className="card" aria-labelledby="ledger-h">
      <div className="card-h">
        <div>
          <h2 id="ledger-h" style={{ fontSize: "16px" }}>
            {t("paymentsCenter.paymentsLedger")}
          </h2>
          <p className="small muted">{t("paymentsCenter.everyReleaseHoldExternal")}</p>
        </div>
        <button type="button" className="btn btn-sm btn-secondary" onClick={exportCsv} disabled={!events.length}>
          <Download className="ic" aria-hidden="true" />
          {t("paymentsCenter.exportCsv")}
        </button>
      </div>
      <div className="card-b">
        <ActivityTimeline events={events} personName={personName} when={(iso) => dateTime(iso)} compact={false} empty={t("paymentsCenter.ledgerEmpty")} />
      </div>
    </section>
  );
}

export function PaymentsCenter({ view }: { view: PaymentsView }) {
  const { facilitatedPayments } = useAppConfig();
  const passportFlags = usePassportFlags();
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const [note, setNote] = useState<string | null>(null);
  const [matching, setMatching] = useState<BankTransaction | null>(null);
  const { person } = usePeople();
  const page = useApiQuery(async (api) => {
    const [center, rows, alerts, allBank, link, feed, ledger] = await Promise.all([
      api.paymentsReadiness(),
      api.listTranches(),
      api.paymentAlerts(),
      api.listBankTransactions(),
      api.passportStatus(ws.id),
      api.getConnector("mercury").catch(() => ({ connected: false, lastSyncAt: null })),
      api.listLedger({ pageSize: 100 }),
    ]);
    const bank = allBank.filter((b) => !b.matchedTrancheId);
    return { center, rows, alerts, bank, matched: allBank.filter((b) => b.matchedTrancheId), link, feed, ledger: ledger.items.filter((e) => PAYMENT_SUBJECTS.includes(e.subjectType)) };
  }, [ws.id]);
  const d = page.data;
  const flying = d?.rows.filter((r) => ["releasing", "initiated"].includes(r.status)) ?? [];
  const settled = d?.rows.filter((r) => r.status === "settled").sort((a, b) => (b.releasedAt ?? "").localeCompare(a.releasedAt ?? "")) ?? [];
  const unreachable = !!d && d.center.items.some((i) => i.banner?.cause === "passport_unavailable");
  const changed = (message: string) => {
    setNote(message);
    page.reload();
  };

  return (
    <>
      <title>{t("paymentsCenter.payments", { name: ws.name })}</title>
      <FunderShell active="Payments">
        <main className="main">
          <PageHeader
            crumbs={[{ label: ws.name, to: base }, { label: t("paymentsCenter.payments2") }]}
            title={t("paymentsCenter.payments2")}
            meta={
              d ? (
                <>
                  <span>{t("paymentsCenter.due3", { amount: formatMinor(d.center.totals.dueMinor) })}</span>
                  <span>·</span>
                  {facilitatedPayments ? (
                    <>
                      <span>{t("paymentsCenter.readyToRelease", { releasable: d.center.totals.releasable })}</span>
                      <span>·</span>
                      <span>{t("paymentsCenter.blocked", { blocked: d.center.totals.blocked })}</span>
                    </>
                  ) : (
                    <span>{t("paymentsCenter.withAReadinessCheck", { blocked: d.center.totals.blocked })}</span>
                  )}
                </>
              ) : undefined
            }
          />
          {page.status === "loading" && <Loading label={t("paymentsCenter.loadingPayments")} />}
          {page.status === "error" && <ErrorBanner error={page.error} onRetry={page.reload} />}
          {d && (
            <>
              <ViewSwitch base={base} view={view} due={d.center.items.length} inFlight={flying.length + d.alerts.length} unmatched={d.bank.length} />
              {note && <Notice tone="ok" title={note} />}
              {!facilitatedPayments && <PaymentsOffNotice />}
              {!d.link.linked && (
                <HoldBanner
                  banner={{ cause: "passport_not_linked", tone: "neutral", title: t("paymentsCenter.connectPassportToPay"), detail: t("paymentsCenter.notLinked.detail"), clears: t("paymentsCenter.notLinked.clears") }}
                  action={
                    passportFlags.linking ? (
                      <Link to={`${base}/settings/passport`} className="btn btn-secondary">
                        {t("paymentsCenter.connectPassport")}
                      </Link>
                    ) : undefined
                  }
                />
              )}
              {d.link.linked && unreachable && <HoldBanner banner={{ cause: "passport_unavailable", tone: "neutral", title: t("paymentsCenter.passportCantBeReached"), detail: t("paymentsCenter.unreachable.detail"), clears: t("paymentsCenter.unreachable.clears") }} />}

              {view === "due" && (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.9fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    {!d.center.items.length && (
                      <div className="card">
                        <EmptyState icon={CircleCheck} title={t("paymentsCenter.nothingIsDue")}>
                          {t("paymentsCenter.tranchesAppearHereWhen")}
                        </EmptyState>
                      </div>
                    )}
                    {d.center.items.map((item) => (
                      <DueItem key={item.tranche.id} item={item} row={d.rows.find((r) => r.id === item.tranche.id)} base={base} onChanged={changed} />
                    ))}
                    <p className="notice">
                      {facilitatedPayments
                        ? t("paymentsCenter.paymentsAreReleasedOne")
                        : t("paymentsCenter.paymentsAreRecordedOne")}
                    </p>
                  </div>
                  <aside style={{ display: "flex", flexDirection: "column", gap: "16px" }} aria-label={t("paymentsCenter.upcomingPaymentsAndHow")}>
                    <NextThirtyDays rows={d.rows} now={new Date()} />
                    <ReadinessExplained />
                  </aside>
                </div>
              )}

              {view === "reconcile" && <Reconcile unmatched={d.bank} matched={d.matched} rows={d.rows} feed={d.feed} base={base} onMatch={setMatching} />}
              {view === "ledger" && <PaymentsLedger events={d.ledger} personName={(id) => person(id)?.name} />}

              {view === "in-flight" && (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <section className="card" aria-labelledby="flight-h">
                      <div className="card-h">
                        <h2 id="flight-h" style={{ fontSize: "16px" }}>
                          {t("paymentsCenter.inFlight")}
                        </h2>
                        <div className="row" style={{ gap: "10px" }}>
                          <span className="small muted">{t("paymentsCenter.withPassport", { count: flying.length })}</span>
                          <button type="button" className="btn btn-sm btn-secondary" onClick={page.reload}>
                            <RefreshCw className="ic" aria-hidden="true" />
                            {t("paymentsCenter.refresh")}
                          </button>
                        </div>
                      </div>
                      <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label={t("paymentsCenter.paymentsInFlightScrollable")}>
                        <table className="tbl" aria-label={t("paymentsCenter.paymentsInFlight")}>
                          <thead>
                            <tr>
                              <th>{t("paymentsCenter.grantee")}</th>
                              <th>{t("paymentsCenter.tranche4")}</th>
                              <th className="num">{t("paymentsCenter.amount")}</th>
                              <th>{t("paymentsCenter.released")}</th>
                              <th>{t("paymentsCenter.status")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {flying.map((r) => (
                              <tr key={r.id}>
                                <td>
                                  <Link to={`${base}/awards/${r.awardId}/payments`} className="b">
                                    {r.recipient?.name}
                                  </Link>
                                </td>
                                <td>{t("paymentsCenter.tranche5", { seq: r.seq })}</td>
                                <td className="num">{formatMinor(r.amountMinor, r.currency)}</td>
                                <td>{dateTime(r.releasedAt)}</td>
                                <td>
                                  <StatusBadge kind="tranche" status={r.status} />
                                </td>
                              </tr>
                            ))}
                            {!flying.length && (
                              <tr>
                                <td colSpan={5} className="muted">
                                  {t("paymentsCenter.nothingIsInFlight")}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>
                    <section className="card" aria-labelledby="settled-h">
                      <div className="card-h">
                        <h2 id="settled-h" style={{ fontSize: "16px" }}>
                          {t("paymentsCenter.settled")}
                        </h2>
                      </div>
                      <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label={t("paymentsCenter.settledPaymentsScrollable")}>
                        <table className="tbl" aria-label={t("paymentsCenter.settledPayments")}>
                          <thead>
                            <tr>
                              <th>{t("paymentsCenter.grantee")}</th>
                              <th>{t("paymentsCenter.tranche4")}</th>
                              <th className="num">{t("paymentsCenter.amount")}</th>
                              <th>{t("paymentsCenter.how")}</th>
                              <th>{t("paymentsCenter.status")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {settled.map((r) => (
                              <tr key={r.id}>
                                <td>
                                  <Link to={`${base}/awards/${r.awardId}/payments`} className="b">
                                    {r.recipient?.name}
                                  </Link>
                                </td>
                                <td>{t("paymentsCenter.tranche5", { seq: r.seq })}</td>
                                <td className="num">{formatMinor(r.amountMinor, r.currency)}</td>
                                <td>{r.mode === "resolve" ? t("paymentsCenter.paidOutsidePassport") : t("paymentsCenter.throughPassport")}</td>
                                <td>{r.passportStatus === "unverified" ? <span className="pill-warn">{t("paymentsCenter.settledUnverified")}</span> : <StatusBadge kind="tranche" status={r.status} />}</td>
                              </tr>
                            ))}
                            {!settled.length && (
                              <tr>
                                <td colSpan={5} className="muted">
                                  {t("paymentsCenter.noSettledPaymentsYet")}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <section className="card" aria-labelledby="alerts-h">
                      <div className="card-h">
                        <h2 id="alerts-h" style={{ fontSize: "16px" }}>
                          {t("paymentsCenter.alerts")}
                        </h2>
                        <span className="small muted">{d.alerts.length}</span>
                      </div>
                      <div className="card-b">
                        <Alerts alerts={d.alerts} base={base} />
                      </div>
                    </section>
                    <section className="card" aria-labelledby="bank-h">
                      <div className="card-h">
                        <h2 id="bank-h" style={{ fontSize: "16px" }}>
                          {t("paymentsCenter.bankTransactionsToMatch")}
                        </h2>
                        <span className="small muted">{t("paymentsCenter.readOnlyFromMercury")}</span>
                      </div>
                      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {!d.bank.length && <p className="muted small">{t("paymentsCenter.noUnmatchedOutboundTransactions")}</p>}
                        {d.bank.map((b) => (
                          <div key={b.id} className="doc">
                            <span className="ft">{t("paymentsCenter.txn")}</span>
                            <div className="grow">
                              <div className="nm">
                                {b.counterpartyName ?? t("paymentsCenter.unknownCounterparty")} · {formatMinor(b.amountMinor, b.currency)}
                              </div>
                              <div className="mt">
                                <span>{t("paymentsCenter.posted2", { date: formatDate(b.postedAt) })}</span>
                                {b.memo && (
                                  <>
                                    <span>·</span>
                                    <span>{b.memo}</span>
                                  </>
                                )}
                                {b.proposals?.length ? (
                                  <>
                                    <span>·</span>
                                    <span>{t("paymentsCenter.proposedMatchCount", { count: b.proposals.length })}</span>
                                  </>
                                ) : null}
                              </div>
                            </div>
                            <button type="button" className="btn btn-sm btn-secondary" disabled={!b.proposals?.length} onClick={() => setMatching(b)}>
                              {t("paymentsCenter.match2")}
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                </div>
              )}
              {matching && (
                <MatchDialog
                  txn={matching}
                  rows={d.rows}
                  onClose={() => setMatching(null)}
                  onDone={() => {
                    setMatching(null);
                    changed(t("paymentsCenter.done.matched"));
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
