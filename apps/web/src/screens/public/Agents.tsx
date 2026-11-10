// SPDX-License-Identifier: AGPL-3.0-only
// For agents and the people who connect them: what the GMS offers over MCP, how to connect, and
// which actions always come back to a person. When an API is configured, the live tool reference
// is read from its /llms.txt, so this page cannot drift from what the server actually serves.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Bot, Check, ExternalLink, Lock, ShieldCheck } from "lucide-react";
import { env } from "../../env.ts";

const ORIGIN = env.apiBaseUrl || "https://gms.opengrants.io";

/** Calls that pause for a person's approval when an agent makes them. */
const GATED: { tool: string; what: string; humanOnly: boolean }[] = [
  { tool: "submit_application", what: "Submit an application", humanOnly: false },
  { tool: "decline_application", what: "Decline an application and send the letter", humanOnly: false },
  { tool: "commit_decisions", what: "Commit panel decisions", humanOnly: false },
  { tool: "send_communication", what: "Send letters or bulk messages", humanOnly: false },
  { tool: "accept_award", what: "Accept an award", humanOnly: true },
  { tool: "sign_agreement", what: "Sign or countersign an agreement", humanOnly: true },
  { tool: "release_tranche", what: "Release a payment", humanOnly: true },
];

const CAN_DO = [
  "Find competitions an organization is eligible for and start an application from its Passport record",
  "Fill and validate form responses, insert answers from the organization's library, attach documents",
  "List and summarize applications, run eligibility, assign reviewers, rank, and propose decisions",
  "Draft letters, agreements and reports for a person to review",
  "Check payment readiness and explain what blocks a payment",
];

