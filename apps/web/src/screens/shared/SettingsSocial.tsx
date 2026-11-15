// SPDX-License-Identifier: AGPL-3.0-only
// Settings › Social accounts, for funder and applicant workspaces: connect LinkedIn, Facebook,
// Instagram, X, Bluesky and Threads through Zernio (the workspace's own Zernio profile is made on
// the first connection), see what is connected, and disconnect. Zernio sends the browser back here
// with the account it connected; the server records it only once Zernio lists it under this
// workspace and the link was started by this person, here, in the last ten minutes.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { CircleCheck, Plug, Unplug } from "lucide-react";
import { callbackFrom, type SocialAccount, type SocialPlatform } from "../../api/social.ts";
import { useSocialMutation, useSocialQuery } from "../../api/socialHooks.ts";
import { useCurrentWorkspace } from "../../app/workspace.tsx";
import { ApplicantShell, FunderShell } from "../../components/shells.tsx";
import { ErrorBanner, Loading, Notice, PageHeader } from "../../components/ui.tsx";
import { SettingsNav } from "../funder/SettingsPassport.tsx";

const since = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

function Frame({ children }: { children: ReactNode }) {
  const ws = useCurrentWorkspace()!;
  const base = `/w/${ws.handle}`;
  const header = <PageHeader crumbs={[{ label: ws.name, to: base }, { label: "Settings", to: `${base}/settings` }, { label: "Social accounts" }]} title="Social accounts" meta={<span>{ws.name}</span>} />;
  if (ws.kind === "funder") {
    return (
      <FunderShell active="Settings">
        <main className="main">
          {header}
          <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
            <SettingsNav base={base} active="social" />
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>{children}</div>
          </div>
        </main>
      </FunderShell>
    );
  }
  return (
    <ApplicantShell active="Settings">
      <main className="main">
        {header}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "860px" }}>{children}</div>
      </main>
    </ApplicantShell>
  );
}

export default function SettingsSocial() {
  const ws = useCurrentWorkspace()!;
  const location = useLocation();
  const navigate = useNavigate();
  const q = useSocialQuery((api) => api.settings(), []);
  const connect = useSocialMutation((api, p: SocialPlatform) => api.connect(p));
  const finish = useSocialMutation((api, params: NonNullable<ReturnType<typeof callbackFrom>>) => api.finishConnect(params));
  const disconnect = useSocialMutation((api, id: string) => api.disconnect(id));
  const [connected, setConnected] = useState<SocialAccount | null>(null);
  const handled = useRef(new Set<string>());

  // Back from Zernio: record the account once, then take the parameters out of the address.
  useEffect(() => {
    const cb = callbackFrom(location.search);
    if (!cb || handled.current.has(cb.state)) return;
    handled.current.add(cb.state);
    void (async () => {
      const account = await finish.run(cb);
      if (account) setConnected(account);
      navigate(location.pathname, { replace: true });
      q.reload();
    })();
  }, [location.search]);

  const startConnect = async (platform: SocialPlatform) => {
    const r = await connect.run(platform);
    if (!r) return;
    // Zernio's sign-in is another site; in mock mode the link is a path back into this app.
    if (r.authUrl.startsWith("/")) navigate(r.authUrl);
    else window.location.assign(r.authUrl);
  };

  return (
    <Frame>
      <title>{`Social accounts — ${ws.name}`}</title>
      <section className="card" aria-labelledby="social-accounts-title">
        <div className="card-h">
          <div>
            <h2 id="social-accounts-title">Social accounts</h2>
            <p className="small muted">
              Announce open calls and awards on your organization's own accounts. Connecting signs in at the platform through Zernio; the GMS keeps the account's name and Zernio's id, never a password or a token. Nothing is ever posted without a person pressing Post.
            </p>
          </div>
        </div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {connected && (
            <Notice tone="ok" title={`${connected.label} account connected`}>
              {connected.username ? `${connected.username} can now be chosen when you post.` : "It can now be chosen when you post."}
            </Notice>
          )}
          {finish.error !== null && <ErrorBanner error={finish.error} title="The account was not connected" />}
          {connect.error !== null && <ErrorBanner error={connect.error} title="Connecting could not start" />}
          {disconnect.error !== null && <ErrorBanner error={disconnect.error} title="The account was not disconnected" />}
          {q.status === "loading" && <Loading label="Loading social accounts" />}
          {q.status === "error" && <ErrorBanner error={q.error} onRetry={q.reload} />}
          {q.status === "ready" && !q.data && (
            <Notice tone="neu" title="Social posting is not set up on this server">
              The person who runs this GMS can turn it on with a Zernio key.
            </Notice>
          )}
          {q.status === "ready" && q.data && (
            <>
              <div>
                <h3 style={{ fontSize: "14px", marginBottom: "8px" }}>Connected</h3>
                {q.data.accounts.length === 0 ? (
                  <p className="small muted">No accounts connected yet.</p>
                ) : (
                  <ul aria-label="Connected accounts" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
                    {q.data.accounts.map((a) => (
                      <li key={a.id} className="row wrap" style={{ gap: "10px", alignItems: "center", justifyContent: "space-between" }}>
                        <span className="row wrap" style={{ gap: "8px", alignItems: "center" }}>
                          <span className="bdg bdg-ok">
                            <CircleCheck className="ic" aria-hidden="true" />
                            Connected
                          </span>
                          <span className="b">{a.label}</span>
                          {a.username && <span>{a.username}</span>}
                          <span className="small muted">since {since(a.connectedAt)}</span>
                        </span>
                        {q.data!.canConnect && (
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            aria-label={`Disconnect ${a.label}${a.username ? ` ${a.username}` : ""}`}
                            disabled={disconnect.state === "saving"}
                            onClick={async () => {
                              if (await disconnect.run(a.id)) {
                                setConnected(null);
                                q.reload();
                              }
                            }}
                          >
                            <Unplug className="ic" aria-hidden="true" />
                            Disconnect
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 style={{ fontSize: "14px", marginBottom: "8px" }}>Connect an account</h3>
                {q.data.canConnect ? (
                  <div className="row wrap" style={{ gap: "8px" }}>
                    {q.data.platforms.map((p) => (
                      <button key={p.platform} type="button" className="btn btn-secondary" disabled={connect.state === "saving"} onClick={() => startConnect(p.platform)}>
                        <Plug className="ic" aria-hidden="true" />
                        Connect {p.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="small muted">Workspace admins connect accounts. You can post to connected accounts from a call or an award{q.data.canPost ? "" : " if you are an admin or an editor"}.</p>
                )}
                <p className="small muted" style={{ marginTop: "8px" }}>
                  A Facebook page or a LinkedIn organization page is chosen on the platform's own screen. Instagram posts need a picture; the share card is used.
                </p>
              </div>
            </>
          )}
          <p className="small">
            <Link to={`/w/${ws.handle}`}>Back to the dashboard</Link>
          </p>
        </div>
      </section>
    </Frame>
  );
}
