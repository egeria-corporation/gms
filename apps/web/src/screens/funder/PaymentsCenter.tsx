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
import { PaymentsOffNotice, RECORD_OUTSIDE_LABEL } from "../../components/launch.tsx";
import { downloadCsv } from "../../lib/browser.ts";
import { formatDate, formatMinor } from "../../lib/format.ts";
import { dateTime, usePeople } from "./shared.tsx";

const ALERT_TONE = { warn: "bnr-warn", danger: "bnr-dng", neutral: "bnr-neu" } as const;

export type PaymentsView = "due" | "in-flight" | "reconcile" | "ledger";

function ViewSwitch({ base, view, due, inFlight, unmatched }: { base: string; view: PaymentsView; due: number; inFlight: number; unmatched: number }) {
  const tab = (to: PaymentsView, label: React.ReactNode) => (
    <Link to={`${base}/payments/${to}`} className={`tab${view === to ? " on" : ""}`} aria-current={view === to ? "page" : undefined}>
      {label}
    </Link>
  );
  return (
    <nav className="tabs" aria-label="Payments views">
      {tab(
        "due",
        <>
          Due <span className="n">{due}</span>
        </>,
      )}
      {tab(
        "in-flight",
        <>
          In flight &amp; alerts <span className="n">{inFlight}</span>
        </>,
      )}
      {tab(
        "reconcile",
        <>
          Reconcile <span className="n">{unmatched}</span>
        </>,
      )}
      {tab("ledger", "Ledger")}
    </nav>
  );
}

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
    if (r.status === "held") return `held${r.holdReason ? ` · ${r.holdReason.replace(/_/g, " ")}` : ""}`;
    if (type === "onExecution") return "on execution";
    if (type === "onReportAccepted") return "when the report is accepted";
    if (type === "onDate") return "on the scheduled date";
    return "released manually";
  };
  return (
    <section className="card" aria-labelledby="next30-h">
      <div className="card-h">
        <h3 id="next30-h">Next 30 days</h3>
        <span className="small muted">to {formatDate(until.toISOString())}</span>
      </div>
      {!upcoming.length && (
        <div className="card-b">
          <p className="muted small">Nothing is scheduled in the next 30 days.</p>
        </div>
      )}
      <ul style={{ display: "flex", flexDirection: "column" }}>
        {upcoming.map((r, i) => (
          <li key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: "10px", padding: "10px 20px", borderBottom: i < upcoming.length - 1 ? "1px solid var(--og-gray-100)" : undefined, fontSize: "13px" }}>
            <div>
              <div className="b">
                {r.dueAt ? formatDate(r.dueAt) : "When its condition is met"} · {r.recipient?.name ?? "Grantee"}
              </div>
              <div className="small" style={r.status === "held" ? { color: "var(--s-warn-fg)" } : { color: "var(--og-gray-600)" }}>
                Tranche {r.seq} · {waitsOn(r)}
              </div>
            </div>
            <div className="num b">{formatMinor(r.amountMinor, r.currency)}</div>
          </li>
        ))}
      </ul>
      <div className="card-f" style={{ justifyContent: "space-between" }}>
        <span className="small muted">Total in window</span>
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
        <h3 id="explained-h">Readiness explained</h3>
      </div>
      <div className="card-b" style={{ paddingTop: "8px" }}>
        <div className="rc">
          <div className="rc-row rc-pass" style={{ borderTop: 0 }}>
            <CircleCheck className="ic" aria-hidden="true" />
            <div>
              <div className="l">Pass</div>
              <div className="r">Checked when this page loaded and true.</div>
            </div>
            <span></span>
          </div>
          <div className="rc-row rc-fail">
            <CircleX className="ic" aria-hidden="true" />
            <div>
              <div className="l">Fail</div>
              <div className="r">{facilitatedPayments ? "Blocks release." : "Something to settle with the grantee before you pay."} The row says what clears it and when.</div>
            </div>
            <span></span>
          </div>
          <div className="rc-row rc-unk">
            <CircleDashed className="ic" aria-hidden="true" />
            <div>
              <div className="l">Unknown</div>
              <div className="r">Could not be checked (Passport unreachable). {facilitatedPayments ? "Treated as blocking, never as pass." : "Never shown as a pass."}</div>
            </div>
            <span></span>
          </div>
        </div>
        <div className="divider" style={{ margin: "10px 0" }}></div>
        <p className="small muted">Seven checks run per tranche: agreement executed · tranche condition met · your Passport link and funding source · payee credential at L3 with an active destination and no pending change or freeze · award headroom at Passport · no duplicate release · recipient organization active.</p>
      </div>
    </section>
  );
}

