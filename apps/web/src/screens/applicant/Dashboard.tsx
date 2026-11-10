// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import {
  BadgeCheck,
  Calendar,
  Check,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Clock4,
  Info,
  Pencil,
  RefreshCw,
  Search,
  Send,
  Shield,
} from "lucide-react";
import { ApplicantShell } from "../../components/shells.tsx";

export default function Dashboard() {
  return (
    <>
      <title>{"Dashboard — Alder Creek Family Services"}</title>
      <ApplicantShell active="Dashboard">
        <main className="main">
          <div className="ph">
            <div>
              <h1>Good afternoon, Maria</h1>
              <div className="meta">
                <span>Alder Creek Family Services</span>
                <span>·</span>
                <span>2 active applications</span>
                <span>·</span>
                <span>1 active grant</span>
                <span>·</span>
                <span>2 reports due</span>
              </div>
            </div>
            <div className="actions">
              <Link to="/w/alder-creek/find" className="btn btn-primary">
                <Search className="ic" aria-hidden="true" />
                Find funding
              </Link>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: "20px" }}>
            <div className="card">
              <div className="card-h">
                <div className="row" style={{ gap: "10px" }}>
                  <h2 style={{ fontSize: "18px" }}>Passport readiness</h2>
                  <span className="lvl lvl-3">
                    <Shield className="ic" aria-hidden="true" />
                    L3
                  </span>
                </div>
                <Link to="/w/alder-creek/organization" className="small b">
                  Manage in Passport
                </Link>
              </div>
              <div className="card-b" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "14px" }}>
                <div className="rc-row rc-pass" style={{ display: "flex", gap: "10px", border: "0", padding: "0" }}>
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="l">Identity verified</div>
                    <div className="r">Legal name, tax status and representatives match IRS records.</div>
                  </div>
                </div>
                <div className="rc-row rc-pass" style={{ display: "flex", gap: "10px", border: "0", padding: "0" }}>
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="l">Documents verified</div>
                    <div className="r">Determination letter and audited financials on file; insurance expires Sep 1.</div>
                  </div>
                </div>
                <div className="rc-row rc-pass" style={{ display: "flex", gap: "10px", border: "0", padding: "0" }}>
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="l">Payee verified</div>
                    <div className="r">
                      River City Credit Union •••• 4821 ·{" "}
                      <span className="pay pay-active">
                        <Check className="ic" aria-hidden="true" />
                        Payee active
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="card" style={{ background: "#F7FAFA" }}>
              <div className="card-h" style={{ padding: "12px 20px" }}>
                <span className="eyebrow">State · L2 organization</span>
                <span className="lvl lvl-2">L2</span>
              </div>
              <div className="card-b" style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <div className="rc-row rc-pass" style={{ display: "flex", gap: "10px", border: "0", padding: "0" }}>
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div className="l">Identity verified</div>
                </div>
                <div className="rc-row rc-pass" style={{ display: "flex", gap: "10px", border: "0", padding: "0" }}>
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div className="l">Documents verified</div>
                </div>
                <div className="rc-row rc-fail" style={{ display: "flex", gap: "10px", border: "0", padding: "0" }}>
                  <CircleX className="ic" aria-hidden="true" />
                  <div>
                    <div className="l">Payee not verified</div>
                    <div className="r">Awards can be offered but no payment can be released until L3.</div>
                  </div>
                </div>
                <Link to="/w/alder-creek/organization" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
                  Verify payee in Passport
                </Link>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <section className="card">
                <div className="card-h">
                  <h2 style={{ fontSize: "18px" }}>Active applications</h2>
                  <Link to="/w/alder-creek/applications/app_01HZX4/edit" className="small b">
                    View all
                  </Link>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <Link
                    to="/w/alder-creek/applications/app_01HZX4/edit"
                    className="card"
                    style={{
                      padding: "16px 18px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      textDecoration: "none",
                      color: "inherit",
                    }}
                  >
                    <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                      <span className="chip">
                        <span className="tdot" aria-hidden="true"></span>Riverbend Community Foundation
                      </span>
                      <span className="bdg bdg-neutral">
                        <Pencil className="ic" aria-hidden="true" />
                        Draft
                      </span>
                    </div>
                    <h3 style={{ fontSize: "17px" }}>Mobile Health Navigation for Rural Families</h3>
                    <div className="row" style={{ gap: "14px", flexWrap: "wrap", fontSize: "14px", color: "#4A5C5A" }}>
                      <span>Community Health Grants 2027</span>
                      <span>·</span>
                      <span>Full proposal stage</span>
                      <span>·</span>
                      <span className="b" style={{ color: "#7A4A00" }}>
                        Closes in 14 days · Apr 30
                      </span>
                      <span style={{ marginLeft: "auto" }} className="pres">
                        <span className="av av-t" title="Maria Santos">
                          MS
                        </span>
                        <span className="av" title="Jamal Reed">
                          JR
                        </span>
                        <span className="av av-g" title="Lena Fischer">
                          LF
                        </span>
                      </span>
                    </div>
                  </Link>
                  <Link
                    to="/w/alder-creek/applications/app_01HZX4"
                    className="card"
                    style={
                      {
                        "--tenant": "#7A4F01",
                        padding: "16px 18px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                        textDecoration: "none",
                        color: "inherit",
                      } as CSSProperties
                    }
                  >
                    <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                      <span className="chip">
                        <span className="tdot" aria-hidden="true"></span>Cascade County Health Department
                      </span>
                      <span className="bdg bdg-info">
                        <Send className="ic" aria-hidden="true" />
                        Submitted
                      </span>
                    </div>
                    <h3 style={{ fontSize: "17px" }}>Community Clinic Capacity</h3>
                    <div className="row" style={{ gap: "14px", flexWrap: "wrap", fontSize: "14px", color: "#4A5C5A" }}>
                      <span>Community Clinic Capacity Grants FY28</span>
                      <span>·</span>
                      <span>LOI stage</span>
                      <span>·</span>
                      <span>Decision by Jun 30</span>
                      <span style={{ marginLeft: "auto" }} className="pres">
                        <span className="av av-t" title="Maria Santos">
                          MS
                        </span>
                      </span>
                    </div>
                  </Link>
                </div>
              </section>
              <section className="card">
                <div className="card-h">
                  <h2 style={{ fontSize: "18px" }}>Payments</h2>
                  <Link to="/w/alder-creek/grants/awd_01J2Q7" className="small b">
                    Open grant
                  </Link>
                </div>
                <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
                  <table className="tbl" style={{ fontSize: "14px" }}>
                    <thead>
                      <tr>
                        <th>Funder</th>
                        <th>Tranche</th>
                        <th className="num">Amount</th>
                        <th>Destination</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <span className="chip">
                            <span className="tdot" aria-hidden="true"></span>Riverbend
                          </span>
                        </td>
                        <td>1 of 3 · on execution</td>
                        <td className="num">$75,000</td>
                        <td>River City Credit Union •••• 4821</td>
                        <td>
                          <span className="bdg bdg-ok">
                            <BadgeCheck className="ic" aria-hidden="true" />
                            Settled May 25
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          <span className="chip">
                            <span className="tdot" aria-hidden="true"></span>Riverbend
                          </span>
                        </td>
                        <td>2 of 3 · after interim report</td>
                        <td className="num">$60,000</td>
                        <td>River City Credit Union •••• 4821</td>
                        <td>
                          <span className="bdg bdg-neutral">
                            <Calendar className="ic" aria-hidden="true" />
                            Expected after Dec 15
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <section className="card">
                <div className="card-h">
                  <h2 style={{ fontSize: "18px" }}>Reports due</h2>
                  <Link to="/w/alder-creek/reports" className="small b">
                    All reports
                  </Link>
                </div>
                <ul className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "16px 20px" }}>
                  <li className="row" style={{ gap: "12px", alignItems: "flex-start" }}>
                    <span className="bdg bdg-neutral" style={{ flex: "none" }}>
                      <Calendar className="ic" aria-hidden="true" />
                      Scheduled
                    </span>
                    <div>
                      <Link to="/w/alder-creek/reports" className="b">
                        Interim report · Mobile Health Navigation
                      </Link>
                      <div className="small muted">
                        <span className="chip" style={{ height: "20px", fontSize: "11px" }}>
                          <span className="tdot" aria-hidden="true"></span>Riverbend
                        </span>{" "}
                        · due Dec 15, 2027 · releases tranche 2
                      </div>
                    </div>
                  </li>
                  <li className="row" style={{ gap: "12px", alignItems: "flex-start", "--tenant": "#7A4F01" } as CSSProperties}>
                    <span className="bdg bdg-warn" style={{ flex: "none" }}>
                      <Clock className="ic" aria-hidden="true" />
                      Due
                    </span>
                    <div>
                      <Link to="/w/alder-creek/reports" className="b">
                        Progress report · 2026 Clinic Outreach
                      </Link>
                      <div className="small muted">
                        <span className="chip" style={{ height: "20px", fontSize: "11px" }}>
                          <span className="tdot" aria-hidden="true"></span>Cascade County
                        </span>{" "}
                        · due Jun 30, 2027
                      </div>
                    </div>
                  </li>
                </ul>
              </section>
              <section className="card">
                <div className="card-h">
                  <h2 style={{ fontSize: "18px" }}>Messages</h2>
                  <Link to="/w/alder-creek/applications/app_01HZX4" className="small b">
                    Open threads
                  </Link>
                </div>
                <div className="card-b th" style={{ padding: "16px 20px" }}>
                  <div className="msg">
                    <span className="av av-n" title="Dana Ortiz">
                      DO
                    </span>
                    <div className="bub">
                      <div className="hd">
                        <span className="who">Dana Ortiz</span>
                        <span>· Riverbend</span>
                        <span className="shared-mark">Shared</span>
                        <span>· 2 h ago</span>
                      </div>
                      <div className="bd">
                        Thanks for the LOI. For the full proposal, the budget narrative can reference the county assessment directly.
                      </div>
                    </div>
                  </div>
                  <div className="msg">
                    <span className="av" title="Jamal Reed">
                      JR
                    </span>
                    <div className="bub">
                      <div className="hd">
                        <span className="who">Jamal Reed</span>
                        <span>· Team</span>
                        <span>· yesterday</span>
                      </div>
                      <div className="bd">Letters of support from Copper Valley Clinic arrive Thursday.</div>
                    </div>
                  </div>
                </div>
              </section>
              <section className="card">
                <div className="card-h">
                  <h2 style={{ fontSize: "18px" }}>Tasks</h2>
                  <span className="small muted">Assigned sections</span>
                </div>
                <ul className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px 20px" }}>
                  <li className="row" style={{ gap: "10px" }}>
                    <span className="av av-sm av-g" title="Lena Fischer">
                      LF
                    </span>
                    <div className="grow">
                      <Link to="/w/alder-creek/applications/app_01HZX4/edit" className="b">
                        Budget
                      </Link>
                      <div className="small muted">Lena Fischer (consultant) · Mobile Health Navigation</div>
                    </div>
                    <span className="bdg bdg-neutral">
                      <Circle className="ic" aria-hidden="true" />
                      Not started
                    </span>
                  </li>
                  <li className="row" style={{ gap: "10px" }}>
                    <span className="av av-sm" title="Jamal Reed">
                      JR
                    </span>
                    <div className="grow">
                      <Link to="/w/alder-creek/applications/app_01HZX4/edit" className="b">
                        Letters of support
                      </Link>
                      <div className="small muted">Jamal Reed · Attachments</div>
                    </div>
                    <span className="bdg bdg-prog">
                      <Clock4 className="ic" aria-hidden="true" />
                      In progress
                    </span>
                  </li>
                </ul>
              </section>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px", marginTop: "8px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">State · nothing active</span>
              <div className="card empty">
                <Search className="ic" aria-hidden="true" />
                <h3>No applications or grants yet</h3>
                <p>
                  Your Passport record is ready. Find an opportunity you are eligible for and start an application with your profile already
                  filled in.
                </p>
                <div className="acts">
                  <Link to="/w/alder-creek/find" className="btn btn-primary">
                    Find funding
                  </Link>
                  <Link to="/w/alder-creek/organization" className="small b">
                    Review your organization profile
                  </Link>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">State · Passport unavailable</span>
              <div className="card">
                <div className="card-h">
                  <div className="row" style={{ gap: "10px" }}>
                    <h3>Passport readiness</h3>
                    <span className="lvl lvl-na">L? unavailable</span>
                  </div>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div className="bnr bnr-neu">
                    <Info className="ic" aria-hidden="true" />
                    <div>
                      <div className="t">Passport can’t be reached right now</div>
                      <div className="d">
                        Your level and payee status were last confirmed 40 minutes ago. Applications stay editable; submissions and payments
                        wait until Passport is back.
                      </div>
                      <div className="clears">
                        <RefreshCw className="ic ic-sm" aria-hidden="true" />
                        Retrying automatically every minute
                      </div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: "10px", color: "#4A5C5A" }}>
                    <CircleDashed className="ic" aria-hidden="true" />
                    Identity · Documents · Payee: unknown until reconnected
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </ApplicantShell>
    </>
  );
}
