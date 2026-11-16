// SPDX-License-Identifier: AGPL-3.0-only
// Account settings for the signed-in person: who they are, their authenticator, this session, and
// the agents connected on their behalf in each workspace (each can be revoked here).
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Bell, Bot, KeyRound, MonitorSmartphone, ShieldCheck, User } from "lucide-react";
import type { McpConnection } from "../../api/applicantMore.ts";
import { useMoreApi, useMoreQuery } from "../../api/applicantMoreHooks.ts";
import { roleTitle, type MeWorkspace } from "../../api/client.ts";
import { useServices } from "../../app/services.tsx";
import { signInPath } from "../../auth/RequireAuth.tsx";
import { AccountShell } from "../../components/AccountShell.tsx";
import { timeAgo } from "../../components/applicant.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { ErrorBanner, Loading } from "../../components/ui.tsx";
import { SessionsCard } from "./accountSessions.tsx";
import { formatDate } from "../../lib/format.ts";

import { translator } from "../../i18n/index.tsx";

const t = translator("public");
function Agents({ ws }: { ws: MeWorkspace }) {
  const api = useMoreApi(ws.id);
  const query = useMoreQuery((a) => a.connections(ws.id), [ws.id], ws.id);
  const [confirm, setConfirm] = useState<McpConnection | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const revoke = async (c: McpConnection) => {
    setBusy(true);
    setError(null);
    try {
      await api.revokeConnection(c.id, ws.id);
      if (query.status === "ready") query.set(query.data.filter((x) => x.id !== c.id));
      setConfirm(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ borderTop: "1px solid var(--og-gray-200)" }}>
      <div className="row" style={{ gap: "10px", padding: "12px 20px 4px", flexWrap: "wrap" }}>
        <h3 style={{ fontSize: "14px" }}>{ws.name}</h3>
        <span className="role">{ws.kind === "funder" ? t("accountSettings.funder") : t("accountSettings.applicant")}</span>
        <span className="small muted">{roleTitle(ws.role)}</span>
      </div>
      {query.status === "loading" && (
        <div style={{ padding: "0 20px" }}>
          <Loading label={t("accountSettings.loadingConnectedAgents")} />
        </div>
      )}
      {query.status === "error" && (
        <div style={{ padding: "12px 20px" }}>
          <ErrorBanner error={query.error} onRetry={query.reload} />
        </div>
      )}
      {query.status === "ready" && query.data.length === 0 && <p className="small muted" style={{ padding: "4px 20px 16px" }}>{t("accountSettings.noAgentIsConnectedTo")}</p>}
      {query.status === "ready" && query.data.length > 0 && (
        <ul>
          {query.data.map((c) => (
            <li key={c.id} style={{ display: "grid", gridTemplateColumns: "36px minmax(0, 1fr) auto", gap: "14px", alignItems: "center", padding: "12px 20px", borderTop: "1px solid var(--og-gray-100)" }}>
              <span className="av av-a" aria-hidden="true">
                <Bot className="ic" aria-hidden="true" />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="b">
                  {c.clientName ?? c.clientId}
                  {!c.mine && <span className="tag" style={{ marginLeft: "8px" }}>{t("accountSettings.connectedByATeammate")}</span>}
                </div>
                <div className="small muted">
                  {c.lastUsedAt
                    ? t.rich("accountSettings.clientLine", { client: c.clientUri ?? c.clientId, connected: formatDate(c.createdAt), lastUsed: timeAgo(c.lastUsedAt), mono: (chunks) => <span className="mono">{chunks}</span> })
                    : t.rich("accountSettings.clientLineNeverUsed", { client: c.clientUri ?? c.clientId, connected: formatDate(c.createdAt), mono: (chunks) => <span className="mono">{chunks}</span> })}
                </div>
                <div className="row wrap" style={{ gap: "4px", marginTop: "6px" }}>
                  {c.scopes.map((s) => (
                    <span key={s} className="tag">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              <button className="btn btn-sm btn-danger" type="button" aria-label={t("accountSettings.revokeIn", { value: c.clientName ?? c.clientId, name: ws.name })} onClick={() => setConfirm(c)}>
                {t("accountSettings.revoke")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} labelledBy={`revoke-${ws.handle}`}>
        <div className="hd">
          <h2 id={`revoke-${ws.handle}`} style={{ fontSize: "18px" }}>
            {t("accountSettings.revokeConfirm", { name: confirm?.clientName ?? confirm?.clientId ?? "" })}
          </h2>
        </div>
        <div className="bd">
          <p>{t("accountSettings.theAgentLosesAccessTo", { name: ws.name })}</p>
          {error ? <ErrorBanner error={error} title={t("accountSettings.theAgentWasNotRevoked")} /> : null}
        </div>
        <div className="ft">
          <button className="btn btn-secondary" type="button" onClick={() => setConfirm(null)}>
            {t("accountSettings.cancel")}
          </button>
          <button className="btn btn-danger-solid" type="button" disabled={busy} onClick={() => confirm && void revoke(confirm)}>
            {t("accountSettings.revokeAccess")}
          </button>
        </div>
      </Dialog>
    </div>
  );
}

export default function AccountSettings() {
  const { auth, sessionState, meState, reloadMe } = useServices();
  const navigate = useNavigate();
  const [factors, setFactors] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    auth.listTotpFactors().then(
      (f) => live && setFactors(f),
      () => live && setFactors([]),
    );
    return () => {
      live = false;
    };
  }, [auth]);
  const session = sessionState.status === "signedIn" ? sessionState.session : null;
  return (
    <>
      <title>{t("accountSettings.accountSettingsOpengrantsGms")}</title>
      <AccountShell active="account">
        <div className="ph">
          <div>
            <div className="title">
              <h1>{t("accountSettings.accountSettings")}</h1>
            </div>
            <div className="meta">
              <span>{session?.email}</span>
              <span aria-hidden="true">·</span>
              <span>{t("accountSettings.theseSettingsFollowYouAcross")}</span>
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: "24px", alignItems: "start" }}>
          <nav className="card snav" aria-label={t("accountSettings.accountSections")} style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "2px" }}>
            <a href="#profile">
              <span className="row">
                <User className="ic" aria-hidden="true" />
                {t("accountSettings.profile")}
              </span>
            </a>
            <a href="#security">
              <span className="row">
                <KeyRound className="ic" aria-hidden="true" />
                {t("accountSettings.security")}
              </span>
            </a>
            <a href="#sessions">
              <span className="row">
                <MonitorSmartphone className="ic" aria-hidden="true" />
                {t("accountSettings.sessions")}
              </span>
            </a>
            <a href="#agents" className="on" aria-current="true">
              <span className="row">
                <Bot className="ic" aria-hidden="true" />
                {t("accountSettings.connectedAgents")}
              </span>
            </a>
            <Link to="/notifications">
              <span className="row">
                <Bell className="ic" aria-hidden="true" />
                {t("accountSettings.notifications")}
              </span>
            </Link>
          </nav>
          <div style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
            <section className="card" id="profile" aria-labelledby="profile-h">
              <div className="card-h">
                <h2 id="profile-h" style={{ fontSize: "15px" }}>
                  {t("accountSettings.profile")}
                </h2>
              </div>
              <div className="card-b">
                <dl className="kv" style={{ fontSize: "14px" }}>
                  {meState.status === "ready" && meState.me.displayName ? (
                    <>
                      <dt>{t("accountSettings.name")}</dt>
                      <dd>{meState.me.displayName}</dd>
                    </>
                  ) : null}
                  <dt>{t("accountSettings.email")}</dt>
                  <dd>{session?.email ?? "—"}</dd>
                  <dt>{t("accountSettings.signIn")}</dt>
                  <dd>{meState.status === "ready" && meState.me.signInMethod === "passport" ? "OpenGrants Passport" : t("accountSettings.oneTimeCodeSentTo")}</dd>
                </dl>
                <p className="help" style={{ marginTop: "10px" }}>
                  {t("accountSettings.yourOrganizationSDetailsAre")}
                </p>
              </div>
            </section>

            <section className="card" id="security" aria-labelledby="security-h">
              <div className="card-h">
                <h2 id="security-h" style={{ fontSize: "15px" }}>
                  {t("accountSettings.multiFactorAuthentication")}
                </h2>
                {factors === null ? null : factors.length > 0 ? (
                  <span className="bdg bdg-ok">
                    <ShieldCheck className="ic" aria-hidden="true" />
                    {t("accountSettings.authenticatorOn")}
                  </span>
                ) : (
                  <span className="bdg bdg-warn">
                    <KeyRound className="ic" aria-hidden="true" />
                    {t("accountSettings.notSetUp")}
                  </span>
                )}
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <p>
                  {factors && factors.length > 0
                    ? t(session?.aal === "aal2" ? "accountSettings.authenticatorVerified" : "accountSettings.authenticatorNotYetVerified")
                    : t("accountSettings.funderAdminsAndFinanceAnd")}
                </p>
                {(!factors || factors.length === 0 || session?.aal !== "aal2") && (
                  <Link to={signInPath("/account/agents", "mfa")} className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
                    {factors && factors.length > 0 ? t("accountSettings.verifyThisSession") : t("accountSettings.setUpAnAuthenticator")}
                  </Link>
                )}
              </div>
            </section>

            <SessionsCard
              email={session?.email ?? null}
              onSignOut={async () => {
                await auth.signOut();
                navigate("/signin");
              }}
            />

            <section className="card" id="agents" aria-labelledby="agents-h">
              <div className="card-h">
                <div>
                  <h2 id="agents-h" style={{ fontSize: "15px" }}>
                    {t("accountSettings.connectedAgents")}
                  </h2>
                  <p className="small muted">{t("accountSettings.agentsActWithYourPermissions")}</p>
                </div>
                <Link to="/agents" className="btn btn-secondary btn-sm">
                  {t("accountSettings.howAgentsConnect")}
                </Link>
              </div>
              {meState.status === "loading" && (
                <div style={{ padding: "0 20px" }}>
                  <Loading label={t("accountSettings.loadingYourWorkspaces")} />
                </div>
              )}
              {meState.status === "error" && (
                <div style={{ padding: "16px 20px" }}>
                  <ErrorBanner error={meState.error} onRetry={reloadMe} />
                </div>
              )}
              {meState.status === "ready" && meState.me.workspaces.length === 0 && <p className="small muted" style={{ padding: "16px 20px" }}>{t("accountSettings.youDoNotBelongTo")}</p>}
              {meState.status === "ready" && meState.me.workspaces.map((ws) => <Agents key={ws.id} ws={ws} />)}
            </section>
          </div>
        </div>
      </AccountShell>
    </>
  );
}
