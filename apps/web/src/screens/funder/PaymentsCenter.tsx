// SPDX-License-Identifier: AGPL-3.0-only
// The Payments center. "Due" lists every tranche waiting on a person with its readiness; a release
// is always one tranche at a time, confirmed by a person. "In flight" follows released payments to
// settlement and gathers the alerts: pending destination changes, level drops, unverified
// externally paid tranches, and bank transactions waiting to be matched.
import { useState } from "react";
import { Link } from "react-router";
import { Banknote, CircleCheck, Landmark, Send, RefreshCw } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { BankTransaction, PaymentAlert, PaymentsCenterItem, TrancheRow } from "../../api/funderMoney.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { checklistOf, destinationLabel, HoldBanner, RecordExternalDialog, ReleaseDialog, releaseBlockedReason } from "../../components/payments.tsx";
import { FunderShell } from "../../components/shells.tsx";
import { LevelBadge, StatusBadge } from "../../components/status.tsx";
import { EmptyState, ErrorBanner, Field, Loading, Notice, PageHeader, ReadinessChecklist } from "../../components/ui.tsx";
import { formatDate, formatMinor } from "../../lib/format.ts";
import { dateTime } from "./shared.tsx";

const ALERT_TONE = { warn: "bnr-warn", danger: "bnr-dng", neutral: "bnr-neu" } as const;

function ViewSwitch({ base, view, due, inFlight }: { base: string; view: "due" | "in-flight"; due: number; inFlight: number }) {
  return (
    <nav className="tabs" aria-label="Payments views">
      <Link to={`${base}/payments/due`} className={`tab${view === "due" ? " on" : ""}`} aria-current={view === "due" ? "page" : undefined}>
        Due <span className="n">{due}</span>
      </Link>
      <Link to={`${base}/payments/in-flight`} className={`tab${view === "in-flight" ? " on" : ""}`} aria-current={view === "in-flight" ? "page" : undefined}>
        In flight &amp; alerts <span className="n">{inFlight}</span>
      </Link>
    </nav>
  );
}

function DueItem({ item, row, base, onChanged }: { item: PaymentsCenterItem; row: TrancheRow | undefined; base: string; onChanged: (note: string) => void }) {
  const [dialog, setDialog] = useState<"release" | "external" | null>(null);
  const t = item.tranche;
  const name = row?.recipient?.name ?? "Grantee";
  const blocked = releaseBlockedReason(item);
  return (
    <section className="card" aria-labelledby={`due-${t.id}`}>
      <div className="card-h">
        <div className="col" style={{ gap: "4px" }}>
          <div className="row wrap">
            <h3 id={`due-${t.id}`}>{name}</h3>
            <LevelBadge level={row?.recipient?.verificationLevel} />
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
        <button type="button" className="btn btn-primary" disabled={blocked !== null} onClick={() => setDialog("release")}>
          <Send className="ic" aria-hidden="true" />
          Release
        </button>
        <button type="button" className="btn btn-secondary" disabled={t.status === "held"} onClick={() => setDialog("external")}>
          <Banknote className="ic" aria-hidden="true" />
          Record external payment
        </button>
        {blocked && <span className="help">{blocked}</span>}
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

function Alerts({ alerts, base }: { alerts: PaymentAlert[]; base: string }) {
  if (!alerts.length) return <p className="muted small">No alerts. Destination changes, level drops and failed payments appear here.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
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
    </div>
  );
}

export function PaymentsCenter({ view }: { view: "due" | "in-flight" }) {
  const ws = useWorkspace("funder");
  const base = `/w/${ws.handle}`;
  const [note, setNote] = useState<string | null>(null);
  const [matching, setMatching] = useState<BankTransaction | null>(null);
  const page = useApiQuery(async (api) => {
    const [center, rows, alerts, bank, link] = await Promise.all([api.paymentsReadiness(), api.listTranches(), api.paymentAlerts(), api.listBankTransactions({ matched: false }), api.passportStatus(ws.id)]);
    return { center, rows, alerts, bank, link };
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
                  <span>{d.center.totals.releasable} ready to release</span>
                  <span>·</span>
                  <span>{d.center.totals.blocked} blocked</span>
                </>
              ) : undefined
            }
          />
          {page.status === "loading" && <Loading label="Loading payments" />}
          {page.status === "error" && <ErrorBanner error={page.error} onRetry={page.reload} />}
          {d && (
            <>
              <ViewSwitch base={base} view={view} due={d.center.items.length} inFlight={flying.length + d.alerts.length} />
              {note && <Notice tone="ok" title={note} />}
              {!d.link.linked && (
                <HoldBanner
                  banner={{ cause: "passport_not_linked", tone: "neutral", title: "Connect Passport to pay", detail: "Awards, agreements and reporting work without it, but no payment can be released or recorded until this workspace is linked to Passport.", clears: "Clears when an admin connects Passport." }}
                  action={
                    <Link to={`${base}/settings/passport`} className="btn btn-secondary">
                      Connect Passport
                    </Link>
                  }
                />
              )}
              {d.link.linked && unreachable && <HoldBanner banner={{ cause: "passport_unavailable", tone: "neutral", title: "Passport can’t be reached", detail: "Readiness shows Unknown until Passport is reachable; nothing is released in the meantime.", clears: "Retrying automatically." }} />}

              {view === "due" && (
                <>
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
                  <p className="notice">Payments are released one at a time. Each release is confirmed by a person and paid through OpenGrants Passport to the payee’s verified destination.</p>
                </>
              )}

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
