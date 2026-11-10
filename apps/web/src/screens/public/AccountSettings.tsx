// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import {
  Bell,
  Bot,
  Check,
  ChevronDown,
  CircleQuestionMark,
  Info,
  Lock,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Smartphone,
  User,
} from "lucide-react";

export default function AccountSettings() {
  return (
    <>
      <title>{"Account settings — Connected agents"}</title>
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
            <Link to="/notifications" className="iconbtn" aria-label="Notifications, 3 unread">
              <Bell className="ic ic-md" aria-hidden="true" />
              <span className="dot"></span>
            </Link>
            <button className="iconbtn" aria-label="Help">
              <CircleQuestionMark className="ic ic-md" aria-hidden="true" />
            </button>
            <Link to="/account/agents" className="av" aria-label="Account: Dana Ortiz" aria-current="page">
              DO
            </Link>
          </div>
        </header>
        <main style={{ flex: "1 1 auto", padding: "28px 40px 48px", display: "flex", flexDirection: "column", gap: "20px" }}>
          <div className="ph">
            <div>
              <div className="crumbs">
                <Link to="/w/riverbend">Riverbend</Link>
                <span>›</span>
                <span>Account</span>
              </div>
              <h1 style={{ marginTop: "6px" }}>Account settings</h1>
              <div className="meta">
                <span>Dana Ortiz · dana@riverbendcf.example</span>
                <span>·</span>
                <span>Member of 2 workspaces</span>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: "24px", alignItems: "start" }}>
            <nav className="card rail" style={{ borderRight: "1px solid #D6DEDE", flex: "none" }} aria-label="Account sections">
              <ul>
                <li>
                  <a href="#profile">
                    <User className="ic" aria-hidden="true" />
                    Profile
                  </a>
                </li>
                <li>
                  <a href="#security">
                    <Shield className="ic" aria-hidden="true" />
                    Security
                  </a>
                </li>
                <li>
                  <a href="#sessions">
                    <Monitor className="ic" aria-hidden="true" />
                    Sessions
                  </a>
                </li>
                <li>
                  <a href="#agents" className="on" aria-current="page">
                    <Bot className="ic" aria-hidden="true" />
                    Connected agents
                    <span className="count" style={{ background: "#EEF3F3", color: "#4A5C5A" }}>
                      2
                    </span>
                  </a>
                </li>
                <li>
                  <Link to="/notifications">
                    <Bell className="ic" aria-hidden="true" />
                    Notifications
                  </Link>
                </li>
              </ul>
            </nav>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: "0" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px" }}>
                <section className="card" id="profile">
                  <div className="card-h">
                    <h3>Profile</h3>
                    <button className="btn btn-sm btn-secondary">Edit</button>
                  </div>
                  <div className="card-b">
                    <dl className="kv" style={{ gridTemplateColumns: "120px minmax(0, 1fr)" }}>
                      <dt>Name</dt>
                      <dd className="row" style={{ gap: "8px" }}>
                        <span className="av av-sm">DO</span>Dana Ortiz
                      </dd>
                      <dt>Email</dt>
                      <dd>
                        dana@riverbendcf.example{" "}
                        <span className="bdg bdg-ok" style={{ marginLeft: "6px" }}>
                          <Check className="ic" aria-hidden="true" />
                          Verified
                        </span>
                      </dd>
                      <dt>Time zone</dt>
                      <dd>Pacific Time (America/Los_Angeles)</dd>
                      <dt>Language</dt>
                      <dd>English (US)</dd>
                      <dt>Workspaces</dt>
                      <dd>
                        <div className="col" style={{ gap: "4px" }}>
                          <span className="row" style={{ gap: "6px" }}>
                            Riverbend Community Foundation<span className="role">Program officer</span>
                          </span>
                          <span className="row" style={{ gap: "6px" }}>
                            Alder Creek Family Services<span className="role">Viewer</span>
                          </span>
                        </div>
                      </dd>
                    </dl>
                  </div>
                </section>
                <section className="card" id="security">
                  <div className="card-h">
                    <h3>Multi-factor authentication</h3>
                    <span className="bdg bdg-ok">
                      <ShieldCheck className="ic" aria-hidden="true" />
                      Enabled
                    </span>
                  </div>
                  <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <dl className="kv" style={{ gridTemplateColumns: "120px minmax(0, 1fr)" }}>
                      <dt>Method</dt>
                      <dd>Authenticator app · added Jan 9, 2027</dd>
                      <dt>Recovery codes</dt>
                      <dd>8 of 10 unused</dd>
                      <dt>Required by</dt>
                      <dd>Riverbend Community Foundation (workspace policy)</dd>
                    </dl>
                    <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                      <button className="btn btn-sm btn-secondary">
                        <RefreshCw className="ic" aria-hidden="true" />
                        Regenerate recovery codes
                      </button>
                      <button className="btn btn-sm btn-secondary">Change method</button>
                      <button className="btn btn-sm btn-danger">Disable MFA</button>
                    </div>
                    <span className="help">Disabling is blocked while a workspace policy requires MFA.</span>
                  </div>
                </section>
              </div>
              <section className="card" id="sessions">
                <div className="card-h">
                  <h3>Sessions</h3>
                  <button className="btn btn-sm btn-danger">Sign out of all other sessions</button>
                </div>
                <div className="tbl-wrap" style={{ border: "0", borderRadius: "0 0 12px 12px" }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Device</th>
                        <th>Location</th>
                        <th>Last active</th>
                        <th>Signed in</th>
                        <th style={{ width: "100px" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="row" style={{ gap: "8px" }}>
                          <Monitor className="ic" aria-hidden="true" />
                          Chrome on macOS
                          <span className="bdg bdg-ok" style={{ marginLeft: "4px" }}>
                            <Check className="ic" aria-hidden="true" />
                            This device
                          </span>
                        </td>
                        <td>Sacramento, CA</td>
                        <td>Now</td>
                        <td>May 25, 2027</td>
                        <td></td>
                      </tr>
                      <tr>
                        <td className="row" style={{ gap: "8px" }}>
                          <Smartphone className="ic" aria-hidden="true" />
                          Safari on iOS
                        </td>
                        <td>Folsom, CA</td>
                        <td>3 hours ago</td>
                        <td>May 18, 2027</td>
                        <td>
                          <button className="btn btn-sm btn-secondary">Revoke</button>
                        </td>
                      </tr>
                      <tr>
                        <td className="row" style={{ gap: "8px" }}>
                          <Monitor className="ic" aria-hidden="true" />
                          Firefox on Linux
                        </td>
                        <td>Portland, OR</td>
                        <td>6 days ago</td>
                        <td>Apr 30, 2027</td>
                        <td>
                          <button className="btn btn-sm btn-secondary">Revoke</button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="card" id="agents">
                <div className="card-h">
                  <div>
                    <h3>Connected agents</h3>
                    <p className="small muted" style={{ marginTop: "2px" }}>
                      MCP clients acting as you. Each has a scope list and, where a tool is gated, needs a human approval before the action
                      lands.
                    </p>
                  </div>
                  <Link to="/oauth/consent" className="btn btn-primary">
                    <Plus className="ic" aria-hidden="true" />
                    Connect an agent
                  </Link>
                </div>
                <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Agent</th>
                        <th>Client</th>
                        <th>Workspace</th>
                        <th>Scopes</th>
                        <th>Last used</th>
                        <th style={{ width: "100px" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <div className="row" style={{ gap: "10px" }}>
                            <span className="av av-sm av-a">
                              <Bot className="ic ic-sm" aria-hidden="true" />
                            </span>
                            <div className="ent">
                              <span className="nm">Riverbend Triage Agent</span>
                              <span className="small muted">Connected Mar 1, 2027 · 1 approval pending</span>
                            </div>
                          </div>
                        </td>
                        <td>Claude</td>
                        <td>
                          Riverbend Community Foundation <span className="role">Funder</span>
                        </td>
                        <td>
                          <div className="row wrap" style={{ gap: "4px" }}>
                            <span className="tag mono">applications:read</span>
                            <span className="tag mono">applications:propose</span>
                            <span className="tag mono">letters:draft</span>
                          </div>
                        </td>
                        <td>2 min ago</td>
                        <td>
                          <button className="btn btn-sm btn-danger">Revoke</button>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          <div className="row" style={{ gap: "10px" }}>
                            <span className="av av-sm av-a">
                              <Bot className="ic ic-sm" aria-hidden="true" />
                            </span>
                            <div className="ent">
                              <span className="nm">Grants drafting agent</span>
                              <span className="small muted">Connected Apr 3, 2027</span>
                            </div>
                          </div>
                        </td>
                        <td>Cursor</td>
                        <td>
                          Alder Creek Family Services <span className="role">Applicant</span>
                        </td>
                        <td>
                          <div className="row wrap" style={{ gap: "4px" }}>
                            <span className="tag mono">applications:write</span>
                            <span className="tag" style={{ background: "#FCEFD3", color: "#7A4A00" }}>
                              <Lock className="ic ic-sm" aria-hidden="true" style={{ marginRight: "4px" }} />
                              submit gated
                            </span>
                          </div>
                        </td>
                        <td>3 days ago</td>
                        <td>
                          <button className="btn btn-sm btn-danger">Revoke</button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="card-f" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                  <span className="notice">
                    <Info className="ic" aria-hidden="true" />
                    Revoking an agent cancels its pending approvals and removes its token immediately. Records it already touched keep their
                    attribution line.
                  </span>
                  <Link to="/w/riverbend/settings/mcp" className="small b">
                    Workspace-wide agent settings and human gates →
                  </Link>
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
