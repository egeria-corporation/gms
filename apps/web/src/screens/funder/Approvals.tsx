// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import { Bot, Check, TriangleExclamationPoint, X } from "lucide-react";
import { FunderShell } from "../../components/shells.tsx";

export default function Approvals() {
  return (
    <>
      <title>{"Approvals — agent requests"}</title>
      <FunderShell active="Approvals">
        <main className="main">
          <div className="crumbs">
            <Link to="/w/riverbend">Riverbend</Link>
            <span>›</span>
            <span>Approvals</span>
          </div>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Approvals</h1>
                <span className="bdg bdg-agent">
                  <Bot className="ic" aria-hidden="true" />1 pending
                </span>
              </div>
              <div className="meta">
                <span>
                  Actions that agents may prepare but a person must approve. Gated tools are set in{" "}
                  <Link to="/w/riverbend/settings/mcp">Settings → MCP → Human gates</Link>.
                </span>
              </div>
            </div>
          </div>
          <div className="tabs" role="tablist">
            <button className="tab on" role="tab" aria-selected="true">
              Pending
              <span className="n" style={{ background: "#ECE6FA", color: "#4B2E9E" }}>
                1
              </span>
            </button>
            <button className="tab" role="tab">
              Resolved<span className="n">6</span>
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 520px", gap: "20px", alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="apr">
                <div className="hd">
                  <Bot className="ic" aria-hidden="true" />
                  Riverbend Triage Agent (via Claude) requests approval
                  <span className="muted" style={{ marginLeft: "auto", fontWeight: 400, color: "#3C2380" }}>
                    2 min ago
                  </span>
                </div>
                <div className="bd">
                  <div className="b" style={{ fontSize: "15px", color: "#0D2A43" }}>
                    Decline 14 LOI applications and send “Standard decline v3”
                  </div>
                  <dl className="kv">
                    <dt>Tool</dt>
                    <dd>
                      <span className="mono">applications.bulk_decline</span> · gated
                    </dd>
                    <dt>Filter</dt>
                    <dd>
                      competition = Community Health Grants 2027 · stage = LOI · eligibility = <b>fail</b>
                    </dd>
                    <dt>Template</dt>
                    <dd>Standard decline v3 (Communications)</dd>
                    <dt>Why</dt>
                    <dd>
                      “Each application fails at least one eligibility rule that cannot be cured by revision (tax status, service area, or
                      budget cap).”
                    </dd>
                  </dl>
                  <div className="impact">
                    <TriangleExclamationPoint className="ic" aria-hidden="true" style={{ color: "#7A4A00" }} />
                    Will send 14 letters and set 14 applications to Declined
                  </div>
                </div>
                <div className="ft">
                  <Link to="/w/riverbend/communications" className="btn btn-primary">
                    Approve
                  </Link>
                  <button className="btn btn-danger">Reject…</button>
                  <Link to="/w/riverbend/applications" className="btn btn-ghost">
                    Open in Applications
                  </Link>
                  <span className="small muted" style={{ marginLeft: "auto" }}>
                    Requested for Dana Ortiz · expires in 7 days
                  </span>
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Resolved</h3>
                  <span className="small muted">last 90 days</span>
                </div>
                <div className="tbl-wrap" style={{ border: "0", borderRadius: "0" }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Request</th>
                        <th>Agent</th>
                        <th>Decided by</th>
                        <th>When</th>
                        <th>Outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Decline 9 LOI applications · Standard decline v3</td>
                        <td className="muted">Riverbend Triage Agent</td>
                        <td>Dana Ortiz</td>
                        <td>Mar 2, 2027</td>
                        <td>
                          <span className="bdg bdg-ok">
                            <Check className="ic" aria-hidden="true" />
                            Approved
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td>Advance 3 applications to Full proposal</td>
                        <td className="muted">Riverbend Triage Agent</td>
                        <td>Marcus Lee</td>
                        <td>Feb 11, 2027</td>
                        <td>
                          <div className="ent">
                            <span className="bdg bdg-dng">
                              <X className="ic" aria-hidden="true" />
                              Rejected
                            </span>
                            <span className="muted xs">reason: wait for budget review</span>
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td>Send 22 acknowledgment emails</td>
                        <td className="muted">Riverbend Triage Agent</td>
                        <td>Dana Ortiz</td>
                        <td>Jan 29, 2027</td>
                        <td>
                          <span className="bdg bdg-ok">
                            <Check className="ic" aria-hidden="true" />
                            Approved
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td>Tag 6 applications “rural”</td>
                        <td className="muted">Riverbend Triage Agent</td>
                        <td>Dana Ortiz</td>
                        <td>Jan 27, 2027</td>
                        <td>
                          <span className="bdg bdg-ok">
                            <Check className="ic" aria-hidden="true" />
                            Approved
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td>Generate 12 report reminders (−7 days)</td>
                        <td className="muted">Riverbend Triage Agent</td>
                        <td>Marcus Lee</td>
                        <td>Dec 8, 2026</td>
                        <td>
                          <span className="bdg bdg-ok">
                            <Check className="ic" aria-hidden="true" />
                            Approved
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td>Release tranche 2 · Harbor Light Shelter</td>
                        <td className="muted">Riverbend Triage Agent</td>
                        <td>Marcus Lee</td>
                        <td>Nov 20, 2026</td>
                        <td>
                          <div className="ent">
                            <span className="bdg bdg-dng">
                              <X className="ic" aria-hidden="true" />
                              Rejected
                            </span>
                            <span className="muted xs">reason: release is finance-only, not an agent tool</span>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span className="eyebrow">State · empty</span>
                <div className="card empty">
                  <Bot className="ic" aria-hidden="true" />
                  <h3>No agent requests</h3>
                  <p>When a connected agent calls a gated tool, its request appears here for a person to approve or reject.</p>
                  <div className="acts">
                    <Link to="/w/riverbend/settings/mcp" className="btn btn-primary">
                      Review human gates
                    </Link>
                    <Link to="/w/riverbend/settings/mcp" className="small b">
                      Connect an agent
                    </Link>
                  </div>
                </div>
              </div>
            </div>
            <aside className="drawer" style={{ border: "1px solid #CDBFF0", borderRadius: "12px", overflow: "hidden" }}>
              <div className="hd">
                <div>
                  <h3>Request detail</h3>
                  <div className="attrib" style={{ marginTop: "2px" }}>
                    <Bot className="ic ic-sm" aria-hidden="true" />
                    Proposed by<span className="ag">Riverbend Triage Agent (via Claude)</span>· 2 min ago · req_01J4KD
                  </div>
                </div>
                <button className="iconbtn" aria-label="Close detail">
                  <X className="ic" aria-hidden="true" />
                </button>
              </div>
              <div className="bd" style={{ gap: "14px" }}>
                <div>
                  <div className="eyebrow" style={{ marginBottom: "8px" }}>
                    Exact inputs
                  </div>
                  <dl className="kv" style={{ fontSize: "12px" }}>
                    <dt>competition_id</dt>
                    <dd className="mono">cmp_01HX9A · Community Health Grants 2027</dd>
                    <dt>stage</dt>
                    <dd className="mono">loi</dd>
                    <dt>filter</dt>
                    <dd className="mono">eligibility.result == "fail"</dd>
                    <dt>template_id</dt>
                    <dd className="mono">tpl_decline_v3</dd>
                    <dt>send_letters</dt>
                    <dd className="mono">true</dd>
                    <dt>client</dt>
                    <dd>Claude · scopes applications:write, communications:send (gated)</dd>
                  </dl>
                </div>
                <div>
                  <div className="eyebrow" style={{ marginBottom: "8px" }}>
                    14 applications affected
                  </div>
                  <div className="tbl-wrap" style={{ maxHeight: "300px", overflow: "auto" }}>
                    <table className="tbl tbl-compact">
                      <thead>
                        <tr>
                          <th>Applicant</th>
                          <th>Failed rule</th>
                          <th className="num">Requested</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Pine Ridge Literacy Project</td>
                          <td>Service area</td>
                          <td className="num">$40,000</td>
                        </tr>
                        <tr>
                          <td>Meadowbrook Arts Collective</td>
                          <td>Tax status</td>
                          <td className="num">$25,000</td>
                        </tr>
                        <tr>
                          <td>Granite Peak Youth Sports</td>
                          <td>Budget cap</td>
                          <td className="num">$35,000</td>
                        </tr>
                        <tr>
                          <td>Elm Street Health Alliance</td>
                          <td>Service area</td>
                          <td className="num">$48,000</td>
                        </tr>
                        <tr>
                          <td>Fernwood Early Learning</td>
                          <td>Tax status</td>
                          <td className="num">$30,000</td>
                        </tr>
                        <tr>
                          <td>Oakmont Veterans Outreach</td>
                          <td>Service area</td>
                          <td className="num">$52,000</td>
                        </tr>
                        <tr>
                          <td>Blue Heron Conservation</td>
                          <td>Program fit</td>
                          <td className="num">$44,000</td>
                        </tr>
                        <tr>
                          <td>Maple Grove Tenant Union</td>
                          <td>Tax status</td>
                          <td className="num">$28,000</td>
                        </tr>
                        <tr>
                          <td>Stonebridge Community Kitchen</td>
                          <td>Budget cap</td>
                          <td className="num">$160,000</td>
                        </tr>
                        <tr>
                          <td>Hillcrest Mutual Aid</td>
                          <td>Tax status</td>
                          <td className="num">$22,000</td>
                        </tr>
                        <tr>
                          <td>Juniper Ridge Clinic Fund</td>
                          <td>Service area</td>
                          <td className="num">$75,000</td>
                        </tr>
                        <tr>
                          <td>Silver Lake Seniors</td>
                          <td>Budget cap</td>
                          <td className="num">$155,000</td>
                        </tr>
                        <tr>
                          <td>Westfield Youth Theater</td>
                          <td>Program fit</td>
                          <td className="num">$38,000</td>
                        </tr>
                        <tr>
                          <td>Clearwater Housing Collective</td>
                          <td>Service area</td>
                          <td className="num">$90,000</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <div className="row" style={{ justifyContent: "space-between", marginBottom: "8px" }}>
                    <span className="eyebrow">Letter preview · 1 of 14</span>
                    <span className="small muted">Pine Ridge Literacy Project</span>
                  </div>
                  <div className="letter">
                    <div>
                      <b>Subject:</b> Your Letter of Intent to Riverbend Community Foundation
                    </div>
                    <p>
                      Dear <span className="mf">Elena Varga</span>,
                    </p>
                    <p>
                      Thank you for submitting a Letter of Intent to <span className="mf">Community Health Grants 2027</span> on behalf of{" "}
                      <span className="mf">Pine Ridge Literacy Project</span>. After an eligibility review, we are unable to invite a full
                      proposal this cycle: <span className="mf">the project's service area falls outside Riverbend County</span>.
                    </p>
                    <p>
                      This decision does not reflect the quality of your work. You may apply to future cycles, and your Passport record
                      stays on file so you will not need to re-enter it.
                    </p>
                    <p>
                      Sincerely,
                      <br />
                      Dana Ortiz · Program Officer · Riverbend Community Foundation
                    </p>
                  </div>
                  <div className="row" style={{ justifyContent: "space-between", marginTop: "6px" }}>
                    <button className="btn btn-sm btn-ghost">‹ Previous</button>
                    <span className="small muted">1 / 14</span>
                    <button className="btn btn-sm btn-ghost">Next ›</button>
                  </div>
                </div>
                <div className="fld">
                  <label className="lbl" htmlFor="reason">
                    Reason (required to reject)
                  </label>
                  <textarea
                    className="ta"
                    id="reason"
                    style={{ minHeight: "64px" }}
                    placeholder="Shown to the agent and recorded in the audit ledger"
                  />
                </div>
                <div className="row" style={{ gap: "8px" }}>
                  <Link to="/w/riverbend/communications" className="btn btn-primary">
                    Approve and send 14 letters
                  </Link>
                  <button className="btn btn-danger">Reject</button>
                </div>
                <div className="small muted">
                  Approving records: approved by Dana Ortiz · time · request id · letter hashes. The agent is notified and the F6 rows
                  update to Declined.
                </div>
              </div>
            </aside>
          </div>
        </main>
      </FunderShell>
    </>
  );
}
