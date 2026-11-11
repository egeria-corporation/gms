// SPDX-License-Identifier: AGPL-3.0-only
// OAuth consent for an MCP client (`/consent?req=…`). The signed request names the client and
// the scopes it asked for; the person picks one workspace, can untick scopes, sees which actions
// stay behind a human gate, and approves or denies. The API returns where to send the browser.
import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router";
import { ArrowRight, Bot, Lock, TriangleExclamationPoint } from "lucide-react";
import { initialsOf, roleTitle } from "../../api/client.ts";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import { useServices } from "../../app/services.tsx";
import { signInPath } from "../../auth/RequireAuth.tsx";
import { ErrorBanner, Loading } from "../../components/ui.tsx";

const GATE_LABELS: Record<string, string> = {
  commit_decisions: "Commit decisions",
  release_tranche: "Release a payment",
  submit_application: "Submit an application",
  sign_agreement: "Sign an agreement",
  accept_award: "Accept an award",
  send_communication: "Send letters and messages",
  decline_application: "Decline an application",
};
const NEVER = ["sign_agreement", "accept_award", "release_tranche"];

/** Leaving the app for the client's redirect URI. A seam so tests can observe it. */
export const browser = { go: (url: string) => window.location.assign(url) };

function Step({ n, title, note }: { n: number; title: string; note?: string }) {
  return (
    <div className="row" style={{ gap: "10px" }}>
      <span className="stp">
        <span className="s on">
          <span className="n">{n}</span>
        </span>
      </span>
      <h2 style={{ fontSize: "15px" }}>{title}</h2>
      {note && <span className="small muted">{note}</span>}
    </div>
  );
}

