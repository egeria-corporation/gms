// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import { ArrowRight, Bot, CircleCheck, CircleX, Clock, Send, TriangleExclamationPoint } from "lucide-react";

export default function ApprovalFlow() {
  return (
    <>
      <title>{"Approval flow — agent proposes, human approves"}</title>
      <div
        className="gms"
        style={{
          minHeight: "100vh",
          background: "#FFFFFF",
          padding: "40px 48px 48px",
          display: "flex",
          flexDirection: "column",
          gap: "24px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxWidth: "980px" }}>
          <span className="eyebrow">S1 · Shared pattern</span>
          <h1 style={{ fontSize: "26px" }}>Approval flow: agent proposes → human approves → resolved</h1>
          <p style={{ fontSize: "15px", color: "#4A5C5A" }}>
            An agent connected over MCP can read applications and propose actions. A gated action (here, declining 14 LOIs that fail the
            service-area rule) never changes state by itself: it becomes an approval request with its exact inputs and a preview. A named
            person approves; the result carries both names forever.
          </p>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 40px minmax(0, 1fr) 40px minmax(0, 1fr)",
            gap: "12px",
            alignItems: "start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div className="row" style={{ gap: "10px" }}>
              <span className="av av-sm av-a" aria-hidden="true">
                1
              </span>
              <span className="b" style={{ fontSize: "15px", color: "#0D2A43" }}>
                Agent proposes
              </span>
              <span className="small muted">F6 Applications</span>
            </div>
            <div className="card" style={{ overflow: "hidden" }}>
              <div
                style={{
                  padding: "10px 14px",
                  borderBottom: "1px solid #D6DEDE",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  flexWrap: "wrap",
                }}
              >
                <span className="fchip on" style={{ height: "26px" }}>
                  View:<span className="v">Agent proposals</span>
                </span>
                <span className="small muted">14 rows</span>
              </div>
              <table className="tbl tbl-compact mini">
                <thead>
                  <tr>
                    <th>Applicant</th>
                    <th>Status</th>
                    <th>Elig.</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="agent">
                    <td>
                      <div className="ent">
                        <span className="nm">Pine Ridge Literacy Project</span>
                        <span className="attrib">
                          <Bot className="ic ic-sm" aria-hidden="true" />
                          Decline proposed by<span className="ag">Riverbend Triage Agent (via Claude)</span>· awaiting approval
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="ent">
                        <span className="bdg bdg-info">
                          <Send className="ic" aria-hidden="true" />
                          Submitted
                        </span>
                        <span className="bdg bdg-agent">
                          <Bot className="ic" aria-hidden="true" />
                          Proposed: Decline
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="row" style={{ gap: "4px", color: "#9B1C1C", fontWeight: 700 }}>
                        <CircleX className="ic" aria-hidden="true" />
                        Fail
                      </span>
                    </td>
                  </tr>
                  <tr className="agent">
                    <td>
                      <div className="ent">
                        <span className="nm">Blue Heron Conservation</span>
                        <span className="attrib">
                          <Bot className="ic ic-sm" aria-hidden="true" />
                          Decline proposed by<span className="ag">Riverbend Triage Agent (via Claude)</span>· awaiting approval
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="ent">
                        <span className="bdg bdg-info">
                          <Send className="ic" aria-hidden="true" />
                          Submitted
                        </span>
                        <span className="bdg bdg-agent">
                          <Bot className="ic" aria-hidden="true" />
                          Proposed: Decline
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="row" style={{ gap: "4px", color: "#9B1C1C", fontWeight: 700 }}>
                        <CircleX className="ic" aria-hidden="true" />
                        Fail
                      </span>
                    </td>
                  </tr>
                  <tr className="agent">
                    <td>
                      <div className="ent">
                        <span className="nm">Stonebridge Community Kitchen</span>
                        <span className="attrib">
                          <Bot className="ic ic-sm" aria-hidden="true" />
                          Decline proposed by<span className="ag">Riverbend Triage Agent (via Claude)</span>· awaiting approval
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="ent">
                        <span className="bdg bdg-info">
                          <Send className="ic" aria-hidden="true" />
                          Submitted
                        </span>
                        <span className="bdg bdg-agent">
                          <Bot className="ic" aria-hidden="true" />
                          Proposed: Decline
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="row" style={{ gap: "4px", color: "#9B1C1C", fontWeight: 700 }}>
                        <CircleX className="ic" aria-hidden="true" />
                        Fail
                      </span>
                    </td>
                  </tr>
                  <tr className="agent">
                    <td>
                      <div className="ent">
                        <span className="nm">Maple Grove Tenant Union</span>
                        <span className="attrib">
                          <Bot className="ic ic-sm" aria-hidden="true" />
                          Decline proposed by<span className="ag">Riverbend Triage Agent (via Claude)</span>· awaiting approval
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="ent">
                        <span className="bdg bdg-info">
                          <Send className="ic" aria-hidden="true" />
                          Submitted
                        </span>
                        <span className="bdg bdg-agent">
                          <Bot className="ic" aria-hidden="true" />
                          Proposed: Decline
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="row" style={{ gap: "4px", color: "#9B1C1C", fontWeight: 700 }}>
                        <CircleX className="ic" aria-hidden="true" />
                        Fail
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div style={{ padding: "10px 14px", borderTop: "1px solid #D6DEDE", fontSize: "12px", color: "#4A5C5A" }}>
                … 10 more proposed rows · nothing has changed yet. The rail shows{" "}
                <span className="b" style={{ color: "#4B2E9E" }}>
                  Approvals · 1
                </span>
                .
              </div>
            </div>
            <p className="small muted">
              Tool call: <span className="mono">applications.propose_decline</span> with rule{" "}
              <span className="mono">service_area ∉ Riverbend County</span>. Gated by the “Send letters” human gate (F17).
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: "180px", color: "#4A5C5A" }}>
            <ArrowRight className="ic ic-lg" aria-hidden="true" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div className="row" style={{ gap: "10px" }}>
              <span className="av av-sm av-a" aria-hidden="true">
                2
              </span>
              <span className="b" style={{ fontSize: "15px", color: "#0D2A43" }}>
                Approval request
              </span>
              <span className="small muted">F18 Approvals · also on F1</span>
            </div>
            <div className="apr">
              <div className="hd">
                <Bot className="ic" aria-hidden="true" />
                Riverbend Triage Agent (via Claude)
                <span className="muted" style={{ marginLeft: "auto", fontWeight: 500, color: "#4B2E9E" }}>
                  #a-1042 · 2 min ago
                </span>
              </div>
              <div className="bd">
                <div className="row" style={{ gap: "8px" }}>
                  <span className="bdg bdg-warn">
                    <Clock className="ic" aria-hidden="true" />
                    Pending
                  </span>
                  <span className="small muted">Expires in 7 days · requested as Dana Ortiz's agent</span>
                </div>
                <dl className="kv" style={{ gridTemplateColumns: "110px minmax(0, 1fr)" }}>
                  <dt>Action</dt>
                  <dd className="b">Decline 14 applications and send “Standard decline v3”</dd>
                  <dt>Competition</dt>
                  <dd>Community Health Grants 2027 · LOI stage</dd>
                  <dt>Inputs</dt>
                  <dd>
                    Rule: <span className="mono">service_area</span> not in Riverbend County · 14 of 58 LOIs matched · reason text filled
                    per application
                  </dd>
                  <dt>Preview</dt>
                  <dd>
                    <Link to="/w/riverbend/approvals">14 letters</Link> · <Link to="/w/riverbend/applications">matched rows</Link>
                  </dd>
                </dl>
                <div className="impact">
                  <TriangleExclamationPoint className="ic" aria-hidden="true" style={{ color: "#7A4A00" }} />
                  Will send 14 letters and set 14 applications to Declined
                </div>
                <div className="fld">
                  <label className="lbl" htmlFor="apr-note" style={{ fontSize: "12px" }}>
                    Note (optional, recorded with the decision)
                  </label>
                  <input className="inp" id="apr-note" placeholder="e.g. Checked Blue Heron's address against Passport first" />
                </div>
              </div>
              <div className="ft">
                <Link to="/w/riverbend/approvals" className="btn btn-primary">
                  Approve
                </Link>
                <button className="btn btn-danger">Reject…</button>
                <Link to="/w/riverbend/approvals" className="btn btn-ghost" style={{ marginLeft: "auto" }}>
                  Open
                </Link>
              </div>
            </div>
            <p className="small muted">
              Approve runs the exact proposal, not a re-evaluation: if any application changed since it was proposed, the request is marked
              stale and must be re-proposed.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: "180px", color: "#4A5C5A" }}>
            <ArrowRight className="ic ic-lg" aria-hidden="true" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div className="row" style={{ gap: "10px" }}>
              <span className="av av-sm av-a" aria-hidden="true">
                3
              </span>
              <span className="b" style={{ fontSize: "15px", color: "#0D2A43" }}>
                Resolved in F6
              </span>
              <span className="small muted">attribution stays on every row</span>
            </div>
            <div className="bnr bnr-ok">
              <CircleCheck className="ic" aria-hidden="true" />
              <div>
                <div className="t">14 letters sent</div>
                <div className="d">Delivered 14 · approved by Dana Ortiz · May 25, 2027 10:01</div>
                <div className="clears">
                  <Link to="/w/riverbend/communications">View send log →</Link>
                </div>
              </div>
            </div>
            <div className="card" style={{ overflow: "hidden" }}>
              <table className="tbl tbl-compact mini">
                <thead>
                  <tr>
                    <th>Applicant</th>
                    <th>Status</th>
                    <th>Elig.</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <div className="ent">
                        <span className="nm">Pine Ridge Literacy Project</span>
                        <span className="attrib">
                          <Bot className="ic ic-sm" aria-hidden="true" />
                          Declined by<span className="ag">Riverbend Triage Agent</span>· approved by Dana Ortiz · May 25 10:01
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="bdg bdg-dng">
                        <CircleX className="ic" aria-hidden="true" />
                        Declined
                      </span>
                    </td>
                    <td>
                      <span className="row" style={{ gap: "4px", color: "#9B1C1C", fontWeight: 700 }}>
                        <CircleX className="ic" aria-hidden="true" />
                        Fail
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <div className="ent">
                        <span className="nm">Blue Heron Conservation</span>
                        <span className="attrib">
                          <Bot className="ic ic-sm" aria-hidden="true" />
                          Declined by<span className="ag">Riverbend Triage Agent</span>· approved by Dana Ortiz · May 25 10:01
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="bdg bdg-dng">
                        <CircleX className="ic" aria-hidden="true" />
                        Declined
                      </span>
                    </td>
                    <td>
                      <span className="row" style={{ gap: "4px", color: "#9B1C1C", fontWeight: 700 }}>
                        <CircleX className="ic" aria-hidden="true" />
                        Fail
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <div className="ent">
                        <span className="nm">Stonebridge Community Kitchen</span>
                        <span className="attrib">
                          <Bot className="ic ic-sm" aria-hidden="true" />
                          Declined by<span className="ag">Riverbend Triage Agent</span>· approved by Dana Ortiz · May 25 10:01
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="bdg bdg-dng">
                        <CircleX className="ic" aria-hidden="true" />
                        Declined
                      </span>
                    </td>
                    <td>
                      <span className="row" style={{ gap: "4px", color: "#9B1C1C", fontWeight: 700 }}>
                        <CircleX className="ic" aria-hidden="true" />
                        Fail
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <div className="ent">
                        <span className="nm">Maple Grove Tenant Union</span>
                        <span className="attrib">
                          <Bot className="ic ic-sm" aria-hidden="true" />
                          Declined by<span className="ag">Riverbend Triage Agent</span>· approved by Dana Ortiz · May 25 10:01
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="bdg bdg-dng">
                        <CircleX className="ic" aria-hidden="true" />
                        Declined
                      </span>
                    </td>
                    <td>
                      <span className="row" style={{ gap: "4px", color: "#9B1C1C", fontWeight: 700 }}>
                        <CircleX className="ic" aria-hidden="true" />
                        Fail
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div style={{ padding: "10px 14px", borderTop: "1px solid #D6DEDE", fontSize: "12px", color: "#4A5C5A" }}>
                Each application's Activity tab shows the proposal, the approval and the letter as three timeline entries.
              </div>
            </div>
            <p className="small muted">
              Audit ledger: <span className="mono">applications.propose_decline</span> (agent) →{" "}
              <span className="mono">approval.approved</span> (Dana Ortiz) → <span className="mono">letters.sent ×14</span> (system).
            </p>
          </div>
        </div>
        <div
          className="card"
          style={{
            padding: "16px 20px",
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "20px",
            background: "#F7FAFA",
          }}
        >
          <div>
            <div className="b" style={{ color: "#0D2A43" }}>
              Where the pieces live
            </div>
            <p className="small muted">
              Human gates: F17 Settings → MCP. Pending requests: F18 Approvals, F1 Dashboard, and the rail count. Resolved history: F18
              (resolved tab) and the audit ledger.
            </p>
          </div>
          <div>
            <div className="b" style={{ color: "#0D2A43" }}>
              What an agent can never do
            </div>
            <p className="small muted">
              Release a payment, sign an agreement, or change a bank destination. Those tools are locked to humans in every workspace;
              agents can only read readiness and propose.
            </p>
          </div>
          <div>
            <div className="b" style={{ color: "#0D2A43" }}>
              Reject path
            </div>
            <p className="small muted">
              Reject asks for a reason, marks the proposal rejected with the reviewer's name, and the agent receives the reason as the tool
              result so it can re-propose differently.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
