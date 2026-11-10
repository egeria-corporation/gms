// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import {
  BadgeCheck,
  Ban,
  Check,
  CircleCheck,
  CirclePause,
  Clock,
  Download,
  ExternalLink,
  Eye,
  Funnel,
  Hash,
  Lock,
  Mail,
  PenLine,
  RefreshCw,
  Shield,
} from "lucide-react";
import { FunderShell } from "../../components/shells.tsx";

export default function AwardAgreement() {
  return (
    <>
      <title>{"Award detail — Agreement — Riverbend funder workspace"}</title>
      <FunderShell active="Awards">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/riverbend">Riverbend</Link>
            <span>›</span>
            <Link to="/w/riverbend/awards/awd_01J2Q7/agreement">Awards</Link>
            <span>›</span>
            <span>awd_01J2Q7</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Awards</h1>
              </div>
              <div className="meta">
                <span>5 awards · $575,000 awarded · $57,000 disbursed</span>
                <span>·</span>
                <span>Community Health 2026 & 2027</span>
              </div>
            </div>
            <div className="actions">
              <button className="btn btn-secondary">
                <Funnel className="ic" aria-hidden="true" />
                Filter
              </button>
              <button className="btn btn-secondary">
                <Download className="ic" aria-hidden="true" />
                Export
              </button>
            </div>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Title</th>
                  <th>Program</th>
                  <th className="num">Awarded</th>
                  <th className="num">Disbursed</th>
                  <th className="num">Remaining</th>
                  <th>Status</th>
                  <th>Next due</th>
                </tr>
              </thead>
              <tbody>
                <tr className="sel">
                  <td>
                    <div className="ent">
                      <Link to="/w/riverbend/awards/awd_01J2Q7/agreement" className="nm">
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
                  <td>Mobile Health Navigation for Rural Families</td>
                  <td>Community Health 2027</td>
                  <td className="num">$150,000</td>
                  <td className="num">$0</td>
                  <td className="num">$150,000</td>
                  <td>
                    <span className="bdg bdg-prog">
                      <Check className="ic" aria-hidden="true" />
                      Accepted
                    </span>
                  </td>
                  <td>Tranche 1 · on execution</td>
                </tr>
                <tr>
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
                  <td>Shelter Health Clinic Hours</td>
                  <td>Community Health 2026</td>
                  <td className="num">$95,000</td>
                  <td className="num">$57,000</td>
                  <td className="num">$38,000</td>
                  <td>
                    <span className="bdg bdg-ok">
                      <BadgeCheck className="ic" aria-hidden="true" />
                      Active
                    </span>
                  </td>
                  <td>
                    <span className="row" style={{ gap: "6px" }}>
                      Tranche 2 · May 20
                      <span className="bdg bdg-warn">
                        <Lock className="ic" aria-hidden="true" />
                        Held
                      </span>
                    </span>
                  </td>
                </tr>
                <tr>
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
                  <td>Fall Prevention Program</td>
                  <td>Community Health 2027</td>
                  <td className="num">$70,000</td>
                  <td className="num">$0</td>
                  <td className="num">$70,000</td>
                  <td>
                    <span className="bdg bdg-info">
                      <Mail className="ic" aria-hidden="true" />
                      Offered
                    </span>
                  </td>
                  <td>Awaiting acceptance</td>
                </tr>
                <tr>
                  <td>
                    <div className="ent">
                      <Link to="/w/riverbend/awards/awd_01J2Q7/agreement" className="nm">
                        Northgate Housing Trust
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
                  <td>Housing-First Health Navigators</td>
                  <td>Community Health 2027</td>
                  <td className="num">$150,000</td>
                  <td className="num">$0</td>
                  <td className="num">$150,000</td>
                  <td>
                    <span className="bdg bdg-prog">
                      <Check className="ic" aria-hidden="true" />
                      Accepted
                    </span>
                  </td>
                  <td>Agreement · Sent May 19</td>
                </tr>
                <tr>
                  <td>
                    <div className="ent">
                      <Link to="/w/riverbend/awards/awd_01J2Q7/agreement" className="nm">
                        Willow Creek Legal Aid
                      </Link>
                      <div className="sub">
                        <span className="lvl lvl-2">L2</span>
                        <span className="pay pay-cooling">
                          <Clock className="ic" aria-hidden="true" />
                          Cooling off
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>Medical-Legal Partnership</td>
                  <td>Community Health 2027</td>
                  <td className="num">$110,000</td>
                  <td className="num">$0</td>
                  <td className="num">$110,000</td>
                  <td>
                    <span className="bdg bdg-info">
                      <Mail className="ic" aria-hidden="true" />
                      Offered
                    </span>
                  </td>
                  <td>Awaiting acceptance</td>
                </tr>
              </tbody>
            </table>
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
                  <h2 style={{ fontSize: "20px" }}>Mobile Health Navigation for Rural Families</h2>
                  <div className="row small muted" style={{ gap: "10px", flexWrap: "wrap" }}>
                    <span className="mono">awd_01J2Q7</span>
                    <span>·</span>
                    <Link to="/w/riverbend/programs">Community Health 2027</Link>
                    <span>·</span>
                    <span>Decision committed May 18, 2027 by Dana Ortiz</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
                  <span className="bdg bdg-prog bdg-lg">
                    <Check className="ic" aria-hidden="true" />
                    Accepted · by grantee May 20
                  </span>
                  <span className="notice">
                    <BadgeCheck className="ic" aria-hidden="true" style={{ color: "#1E4F8F" }} />
                    Synced to Passport 2 min ago
                  </span>
                  <Link to="/w/alder-creek/grants/awd_01J2Q7/offer" className="small b">
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
                    <div className="stat-d">0 of 3 tranches</div>
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
                <Link to="/w/riverbend/awards/awd_01J2Q7/agreement" className="tab on" role="tab" aria-selected="true">
                  Agreement
                </Link>
                <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="tab" role="tab">
                  Payments<span className="n">3</span>
                </Link>
                <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="tab" role="tab">
                  Requirements<span className="n">2</span>
                </Link>
                <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="tab" role="tab">
                  Budget
                </Link>
                <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="tab" role="tab">
                  Amendments
                </Link>
                <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="tab" role="tab">
                  Documents<span className="n">4</span>
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
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div className="row" style={{ justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                    <div className="fld" style={{ flex: "1 1 280px" }}>
                      <label className="lbl" htmlFor="tpl">
                        Agreement template
                      </label>
                      <select className="sel" id="tpl">
                        <option>Standard grant agreement v4</option>
                        <option>Standard grant agreement v3 (retired)</option>
                        <option>Fiscal sponsor agreement v2</option>
                        <option>Government subaward v1</option>
                      </select>
                    </div>
                    <div className="row" style={{ gap: "8px", alignSelf: "flex-end" }}>
                      <button className="btn btn-secondary btn-sm">
                        <RefreshCw className="ic" aria-hidden="true" />
                        Regenerate preview
                      </button>
                      <Link to="/preview/pdf/agreement" className="btn btn-secondary btn-sm">
                        <ExternalLink className="ic" aria-hidden="true" />
                        Open full PDF
                      </Link>
                    </div>
                  </div>
                  <div
                    style={{
                      border: "1px solid #D6DEDE",
                      borderRadius: "8px",
                      background: "#FFFFFF",
                      maxHeight: "420px",
                      overflow: "auto",
                      padding: "28px 32px",
                      fontSize: "13px",
                      lineHeight: 1.6,
                      color: "#1E2D2B",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                    tabIndex={0}
                    aria-label="Generated agreement preview, scrollable"
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "12px",
                        borderBottom: "1px solid #D6DEDE",
                        paddingBottom: "10px",
                      }}
                    >
                      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "15px", color: "#0D2A43" }}>
                        Grant Agreement
                      </span>
                      <span className="small muted">Standard grant agreement v4 · generated May 19, 2027</span>
                    </div>
                    <p>
                      <b>Between</b> Riverbend Community Foundation (“Funder”) and Alder Creek Family Services (“Grantee”), a 501(c)(3)
                      public charity at 418 Mill Road, Alder Creek, OR.
                    </p>
                    <p>
                      <b>1. Award.</b> The Funder awards the Grantee <b>$150,000</b> for the project “Mobile Health Navigation for Rural
                      Families” under the Community Health 2027 program (opportunity Community Health Grants 2027, application app_01HZX4).
                    </p>
                    <p>
                      <b>2. Period.</b> The grant period runs from <b>July 1, 2027</b> through <b>June 30, 2028</b>. Funds may be spent only
                      within this period unless an extension is approved through an amendment.
                    </p>
                    <p>
                      <b>3. Payment.</b> Funds are disbursed in three tranches through OpenGrants Passport to the Grantee’s verified payee
                      destination: $75,000 on execution of this agreement; $60,000 on acceptance of the interim report; $15,000 on
                      acceptance of the final report. The Funder releases a tranche only after its readiness check passes.
                    </p>
                    <p>
                      <b>4. Reporting.</b> The Grantee submits an interim report by December 15, 2027 and a final report by July 15, 2028,
                      using the forms designated by the Funder.
                    </p>
                    <p>
                      <b>5. Use of funds.</b> Funds are restricted to the budget approved with the award. Reallocation above 10% of any
                      category requires an amendment.
                    </p>
                    <p>
                      <b>6. Records and audit.</b> The Grantee keeps records for four years after the final payment and makes them available
                      on request.
                    </p>
                    <p className="muted">
                      <i>…4 further clauses (publicity, termination, governing law, signatures)</i>
                    </p>
                  </div>
                  <div className="notice">
                    <Hash className="ic" aria-hidden="true" />
                    Document hash<span className="mono">sha256 9c4e…b17a</span>· fixed when sent; any edit voids and regenerates
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div className="card" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <h3>Agreement status</h3>
                      <span className="bdg bdg-prog">
                        <PenLine className="ic" aria-hidden="true" />
                        Signed by grantee
                      </span>
                    </div>
                    <div className="stp-v">
                      <div className="s done">
                        <span className="n">
                          <Check className="ic ic-sm" aria-hidden="true" />
                        </span>
                        <div>
                          <div className="t">Draft</div>
                          <div className="d">Generated from template v4 · May 19, 8:40 AM · Dana Ortiz</div>
                        </div>
                      </div>
                      <div className="s done">
                        <span className="n">
                          <Check className="ic ic-sm" aria-hidden="true" />
                        </span>
                        <div>
                          <div className="t">Sent</div>
                          <div className="d">May 19, 2027 · with award letter to Maria Santos</div>
                        </div>
                      </div>
                      <div className="s done">
                        <span className="n">
                          <Check className="ic ic-sm" aria-hidden="true" />
                        </span>
                        <div>
                          <div className="t">Signed by grantee</div>
                          <div className="d">May 21, 2027 10:42 AM PT · Maria Santos, Executive Director</div>
                        </div>
                      </div>
                      <div className="s on">
                        <span className="n">4</span>
                        <div>
                          <div className="t">Countersigned</div>
                          <div className="d">Waiting for Dana Ortiz (Program officer) or Marcus Lee (Finance)</div>
                        </div>
                      </div>
                      <div className="s">
                        <span className="n">5</span>
                        <div>
                          <div className="t">Executed</div>
                          <div className="d">Executed PDF generated; award becomes Active; tranche 1 becomes Due</div>
                        </div>
                      </div>
                    </div>
                    <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                      <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="btn btn-primary">
                        <PenLine className="ic" aria-hidden="true" />
                        Countersign as Dana Ortiz
                      </Link>
                      <button className="btn btn-secondary" disabled title="Available once executed">
                        <Download className="ic" aria-hidden="true" />
                        Download executed PDF
                      </button>
                      <button className="btn btn-danger">
                        <Ban className="ic" aria-hidden="true" />
                        Void
                      </button>
                    </div>
                    <p className="small muted">
                      Countersigning is a human gate: agents can prepare and send an agreement but never sign one.
                    </p>
                  </div>
                  <div className="card">
                    <div className="card-h">
                      <h3>Signature records</h3>
                      <span className="small muted">Recorded at signing</span>
                    </div>
                    <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
                      <table className="tbl tbl-compact">
                        <thead>
                          <tr>
                            <th>Signer</th>
                            <th>Role</th>
                            <th>Signed</th>
                            <th>IP</th>
                            <th>Document hash</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td className="b">Maria Santos</td>
                            <td>Executive Director, Alder Creek Family Services</td>
                            <td>May 21, 2027 10:42 AM PT</td>
                            <td>
                              <span className="mono">203.0.113.•••</span> <span className="xs muted">recorded</span>
                            </td>
                            <td>
                              <span className="mono">sha256 9c4e…b17a</span>
                            </td>
                          </tr>
                          <tr>
                            <td className="b">Dana Ortiz</td>
                            <td>Program officer, Riverbend Community Foundation</td>
                            <td>
                              <span className="muted">Pending countersignature</span>
                            </td>
                            <td>
                              <span className="muted">—</span>
                            </td>
                            <td>
                              <span className="muted">—</span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" }}>
            <span className="eyebrow">States · award detail</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "16px", alignItems: "start" }}>
              <div className="card" style={{ display: "flex", flexDirection: "column" }}>
                <div className="card-h">
                  <h3>Offered · awaiting grantee</h3>
                  <span className="bdg bdg-info">
                    <Mail className="ic" aria-hidden="true" />
                    Offered
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
                  <p>
                    Lakeside Senior Center was sent the award letter on May 19, 2027. The offer expires on <b>Jun 18, 2027</b> if not
                    accepted.
                  </p>
                  <div className="row small muted" style={{ gap: "6px" }}>
                    <Mail className="ic" aria-hidden="true" />
                    Letter opened May 20 · no response yet
                  </div>
                  <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                    <Link to="/preview/email/award" className="btn btn-secondary btn-sm">
                      Resend letter
                    </Link>
                    <button className="btn btn-ghost btn-sm">Extend offer</button>
                    <button className="btn btn-danger btn-sm">Withdraw offer</button>
                  </div>
                </div>
              </div>
              <div className="card" style={{ display: "flex", flexDirection: "column" }}>
                <div className="card-h">
                  <h3>Suspended</h3>
                  <span className="bdg bdg-warn">
                    <CirclePause className="ic" aria-hidden="true" />
                    Suspended
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div className="bnr bnr-warn">
                    <CirclePause className="ic" aria-hidden="true" />
                    <div>
                      <div className="t">Payments paused by Riverbend</div>
                      <div className="d">
                        Suspended May 12 by Marcus Lee: “Interim report shows unapproved reallocation above 10%. Resolve via amendment.”
                      </div>
                      <div className="clears">
                        <Check className="ic ic-sm" aria-hidden="true" />
                        Clears when: the reallocation amendment is approved, or Finance resumes manually.
                      </div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: "8px" }}>
                    <button className="btn btn-primary btn-sm">Resume payments</button>
                    <button className="btn btn-secondary btn-sm">Open amendment</button>
                  </div>
                </div>
              </div>
              <div className="card" style={{ display: "flex", flexDirection: "column" }}>
                <div className="card-h">
                  <h3>Completed · archived</h3>
                  <span className="bdg bdg-done">
                    <CircleCheck className="ic" aria-hidden="true" />
                    Completed
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
                  <dl className="kv">
                    <dt>Closed</dt>
                    <dd>Aug 2, 2027 · by Dana Ortiz</dd>
                    <dt>Final report</dt>
                    <dd>
                      <span className="bdg bdg-ok">
                        <CircleCheck className="ic" aria-hidden="true" />
                        Accepted
                      </span>
                    </dd>
                    <dt>Tranches</dt>
                    <dd>3 settled · 0 cancelled</dd>
                    <dt>Budget</dt>
                    <dd>Reconciled · variance −$1,240</dd>
                  </dl>
                  <div className="row" style={{ gap: "8px" }}>
                    <Link to="/preview/pdf/closeout" className="btn btn-secondary btn-sm">
                      <Download className="ic" aria-hidden="true" />
                      Closeout summary PDF
                    </Link>
                    <button className="btn btn-ghost btn-sm">Reopen</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </FunderShell>
    </>
  );
}
