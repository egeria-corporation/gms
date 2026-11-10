// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import {
  Calendar,
  Check,
  Circle,
  CircleCheck,
  Clock,
  Clock4,
  Database,
  File,
  Info,
  Pencil,
  RotateCcw,
  TriangleExclamationPoint,
} from "lucide-react";
import { ApplicantShell } from "../../components/shells.tsx";

export default function Reports() {
  return (
    <>
      <title>{"Reports — Alder Creek Family Services"}</title>
      <ApplicantShell active="Reports">
        <main className="main" style={{ padding: "24px 32px 48px", gap: "20px" }}>
          <div className="crumbs">
            <Link to="/w/alder-creek">Dashboard</Link>
            <span>›</span>
            <span>Reports</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Reports</h1>
              </div>
              <div className="meta">
                <span>3 requirements across 2 funders</span>
                <span>·</span>
                <span>1 due in 18 days</span>
                <span>·</span>
                <span>1 returned with comments</span>
              </div>
            </div>
            <div className="actions">
              <Link to="/w/alder-creek/grants/awd_01J2Q7" className="btn btn-secondary">
                My grants
              </Link>
            </div>
          </div>
          <div className="tbl-wrap">
            <table className="tbl" style={{ fontSize: "15px" }}>
              <thead>
                <tr>
                  <th>Funder</th>
                  <th>Requirement</th>
                  <th>Grant</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr className="sel">
                  <td>
                    <span className="chip">
                      <span className="tdot" aria-hidden="true"></span>Riverbend Community Foundation
                    </span>
                  </td>
                  <td className="b">Interim report</td>
                  <td>Mobile Health Navigation for Rural Families</td>
                  <td>Dec 15, 2027</td>
                  <td>
                    <span className="bdg bdg-warn">
                      <Clock className="ic" aria-hidden="true" />
                      Due
                    </span>
                  </td>
                  <td>
                    <a href="#editor" className="btn btn-sm btn-primary">
                      Open in editor
                    </a>
                  </td>
                </tr>
                <tr>
                  <td>
                    <span className="chip" style={{ "--tenant": "#7A4F01" } as CSSProperties}>
                      <span className="tdot" aria-hidden="true"></span>Cascade County Health Department
                    </span>
                  </td>
                  <td className="b">Progress report</td>
                  <td>Rural Immunization Outreach 2027</td>
                  <td>Jun 30, 2027</td>
                  <td>
                    <span className="bdg bdg-neutral">
                      <Calendar className="ic" aria-hidden="true" />
                      Scheduled
                    </span>
                  </td>
                  <td>
                    <a href="#editor" className="btn btn-sm btn-secondary">
                      Start early
                    </a>
                  </td>
                </tr>
                <tr>
                  <td>
                    <span className="chip" style={{ "--tenant": "#7A4F01" } as CSSProperties}>
                      <span className="tdot" aria-hidden="true"></span>Cascade County Health Department
                    </span>
                  </td>
                  <td className="b">2026 final report</td>
                  <td>Rural Immunization Outreach 2026</td>
                  <td>Apr 30, 2027</td>
                  <td>
                    <span className="bdg bdg-warn">
                      <RotateCcw className="ic" aria-hidden="true" />
                      Returned
                    </span>
                  </td>
                  <td>
                    <a href="#states" className="btn btn-sm btn-secondary">
                      Respond
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div
            className="card"
            id="editor"
            style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}
          >
            <span className="chip">
              <span className="tdot" aria-hidden="true"></span>Riverbend Community Foundation
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}>
              <h2 style={{ fontSize: "20px" }}>Interim report · Mobile Health Navigation for Rural Families</h2>
              <div className="row small muted" style={{ gap: "10px", flexWrap: "wrap" }}>
                <span>Report form v1 · reporting period Jul 1 – Nov 30, 2027</span>
                <span>·</span>
                <span className="b" style={{ color: "#7A4A00" }}>
                  Due Dec 15, 2027 · 18 days
                </span>
                <span>·</span>
                <span>Accepting releases tranche 2 ($60,000)</span>
              </div>
            </div>
            <div className="row" style={{ marginLeft: "auto", gap: "14px", flexWrap: "wrap" }}>
              <span className="notice">
                <Check className="ic" aria-hidden="true" style={{ color: "#0B5E47" }} />
                Saved 40 seconds ago
              </span>
              <div className="pres" aria-label="Editing now: Maria Santos">
                <span className="av av-t live" title="Maria Santos (you)">
                  MS
                </span>
              </div>
              <button className="btn btn-secondary">Save</button>
              <Link to="/w/riverbend/reporting" className="btn btn-primary">
                Submit report
              </Link>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "248px minmax(0, 1fr) 300px", gap: "20px", alignItems: "start" }}>
            <aside className="card" style={{ padding: "12px" }}>
              <div className="eyebrow" style={{ padding: "4px 10px 10px" }}>
                Sections · 2 of 5 complete
              </div>
              <nav className="sec" aria-label="Report sections">
                <a href="#narr" className="s-done">
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">Narrative progress</div>
                    <div className="st">Complete</div>
                  </div>
                  <span className="meta">
                    <span className="av av-sm av-t">MS</span>
                  </span>
                </a>
                <a href="#outc" className="s-done on" aria-current="true">
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">Outcomes to date</div>
                    <div className="st">Complete · prefilled</div>
                  </div>
                  <span className="meta">
                    <span className="av av-sm av-t">MS</span>
                  </span>
                </a>
                <a href="#act" className="s-prog">
                  <Clock4 className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">Budget actuals</div>
                    <div className="st">From QuickBooks · 1 warning</div>
                  </div>
                  <span className="meta">
                    <span className="av av-sm">JR</span>
                  </span>
                </a>
                <a href="#att" className="s-todo">
                  <Circle className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">Attachments</div>
                    <div className="st">Optional</div>
                  </div>
                  <span className="meta"></span>
                </a>
                <a href="#cert" className="s-todo">
                  <Circle className="ic" aria-hidden="true" />
                  <div>
                    <div className="nm">Certification</div>
                    <div className="st">Not started</div>
                  </div>
                  <span className="meta"></span>
                </a>
              </nav>
            </aside>
            <section style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: "0" }}>
              <div className="card" id="outc">
                <div className="card-h">
                  <div>
                    <h2 style={{ fontSize: "18px" }}>Outcomes to date</h2>
                    <p className="small muted">
                      Values from your last accepted report are carried forward. Replace them with the figure for this period.
                    </p>
                  </div>
                  <span className="bdg bdg-ok">
                    <CircleCheck className="ic" aria-hidden="true" />
                    Complete
                  </span>
                </div>
                <div className="card-b" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "18px 24px" }}>
                  <div className="fld">
                    <label className="lbl" htmlFor="fam">
                      Families served to date
                      <span className="prov prov-report">
                        <File className="ic" aria-hidden="true" />
                        From prior report
                      </span>
                    </label>
                    <input className="inp" id="fam" defaultValue="212" />
                    <span className="help">Prior report (pilot, Feb 2027): 38 · target for the grant period: 400</span>
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor="visits">
                      Appointments kept
                      <span className="prov prov-entered">
                        <Pencil className="ic" aria-hidden="true" />
                        Entered
                      </span>
                    </label>
                    <input className="inp" id="visits" defaultValue="611" />
                    <span className="help">Of 718 scheduled · 85% kept</span>
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor="stops">
                      Route stops active
                      <span className="prov prov-report">
                        <File className="ic" aria-hidden="true" />
                        From prior report
                      </span>
                    </label>
                    <input className="inp" id="stops" defaultValue="6" />
                    <span className="help">Prior report: 2</span>
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor="navs">
                      Navigators employed
                      <span className="prov prov-entered">
                        <Pencil className="ic" aria-hidden="true" />
                        Entered
                      </span>
                    </label>
                    <input className="inp" id="navs" defaultValue="2" />
                    <span className="help">Both started Jun 2, 2027</span>
                  </div>
                </div>
              </div>
              <div className="card" id="act">
                <div className="card-h">
                  <div>
                    <h2 style={{ fontSize: "18px" }}>Budget actuals</h2>
                    <p className="small muted">
                      Actuals are pulled from your mapped QuickBooks accounts for the reporting period. Edit a cell to override; overrides
                      are marked.
                    </p>
                  </div>
                  <span className="prov prov-qb">
                    <Database className="ic" aria-hidden="true" />
                    From QuickBooks · synced today 6:10 AM
                  </span>
                </div>
                <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
                  <table className="tbl bud" style={{ fontSize: "14px" }}>
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th className="num">Approved</th>
                        <th className="num">Actual this period</th>
                        <th className="num">Variance</th>
                        <th>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Personnel</td>
                        <td className="num">$96,000</td>
                        <td className="num">
                          <input
                            className="inp"
                            style={{ width: "120px", textAlign: "right", height: "32px", fontSize: "14px" }}
                            defaultValue="$31,400"
                            aria-label="Personnel actual"
                          />
                        </td>
                        <td className="num var-pos">−$64,600</td>
                        <td>
                          <span className="prov prov-qb">
                            <Database className="ic" aria-hidden="true" />
                            From QuickBooks
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td>Travel & vehicle</td>
                        <td className="num">$28,000</td>
                        <td className="num">
                          <input
                            className="inp"
                            style={{ width: "120px", textAlign: "right", height: "32px", fontSize: "14px" }}
                            defaultValue="$30,240"
                            aria-label="Travel actual"
                          />
                        </td>
                        <td className="num var-neg">+$2,240 (8%)</td>
                        <td>
                          <span className="prov prov-qb">
                            <Database className="ic" aria-hidden="true" />
                            From QuickBooks
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td>Supplies</td>
                        <td className="num">$11,000</td>
                        <td className="num">
                          <input
                            className="inp"
                            style={{ width: "120px", textAlign: "right", height: "32px", fontSize: "14px" }}
                            defaultValue="$6,120"
                            aria-label="Supplies actual"
                          />
                        </td>
                        <td className="num var-pos">−$4,880</td>
                        <td>
                          <span className="prov prov-qb">
                            <Database className="ic" aria-hidden="true" />
                            From QuickBooks
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td>Indirect (10%)</td>
                        <td className="num">$15,000</td>
                        <td className="num">
                          <input
                            className="inp"
                            style={{ width: "120px", textAlign: "right", height: "32px", fontSize: "14px" }}
                            defaultValue="$6,776"
                            aria-label="Indirect actual"
                          />
                        </td>
                        <td className="num var-pos">−$8,224</td>
                        <td>
                          <span className="prov prov-entered">
                            <Pencil className="ic" aria-hidden="true" />
                            Entered · override
                          </span>
                        </td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>Total</td>
                        <td className="num">$150,000</td>
                        <td className="num">$74,536</td>
                        <td className="num var-pos">−$75,464</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="card-b" style={{ borderTop: "1px solid #D6DEDE" }}>
                  <div className="fld">
                    <label className="lbl" htmlFor="var-note">
                      Explain variances over 5%
                    </label>
                    <textarea
                      className="ta"
                      id="var-note"
                      style={{ fontSize: "15px" }}
                      defaultValue="Fuel costs ran above the lease estimate when the Hollow Road stop was added in September; we expect to absorb the difference within Supplies by year end."
                    />
                  </div>
                </div>
              </div>
              <div className="card" id="narr">
                <div className="card-h">
                  <div>
                    <h2 style={{ fontSize: "18px" }}>Narrative progress</h2>
                    <p className="small muted">What happened this period, in 300 words or fewer.</p>
                  </div>
                  <span className="bdg bdg-ok">
                    <CircleCheck className="ic" aria-hidden="true" />
                    Complete
                  </span>
                </div>
                <div className="card-b">
                  <div className="fld">
                    <label className="lbl" htmlFor="narr-text">
                      Progress against the approved plan
                      <span className="req" aria-hidden="true">
                        *
                      </span>
                    </label>
                    <textarea
                      className="ta"
                      id="narr-text"
                      style={{ minHeight: "140px", fontSize: "16px" }}
                      defaultValue="Both navigators started June 2 and the full six-stop route has run weekly since July 14. Families served reached 212 against a first-period target of 180. The Copper Valley Clinic telehealth room opened to our referrals in September, which cut the longest trip on the route from 46 to 11 miles for 31 families."
                    />
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="help">Shared with Riverbend when you submit.</span>
                      <span className="counter">71 / 300 words</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="card" id="cert">
                <div className="card-h">
                  <div>
                    <h2 style={{ fontSize: "18px" }}>Certification</h2>
                  </div>
                  <span className="bdg bdg-neutral">
                    <Circle className="ic" aria-hidden="true" />
                    Not started
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <label className="cb" htmlFor="cert-cb">
                    <input type="checkbox" id="cert-cb" className="sr" />
                    <span className="c" aria-hidden="true"></span>
                    <span>
                      I certify that the figures above are accurate to the best of my knowledge and that funds were spent on the approved
                      purpose. Signed as Maria Santos, Executive Director; the time and document hash are recorded.
                    </span>
                  </label>
                  <span className="help">
                    Submitting is a human gate: an agent can prepare this report but cannot submit it (
                    <Link to="/w/alder-creek/team">Team & access → Agents</Link>).
                  </span>
                </div>
              </div>
            </section>
            <aside className="card" style={{ overflow: "hidden" }}>
              <div className="panel-tabs" role="tablist">
                <button className="tab on" role="tab" aria-selected="true">
                  Validation
                  <span className="n" style={{ background: "#FCEFD3", color: "#7A4A00" }}>
                    1
                  </span>
                </button>
                <button className="tab" role="tab">
                  Comments
                </button>
                <button className="tab" role="tab">
                  Assignments
                </button>
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div>
                  <div className="eyebrow" style={{ color: "#0B5E47" }}>
                    Blockers · 0
                  </div>
                  <p className="small muted" style={{ marginTop: "6px" }}>
                    Nothing stops submission. Certification is required and is checked on submit.
                  </p>
                </div>
                <div>
                  <div className="eyebrow" style={{ color: "#7A4A00" }}>
                    Warnings · 1
                  </div>
                  <ul style={{ marginTop: "8px" }}>
                    <li>
                      <a href="#act" className="rc-row" style={{ padding: "8px 0", border: "0", textDecoration: "none", color: "inherit" }}>
                        <TriangleExclamationPoint className="ic" aria-hidden="true" style={{ color: "#7A4A00" }} />
                        <div>
                          <div className="l">Actuals exceed approved Travel by 8%</div>
                          <div className="r">Riverbend asks for an explanation above 5%; you have one.</div>
                        </div>
                        <span className="fix">View →</span>
                      </a>
                    </li>
                  </ul>
                </div>
                <div className="divider"></div>
                <div>
                  <div className="eyebrow">What accepting does</div>
                  <ul style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px", fontSize: "13px" }}>
                    <li className="row" style={{ gap: "6px" }}>
                      <Check className="ic" aria-hidden="true" style={{ color: "#145450" }} />
                      Tranche 2 ($60,000) moves to Due
                    </li>
                    <li className="row" style={{ gap: "6px" }}>
                      <Check className="ic" aria-hidden="true" style={{ color: "#145450" }} />
                      Figures become the “prior report” for the final
                    </li>
                    <li className="row" style={{ gap: "6px" }}>
                      <Check className="ic" aria-hidden="true" style={{ color: "#145450" }} />
                      You can share it with another funder
                    </li>
                  </ul>
                </div>
              </div>
            </aside>
          </div>
          <div className="card" id="share">
            <div className="card-h">
              <div>
                <h2 style={{ fontSize: "18px" }}>Share this report with another funder</h2>
                <p className="small muted">
                  Shown after Riverbend accepts the report (preview). Report once, share the accepted version instead of retyping it.
                </p>
              </div>
              <span className="bdg bdg-ok">
                <CircleCheck className="ic" aria-hidden="true" />
                Accepted Dec 12, 2027
              </span>
            </div>
            <div
              className="card-b"
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.2fr)",
                gap: "24px",
                alignItems: "start",
              }}
            >
              <div className="fld">
                <label className="lbl" htmlFor="share-funder">
                  Funder on the GMS
                </label>
                <select className="sel" id="share-funder">
                  <option>Cascade County Health Department</option>
                  <option>Northwind Family Foundation</option>
                </select>
                <span className="help">Only funders you already have a relationship with appear here.</span>
              </div>
              <div className="fld">
                <span className="lbl">Fields and attachments</span>
                <label className="cb" htmlFor="sh1">
                  <input type="checkbox" id="sh1" className="sr" defaultChecked />
                  <span className="c on" aria-hidden="true">
                    <Check className="ic ic-sm" aria-hidden="true" />
                  </span>
                  <span>Narrative progress</span>
                </label>
                <label className="cb" htmlFor="sh2">
                  <input type="checkbox" id="sh2" className="sr" defaultChecked />
                  <span className="c on" aria-hidden="true">
                    <Check className="ic ic-sm" aria-hidden="true" />
                  </span>
                  <span>Outcomes to date</span>
                </label>
                <label className="cb" htmlFor="sh3">
                  <input type="checkbox" id="sh3" className="sr" />
                  <span className="c" aria-hidden="true"></span>
                  <span>Budget actuals (Riverbend-specific)</span>
                </label>
                <label className="cb" htmlFor="sh4">
                  <input type="checkbox" id="sh4" className="sr" defaultChecked />
                  <span className="c on" aria-hidden="true">
                    <Check className="ic ic-sm" aria-hidden="true" />
                  </span>
                  <span>Attachment: route map (PDF)</span>
                </label>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div className="bnr bnr-info">
                  <Info className="ic" aria-hidden="true" />
                  <div className="d" style={{ fontSize: "14px", margin: "0" }}>
                    Cascade County Health Department will receive the selected report content and attachments as submitted to Riverbend on
                    Dec 12, 2027. You can revoke this in Team & access.
                  </div>
                </div>
                <div className="row" style={{ gap: "10px" }}>
                  <button className="btn btn-primary">Share with Cascade County</button>
                  <Link to="/w/alder-creek/team" className="small b">
                    Manage funder access
                  </Link>
                </div>
              </div>
            </div>
          </div>
          <div id="states" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <span className="eyebrow">States · returned with comments · overdue</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px", alignItems: "start" }}>
              <div className="card">
                <div className="card-h">
                  <div className="row" style={{ gap: "10px" }}>
                    <span className="chip" style={{ "--tenant": "#7A4F01" } as CSSProperties}>
                      <span className="tdot" aria-hidden="true"></span>Cascade County Health Department
                    </span>
                    <h3>2026 final report</h3>
                  </div>
                  <span className="bdg bdg-warn">
                    <RotateCcw className="ic" aria-hidden="true" />
                    Returned
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div className="msg">
                    <span className="av av-n">CC</span>
                    <div className="bub">
                      <div className="hd">
                        <span className="who">Grants Office</span>
                        <span>Cascade County Health Department</span>
                        <span>· May 2, 2027</span>
                        <span className="shared-mark">Shared</span>
                      </div>
                      <div className="bd">
                        Please break “Outreach events” into clinics held and doses administered; the county dashboard reports them
                        separately. Everything else is accepted.
                      </div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: "10px" }}>
                    <a href="#editor" className="btn btn-primary">
                      Respond and resubmit
                    </a>
                    <span className="help">Only the returned section reopens; accepted sections stay locked.</span>
                  </div>
                </div>
              </div>
              <div className="bnr bnr-dng">
                <TriangleExclamationPoint className="ic" aria-hidden="true" />
                <div>
                  <div className="t">Interim report is overdue</div>
                  <div className="d">
                    Due Dec 15, 2027 · 4 days late. Tranche 2 ($60,000) stays Held until Riverbend accepts the report, and Riverbend has
                    been notified.
                  </div>
                  <div className="clears">
                    <Check className="ic ic-sm" aria-hidden="true" />
                    Clears when the report is submitted and accepted
                  </div>
                </div>
                <a href="#editor" className="btn btn-sm btn-secondary act">
                  Open report
                </a>
              </div>
            </div>
          </div>
        </main>
      </ApplicantShell>
    </>
  );
}
