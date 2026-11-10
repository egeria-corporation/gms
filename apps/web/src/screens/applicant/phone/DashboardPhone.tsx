// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import {
  Award,
  BadgeCheck,
  Bell,
  Building,
  Calendar,
  CircleCheck,
  ClipboardCheck,
  Clock,
  FileText,
  House,
  Menu,
  Pencil,
  RotateCcw,
  Send,
  Shield,
} from "lucide-react";

export default function DashboardPhone() {
  return (
    <>
      <title>{"Applicant dashboard — phone"}</title>
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
            Dashboard
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
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span className="eyebrow">Alder Creek Family Services</span>
            <h2 style={{ fontSize: "22px" }}>Good morning, Maria</h2>
          </div>
          <section className="card" aria-labelledby="ready-h">
            <div className="card-h" style={{ padding: "14px 16px" }}>
              <h3 id="ready-h" style={{ fontSize: "16px" }}>
                Passport readiness
              </h3>
              <span className="lvl lvl-3">
                <Shield className="ic" aria-hidden="true" />
                L3
              </span>
            </div>
            <div className="card-b" style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <ul className="rc" style={{ fontSize: "15px" }}>
                <li className="rc-row rc-pass" style={{ borderTop: "0", padding: "8px 0" }}>
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="l">Identity verified</div>
                    <div className="r">Representatives confirmed Jan 12, 2027</div>
                  </div>
                  <span></span>
                </li>
                <li className="rc-row rc-pass" style={{ padding: "8px 0" }}>
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="l">Documents verified</div>
                    <div className="r">Determination letter, financials, insurance</div>
                  </div>
                  <span></span>
                </li>
                <li className="rc-row rc-pass" style={{ padding: "8px 0" }}>
                  <CircleCheck className="ic" aria-hidden="true" />
                  <div>
                    <div className="l">Payee verified</div>
                    <div className="r">River City Credit Union •••• 4821</div>
                  </div>
                  <span></span>
                </li>
              </ul>
              <Link to="/w/alder-creek/organization" className="btn btn-secondary btn-lg btn-block">
                Manage in Passport
              </Link>
            </div>
          </section>
          <section style={{ display: "flex", flexDirection: "column", gap: "10px" }} aria-labelledby="apps-h">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3 id="apps-h" style={{ fontSize: "16px" }}>
                Active applications
              </h3>
              <Link to="/w/alder-creek/find" className="small b">
                Find funding
              </Link>
            </div>
            <Link
              to="/w/alder-creek/applications/app_01HZX4/edit"
              className="card"
              style={
                {
                  "--tenant": "#1F6F8B",
                  padding: "14px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  textDecoration: "none",
                  color: "inherit",
                } as CSSProperties
              }
            >
              <span className="chip" style={{ alignSelf: "flex-start" }}>
                <span className="tdot" aria-hidden="true"></span>Riverbend Community Foundation
              </span>
              <div style={{ fontWeight: 700, color: "#0D2A43", fontSize: "17px", lineHeight: 1.3 }}>
                Mobile Health Navigation for Rural Families
              </div>
              <div className="row wrap" style={{ gap: "8px" }}>
                <span className="small muted">Full proposal</span>
                <span className="bdg bdg-neutral">
                  <Pencil className="ic" aria-hidden="true" />
                  Draft
                </span>
              </div>
              <div className="row" style={{ justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                <span className="row small b" style={{ gap: "5px", color: "#7A4A00" }}>
                  <Clock className="ic" aria-hidden="true" />
                  Closes Apr 30 · 14 days
                </span>
                <span className="pres" aria-label="Assigned: Maria Santos, Jamal Reed, Lena Fischer">
                  <span className="av av-t">MS</span>
                  <span className="av">JR</span>
                  <span className="av av-g">LF</span>
                </span>
              </div>
            </Link>
            <Link
              to="/w/alder-creek/applications/app_01HZX4"
              className="card"
              style={
                {
                  "--tenant": "#7A4F01",
                  padding: "14px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  textDecoration: "none",
                  color: "inherit",
                } as CSSProperties
              }
            >
              <span className="chip" style={{ alignSelf: "flex-start" }}>
                <span className="tdot" aria-hidden="true"></span>Cascade County Health Department
              </span>
              <div style={{ fontWeight: 700, color: "#0D2A43", fontSize: "17px", lineHeight: 1.3 }}>Community Clinic Capacity</div>
              <div className="row wrap" style={{ gap: "8px" }}>
                <span className="small muted">LOI</span>
                <span className="bdg bdg-info">
                  <Send className="ic" aria-hidden="true" />
                  Submitted
                </span>
              </div>
              <div className="row" style={{ justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                <span className="small muted">Decision expected Jun 30</span>
                <span className="pres" aria-label="Assigned: Maria Santos">
                  <span className="av av-t">MS</span>
                </span>
              </div>
            </Link>
          </section>
          <section className="card" aria-labelledby="rep-h">
            <div className="card-h" style={{ padding: "14px 16px" }}>
              <h3 id="rep-h" style={{ fontSize: "16px" }}>
                Reports due
              </h3>
              <Link to="/w/alder-creek/reports" className="small b">
                All reports
              </Link>
            </div>
            <ul style={{ display: "flex", flexDirection: "column" }}>
              <li>
                <Link
                  to="/w/alder-creek/reports"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "12px 16px",
                    minHeight: "56px",
                    textDecoration: "none",
                    color: "inherit",
                    borderBottom: "1px solid #EEF3F3",
                  }}
                >
                  <span className="chip" style={{ "--tenant": "#1F6F8B" } as CSSProperties}>
                    <span className="tdot" aria-hidden="true"></span>Riverbend
                  </span>
                  <div className="grow">
                    <div className="b" style={{ fontSize: "15px" }}>
                      Interim report
                    </div>
                    <div className="small muted">Due Dec 15, 2027</div>
                  </div>
                  <span className="bdg bdg-warn">
                    <Clock className="ic" aria-hidden="true" />
                    Due
                  </span>
                </Link>
              </li>
              <li>
                <Link
                  to="/w/alder-creek/reports"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "12px 16px",
                    minHeight: "56px",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <span className="chip" style={{ "--tenant": "#7A4F01" } as CSSProperties}>
                    <span className="tdot" aria-hidden="true"></span>Cascade
                  </span>
                  <div className="grow">
                    <div className="b" style={{ fontSize: "15px" }}>
                      2026 final report
                    </div>
                    <div className="small muted">Returned Apr 22 with comments</div>
                  </div>
                  <span className="bdg bdg-warn">
                    <RotateCcw className="ic" aria-hidden="true" />
                    Returned
                  </span>
                </Link>
              </li>
            </ul>
          </section>
          <section className="card" aria-labelledby="pay-h">
            <div className="card-h" style={{ padding: "14px 16px" }}>
              <h3 id="pay-h" style={{ fontSize: "16px" }}>
                Payments
              </h3>
              <Link to="/w/alder-creek/grants/awd_01J2Q7" className="small b">
                My grants
              </Link>
            </div>
            <div className="card-b" style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <Link
                to="/w/alder-creek/grants/awd_01J2Q7"
                style={{ display: "flex", flexDirection: "column", gap: "6px", textDecoration: "none", color: "inherit" }}
              >
                <div className="row" style={{ justifyContent: "space-between", gap: "8px" }}>
                  <span className="b" style={{ fontSize: "15px" }}>
                    Riverbend · Tranche 1 of 3
                  </span>
                  <span className="b" style={{ fontVariantNumeric: "tabular-nums" }}>
                    $75,000
                  </span>
                </div>
                <div className="row wrap" style={{ gap: "8px" }}>
                  <span className="bdg bdg-ok">
                    <BadgeCheck className="ic" aria-hidden="true" />
                    Settled
                  </span>
                  <span className="small muted">May 25 · River City Credit Union •••• 4821</span>
                </div>
              </Link>
              <div className="divider"></div>
              <Link
                to="/w/alder-creek/grants/awd_01J2Q7"
                style={{ display: "flex", flexDirection: "column", gap: "6px", textDecoration: "none", color: "inherit" }}
              >
                <div className="row" style={{ justifyContent: "space-between", gap: "8px" }}>
                  <span className="b" style={{ fontSize: "15px" }}>
                    Riverbend · Tranche 2 of 3
                  </span>
                  <span className="b" style={{ fontVariantNumeric: "tabular-nums" }}>
                    $60,000
                  </span>
                </div>
                <div className="row wrap" style={{ gap: "8px" }}>
                  <span className="bdg bdg-neutral">
                    <Calendar className="ic" aria-hidden="true" />
                    Scheduled
                  </span>
                  <span className="small muted">Expected after the interim report is accepted</span>
                </div>
              </Link>
            </div>
          </section>
          <section className="card" aria-labelledby="msg-h">
            <div className="card-h" style={{ padding: "14px 16px" }}>
              <h3 id="msg-h" style={{ fontSize: "16px" }}>
                Messages
              </h3>
              <Link to="/w/alder-creek/applications/app_01HZX4" className="small b">
                Open thread
              </Link>
            </div>
            <Link
              to="/w/alder-creek/applications/app_01HZX4"
              className="msg"
              style={{ padding: "12px 16px 16px", textDecoration: "none", color: "inherit" }}
            >
              <span className="av">DO</span>
              <div className="bub">
                <div className="hd">
                  <span className="who">Dana Ortiz</span>
                  <span>· Riverbend · 2 h ago</span>
                  <span className="shared-mark">Shared</span>
                </div>
                <div className="bd">Thanks for the revised budget. Interview slots for the week of May 3 are open in your status page.</div>
              </div>
            </Link>
          </section>
          <section className="card" aria-labelledby="task-h">
            <div className="card-h" style={{ padding: "14px 16px" }}>
              <h3 id="task-h" style={{ fontSize: "16px" }}>
                Tasks
              </h3>
              <span className="small muted">3 open</span>
            </div>
            <ul style={{ display: "flex", flexDirection: "column" }}>
              <li className="cb" style={{ padding: "12px 16px", minHeight: "48px", borderBottom: "1px solid #EEF3F3" }}>
                <span className="c" aria-hidden="true"></span>
                <Link
                  to="/w/alder-creek/applications/app_01HZX4/edit"
                  style={{ color: "inherit", textDecoration: "none", fontSize: "15px" }}
                >
                  Add letters of support · <span className="muted">Mobile Health Navigation</span>
                </Link>
              </li>
              <li className="cb" style={{ padding: "12px 16px", minHeight: "48px", borderBottom: "1px solid #EEF3F3" }}>
                <span className="c" aria-hidden="true"></span>
                <Link
                  to="/w/alder-creek/applications/app_01HZX4/edit"
                  style={{ color: "inherit", textDecoration: "none", fontSize: "15px" }}
                >
                  Reply to Jamal’s comment on the need statement
                </Link>
              </li>
              <li className="cb" style={{ padding: "12px 16px", minHeight: "48px" }}>
                <span className="c" aria-hidden="true"></span>
                <Link to="/w/alder-creek/applications/app_01HZX4" style={{ color: "inherit", textDecoration: "none", fontSize: "15px" }}>
                  Confirm interview slot with Riverbend
                </Link>
              </li>
            </ul>
          </section>
        </main>
        <nav className="phone-tabs" aria-label="Primary" style={{ position: "sticky", bottom: "0" }}>
          <Link to="/w/alder-creek" className="on" aria-current="page">
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
          <Link to="/w/alder-creek/reports">
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