export default function OAuthConsent() {
  const { sessionState, meState } = useServices();
  const location = useLocation();
  const [params] = useSearchParams();
  const req = params.get("req") ?? "";
  const signedIn = sessionState.status === "signedIn";
  const request = useApiQuery(async (api) => (signedIn ? api.consentRequest(req) : null), [req, signedIn]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [off, setOff] = useState<string[]>([]);
  const decide = useApiMutation((api, approve: boolean) => {
    const granted = request.data?.scopes.map((s) => s.scope).filter((s) => !off.includes(s)) ?? [];
    return api.decideConsent({ req, workspaceId, approve, ...(approve ? { scopes: granted } : {}) });
  });

  useEffect(() => {
    const first = request.data?.workspaces.find((w) => !w.requiresMfa && w.grantableScopes.length > 0) ?? request.data?.workspaces[0];
    if (first && !workspaceId) setWorkspaceId(first.id);
  }, [request.data, workspaceId]);

  if (sessionState.status === "signedOut") return <Navigate to={signInPath(location.pathname + location.search)} replace />;
  const me = meState.status === "ready" ? meState.me : null;
  const data = request.data;
  const ws = data?.workspaces.find((w) => w.id === workspaceId);
  const grantable = (scope: string) => !!ws?.grantableScopes.includes(scope);
  const selected = data?.scopes.filter((s) => grantable(s.scope) && !off.includes(s.scope)) ?? [];

  async function answer(approve: boolean) {
    const r = await decide.run(approve);
    if (r) browser.go(r.redirectTo);
  }

  return (
    <>
      <title>{"Connect an agent — OpenGrants GMS"}</title>
      <div className="gms gms-frame" style={{ background: "var(--grad-hero)" }}>
        <header style={{ height: "64px", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 40px", borderBottom: "1px solid #D6DEDE", background: "#FFFFFF" }}>
          <Link to="/" className="row" style={{ gap: "10px" }}>
            <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" style={{ height: "20px" }} />
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 500, color: "#145450", fontSize: "15px" }}>GMS</span>
          </Link>
          {me && (
            <div className="row" style={{ gap: "10px", minWidth: 0 }}>
              <span className="small muted" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                Signed in as {me.email}
              </span>
              <span className="av" aria-hidden="true">
                {initialsOf(me.email)}
              </span>
            </div>
          )}
        </header>
        <main style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", alignItems: "center", padding: "32px 16px 64px", gap: "20px" }}>
          <section className="card" style={{ width: "760px", maxWidth: "100%", boxShadow: "var(--shadow-card-hover)" }}>
            <div className="card-b" style={{ padding: "32px", display: "flex", flexDirection: "column", gap: "24px" }}>
              {(request.status === "loading" || sessionState.status === "loading") && <Loading label="Reading the request" />}
              {request.status === "error" && <ErrorBanner error={request.error} title="This connection request cannot be shown" />}
              {data && (
                <>
                  <div className="row" style={{ gap: "16px" }}>
                    <div className="row" style={{ gap: "10px" }}>
                      <span className="av av-xl av-a" style={{ borderRadius: "12px" }}>
                        <Bot className="ic ic-md" aria-hidden="true" />
                      </span>
                      <ArrowRight className="ic ic-md" aria-hidden="true" style={{ color: "#4A5C5A" }} />
                      <span style={{ width: "48px", height: "48px", borderRadius: "12px", background: "#FFFFFF", border: "1px solid #D6DEDE", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                        <img src="/brand/opengrants-icon-color.png" alt="" style={{ width: "28px", height: "28px" }} />
                      </span>
                    </div>
                    <div>
                      <h1 style={{ fontSize: "22px" }}>{data.client.name} wants to connect to OpenGrants GMS</h1>
                      <p className="small muted" style={{ marginTop: "4px" }}>
                        The agent acts as you, inside the scopes you grant, and returns to <span className="mono">{data.client.redirectHost}</span>. Every action it takes is attributed to it in the audit ledger.
                        {data.client.dynamicallyRegistered && " This client registered itself; connect it only if you started this from that app."}
                      </p>
                    </div>
                  </div>

                  <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
                    <legend className="sr">Choose a workspace</legend>
                    <Step n={1} title="Choose a workspace" />
                    {data.workspaces.length === 0 && <p className="muted">You are not a member of any workspace yet.</p>}
                    {data.workspaces.map((w) => (
                      <label key={w.id} className="radio card" style={{ padding: "12px 14px", alignItems: "center", cursor: "pointer", ...(w.id === workspaceId ? { borderColor: "#29A79F", background: "#E1F8F6" } : {}) }}>
                        <input type="radio" name="workspace" value={w.id} checked={w.id === workspaceId} onChange={() => setWorkspaceId(w.id)} />
                        <div className="grow">
                          <div className="b">{w.name}</div>
                          <div className="small muted">
                            Your role: {roleTitle(w.role)} · the agent gets at most your permissions
                            {w.requiresMfa && " · verify with your authenticator app first"}
                          </div>
                        </div>
                        <span className="role">{w.kind === "funder" ? "Funder" : "Applicant"}</span>
                      </label>
                    ))}
                  </fieldset>

                  <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
                    <legend className="sr">Scopes</legend>
                    <Step n={2} title="Scopes" note={`${selected.length} of ${data.scopes.length} selected`} />
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px 16px" }}>
                      {data.scopes.map((s) => (
                        <label key={s.scope} className="cb">
                          <input type="checkbox" checked={grantable(s.scope) && !off.includes(s.scope)} disabled={!grantable(s.scope)} onChange={(e) => setOff((o) => (e.target.checked ? o.filter((x) => x !== s.scope) : [...o, s.scope]))} />
                          <span>
                            {s.description} <span className="mono muted">{s.scope}</span>
                            {!grantable(s.scope) && <span className="small muted"> · your role cannot grant this</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <Step n={3} title="Gated actions" />
                    <div className="apr">
                      <div className="hd">
                        <Lock className="ic" aria-hidden="true" />
                        How the human gate works
                      </div>
                      <div className="bd">
                        <p>When the agent calls a gated tool, nothing changes yet. A request appears in Approvals with the agent, the exact inputs and what approving would do. A person approves or rejects it; the decision stays on the record.</p>
                        <ul style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          {data.gatedActions.map((g) => (
                            <li key={g} className="row" style={{ gap: "8px" }}>
                              <Lock className="ic" aria-hidden="true" style={{ color: "#4B2E9E" }} />
                              <span>
                                <span className="b">{GATE_LABELS[g] ?? g.replace(/_/g, " ")}</span>
                                {NEVER.includes(g) ? " — always a person; an agent cannot be approved to do it" : " — waits for approval"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>

                  {ws?.requiresMfa && (
                    <div className="bnr bnr-warn">
                      <TriangleExclamationPoint className="ic" aria-hidden="true" />
                      <div>
                        <div className="t">Verify with your authenticator app before connecting an agent to this workspace</div>
                        <div className="d">
                          <Link to={signInPath(location.pathname + location.search, "mfa")}>Verify now</Link>
                        </div>
                      </div>
                    </div>
                  )}
                  {decide.error !== null && <ErrorBanner error={decide.error} />}
                  <div className="row" style={{ justifyContent: "space-between", gap: "12px", flexWrap: "wrap", paddingTop: "10px", borderTop: "1px solid #EEF3F3" }}>
                    <span className="small muted">
                      Revoke any time in <Link to="/account/agents">Account → Connected agents</Link>
                    </span>
                    <div className="row" style={{ gap: "10px" }}>
                      <button type="button" className="btn btn-secondary btn-lg" disabled={decide.state === "saving"} onClick={() => answer(false)}>
                        Deny
                      </button>
                      <button type="button" className="btn btn-primary btn-lg" disabled={decide.state === "saving" || !ws || ws.requiresMfa || selected.length === 0} onClick={() => answer(true)}>
                        Connect
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>
        </main>
      </div>
    </>
  );
}
