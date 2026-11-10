// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "react-router";
import { ArrowRight, Banknote, Bot, Check, ClipboardCheck, Clock, Inbox, Lock, Mail, Users } from "lucide-react";

export default function OAuthConsent() {
  return (
    <>
      <title>{"Connect an MCP client — OpenGrants GMS"}</title>
      <div className="gms" style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "var(--grad-hero)" }}>
        <header
          style={{
            height: "64px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 40px",
            borderBottom: "1px solid #D6DEDE",
            background: "#FFFFFF",
          }}
        >
          <Link to="/" className="row" style={{ gap: "10px", textDecoration: "none" }}>
            <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" style={{ height: "20px" }} />
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 500, color: "#145450", fontSize: "15px" }}>GMS</span>
          </Link>
          <div className="row" style={{ gap: "10px" }}>
            <span className="small muted">Signed in as Dana Ortiz</span>
            <span className="av">DO</span>
          </div>
        </header>
        <main
          style={{
            flex: "1 1 auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "32px 40px 64px",
            gap: "20px",
          }}
        >
          <div className="row" style={{ gap: "10px", width: "760px", maxWidth: "100%" }}>
            <span className="bdg bdg-agent">
              <Bot className="ic" aria-hidden="true" />
              Flow 6
            </span>
            <span className="small muted">Agent triage with a human gate · step 2 of 6 (after F17 Settings → Connect an agent)</span>
          </div>
          <section className="card" style={{ width: "760px", maxWidth: "100%", boxShadow: "var(--shadow-card-hover)" }}>
            <div className="card-b" style={{ padding: "32px", display: "flex", flexDirection: "column", gap: "24px" }}>
              <div className="row" style={{ gap: "16px" }}>
                <div className="row" style={{ gap: "10px" }}>
                  <span className="av av-xl av-a" style={{ borderRadius: "12px" }}>
                    <Bot className="ic ic-md" aria-hidden="true" />
                  </span>
                  <ArrowRight className="ic ic-md" aria-hidden="true" style={{ color: "#4A5C5A" }} />
                  <span
                    style={{
                      width: "48px",
                      height: "48px",
                      borderRadius: "12px",
                      background: "#FFFFFF",
                      border: "1px solid #D6DEDE",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "28px", height: "28px" }} />
                  </span>
                </div>
                <div>
                  <h1 style={{ fontSize: "22px" }}>Claude (MCP client) wants to connect to OpenGrants GMS</h1>
                  <p className="small muted" style={{ marginTop: "4px" }}>
                    The agent will act as{" "}
                    <span className="b" style={{ color: "#1E2D2B" }}>
                      Dana Ortiz
                    </span>{" "}
                    inside the scopes you grant. Every action it takes is attributed to it and listed in the audit ledger.
                  </p>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div className="row" style={{ gap: "10px" }}>
                  <span className="stp">
                    <span className="s on">
                      <span className="n">1</span>
                    </span>
                  </span>
                  <h3>Choose a workspace</h3>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <label
                    className="radio card"
                    style={{ padding: "12px 14px", alignItems: "center", cursor: "pointer", borderColor: "#29A79F", background: "#E1F8F6" }}
                  >
                    <span className="r on"></span>
                    <div className="grow">
                      <div className="b">Riverbend Community Foundation</div>
                      <div className="small muted">Your role: Program officer · agent inherits at most your permissions</div>
                    </div>
                    <span className="role">Funder</span>
                  </label>
                  <label className="radio card" style={{ padding: "12px 14px", alignItems: "center", cursor: "pointer" }}>
                    <span className="r"></span>
                    <div className="grow">
                      <div className="b">Alder Creek Family Services</div>
                      <div className="small muted">Your role: Viewer · read-only scopes available</div>
                    </div>
                    <span className="role">Applicant</span>
                  </label>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div className="row" style={{ gap: "10px" }}>
                  <span className="stp">
                    <span className="s on">
                      <span className="n">2</span>
                    </span>
                  </span>
                  <h3>Scopes</h3>
                  <span className="small muted">Grouped by area · 7 of 10 selected</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" }}>
                  <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div className="row" style={{ gap: "8px" }}>
                      <Inbox className="ic" aria-hidden="true" style={{ color: "#145450" }} />
                      <span className="b">Applications</span>
                    </div>
                    <label className="cb">
                      <span className="c on">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </span>
                      <span>
                        Read applications <span className="mono muted">applications:read</span>
                      </span>
                    </label>
                    <label className="cb">
                      <span className="c on">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </span>
                      <span>
                        Propose decisions <span className="mono muted">applications:propose</span>
                        <br />
                        <span className="small" style={{ color: "#4B2E9E", fontWeight: 700 }}>
                          Gated: a human approves before status changes
                        </span>
                      </span>
                    </label>
                    <label className="cb">
                      <span className="c on">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </span>
                      <span>
                        Request revision <span className="mono muted">applications:revision</span>
                      </span>
                    </label>
                  </div>
                  <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div className="row" style={{ gap: "8px" }}>
                      <ClipboardCheck className="ic" aria-hidden="true" style={{ color: "#145450" }} />
                      <span className="b">Reviews</span>
                    </div>
                    <label className="cb">
                      <span className="c on">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </span>
                      <span>
                        Read scores and recommendations <span className="mono muted">reviews:read</span>
                      </span>
                    </label>
                    <div className="row" style={{ gap: "8px", marginTop: "6px" }}>
                      <Users className="ic" aria-hidden="true" style={{ color: "#145450" }} />
                      <span className="b">Grantees</span>
                    </div>
                    <label className="cb">
                      <span className="c on">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </span>
                      <span>
                        Read grantee directory <span className="mono muted">grantees:read</span>
                      </span>
                    </label>
                  </div>
                  <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div className="row" style={{ gap: "8px" }}>
                      <Mail className="ic" aria-hidden="true" style={{ color: "#145450" }} />
                      <span className="b">Communications</span>
                    </div>
                    <label className="cb">
                      <span className="c on">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </span>
                      <span>
                        Draft letters <span className="mono muted">letters:draft</span>
                      </span>
                    </label>
                    <label className="cb">
                      <span className="c on">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </span>
                      <span>
                        Send letters <span className="mono muted">letters:send</span>
                        <br />
                        <span className="small row" style={{ gap: "4px", color: "#4B2E9E", fontWeight: 700 }}>
                          <Lock className="ic ic-sm" aria-hidden="true" />
                          Gated: needs a human approval
                        </span>
                      </span>
                    </label>
                  </div>
                  <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div className="row" style={{ gap: "8px" }}>
                      <Banknote className="ic" aria-hidden="true" style={{ color: "#145450" }} />
                      <span className="b">Payments</span>
                    </div>
                    <label className="cb">
                      <span className="c on">
                        <Check className="ic ic-sm" aria-hidden="true" />
                      </span>
                      <span>
                        Read schedules and readiness <span className="mono muted">payments:read</span>
                      </span>
                    </label>
                    <div className="cb" style={{ opacity: ".6" }} aria-disabled="true">
                      <span className="c" style={{ background: "#EEF3F3" }}>
                        <Lock className="ic ic-sm" aria-hidden="true" style={{ color: "#4A5C5A" }} />
                      </span>
                      <span>
                        Release tranches <span className="mono muted">payments:release</span>
                        <br />
                        <span className="small b" style={{ color: "#9B1C1C" }}>
                          Never available to agents
                        </span>
                      </span>
                    </div>
                    <div className="cb" style={{ opacity: ".6" }} aria-disabled="true">
                      <span className="c" style={{ background: "#EEF3F3" }}>
                        <Lock className="ic ic-sm" aria-hidden="true" style={{ color: "#4A5C5A" }} />
                      </span>
                      <span>
                        Edit payee destination <span className="mono muted">—</span>
                        <br />
                        <span className="small b" style={{ color: "#9B1C1C" }}>
                          Not a GMS capability for anyone
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div className="row" style={{ gap: "10px" }}>
                  <span className="stp">
                    <span className="s on">
                      <span className="n">3</span>
                    </span>
                  </span>
                  <h3>Gated actions</h3>
                </div>
                <div className="apr">
                  <div className="hd">
                    <Lock className="ic" aria-hidden="true" />
                    How the human gate works
                  </div>
                  <div className="bd">
                    <p>
                      When the agent calls a gated tool, nothing changes yet. An approval request card appears in{" "}
                      <Link to="/w/riverbend/approvals">Approvals</Link>, on the dashboard and in notifications, showing the agent, the
                      exact inputs, a preview and an impact line (“will send 14 letters”). A person with the right role approves or rejects
                      it; the decision and who made it stay on the record.
                    </p>
                    <ul style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <li className="row" style={{ gap: "8px" }}>
                        <Lock className="ic" aria-hidden="true" style={{ color: "#4B2E9E" }} />
                        <span>
                          <span className="b">Propose decisions</span> — advance, decline, waitlist on one or many applications
                        </span>
                      </li>
                      <li className="row" style={{ gap: "8px" }}>
                        <Lock className="ic" aria-hidden="true" style={{ color: "#4B2E9E" }} />
                        <span>
                          <span className="b">Send letters</span> — any outbound communication to applicants or grantees
                        </span>
                      </li>
                      <li className="row" style={{ gap: "8px" }}>
                        <Lock className="ic" aria-hidden="true" style={{ color: "#4B2E9E" }} />
                        <span>
                          <span className="b">Request revision</span> — opens a revision window for the applicant
                        </span>
                      </li>
                    </ul>
                    <span className="small muted">
                      Workspace admins choose which tools are gated in{" "}
                      <Link to="/w/riverbend/settings/mcp">Settings → MCP → Human gates</Link>. Releasing money and signing are never agent
                      tools.
                    </span>
                  </div>
                </div>
              </div>
              <div
                className="row"
                style={{
                  justifyContent: "space-between",
                  gap: "12px",
                  flexWrap: "wrap",
                  paddingTop: "10px",
                  borderTop: "1px solid #EEF3F3",
                }}
              >
                <span className="small muted row" style={{ gap: "6px" }}>
                  <Clock className="ic ic-sm" aria-hidden="true" />
                  Token expires in 90 days · revoke any time in<Link to="/account/agents">Account → Connected agents</Link>
                </span>
                <div className="row" style={{ gap: "10px" }}>
                  <button className="btn btn-secondary btn-lg">Cancel</button>
                  <Link to="/w/riverbend/applications" className="btn btn-primary btn-lg">
                    Connect
                  </Link>
                </div>
              </div>
            </div>
          </section>
          <p className="small muted" style={{ width: "760px", maxWidth: "100%" }}>
            Next in Flow 6: the agent screens the Full proposal stage and proposes 14 declines. They appear in Applications with an
            attribution line and in Approvals for Dana to approve.
          </p>
        </main>
      </div>
    </>
  );
}
