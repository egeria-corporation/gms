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
        <span className="role">{ws.kind === "funder" ? "Funder" : "Applicant"}</span>
        <span className="small muted">{roleTitle(ws.role)}</span>
      </div>
      {query.status === "loading" && (
        <div style={{ padding: "0 20px" }}>
          <Loading label="Loading connected agents" />
        </div>
      )}
      {query.status === "error" && (
        <div style={{ padding: "12px 20px" }}>
          <ErrorBanner error={query.error} onRetry={query.reload} />
        </div>
      )}
      {query.status === "ready" && query.data.length === 0 && <p className="small muted" style={{ padding: "4px 20px 16px" }}>No agent is connected to this workspace.</p>}
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
                  {!c.mine && <span className="tag" style={{ marginLeft: "8px" }}>Connected by a teammate</span>}
                </div>
                <div className="small muted">
                  Client <span className="mono">{c.clientUri ?? c.clientId}</span> · connected {formatDate(c.createdAt)} · {c.lastUsedAt ? `last used ${timeAgo(c.lastUsedAt)}` : "never used"}
                </div>
                <div className="row wrap" style={{ gap: "4px", marginTop: "6px" }}>
                  {c.scopes.map((s) => (
                    <span key={s} className="tag">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              <button className="btn btn-sm btn-danger" type="button" aria-label={`Revoke ${c.clientName ?? c.clientId} in ${ws.name}`} onClick={() => setConfirm(c)}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} labelledBy={`revoke-${ws.handle}`}>
        <div className="hd">
          <h2 id={`revoke-${ws.handle}`} style={{ fontSize: "18px" }}>
            Revoke {confirm?.clientName ?? confirm?.clientId}?
          </h2>
        </div>
        <div className="bd">
          <p>The agent loses access to {ws.name} at once and has to be connected again to come back. Work it already drafted stays.</p>
          {error ? <ErrorBanner error={error} title="The agent was not revoked" /> : null}
        </div>
        <div className="ft">
          <button className="btn btn-secondary" type="button" onClick={() => setConfirm(null)}>
            Cancel
          </button>
          <button className="btn btn-danger-solid" type="button" disabled={busy} onClick={() => confirm && void revoke(confirm)}>
            Revoke access
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
      <title>Account settings — OpenGrants GMS</title>
      <AccountShell active="account">
        <div className="ph">
          <div>
            <div className="title">
              <h1>Account settings</h1>
            </div>
            <div className="meta">
              <span>{session?.email}</span>
              <span aria-hidden="true">·</span>
              <span>These settings follow you across every workspace.</span>
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: "24px", alignItems: "start" }}>
          <nav className="card snav" aria-label="Account sections" style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "2px" }}>
            <a href="#profile">
              <span className="row">
                <User className="ic" aria-hidden="true" />
                Profile
              </span>
            </a>
            <a href="#security">
              <span className="row">
                <KeyRound className="ic" aria-hidden="true" />
                Security
              </span>
            </a>
            <a href="#sessions">
              <span className="row">
                <MonitorSmartphone className="ic" aria-hidden="true" />
                Sessions
              </span>
            </a>
            <a href="#agents" className="on" aria-current="true">
              <span className="row">
                <Bot className="ic" aria-hidden="true" />
                Connected agents
              </span>
            </a>
            <Link to="/notifications">
              <span className="row">
                <Bell className="ic" aria-hidden="true" />
                Notifications
              </span>
            </Link>
          </nav>
          <div style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
            <section className="card" id="profile" aria-labelledby="profile-h">
              <div className="card-h">
                <h2 id="profile-h" style={{ fontSize: "15px" }}>
                  Profile
                </h2>
              </div>
              <div className="card-b">
                <dl className="kv" style={{ fontSize: "14px" }}>
                  {meState.status === "ready" && meState.me.displayName ? (
                    <>
                      <dt>Name</dt>
                      <dd>{meState.me.displayName}</dd>
                    </>
                  ) : null}
                  <dt>Email</dt>
                  <dd>{session?.email ?? "—"}</dd>
                  <dt>Sign-in</dt>
                  <dd>{meState.status === "ready" && meState.me.signInMethod === "passport" ? "OpenGrants Passport" : "One-time code sent to this email"}</dd>
                </dl>
                <p className="help" style={{ marginTop: "10px" }}>
                  Your organization's details are kept in OpenGrants Passport, not here.
                </p>
              </div>
            </section>

            <section className="card" id="security" aria-labelledby="security-h">
              <div className="card-h">
                <h2 id="security-h" style={{ fontSize: "15px" }}>
                  Multi-factor authentication
                </h2>
                {factors === null ? null : factors.length > 0 ? (
                  <span className="bdg bdg-ok">
                    <ShieldCheck className="ic" aria-hidden="true" />
                    Authenticator on
                  </span>
                ) : (
                  <span className="bdg bdg-warn">
                    <KeyRound className="ic" aria-hidden="true" />
                    Not set up
                  </span>
                )}
              </div>
              <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <p>
                  {factors && factors.length > 0
                    ? `An authenticator app is enrolled. This session is ${session?.aal === "aal2" ? "verified with it" : "not yet verified with it"}.`
                    : "Funder admins and finance, and applicant admins, need an authenticator app before their workspace opens."}
                </p>
                {(!factors || factors.length === 0 || session?.aal !== "aal2") && (
                  <Link to={signInPath("/account/agents", "mfa")} className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
                    {factors && factors.length > 0 ? "Verify this session" : "Set up an authenticator"}
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
                    Connected agents
                  </h2>
                  <p className="small muted">Agents act with your permissions, never more. Submitting, signing, accepting an award and releasing money always come back to a person.</p>
                </div>
                <Link to="/agents" className="btn btn-secondary btn-sm">
                  How agents connect
                </Link>
              </div>
              {meState.status === "loading" && (
                <div style={{ padding: "0 20px" }}>
                  <Loading label="Loading your workspaces" />
                </div>
              )}
              {meState.status === "error" && (
                <div style={{ padding: "16px 20px" }}>
                  <ErrorBanner error={meState.error} onRetry={reloadMe} />
                </div>
              )}
              {meState.status === "ready" && meState.me.workspaces.length === 0 && <p className="small muted" style={{ padding: "16px 20px" }}>You do not belong to a workspace yet.</p>}
              {meState.status === "ready" && meState.me.workspaces.map((ws) => <Agents key={ws.id} ws={ws} />)}
            </section>
          </div>
        </div>
      </AccountShell>
    </>
  );
}
