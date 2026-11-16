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

import { translator } from "../../i18n/index.tsx";

const t = translator("shared");
const GATE_LABELS: Record<string, string> = {
  get commit_decisions() {
    return t("oAuthConsent.gateLabels.commit_decisions");
  },
  get release_tranche() {
    return t("oAuthConsent.gateLabels.release_tranche");
  },
  get submit_application() {
    return t("oAuthConsent.gateLabels.submit_application");
  },
  get sign_agreement() {
    return t("oAuthConsent.gateLabels.sign_agreement");
  },
  get accept_award() {
    return t("oAuthConsent.gateLabels.accept_award");
  },
  get send_communication() {
    return t("oAuthConsent.gateLabels.send_communication");
  },
  get decline_application() {
    return t("oAuthConsent.gateLabels.decline_application");
  },
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
      <title>{t("oAuthConsent.connectAnAgentOpengrantsGms")}</title>
      <div className="gms gms-frame" style={{ background: "var(--grad-hero)" }}>
        <header style={{ height: "64px", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 40px", borderBottom: "1px solid #D6DEDE", background: "#FFFFFF" }}>
          <Link to="/" className="row" style={{ gap: "10px" }}>
            <img src="/brand/opengrants-logo-black.png" alt="OpenGrants" style={{ height: "20px" }} />
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 500, color: "#145450", fontSize: "15px" }}>GMS</span>
          </Link>
          {me && (
            <div className="row" style={{ gap: "10px", minWidth: 0 }}>
              <span className="small muted" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                {t("oAuthConsent.signedInAs", { email: me.email })}
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
              {(request.status === "loading" || sessionState.status === "loading") && <Loading label={t("oAuthConsent.readingTheRequest")} />}
              {request.status === "error" && <ErrorBanner error={request.error} title={t("oAuthConsent.thisConnectionRequestCannotBe")} />}
              {data && (
                <>
                  <div className="row wrap" style={{ gap: "16px" }}>
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
                      <h1 style={{ fontSize: "22px" }}>{t("oAuthConsent.wantsToConnectToOpengrants", { name: data.client.name })}</h1>
                      <p className="small muted" style={{ marginTop: "4px" }}>
                        {t.rich("oAuthConsent.theAgentActsAsYou", { redirectHost: data.client.redirectHost, span: (chunks) => <span className="mono">{chunks}</span> })}
                        {data.client.dynamicallyRegistered && ` ${t("oAuthConsent.thisClientRegisteredItselfConnect")}`}
                      </p>
                    </div>
                  </div>

                  <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
                    <legend className="sr">{t("oAuthConsent.chooseAWorkspace")}</legend>
                    <Step n={1} title={t("oAuthConsent.chooseAWorkspace")} />
                    {data.workspaces.length === 0 && <p className="muted">{t("oAuthConsent.youAreNotAMember")}</p>}
                    {data.workspaces.map((w) => (
                      <label key={w.id} className="radio card" style={{ padding: "12px 14px", alignItems: "center", cursor: "pointer", ...(w.id === workspaceId ? { borderColor: "#29A79F", background: "#E1F8F6" } : {}) }}>
                        <input type="radio" name="workspace" value={w.id} checked={w.id === workspaceId} onChange={() => setWorkspaceId(w.id)} />
                        <div className="grow">
                          <div className="b">{w.name}</div>
                          <div className="small muted">
                            {t("oAuthConsent.yourRoleTheAgentGets", { role: roleTitle(w.role) })}
                            {w.requiresMfa && ` · ${t("oAuthConsent.verifyWithYourAuthenticatorApp")}`}
                          </div>
                        </div>
                        <span className="role">{w.kind === "funder" ? t("oAuthConsent.funder") : t("oAuthConsent.applicant")}</span>
                      </label>
                    ))}
                  </fieldset>

                  <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
                    <legend className="sr">{t("oAuthConsent.scopes")}</legend>
                    <Step n={2} title={t("oAuthConsent.scopes")} note={`${selected.length} of ${data.scopes.length} selected`} />
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px 16px" }}>
                      {data.scopes.map((s) => (
                        <label key={s.scope} className="cb">
                          <input type="checkbox" checked={grantable(s.scope) && !off.includes(s.scope)} disabled={!grantable(s.scope)} onChange={(e) => setOff((o) => (e.target.checked ? o.filter((x) => x !== s.scope) : [...o, s.scope]))} />
                          <span>
                            {s.description} <span className="mono muted">{s.scope}</span>
                            {!grantable(s.scope) && <span className="small muted"> {t("oAuthConsent.yourRoleCannotGrantThis")}</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <Step n={3} title={t("oAuthConsent.gatedActions")} />
                    <div className="apr">
                      <div className="hd">
                        <Lock className="ic" aria-hidden="true" />
                        {t("oAuthConsent.howTheHumanGateWorks")}
                      </div>
                      <div className="bd">
                        <p>{t("oAuthConsent.whenTheAgentCallsA")}</p>
                        <ul style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          {data.gatedActions.map((g) => (
                            <li key={g} className="row" style={{ gap: "8px" }}>
                              <Lock className="ic" aria-hidden="true" style={{ color: "#4B2E9E" }} />
                              <span>
                                {t.rich(NEVER.includes(g) ? "oAuthConsent.gateNever" : "oAuthConsent.gateWaits", { action: GATE_LABELS[g] ?? g.replace(/_/g, " "), b: (chunks) => <span className="b">{chunks}</span> })}
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
                        <div className="t">{t("oAuthConsent.verifyWithYourAuthenticatorApp2")}</div>
                        <div className="d">
                          <Link to={signInPath(location.pathname + location.search, "mfa")}>{t("oAuthConsent.verifyNow")}</Link>
                        </div>
                      </div>
                    </div>
                  )}
                  {decide.error !== null && <ErrorBanner error={decide.error} />}
                  <div className="row" style={{ justifyContent: "space-between", gap: "12px", flexWrap: "wrap", paddingTop: "10px", borderTop: "1px solid #EEF3F3" }}>
                    <span className="small muted">
                      {t.rich("oAuthConsent.revokeAnyTimeInAccount", { link: (chunks) => <Link to="/account/agents">{chunks}</Link> })}
                    </span>
                    <div className="row" style={{ gap: "10px" }}>
                      <button type="button" className="btn btn-secondary btn-lg" disabled={decide.state === "saving"} onClick={() => answer(false)}>
                        {t("oAuthConsent.deny")}
                      </button>
                      <button type="button" className="btn btn-primary btn-lg" disabled={decide.state === "saving" || !ws || ws.requiresMfa || selected.length === 0} onClick={() => answer(true)}>
                        {t("oAuthConsent.connect")}
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
