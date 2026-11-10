// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import {
  BadgeCheck,
  Bell,
  Bot,
  Check,
  ChevronDown,
  CircleQuestionMark,
  Clock,
  FileText,
  Lock,
  MessageSquare,
  RotateCcw,
  Search,
  Send,
  Users,
} from "lucide-react";

export default function Notifications() {
  return (
    <>
      <title>{"Notifications"}</title>
      <div className="gms" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <header className="topbar">
          <Link to="/w/riverbend" className="logo">
            <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" />
            <span className="suffix">GMS</span>
          </Link>
          <Link to="/workspaces" className="ws">
            Riverbend Community Foundation<span className="role">Funder</span>
            <ChevronDown className="ic" aria-hidden="true" />
          </Link>
          <div className="search">
            <Search className="ic" aria-hidden="true" />
            <input
              type="search"
              aria-label="Search applications, awards, grantees, opportunities"
              placeholder="Search applications, awards, grantees, opportunities"
            />
            <span className="kbd">⌘K</span>
          </div>
          <div className="row" style={{ marginLeft: "auto", gap: "4px" }}>
            <Link
              to="/notifications"
              className="iconbtn"
              aria-label="Notifications, 3 unread"
              aria-current="page"
              style={{ background: "#EEF3F3", color: "#0D2A43" }}
            >
              <Bell className="ic ic-md" aria-hidden="true" />
              <span className="dot"></span>
            </Link>
            <button className="iconbtn" aria-label="Help">
              <CircleQuestionMark className="ic ic-md" aria-hidden="true" />
            </button>
            <Link to="/account/agents" className="av" aria-label="Account: Dana Ortiz">
              DO
            </Link>
          </div>
        </header>
        <main style={{ flex: "1 1 auto", padding: "28px 40px 48px", display: "flex", flexDirection: "column", gap: "20px" }}>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Notifications</h1>
                <span className="bdg bdg-info">
                  <Bell className="ic" aria-hidden="true" />3 unread
                </span>
              </div>
              <div className="meta">
                <span>Grouped by workspace. Actions open the record they refer to.</span>
              </div>
            </div>
            <div className="actions">
              <div className="seg" role="group" aria-label="Filter">
                <button className="on">All</button>
                <button>Unread</button>
                <button>Needs action</button>
              </div>
              <button className="btn btn-secondary">Mark all read</button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: "24px", alignItems: "start" }}>
            <section style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div className="card">
                <div className="card-h">
                  <div className="row" style={{ gap: "10px" }}>
                    <span style={{ width: "4px", height: "20px", background: "#1F6F8B", borderRadius: "2px" }} aria-hidden="true"></span>
                    <h3>Riverbend Community Foundation</h3>
                    <span className="role">Funder</span>
                  </div>
                  <span className="muted small">3 new</span>
                </div>
                <ul>
                  <li
                    style={{
                      display: "grid",
                      gridTemplateColumns: "36px minmax(0, 1fr) auto",
                      gap: "14px",
                      alignItems: "center",
                      padding: "14px 20px",
                      borderBottom: "1px solid #EEF3F3",
                      background: "#F7F4FD",
                    }}
                  >
                    <span className="av av-a" aria-hidden="true">
                      <Bot className="ic" aria-hidden="true" />
                    </span>
                    <div style={{ minWidth: "0" }}>
                      <div>
                        <span className="b">Riverbend Triage Agent (via Claude)</span> proposes declining{" "}
                        <Link to="/w/riverbend/approvals">14 applications</Link> that failed eligibility and sending “Standard decline v3”.
                      </div>
                      <div className="small muted row" style={{ gap: "8px", marginTop: "2px" }}>
                        <span>2 min ago</span>
                        <span>·</span>
                        <span>Community Health Grants 2027</span>
                        <span>·</span>
                        <span className="bdg bdg-agent" style={{ height: "18px", fontSize: "11px" }}>
                          <Lock className="ic" aria-hidden="true" />
                          Needs your approval
                        </span>
                      </div>
                    </div>
                    <Link to="/w/riverbend/approvals" className="btn btn-sm btn-primary">
                      Approve…
                    </Link>
                  </li>
                  <li
                    style={{
                      display: "grid",
                      gridTemplateColumns: "36px minmax(0, 1fr) auto",
                      gap: "14px",
                      alignItems: "center",
                      padding: "14px 20px",
                      borderBottom: "1px solid #EEF3F3",
                      background: "#FFFDF7",
                    }}
                  >
                    <span className="av" style={{ background: "#FCEFD3", color: "#7A4A00" }} aria-hidden="true">
                      <Lock className="ic" aria-hidden="true" />
                    </span>
                    <div style={{ minWidth: "0" }}>
                      <div>
                        <span className="b">Payee alert:</span> <Link to="/w/riverbend/payments/in-flight">Harbor Light Shelter</Link> has a
                        destination change pending in Passport. Tranche 2 ($38,000) is held; freeze until Jun 3, 2027.
                      </div>
                      <div className="small muted row" style={{ gap: "8px", marginTop: "2px" }}>
                        <span>1 hour ago</span>
                        <span>·</span>
                        <span>From Passport</span>
                        <span>·</span>
                        <span className="pay pay-pending">
                          <Clock className="ic" aria-hidden="true" />
                          Pending change
                        </span>
                      </div>
                    </div>
                    <Link to="/w/riverbend/payments/in-flight" className="btn btn-sm btn-secondary">
                      Open
                    </Link>
                  </li>
                  <li
                    style={{
                      display: "grid",
                      gridTemplateColumns: "36px minmax(0, 1fr) auto",
                      gap: "14px",
                      alignItems: "center",
                      padding: "14px 20px",
                      borderBottom: "1px solid #EEF3F3",
                      background: "#F7FAFA",
                    }}
                  >
                    <span className="av av-t" aria-hidden="true">
                      <FileText className="ic" aria-hidden="true" />
                    </span>
                    <div style={{ minWidth: "0" }}>
                      <div>
                        <span className="b">Interim report received</span> from{" "}
                        <Link to="/w/riverbend/reporting">Alder Creek Family Services</Link> · Mobile Health Navigation for Rural Families.
                        Accepting it releases tranche 2.
                      </div>
                      <div className="small muted row" style={{ gap: "8px", marginTop: "2px" }}>
                        <span>Yesterday, 4:12 PM</span>
                        <span>·</span>
                        <span>Submitted by Jamal Reed</span>
                        <span>·</span>
                        <span className="bdg bdg-info" style={{ height: "18px", fontSize: "11px" }}>
                          <Send className="ic" aria-hidden="true" />
                          Submitted
                        </span>
                      </div>
                    </div>
                    <Link to="/w/riverbend/reporting" className="btn btn-sm btn-secondary">
                      Review
                    </Link>
                  </li>
                  <li
                    style={{
                      display: "grid",
                      gridTemplateColumns: "36px minmax(0, 1fr) auto",
                      gap: "14px",
                      alignItems: "center",
                      padding: "14px 20px",
                      borderBottom: "1px solid #EEF3F3",
                    }}
                  >
                    <span className="av av-g" aria-hidden="true">
                      <RotateCcw className="ic" aria-hidden="true" />
                    </span>
                    <div style={{ minWidth: "0" }}>
                      <div>
                        <Link to="/w/riverbend/applications/app_01HZX4">Copper Valley Clinic</Link> responded to your revision request on
                        “Rural Telehealth Expansion”. A diff of the two changed fields is ready.
                      </div>
                      <div className="small muted row" style={{ gap: "8px", marginTop: "2px" }}>
                        <span>2 days ago</span>
                        <span>·</span>
                        <span>Full proposal stage</span>
                      </div>
                    </div>
                    <Link to="/w/riverbend/applications/app_01HZX4" className="btn btn-sm btn-secondary">
                      Open
                    </Link>
                  </li>
                  <li
                    style={{
                      display: "grid",
                      gridTemplateColumns: "36px minmax(0, 1fr) auto",
                      gap: "14px",
                      alignItems: "center",
                      padding: "14px 20px",
                    }}
                  >
                    <span className="av av-g" aria-hidden="true">
                      <Users className="ic" aria-hidden="true" />
                    </span>
                    <div style={{ minWidth: "0" }}>
                      <div>
                        <span className="b">Dr. Hollis Grant</span> accepted the external reviewer invitation for Community Health Grants
                        2027 (expires Jun 30, 2027).
                      </div>
                      <div className="small muted row" style={{ gap: "8px", marginTop: "2px" }}>
                        <span>3 days ago</span>
                        <span>·</span>
                        <span>Reviews</span>
                      </div>
                    </div>
                    <Link to="/w/riverbend/reviews/assign" className="btn btn-sm btn-ghost">
                      Open
                    </Link>
                  </li>
                </ul>
              </div>
              <div className="card">
                <div className="card-h">
                  <div className="row" style={{ gap: "10px" }}>
                    <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "18px", height: "18px" }} />
                    <h3>Alder Creek Family Services</h3>
                    <span className="role">Applicant</span>
                  </div>
                  <span className="muted small">0 new</span>
                </div>
                <ul>
                  <li
                    style={{
                      display: "grid",
                      gridTemplateColumns: "36px minmax(0, 1fr) auto",
                      gap: "14px",
                      alignItems: "center",
                      padding: "14px 20px",
                      borderBottom: "1px solid #EEF3F3",
                    }}
                  >
                    <span className="av" style={{ background: "#D9F5EC", color: "#0B5E47" }} aria-hidden="true">
                      <BadgeCheck className="ic" aria-hidden="true" />
                    </span>
                    <div style={{ minWidth: "0" }}>
                      <div>
                        <span className="b">Payment settled:</span> $75,000 from Riverbend Community Foundation arrived at River City Credit
                        Union •••• 4821 (tranche 1 of 3).
                      </div>
                      <div className="small muted row" style={{ gap: "8px", marginTop: "2px" }}>
                        <span>May 27, 2027</span>
                        <span>·</span>
                        <span className="bdg bdg-ok" style={{ height: "18px", fontSize: "11px" }}>
                          <BadgeCheck className="ic" aria-hidden="true" />
                          Settled
                        </span>
                      </div>
                    </div>
                    <Link to="/w/alder-creek/grants/awd_01J2Q7" className="btn btn-sm btn-ghost">
                      Open
                    </Link>
                  </li>
                  <li
                    style={{
                      display: "grid",
                      gridTemplateColumns: "36px minmax(0, 1fr) auto",
                      gap: "14px",
                      alignItems: "center",
                      padding: "14px 20px",
                    }}
                  >
                    <span className="av av-g" aria-hidden="true">
                      <MessageSquare className="ic" aria-hidden="true" />
                    </span>
                    <div style={{ minWidth: "0" }}>
                      <div>
                        <span className="b">Dana Ortiz (Riverbend)</span> replied in the shared thread on “Mobile Health Navigation for
                        Rural Families”.
                      </div>
                      <div className="small muted row" style={{ gap: "8px", marginTop: "2px" }}>
                        <span>May 20, 2027</span>
                        <span>·</span>
                        <span className="shared-mark">Shared</span>
                      </div>
                    </div>
                    <Link to="/w/alder-creek/applications/app_01HZX4" className="btn btn-sm btn-ghost">
                      Open
                    </Link>
                  </li>
                </ul>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span className="eyebrow">State · empty</span>
                <div className="card empty">
                  <Bell className="ic" aria-hidden="true" />
                  <h3>You’re caught up</h3>
                  <p>Nothing needs your attention right now. Approvals, payee alerts and received reports will appear here first.</p>
                  <div className="acts">
                    <Link to="/w/riverbend" className="btn btn-primary">
                      Go to dashboard
                    </Link>
                    <Link to="/notifications" className="small b">
                      Adjust what you’re notified about
                    </Link>
                  </div>
                </div>
              </div>
            </section>
            <aside className="drawer card" style={{ borderLeft: "1px solid #D6DEDE" }}>
              <div className="hd">
                <h3>Digest settings</h3>
                <span className="muted small">Per account</span>
              </div>
              <div className="bd">
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div className="eyebrow">Notify me when</div>
                  <label className="row" style={{ justifyContent: "space-between" }}>
                    <span>An agent needs my approval</span>
                    <button className="tog on" aria-pressed="true" aria-label="An agent needs my approval"></button>
                  </label>
                  <label className="row" style={{ justifyContent: "space-between" }}>
                    <span>A payee alert blocks a tranche</span>
                    <button className="tog on" aria-pressed="true" aria-label="A payee alert blocks a tranche"></button>
                  </label>
                  <label className="row" style={{ justifyContent: "space-between" }}>
                    <span>A report is received</span>
                    <button className="tog on" aria-pressed="true" aria-label="A report is received"></button>
                  </label>
                  <label className="row" style={{ justifyContent: "space-between" }}>
                    <span>An applicant responds to a revision</span>
                    <button className="tog on" aria-pressed="true" aria-label="An applicant responds to a revision"></button>
                  </label>
                  <label className="row" style={{ justifyContent: "space-between" }}>
                    <span>A reviewer submits scores</span>
                    <button className="tog" aria-pressed="false" aria-label="A reviewer submits scores"></button>
                  </label>
                  <label className="row" style={{ justifyContent: "space-between" }}>
                    <span>A payment settles</span>
                    <button className="tog on" aria-pressed="true" aria-label="A payment settles"></button>
                  </label>
                  <label className="row" style={{ justifyContent: "space-between" }}>
                    <span>Someone mentions me in a thread</span>
                    <button className="tog on" aria-pressed="true" aria-label="Someone mentions me in a thread"></button>
                  </label>
                </div>
                <div className="divider"></div>
                <div className="fld">
                  <label className="lbl" htmlFor="digest">
                    Email digest
                  </label>
                  <select className="sel" id="digest">
                    <option>Daily at 8:00 AM</option>
                    <option>Weekly on Monday</option>
                    <option>Immediately, each event</option>
                    <option>Off</option>
                  </select>
                  <span className="help">Approvals and payee alerts always send immediately.</span>
                </div>
                <div className="fld">
                  <span className="lbl">Quiet hours</span>
                  <div className="fld-row">
                    <input className="inp" defaultValue="7:00 PM" aria-label="Quiet hours start" />
                    <input className="inp" defaultValue="7:00 AM" aria-label="Quiet hours end" />
                  </div>
                  <span className="help">Pacific Time · in-app notifications still arrive, emails wait.</span>
                </div>
                <div className="divider"></div>
                <div className="fld">
                  <span className="lbl">Workspaces</span>
                  <label className="cb">
                    <span className="c on">
                      <Check className="ic ic-sm" aria-hidden="true" />
                    </span>
                    Riverbend Community Foundation
                  </label>
                  <label className="cb">
                    <span className="c on">
                      <Check className="ic ic-sm" aria-hidden="true" />
                    </span>
                    Alder Creek Family Services
                  </label>
                </div>
                <button className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
                  Save settings
                </button>
              </div>
            </aside>
          </div>
        </main>
      </div>
    </>
  );
}
