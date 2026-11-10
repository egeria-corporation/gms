// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import {
  BadgeCheck,
  Check,
  CircleCheck,
  CircleDashed,
  Clock,
  Download,
  ExternalLink,
  Link as LinkIcon,
  Loader,
  Lock,
  Mail,
  RefreshCw,
  Send,
  Shield,
  ShieldCheck,
  TriangleExclamationPoint,
  Users,
} from "lucide-react";
import { FunderShell } from "../../components/shells.tsx";

export default function PaymentsInFlight() {
  return (
    <>
      <title>{"Payments center — In flight, Alerts, Reconcile — Riverbend funder workspace"}</title>
      <FunderShell active="Payments">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/riverbend">Riverbend</Link>
            <span>›</span>
            <Link to="/w/riverbend/payments/due">Payments</Link>
            <span>›</span>
            <span>In flight</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Payments center</h1>
              </div>
              <div className="meta">
                <span>1 payment in flight · $75,000</span>
                <span>·</span>
                <span>2 alerts</span>
                <span>·</span>
                <span>1 unmatched transaction</span>
              </div>
            </div>
            <div className="actions">
              <button className="btn btn-secondary">
                <RefreshCw className="ic" aria-hidden="true" />
                Refresh from Passport
              </button>
              <button className="btn btn-secondary">
                <Download className="ic" aria-hidden="true" />
                Export ledger
              </button>
            </div>
          </div>
          <div className="card" style={{ padding: "12px 20px", display: "flex", alignItems: "center", gap: "0", flexWrap: "wrap" }}>
            <div className="row" style={{ gap: "8px", paddingRight: "20px", borderRight: "1px solid #D6DEDE" }}>
              <ShieldCheck className="ic ic-md" aria-hidden="true" style={{ color: "#145450" }} />
              <div>
                <div className="stat-l">Passport</div>
                <div className="row b" style={{ gap: "5px", color: "#0B5E47" }}>
                  <Check className="ic ic-sm" aria-hidden="true" />
                  Connected
                </div>
              </div>
            </div>
            <div style={{ padding: "0 20px", borderRight: "1px solid #D6DEDE" }}>
              <div className="stat-l">Source account</div>
              <div className="b">Riverbend Operating · Mercury •••• 5520</div>
            </div>
            <div style={{ padding: "0 20px", borderRight: "1px solid #D6DEDE" }}>
              <div className="stat-l">Wallet balance</div>
              <div className="b" style={{ fontVariantNumeric: "tabular-nums" }}>
                $337,000{" "}
                <span className="xs muted" style={{ fontWeight: 400 }}>
                  after $75,000 release
                </span>
              </div>
            </div>
            <div style={{ padding: "0 20px", borderRight: "1px solid #D6DEDE" }}>
              <div className="stat-l">Default rail</div>
              <div className="b">ACH (same-day)</div>
            </div>
            <div style={{ padding: "0 20px" }}>
              <div className="stat-l">Cooling-off floor</div>
              <div className="b">10 business days</div>
            </div>
            <Link to="/w/riverbend/settings/mcp" className="btn btn-secondary btn-sm" style={{ marginLeft: "auto" }}>
              Open Passport console
              <ExternalLink className="ic ic-sm" aria-hidden="true" />
            </Link>
          </div>
          <div className="tabs" role="tablist" aria-label="Payments views">
            <Link to="/w/riverbend/payments/due" className="tab" role="tab">
              Due<span className="n">2</span>
            </Link>
            <a href="#alerts" className="tab" role="tab">
              Alerts
              <span className="n" style={{ background: "#FCEFD3", color: "#7A4A00" }}>
                2
              </span>
            </a>
            <Link to="/w/riverbend/payments/in-flight" className="tab on" role="tab" aria-selected="true">
              In flight<span className="n">1</span>
            </Link>
            <a href="#reconcile" className="tab" role="tab">
              Reconcile<span className="n">1</span>
            </a>
            <a href="#ledger" className="tab" role="tab">
              Ledger
            </a>
          </div>
          <div className="card">
            <div className="card-h">
              <div className="row" style={{ gap: "12px", flexWrap: "wrap" }}>
                <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="b" style={{ color: "#0D2A43", fontSize: "15px" }}>
                  Alder Creek Family Services
                </Link>
                <span className="lvl lvl-3">
                  <Shield className="ic" aria-hidden="true" />
                  L3
                </span>
                <span className="small muted">
                  <span className="mono">awd_01J2Q7</span> · tranche 1 of 3 · $75,000 · ACH same-day · River City Credit Union •••• 4821
                </span>
              </div>
              <span className="bdg bdg-ok bdg-lg">
                <BadgeCheck className="ic" aria-hidden="true" />
                Settled
              </span>
            </div>
            <div
              className="card-b"
              style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)", gap: "24px", alignItems: "start" }}
            >
              <div className="tl">
                <div className="tl-i tl-person">
                  <span className="dot">
                    <Send className="ic" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="what">Released · readiness 7 of 7 re-checked</div>
                    <div className="who">
                      <span className="av av-sm av-n">ML</span>Marcus Lee (Finance) · May 25, 2027 9:12 AM PT
                    </div>
                  </div>
                </div>
                <div className="tl-i tl-passport">
                  <span className="dot">
                    <BadgeCheck className="ic" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="what">
                      Passport created disbursement <span className="mono">psp_tr_7f3a</span>
                    </div>
                    <div className="who">Passport · 9:12 AM · payee credential verified at creation</div>
                    <details className="payload">
                      <summary>Payload</summary>
                      <pre>
                        {"{"}
                        "id":"psp_tr_7f3a","amount":7500000,"currency":"USD","rail":"ach_same_day","destination":"payee_cred_01HZ…","memo":"Riverbend
                        CHG27 · awd_01J2Q7 · 1/3"{"}"}
                      </pre>
                    </details>
                  </div>
                </div>
                <div className="tl-i">
                  <span className="dot" style={{ background: "#E3EDFB", color: "#1E4F8F" }}>
                    <Send className="ic" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="what">Initiated on ACH same-day</div>
                    <div className="who">Bank network · 9:14 AM · trace recorded in Passport</div>
                  </div>
                </div>
                <div className="tl-i tl-ok">
                  <span className="dot">
                    <BadgeCheck className="ic" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="what">Settled · $75,000 at River City Credit Union •••• 4821</div>
                    <div className="who">Passport · 3:41 PM · award disbursed updated to $75,000</div>
                  </div>
                </div>
                <div className="tl-i">
                  <span className="dot" style={{ background: "#EEF3F3" }}>
                    <Mail className="ic" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="what">“Payment sent” email queued to Alder Creek</div>
                    <div className="who">
                      System · 3:41 PM ·<Link to="/preview/email/payment-sent">Preview email</Link>· bank name + last4 only
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div
                  className="card"
                  style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px", background: "#F7FAFA" }}
                >
                  <span className="stat-l">Tranche state sequence</span>
                  <div className="stp" style={{ fontSize: "12px" }}>
                    <span className="s done">
                      <span className="n">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </span>
                      Releasing
                    </span>
                    <span className="ln done"></span>
                    <span className="s done">
                      <span className="n">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </span>
                      Initiated
                    </span>
                    <span className="ln done"></span>
                    <span className="s done">
                      <span className="n">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </span>
                      Settled
                    </span>
                  </div>
                  <div className="row" style={{ gap: "6px", flexWrap: "wrap" }}>
                    <span className="bdg bdg-prog">
                      <Loader className="ic" aria-hidden="true" />
                      Releasing
                    </span>
                    <span className="muted">→</span>
                    <span className="bdg bdg-info">
                      <Send className="ic" aria-hidden="true" />
                      Initiated
                    </span>
                    <span className="muted">→</span>
                    <span className="bdg bdg-ok">
                      <BadgeCheck className="ic" aria-hidden="true" />
                      Settled
                    </span>
                  </div>
                  <p className="xs muted">
                    A tranche moving to Settled animates once (0.25s) in the schedule table; the ledger row is appended at the same moment.
                  </p>
                </div>
                <dl className="kv">
                  <dt>Passport id</dt>
                  <dd>
                    <span className="mono">psp_tr_7f3a</span>
                  </dd>
                  <dt>Rail</dt>
                  <dd>ACH same-day</dd>
                  <dt>Destination</dt>
                  <dd>River City Credit Union •••• 4821</dd>
                  <dt>Memo</dt>
                  <dd>Riverbend CHG27 · awd_01J2Q7 · 1/3</dd>
                  <dt>Ledger</dt>
                  <dd>
                    <a href="#ledger">Entry L-2027-0412</a>
                  </dd>
                </dl>
                <div className="row" style={{ gap: "8px" }}>
                  <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="btn btn-secondary btn-sm">
                    Open award
                  </Link>
                  <Link to="/preview/email/payment-sent" className="btn btn-ghost btn-sm">
                    View notification
                  </Link>
                </div>
              </div>
            </div>
          </div>
          <div id="alerts" style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" }}>
            <span className="eyebrow">Alerts tab · 2 open</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "16px", alignItems: "start" }}>
              <div className="card" style={{ borderColor: "#E9C77D" }}>
                <div className="card-h">
                  <h3>Destination change pending</h3>
                  <span className="bdg bdg-warn">
                    <Clock className="ic" aria-hidden="true" />
                    Freeze until Jun 3
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
                  <div className="row" style={{ gap: "8px" }}>
                    <Link to="/w/riverbend/grantees/org_alder-creek" className="b" style={{ color: "#0D2A43" }}>
                      Harbor Light Shelter
                    </Link>
                    <span className="lvl lvl-3">
                      <Shield className="ic" aria-hidden="true" />
                      L3
                    </span>
                    <span className="pay pay-pending">
                      <Clock className="ic" aria-hidden="true" />
                      Pending change
                    </span>
                  </div>
                  <dl className="kv" style={{ gridTemplateColumns: "90px minmax(0, 1fr)", fontSize: "12px" }}>
                    <dt>From</dt>
                    <dd>Harbor Community Bank •••• 2210</dd>
                    <dt>To</dt>
                    <dd>Northwest Federal CU •••• 9034</dd>
                    <dt>Requested</dt>
                    <dd>May 20, 2027 · in Passport by Harbor Light’s representative</dd>
                    <dt>Freeze until</dt>
                    <dd>
                      <b>Jun 3, 2027</b> (10 business days)
                    </dd>
                    <dt>Affects</dt>
                    <dd>
                      Tranche 2 · $38,000 ·{" "}
                      <span className="bdg bdg-warn">
                        <Lock className="ic" aria-hidden="true" />
                        Held
                      </span>
                    </dd>
                  </dl>
                  <p className="xs muted">
                    The GMS never edits a destination. The grantee manages it in Passport; the freeze protects against account-takeover
                    redirection.
                  </p>
                  <div className="row" style={{ gap: "8px" }}>
                    <Link to="/w/riverbend/communications" className="btn btn-secondary btn-sm">
                      Contact grantee
                    </Link>
                    <button className="btn btn-ghost btn-sm">
                      View in Passport
                      <ExternalLink className="ic ic-sm" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
              <div className="card" style={{ borderColor: "#E9C77D" }}>
                <div className="card-h">
                  <h3>Level downgrade</h3>
                  <span className="bdg bdg-warn">
                    <TriangleExclamationPoint className="ic" aria-hidden="true" />
                    L2 → L1
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
                  <div className="row" style={{ gap: "8px" }}>
                    <Link to="/w/riverbend/grantees/org_alder-creek" className="b" style={{ color: "#0D2A43" }}>
                      Copper Valley Clinic
                    </Link>
                    <span className="lvl lvl-1">L1</span>
                  </div>
                  <dl className="kv" style={{ gridTemplateColumns: "90px minmax(0, 1fr)", fontSize: "12px" }}>
                    <dt>Reason</dt>
                    <dd>Attestation expired Apr 30, 2027; documents not renewed</dd>
                    <dt>Affects</dt>
                    <dd>Application app_01HZX9 (Revision requested) · no active award</dd>
                    <dt>Restores when</dt>
                    <dd>Copper Valley re-attests in Passport (L2) and verifies a payee (L3)</dd>
                  </dl>
                  <p className="xs muted">
                    Any future tranche to this organization fails the “Passport level L3” readiness check until restored.
                  </p>
                  <div className="row" style={{ gap: "8px" }}>
                    <Link to="/w/riverbend/communications" className="btn btn-secondary btn-sm">
                      Send renewal reminder
                    </Link>
                    <Link to="/w/riverbend/applications/app_01HZX4" className="btn btn-ghost btn-sm">
                      Open application
                    </Link>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Inactive organizations</h3>
                  <span className="bdg bdg-ok">
                    <CircleCheck className="ic" aria-hidden="true" />
                    None
                  </span>
                </div>
                <div className="card-b empty" style={{ padding: "28px 16px" }}>
                  <Users className="ic" aria-hidden="true" />
                  <h3>No inactive grantees</h3>
                  <p>
                    Passport flags an organization inactive when its registration lapses or it dissolves. None of Riverbend’s 11 grantees
                    are flagged.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div
            id="reconcile"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)",
              gap: "16px",
              marginTop: "8px",
              alignItems: "start",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <span className="eyebrow">Reconcile tab · resolve mode</span>
              <div className="card">
                <div className="card-h">
                  <div>
                    <h3>Mercury outbound transactions</h3>
                    <p className="small muted">Imported from Mercury •••• 5520 · last sync 4:02 PM · proposed matches need confirmation</p>
                  </div>
                  <button className="btn btn-secondary btn-sm">
                    <RefreshCw className="ic" aria-hidden="true" />
                    Sync
                  </button>
                </div>
                <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
                  <table className="tbl tbl-compact">
                    <thead>
                      <tr>
                        <th>Mercury transaction</th>
                        <th className="num">Amount</th>
                        <th></th>
                        <th>Proposed match</th>
                        <th>Confidence</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <div className="ent">
                            <span className="nm">ALDER CREEK FAMILY SERV</span>
                            <span className="xs muted">May 25 · ACH debit · ref MX-88213</span>
                          </div>
                        </td>
                        <td className="num b">$75,000.00</td>
                        <td>
                          <LinkIcon className="ic" aria-hidden="true" style={{ color: "#4A5C5A" }} />
                        </td>
                        <td>
                          <div className="ent">
                            <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="nm">
                              awd_01J2Q7 · tranche 1
                            </Link>
                            <span className="xs muted">Alder Creek Family Services · Settled May 25 · psp_tr_7f3a</span>
                          </div>
                        </td>
                        <td>
                          <span className="bdg bdg-ok">
                            <Check className="ic" aria-hidden="true" />
                            High
                          </span>
                        </td>
                        <td>
                          <div className="row" style={{ gap: "6px", justifyContent: "flex-end" }}>
                            <button className="btn btn-sm btn-primary">Confirm match</button>
                            <button className="btn btn-sm btn-ghost">Change</button>
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          <div className="ent">
                            <span className="nm">PASSPORT FUNDING TOPUP</span>
                            <span className="xs muted">May 18 · ACH debit · ref MX-88102</span>
                          </div>
                        </td>
                        <td className="num b">$200,000.00</td>
                        <td>
                          <LinkIcon className="ic" aria-hidden="true" style={{ color: "#4A5C5A" }} />
                        </td>
                        <td>
                          <div className="ent">
                            <span className="nm">Passport wallet top-up</span>
                            <span className="xs muted">Not a tranche · funds the source wallet</span>
                          </div>
                        </td>
                        <td>
                          <span className="bdg bdg-ok">
                            <Check className="ic" aria-hidden="true" />
                            High
                          </span>
                        </td>
                        <td>
                          <div className="row" style={{ gap: "6px", justifyContent: "flex-end" }}>
                            <button className="btn btn-sm btn-secondary">Mark as top-up</button>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <span className="eyebrow">Unmatched tranches · 1</span>
              <div className="card">
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
                  <div className="row" style={{ justifyContent: "space-between", gap: "8px" }}>
                    <div>
                      <div className="b">Harbor Light Shelter · 2026 · tranche 1</div>
                      <div className="small muted">$57,000 · External · recorded by Marcus Lee Jul 15, 2026</div>
                    </div>
                    <span className="bdg bdg-neutral">
                      <CircleDashed className="ic" aria-hidden="true" />
                      Unmatched
                    </span>
                  </div>
                  <p className="small muted">
                    No Mercury transaction within ±3 days of the recorded date matches this amount. Paid before the bank feed was connected.
                  </p>
                  <div className="row" style={{ gap: "8px" }}>
                    <button className="btn btn-secondary btn-sm">Match manually</button>
                    <button className="btn btn-ghost btn-sm">Mark reconciled offline</button>
                  </div>
                </div>
              </div>
              <span className="eyebrow" id="ledger" style={{ marginTop: "6px" }}>
                Ledger tab
              </span>
              <div
                className="card"
                style={{
                  padding: "14px 20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  flexWrap: "wrap",
                }}
              >
                <div className="small">
                  <b>412 entries</b> · FY2027 · last entry L-2027-0412 (Alder Creek $75,000 settled)
                </div>
                <div className="row" style={{ gap: "8px" }}>
                  <button className="btn btn-secondary btn-sm">
                    <Download className="ic" aria-hidden="true" />
                    Export CSV
                  </button>
                  <button className="btn btn-ghost btn-sm">CommonGrants JSON</button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </FunderShell>
    </>
  );
}
