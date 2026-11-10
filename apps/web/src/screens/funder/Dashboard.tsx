// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import {
  BadgeCheck,
  Bot,
  Briefcase,
  Calendar,
  CircleDashed,
  Clock,
  Eye,
  Info,
  Lock,
  Plus,
  RefreshCw,
  Send,
  Shield,
  TriangleExclamationPoint,
  User,
} from "lucide-react";
import { FunderShell } from "../../components/shells.tsx";

export default function Dashboard() {
  return (
    <>
      <title>{"Dashboard — Riverbend funder workspace"}</title>
      <FunderShell active="Dashboard">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/riverbend">Riverbend</Link>
            <span>›</span>
            <span>Dashboard</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Dashboard</h1>
              </div>
              <div className="meta">
                <span>Tuesday, Apr 20, 2027</span>
                <span>·</span>
                <span>2 open competitions</span>
                <span>·</span>
                <span className="row" style={{ gap: "5px" }}>
                  <BadgeCheck className="ic ic-sm" aria-hidden="true" style={{ color: "#0B5E47" }} />
                  Passport synced 2 min ago
                </span>
              </div>
            </div>
            <div className="actions">
              <Link to="/w/riverbend/opportunities/community-health-2027/edit" className="btn btn-secondary">
                New opportunity
              </Link>
              <Link to="/w/riverbend/programs/community-health-2027" className="btn btn-primary">
                <Plus className="ic" aria-hidden="true" />
                New program
              </Link>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "16px" }}>
            <Link to="/w/riverbend/applications" className="stat" style={{ textDecoration: "none" }}>
              <span className="stat-l">Open applications</span>
              <span className="stat-v">36</span>
              <span className="stat-d">
                <Eye className="ic ic-sm" aria-hidden="true" />
                28 under review · 4 need screening
              </span>
            </Link>
            <Link to="/w/riverbend/reviews/assign" className="stat" style={{ textDecoration: "none" }}>
              <span className="stat-l">Reviews due this week</span>
              <span className="stat-v">11</span>
              <span className="stat-d">
                <Clock className="ic ic-sm" aria-hidden="true" />3 reviewers · due Fri Apr 23
              </span>
            </Link>
            <Link to="/w/riverbend/payments/due" className="stat" style={{ textDecoration: "none" }}>
              <span className="stat-l">Payments due 30d</span>
              <span className="stat-v">$113,000</span>
              <span className="stat-d">
                <Lock className="ic ic-sm" aria-hidden="true" style={{ color: "#7A4A00" }} />2 tranches · 1 held
              </span>
            </Link>
            <Link to="/w/riverbend/reporting" className="stat" style={{ textDecoration: "none" }}>
              <span className="stat-l">Reports overdue</span>
              <span className="stat-v">1</span>
              <span className="stat-d">
                <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" style={{ color: "#9B1C1C" }} />
                Northgate Housing Trust · 6 days
              </span>
            </Link>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: "0" }}>
              <div className="card">
                <div className="card-h">
                  <h3>Pipeline</h3>
                  <Link to="/w/riverbend/applications" className="small b">
                    All applications
                  </Link>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <Link to="/w/riverbend/competitions/community-health-2027" className="b" style={{ color: "#0D2A43" }}>
                        Community Health Grants 2027
                      </Link>
                      <span className="small muted">Full proposal closes Apr 30 · 36 in stage</span>
                    </div>
                    <div className="pipe" aria-label="Community Health Grants 2027 pipeline by stage">
                      <Link to="/w/riverbend/applications" style={{ flex: 58, background: "#4A5C5A" }} title="LOI (closed): 58">
                        LOI 58
                      </Link>
                      <Link to="/w/riverbend/applications" style={{ flex: 36, background: "#145450" }} title="Full proposal: 36">
                        Full 36
                      </Link>
                      <Link to="/w/riverbend/applications" style={{ flex: 10, background: "#2470B3" }} title="Interview: 4">
                        Int. 4
                      </Link>
                      <Link to="/w/riverbend/applications" style={{ flex: 8, background: "#D6DEDE", color: "#1E2D2B" }} title="Decided: 0">
                        Decided 0
                      </Link>
                    </div>
                    <div className="row small muted" style={{ gap: "14px" }}>
                      <span>LOI closed Feb 28 · 58 received</span>
                      <span>·</span>
                      <span>22 declined at LOI</span>
                      <span>·</span>
                      <span>4 interviews scheduled May 3–14</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <Link to="/w/riverbend/competitions/community-health-2027" className="b" style={{ color: "#0D2A43" }}>
                        Housing Stability 2027
                      </Link>
                      <span className="small muted">LOI open until May 31 · 12 so far</span>
                    </div>
                    <div className="pipe" aria-label="Housing Stability 2027 pipeline by stage">
                      <Link to="/w/riverbend/applications" style={{ flex: 12, background: "#145450" }} title="LOI (open): 12">
                        LOI 12
                      </Link>
                      <Link
                        to="/w/riverbend/applications"
                        style={{ flex: 30, background: "#EEF3F3", color: "#4A5C5A" }}
                        title="Full proposal: not yet open"
                      >
                        Full — opens Jun 15
                      </Link>
                      <Link
                        to="/w/riverbend/applications"
                        style={{ flex: 12, background: "#EEF3F3", color: "#4A5C5A" }}
                        title="Decision: Aug"
                      >
                        Decision Aug
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Committed vs paid by program</h3>
                  <Link to="/w/riverbend/analytics" className="small b">
                    Analytics
                  </Link>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div className="bar-h">
                    <Link to="/w/riverbend/programs/community-health-2027" className="b" style={{ color: "#0D2A43" }}>
                      Community Health 2027
                    </Link>
                    <div className="trk" aria-label="Committed $720,000, paid $0 of $1,200,000">
                      <div className="f1" style={{ width: "0%" }}></div>
                      <div className="f2" style={{ width: "60%" }}></div>
                    </div>
                    <span className="num small">$720,000 / $1.2M</span>
                  </div>
                  <div className="bar-h">
                    <Link to="/w/riverbend/programs/community-health-2027" className="b" style={{ color: "#0D2A43" }}>
                      Housing Stability 2027
                    </Link>
                    <div className="trk" aria-label="Committed $0, paid $0 of $800,000">
                      <div className="f1" style={{ width: "0%" }}></div>
                      <div className="f2" style={{ width: "0%" }}></div>
                    </div>
                    <span className="num small">$0 / $800,000</span>
                  </div>
                  <div className="bar-h">
                    <Link to="/w/riverbend/programs/community-health-2027" className="b" style={{ color: "#0D2A43" }}>
                      Community Health 2026
                    </Link>
                    <div className="trk" aria-label="Committed $610,000, paid $548,000 of $700,000">
                      <div className="f1" style={{ width: "78%" }}></div>
                      <div className="f2" style={{ width: "9%" }}></div>
                    </div>
                    <span className="num small">$548,000 paid</span>
                  </div>
                  <div className="bar-h">
                    <Link
                      to="/w/riverbend/programs/community-health-2027"
                      className="b"
                      style={{ color: "#9B1C1C", display: "inline-flex", alignItems: "center", gap: "5px" }}
                    >
                      <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
                      Rapid Response Fund
                    </Link>
                    <div
                      className="trk"
                      style={{ outline: "2px solid #C53030", outlineOffset: "1px" }}
                      aria-label="Committed $162,000 of $150,000: over by $12,000"
                    >
                      <div className="f1" style={{ width: "70%", background: "#9B1C1C" }}></div>
                      <div className="f2" style={{ width: "30%", background: "#F1B4B4" }}></div>
                    </div>
                    <span className="num small b" style={{ color: "#9B1C1C" }}>
                      +$12,000 over
                    </span>
                  </div>
                  <div className="row small muted" style={{ gap: "14px", paddingTop: "4px", borderTop: "1px solid #EEF3F3" }}>
                    <span className="row" style={{ gap: "6px" }}>
                      <i style={{ width: "10px", height: "10px", borderRadius: "2px", background: "#145450", display: "inline-block" }}></i>
                      Paid
                    </span>
                    <span className="row" style={{ gap: "6px" }}>
                      <i style={{ width: "10px", height: "10px", borderRadius: "2px", background: "#C2F0ED", display: "inline-block" }}></i>
                      Committed, not yet paid
                    </span>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>My tasks</h3>
                  <span className="small muted">5 open</span>
                </div>
                <ul style={{ display: "flex", flexDirection: "column" }}>
                  <li className="row" style={{ gap: "12px", padding: "10px 20px", borderBottom: "1px solid #EEF3F3" }}>
                    <span className="ck" role="checkbox" aria-checked="false" aria-label="Done: Screen 4 applications"></span>
                    <Link to="/w/riverbend/applications" className="grow" style={{ color: "#1E2D2B" }}>
                      Screen 4 applications in “Needs screening”
                    </Link>
                    <span className="bdg bdg-warn">
                      <Clock className="ic" aria-hidden="true" />
                      Due today
                    </span>
                  </li>
                  <li className="row" style={{ gap: "12px", padding: "10px 20px", borderBottom: "1px solid #EEF3F3" }}>
                    <span className="ck" role="checkbox" aria-checked="false" aria-label="Done: Approve agent proposal"></span>
                    <Link to="/w/riverbend/approvals" className="grow" style={{ color: "#1E2D2B" }}>
                      Review the Triage Agent’s 14 proposed declines
                    </Link>
                    <span className="bdg bdg-agent">
                      <Bot className="ic" aria-hidden="true" />
                      Approval
                    </span>
                  </li>
                  <li className="row" style={{ gap: "12px", padding: "10px 20px", borderBottom: "1px solid #EEF3F3" }}>
                    <span className="ck" role="checkbox" aria-checked="false" aria-label="Done: Assign reviewers"></span>
                    <Link to="/w/riverbend/reviews/assign" className="grow" style={{ color: "#1E2D2B" }}>
                      Assign 2nd reviewer to 6 Full proposals (coverage {"<"} 2)
                    </Link>
                    <span className="small muted">Apr 22</span>
                  </li>
                  <li className="row" style={{ gap: "12px", padding: "10px 20px", borderBottom: "1px solid #EEF3F3" }}>
                    <span className="ck" role="checkbox" aria-checked="false" aria-label="Done: Countersign agreement"></span>
                    <Link to="/w/riverbend/awards/awd_01J2Q7/agreement" className="grow" style={{ color: "#1E2D2B" }}>
                      Countersign Lakeside Senior Center agreement (signed by grantee)
                    </Link>
                    <span className="small muted">Apr 23</span>
                  </li>
                  <li className="row" style={{ gap: "12px", padding: "10px 20px" }}>
                    <span className="ck" role="checkbox" aria-checked="false" aria-label="Done: Send overdue reminder"></span>
                    <Link to="/w/riverbend/reporting" className="grow" style={{ color: "#1E2D2B" }}>
                      Send reminder: Northgate Housing Trust interim report overdue
                    </Link>
                    <span className="bdg bdg-dng">
                      <TriangleExclamationPoint className="ic" aria-hidden="true" />
                      Overdue
                    </span>
                  </li>
                </ul>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: "0" }}>
              <div className="card">
                <div className="card-h">
                  <h3>Payee alerts</h3>
                  <Link to="/w/riverbend/payments/in-flight" className="small b">
                    Payments · Alerts
                  </Link>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div className="bnr bnr-warn">
                    <Lock className="ic" aria-hidden="true" />
                    <div className="grow">
                      <div className="t">Harbor Light Shelter · destination change pending</div>
                      <div className="d">Tranche 2 ($38,000) is held. The new destination is in its freeze window.</div>
                      <div className="clears">
                        <Calendar className="ic ic-sm" aria-hidden="true" />
                        Clears automatically on Jun 3, 2027 ·<Link to="/w/riverbend/payments/in-flight">Open tranche</Link>
                      </div>
                    </div>
                  </div>
                  <div className="bnr bnr-warn">
                    <TriangleExclamationPoint className="ic" aria-hidden="true" />
                    <div className="grow">
                      <div className="t">
                        Copper Valley Clinic · level dropped to <span className="lvl lvl-1">L1</span>
                      </div>
                      <div className="d">Attestation expired Apr 14. Payments to this org require L3.</div>
                      <div className="clears">
                        <Shield className="ic ic-sm" aria-hidden="true" />
                        Clears when the org re-attests in Passport ·<Link to="/w/riverbend/grantees/org_alder-creek">Grantee record</Link>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Approvals</h3>
                  <Link to="/w/riverbend/approvals" className="small b">
                    All approvals
                  </Link>
                </div>
                <div className="card-b">
                  <div className="apr">
                    <div className="hd">
                      <Bot className="ic" aria-hidden="true" />
                      Riverbend Triage Agent
                      <span className="muted" style={{ fontWeight: 400, color: "#4B2E9E" }}>
                        via Claude
                      </span>
                      <span className="small" style={{ marginLeft: "auto", fontWeight: 400 }}>
                        2 min ago
                      </span>
                    </div>
                    <div className="bd">
                      <div>
                        <span className="b">Requested action:</span> Decline 14 LOI applications and send “Standard decline v3”
                      </div>
                      <div className="muted small">
                        Inputs: competition Community Health Grants 2027 · stage LOI · filter: eligibility = Fail · 14 matches
                      </div>
                      <div className="impact">
                        <Send className="ic" aria-hidden="true" />
                        Will send 14 letters and set 14 statuses to Declined
                      </div>
                    </div>
                    <div className="ft">
                      <Link to="/w/riverbend/approvals" className="btn btn-sm btn-primary">
                        Approve
                      </Link>
                      <Link to="/w/riverbend/approvals" className="btn btn-sm btn-danger">
                        Reject
                      </Link>
                      <Link to="/w/riverbend/approvals" className="btn btn-sm btn-ghost" style={{ marginLeft: "auto" }}>
                        Open
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Recent activity</h3>
                </div>
                <div className="card-b">
                  <div className="tl tl-sm">
                    <div className="tl-i tl-person">
                      <span className="dot">
                        <User className="ic" aria-hidden="true" />
                      </span>
                      <div>
                        <div className="what">Priya Natarajan submitted 3 reviews</div>
                        <div className="who">Full proposal · 24 min ago</div>
                      </div>
                    </div>
                    <div className="tl-i tl-passport">
                      <span className="dot">
                        <BadgeCheck className="ic" aria-hidden="true" />
                      </span>
                      <div>
                        <div className="what">Passport: Harbor Light Shelter started a destination change</div>
                        <div className="who">Freeze until Jun 3 · 1 hour ago</div>
                      </div>
                    </div>
                    <div className="tl-i tl-agent">
                      <span className="dot">
                        <Bot className="ic" aria-hidden="true" />
                      </span>
                      <div>
                        <div className="what">Triage Agent proposed 14 declines</div>
                        <div className="who">Awaiting approval · 2 min ago</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)",
              gap: "20px",
              marginTop: "8px",
              alignItems: "start",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">State · first run (no programs yet)</span>
              <div className="card empty" style={{ minHeight: "240px", justifyContent: "center" }}>
                <Briefcase className="ic" aria-hidden="true" />
                <h3>Start with a program</h3>
                <p>A program holds a budget, default rubric and templates. Opportunities, competitions and awards hang off it.</p>
                <div className="acts">
                  <Link to="/w/riverbend/programs/community-health-2027" className="btn btn-primary">
                    Create a program
                  </Link>
                  <Link to="/w/riverbend/settings/mcp" className="small b">
                    Import from CSV instead
                  </Link>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="eyebrow">State · Passport unavailable</span>
              <div className="card">
                <div className="card-h">
                  <h3>Payee alerts</h3>
                  <span className="lvl lvl-na">L? unavailable</span>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div className="bnr bnr-neu">
                    <Info className="ic" aria-hidden="true" />
                    <div>
                      <div className="t">Passport can’t be reached</div>
                      <div className="d">
                        Payee data last refreshed 42 min ago. Readiness shows Unknown until Passport is reachable; nothing is released in
                        the meantime.
                      </div>
                      <div className="clears">
                        <RefreshCw className="ic ic-sm" aria-hidden="true" />
                        Retrying every 60 s ·<Link to="/w/riverbend/payments/due">Payments center</Link>
                      </div>
                    </div>
                  </div>
                  <div className="row small muted" style={{ gap: "8px" }}>
                    <span className="row" style={{ gap: "5px" }}>
                      <CircleDashed className="ic ic-sm" aria-hidden="true" />
                      Harbor Light Shelter · status unknown
                    </span>
                    <span>·</span>
                    <span className="row" style={{ gap: "5px" }}>
                      <CircleDashed className="ic ic-sm" aria-hidden="true" />
                      Copper Valley Clinic · status unknown
                    </span>
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
