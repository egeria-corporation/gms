// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import {
  Award,
  Bell,
  Bot,
  Building,
  Calendar,
  CircleCheck,
  ClipboardCheck,
  Eye,
  FileText,
  GitCompare,
  House,
  Menu,
  Send,
} from "lucide-react";

export default function ApplicationStatusPhone() {
  return (
    <>
      <title>{"Application status — phone"}</title>
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
            Application status
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
          <div className="card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <span className="chip" style={{ alignSelf: "flex-start" }}>
              <span className="tdot" aria-hidden="true"></span>Riverbend Community Foundation
            </span>
            <h2 style={{ fontSize: "20px", lineHeight: 1.3 }}>Mobile Health Navigation for Rural Families</h2>
            <div className="row wrap" style={{ gap: "8px" }}>
              <span className="bdg bdg-prog bdg-lg">
                <Eye className="ic" aria-hidden="true" />
                Under review
              </span>
              <span className="small muted">Full proposal · $150,000 requested</span>
            </div>
            <div className="row wrap" style={{ gap: "8px" }}>
              <span className="mono muted">app_01HZX4</span>
              <Link to="/preview/pdf/application-snapshot" className="small b">
                Submitted PDF
              </Link>
              <Link to="/w/alder-creek/applications/app_01HZX4" className="small b">
                CommonGrants JSON
              </Link>
            </div>
          </div>
          <section className="card" aria-labelledby="tl-h">
            <div className="card-h" style={{ padding: "14px 16px" }}>
              <h3 id="tl-h" style={{ fontSize: "16px" }}>
                Timeline
              </h3>
              <span className="small muted">Decision by Jun 15</span>
            </div>
            <div className="card-b" style={{ padding: "16px 16px 4px" }}>
              <ol className="tl tl-sm">
                <li className="tl-i tl-ok">
                  <span className="dot">
                    <Send className="ic" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="what">Submitted</div>
                    <div className="who">Apr 16, 2027 · Maria Santos · L3 attestation attached</div>
                  </div>
                </li>
                <li className="tl-i tl-agent">
                  <span className="dot">
                    <Bot className="ic" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="what">Screening passed</div>
                    <div className="who">
                      Apr 18 ·
                      <span className="attrib">
                        <span className="ag">Riverbend Triage Agent (via Claude)</span>· approved by Dana Ortiz
                      </span>
                    </div>
                  </div>
                </li>
                <li className="tl-i tl-person">
                  <span className="dot">
                    <Eye className="ic" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="what">Under review</div>
                    <div className="who">Apr 20 · 3 reviewers assigned · Dana Ortiz</div>
                  </div>
                </li>
                <li className="tl-i">
                  <span className="dot">
                    <Calendar className="ic" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="what muted">Decision</div>
                    <div className="who">Expected by Jun 15, 2027</div>
                  </div>
                </li>
              </ol>
            </div>
          </section>
          <section className="card" aria-labelledby="msg-h">
            <div className="card-h" style={{ padding: "14px 16px" }}>
              <h3 id="msg-h" style={{ fontSize: "16px" }}>
                Messages
              </h3>
              <span className="shared-mark">Shared with Riverbend</span>
            </div>
            <div className="card-b" style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <div className="th">
                <div className="msg">
                  <span className="av">DO</span>
                  <div className="bub">
                    <div className="hd" style={{ flexWrap: "wrap" }}>
                      <span className="who">Dana Ortiz</span>
                      <span>· Riverbend · Apr 24</span>
                    </div>
                    <div className="bd">Thanks for the revised budget. Interview slots for the week of May 3 are open below.</div>
                  </div>
                </div>
                <div className="msg">
                  <span className="av av-t">MS</span>
                  <div className="bub">
                    <div className="hd" style={{ flexWrap: "wrap" }}>
                      <span className="who">Maria Santos</span>
                      <span>· you · Apr 24</span>
                    </div>
                    <div className="bd">Received — we’ll pick a slot today and bring our clinic partner.</div>
                  </div>
                </div>
              </div>
              <div className="composer" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <label className="sr" htmlFor="reply">
                  Reply to Riverbend
                </label>
                <textarea className="ta" id="reply" placeholder="Reply to Riverbend…" style={{ minHeight: "72px" }} />
                <button className="btn btn-primary btn-lg">Send</button>
              </div>
            </div>
          </section>
          <section className="card" aria-labelledby="rev-h">
            <div className="card-h" style={{ padding: "14px 16px" }}>
              <h3 id="rev-h" style={{ fontSize: "16px" }}>
                Revision request
              </h3>
              <span className="bdg bdg-ok">
                <CircleCheck className="ic" aria-hidden="true" />
                Resolved Apr 22
              </span>
            </div>
            <div className="card-b" style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <p style={{ fontSize: "14px" }}>
                <span className="b">Dana Ortiz asked:</span> “Bring indirect costs within the 10% cap and reconcile the total to the
                requested amount.”
              </p>
              <div className="diff">
                <div className="hd">
                  <span>Budget · Indirect</span>
                  <span>inline</span>
                </div>
                <div style={{ padding: "10px 12px", fontSize: "14px", lineHeight: 1.6 }}>
                  Indirect (10% cap): <span className="del">$18,000</span> <span className="ins">$15,000</span>
                  <br />
                  Total requested: <span className="del">$153,000</span> <span className="ins">$150,000</span>
                </div>
                <div className="sum">
                  <GitCompare className="ic" aria-hidden="true" />2 fields changed · responded by Lena Fischer
                </div>
              </div>
            </div>
          </section>
          <section className="card" aria-labelledby="int-h">
            <div className="card-h" style={{ padding: "14px 16px" }}>
              <h3 id="int-h" style={{ fontSize: "16px" }}>
                Interview
              </h3>
              <span className="small muted">30 min · video</span>
            </div>
            <div className="card-b" style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <p className="small muted">Pick one slot. Riverbend confirms within a day.</p>
              <div role="radiogroup" aria-label="Interview slots" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <button
                  className="radio"
                  role="radio"
                  aria-checked="false"
                  style={{
                    minHeight: "48px",
                    border: "1px solid #D6DEDE",
                    borderRadius: "8px",
                    padding: "10px 12px",
                    background: "#fff",
                    font: "inherit",
                    textAlign: "left",
                    alignItems: "center",
                  }}
                >
                  <span className="r" aria-hidden="true"></span>Mon May 3 · 10:00 AM PT
                </button>
                <button
                  className="radio"
                  role="radio"
                  aria-checked="true"
                  style={{
                    minHeight: "48px",
                    border: "2px solid #145450",
                    borderRadius: "8px",
                    padding: "10px 12px",
                    background: "#E1F8F6",
                    font: "inherit",
                    textAlign: "left",
                    alignItems: "center",
                  }}
                >
                  <span className="r on" aria-hidden="true"></span>
                  <span className="b">Tue May 4 · 2:30 PM PT</span>
                </button>
                <button
                  className="radio"
                  role="radio"
                  aria-checked="false"
                  style={{
                    minHeight: "48px",
                    border: "1px solid #D6DEDE",
                    borderRadius: "8px",
                    padding: "10px 12px",
                    background: "#fff",
                    font: "inherit",
                    textAlign: "left",
                    alignItems: "center",
                  }}
                >
                  <span className="r" aria-hidden="true"></span>Thu May 6 · 9:00 AM PT
                </button>
              </div>
              <button className="btn btn-primary btn-lg btn-block">Confirm Tue May 4, 2:30 PM</button>
            </div>
          </section>
          <section className="card" aria-labelledby="dec-h">
            <div className="card-h" style={{ padding: "14px 16px" }}>
              <h3 id="dec-h" style={{ fontSize: "16px" }}>
                Decision
              </h3>
            </div>
            <div className="empty" style={{ padding: "24px 16px" }}>
              <Calendar className="ic" aria-hidden="true" />
              <h3 style={{ fontSize: "16px" }}>No decision yet</h3>
              <p>Riverbend expects to decide by Jun 15, 2027. The letter will appear here and by email.</p>
            </div>
          </section>
          <Link
            to="/w/alder-creek/applications/app_01HZX4"
            className="btn btn-ghost btn-lg"
            style={{ color: "#9B1C1C", alignSelf: "center" }}
          >
            Withdraw application
          </Link>
        </main>
        <nav className="phone-tabs" aria-label="Primary" style={{ position: "sticky", bottom: "0" }}>
          <Link to="/w/alder-creek">
            <House className="ic ic-md" aria-hidden="true" />
            Home
          </Link>
          <Link to="/w/alder-creek/applications/app_01HZX4/edit" className="on" aria-current="page">
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
