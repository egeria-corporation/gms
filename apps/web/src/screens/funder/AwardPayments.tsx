// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import {
  BadgeCheck,
  Ban,
  Calendar,
  Check,
  Circle,
  CircleCheck,
  CircleX,
  Clock,
  Eye,
  Lock,
  Plus,
  Send,
  Settings,
  Shield,
  X,
} from "lucide-react";
import { FunderShell } from "../../components/shells.tsx";

export default function AwardPayments() {
  return (
    <>
      <title>{"Award detail — Payments — Riverbend funder workspace"}</title>
      <FunderShell active="Awards">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/riverbend">Riverbend</Link>
            <span>›</span>
            <Link to="/w/riverbend/awards/awd_01J2Q7/agreement">Awards</Link>
            <span>›</span>
            <span>awd_01J2Q7</span>
            <span>›</span>
            <span>Payments</span>
          </div>
          <div className="card">
            <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "0" }}>
                  <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
                    <Link to="/w/riverbend/grantees/org_alder-creek" className="b" style={{ fontSize: "15px", color: "#0D2A43" }}>
                      Alder Creek Family Services
                    </Link>
                    <span className="lvl lvl-3">
                      <Shield className="ic" aria-hidden="true" />
                      L3
                    </span>
                    <span className="pay pay-active">
                      <Check className="ic" aria-hidden="true" />
                      Payee active
                    </span>
                  </div>
                  <h1 style={{ fontSize: "20px" }}>Mobile Health Navigation for Rural Families</h1>
                  <div className="row small muted" style={{ gap: "10px", flexWrap: "wrap" }}>
                    <span className="mono">awd_01J2Q7</span>
                    <span>·</span>
                    <Link to="/w/riverbend/programs">Community Health 2027</Link>
                    <span>·</span>
                    <span>Agreement executed May 24, 2027</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
                  <span className="bdg bdg-ok bdg-lg">
                    <BadgeCheck className="ic" aria-hidden="true" />
                    Active
                  </span>
                  <span className="notice">
                    <BadgeCheck className="ic" aria-hidden="true" style={{ color: "#1E4F8F" }} />
                    Synced to Passport 2 min ago
                  </span>
                  <Link to="/w/alder-creek/grants/awd_01J2Q7" className="small b">
                    <Eye className="ic ic-sm" aria-hidden="true" /> View as applicant
                  </Link>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: "16px", alignItems: "stretch" }}>
                <div className="amounts">
                  <div>
                    <div className="stat-l">Awarded</div>
                    <div className="stat-v" style={{ fontSize: "24px" }}>
                      $150,000
                    </div>
                  </div>
                  <div>
                    <div className="stat-l">Disbursed</div>
                    <div className="stat-v" style={{ fontSize: "24px" }}>
                      $0
                    </div>
                    <div className="stat-d">$75,000 ready to release</div>
                  </div>
                  <div>
                    <div className="stat-l">Remaining</div>
                    <div className="stat-v" style={{ fontSize: "24px" }}>
                      $150,000
                    </div>
                  </div>
                </div>
                <div
                  className="card"
                  style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: "8px", justifyContent: "center" }}
                >
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="stat-l">Grant period</span>
                    <span className="small muted">Starts in 37 days</span>
                  </div>
                  <div className="mtr">
                    <div className="track">
                      <div className="fill" style={{ width: "0%" }}></div>
                    </div>
                    <div className="lbls">
                      <b>Jul 1, 2027</b>
                      <span>12 months</span>
                      <b>Jun 30, 2028</b>
                    </div>
                  </div>
                </div>
              </div>
              <div className="tabs" role="tablist" aria-label="Award sections">
                <Link to="/w/riverbend/awards/awd_01J2Q7/agreement" className="tab" role="tab">
                  Agreement
                </Link>
                <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="tab on" role="tab" aria-selected="true">
                  Payments<span className="n">3</span>
                </Link>
                <Link to="/w/riverbend/reporting" className="tab" role="tab">
                  Requirements<span className="n">2</span>
                </Link>
                <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="tab" role="tab">
                  Budget
                </Link>
                <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="tab" role="tab">
                  Amendments
                </Link>
                <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="tab" role="tab">
                  Documents<span className="n">5</span>
                </Link>
                <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="tab" role="tab">
                  Messages / Notes
                </Link>
                <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="tab" role="tab">
                  Activity
                </Link>
                <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="tab" role="tab">
                  Closeout
                </Link>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: "20px", alignItems: "start" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: "0" }}>
                  <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                    <div>
                      <h3>Payment schedule</h3>
                      <p className="small muted">
                        Three tranches · Passport ACH to River City Credit Union •••• 4821 · readiness is checked per tranche at release
                        time.
                      </p>
                    </div>
                    <div className="row" style={{ gap: "8px" }}>
                      <button className="btn btn-secondary btn-sm">
                        <Plus className="ic" aria-hidden="true" />
                        Add tranche
                      </button>
                      <button className="btn btn-secondary btn-sm">Edit schedule</button>
                    </div>
                  </div>
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th className="num">Amount</th>
                          <th>Condition</th>
                          <th>Due</th>
                          <th>Status</th>
                          <th>Mode</th>
                          <th>Passport id</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="sel">
                          <td className="b">1</td>
                          <td className="num b">$75,000</td>
                          <td>On execution</td>
                          <td>May 24, 2027</td>
                          <td>
                            <span className="bdg bdg-ok">
                              <CircleCheck className="ic" aria-hidden="true" />
                              Ready
                            </span>
                          </td>
                          <td>Passport ACH</td>
                          <td>
                            <span className="mono">psp_tr_7f3a…</span>
                          </td>
                          <td>
                            <div className="row" style={{ gap: "6px", justifyContent: "flex-end" }}>
                              <Link to="/w/riverbend/payments/due" className="btn btn-sm btn-primary">
                                Release
                              </Link>
                              <button className="btn btn-sm btn-ghost">Record external</button>
                              <button className="btn btn-sm btn-ghost">Hold</button>
                              <button className="btn btn-sm btn-ghost" style={{ color: "#9B1C1C" }}>
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                        <tr>
                          <td className="b">2</td>
                          <td className="num b">$60,000</td>
                          <td>Interim report accepted</td>
                          <td>Dec 15, 2027</td>
                          <td>
                            <span className="bdg bdg-neutral">
                              <Calendar className="ic" aria-hidden="true" />
                              Scheduled
                            </span>
                          </td>
                          <td>Passport ACH</td>
                          <td>
                            <span className="muted">—</span>
                          </td>
                          <td>
                            <div className="row" style={{ gap: "6px", justifyContent: "flex-end" }}>
                              <button className="btn btn-sm btn-secondary" disabled>
                                Release
                              </button>
                              <button className="btn btn-sm btn-ghost">Record external</button>
                              <button className="btn btn-sm btn-ghost">Hold</button>
                              <button className="btn btn-sm btn-ghost" style={{ color: "#9B1C1C" }}>
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                        <tr>
                          <td className="b">3</td>
                          <td className="num b">$15,000</td>
                          <td>Final report accepted</td>
                          <td>Jul 15, 2028</td>
                          <td>
                            <span className="bdg bdg-neutral">
                              <Calendar className="ic" aria-hidden="true" />
                              Scheduled
                            </span>
                          </td>
                          <td>
                            <span className="muted">—</span>
                          </td>
                          <td>
                            <span className="muted">—</span>
                          </td>
                          <td>
                            <div className="row" style={{ gap: "6px", justifyContent: "flex-end" }}>
                              <button className="btn btn-sm btn-secondary" disabled>
                                Release
                              </button>
                              <button className="btn btn-sm btn-ghost">Record external</button>
                              <button className="btn btn-sm btn-ghost">Hold</button>
                              <button className="btn btn-sm btn-ghost" style={{ color: "#9B1C1C" }}>
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="card">
                    <div className="card-h">
                      <h3>Disbursement timeline · tranche 1</h3>
                      <span className="small muted">Actor-attributed · payloads expandable</span>
                    </div>
                    <div className="card-b">
                      <div className="tl tl-sm">
                        <div className="tl-i tl-person">
                          <span className="dot">
                            <Calendar className="ic" aria-hidden="true" />
                          </span>
                          <div>
                            <div className="what">Scheduled · $75,000 on execution</div>
                            <div className="who">
                              <span className="av av-sm">DO</span>Dana Ortiz · May 18, 2027 4:20 PM · from the panel commit
                            </div>
                          </div>
                        </div>
                        <div className="tl-i tl-warn">
                          <span className="dot">
                            <Clock className="ic" aria-hidden="true" />
                          </span>
                          <div>
                            <div className="what">Due · condition met</div>
                            <div className="who">
                              <Settings className="ic ic-sm" aria-hidden="true" />
                              System · May 24, 2027 11:05 AM · agreement executed
                            </div>
                            <details className="payload">
                              <summary>Payload</summary>
                              <pre>
                                {"{"}"event":"tranche.due","tranche":"awd_01J2Q7/1","trigger":"agreement.executed"{"}"}
                              </pre>
                            </details>
                          </div>
                        </div>
                        <div className="tl-i tl-ok">
                          <span className="dot">
                            <CircleCheck className="ic" aria-hidden="true" />
                          </span>
                          <div>
                            <div className="what">Ready · readiness 7 of 7</div>
                            <div className="who">
                              <BadgeCheck className="ic ic-sm" aria-hidden="true" style={{ color: "#1E4F8F" }} />
                              Passport · May 24, 2027 11:06 AM · payee credential verified, no holds
                            </div>
                          </div>
                        </div>
                        <div className="tl-i">
                          <span className="dot">
                            <Circle className="ic" aria-hidden="true" />
                          </span>
                          <div>
                            <div className="what muted">Releasing → Initiated → Settled</div>
                            <div className="who">Next: Finance releases from this screen or the Payments center</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="card" style={{ borderColor: "#E9C77D" }}>
                    <div className="card-h">
                      <div>
                        <h3>
                          Harbor Light Shelter · <span className="mono">awd_01HQ22</span> · tranche 2 ($38,000)
                        </h3>
                        <p className="small muted">Second example on this board: a blocked tranche on another active award.</p>
                      </div>
                      <span className="bdg bdg-warn">
                        <Lock className="ic" aria-hidden="true" />
                        Held
                      </span>
                    </div>
                    <div
                      className="card-b"
                      style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: "16px", alignItems: "start" }}
                    >
                      <div className="bnr bnr-warn">
                        <Lock className="ic" aria-hidden="true" />
                        <div>
                          <div className="t">Held — pending destination change</div>
                          <div className="d">
                            Harbor Light changed its payee destination on May 20; Passport applies a freeze window. Release stays disabled
                            until the hold clears.
                          </div>
                          <div className="clears">
                            <Clock className="ic ic-sm" aria-hidden="true" />
                            Clears automatically on Jun 3, 2027 when the cooling-off period ends, or earlier if Harbor Light cancels the
                            change.
                          </div>
                        </div>
                        <div className="act">
                          <Link to="/w/riverbend/payments/in-flight" className="btn btn-sm btn-secondary">
                            View alert
                          </Link>
                        </div>
                      </div>
                      <div className="rc">
                        <div className="rc-sum">
                          <CircleX className="ic" aria-hidden="true" style={{ color: "#9B1C1C" }} />5 of 7 ready · 2 blocked
                        </div>
                        <div className="rc-row rc-pass">
                          <CircleCheck className="ic" aria-hidden="true" />
                          <div>
                            <div className="l">Agreement executed</div>
                            <div className="r">Jul 8, 2026</div>
                          </div>
                          <span></span>
                        </div>
                        <div className="rc-row rc-pass">
                          <CircleCheck className="ic" aria-hidden="true" />
                          <div>
                            <div className="l">Passport level L3</div>
                            <div className="r">Attestation valid to Mar 2028</div>
                          </div>
                          <span></span>
                        </div>
                        <div className="rc-row rc-fail">
                          <CircleX className="ic" aria-hidden="true" />
                          <div>
                            <div className="l">No pending destination change</div>
                            <div className="r">
                              Change requested May 20 · Harbor Community Bank •••• 2210 → Northwest Federal CU •••• 9034
                            </div>
                          </div>
                          <Link to="/w/riverbend/payments/in-flight" className="fix">
                            Details →
                          </Link>
                        </div>
                        <div className="rc-row rc-fail">
                          <CircleX className="ic" aria-hidden="true" />
                          <div>
                            <div className="l">No freeze window</div>
                            <div className="r">Freeze until Jun 3, 2027</div>
                          </div>
                          <span className="fix muted">Waits</span>
                        </div>
                        <div className="rc-row rc-pass">
                          <CircleCheck className="ic" aria-hidden="true" />
                          <div>
                            <div className="l">Funder source account funded</div>
                            <div className="r">Mercury •••• 5520 · $412,000 available</div>
                          </div>
                          <span></span>
                        </div>
                        <div className="rc-row rc-pass">
                          <CircleCheck className="ic" aria-hidden="true" />
                          <div>
                            <div className="l">Requirement conditions met</div>
                            <div className="r">Interim report accepted Jan 20, 2027</div>
                          </div>
                          <span></span>
                        </div>
                        <div className="rc-row rc-pass">
                          <CircleCheck className="ic" aria-hidden="true" />
                          <div>
                            <div className="l">Passport reachable</div>
                            <div className="r">Checked 1 min ago</div>
                          </div>
                          <span></span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <aside className="drawer" style={{ border: "1px solid #D6DEDE", borderRadius: "12px", position: "sticky", top: "16px" }}>
                  <div className="hd">
                    <div>
                      <h3>Readiness · tranche 1</h3>
                      <div className="small muted">$75,000 · on execution</div>
                    </div>
                    <button className="iconbtn" aria-label="Close readiness drawer">
                      <X className="ic" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="bd">
                    <div className="rc">
                      <div className="rc-sum">
                        <CircleCheck className="ic" aria-hidden="true" style={{ color: "#0B5E47" }} />7 of 7 ready
                      </div>
                      <div className="rc-row rc-pass">
                        <CircleCheck className="ic" aria-hidden="true" />
                        <div>
                          <div className="l">Agreement executed</div>
                          <div className="r">May 24, 2027 · sha256 9c4e…b17a</div>
                        </div>
                        <span></span>
                      </div>
                      <div className="rc-row rc-pass">
                        <CircleCheck className="ic" aria-hidden="true" />
                        <div>
                          <div className="l">Passport level L3</div>
                          <div className="r">Attestation valid · verified payee</div>
                        </div>
                        <Link to="/w/riverbend/grantees/org_alder-creek" className="fix">
                          View
                        </Link>
                      </div>
                      <div className="rc-row rc-pass">
                        <CircleCheck className="ic" aria-hidden="true" />
                        <div>
                          <div className="l">Payee destination active</div>
                          <div className="r">River City Credit Union •••• 4821</div>
                        </div>
                        <span></span>
                      </div>
                      <div className="rc-row rc-pass">
                        <CircleCheck className="ic" aria-hidden="true" />
                        <div>
                          <div className="l">No pending destination change</div>
                          <div className="r">Last change Nov 2025 · settled</div>
                        </div>
                        <span></span>
                      </div>
                      <div className="rc-row rc-pass">
                        <CircleCheck className="ic" aria-hidden="true" />
                        <div>
                          <div className="l">No freeze window</div>
                          <div className="r">None active</div>
                        </div>
                        <span></span>
                      </div>
                      <div className="rc-row rc-pass">
                        <CircleCheck className="ic" aria-hidden="true" />
                        <div>
                          <div className="l">Funder source account funded</div>
                          <div className="r">Mercury •••• 5520 · $412,000 available</div>
                        </div>
                        <span></span>
                      </div>
                      <div className="rc-row rc-pass">
                        <CircleCheck className="ic" aria-hidden="true" />
                        <div>
                          <div className="l">Requirement conditions met</div>
                          <div className="r">No report gates tranche 1</div>
                        </div>
                        <span></span>
                      </div>
                    </div>
                    <div className="divider"></div>
                    <dl className="kv" style={{ fontSize: "12px" }}>
                      <dt>Rail</dt>
                      <dd>ACH same-day · arrives today if released before 2:00 PM PT</dd>
                      <dt>Destination</dt>
                      <dd>River City Credit Union •••• 4821 (from Passport)</dd>
                      <dt>Memo</dt>
                      <dd>Riverbend CHG27 · awd_01J2Q7 · 1/3</dd>
                    </dl>
                    <Link to="/w/riverbend/payments/due" className="btn btn-primary btn-block">
                      <Send className="ic" aria-hidden="true" />
                      Release $75,000
                    </Link>
                    <p className="xs muted">Releasing re-runs this checklist at the moment of release. Finance role required.</p>
                  </div>
                </aside>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" }}>
            <span className="eyebrow">States · tranche rows</span>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Example</th>
                    <th className="num">Amount</th>
                    <th>Status</th>
                    <th>Mode</th>
                    <th>Detail</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="b">External payment recorded</td>
                    <td className="num">$57,000</td>
                    <td>
                      <span className="bdg bdg-ok">
                        <BadgeCheck className="ic" aria-hidden="true" />
                        Settled
                      </span>
                    </td>
                    <td>External · recorded by Marcus Lee</td>
                    <td className="small muted">
                      Paid from Riverbend’s own bank on Jul 15, 2026; reference entered by hand; matched in Reconcile
                    </td>
                    <td>
                      <button className="btn btn-sm btn-ghost">View record</button>
                    </td>
                  </tr>
                  <tr>
                    <td className="b">Failed</td>
                    <td className="num">$20,000</td>
                    <td>
                      <span className="bdg bdg-dng">
                        <CircleX className="ic" aria-hidden="true" />
                        Failed
                      </span>
                    </td>
                    <td>Passport ACH</td>
                    <td className="small" style={{ color: "#9B1C1C" }}>
                      Rail returned R03 (no account / unable to locate). Destination needs re-verification in Passport before retry.
                    </td>
                    <td>
                      <div className="row" style={{ gap: "6px" }}>
                        <button className="btn btn-sm btn-secondary">Notify grantee</button>
                        <button className="btn btn-sm btn-secondary" disabled>
                          Retry
                        </button>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td className="b">Cancelled</td>
                    <td className="num">$10,000</td>
                    <td>
                      <span className="bdg bdg-neutral">
                        <Ban className="ic" aria-hidden="true" />
                        Cancelled
                      </span>
                    </td>
                    <td>
                      <span className="muted">—</span>
                    </td>
                    <td className="small muted">Removed by amendment AMD-14 (scope reduction) · Apr 2, 2027 · Dana Ortiz</td>
                    <td>
                      <button className="btn btn-sm btn-ghost">Open amendment</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </FunderShell>
    </>
  );
}
