// SPDX-License-Identifier: AGPL-3.0-only
// Settings → Connected apps (v1.12.0, docs/connectors.md), for both kinds of workspace: Slack alerts
// (a workspace admin connects Slack and picks a channel and the events), my Google Calendar (each
// person their own: deadlines written as events), Google Drive (applicants: attach and save files)
// and Salesforce (an import source, read only). Every connection goes through Composio, with the
// narrowest permissions; an app this server is not set up for is not shown. Connecting, choosing
// and turning alerts on or off are done here by a person, never by an agent.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { BellRing, CalendarDays, CircleCheck, CircleDashed, Cloud, HardDrive, Hash, Plug, RefreshCw, TriangleAlert, Unplug } from "lucide-react";
import type { AlertEvent, AppConnection, CalendarEntry, SlackAlerts, SlackChannel, WorkspaceApp } from "../../api/connectedApps.ts";
import { useConnectedAppsMutation, useConnectedAppsQuery } from "../../api/connectedAppsHooks.ts";
import { useAppConfig } from "../../api/launchHooks.ts";
import { useCurrentWorkspace } from "../../app/workspace.tsx";
import { ApplicantShell, FunderShell } from "../../components/shells.tsx";
import { ErrorBanner, Field, Loading, Notice, PageHeader } from "../../components/ui.tsx";
import { intlLocale, translator } from "../../i18n/index.tsx";
import { SettingsNav } from "../funder/SettingsPassport.tsx";

