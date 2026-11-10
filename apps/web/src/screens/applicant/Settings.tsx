// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import { Download, Key } from "lucide-react";
import { ApplicantShell } from "../../components/shells.tsx";

export default function Settings() {
  return (
    <>
      <title>{"Settings — Alder Creek Family Services"}</title>
      <ApplicantShell active="Settings">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/alder-creek">Dashboard</Link>
            <span>›</span>
            <span>Settings</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Workspace settings</h1>
              </div>
              <div className="meta">
                <span>Alder Creek Family Services</span>
                <span>·</span>
                <span>
                  Account-level settings (profile, MFA, sessions, connected agents) live in{" "}
                  <Link to="/account/agents">Account settings</Link>
                </span>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
            <div className="card" id="notifications">
              <div className="card-h">
                <div>
                  <h2 style={{ fontSize: "18px" }}>Notifications</h2>
                  <p className="small muted">
                    Per event, for you. In-app notifications always appear in the bell; email can be sent at once or in a digest.
                  </p>
                </div>
              </div>
              <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
                <table className="tbl" style={{ fontSize: "15px" }}>
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>In-app</th>
                      <th>Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <div className="ent">
                          <span className="nm">Application status changes</span>
                          <span className="small muted">Submitted, under review, revision requested, decision</span>
                        </div>
                      </td>
                      <td>
                        <button
                          className="tog on"
                          role="switch"
                          aria-checked="true"
                          aria-label="Application status changes, in-app"
                        ></button>
                      </td>
                      <td>
                        <button
                          className="tog on"
                          role="switch"
                          aria-checked="true"
                          aria-label="Application status changes, email"
                        ></button>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <div className="ent">
                          <span className="nm">Messages from funders</span>
                          <span className="small muted">Shared thread replies</span>
                        </div>
                      </td>
                      <td>
                        <button className="tog on" role="switch" aria-checked="true" aria-label="Messages from funders, in-app"></button>
                      </td>
                      <td>
                        <button className="tog on" role="switch" aria-checked="true" aria-label="Messages from funders, email"></button>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <div className="ent">
                          <span className="nm">Revision requests</span>
                          <span className="small muted">Always sent by email as well</span>
                        </div>
                      </td>
                      <td>
                        <button
                          className="tog on"
                          role="switch"
                          aria-checked="true"
                          aria-label="Revision requests, in-app"
                          disabled
                        ></button>
                      </td>
                      <td>
                        <button
                          className="tog on"
                          role="switch"
                          aria-checked="true"
                          aria-label="Revision requests, email"
                          disabled
                        ></button>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <div className="ent">
                          <span className="nm">Report reminders</span>
                          <span className="small muted">14, 7 and 1 day before a requirement is due</span>
                        </div>
                      </td>
                      <td>
                        <button className="tog on" role="switch" aria-checked="true" aria-label="Report reminders, in-app"></button>
                      </td>
                      <td>
                        <button className="tog on" role="switch" aria-checked="true" aria-label="Report reminders, email"></button>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <div className="ent">
                          <span className="nm">Payment sent</span>
                          <span className="small muted">Amount, funder, bank name and last4</span>
                        </div>
                      </td>
                      <td>
                        <button className="tog on" role="switch" aria-checked="true" aria-label="Payment sent, in-app"></button>
                      </td>
                      <td>
                        <button className="tog on" role="switch" aria-checked="true" aria-label="Payment sent, email"></button>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <div className="ent">
                          <span className="nm">Consent requests from funders</span>
                          <span className="small muted">A funder asks to read more of your Passport record</span>
                        </div>
                      </td>
                      <td>
                        <button className="tog on" role="switch" aria-checked="true" aria-label="Consent requests, in-app"></button>
                      </td>
                      <td>
                        <button className="tog on" role="switch" aria-checked="true" aria-label="Consent requests, email"></button>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <div className="ent">
                          <span className="nm">Agent activity</span>
                          <span className="small muted">Drafts and proposals made by connected agents</span>
                        </div>
                      </td>
                      <td>
                        <button className="tog on" role="switch" aria-checked="true" aria-label="Agent activity, in-app"></button>
                      </td>
                      <td>
                        <button className="tog" role="switch" aria-checked="false" aria-label="Agent activity, email"></button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="card-f" style={{ gap: "14px", flexWrap: "wrap" }}>
                <label className="lbl" htmlFor="digest">
                  Email digest
                </label>
                <select className="sel" id="digest" style={{ maxWidth: "220px" }}>
                  <option>Daily at 8:00 AM PT</option>
                  <option>Weekly on Monday</option>
                  <option>Off — send each email at once</option>
                </select>
                <span className="help">Revision requests and payment confirmations are always sent immediately.</span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div className="card" id="tokens">
                <div className="card-h">
                  <div>
                    <h2 style={{ fontSize: "18px" }}>API tokens</h2>
                    <p className="small muted">
                      For scripts and integrations. Agents connect through MCP instead (
                      <Link to="/w/alder-creek/team">Team & access → Agents</Link>).
                    </p>
                  </div>
                </div>
                <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
                  <table className="tbl" style={{ fontSize: "14px" }}>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Scopes</th>
                        <th>Created</th>
                        <th>Last used</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="b">Board dashboard sync</td>
                        <td>
                          <div className="row wrap" style={{ gap: "4px" }}>
                            <span className="tag">grants:read</span>
                            <span className="tag">reports:read</span>
                          </div>
                        </td>
                        <td>Jan 9, 2027</td>
                        <td>Yesterday</td>
                        <td>
                          <button className="btn btn-sm btn-danger">Revoke</button>
                        </td>
                      </tr>
                      <tr>
                        <td className="b">QuickBooks bridge</td>
                        <td>
                          <div className="row wrap" style={{ gap: "4px" }}>
                            <span className="tag">budget:write</span>
                          </div>
                        </td>
                        <td>Mar 2, 2027</td>
                        <td>Today 6:10 AM</td>
                        <td>
                          <button className="btn btn-sm btn-danger">Revoke</button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="card-f" style={{ gap: "12px", flexWrap: "wrap" }}>
                  <button className="btn btn-primary">
                    <Key className="ic" aria-hidden="true" />
                    Create token
                  </button>
                  <span className="help">The secret is shown once, at creation. Tokens never carry submit or sign rights.</span>
                </div>
              </div>
              <div className="card" id="exports">
                <div className="card-h">
                  <div>
                    <h2 style={{ fontSize: "18px" }}>Exports</h2>
                    <p className="small muted">
                      Everything you have entered is yours to take. Exports are generated and emailed to you as a link.
                    </p>
                  </div>
                </div>
                <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <button className="btn btn-secondary" style={{ justifyContent: "flex-start" }}>
                    <Download className="ic" aria-hidden="true" />
                    Export all applications (CommonGrants JSON)
                  </button>
                  <button className="btn btn-secondary" style={{ justifyContent: "flex-start" }}>
                    <Download className="ic" aria-hidden="true" />
                    Export reports (CSV)
                  </button>
                  <button className="btn btn-secondary" style={{ justifyContent: "flex-start" }}>
                    <Download className="ic" aria-hidden="true" />
                    Export organization snapshot (PDF)
                  </button>
                  <span className="help">Last export: applications, Apr 2, 2027 by Jamal Reed.</span>
                </div>
              </div>
              <div className="card" style={{ borderColor: "#F1B4B4" }}>
                <div className="card-h">
                  <h2 style={{ fontSize: "18px", color: "#9B1C1C" }}>Danger zone</h2>
                </div>
                <div
                  className="card-b"
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}
                >
                  <div>
                    <div className="b">Leave this workspace</div>
                    <div className="help">
                      You lose access to Alder Creek Family Services on the GMS. Another owner must exist first; your Passport account is
                      not affected.
                    </div>
                  </div>
                  <button className="btn btn-danger">Leave workspace</button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </ApplicantShell>
    </>
  );
}
