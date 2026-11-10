// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import {
  Banknote,
  Calendar,
  Check,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Download,
  ExternalLink,
  Info,
  Lock,
  Plus,
  Send,
  Shield,
  ShieldCheck,
  TriangleExclamationPoint,
  X,
} from "lucide-react";
import { FunderShell } from "../../components/shells.tsx";

export default function PaymentsDue() {
  return (
    <>
      <title>{"Payments center — Due — Riverbend funder workspace"}</title>
      <FunderShell active="Payments">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/riverbend">Riverbend</Link>
            <span>›</span>
            <span>Payments</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Payments center</h1>
              </div>
              <div className="meta">
                <span>$113,000 due in the next 30 days</span>
                <span>·</span>
                <span>1 ready to release</span>
                <span>·</span>
                <span>2 blocked</span>
              </div>
            </div>
            <div className="actions">
              <button className="btn btn-secondary">
                <Plus className="ic" aria-hidden="true" />
                Record external payment
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
                $412,000
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
            <Link to="/w/riverbend/payments/due" className="tab on" role="tab" aria-selected="true">
              Due<span className="n">2</span>
            </Link>
            <Link to="/w/riverbend/payments/in-flight" className="tab" role="tab">
              Alerts
              <span className="n" style={{ background: "#FCEFD3", color: "#7A4A00" }}>
                2
              </span>
            </Link>
            <Link to="/w/riverbend/payments/in-flight" className="tab" role="tab">
              In flight<span className="n">1</span>
            </Link>
            <Link to="/w/riverbend/payments/in-flight" className="tab" role="tab">
              Reconcile<span className="n">1</span>
            </Link>
            <Link to="/w/riverbend/payments/in-flight" className="tab" role="tab">
              Ledger
            </Link>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: "20px", alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", minWidth: "0" }}>
              <div className="filterbar">
                <button className="fchip on">
                  Window:<span className="v">Due now + next 30 days</span>
                </button>
                <button className="fchip">
                  Program
                  <ChevronDown className="ic ic-sm" aria-hidden="true" />
                </button>
                <button className="fchip">
                  Readiness
                  <ChevronDown className="ic ic-sm" aria-hidden="true" />
                </button>
                <button className="fchip">
                  Mode
                  <ChevronDown className="ic ic-sm" aria-hidden="true" />
                </button>
              </div>
              <div className="bulkbar" role="status">
                <span>1 selected · $75,000</span>
                <span style={{ opacity: ".4" }}>|</span>
                <Link
                  to="/w/riverbend/payments/in-flight"
                  className="btn"
                  style={{ background: "#00CC99", color: "#0D2A43", borderColor: "#00CC99" }}
                >
                  <Send className="ic" aria-hidden="true" />
                  Release selected
                </Link>
                <button className="btn">Hold</button>
                <button className="btn">Export</button>
                <span className="small" style={{ marginLeft: "8px", opacity: ".8" }}>
                  Readiness is re-checked at release; blocked rows cannot be selected.
                </span>
                <button className="iconbtn" style={{ marginLeft: "auto", color: "#fff" }} aria-label="Clear selection">
                  <X className="ic" aria-hidden="true" />
                </button>
              </div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: "36px" }}>
                        <span className="ck" role="checkbox" aria-checked="mixed" aria-label="Select all ready"></span>
                      </th>
                      <th>Grantee</th>
                      <th>Award</th>
                      <th>Tranche</th>
                      <th className="num">Amount</th>
                      <th>Due</th>
                      <th>Readiness</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="sel">
                      <td>
                        <span className="ck on" role="checkbox" aria-checked="true" aria-label="Select Alder Creek tranche 1"></span>
                      </td>
                      <td>
                        <div className="ent">
                          <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="nm">
                            Alder Creek Family Services
                          </Link>
                          <div className="sub">
                            <span className="lvl lvl-3">
                              <Shield className="ic" aria-hidden="true" />
                              L3
                            </span>
                            <span className="pay pay-active">
                              <Check className="ic" aria-hidden="true" />
                              Payee active
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="mono">
                          awd_01J2Q7
                        </Link>
                      </td>
                      <td>1 of 3</td>
                      <td className="num b">$75,000</td>
                      <td>May 24</td>
                      <td>
                        <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="row b" style={{ gap: "5px", color: "#0B5E47" }}>
                          <CircleCheck className="ic" aria-hidden="true" />
                          7/7 ready
                        </Link>
                      </td>
                      <td>
                        <span className="bdg bdg-ok">
                          <CircleCheck className="ic" aria-hidden="true" />
                          Ready
                        </span>
                      </td>
                      <td>
                        <Link to="/w/riverbend/payments/in-flight" className="btn btn-sm btn-primary">
                          Release
                        </Link>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <span
                          className="ck"
                          role="checkbox"
                          aria-checked="false"
                          aria-disabled="true"
                          aria-label="Harbor Light tranche 2 cannot be selected: blocked"
                          style={{ opacity: ".4" }}
                        ></span>
                      </td>
                      <td>
                        <div className="ent">
                          <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="nm">
                            Harbor Light Shelter
                          </Link>
                          <div className="sub">
                            <span className="lvl lvl-3">
                              <Shield className="ic" aria-hidden="true" />
                              L3
                            </span>
                            <span className="pay pay-pending">
                              <Clock className="ic" aria-hidden="true" />
                              Pending change
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="mono">
                          awd_01HQ22
                        </Link>
                      </td>
                      <td>2 of 3</td>
                      <td className="num b">$38,000</td>
                      <td>
                        May 20{" "}
                        <span className="xs" style={{ color: "#7A4A00" }}>
                          · 5 days late
                        </span>
                      </td>
                      <td>
                        <div className="ent">
                          <Link to="/w/riverbend/payments/in-flight" className="row b" style={{ gap: "5px", color: "#7A4A00" }}>
                            <TriangleExclamationPoint className="ic" aria-hidden="true" />
                            5/7 — 2 blocked
                          </Link>
                          <span className="xs muted">Pending destination change · freeze until Jun 3</span>
                        </div>
                      </td>
                      <td>
                        <span className="bdg bdg-warn">
                          <Lock className="ic" aria-hidden="true" />
                          Held
                        </span>
                      </td>
                      <td>
                        <div className="row" style={{ gap: "6px" }}>
                          <button className="btn btn-sm btn-secondary" disabled>
                            <Lock className="ic ic-sm" aria-hidden="true" />
                            Release
                          </button>
                          <Link to="/w/riverbend/payments/in-flight" className="small b">
                            Why?
                          </Link>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <span
                          className="ck"
                          role="checkbox"
                          aria-checked="false"
                          aria-disabled="true"
                          aria-label="Lakeside tranche 1 cannot be selected: blocked"
                          style={{ opacity: ".4" }}
                        ></span>
                      </td>
                      <td>
                        <div className="ent">
                          <Link to="/w/riverbend/awards/awd_01J2Q7/agreement" className="nm">
                            Lakeside Senior Center
                          </Link>
                          <div className="sub">
                            <span className="lvl lvl-2">L2</span>
                            <span className="pay pay-active">
                              <Check className="ic" aria-hidden="true" />
                              Payee active
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Link to="/w/riverbend/awards/awd_01J2Q7/agreement" className="mono">
                          awd_01J2R1
                        </Link>
                      </td>
                      <td>1 of 2</td>
                      <td className="num b">$35,000</td>
                      <td>
                        <span className="muted">On execution</span>
                      </td>
                      <td>
                        <div className="ent">
                          <Link to="/w/riverbend/awards/awd_01J2Q7/agreement" className="row b" style={{ gap: "5px", color: "#7A4A00" }}>
                            <TriangleExclamationPoint className="ic" aria-hidden="true" />
                            6/7 — 1 blocked
                          </Link>
                          <span className="xs muted">Agreement not executed · Sent May 19</span>
                        </div>
                      </td>
                      <td>
                        <span className="bdg bdg-neutral">
                          <Calendar className="ic" aria-hidden="true" />
                          Scheduled
                        </span>
                      </td>
                      <td>
                        <div className="row" style={{ gap: "6px" }}>
                          <button className="btn btn-sm btn-secondary" disabled>
                            <Lock className="ic ic-sm" aria-hidden="true" />
                            Release
                          </button>
                          <Link to="/w/riverbend/awards/awd_01J2Q7/agreement" className="small b">
                            Why?
                          </Link>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    padding: "10px 16px",
                    borderTop: "1px solid #D6DEDE",
                    fontSize: "12px",
                    color: "#4A5C5A",
                  }}
                >
                  <span>3 tranches · $148,000 in window · $75,000 releasable now</span>
                  <span className="row" style={{ gap: "6px" }}>
                    <Info className="ic ic-sm" aria-hidden="true" />
                    Blocked rows explain why in the Readiness column; nothing pays without all checks passing.
                  </span>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px", marginTop: "8px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span className="eyebrow">State · Passport not connected</span>
                  <div className="card" style={{ display: "flex", flexDirection: "column" }}>
                    <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <div className="row" style={{ gap: "10px" }}>
                        <Shield className="ic ic-md" aria-hidden="true" style={{ color: "#4A5C5A" }} />
                        <h3>Passport is not connected</h3>
                      </div>
                      <p className="small">
                        Connect Riverbend’s Passport funder account to release payments from here. Until then the Payments center runs in{" "}
                        <b>resolve mode only</b>: you can still record external payments you make from your own bank and reconcile them
                        against the schedule.
                      </p>
                      <ul className="small muted" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <li className="row" style={{ gap: "6px" }}>
                          <Check className="ic ic-sm" aria-hidden="true" />
                          Verified payee destinations from grantees’ Passport records
                        </li>
                        <li className="row" style={{ gap: "6px" }}>
                          <Check className="ic ic-sm" aria-hidden="true" />
                          Readiness checks, holds and freeze windows enforced at release
                        </li>
                        <li className="row" style={{ gap: "6px" }}>
                          <Check className="ic ic-sm" aria-hidden="true" />
                          Settlement status and “payment sent” notices
                        </li>
                      </ul>
                      <div className="row" style={{ gap: "10px" }}>
                        <Link to="/onboarding/funder" className="btn btn-primary">
                          Connect Passport
                        </Link>
                        <button className="btn btn-ghost">Record external payment</button>
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span className="eyebrow">State · Mercury not connected</span>
                  <div className="card" style={{ display: "flex", flexDirection: "column" }}>
                    <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <div className="row" style={{ gap: "10px" }}>
                        <Banknote className="ic ic-md" aria-hidden="true" style={{ color: "#4A5C5A" }} />
                        <h3>Bank feed not connected</h3>
                      </div>
                      <p className="small">
                        Reconcile matches outbound Mercury transactions to tranches automatically. Without the feed, external payments are
                        matched by hand from a CSV you upload.
                      </p>
                      <dl className="kv" style={{ fontSize: "12px" }}>
                        <dt>Unmatched tranches</dt>
                        <dd>1 (Harbor Light 2026 · tranche 1 · external)</dd>
                        <dt>Last import</dt>
                        <dd>Never</dd>
                      </dl>
                      <div className="row" style={{ gap: "10px" }}>
                        <Link to="/w/riverbend/settings/mcp" className="btn btn-secondary">
                          Connect Mercury
                        </Link>
                        <button className="btn btn-ghost">Upload bank CSV</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <aside style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="card">
                <div className="card-h">
                  <h3>Next 30 days</h3>
                  <span className="small muted">to Jun 24</span>
                </div>
                <ul style={{ display: "flex", flexDirection: "column" }}>
                  <li
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "10px",
                      padding: "10px 20px",
                      borderBottom: "1px solid #EEF3F3",
                      fontSize: "13px",
                    }}
                  >
                    <div>
                      <div className="b">May 24 · Alder Creek Family Services</div>
                      <div className="small muted">Tranche 1 · on execution</div>
                    </div>
                    <div className="num b">$75,000</div>
                  </li>
                  <li
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "10px",
                      padding: "10px 20px",
                      borderBottom: "1px solid #EEF3F3",
                      fontSize: "13px",
                    }}
                  >
                    <div>
                      <div className="b">May 20 · Harbor Light Shelter</div>
                      <div className="small" style={{ color: "#7A4A00" }}>
                        Tranche 2 · held until Jun 3
                      </div>
                    </div>
                    <div className="num b">$38,000</div>
                  </li>
                  <li
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "10px",
                      padding: "10px 20px",
                      borderBottom: "1px solid #EEF3F3",
                      fontSize: "13px",
                    }}
                  >
                    <div>
                      <div className="b">On execution · Lakeside Senior Center</div>
                      <div className="small muted">Tranche 1 · agreement Sent</div>
                    </div>
                    <div className="num b">$35,000</div>
                  </li>
                  <li style={{ display: "flex", justifyContent: "space-between", gap: "10px", padding: "10px 20px", fontSize: "13px" }}>
                    <div>
                      <div className="b">Jun 15 · Northgate Housing Trust (2026)</div>
                      <div className="small muted">Tranche 2 · progress report in review</div>
                    </div>
                    <div className="num b">$50,000</div>
                  </li>
                </ul>
                <div className="card-f" style={{ justifyContent: "space-between" }}>
                  <span className="small muted">Total in window</span>
                  <span className="b">$198,000</span>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Readiness explained</h3>
                </div>
                <div className="card-b" style={{ paddingTop: "8px" }}>
                  <div className="rc">
                    <div className="rc-row rc-pass" style={{ borderTop: "0" }}>
                      <CircleCheck className="ic" aria-hidden="true" />
                      <div>
                        <div className="l">Pass</div>
                        <div className="r">Checked within the last minute and true.</div>
                      </div>
                      <span></span>
                    </div>
                    <div className="rc-row rc-fail">
                      <CircleX className="ic" aria-hidden="true" />
                      <div>
                        <div className="l">Fail</div>
                        <div className="r">Blocks release. The row says what clears it and when.</div>
                      </div>
                      <span></span>
                    </div>
                    <div className="rc-row rc-unk">
                      <CircleDashed className="ic" aria-hidden="true" />
                      <div>
                        <div className="l">Unknown</div>
                        <div className="r">Could not be checked (Passport unreachable). Treated as blocking, never as pass.</div>
                      </div>
                      <span></span>
                    </div>
                  </div>
                  <div className="divider" style={{ margin: "10px 0" }}></div>
                  <p className="small muted">
                    Seven checks run per tranche: agreement executed · Passport level L3 · payee destination active · no pending destination
                    change · no freeze window · funder source account funded · requirement conditions met.
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </main>
      </FunderShell>
    </>
  );
}
