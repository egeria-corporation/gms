// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import { ArrowRight, Bot, Check, ChevronDown, Circle, CircleCheck, CircleX, Copy, Info, Lock, Plus, ShieldCheck } from "lucide-react";
import { FunderShell } from "../../components/shells.tsx";

export default function SettingsMcp() {
  return (
    <>
      <title>{"Settings — MCP and human gates — Riverbend funder workspace"}</title>
      <FunderShell active="Settings">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/riverbend">Riverbend</Link>
            <span>›</span>
            <Link to="/w/riverbend/settings/mcp">Settings</Link>
            <span>›</span>
            <span>MCP</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Settings</h1>
              </div>
              <div className="meta">
                <span>Workspace administration · changes are written to the audit ledger</span>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "200px minmax(0, 1fr)", gap: "24px", alignItems: "start" }}>
            <nav
              className="card snav"
              aria-label="Settings sections"
              style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "2px", position: "sticky", top: "16px" }}
            >
              <Link to="/onboarding/funder">Branding</Link>
              <a href="#team">Team & roles</a>
              <a href="#rubrics">Rubrics</a>
              <Link to="/w/riverbend/communications">Templates</Link>
              <Link to="/w/riverbend/payments/due">Payments</Link>
              <a href="#integrations">Integrations</a>
              <a href="#api">API & webhooks</a>
              <a href="#mcp" className="on" aria-current="true">
                MCP{" "}
                <span
                  className="count"
                  style={{
                    minWidth: "20px",
                    height: "20px",
                    padding: "0 6px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "10px",
                    fontSize: "11px",
                    fontWeight: 700,
                    background: "#ECE6FA",
                    color: "#4B2E9E",
                  }}
                >
                  2
                </span>
              </a>
              <a href="#import">Import / Export</a>
              <a href="#audit">Audit ledger</a>
            </nav>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: "0" }}>
              <section id="mcp" className="card">
                <div className="card-h">
                  <div>
                    <h3>Connected agents</h3>
                    <p className="small muted">
                      Agents act as users: every tool call is attributed, scoped, and reviewable. Gated tools create an approval request
                      instead of acting.
                    </p>
                  </div>
                  <Link to="/w/riverbend/approvals" className="btn btn-sm btn-secondary">
                    Open approvals
                    <span
                      className="count"
                      style={{
                        minWidth: "18px",
                        height: "18px",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "9px",
                        fontSize: "11px",
                        background: "#ECE6FA",
                        color: "#4B2E9E",
                        padding: "0 5px",
                      }}
                    >
                      1
                    </span>
                  </Link>
                </div>
                <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Agent</th>
                        <th>Client</th>
                        <th>Connected by</th>
                        <th>Scopes</th>
                        <th>Last used</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <div className="ent">
                            <span className="nm row" style={{ gap: "6px" }}>
                              <span className="av av-sm av-a">
                                <Bot className="ic ic-sm" aria-hidden="true" />
                              </span>
                              Riverbend Triage Agent
                            </span>
                            <span className="muted xs">client id mcp_8f21 · via Claude</span>
                          </div>
                        </td>
                        <td>Claude</td>
                        <td>
                          <span className="row" style={{ gap: "6px" }}>
                            <span className="av av-sm">DO</span>Dana Ortiz
                          </span>
                        </td>
                        <td>
                          <div className="row wrap" style={{ gap: "4px" }}>
                            <span className="tag">applications:read</span>
                            <span className="tag">applications:propose</span>
                            <span className="tag">letters:draft</span>
                          </div>
                        </td>
                        <td>2 min ago</td>
                        <td>
                          <span className="bdg bdg-ok">
                            <CircleCheck className="ic" aria-hidden="true" />
                            Active
                          </span>
                        </td>
                        <td>
                          <button className="btn btn-sm btn-danger">Revoke</button>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          <div className="ent">
                            <span className="nm row" style={{ gap: "6px" }}>
                              <span className="av av-sm av-a">
                                <Bot className="ic ic-sm" aria-hidden="true" />
                              </span>
                              Finance reconcile agent
                            </span>
                            <span className="muted xs">client id mcp_c04d · via Cursor</span>
                          </div>
                        </td>
                        <td>Cursor</td>
                        <td>
                          <span className="row" style={{ gap: "6px" }}>
                            <span className="av av-sm av-n">ML</span>Marcus Lee
                          </span>
                        </td>
                        <td>
                          <div className="row wrap" style={{ gap: "4px" }}>
                            <span className="tag">payments:read</span>
                            <span className="tag">reconcile:propose</span>
                          </div>
                        </td>
                        <td>3 days ago</td>
                        <td>
                          <span className="bdg bdg-ok">
                            <CircleCheck className="ic" aria-hidden="true" />
                            Active
                          </span>
                        </td>
                        <td>
                          <button className="btn btn-sm btn-danger">Revoke</button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
                <section className="card">
                  <div className="card-h">
                    <h3>Connect an agent</h3>
                    <span className="tag">MCP · streamable HTTP</span>
                  </div>
                  <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div className="fld">
                      <label className="lbl" htmlFor="mcp-url">
                        Server URL for this workspace
                      </label>
                      <div className="row" style={{ gap: "8px" }}>
                        <input
                          className="inp mono"
                          id="mcp-url"
                          defaultValue="https://gms.opengrants.io/mcp/w/riverbend"
                          readOnly
                          style={{ fontSize: "12px" }}
                        />
                        <button className="btn btn-secondary" aria-label="Copy server URL">
                          <Copy className="ic" aria-hidden="true" />
                          Copy
                        </button>
                      </div>
                    </div>
                    <ol className="stp-v" style={{ gap: "0" }}>
                      <li className="s done">
                        <span className="n">
                          <Check className="ic ic-sm" aria-hidden="true" />
                        </span>
                        <div>
                          <div className="t">Add the server to your client</div>
                          <div className="d">Paste the URL into Claude, Cursor, or any MCP client that supports OAuth.</div>
                        </div>
                      </li>
                      <li className="s on">
                        <span className="n">2</span>
                        <div>
                          <div className="t">Sign in</div>
                          <div className="d">The client opens the GMS sign-in; you authenticate as yourself, with MFA.</div>
                        </div>
                      </li>
                      <li className="s">
                        <span className="n">3</span>
                        <div>
                          <div className="t">Choose workspace and scopes</div>
                          <div className="d">Pick Riverbend, grant scopes by area, and see which tools are gated by a human.</div>
                        </div>
                      </li>
                    </ol>
                    <Link to="/oauth/consent" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
                      Start connection
                      <ArrowRight className="ic" aria-hidden="true" />
                    </Link>
                    <span className="help">
                      The agent inherits the connecting user's permissions and never more. Scopes can be narrowed later; widening requires a
                      new consent.
                    </span>
                  </div>
                </section>
                <section className="card">
                  <div className="card-h">
                    <div>
                      <h3>Human gates</h3>
                      <p className="small muted">
                        Tools that create an approval request instead of acting. Locked gates cannot be turned off.
                      </p>
                    </div>
                  </div>
                  <div className="card-b" style={{ paddingTop: "8px" }}>
                    <div className="rc">
                      <div className="rc-row rc-pass">
                        <Lock className="ic" aria-hidden="true" />
                        <div>
                          <div className="l">Commit decisions</div>
                          <div className="r">commit_decisions · always needs a human in this workspace (locked by policy)</div>
                        </div>
                        <span
                          className="tog on"
                          role="switch"
                          aria-checked="true"
                          aria-disabled="true"
                          aria-label="Commit decisions requires approval (locked)"
                          style={{ opacity: ".6" }}
                        ></span>
                      </div>
                      <div className="rc-row rc-pass">
                        <CircleCheck className="ic" aria-hidden="true" />
                        <div>
                          <div className="l">Send letters</div>
                          <div className="r">
                            send_letters · an agent may draft; sending waits for approval with a preview of every letter
                          </div>
                        </div>
                        <button className="tog on" role="switch" aria-checked="true" aria-label="Send letters requires approval"></button>
                      </div>
                      <div className="rc-row rc-pass">
                        <Lock className="ic" aria-hidden="true" />
                        <div>
                          <div className="l">Release payments</div>
                          <div className="r">
                            release_tranche · always human, in every workspace. Agents can read readiness and propose, never release.
                          </div>
                        </div>
                        <span
                          className="tog on"
                          role="switch"
                          aria-checked="true"
                          aria-disabled="true"
                          aria-label="Release payments requires approval (locked)"
                          style={{ opacity: ".6" }}
                        ></span>
                      </div>
                      <div className="rc-row rc-pass">
                        <Lock className="ic" aria-hidden="true" />
                        <div>
                          <div className="l">Sign agreements</div>
                          <div className="r">
                            sign_agreement · always human. A signature records a person's name, time, IP and the document hash.
                          </div>
                        </div>
                        <span
                          className="tog on"
                          role="switch"
                          aria-checked="true"
                          aria-disabled="true"
                          aria-label="Sign agreements requires approval (locked)"
                          style={{ opacity: ".6" }}
                        ></span>
                      </div>
                      <div className="rc-row rc-pass">
                        <CircleCheck className="ic" aria-hidden="true" />
                        <div>
                          <div className="l">Change eligibility rules</div>
                          <div className="r">update_eligibility · affects who can apply; approval shows the plain-language diff</div>
                        </div>
                        <button
                          className="tog on"
                          role="switch"
                          aria-checked="true"
                          aria-label="Change eligibility rules requires approval"
                        ></button>
                      </div>
                      <div className="rc-row rc-unk">
                        <Circle className="ic" aria-hidden="true" />
                        <div>
                          <div className="l">Advance applications</div>
                          <div className="r">advance_application · acts immediately; attributed on the record and reversible</div>
                        </div>
                        <button
                          className="tog"
                          role="switch"
                          aria-checked="false"
                          aria-label="Advance applications requires approval"
                        ></button>
                      </div>
                      <div className="rc-row rc-unk">
                        <Circle className="ic" aria-hidden="true" />
                        <div>
                          <div className="l">Request revision</div>
                          <div className="r">request_revision · acts immediately; the applicant sees the agent attribution</div>
                        </div>
                        <button className="tog" role="switch" aria-checked="false" aria-label="Request revision requires approval"></button>
                      </div>
                    </div>
                  </div>
                  <div className="card-f small muted">
                    <Info className="ic" aria-hidden="true" />
                    Approvals expire after 7 days. Expired requests are rejected and logged.
                  </div>
                </section>
              </div>
              <section className="card">
                <div className="card-h">
                  <div>
                    <h3>Custom MCP servers</h3>
                    <p className="small muted">
                      Servers your agents may call from inside this workspace. Each tool is allowed individually; read-only locks block any
                      tool that writes.
                    </p>
                  </div>
                </div>
                <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>URL</th>
                        <th>Auth</th>
                        <th>Tools allowed</th>
                        <th>Read-only</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="b">County data warehouse</td>
                        <td className="mono">https://data.cascade.example/mcp</td>
                        <td>OAuth</td>
                        <td>
                          3 of 7 <span className="muted">· search_indicators, get_tract, list_datasets</span>
                        </td>
                        <td>
                          <span className="row" style={{ gap: "5px", color: "#0B5E47", fontWeight: 700 }}>
                            <Lock className="ic" aria-hidden="true" />
                            Locked
                          </span>
                        </td>
                        <td>
                          <div className="row" style={{ gap: "6px" }}>
                            <button className="btn btn-sm btn-secondary">Edit</button>
                            <button className="btn btn-sm btn-danger">Remove</button>
                          </div>
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
                    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) 180px",
                    gap: "16px",
                    alignItems: "end",
                  }}
                >
                  <div className="fld">
                    <label className="lbl" htmlFor="srv-name">
                      Add server · name
                    </label>
                    <input className="inp" id="srv-name" placeholder="e.g. State grants registry" />
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor="srv-url">
                      URL
                    </label>
                    <input className="inp mono" id="srv-url" placeholder="https://…/mcp" style={{ fontSize: "12px" }} />
                  </div>
                  <div className="fld">
                    <label className="lbl" htmlFor="srv-auth">
                      Auth
                    </label>
                    <select className="sel" id="srv-auth">
                      <option>OAuth</option>
                      <option>Bearer token</option>
                      <option>None (public)</option>
                    </select>
                  </div>
                  <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <span className="lbl">
                      Tool allow-list
                      <span className="muted" style={{ fontWeight: 400 }}>
                        · discovered after the first connection; read-only lock on by default
                      </span>
                    </span>
                    <div className="row wrap" style={{ gap: "10px" }}>
                      <span className="row" style={{ gap: "8px", fontSize: "13px" }}>
                        <button className="tog on" role="switch" aria-checked="true" aria-label="Read-only lock"></button>Read-only lock
                      </span>
                      <span className="row" style={{ gap: "8px", fontSize: "13px", color: "#4A5C5A" }}>
                        <span
                          className="tog"
                          role="switch"
                          aria-checked="false"
                          aria-disabled="true"
                          aria-label="list_datasets (discovered after connection)"
                          style={{ opacity: ".5" }}
                        ></span>
                        list_*
                      </span>
                      <span className="row" style={{ gap: "8px", fontSize: "13px", color: "#4A5C5A" }}>
                        <span
                          className="tog"
                          role="switch"
                          aria-checked="false"
                          aria-disabled="true"
                          aria-label="get tools (discovered after connection)"
                          style={{ opacity: ".5" }}
                        ></span>
                        get_*
                      </span>
                      <span className="row" style={{ gap: "8px", fontSize: "13px", color: "#4A5C5A" }}>
                        <span
                          className="tog"
                          role="switch"
                          aria-checked="false"
                          aria-disabled="true"
                          aria-label="write tools (blocked by read-only lock)"
                          style={{ opacity: ".5" }}
                        ></span>
                        write / update (blocked while locked)
                      </span>
                    </div>
                    <div className="row" style={{ gap: "8px" }}>
                      <button className="btn btn-primary">Add server</button>
                      <span className="help">Connecting tests the URL and lists its tools before anything is allowed.</span>
                    </div>
                  </div>
                </div>
              </section>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
                <section id="integrations" className="card">
                  <div className="card-h">
                    <h3>Integrations</h3>
                    <a href="#integrations" className="small b">
                      Manage
                    </a>
                  </div>
                  <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div className="row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #EEF3F3" }}>
                      <span className="row" style={{ gap: "10px" }}>
                        <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "20px", height: "20px" }} />
                        <span>
                          <span className="b">OpenGrants</span>
                          <span className="muted small">· opportunities indexed, sitemap submitted</span>
                        </span>
                      </span>
                      <span className="bdg bdg-ok">
                        <CircleCheck className="ic" aria-hidden="true" />
                        Connected
                      </span>
                    </div>
                    <div className="row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #EEF3F3" }}>
                      <span>
                        <span className="b">Google Workspace</span>
                        <span className="muted small">· Drive picker for attachments, calendar for interviews</span>
                      </span>
                      <span className="bdg bdg-ok">
                        <CircleCheck className="ic" aria-hidden="true" />
                        Connected
                      </span>
                    </div>
                    <div className="row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #EEF3F3" }}>
                      <span>
                        <span className="b">Mercury</span>
                        <span className="muted small">· outbound transactions for reconciliation (read-only)</span>
                      </span>
                      <span className="bdg bdg-ok">
                        <CircleCheck className="ic" aria-hidden="true" />
                        Connected
                      </span>
                    </div>
                    <div className="row" style={{ justifyContent: "space-between", padding: "8px 0" }}>
                      <span>
                        <span className="b">Resend</span>
                        <span className="muted small">· sending domain riverbendcf.example · SPF, DKIM, DMARC</span>
                      </span>
                      <span className="bdg bdg-ok">
                        <ShieldCheck className="ic" aria-hidden="true" />
                        Verified
                      </span>
                    </div>
                  </div>
                </section>
                <section id="api" className="card">
                  <div className="card-h">
                    <h3>API & webhooks</h3>
                    <button className="btn btn-sm btn-secondary">
                      <Plus className="ic" aria-hidden="true" />
                      New client
                    </button>
                  </div>
                  <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
                    <table className="tbl tbl-compact">
                      <thead>
                        <tr>
                          <th>Client</th>
                          <th>Scopes</th>
                          <th>Created</th>
                          <th>Secret</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="b">Board reporting sync</td>
                          <td>
                            <div className="row wrap" style={{ gap: "4px" }}>
                              <span className="tag">awards:read</span>
                              <span className="tag">analytics:read</span>
                            </div>
                          </td>
                          <td className="muted">Jan 12, 2027</td>
                          <td className="muted">
                            Shown once · <a href="#api">Rotate</a>
                          </td>
                        </tr>
                        <tr>
                          <td className="b">Website embed</td>
                          <td>
                            <div className="row wrap" style={{ gap: "4px" }}>
                              <span className="tag">opportunities:read</span>
                            </div>
                          </td>
                          <td className="muted">Nov 3, 2026</td>
                          <td className="muted">
                            Shown once · <a href="#api">Rotate</a>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="card-b" style={{ borderTop: "1px solid #D6DEDE", display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="b">Webhook endpoint</span>
                      <span className="mono" style={{ fontSize: "11px" }}>
                        https://hooks.riverbendcf.example/gms
                      </span>
                    </div>
                    <div className="row wrap" style={{ gap: "6px", fontSize: "12px" }}>
                      <span className="cb" style={{ gap: "6px", fontSize: "12px" }}>
                        <span className="c on">
                          <Check className="ic ic-sm" aria-hidden="true" />
                        </span>
                        application.submitted
                      </span>
                      <span className="cb" style={{ gap: "6px", fontSize: "12px" }}>
                        <span className="c on">
                          <Check className="ic ic-sm" aria-hidden="true" />
                        </span>
                        decision.committed
                      </span>
                      <span className="cb" style={{ gap: "6px", fontSize: "12px" }}>
                        <span className="c on">
                          <Check className="ic ic-sm" aria-hidden="true" />
                        </span>
                        tranche.settled
                      </span>
                      <span className="cb" style={{ gap: "6px", fontSize: "12px" }}>
                        <span className="c"></span>requirement.accepted
                      </span>
                      <span className="cb" style={{ gap: "6px", fontSize: "12px" }}>
                        <span className="c"></span>agreement.executed
                      </span>
                    </div>
                    <div className="tbl-wrap" style={{ borderRadius: "8px" }}>
                      <table className="tbl tbl-compact">
                        <thead>
                          <tr>
                            <th>Delivery</th>
                            <th>Event</th>
                            <th>Response</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td className="muted">10:41:07</td>
                            <td className="mono">tranche.settled</td>
                            <td className="mono">200 · 184 ms</td>
                            <td>
                              <span className="bdg bdg-ok">
                                <CircleCheck className="ic" aria-hidden="true" />
                                Delivered
                              </span>
                            </td>
                          </tr>
                          <tr>
                            <td className="muted">10:02:15</td>
                            <td className="mono">decision.committed</td>
                            <td className="mono">503 · retry 3/5 in 8 min</td>
                            <td>
                              <span className="bdg bdg-dng">
                                <CircleX className="ic" aria-hidden="true" />
                                Failed
                              </span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <details className="small">
                      <summary className="b" style={{ cursor: "pointer", color: "#9B1C1C" }}>
                        Failed delivery detail · decision.committed · evt_7a91
                      </summary>
                      <dl className="kv" style={{ marginTop: "8px", fontSize: "12px" }}>
                        <dt>Attempts</dt>
                        <dd>3 of 5 · backoff 1, 2, 8 min</dd>
                        <dt>Last response</dt>
                        <dd className="mono">HTTP 503 Service Unavailable · "upstream timeout"</dd>
                        <dt>Signature</dt>
                        <dd className="mono">HMAC-SHA256 · header X-GMS-Signature · secret rotated Jan 12</dd>
                        <dt>Payload</dt>
                        <dd>
                          <a href="#api">View JSON</a> · <a href="#api">Replay now</a>
                        </dd>
                      </dl>
                    </details>
                  </div>
                </section>
              </div>
              <section id="audit" className="card">
                <div className="card-h">
                  <h3>Audit ledger</h3>
                  <div className="row" style={{ gap: "8px" }}>
                    <button className="fchip">
                      Actor: All
                      <ChevronDown className="ic ic-sm" aria-hidden="true" />
                    </button>
                    <button className="fchip">
                      Area: Settings
                      <ChevronDown className="ic ic-sm" aria-hidden="true" />
                    </button>
                    <button className="btn btn-sm btn-secondary">Export</button>
                  </div>
                </div>
                <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
                  <table className="tbl tbl-compact">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Actor</th>
                        <th>Action</th>
                        <th>Target</th>
                        <th>Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="muted">May 25, 2027 10:01</td>
                        <td>
                          <span className="row" style={{ gap: "6px" }}>
                            <span className="av av-sm">DO</span>Dana Ortiz
                          </span>
                        </td>
                        <td>approval.approved</td>
                        <td>Agent proposal #a-1042</td>
                        <td className="muted">14 declines · Standard decline v3 · proposed by Riverbend Triage Agent</td>
                      </tr>
                      <tr>
                        <td className="muted">May 25, 2027 09:58</td>
                        <td>
                          <span className="row" style={{ gap: "6px" }}>
                            <span className="av av-sm av-a">
                              <Bot className="ic ic-sm" aria-hidden="true" />
                            </span>
                            Riverbend Triage Agent
                          </span>
                        </td>
                        <td>applications.propose_decline</td>
                        <td>14 applications</td>
                        <td className="muted">Eligibility rule "service area" failed · gated, no change applied</td>
                      </tr>
                      <tr>
                        <td className="muted">May 22, 2027 14:30</td>
                        <td>
                          <span className="row" style={{ gap: "6px" }}>
                            <span className="av av-sm av-n">ML</span>Marcus Lee
                          </span>
                        </td>
                        <td>settings.mcp.custom_server.added</td>
                        <td>County data warehouse</td>
                        <td className="muted">3 tools allowed · read-only lock on</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="card-f">
                  <a href="#audit" className="small b">
                    Open the full ledger →
                  </a>
                </div>
              </section>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span className="eyebrow">State · secret reveal (shown once)</span>
                <div className="mdl" style={{ width: "auto", maxWidth: "640px", boxShadow: "none", border: "1px solid #D6DEDE" }}>
                  <div className="hd">
                    <div>
                      <h3 style={{ fontSize: "16px" }}>Client secret for “Board reporting sync”</h3>
                      <p className="small muted" style={{ marginTop: "4px" }}>
                        Copy it now. For security the GMS stores only a hash and cannot show this value again; rotating creates a new one.
                      </p>
                    </div>
                  </div>
                  <div className="bd">
                    <div className="row" style={{ gap: "8px" }}>
                      <input
                        className="inp mono"
                        defaultValue="gms_sk_live_•••••••••••••••••••••••••••••••••Q7m2"
                        readOnly
                        aria-label="Client secret"
                        style={{ fontSize: "12px" }}
                      />
                      <button className="btn btn-secondary" aria-label="Copy client secret">
                        <Copy className="ic" aria-hidden="true" />
                        Copy
                      </button>
                    </div>
                    <label className="cb">
                      <span className="c on">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </span>
                      <span>I have stored this secret somewhere safe</span>
                    </label>
                  </div>
                  <div className="ft">
                    <button className="btn btn-primary">Done</button>
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
