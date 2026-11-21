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
import { useAppConfig } from "../../api/launchHooks.ts";
import { useSocialMutation, useSocialQuery } from "../../api/socialHooks.ts";
import { useCurrentWorkspace } from "../../app/workspace.tsx";
import { ApplicantShell, FunderShell } from "../../components/shells.tsx";
import { ErrorBanner, Loading, Notice, PageHeader } from "../../components/ui.tsx";
import { SettingsNav } from "../funder/SettingsPassport.tsx";

import { intlLocale, translator } from "../../i18n/index.tsx";



const t = translator("shared");
const since = (iso: string) => new Date(iso).toLocaleDateString(intlLocale(), { month: "long", day: "numeric", year: "numeric" });

function Frame({ children }: { children: ReactNode }) {
  const ws = useCurrentWorkspace()!;
  const base = `/w/${ws.handle}`;
  const header = <PageHeader crumbs={[{ label: ws.name, to: base }, { label: t("settingsSocial.settings"), to: `${base}/settings` }, { label: t("settingsSocial.socialAccounts") }]} title={t("settingsSocial.socialAccounts")} meta={<span>{ws.name}</span>} />;
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
  const config = useAppConfig();
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
      <title>{t("settingsSocial.socialAccounts2", { name: ws.name })}</title>
      <section className="card" aria-labelledby="social-accounts-title">
        <div className="card-h">
          <div>
            <h2 id="social-accounts-title">{t("settingsSocial.socialAccounts")}</h2>
            <p className="small muted">
              {t("settingsSocial.announceOpenCallsAndAwards")}
            </p>
          </div>
        </div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {connected && (
            <Notice tone="ok" title={t("settingsSocial.accountConnected", { label: connected.label })}>
              {connected.username ? t("settingsSocial.canNowBeChosenWhen", { username: connected.username }) : t("settingsSocial.itCanNowBeChosen")}
            </Notice>
          )}
          {finish.error !== null && <ErrorBanner error={finish.error} title={t("settingsSocial.theAccountWasNotConnected")} />}
          {connect.error !== null && <ErrorBanner error={connect.error} title={t("settingsSocial.connectingCouldNotStart")} />}
          {disconnect.error !== null && <ErrorBanner error={disconnect.error} title={t("settingsSocial.theAccountWasNotDisconnected")} />}
          {!config.ready && <Loading label={t("settingsSocial.loadingSocialAccounts")} />}
          {config.ready && config.available?.social === false && (
            <Notice tone="neu" title={t("settingsSocial.socialPostingIsNotSet")}>
              {t("settingsSocial.thePersonWhoRunsThis")}
            </Notice>
          )}
          {config.ready && config.available?.social !== false && q.status === "loading" && <Loading label={t("settingsSocial.loadingSocialAccounts")} />}
          {config.ready && config.available?.social !== false && q.status === "error" && <ErrorBanner error={q.error} onRetry={q.reload} />}
          {config.ready && config.available?.social !== false && q.status === "ready" && !q.data && (
            <Notice tone="neu" title={t("settingsSocial.socialPostingIsNotSet")}>
              {t("settingsSocial.thePersonWhoRunsThis")}
            </Notice>
          )}
          {config.ready && config.available?.social !== false && q.status === "ready" && q.data && (
            <>
              <div>
                <h3 style={{ fontSize: "14px", marginBottom: "8px" }}>{t("settingsSocial.connected")}</h3>
                {q.data.accounts.length === 0 ? (
                  <p className="small muted">{t("settingsSocial.noAccountsConnectedYet")}</p>
                ) : (
                  <ul aria-label={t("settingsSocial.connectedAccounts")} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
                    {q.data.accounts.map((a) => (
                      <li key={a.id} className="row wrap" style={{ gap: "10px", alignItems: "center", justifyContent: "space-between" }}>
                        <span className="row wrap" style={{ gap: "8px", alignItems: "center" }}>
                          <span className="bdg bdg-ok">
                            <CircleCheck className="ic" aria-hidden="true" />
                            {t("settingsSocial.connected")}
                          </span>
                          <span className="b">{a.label}</span>
                          {a.username && <span>{a.username}</span>}
                          <span className="small muted">{t("settingsSocial.since", { connectedAt: since(a.connectedAt) })}</span>
                        </span>
                        {q.data!.canConnect && (
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            aria-label={a.username ? t("settingsSocial.disconnectAccount", { label: a.label, username: a.username }) : t("settingsSocial.disconnect", { label: a.label })}
                            disabled={disconnect.state === "saving"}
                            onClick={async () => {
                              if (await disconnect.run(a.id)) {
                                setConnected(null);
                                q.reload();
                              }
                            }}
                          >
                            <Unplug className="ic" aria-hidden="true" />
                            {t("settingsSocial.disconnect2")}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 style={{ fontSize: "14px", marginBottom: "8px" }}>{t("settingsSocial.connectAnAccount")}</h3>
                {q.data.canConnect ? (
                  <div className="row wrap" style={{ gap: "8px" }}>
                    {q.data.platforms.map((p) => (
                      <button key={p.platform} type="button" className="btn btn-secondary" disabled={connect.state === "saving"} onClick={() => startConnect(p.platform)}>
                        <Plug className="ic" aria-hidden="true" />
                        {t("settingsSocial.connect", { label: p.label })}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="small muted">{q.data.canPost ? t("settingsSocial.adminsConnect") : t("settingsSocial.adminsConnectIfEditor")}</p>
                )}
                <p className="small muted" style={{ marginTop: "8px" }}>
                  {t("settingsSocial.aFacebookPageOrA")}
                </p>
              </div>
            </>
          )}
          <p className="small">
            <Link to={`/w/${ws.handle}`}>{t("settingsSocial.backToTheDashboard")}</Link>
          </p>
        </div>
      </section>
    </Frame>
  );
}