const t = translator("shared");
const when = (iso: string) => new Date(iso).toLocaleString(intlLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const EVENT_LABEL: Record<AlertEvent, () => string> = {
  new_application: () => t("connectedApps.event.newApplication"),
  review_assigned: () => t("connectedApps.event.reviewAssigned"),
  deadline_soon: () => t("connectedApps.event.deadlineSoon"),
  report_due: () => t("connectedApps.event.reportDue"),
  payment_due: () => t("connectedApps.event.paymentDue"),
};

function Frame({ children }: { children: ReactNode }) {
  const ws = useCurrentWorkspace()!;
  const base = `/w/${ws.handle}`;
  const header = <PageHeader crumbs={[{ label: ws.name, to: base }, { label: t("connectedApps.settings"), to: `${base}/settings` }, { label: t("connectedApps.title") }]} title={t("connectedApps.title")} meta={<span>{ws.name}</span>} />;
  if (ws.kind === "funder") {
    return (
      <FunderShell active="Settings">
        <main className="main">
          {header}
          <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
            <SettingsNav base={base} active="apps" />
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

/** A connection's state, as an icon and words (never colour alone). */
function State({ connected, pending, error }: { connected: boolean; pending?: boolean; error?: boolean }) {
  if (connected)
    return (
      <span className="bdg bdg-ok">
        <CircleCheck className="ic" aria-hidden="true" />
        {t("connectedApps.connected")}
      </span>
    );
  if (error)
    return (
      <span className="bdg bdg-warn">
        <TriangleAlert className="ic" aria-hidden="true" />
        {t("connectedApps.needsConnectingAgain")}
      </span>
    );
  return (
    <span className={pending ? "bdg bdg-info" : "bdg bdg-neutral"}>
      <CircleDashed className="ic" aria-hidden="true" />
      {pending ? t("connectedApps.signInStarted") : t("connectedApps.notConnected")}
    </span>
  );
}

function Card({ id, icon, title, sub, state, children }: { id: string; icon: ReactNode; title: string; sub: string; state: ReactNode; children: ReactNode }) {
  return (
    <section className="card" aria-labelledby={`${id}-h`}>
      <div className="card-h">
        <div className="row" style={{ gap: "10px", alignItems: "flex-start" }}>
          {icon}
          <div>
            <h2 id={`${id}-h`} style={{ fontSize: "18px" }}>
              {title}
            </h2>
            <p className="small muted">{sub}</p>
          </div>
        </div>
        {state}
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {children}
      </div>
    </section>
  );
}

/** Connect or disconnect a workspace app (Slack, Google Drive, Salesforce). Composio returns the browser here. */
function useWorkspaceApp(app: WorkspaceApp) {
  const ws = useCurrentWorkspace()!;
  const location = useLocation();
  const navigate = useNavigate();
  const q = useConnectedAppsQuery((api) => api.connection(app), [app]);
  const connect = useConnectedAppsMutation((api) => api.connect(app, `/w/${ws.handle}/settings/apps`));
  const disconnect = useConnectedAppsMutation((api) => api.disconnect(app));
  const back = useRef(new URLSearchParams(location.search).get("connected") === app);
  const run = connect.run;
  const set = q.set;
  // Back from the provider's sign-in: ask once whether the connection is now active, then tidy the address.
  useEffect(() => {
    if (!back.current) return;
    back.current = false;
    void run().then((next) => {
      if (next) set(next);
      navigate(location.pathname, { replace: true });
    });
  }, [run, set]);
  const start = async () => {
    const next = await connect.run();
    if (!next) return;
    q.set(next);
    if (!next.connected && next.connectUrl) window.location.assign(next.connectUrl);
  };
  const stop = async () => {
    const next = await disconnect.run();
    if (next) q.set(next);
  };
  return { q, start, stop, busy: connect.state === "saving" || disconnect.state === "saving", error: connect.error ?? disconnect.error };
}

function ConnectRow({ app, c, start, stop, busy, label }: { app: WorkspaceApp; c: AppConnection; start: () => void; stop: () => void; busy: boolean; label: string }) {
  return c.connected ? (
    <div className="row wrap" style={{ gap: "10px" }}>
      <span className="small muted">{t("connectedApps.permissions", { scopes: c.scopes.join(", ") })}</span>
      <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={stop}>
        <Unplug className="ic" aria-hidden="true" />
        {t("connectedApps.disconnect", { app: label })}
      </button>
    </div>
  ) : (
    <div className="row wrap" style={{ gap: "10px" }}>
      <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={start} data-app={app}>
        <Plug className="ic" aria-hidden="true" />
        {c.status === "pending" ? t("connectedApps.continueSignIn", { app: label }) : t("connectedApps.connect", { app: label })}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------------------------ Slack

function SlackSettings({ alerts, onSaved }: { alerts: SlackAlerts; onSaved: () => void }) {
  const channels = useConnectedAppsQuery((api) => api.slackChannels(), []);
  const sub = alerts.subscription;
  const [channelId, setChannelId] = useState(sub?.channelId ?? "");
  const [events, setEvents] = useState<AlertEvent[]>(sub?.events ?? alerts.events);
  const [enabled, setEnabled] = useState(sub?.enabled ?? true);
  const save = useConnectedAppsMutation((api) => api.saveSlack({ channelId, events, enabled }));
  const remove = useConnectedAppsMutation((api) => api.deleteSlack());
  const [saved, setSaved] = useState<{ member: boolean } | null>(null);
  const list: SlackChannel[] = channels.status === "ready" ? channels.data : [];
  const chosen = list.find((c) => c.id === channelId);
  return (
    <>
      {channels.status === "loading" && <Loading label={t("connectedApps.slack.loadingChannels")} />}
      {channels.status === "error" && <ErrorBanner error={channels.error} onRetry={channels.reload} />}
      <form
        className="col"
        style={{ gap: "12px" }}
        onSubmit={async (e) => {
          e.preventDefault();
          setSaved(null);
          const out = await save.run();
          if (out) {
            setSaved({ member: out.channelMember });
            onSaved();
          }
        }}
      >
        <Field id="slack-channel" label={t("connectedApps.slack.channel")} help={t("connectedApps.slack.channelHelp")}>
          <select id="slack-channel" className="sel" value={channelId} onChange={(e) => setChannelId(e.target.value)} style={{ maxWidth: "320px" }}>
            <option value="">{t("connectedApps.slack.chooseChannel")}</option>
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </select>
        </Field>
        {chosen && !chosen.member && (
          <Notice tone="info" title={t("connectedApps.slack.inviteTitle", { channel: chosen.name })}>
            {t("connectedApps.slack.inviteBody")}
          </Notice>
        )}
        <fieldset className="col" style={{ gap: "6px", border: 0, padding: 0, margin: 0 }}>
          <legend className="b">{t("connectedApps.slack.events")}</legend>
          {alerts.events.map((e) => (
            <label key={e} className="row" style={{ gap: "8px" }}>
              <input type="checkbox" checked={events.includes(e)} onChange={(x) => setEvents(x.target.checked ? [...events, e] : events.filter((y) => y !== e))} />
              <span>{EVENT_LABEL[e]()}</span>
            </label>
          ))}
        </fieldset>
        <label className="row" style={{ gap: "8px" }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="b">{t("connectedApps.slack.alertsOn")}</span>
        </label>
        <p className="small muted" style={{ margin: 0 }}>
          {t("connectedApps.slack.whatIsSent")}
        </p>
        {(save.error !== null || remove.error !== null) && <ErrorBanner error={save.error ?? remove.error} />}
        {saved && (
          <span className="notice" role="status">
            <CircleCheck className="ic" aria-hidden="true" />
            {enabled ? t("connectedApps.slack.savedOn") : t("connectedApps.slack.savedOff")}
          </span>
        )}
        <div className="row wrap" style={{ gap: "10px" }}>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!channelId || save.state === "saving"}>
            {t("connectedApps.slack.save")}
          </button>
          {sub && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={remove.state === "saving"}
              onClick={async () => {
                if (await remove.run()) onSaved();
              }}
            >
              {t("connectedApps.slack.stop")}
            </button>
          )}
        </div>
      </form>
    </>
  );
}

function SlackCard() {
  const app = useWorkspaceApp("slack");
  const alerts = useConnectedAppsQuery((api) => api.slack(), [app.q.status === "ready" && app.q.data.connected]);
  const c = app.q.data;
  return (
    <Card id="ca-slack" icon={<Hash className="ic ic-md" aria-hidden="true" />} title={t("connectedApps.slack.title")} sub={t("connectedApps.slack.sub")} state={c ? <State connected={c.connected} pending={c.status === "pending"} /> : null}>
      {app.q.status === "loading" && <Loading label={t("connectedApps.loading")} />}
      {app.q.status === "error" && <ErrorBanner error={app.q.error} onRetry={app.q.reload} />}
      {app.error !== null && <ErrorBanner error={app.error} />}
      {c && <ConnectRow app="slack" c={c} start={() => void app.start()} stop={() => void app.stop()} busy={app.busy} label="Slack" />}
      {c?.connected && alerts.status === "ready" && <SlackSettings key={alerts.data.subscription?.updatedAt ?? "new"} alerts={alerts.data} onSaved={alerts.reload} />}
      {c?.connected && alerts.status === "ready" && alerts.data.recent.length > 0 && (
        <div>
          <h3 className="b" style={{ fontSize: "14px" }}>
            {t("connectedApps.slack.recent")}
          </h3>
          <ul className="small" style={{ margin: 0, paddingLeft: "18px" }}>
            {alerts.data.recent.slice(0, 5).map((r, i) => (
              <li key={i}>
                {EVENT_LABEL[r.event]()} · {r.status === "sent" ? t("connectedApps.slack.sent") : r.status === "failed" ? t("connectedApps.slack.failed") : t("connectedApps.slack.sending")} · {when(r.at)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------- Google Calendar

function CalendarCard() {
  const ws = useCurrentWorkspace()!;
  const location = useLocation();
  const link = useConnectedAppsQuery((api) => api.calendar(), []);
  const connect = useConnectedAppsMutation((api) => api.connectCalendar(`/w/${ws.handle}/settings/apps`));
  const choose = useConnectedAppsMutation((api, id: string) => api.chooseCalendar(id));
  const sync = useConnectedAppsMutation((api) => api.syncCalendar());
  const disconnect = useConnectedAppsMutation((api) => api.disconnectCalendar());
  const l = link.data;
  const calendars = useConnectedAppsQuery((api) => (l?.connected ? api.calendars() : Promise.resolve([] as CalendarEntry[])), [l?.connected]);
  const [pick, setPick] = useState("");
  const [result, setResult] = useState<string | null>(null);
  // Back from Google: read the link again (the server checks the account once).
  const back = useRef(new URLSearchParams(location.search).get("connected") === "google_calendar");
  useEffect(() => {
    if (back.current) {
      back.current = false;
      link.reload();
    }
  }, []);
  const error = connect.error ?? choose.error ?? sync.error ?? disconnect.error;
  return (
    <Card id="ca-calendar" icon={<CalendarDays className="ic ic-md" aria-hidden="true" />} title={t("connectedApps.calendar.title")} sub={ws.kind === "funder" ? t("connectedApps.calendar.subFunder") : t("connectedApps.calendar.subApplicant")} state={l ? <State connected={l.connected} pending={l.status === "pending"} error={l.status === "error"} /> : null}>
      {link.status === "loading" && <Loading label={t("connectedApps.loading")} />}
      {link.status === "error" && <ErrorBanner error={link.error} onRetry={link.reload} />}
      {error !== null && <ErrorBanner error={error} />}
      {l && !l.connected && (
        <div className="row wrap" style={{ gap: "10px" }}>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={connect.state === "saving"}
            onClick={async () => {
              const next = await connect.run();
              if (!next) return;
              link.set(next);
              if (next.connectUrl) window.location.assign(next.connectUrl);
            }}
          >
            <Plug className="ic" aria-hidden="true" />
            {l.status === "pending" ? t("connectedApps.continueSignIn", { app: "Google Calendar" }) : t("connectedApps.calendar.connect")}
          </button>
          <span className="small muted">{t("connectedApps.calendar.yours")}</span>
        </div>
      )}
      {l?.connected && (
        <>
          <Field id="cal-choose" label={t("connectedApps.calendar.which")} help={t("connectedApps.calendar.whichHelp")}>
            <div className="row wrap" style={{ gap: "10px" }}>
              <select id="cal-choose" className="sel" value={pick || l.calendar?.id || ""} onChange={(e) => setPick(e.target.value)} style={{ maxWidth: "320px" }}>
                <option value="">{t("connectedApps.calendar.chooseCalendar")}</option>
                {(calendars.status === "ready" ? calendars.data : []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={!(pick || l.calendar?.id) || (pick || l.calendar?.id) === l.calendar?.id || choose.state === "saving"}
                onClick={async () => {
                  const out = await choose.run(pick);
                  if (!out) return;
                  link.set(out);
                  setResult(t("connectedApps.calendar.written", { count: out.result.created + out.result.updated }));
                }}
              >
                {t("connectedApps.calendar.useThis")}
              </button>
            </div>
          </Field>
          {l.calendar && (
            <div className="row wrap" style={{ gap: "10px" }}>
              <span className="small">
                {t("connectedApps.calendar.status", { count: l.events, calendar: l.calendar.name })}
                {l.lastSyncAt ? ` · ${t("connectedApps.calendar.lastSync", { when: when(l.lastSyncAt) })}` : ""}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={sync.state === "saving"}
                onClick={async () => {
                  const out = await sync.run();
                  if (!out) return;
                  link.set(out);
                  setResult(t("connectedApps.calendar.synced", { created: out.result.created, updated: out.result.updated, deleted: out.result.deleted }));
                }}
              >
                <RefreshCw className="ic" aria-hidden="true" />
                {t("connectedApps.calendar.syncNow")}
              </button>
            </div>
          )}
          {result && (
            <span className="notice" role="status">
              <CircleCheck className="ic" aria-hidden="true" />
              {result}
            </span>
          )}
          <p className="small muted" style={{ margin: 0 }}>
            {t("connectedApps.calendar.what")}
          </p>
          <div>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={disconnect.state === "saving"}
              onClick={async () => {
                const out = await disconnect.run();
                if (out) {
                  link.set(out);
                  setResult(null);
                }
              }}
            >
              <Unplug className="ic" aria-hidden="true" />
              {t("connectedApps.calendar.disconnect")}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------------- Drive, Salesforce

function SimpleAppCard({ app, title, sub, icon, children }: { app: WorkspaceApp; title: string; sub: string; icon: ReactNode; children?: ReactNode }) {
  const a = useWorkspaceApp(app);
  const c = a.q.data;
  return (
    <Card id={`ca-${app}`} icon={icon} title={title} sub={sub} state={c ? <State connected={c.connected} pending={c.status === "pending"} /> : null}>
      {a.q.status === "loading" && <Loading label={t("connectedApps.loading")} />}
      {a.q.status === "error" && <ErrorBanner error={a.q.error} onRetry={a.q.reload} />}
      {a.error !== null && <ErrorBanner error={a.error} />}
      {c && <ConnectRow app={app} c={c} start={() => void a.start()} stop={() => void a.stop()} busy={a.busy} label={title} />}
      {children}
    </Card>
  );
}

export default function ConnectedApps() {
  const ws = useCurrentWorkspace()!;
  const available = useAppConfig().available;
  const admin = (ws.member.role ?? "admin") === "admin";
  const slack = available?.slack === true && admin;
  const calendar = available?.googleCalendar === true;
  const drive = available?.googleDrive === true && admin && ws.kind === "applicant";
  const salesforce = available?.salesforce === true && admin;
  return (
    <Frame>
      <title>{t("connectedApps.pageTitle", { name: ws.name })}</title>
      <p className="muted" style={{ margin: 0 }}>
        {t("connectedApps.intro")}
      </p>
      {!slack && !calendar && !drive && !salesforce && (
        <Notice tone="neu" title={t("connectedApps.noneTitle")}>
          {admin ? t("connectedApps.noneBody") : t("connectedApps.noneMember")}
        </Notice>
      )}
      {slack && <SlackCard />}
      {calendar && <CalendarCard />}
      {drive && <SimpleAppCard app="google_drive" title="Google Drive" sub={t("connectedApps.drive.sub")} icon={<HardDrive className="ic ic-md" aria-hidden="true" />} />}
      {salesforce && (
        <SimpleAppCard app="salesforce" title="Salesforce" sub={t("connectedApps.salesforce.sub")} icon={<Cloud className="ic ic-md" aria-hidden="true" />}>
          <p className="small" style={{ margin: 0 }}>
            <Link to={`/w/${ws.handle}/import`}>{t("connectedApps.salesforce.import")}</Link>
          </p>
        </SimpleAppCard>
      )}
    </Frame>
  );
}

/** A card on the applicant's Settings page that leads to Connected apps. */
export function ConnectedAppsLinkCard() {
  const ws = useCurrentWorkspace()!;
  const available = useAppConfig().available;
  if (!available?.slack && !available?.googleCalendar && !available?.googleDrive && !available?.salesforce) return null;
  return (
    <section className="card" aria-labelledby="ca-link-h">
      <div className="card-h">
        <h3 id="ca-link-h" className="row" style={{ gap: "8px" }}>
          <BellRing className="ic" aria-hidden="true" />
          {t("connectedApps.title")}
        </h3>
      </div>
      <div className="card-b">
        <p className="small" style={{ marginTop: 0 }}>
          {t("connectedApps.linkCard")}
        </p>
        <Link to={`/w/${ws.handle}/settings/apps`} className="btn btn-sm btn-secondary">
          {t("connectedApps.open")}
        </Link>
      </div>
    </section>
  );
}
