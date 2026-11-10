// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import {
  Award,
  Bell,
  Building,
  Calendar,
  Check,
  ClipboardCheck,
  Clock,
  Database,
  File,
  FileText,
  House,
  Menu,
  Pencil,
  RotateCcw,
  Shield,
} from "lucide-react";

export default function ReportsPhone() {
  return (
    <>
      <title>{"Reports — phone"}</title>
      <div
        className="gms gms-applicant gms-phone"
        style={
          {
            "--tenant": "#1F6F8B",
            "--on-tenant": "#FFFFFF",
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            background: "#F7FAFA",
            position: "relative",
          } as CSSProperties
        }
      >
        <header className="phone-bar">
          <button className="iconbtn" aria-label="Menu" style={{ width: "44px", height: "44px" }}>
            <Menu className="ic ic-md" aria-hidden="true" />
          </button>
          <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "24px", height: "24px" }} />
          <h1 style={{ fontSize: "17px", flex: 1, minWidth: "0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            Reports
          </h1>
          <Link to="/notifications" className="iconbtn" aria-label="Notifications, 2 unread" style={{ width: "44px", height: "44px" }}>
            <Bell className="ic ic-md" aria-hidden="true" />
            <span className="dot"></span>
          </Link>
          <Link
            to="/account/agents"
            className="av av-t"
            aria-label="Account: Maria Santos"
            style={{ width: "36px", height: "36px", fontSize: "12px" }}
          >
            MS
          </Link>
        </header>
        <main className="main" style={{ flex: 1 }}>
          <section style={{ display: "flex", flexDirection: "column", gap: "10px" }} aria-labelledby="due-h">
            <h2 id="due-h" style={{ fontSize: "20px" }}>
              Due across funders
            </h2>
            <a
              href="#editor"
              className="card"
              style={
                {
                  "--tenant": "#1F6F8B",
                  padding: "14px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  textDecoration: "none",
                  color: "inherit",
                  borderColor: "#E9C77D",
                } as CSSProperties
              }
            >
              <span className="chip" style={{ alignSelf: "flex-start" }}>
                <span className="tdot" aria-hidden="true"></span>Riverbend Community Foundation
              </span>
              <div className="b" style={{ fontSize: "16px", color: "#0D2A43" }}>
                Interim report · Mobile Health Navigation
              </div>
              <div className="row" style={{ justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                <span className="small muted">Due Dec 15, 2027 · releases tranche 2</span>
                <span className="bdg bdg-warn">
                  <Clock className="ic" aria-hidden="true" />
                  Due
                </span>
              </div>
            </a>
            <Link
              to="/w/alder-creek/reports"
              className="card"
              style={
                {
                  "--tenant": "#7A4F01",
                  padding: "14px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  textDecoration: "none",
                  color: "inherit",
                } as CSSProperties
              }
            >
              <span className="chip" style={{ alignSelf: "flex-start" }}>
                <span className="tdot" aria-hidden="true"></span>Cascade County Health Department
              </span>
              <div className="b" style={{ fontSize: "16px", color: "#0D2A43" }}>
                Progress report · Community Clinic Capacity
              </div>
              <div className="row" style={{ justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                <span className="small muted">Due Jun 30, 2027</span>
                <span className="bdg bdg-neutral">
                  <Calendar className="ic" aria-hidden="true" />
                  Scheduled
                </span>
              </div>
            </Link>
            <div
              className="card"
              style={{ "--tenant": "#7A4F01", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px" } as CSSProperties}
            >
              <span className="chip" style={{ alignSelf: "flex-start" }}>
                <span className="tdot" aria-hidden="true"></span>Cascade County Health Department
              </span>
              <div className="b" style={{ fontSize: "16px", color: "#0D2A43" }}>
                2026 final report · Clinic Outreach
              </div>
              <div className="row" style={{ justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                <span className="small muted">Returned Apr 22 · 2 comments</span>
                <span className="bdg bdg-warn">
                  <RotateCcw className="ic" aria-hidden="true" />
                  Returned
                </span>
              </div>
              <Link to="/w/alder-creek/reports" className="btn btn-secondary btn-lg btn-block">
                Respond to comments
              </Link>
            </div>
          </section>
          <section className="card" id="editor" aria-labelledby="ed-h">
            <div className="card-h" style={{ padding: "14px 16px", flexWrap: "wrap" }}>
              <div>
                <h3 id="ed-h" style={{ fontSize: "16px" }}>
                  Interim report
                </h3>
                <p className="small muted">Riverbend · Jul 1 – Nov 30, 2027</p>
              </div>
              <span className="bdg bdg-neutral">
                <Pencil className="ic" aria-hidden="true" />
                Draft
              </span>
            </div>
            <div className="card-b" style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="fld">
                <label className="lbl" htmlFor="served" style={{ flexWrap: "wrap" }}>
                  Families served
                  <span className="prov prov-report">
                    <File className="ic" aria-hidden="true" />
                    From prior report
                  </span>
                </label>
                <input className="inp" id="served" defaultValue="212" />
                <span className="help">Prior report: 38 (pilot). Enter the cumulative count for this period.</span>
              </div>
              <div className="fld">
                <label className="lbl" htmlFor="missed" style={{ flexWrap: "wrap" }}>
                  Missed appointments avoided
                  <span className="prov prov-entered">
                    <Pencil className="ic" aria-hidden="true" />
                    Entered
                  </span>
                </label>
                <input className="inp" id="missed" defaultValue="146" />
              </div>
              <div className="fld">
                <span className="lbl" style={{ flexWrap: "wrap" }}>
                  Budget actuals
                  <span className="prov prov-qb">
                    <Database className="ic" aria-hidden="true" />
                    From QuickBooks
                  </span>
                </span>
                <div style={{ border: "1px solid #D6DEDE", borderRadius: "8px", overflow: "hidden", background: "#fff", fontSize: "14px" }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      padding: "8px 12px",
                      background: "#F7FAFA",
                      fontSize: "11px",
                      fontWeight: 700,
                      letterSpacing: ".06em",
                      textTransform: "uppercase",
                      color: "#4A5C5A",
                      borderBottom: "1px solid #D6DEDE",
                    }}
                  >
                    <span>Category</span>
                    <span className="num">Actual / approved</span>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      padding: "10px 12px",
                      borderBottom: "1px solid #EEF3F3",
                      gap: "4px",
                    }}
                  >
                    <span>Personnel</span>
                    <span className="num">
                      <span className="b">$41,200</span> / $96,000
                      <br />
                      <span className="small var-pos">on pace</span>
                    </span>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      padding: "10px 12px",
                      borderBottom: "1px solid #EEF3F3",
                      gap: "4px",
                    }}
                  >
                    <span>Travel & vehicle</span>
                    <span className="num">
                      <span className="b">$15,900</span> / $28,000
                      <br />
                      <span className="small var-neg">+$4,200 over pace</span>
                    </span>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      padding: "10px 12px",
                      borderBottom: "1px solid #EEF3F3",
                      gap: "4px",
                    }}
                  >
                    <span>Supplies</span>
                    <span className="num">
                      <span className="b">$3,850</span> / $11,000
                      <br />
                      <span className="small var-pos">under pace</span>
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", padding: "10px 12px", gap: "4px" }}>
                    <span>Indirect</span>
                    <span className="num">
                      <span className="b">$6,100</span> / $15,000
                      <br />
                      <span className="small var-pos">on pace</span>
                    </span>
                  </div>
                </div>
                <span className="help">
                  Synced from QuickBooks 1 h ago · <Link to="/w/alder-creek/grants/awd_01J2Q7">map categories</Link>
                </span>
              </div>
              <div className="fld">
                <label className="lbl" htmlFor="narr">
                  Progress narrative
                  <span className="req" aria-hidden="true">
                    *
                  </span>
                </label>
                <textarea
                  className="ta"
                  id="narr"
                  style={{ minHeight: "160px", fontSize: "16px" }}
                  defaultValue="Both navigators started in August and the van route reached all six communities by October. Vehicle costs ran ahead of plan because of a fall repair; we expect to absorb it within the travel line by spring."
                />
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="help">Shared with Riverbend on submit.</span>
                  <span className="counter">48 / 300 words</span>
                </div>
              </div>
              <label className="cb" htmlFor="cert" style={{ fontSize: "15px", minHeight: "44px", alignItems: "center" }}>
                <input type="checkbox" id="cert" className="sr" />
                <span className="c on" aria-hidden="true">
                  <Check className="ic ic-sm" aria-hidden="true" />
                </span>
                I certify this report is accurate and complete. Maria Santos, Executive Director.
              </label>
              <Link to="/w/alder-creek/reports" className="btn btn-primary btn-lg btn-block">
                Submit report
              </Link>
            </div>
          </section>
          <section className="card" aria-labelledby="share-h">
            <div className="card-h" style={{ padding: "14px 16px" }}>
              <div>
                <h3 id="share-h" style={{ fontSize: "16px" }}>
                  Share with another funder
                </h3>
                <p className="small muted">After acceptance, reuse this report instead of writing it again.</p>
              </div>
            </div>
            <div className="card-b" style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: "14px" }}>
              <div className="fld">
                <label className="lbl" htmlFor="funder">
                  Funder on the GMS
                </label>
                <select className="sel" id="funder">
                  <option>Cascade County Health Department</option>
                  <option>Riverbend Community Foundation</option>
                </select>
              </div>
              <div className="fld">
                <span className="lbl">Include</span>
                <label className="cb" htmlFor="f1" style={{ minHeight: "44px", alignItems: "center" }}>
                  <input type="checkbox" id="f1" className="sr" />
                  <span className="c on" aria-hidden="true">
                    <Check className="ic ic-sm" aria-hidden="true" />
                  </span>
                  Families served and outcomes
                </label>
                <label className="cb" htmlFor="f2" style={{ minHeight: "44px", alignItems: "center" }}>
                  <input type="checkbox" id="f2" className="sr" />
                  <span className="c on" aria-hidden="true">
                    <Check className="ic ic-sm" aria-hidden="true" />
                  </span>
                  Progress narrative
                </label>
                <label className="cb" htmlFor="f3" style={{ minHeight: "44px", alignItems: "center" }}>
                  <input type="checkbox" id="f3" className="sr" />
                  <span className="c" aria-hidden="true"></span>Budget actuals (Riverbend award only)
                </label>
                <label className="cb" htmlFor="f4" style={{ minHeight: "44px", alignItems: "center" }}>
                  <input type="checkbox" id="f4" className="sr" />
                  <span className="c on" aria-hidden="true">
                    <Check className="ic ic-sm" aria-hidden="true" />
                  </span>
                  Attachments: route map, partner letter
                </label>
              </div>
              <div className="bnr bnr-neu" style={{ padding: "10px 12px" }}>
                <Shield className="ic" aria-hidden="true" />
                <div className="d" style={{ fontSize: "13px", margin: "0" }}>
                  You are sharing a copy of the selected fields with Cascade County Health Department. They see the source (“Riverbend
                  interim report, Dec 2027”) and cannot edit it. You can revoke this share at any time.
                </div>
              </div>
              <button className="btn btn-primary btn-lg btn-block">Share with Cascade County</button>
            </div>
          </section>
        </main>
        <nav className="phone-tabs" aria-label="Primary" style={{ position: "sticky", bottom: "0" }}>
          <Link to="/w/alder-creek">
            <House className="ic ic-md" aria-hidden="true" />
            Home
          </Link>
          <Link to="/w/alder-creek/applications/app_01HZX4/edit">
            <FileText className="ic ic-md" aria-hidden="true" />
            Apply
          </Link>
          <Link to="/w/alder-creek/grants/awd_01J2Q7">
            <Award className="ic ic-md" aria-hidden="true" />
            Grants
          </Link>
          <Link to="/w/alder-creek/reports" className="on" aria-current="page">
            <ClipboardCheck className="ic ic-md" aria-hidden="true" />
            Reports
          </Link>
          <Link to="/w/alder-creek/organization">
            <Building className="ic ic-md" aria-hidden="true" />
            Org
          </Link>
        </nav>
      </div>
    </>
  );
}