const ALERT_GROUPS: { title: string; kinds: string[]; empty: string }[] = [
  { title: "Destination change pending", kinds: ["destination_change_pending"], empty: "No destination changes are cooling off." },
  { title: "Level downgrade", kinds: ["level_below_l3"], empty: "Every payee is at L3." },
  { title: "Inactive organizations", kinds: ["organization_inactive"], empty: "No inactive grantees." },
];

function DueItem({ item, row, base, onChanged }: { item: PaymentsCenterItem; row: TrancheRow | undefined; base: string; onChanged: (note: string) => void }) {
  const [dialog, setDialog] = useState<"release" | "external" | null>(null);
  const t = item.tranche;
  const name = row?.recipient?.name ?? "Grantee";
  const { facilitatedPayments } = useAppConfig();
  const blocked = releaseBlockedReason(item);
  return (
    <section className="card" aria-labelledby={`due-${t.id}`}>
      <div className="card-h">
        <div className="col" style={{ gap: "4px" }}>
          <div className="row wrap">
            <h3 id={`due-${t.id}`}>{name}</h3>
            <VerificationBadge verification={row?.recipient?.verification} level={row?.recipient?.verificationLevel} />
            <WorkspaceName name={row?.recipient?.workspaceName} />
            <StatusBadge kind="tranche" status={t.status} />
          </div>
          <p className="small muted">
            <Link to={`${base}/awards/${item.award.id}/payments`}>{item.award.title}</Link> · tranche {t.seq}
            {t.dueAt ? ` · due ${formatDate(t.dueAt)}` : ""}
          </p>
        </div>
        <div className="col" style={{ alignItems: "flex-end", gap: "4px" }}>
          <span className="stat-v" style={{ fontSize: "22px" }}>
            {formatMinor(t.amountMinor, t.currency)}
          </span>
          <span className="small muted">To {destinationLabel(item.destination)}</span>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {item.banner && <HoldBanner banner={item.banner} action={<Link to={`${base}/awards/${item.award.id}/payments`}>Open tranche</Link>} />}
        <ReadinessChecklist checklist={checklistOf(item)} title="Readiness" />
      </div>
      <div className="card-f">
        {facilitatedPayments && (
          <button type="button" className="btn btn-primary" disabled={blocked !== null} onClick={() => setDialog("release")}>
            <Send className="ic" aria-hidden="true" />
            Release
          </button>
        )}
        <button type="button" className={facilitatedPayments ? "btn btn-secondary" : "btn btn-primary"} disabled={t.status === "held"} onClick={() => setDialog("external")}>
          <Banknote className="ic" aria-hidden="true" />
          {facilitatedPayments ? "Record external payment" : RECORD_OUTSIDE_LABEL}
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
            onChanged(`Released ${formatMinor(t.amountMinor, t.currency)} to ${name}. It is now in flight.`);
          }}
        />
      )}
      {dialog === "external" && (
        <RecordExternalDialog
          tranche={t}
          recipientName={name}
          onClose={() => setDialog(null)}
          onDone={(unverified) => {
            setDialog(null);
            onChanged(unverified ? `Recorded for ${name} as unverified: Passport could not match the destination.` : `Recorded as paid to ${name}.`);
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
    return r ? `${r.recipient?.name ?? "Grantee"} · tranche ${r.seq} · ${formatMinor(r.amountMinor, r.currency)}` : id;
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
            <h2 id="match-title">Match this bank transaction</h2>
            <p className="small muted">
              {txn.counterpartyName} · {formatMinor(txn.amountMinor, txn.currency)} · posted {formatDate(txn.postedAt)}
            </p>
          </div>
        </div>
        <div className="bd">
          {match.error !== null && <ErrorBanner error={match.error} />}
          <Field id="match-tranche" label="Tranche this paid" required help="Confirming records the tranche as paid outside Passport.">
            <select className="sel" id="match-tranche" value={trancheId} onChange={(e) => setTrancheId(e.target.value)} required>
              <option value="">Choose a tranche</option>
              {proposals.map((p) => (
                <option key={p.trancheId} value={p.trancheId}>
                  {label(p.trancheId)} · {Math.round(p.score * 100)}% match
                </option>
              ))}
            </select>
          </Field>
          <Field id="match-last4" label="Destination, last four digits" required help="From your bank’s record of the payment. Never enter a full number.">
            <input className="inp" id="match-last4" inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} style={{ maxWidth: "160px" }} required />
          </Field>
        </div>
        <div className="ft">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!trancheId || !/^\d{4}$/.test(last4) || match.state === "saving"}>
            Confirm match
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
              Open tranche
            </Link>
          )}
          {!a.awardId && a.recipientWorkspaceId && (
            <Link to={`${base}/grantees/${a.recipientWorkspaceId}`} className="act small b">
              Grantee record
            </Link>
          )}
        </div>
      ))}
    </>
  );
}