export default function Agents() {
  const [reference, setReference] = useState<{ status: "idle" | "loading" | "ready" | "unavailable"; text?: string }>({ status: env.useMocks ? "idle" : "loading" });
  useEffect(() => {
    if (env.useMocks || !env.apiBaseUrl) return;
    let live = true;
    fetch(`${env.apiBaseUrl}/llms.txt`).then(
      async (r) => {
        if (!live) return;
        setReference(r.ok ? { status: "ready", text: await r.text() } : { status: "unavailable" });
      },
      () => live && setReference({ status: "unavailable" }),
    );
    return () => {
      live = false;
    };
  }, []);
  return (
    <>
      <title>For agents — OpenGrants GMS</title>
      <div className="gms pub gms-frame">
        <header style={{ borderBottom: "1px solid var(--og-gray-200)", background: "var(--og-white)" }}>
          <div className="wrap-c" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "24px", minHeight: "64px", flexWrap: "wrap" }}>
            <Link to="/" style={{ display: "flex", alignItems: "center", gap: "10px", textDecoration: "none", fontFamily: "var(--font-display)", fontWeight: 700, color: "var(--og-navy-dark)", fontSize: "16px" }}>
              <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" style={{ height: "22px", width: "auto", display: "block" }} />
              <span style={{ color: "var(--og-teal-dark)", fontWeight: 500 }}>GMS</span>
            </Link>
            <nav aria-label="Primary" style={{ display: "flex", alignItems: "center", gap: "24px", fontSize: "14px", fontWeight: 700, flexWrap: "wrap" }}>
              <Link to="/" style={{ color: "var(--og-gray-800)" }}>
                Home
              </Link>
              <Link to="/signin" className="btn btn-secondary">
                Sign in
              </Link>
            </nav>
          </div>
        </header>
        <main>
          <section style={{ background: "var(--grad-hero)", padding: "48px 0 40px", borderTop: 0 }}>
            <div className="wrap-c" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <span className="og-eyebrow" style={{ color: "var(--og-teal-dark)" }}>
                <Bot className="ic" aria-hidden="true" />
                For agents
              </span>
              <h1 style={{ fontSize: "40px", maxWidth: "760px", color: "var(--og-navy-dark)" }}>Agents are first-class users of the GMS</h1>
              <p style={{ fontSize: "18px", maxWidth: "720px", lineHeight: 1.6 }}>
                Everything a person can do in the GMS, an agent connected by that person can do through the Model Context Protocol, with the same permissions and never more. Anything that moves money, makes a final decision or signs for an organization comes back to a person.
              </p>
            </div>
          </section>

          <section>
            <div className="wrap-c" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "20px" }}>
              <div className="card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <h2 style={{ fontSize: "20px", marginBottom: 0 }}>Connect</h2>
                <ol style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "15px", listStyle: "decimal", paddingLeft: "20px" }}>
                  <li>
                    Add the MCP server <code>{ORIGIN}/mcp</code> to your client (Streamable HTTP).
                  </li>
                  <li>The client registers itself and opens the GMS consent screen (OAuth 2.1 with PKCE).</li>
                  <li>A signed-in person picks the workspace, unticks any scope they do not want to grant, and approves.</li>
                  <li>The agent's token is bound to that person, that workspace and those scopes. It can be revoked at any time under Account settings.</li>
                </ol>
                <p className="help">
                  Discovery: <code>{ORIGIN}/.well-known/oauth-protected-resource</code>, <code>{ORIGIN}/llms.txt</code>, <code>{ORIGIN}/.well-known/agent.json</code>, <code>{ORIGIN}/openapi.json</code>
                </p>
              </div>
              <div className="card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <h2 style={{ fontSize: "20px", marginBottom: 0 }}>What an agent can do</h2>
                <ul style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "15px" }}>
                  {CAN_DO.map((line) => (
                    <li key={line} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                      <Check className="ic" aria-hidden="true" style={{ color: "var(--og-teal-dark)", marginTop: "5px" }} />
                      {line}
                    </li>
                  ))}
                </ul>
                <p className="help">The same data is readable as CommonGrants v0.5.0 JSON under <code>/common-grants/</code>.</p>
              </div>
            </div>
          </section>

          <section>
            <div className="wrap-c" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <h2>Human gates</h2>
              <p style={{ maxWidth: "760px" }}>
                When an agent calls one of these tools, nothing happens yet. The call returns <code>pending_approval</code> with a link; a person approves or rejects it in the GMS, and the agent reads the outcome with <code>get_approval</code>. A workspace can gate more tools, never fewer.
              </p>
              <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Tools that need a person, scrollable">
                <table className="tbl" style={{ fontSize: "15px" }}>
                  <caption className="sr">Tools that need a person</caption>
                  <thead>
                    <tr>
                      <th scope="col">Action</th>
                      <th scope="col">Tool</th>
                      <th scope="col">Who completes it</th>
                    </tr>
                  </thead>
                  <tbody>
                    {GATED.map((g) => (
                      <tr key={g.tool}>
                        <td style={{ whiteSpace: "normal" }}>{g.what}</td>
                        <td>
                          <code>{g.tool}</code>
                        </td>
                        <td style={{ whiteSpace: "normal" }}>
                          {g.humanOnly ? (
                            <span className="bdg bdg-warn">
                              <Lock className="ic" aria-hidden="true" />
                              A person, always
                            </span>
                          ) : (
                            <span className="bdg bdg-agent">
                              <ShieldCheck className="ic" aria-hidden="true" />
                              A person approves the agent's request
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="help">The GMS never stores bank or identity data, and no tool sets a payout destination: organizations manage that in OpenGrants Passport.</p>
            </div>
          </section>

          <section>
            <div className="wrap-c" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <h2>Tool reference</h2>
              {reference.status === "ready" ? (
                <pre style={{ whiteSpace: "pre-wrap", maxHeight: "560px", overflow: "auto" }} tabIndex={0} aria-label="Tool reference from /llms.txt">
                  {reference.text}
                </pre>
              ) : (
                <p>
                  {reference.status === "loading" ? "Loading the reference… " : reference.status === "unavailable" ? "The reference could not be loaded just now. " : ""}
                  The full list of tools, with their scopes and input schemas, is served at{" "}
                  <a href={`${ORIGIN}/llms.txt`}>
                    {ORIGIN}/llms.txt <ExternalLink className="ic ic-sm" aria-hidden="true" />
                  </a>{" "}
                  and <a href={`${ORIGIN}/llms-full.txt`}>{ORIGIN}/llms-full.txt</a>.
                </p>
              )}
            </div>
          </section>
        </main>
        <footer className="pub-foot" style={{ marginTop: "auto" }}>
          <div className="wrap-c">
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "20px", height: "20px" }} />
              <span>OpenGrants GMS</span>
            </div>
            <div style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
              <Link to="/">Home</Link>
              <a href={`${ORIGIN}/openapi.json`}>OpenAPI</a>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
