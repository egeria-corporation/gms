// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import {
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock,
  Database,
  Eye,
  FileText,
  Info,
  Mail,
  Plus,
  RotateCcw,
  Send,
  Shield,
  TriangleExclamationPoint,
} from "lucide-react";
import { FunderShell } from "../../components/shells.tsx";

export default function Reporting() {
  return (
    <>
      <title>{"Reporting & compliance — Riverbend funder workspace"}</title>
      <FunderShell active="Reporting">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/riverbend">Riverbend</Link>
            <span>›</span>
            <span>Reporting & compliance</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Reporting & compliance</h1>
              </div>
              <div className="meta">
                <span>7 requirements across 5 awards</span>
                <span>·</span>
                <span>2 received</span>
                <span>·</span>
                <span style={{ color: "#9B1C1C", fontWeight: 700 }}>1 overdue</span>
              </div>
            </div>
            <div className="actions">
              <div className="seg" role="group" aria-label="View">
                <Link to="/w/riverbend/reporting" className="on">
                  Month
                </Link>
                <Link to="/w/riverbend/reporting">List</Link>
              </div>
              <Link to="/w/riverbend/forms/loi-v2/edit" className="btn btn-secondary">
                <FileText className="ic" aria-hidden="true" />
                Report forms
              </Link>
              <button className="btn btn-primary">
                <Plus className="ic" aria-hidden="true" />
                Add requirement
              </button>
            </div>
          </div>
          <div className="tabs" role="tablist" aria-label="Requirement views">
            <Link to="/w/riverbend/reporting" className="tab on" role="tab" aria-selected="true">
              All<span className="n">7</span>
            </Link>
            <a href="#received" className="tab" role="tab">
              Received
              <span className="n" style={{ background: "#E3EDFB", color: "#1E4F8F" }}>
                2
              </span>
            </a>
            <a href="#overdue" className="tab" role="tab">
              Overdue
              <span className="n" style={{ background: "#FBE3E3", color: "#9B1C1C" }}>
                1
              </span>
            </a>
            <Link to="/w/riverbend/reporting" className="tab" role="tab">
              Waived
            </Link>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "400px minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
            <div className="card">
              <div className="card-h">
                <div className="row" style={{ gap: "8px" }}>
                  <button className="iconbtn" style={{ width: "28px", height: "28px" }} aria-label="Previous month">
                    <ChevronLeft className="ic" aria-hidden="true" />
                  </button>
                  <h3>May 2027</h3>
                  <button className="iconbtn" style={{ width: "28px", height: "28px" }} aria-label="Next month">
                    <ChevronRight className="ic" aria-hidden="true" />
                  </button>
                </div>
                <span className="small muted">Today · May 25</span>
              </div>
              <div className="card-b" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <div className="cal" role="grid" aria-label="May 2027 due dates">
                  <div className="wd">Sun</div>
                  <div className="wd">Mon</div>
                  <div className="wd">Tue</div>
                  <div className="wd">Wed</div>
                  <div className="wd">Thu</div>
                  <div className="wd">Fri</div>
                  <div className="wd">Sat</div>
                  <div className="d dim">25</div>
                  <div className="d dim">26</div>
                  <div className="d dim">27</div>
                  <div className="d dim">28</div>
                  <div className="d dim">29</div>
                  <div className="d dim" style={{ opacity: 1, borderColor: "#F1B4B4" }} title="Apr 30 · Lakeside final report overdue">
                    30
                    <div className="dots">
                      <i style={{ background: "#9B1C1C" }}></i>
                    </div>
                  </div>
                  <div className="d">1</div>
                  <div className="d">2</div>
                  <div className="d">3</div>
                  <div className="d">4</div>
                  <div className="d">5</div>
                  <div className="d">6</div>
                  <div className="d">7</div>
                  <div className="d">8</div>
                  <div className="d">9</div>
                  <div className="d">10</div>
                  <div className="d">11</div>
                  <div className="d">12</div>
                  <div className="d">13</div>
                  <div className="d">14</div>
                  <div className="d" title="May 15 · Cedar Hollow progress report accepted">
                    15
                    <div className="dots">
                      <i style={{ background: "#29A79F" }}></i>
                    </div>
                  </div>
                  <div className="d">16</div>
                  <div className="d">17</div>
                  <div className="d">18</div>
                  <div className="d">19</div>
                  <div className="d" title="May 20 · Northgate progress report">
                    20
                    <div className="dots">
                      <i style={{ background: "#29A79F" }}></i>
                    </div>
                  </div>
                  <div className="d">21</div>
                  <div className="d">22</div>
                  <div className="d">23</div>
                  <div className="d">24</div>
                  <div className="d today" aria-current="date">
                    25
                  </div>
                  <div className="d">26</div>
                  <div className="d">27</div>
                  <div className="d">28</div>
                  <div className="d">29</div>
                  <div className="d">30</div>
                  <div className="d" title="May 31 · Harbor Light quarterly financial due">
                    31
                    <div className="dots">
                      <i style={{ background: "#7A4A00" }}></i>
                    </div>
                  </div>
                  <div className="d dim">1</div>
                  <div className="d dim">2</div>
                  <div className="d dim">3</div>
                  <div className="d dim">4</div>
                  <div className="d dim">5</div>
                </div>
                <div className="row small muted" style={{ gap: "14px", flexWrap: "wrap" }}>
                  <span className="row" style={{ gap: "5px" }}>
                    <i style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#7A4A00", display: "inline-block" }}></i>Due
                  </span>
                  <span className="row" style={{ gap: "5px" }}>
                    <i style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#9B1C1C", display: "inline-block" }}></i>
                    Overdue
                  </span>
                  <span className="row" style={{ gap: "5px" }}>
                    <i style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#29A79F", display: "inline-block" }}></i>
                    Received / accepted
                  </span>
                </div>
              </div>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Award</th>
                    <th>Grantee</th>
                    <th>Requirement</th>
                    <th>Due</th>
                    <th>Status</th>
                    <th>Reminders</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="mono">
                        awd_01J2Q7
                      </Link>
                    </td>
                    <td className="b">Alder Creek Family Services</td>
                    <td>Interim report · releases tranche 2</td>
                    <td>Dec 15, 2027</td>
                    <td>
                      <span className="bdg bdg-neutral">
                        <Calendar className="ic" aria-hidden="true" />
                        Scheduled
                      </span>
                    </td>
                    <td className="small muted">Planned −30 · −7 · −1</td>
                    <td>
                      <button className="btn btn-sm btn-ghost">Open</button>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="mono">
                        awd_01HQ22
                      </Link>
                    </td>
                    <td className="b">Harbor Light Shelter</td>
                    <td>Interim report (2026)</td>
                    <td>Jan 15, 2027</td>
                    <td>
                      <span className="bdg bdg-ok">
                        <CircleCheck className="ic" aria-hidden="true" />
                        Accepted
                      </span>
                    </td>
                    <td className="small muted">Jan 20 · Dana Ortiz</td>
                    <td>
                      <button className="btn btn-sm btn-ghost">Open</button>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="mono">
                        awd_01HQ22
                      </Link>
                    </td>
                    <td className="b">Harbor Light Shelter</td>
                    <td>Quarterly financial</td>
                    <td>May 31, 2027</td>
                    <td>
                      <span className="bdg bdg-warn">
                        <Clock className="ic" aria-hidden="true" />
                        Due
                      </span>
                    </td>
                    <td className="small muted">−7 sent May 24 · −1 scheduled</td>
                    <td>
                      <button className="btn btn-sm btn-ghost">Open</button>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Link to="/w/riverbend/awards/awd_01J2Q7/payments" className="mono">
                        awd_01HQ22
                      </Link>
                    </td>
                    <td className="b">Harbor Light Shelter</td>
                    <td>Final report · releases tranche 3</td>
                    <td>Jul 15, 2027</td>
                    <td>
                      <span className="bdg bdg-neutral">
                        <Calendar className="ic" aria-hidden="true" />
                        Scheduled
                      </span>
                    </td>
                    <td className="small muted">−30 scheduled Jun 15</td>
                    <td>
                      <button className="btn btn-sm btn-ghost">Open</button>
                    </td>
                  </tr>
                  <tr style={{ background: "#FFF8F8" }}>
                    <td>
                      <Link to="/w/riverbend/awards/awd_01J2Q7/agreement" className="mono">
                        awd_01HQ31
                      </Link>
                    </td>
                    <td className="b">
                      Lakeside Senior Center <span className="xs muted">(2026)</span>
                    </td>
                    <td>Final report · releases tranche 2</td>
                    <td>Apr 30, 2027</td>
                    <td>
                      <span className="bdg bdg-dng">
                        <TriangleExclamationPoint className="ic" aria-hidden="true" />
                        Overdue · 25 days
                      </span>
                    </td>
                    <td className="small muted">−14 · −7 · −1 sent · overdue +7 sent May 7</td>
                    <td>
                      <a href="#overdue" className="btn btn-sm btn-secondary">
                        <Mail className="ic ic-sm" aria-hidden="true" />
                        Send reminder
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Link to="/w/riverbend/awards/awd_01J2Q7/agreement" className="mono">
                        awd_01HQ27
                      </Link>
                    </td>
                    <td className="b">
                      Northgate Housing Trust <span className="xs muted">(2026)</span>
                    </td>
                    <td>Progress report · releases tranche 2</td>
                    <td>May 20, 2027</td>
                    <td>
                      <span className="bdg bdg-info">
                        <Send className="ic" aria-hidden="true" />
                        Submitted · May 22
                      </span>
                    </td>
                    <td className="small muted">—</td>
                    <td>
                      <a href="#received" className="btn btn-sm btn-primary">
                        Review
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Link to="/w/riverbend/awards/awd_01J2Q7/agreement" className="mono">
                        awd_01HQ29
                      </Link>
                    </td>
                    <td className="b">
                      Cedar Hollow Food Bank <span className="xs muted">(2026)</span>
                    </td>
                    <td>Progress report</td>
                    <td>May 15, 2027</td>
                    <td>
                      <span className="bdg bdg-ok">
                        <CircleCheck className="ic" aria-hidden="true" />
                        Accepted
                      </span>
                    </td>
                    <td className="small muted">May 17 · Dana Ortiz</td>
                    <td>
                      <button className="btn btn-sm btn-ghost">Open</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
            <div className="card" id="received">
              <div className="card-h">
                <div>
                  <h3>Received queue</h3>
                  <p className="small muted">
                    Submissions waiting for a program officer. Accepting a report that gates a tranche moves that tranche to Due.
                  </p>
                </div>
                <span className="bdg bdg-info">
                  <Send className="ic" aria-hidden="true" />2 submitted
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    padding: "14px 20px",
                    borderBottom: "1px solid #D6DEDE",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                    background: "#F7FAFA",
                  }}
                >
                  <div className="row" style={{ justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                    <div>
                      <div className="row" style={{ gap: "8px" }}>
                        <span className="b" style={{ color: "#0D2A43" }}>
                          Northgate Housing Trust
                        </span>
                        <span className="lvl lvl-3">
                          <Shield className="ic" aria-hidden="true" />
                          L3
                        </span>
                      </div>
                      <div className="small muted">
                        Progress report · awd_01HQ27 · submitted May 22 by Theo Banks · form “Progress report v2”
                      </div>
                    </div>
                    <span className="bdg bdg-prog">
                      <Eye className="ic" aria-hidden="true" />
                      Under review · you
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "12px" }}>
                    <div className="card" style={{ padding: "12px 14px" }}>
                      <div className="stat-l">Households served</div>
                      <div className="stat-v" style={{ fontSize: "22px" }}>
                        412
                      </div>
                      <div className="stat-d">
                        target 350 ·<span style={{ color: "#0B5E47" }}>+18%</span>
                      </div>
                    </div>
                    <div className="card" style={{ padding: "12px 14px" }}>
                      <div className="stat-l">Spent to date</div>
                      <div className="stat-v" style={{ fontSize: "22px" }}>
                        $48,200
                      </div>
                      <div className="stat-d">
                        of $50,000 tranche 1 ·
                        <span className="prov prov-qb">
                          <Database className="ic" aria-hidden="true" />
                          From QuickBooks
                        </span>
                      </div>
                    </div>
                    <div className="card" style={{ padding: "12px 14px" }}>
                      <div className="stat-l">Attachments</div>
                      <div className="stat-v" style={{ fontSize: "22px" }}>
                        2
                      </div>
                      <div className="stat-d">Budget actuals.xlsx · Photos.pdf</div>
                    </div>
                  </div>
                  <p
                    className="small"
                    style={{
                      borderLeft: "0",
                      padding: "10px 12px",
                      background: "#FFFFFF",
                      border: "1px solid #D6DEDE",
                      borderRadius: "8px",
                    }}
                  >
                    “Navigators placed 61 households into stable housing this period, ahead of plan. Health screenings were added at intake
                    in March after the partnership with Copper Valley Clinic began…” <a href="#received">Read full report</a>
                  </p>
                  <div className="fld">
                    <label className="lbl" htmlFor="ret-note">
                      Return with comment
                      <span className="muted" style={{ fontWeight: 400 }}>
                        (only if returning)
                      </span>
                    </label>
                    <textarea
                      className="ta"
                      id="ret-note"
                      style={{ minHeight: "60px" }}
                      placeholder="What needs to change before this report can be accepted?"
                    />
                  </div>
                  <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
                    <Link to="/w/riverbend/payments/due" className="btn btn-primary">
                      <Check className="ic" aria-hidden="true" />
                      Accept report
                    </Link>
                    <button className="btn btn-secondary">
                      <RotateCcw className="ic" aria-hidden="true" />
                      Return
                    </button>
                    <span className="notice">
                      <Info className="ic" aria-hidden="true" style={{ color: "#1E4F8F" }} />
                      Accepting releases tranche 2 ($50,000) to<b>Due</b>in the Payments center.
                    </span>
                  </div>
                </div>
                <div
                  style={{
                    padding: "14px 20px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div className="row" style={{ gap: "8px" }}>
                      <span className="b" style={{ color: "#0D2A43" }}>
                        Alder Creek Family Services
                      </span>
                      <span className="lvl lvl-3">
                        <Shield className="ic" aria-hidden="true" />
                        L3
                      </span>
                      <span className="tag">Flow 5 · later in the grant</span>
                    </div>
                    <div className="small muted">
                      Interim report · awd_01J2Q7 · submitted by Jamal Reed · prefilled “From prior report” and “From QuickBooks”
                    </div>
                  </div>
                  <div className="row" style={{ gap: "8px" }}>
                    <span className="bdg bdg-info">
                      <Send className="ic" aria-hidden="true" />
                      Submitted
                    </span>
                    <Link to="/w/riverbend/payments/due" className="btn btn-sm btn-primary">
                      Accept
                    </Link>
                    <button className="btn btn-sm btn-secondary">Review</button>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="card" id="overdue" style={{ borderColor: "#F1B4B4" }}>
                <div className="card-h">
                  <h3>Overdue</h3>
                  <span className="bdg bdg-dng">
                    <TriangleExclamationPoint className="ic" aria-hidden="true" />1
                  </span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "13px" }}>
                  <div className="row" style={{ justifyContent: "space-between", gap: "10px" }}>
                    <div>
                      <div className="b">Lakeside Senior Center · Final report</div>
                      <div className="small muted">Due Apr 30 · 25 days late · tranche 2 ($15,000) stays Held</div>
                    </div>
                    <span className="ck on" role="checkbox" aria-checked="true" aria-label="Select Lakeside Senior Center"></span>
                  </div>
                  <div className="row small muted" style={{ gap: "6px" }}>
                    <Mail className="ic ic-sm" aria-hidden="true" />4 reminders sent · last May 7 · opened, no reply
                  </div>
                  <div className="row" style={{ gap: "8px" }}>
                    <Link to="/preview/email/report-reminder" className="btn btn-primary btn-sm">
                      <Mail className="ic ic-sm" aria-hidden="true" />
                      Send reminder to 1
                    </Link>
                    <button className="btn btn-ghost btn-sm">Grant extension</button>
                    <button className="btn btn-ghost btn-sm">Waive</button>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Report forms</h3>
                  <Link to="/w/riverbend/forms/loi-v2/edit" className="small b">
                    Open form builder →
                  </Link>
                </div>
                <ul style={{ display: "flex", flexDirection: "column" }}>
                  <li
                    style={{
                      padding: "10px 20px",
                      borderBottom: "1px solid #EEF3F3",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "8px",
                      fontSize: "13px",
                    }}
                  >
                    <div>
                      <div className="b">Interim report form v2</div>
                      <div className="small muted">Reuses the form builder · prefill chips: prior report, QuickBooks</div>
                    </div>
                    <Link to="/w/riverbend/forms/loi-v2/edit" className="btn btn-sm btn-secondary">
                      Edit
                    </Link>
                  </li>
                  <li
                    style={{
                      padding: "10px 20px",
                      borderBottom: "1px solid #EEF3F3",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "8px",
                      fontSize: "13px",
                    }}
                  >
                    <div>
                      <div className="b">Final report form v3</div>
                      <div className="small muted">Adds outcomes table and closeout attestation</div>
                    </div>
                    <Link to="/w/riverbend/forms/loi-v2/edit" className="btn btn-sm btn-secondary">
                      Edit
                    </Link>
                  </li>
                  <li style={{ padding: "10px 20px", display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "13px" }}>
                    <div>
                      <div className="b">Quarterly financial v1</div>
                      <div className="small muted">Budget table only · actuals from QuickBooks</div>
                    </div>
                    <Link to="/w/riverbend/forms/loi-v2/edit" className="btn btn-sm btn-secondary">
                      Edit
                    </Link>
                  </li>
                </ul>
              </div>
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)",
              gap: "20px",
              marginTop: "8px",
              alignItems: "start",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">State · overdue bulk reminder confirmation</span>
              <div className="mdl" style={{ width: "auto", boxShadow: "none", border: "1px solid #D6DEDE" }}>
                <div className="hd">
                  <div>
                    <h3 style={{ fontSize: "16px" }}>Send overdue reminder to 1 grantee?</h3>
                    <p className="small muted" style={{ marginTop: "4px" }}>
                      Lakeside Senior Center receives the letter below from Riverbend Community Foundation. The send is logged in
                      Communications.
                    </p>
                  </div>
                </div>
                <div className="bd">
                  <div className="fld">
                    <label className="lbl" htmlFor="rem-tpl">
                      Template
                    </label>
                    <select className="sel" id="rem-tpl">
                      <option>Report overdue v2</option>
                      <option>Report reminder −7 days v3</option>
                      <option>Final notice before suspension v1</option>
                    </select>
                  </div>
                  <div
                    style={{
                      border: "1px solid #D6DEDE",
                      borderRadius: "8px",
                      padding: "12px 14px",
                      fontSize: "13px",
                      background: "#F7FAFA",
                    }}
                  >
                    <b>Subject:</b> Your final report for Fall Prevention Program is 25 days overdue
                    <br />
                    <span className="muted">
                      Hi Rosa, the final report for awd_01HQ31 was due Apr 30, 2027. The remaining tranche of $15,000 is held until it is
                      accepted…
                    </span>
                  </div>
                  <div className="row small" style={{ gap: "14px" }}>
                    <span className="row" style={{ gap: "5px" }}>
                      <Check className="ic" aria-hidden="true" style={{ color: "#0B5E47" }} />1 email queued
                    </span>
                    <span className="row" style={{ gap: "5px" }}>
                      <Check className="ic" aria-hidden="true" style={{ color: "#0B5E47" }} />
                      Reminder status → “overdue +25 sent”
                    </span>
                  </div>
                </div>
                <div className="ft">
                  <button className="btn btn-secondary">Cancel</button>
                  <Link to="/preview/email/report-reminder" className="btn btn-primary">
                    Send reminder
                  </Link>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">State · nothing due</span>
              <div className="card empty" style={{ minHeight: "240px", justifyContent: "center" }}>
                <Calendar className="ic" aria-hidden="true" />
                <h3>Nothing due this month</h3>
                <p>
                  No requirements are due, received or overdue in June 2027. The next one is Harbor Light Shelter’s final report on Jul 15.
                </p>
                <div className="acts">
                  <button className="btn btn-primary">Add requirement</button>
                  <Link to="/w/riverbend/reporting" className="small b">
                    Jump to July
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </main>
      </FunderShell>
    </>
  );
}