/** Alerts by cause, as Passport reports them; each group says so when it is empty. */
function Alerts({ alerts, base }: { alerts: PaymentAlert[]; base: string }) {
  const grouped = new Set(ALERT_GROUPS.flatMap((g) => g.kinds));
  const other = alerts.filter((a) => !grouped.has(a.kind));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {ALERT_GROUPS.map((g) => {
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
            Payments needing attention <span className="muted">· {other.length}</span>
          </h3>
          <AlertRows alerts={other} base={base} />
        </div>
      )}
    </div>
  );
}

function Reconcile({ unmatched, matched, rows, feed, base, onMatch }: { unmatched: BankTransaction[]; matched: BankTransaction[]; rows: TrancheRow[]; feed: { connected: boolean; lastSyncAt: string | null }; base: string; onMatch: (t: BankTransaction) => void }) {
  const label = (id: string | null | undefined) => {
    const r = rows.find((x) => x.id === id);
    return r ? `${r.recipient?.name ?? "Grantee"} · tranche ${r.seq}` : "—";
  };
  const proposed = new Set(unmatched.flatMap((b) => (b.proposals ?? []).map((p) => p.trancheId)));
  const waiting = rows.filter((r) => ["due", "ready"].includes(r.status) && !proposed.has(r.id));
  if (!feed.connected) {
    return (
      <div className="card">
        <EmptyState
          icon={Landmark}
          title="Bank feed not connected"
          actions={
            <Link to={`${base}/settings/mcp#connectors`} className="btn btn-secondary">
              Connect Mercury (read-only)
            </Link>
          }
        >
          Reconciliation matches payments you made outside Passport to tranches. It reads outbound transactions from Mercury and never moves money. You can still record an external payment by hand on the tranche.
        </EmptyState>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
      <section className="card" aria-labelledby="mercury-h">
        <div className="card-h">
          <h2 id="mercury-h" style={{ fontSize: "16px" }}>
            Mercury outbound transactions
          </h2>
          <span className="small muted">Read-only{feed.lastSyncAt ? ` · synced ${dateTime(feed.lastSyncAt)}` : ""}</span>
        </div>
        <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label="Mercury outbound transactions, scrollable">
          <table className="tbl" aria-label="Mercury outbound transactions">
            <thead>
              <tr>
                <th>Mercury transaction</th>
                <th className="num">Amount</th>
                <th>Proposed match</th>
                <th>Confidence</th>
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
                        <span className="nm">{b.counterpartyName ?? "Unknown counterparty"}</span>
                        <span className="small muted">
                          Posted {formatDate(b.postedAt)}
                          {b.memo ? ` · ${b.memo}` : ""}
                        </span>
                      </div>
                    </td>
                    <td className="num">{formatMinor(b.amountMinor, b.currency)}</td>
                    <td>{best ? label(best.trancheId) : <span className="muted">No match proposed</span>}</td>
                    <td>{best ? `${Math.round(best.score * 100)}%${best.ambiguous ? " · ambiguous" : ""}` : "—"}</td>
                    <td>
                      <button type="button" className="btn btn-sm btn-secondary" disabled={!b.proposals?.length} onClick={() => onMatch(b)}>
                        Match
                      </button>
                    </td>
                  </tr>
                );
              })}
              {matched.map((b) => (
                <tr key={b.id}>
                  <td>
                    <div className="ent">
                      <span className="nm">{b.counterpartyName ?? "Unknown counterparty"}</span>
                      <span className="small muted">Posted {formatDate(b.postedAt)}</span>
                    </div>
                  </td>
                  <td className="num">{formatMinor(b.amountMinor, b.currency)}</td>
                  <td>{label(b.matchedTrancheId)}</td>
                  <td>
                    <span className="bdg bdg-ok">
                      <CircleCheck className="ic" aria-hidden="true" />
                      Matched
                    </span>
                  </td>
                  <td className="small muted">{b.matchedAt ? formatDate(b.matchedAt) : ""}</td>
                </tr>
              ))}
              {!unmatched.length && !matched.length && (
                <tr>
                  <td colSpan={5} className="muted">
                    No outbound transactions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card" aria-labelledby="unmatched-h">
        <div className="card-h">
          <h3 id="unmatched-h">Unmatched tranches · {waiting.length}</h3>
        </div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {!waiting.length && <p className="muted small">Every tranche that is due has a proposed bank match or is paid through Passport.</p>}
          {waiting.map((r) => (
            <div key={r.id} className="row" style={{ justifyContent: "space-between", gap: "10px" }}>
              <div>
                <Link to={`${base}/awards/${r.awardId}/payments`} className="b">
                  {r.recipient?.name ?? "Grantee"}
                </Link>
                <div className="small muted">
                  Tranche {r.seq} · {formatMinor(r.amountMinor, r.currency)}
                </div>
              </div>
              <StatusBadge kind="tranche" status={r.status} />
            </div>
          ))}
          <p className="small muted">A match records the tranche as paid outside Passport. Passport checks the last four digits against the payee’s verified destination.</p>
        </div>
      </section>
    </div>
  );
}

