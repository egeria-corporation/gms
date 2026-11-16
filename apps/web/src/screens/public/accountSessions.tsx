// SPDX-License-Identifier: AGPL-3.0-only
// The Sessions card on Account settings: every place the person is signed in, with a way to end
// the others. The current session is ended by signing out. Location is not shown: the GMS keeps no
// record of where a session was opened.
import { Check, LogOut, Monitor, Smartphone } from "lucide-react";
import type { AccountSession } from "../../api/launch.ts";
import { useLaunchMutation, useLaunchQuery } from "../../api/launchHooks.ts";
import { timeAgo } from "../../components/applicant.tsx";
import { ErrorBanner, Loading } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";

import { translator } from "../../i18n/index.tsx";

const t = translator("public");
const isPhone = (device: string | null) => /iphone|ipad|ios|android|mobile/i.test(device ?? "");

export function SessionsCard({ email, onSignOut }: { email: string | null; onSignOut: () => void }) {
  const sessions = useLaunchQuery((api) => api.sessions(), []);
  const end = useLaunchMutation((api, id: string) => api.signOutSession(id));
  const others = (sessions.data ?? []).filter((s) => !s.current);

  async function endOne(s: AccountSession) {
    if (await end.run(s.id)) sessions.reload();
  }
  async function endOthers() {
    for (const s of others) {
      if (!(await end.run(s.id))) break;
    }
    sessions.reload();
  }

  return (
    <section className="card" id="sessions" aria-labelledby="sessions-h">
      <div className="card-h">
        <h2 id="sessions-h" style={{ fontSize: "15px" }}>
          {t("accountSessions.sessions")}
        </h2>
        <div className="row wrap">
          {others.length > 0 && (
            <button className="btn btn-sm btn-danger" type="button" disabled={end.state === "saving"} onClick={endOthers}>
              {t("accountSessions.signOutOfAllOther")}
            </button>
          )}
          <button className="btn btn-sm btn-secondary" type="button" onClick={onSignOut}>
            <LogOut className="ic" aria-hidden="true" />
            {t("accountSessions.signOut")}
          </button>
        </div>
      </div>
      {sessions.status === "loading" && (
        <div className="card-b">
          <Loading label={t("accountSessions.loadingSessions")} />
        </div>
      )}
      {sessions.status === "error" && (
        <div className="card-b">
          <ErrorBanner error={sessions.error} onRetry={sessions.reload} />
        </div>
      )}
      {end.error !== null && (
        <div className="card-b">
          <ErrorBanner error={end.error} />
        </div>
      )}
      {sessions.status === "ready" && sessions.data.length === 0 && (
        <div className="card-b">
          <div className="b">{t("accountSessions.thisBrowser")}</div>
          <div className="help">{email ? t("accountSessions.thisBrowserAs", { email }) : t("accountSessions.thisBrowserYou")}</div>
        </div>
      )}
      {sessions.status === "ready" && sessions.data.length > 0 && (
        <div className="tbl-wrap" style={{ border: 0, borderRadius: "0 0 12px 12px" }} tabIndex={0} role="region" aria-label={t("accountSessions.sessionsScrollable")}>
          <table className="tbl" aria-label={t("accountSessions.sessions")}>
            <thead>
              <tr>
                <th scope="col">{t("accountSessions.device")}</th>
                <th scope="col">{t("accountSessions.networkAddress")}</th>
                <th scope="col">{t("accountSessions.lastActive")}</th>
                <th scope="col">{t("accountSessions.signedIn")}</th>
                <th scope="col">{t("accountSessions.secondFactor")}</th>
                <th scope="col" style={{ width: "100px" }}>
                  <span className="sr">{t("accountSessions.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.data.map((s) => {
                const Icon = isPhone(s.device) ? Smartphone : Monitor;
                return (
                  <tr key={s.id}>
                    <td>
                      <span className="row" style={{ gap: "8px" }}>
                        <Icon className="ic" aria-hidden="true" />
                        {s.device ?? t("accountSessions.unknownDevice")}
                        {s.current && (
                          <span className="bdg bdg-ok" style={{ marginLeft: "4px" }}>
                            <Check className="ic" aria-hidden="true" />
                            {t("accountSessions.thisDevice")}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="mono">{s.ip ?? "—"}</td>
                    <td>{s.current ? t("accountSessions.now") : s.lastActiveAt ? timeAgo(s.lastActiveAt) : "—"}</td>
                    <td>{formatDate(s.createdAt)}</td>
                    <td>{s.mfa ? t("accountSessions.verified") : t("accountSessions.notVerified")}</td>
                    <td>
                      {!s.current && (
                        <button className="btn btn-sm btn-secondary" type="button" disabled={end.state === "saving"} onClick={() => endOne(s)} aria-label={s.device ? t("accountSessions.revokeTheSessionOn", { device: s.device }) : t("accountSessions.revokeUnknownDevice")}>
                          {t("accountSessions.revoke")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
