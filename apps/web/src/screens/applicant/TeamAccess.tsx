// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { Bot, Check, Copy, Info, Lock, ShieldCheck, TriangleExclamationPoint } from "lucide-react";
import { ApplicantShell } from "../../components/shells.tsx";

export default function TeamAccess() {
  return (
    <>
      <title>{"Team & access — Alder Creek Family Services"}</title>
      <ApplicantShell active="Team & access">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/alder-creek">Dashboard</Link>
            <span>›</span>
            <span>Team & access</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Team & access</h1>
              </div>
              <div className="meta">
                <span>3 members</span>
                <span>·</span>
                <span>1 consultant</span>
                <span>·</span>
                <span>2 funders with consent</span>
                <span>·</span>
                <span>1 connected agent</span>
              </div>
            </div>
          </div>
          <div className="tabs" role="tablist" aria-label="Access sections">
            <a href="#members" className="tab on" role="tab" aria-selected="true">
              Members<span className="n">3</span>
            </a>
            <a href="#consultants" className="tab" role="tab">
              Consultants<span className="n">1</span>
            </a>
            <a href="#funders" className="tab" role="tab">
              Funders with access<span className="n">2</span>
            </a>
            <a href="#agents" className="tab" role="tab">
              Agents<span className="n">1</span>
            </a>
          </div>
          <div className="card" id="members">
            <div className="card-h">
              <div>
                <h2 style={{ fontSize: "18px" }}>Members</h2>
                <p className="small muted">
                  People at Alder Creek Family Services. Owners manage access; editors write applications and reports; viewers read.
                </p>
              </div>
            </div>
            <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
              <table className="tbl" style={{ fontSize: "15px" }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>MFA</th>
                    <th>Last active</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <div className="row" style={{ gap: "10px" }}>
                        <span className="av av-t">MS</span>
                        <div className="ent">
                          <span className="nm">Maria Santos</span>
                          <span className="small muted">Executive Director</span>
                        </div>
                      </div>
                    </td>
                    <td>maria@aldercreekfs.example</td>
                    <td>
                      <span className="role">Owner</span>
                    </td>
                    <td>
                      <span className="bdg bdg-ok">
                        <ShieldCheck className="ic" aria-hidden="true" />
                        MFA on
                      </span>
                    </td>
                    <td>Now</td>
                    <td>
                      <span className="muted small">You</span>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <div className="row" style={{ gap: "10px" }}>
                        <span className="av">JR</span>
                        <div className="ent">
                          <span className="nm">Jamal Reed</span>
                          <span className="small muted">Grants Manager</span>
                        </div>
                      </div>
                    </td>
                    <td>jamal@aldercreekfs.example</td>
                    <td>
                      <span className="role">Editor</span>
                    </td>
                    <td>
                      <span className="bdg bdg-ok">
                        <ShieldCheck className="ic" aria-hidden="true" />
                        MFA on
                      </span>
                    </td>
                    <td>2 hours ago</td>
                    <td>
                      <button className="btn btn-sm btn-ghost">Change role</button>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <div className="row" style={{ gap: "10px" }}>
                        <span className="av av-g">TA</span>
                        <div className="ent">
                          <span className="nm">Tom Alvarez</span>
                          <span className="small muted">Board treasurer</span>
                        </div>
                      </div>
                    </td>
                    <td>tom@aldercreekfs.example</td>
                    <td>
                      <span className="role">Viewer</span>
                    </td>
                    <td>
                      <span className="bdg bdg-warn">
                        <TriangleExclamationPoint className="ic" aria-hidden="true" />
                        MFA off
                      </span>
                    </td>
                    <td>Mar 30, 2027</td>
                    <td>
                      <button className="btn btn-sm btn-ghost">Remind to enroll</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="card-f" style={{ gap: "12px", flexWrap: "wrap" }}>
              <label className="sr" htmlFor="inv-email">
                Email to invite
              </label>
              <input className="inp" id="inv-email" placeholder="name@aldercreekfs.example" style={{ maxWidth: "320px" }} />
              <label className="sr" htmlFor="inv-role">
                Role
              </label>
              <select className="sel" id="inv-role" style={{ maxWidth: "160px" }}>
                <option>Editor</option>
                <option>Viewer</option>
                <option>Owner</option>
              </select>
              <button className="btn btn-primary">Invite member</button>
              <span className="help">Invitations expire in 7 days. MFA is required before a member can submit or sign.</span>
            </div>
          </div>
          <div className="card" id="consultants">
            <div className="card-h">
              <div>
                <h2 style={{ fontSize: "18px" }}>Consultants</h2>
                <p className="small muted">External people with access to specific applications or grants only, for a limited time.</p>
              </div>
            </div>
            <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
              <table className="tbl" style={{ fontSize: "15px" }}>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Organization</th>
                    <th>Scope</th>
                    <th>Expires</th>
                    <th>MFA</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <div className="row" style={{ gap: "10px" }}>
                        <span className="av av-g">LF</span>
                        <div className="ent">
                          <span className="nm">Lena Fischer</span>
                          <span className="small muted">lena@fischergrants.example</span>
                        </div>
                      </div>
                    </td>
                    <td>Fischer Grant Consulting</td>
                    <td>
                      <div className="ent">
                        <Link to="/w/alder-creek/applications/app_01HZX4/edit">Mobile Health Navigation · app_01HZX4</Link>
                        <span className="small muted">Budget section only · can comment anywhere</span>
                      </div>
                    </td>
                    <td>Jun 30, 2027</td>
                    <td>
                      <span className="bdg bdg-ok">
                        <ShieldCheck className="ic" aria-hidden="true" />
                        MFA on
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-sm btn-danger">Revoke</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div
              className="card-b"
              style={{
                borderTop: "1px solid #D6DEDE",
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)",
                gap: "20px",
                alignItems: "start",
              }}
            >
              <div className="fld">
                <label className="lbl" htmlFor="c-email">
                  Invite a consultant
                </label>
                <input className="inp" id="c-email" placeholder="name@firm.example" />
                <span className="help">They get their own sign-in; nothing outside the scope below is visible to them.</span>
              </div>
              <div className="fld">
                <span className="lbl">Scope</span>
                <label className="cb" htmlFor="sc1">
                  <input type="checkbox" id="sc1" className="sr" defaultChecked />
                  <span className="c on" aria-hidden="true">
                    <Check className="ic ic-sm" aria-hidden="true" />
                  </span>
                  <span>Application · Mobile Health Navigation (Riverbend)</span>
                </label>
                <label className="cb" htmlFor="sc2">
                  <input type="checkbox" id="sc2" className="sr" />
                  <span className="c" aria-hidden="true"></span>
                  <span>Application · Rural Immunization Outreach 2027 (Cascade County)</span>
                </label>
                <label className="cb" htmlFor="sc3">
                  <input type="checkbox" id="sc3" className="sr" />
                  <span className="c" aria-hidden="true"></span>
                  <span>Grant · awd_01J2Q7 reports (Riverbend)</span>
                </label>
              </div>
              <div className="fld">
                <label className="lbl" htmlFor="c-exp">
                  Access expires
                </label>
                <input className="inp" id="c-exp" defaultValue="Jun 30, 2027" />
                <button className="btn btn-primary" style={{ alignSelf: "flex-start", marginTop: "6px" }}>
                  Send invitation
                </button>
              </div>
            </div>
          </div>
          <div className="card" id="funders">
            <div className="card-h">
              <div>
                <h2 style={{ fontSize: "18px" }}>Funders with access</h2>
                <p className="small muted">
                  What each funder may read from your Passport record, in plain language. Revoking stops future reads; what you already
                  submitted stays with the application.
                </p>
              </div>
            </div>
            <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
              <table className="tbl" style={{ fontSize: "15px" }}>
                <thead>
                  <tr>
                    <th>Funder</th>
                    <th>Can read</th>
                    <th>Granted via</th>
                    <th>Since</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <span className="chip">
                        <span className="tdot" aria-hidden="true"></span>Riverbend Community Foundation
                      </span>
                    </td>
                    <td style={{ whiteSpace: "normal" }}>
                      Organization profile · documents in your locker · representatives · Passport level and attestation · proposed changes
                      to your record
                    </td>
                    <td>Application to Community Health Grants 2027</td>
                    <td>Feb 3, 2027</td>
                    <td>
                      <button className="btn btn-sm btn-danger">Revoke</button>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span className="chip" style={{ "--tenant": "#7A4F01" } as CSSProperties}>
                        <span className="tdot" aria-hidden="true"></span>Cascade County Health Department
                      </span>
                    </td>
                    <td style={{ whiteSpace: "normal" }}>
                      Organization profile · documents in your locker · Passport level and attestation · payee status (bank name and last4
                      only)
                    </td>
                    <td>Grant agreement, Rural Immunization Outreach</td>
                    <td>Aug 12, 2025</td>
                    <td>
                      <button className="btn btn-sm btn-danger">Revoke</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="card-b" style={{ borderTop: "1px solid #D6DEDE" }}>
              <div className="bnr bnr-info">
                <Info className="ic" aria-hidden="true" />
                <div>
                  <div className="t">Request made by funder</div>
                  <div className="d">
                    Riverbend Community Foundation requests access to:<b>payee status (bank name and last4 only)</b>, to schedule tranche
                    payments for your award. Requested by Marcus Lee · May 19, 2027.
                  </div>
                  <div className="clears" style={{ fontWeight: 400 }}>
                    Riverbend never sees account or routing numbers; payments go to the destination you verified in Passport.
                  </div>
                </div>
                <div className="act row" style={{ gap: "8px" }}>
                  <button className="btn btn-primary">Approve</button>
                  <button className="btn btn-secondary">Decline</button>
                </div>
              </div>
            </div>
          </div>
          <div className="card" id="agents">
            <div className="card-h">
              <div>
                <h2 style={{ fontSize: "18px" }}>Agents</h2>
                <p className="small muted">
                  MCP clients connected to this workspace. Everything a screen can do is also a tool; the actions below always need a
                  person.
                </p>
              </div>
            </div>
            <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
              <table className="tbl" style={{ fontSize: "15px" }}>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Client</th>
                    <th>Scopes</th>
                    <th>Last used</th>
                    <th>Connected by</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <div className="row" style={{ gap: "10px" }}>
                        <span className="av av-a">
                          <Bot className="ic" aria-hidden="true" />
                        </span>
                        <span className="b">Grants drafting agent</span>
                      </div>
                    </td>
                    <td>Cursor</td>
                    <td>
                      <div className="row wrap" style={{ gap: "4px" }}>
                        <span className="tag">applications:write</span>
                        <span className="tag">library:read</span>
                        <span className="pill-warn">
                          <Lock className="ic ic-sm" aria-hidden="true" />
                          submit gated
                        </span>
                      </div>
                    </td>
                    <td>3 days ago</td>
                    <td>Jamal Reed</td>
                    <td>
                      <button className="btn btn-sm btn-danger">Revoke</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div
              className="card-b"
              style={{
                borderTop: "1px solid #D6DEDE",
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)",
                gap: "24px",
                alignItems: "start",
              }}
            >
              <div
                className="card"
                style={{ padding: "20px", background: "#F7FAFA", display: "flex", flexDirection: "column", gap: "12px" }}
              >
                <h3>Let your agent apply</h3>
                <p className="small muted">
                  Point any MCP client at this workspace. It can read your Passport-sourced profile, draft answers from the library, and
                  fill applications; a person still submits.
                </p>
                <div className="row" style={{ gap: "8px" }}>
                  <label className="sr" htmlFor="mcp-url">
                    MCP server URL
                  </label>
                  <input
                    className="inp mono"
                    id="mcp-url"
                    defaultValue="https://gms.opengrants.io/mcp/w/alder-creek"
                    readOnly
                    style={{ fontSize: "14px" }}
                  />
                  <button className="btn btn-secondary" aria-label="Copy server URL">
                    <Copy className="ic" aria-hidden="true" />
                    Copy
                  </button>
                </div>
                <ol style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "15px", counterReset: "s" }}>
                  <li className="row" style={{ gap: "10px", alignItems: "flex-start" }}>
                    <span className="av av-sm av-n">1</span>
                    <span>Add the server URL in your client's MCP settings.</span>
                  </li>
                  <li className="row" style={{ gap: "10px", alignItems: "flex-start" }}>
                    <span className="av av-sm av-n">2</span>
                    <span>
                      Sign in when the client opens the consent screen and choose this workspace and scopes (
                      <Link to="/oauth/consent">see the consent screen</Link>).
                    </span>
                  </li>
                  <li className="row" style={{ gap: "10px", alignItems: "flex-start" }}>
                    <span className="av av-sm av-n">3</span>
                    <span>Gated actions show up as approval requests for a member to approve.</span>
                  </li>
                </ol>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <span className="lbl">Human gates</span>
                <div className="row" style={{ justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid #EEF3F3" }}>
                  <div>
                    <div className="b">Submitting an application needs a human</div>
                    <div className="help">Always on for every workspace.</div>
                  </div>
                  <div className="row" style={{ gap: "6px" }}>
                    <Lock className="ic" aria-hidden="true" style={{ color: "#4A5C5A" }} />
                    <button
                      className="tog on"
                      role="switch"
                      aria-checked="true"
                      aria-label="Submitting an application needs a human"
                      disabled
                    ></button>
                  </div>
                </div>
                <div className="row" style={{ justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid #EEF3F3" }}>
                  <div>
                    <div className="b">Signing an agreement needs a human</div>
                    <div className="help">Always on for every workspace.</div>
                  </div>
                  <div className="row" style={{ gap: "6px" }}>
                    <Lock className="ic" aria-hidden="true" style={{ color: "#4A5C5A" }} />
                    <button
                      className="tog on"
                      role="switch"
                      aria-checked="true"
                      aria-label="Signing an agreement needs a human"
                      disabled
                    ></button>
                  </div>
                </div>
                <div className="row" style={{ justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid #EEF3F3" }}>
                  <div>
                    <div className="b">Sharing a report with another funder needs a human</div>
                    <div className="help">Recommended: sharing sends your data to a third party.</div>
                  </div>
                  <button
                    className="tog on"
                    role="switch"
                    aria-checked="true"
                    aria-label="Sharing a report with another funder needs a human"
                  ></button>
                </div>
                <div className="row" style={{ justifyContent: "space-between", padding: "12px 0" }}>
                  <div>
                    <div className="b">Drafting answers</div>
                    <div className="help">Off means agents may draft without approval; drafts are marked “By agent”.</div>
                  </div>
                  <button className="tog" role="switch" aria-checked="false" aria-label="Drafting answers needs a human"></button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </ApplicantShell>
    </>
  );
}