const PAYMENT_SUBJECTS = ["tranche", "award", "disbursement", "payee"];

function PaymentsLedger({ events, personName }: { events: LedgerEvent[]; personName: (id: string) => string | undefined }) {
  const exportCsv = () =>
    downloadCsv(
      [["When (UTC)", "Who", "What", "Subject", "Subject id"], ...events.map((e) => [e.occurredAt, actorOf(e.actor, personName).name, describeEvent(e.eventType), e.subjectType, e.subjectId])],
      "payments-ledger.csv",
    );
  return (
    <section className="card" aria-labelledby="ledger-h">
      <div className="card-h">
        <div>
          <h2 id="ledger-h" style={{ fontSize: "16px" }}>
            Payments ledger
          </h2>
          <p className="small muted">Every release, hold, external payment and Passport event, append-only.</p>
        </div>
        <button type="button" className="btn btn-sm btn-secondary" onClick={exportCsv} disabled={!events.length}>
          <Download className="ic" aria-hidden="true" />
          Export CSV
        </button>
      </div>
      <div className="card-b">
        <ActivityTimeline events={events} personName={personName} when={(iso) => dateTime(iso)} compact={false} empty="No payment events yet." />
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
      <title>{`Payments — ${ws.name}`}</title>
      <FunderShell active="Payments">
        <main className="main">
          <PageHeader
            crumbs={[{ label: ws.name, to: base }, { label: "Payments" }]}
            title="Payments"
            meta={
              d ? (
                <>
                  <span>{formatMinor(d.center.totals.dueMinor)} due</span>
                  <span>·</span>
                  {facilitatedPayments ? (
                    <>
                      <span>{d.center.totals.releasable} ready to release</span>
                      <span>·</span>
                      <span>{d.center.totals.blocked} blocked</span>
                    </>
                  ) : (
                    <span>{d.center.totals.blocked} with a readiness check to fix</span>
                  )}
                </>
              ) : undefined
            }
          />
          {page.status === "loading" && <Loading label="Loading payments" />}
          {page.status === "error" && <ErrorBanner error={page.error} onRetry={page.reload} />}
          {d && (
            <>
              <ViewSwitch base={base} view={view} due={d.center.items.length} inFlight={flying.length + d.alerts.length} unmatched={d.bank.length} />
              {note && <Notice tone="ok" title={note} />}
              {!facilitatedPayments && <PaymentsOffNotice />}
              {!d.link.linked && (
                <HoldBanner
                  banner={{ cause: "passport_not_linked", tone: "neutral", title: "Connect Passport to pay", detail: "Awards, agreements and reporting work without it, but no payment can be released or recorded until this workspace is linked to Passport.", clears: "Clears when an admin connects Passport." }}
                  action={
                    passportFlags.linking ? (
                      <Link to={`${base}/settings/passport`} className="btn btn-secondary">
                        Connect Passport
                      </Link>
                    ) : undefined
                  }
                />
              )}
              {d.link.linked && unreachable && <HoldBanner banner={{ cause: "passport_unavailable", tone: "neutral", title: "Passport can’t be reached", detail: "Readiness shows Unknown until Passport is reachable; nothing is released in the meantime.", clears: "Retrying automatically." }} />}

              {view === "due" && (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.9fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    {!d.center.items.length && (
                      <div className="card">
                        <EmptyState icon={CircleCheck} title="Nothing is due">
                          Tranches appear here when an agreement is executed, a report is accepted or a scheduled date arrives.
                        </EmptyState>
                      </div>
                    )}
                    {d.center.items.map((item) => (
                      <DueItem key={item.tranche.id} item={item} row={d.rows.find((r) => r.id === item.tranche.id)} base={base} onChanged={changed} />
                    ))}
                    <p className="notice">
                      {facilitatedPayments
                        ? "Payments are released one at a time. Each release is confirmed by a person and paid through OpenGrants Passport to the payee’s verified destination."
                        : "Payments are recorded one at a time, by a person. Passport checks the last four digits you enter against the payee’s verified destination; a payment it cannot verify is kept as unverified."}
                    </p>
                  </div>
                  <aside style={{ display: "flex", flexDirection: "column", gap: "16px" }} aria-label="Upcoming payments and how readiness works">
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
                          In flight
                        </h2>
                        <div className="row" style={{ gap: "10px" }}>
                          <span className="small muted">{flying.length} with Passport</span>
                          <button type="button" className="btn btn-sm btn-secondary" onClick={page.reload}>
                            <RefreshCw className="ic" aria-hidden="true" />
                            Refresh
                          </button>
                        </div>
                      </div>
                      <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label="Payments in flight, scrollable">
                        <table className="tbl" aria-label="Payments in flight">
                          <thead>
                            <tr>
                              <th>Grantee</th>
                              <th>Tranche</th>
                              <th className="num">Amount</th>
                              <th>Released</th>
                              <th>Status</th>
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
                                <td>Tranche {r.seq}</td>
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
                                  Nothing is in flight.
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
                          Settled
                        </h2>
                      </div>
                      <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }} tabIndex={0} role="region" aria-label="Settled payments, scrollable">
                        <table className="tbl" aria-label="Settled payments">
                          <thead>
                            <tr>
                              <th>Grantee</th>
                              <th>Tranche</th>
                              <th className="num">Amount</th>
                              <th>How</th>
                              <th>Status</th>
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
                                <td>Tranche {r.seq}</td>
                                <td className="num">{formatMinor(r.amountMinor, r.currency)}</td>
                                <td>{r.mode === "resolve" ? "Paid outside Passport" : "Through Passport"}</td>
                                <td>{r.passportStatus === "unverified" ? <span className="pill-warn">Settled · unverified</span> : <StatusBadge kind="tranche" status={r.status} />}</td>
                              </tr>
                            ))}
                            {!settled.length && (
                              <tr>
                                <td colSpan={5} className="muted">
                                  No settled payments yet.
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
                          Alerts
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
                          Bank transactions to match
                        </h2>
                        <span className="small muted">Read-only from Mercury</span>
                      </div>
                      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {!d.bank.length && <p className="muted small">No unmatched outbound transactions.</p>}
                        {d.bank.map((b) => (
                          <div key={b.id} className="doc">
                            <span className="ft">TXN</span>
                            <div className="grow">
                              <div className="nm">
                                {b.counterpartyName ?? "Unknown counterparty"} · {formatMinor(b.amountMinor, b.currency)}
                              </div>
                              <div className="mt">
                                <span>Posted {formatDate(b.postedAt)}</span>
                                {b.memo && (
                                  <>
                                    <span>·</span>
                                    <span>{b.memo}</span>
                                  </>
                                )}
                                {b.proposals?.length ? (
                                  <>
                                    <span>·</span>
                                    <span>{b.proposals.length === 1 ? "1 proposed match" : `${b.proposals.length} proposed matches`}</span>
                                  </>
                                ) : null}
                              </div>
                            </div>
                            <button type="button" className="btn btn-sm btn-secondary" disabled={!b.proposals?.length} onClick={() => setMatching(b)}>
                              Match
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
                    changed("Matched. The tranche is recorded as paid outside Passport.");
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
