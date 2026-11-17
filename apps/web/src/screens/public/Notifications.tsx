// SPDX-License-Identifier: AGPL-3.0-only
// Notifications for the signed-in person, grouped by workspace. Each one opens the record it is
// about; reading is per person and per workspace.
import { useState } from "react";
import { Link } from "react-router";
import { Award, Bell, Bot, Building, ClipboardCheck, FileSpreadsheet, FileText, Landmark, Megaphone, Send, Star, type LucideIcon } from "lucide-react";
import type { MemberNotification, NotificationList } from "../../api/applicantMore.ts";
import { useMoreApi, useMoreQuery } from "../../api/applicantMoreHooks.ts";
import type { MeWorkspace } from "../../api/client.ts";
import { useServices } from "../../app/services.tsx";
import { AccountShell } from "../../components/AccountShell.tsx";
import { timeAgo } from "../../components/applicant.tsx";
import { EmptyState, ErrorBanner, Loading } from "../../components/ui.tsx";
import { DigestSettings } from "./digestSettings.tsx";

import { translator } from "../../i18n/index.tsx";

const t = translator("public");
const ICON: Record<MemberNotification["category"], { icon: LucideIcon; cls: string }> = {
  application: { icon: FileText, cls: "av-t" },
  decision: { icon: Star, cls: "av-t" },
  award: { icon: Award, cls: "av-t" },
  agreement: { icon: Send, cls: "" },
  payment: { icon: Landmark, cls: "" },
  requirement: { icon: ClipboardCheck, cls: "" },
  submission: { icon: ClipboardCheck, cls: "av-t" },
  organization: { icon: Building, cls: "av-g" },
  approval: { icon: Bot, cls: "av-a" },
  review: { icon: Star, cls: "" },
  agent: { icon: Bot, cls: "av-a" },
  report: { icon: FileSpreadsheet, cls: "" },
  // "Two weeks left: post a reminder?" (v1.12.0)
  social_reminder: { icon: Megaphone, cls: "av-t" },
};

/** The screen a notification is about, in the workspace it belongs to. */
export function hrefFor(n: MemberNotification, ws: MeWorkspace): string {
  const base = `/w/${ws.handle}`;
  const funder = ws.kind === "funder";
  if (n.category === "approval") return funder ? `${base}/approvals` : `${base}/team`;
  if (n.category === "report" && funder && n.subjectId) return `${base}/report-builder?file=${encodeURIComponent(n.subjectId)}`;
  if (n.type.startsWith("gallery.") && funder) return `${base}/forms`;
  // "Two weeks left": the call's Publish step, with the composer opened on the reminder.
  if (n.type === "social.reminder_prompt" && funder && n.subjectId) return `${base}/opportunities/${n.subjectId.startsWith("opp_") ? n.subjectId : `opp_${n.subjectId}`}/edit?compose=reminder#publish`;
  if (n.subjectType === "application" && n.subjectId) return `${base}/applications/${n.subjectId}`;
  if (n.subjectType === "award" && n.subjectId) return funder ? `${base}/awards/${n.subjectId}/agreement` : `${base}/grants/${n.subjectId}`;
  if (n.category === "submission" || n.category === "requirement") return funder ? `${base}/reporting` : `${base}/reports`;
  if (n.category === "payment") return funder ? `${base}/payments/due` : `${base}/grants`;
  if (n.category === "organization") return funder ? `${base}/grantees` : `${base}/organization`;
  return base;
}

type Filter = "all" | "unread";

function Group({ ws, filter, onCount }: { ws: MeWorkspace; filter: Filter; onCount: (id: string, unread: number) => void }) {
  const api = useMoreApi(ws.id);
  const query = useMoreQuery(
    async (a) => {
      const list = await a.notifications({ workspaceId: ws.id });
      onCount(ws.id, list.unread);
      return list;
    },
    [ws.id],
    ws.id,
  );
  // A failed "mark read" says so; before, the click simply did nothing.
  const [markError, setMarkError] = useState<unknown>(null);
  const markAll = async (list: NotificationList) => {
    setMarkError(null);
    try {
      const r = await api.markRead({ all: true }, ws.id);
      onCount(ws.id, r.unread);
      query.set({ unread: r.unread, items: list.items.map((n) => ({ ...n, read: true })) });
    } catch (error) {
      setMarkError(error);
    }
  };
  const markOne = async (list: NotificationList, id: string) => {
    setMarkError(null);
    try {
      const r = await api.markRead({ ids: [id] }, ws.id);
      onCount(ws.id, r.unread);
      query.set({ unread: r.unread, items: list.items.map((n) => (n.id === id ? { ...n, read: true } : n)) });
    } catch (error) {
      setMarkError(error);
    }
  };
  const list = query.status === "ready" ? query.data : null;
  const items = list ? (filter === "unread" ? list.items.filter((n) => !n.read) : list.items) : [];
  const headingId = `ntf-${ws.handle}`;
  return (
    <section className="card" aria-labelledby={headingId}>
      <div className="card-h">
        <div className="row" style={{ gap: "10px" }}>
          <span style={{ width: "4px", height: "20px", background: ws.kind === "funder" ? "var(--og-navy-dark)" : "var(--og-blue)", borderRadius: "2px" }} aria-hidden="true"></span>
          <h2 id={headingId} style={{ fontSize: "15px" }}>
            {ws.name}
          </h2>
          <span className="role">{ws.kind === "funder" ? t("notifications.funder") : t("notifications.applicant")}</span>
        </div>
        <div className="row" style={{ gap: "10px" }}>
          {list && <span className="muted small">{list.unread > 0 ? t("notifications.new", { unread: list.unread }) : t("notifications.allRead")}</span>}
          {list && list.unread > 0 && (
            <button className="btn btn-sm btn-secondary" type="button" aria-label={t("notifications.markAllReadIn", { name: ws.name })} onClick={() => void markAll(list)}>
              {t("notifications.markAllRead")}
            </button>
          )}
        </div>
      </div>
      {query.status === "loading" && (
        <div style={{ padding: "0 20px" }}>
          <Loading label={t("notifications.loadingNotifications")} />
        </div>
      )}
      {query.status === "error" && (
        <div style={{ padding: "16px 20px" }}>
          <ErrorBanner error={query.error} onRetry={query.reload} />
        </div>
      )}
      {markError !== null && (
        <div style={{ padding: "16px 20px 0" }}>
          <ErrorBanner error={markError} title={t("notifications.couldNotMarkAsRead")} />
        </div>
      )}
      {list && items.length === 0 && <p className="small muted" style={{ padding: "16px 20px" }}>{filter === "unread" ? t("notifications.nothingUnreadHere") : t("notifications.nothingHasHappenedHereYet")}</p>}
      {list && items.length > 0 && (
        <ul>
          {items.map((n) => {
            const look = ICON[n.category] ?? ICON.application;
            const Icon = look.icon;
            return (
              <li key={n.id} style={{ display: "grid", gridTemplateColumns: "36px minmax(0, 1fr) auto", gap: "14px", alignItems: "center", padding: "14px 20px", borderBottom: "1px solid var(--og-gray-100)", background: n.read ? undefined : "var(--og-gray-50)" }}>
                <span className={`av ${look.cls}`} aria-hidden="true">
                  <Icon className="ic" aria-hidden="true" />
                </span>
                <div style={{ minWidth: "0" }}>
                  <div>
                    <Link to={hrefFor(n, ws)} className="b" onClick={() => !n.read && void markOne(list, n.id)}>
                      {n.titleLocalized ?? n.title}
                    </Link>
                    {n.message ? <span> {n.message}</span> : null}
                  </div>
                  <div className="small muted row" style={{ gap: "8px", marginTop: "2px", flexWrap: "wrap" }}>
                    <span>{timeAgo(n.at)}</span>
                    <span aria-hidden="true">·</span>
                    <span style={{ textTransform: "capitalize" }}>{n.category}</span>
                    {!n.read && <span className="tag">{t("notifications.unread")}</span>}
                  </div>
                </div>
                {!n.read ? (
                  <button className="btn btn-sm btn-ghost" type="button" aria-label={t("notifications.markRead", { title: n.titleLocalized ?? n.title })} onClick={() => void markOne(list, n.id)}>
                    {t("notifications.markRead2")}
                  </button>
                ) : (
                  <span />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function Notifications() {
  const { meState, reloadMe } = useServices();
  const [filter, setFilter] = useState<Filter>("all");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const unread = Object.values(counts).reduce((s, n) => s + n, 0);
  const onCount = (id: string, n: number) => setCounts((prev) => (prev[id] === n ? prev : { ...prev, [id]: n }));
  return (
    <>
      <title>{t("notifications.notificationsOpengrantsGms")}</title>
      <AccountShell active="notifications">
        <div className="ph">
          <div>
            <div className="title">
              <h1>{t("notifications.notifications")}</h1>
              <span className="bdg bdg-info" role="status">
                <Bell className="ic" aria-hidden="true" />
                {t("notifications.unread2", { unread })}
              </span>
            </div>
            <div className="meta">
              <span>{t("notifications.groupedByWorkspaceEachOne")}</span>
              <span aria-hidden="true">·</span>
              <span>{t("notifications.chooseWhatReachesYouIn")}</span>
            </div>
          </div>
          <div className="actions">
            <div className="seg" role="group" aria-label={t("notifications.filter")}>
              <button type="button" className={filter === "all" ? "on" : undefined} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
                {t("notifications.all")}
              </button>
              <button type="button" className={filter === "unread" ? "on" : undefined} aria-pressed={filter === "unread"} onClick={() => setFilter("unread")}>
                {t("notifications.unread")}
              </button>
            </div>
          </div>
        </div>
        {meState.status === "loading" && <Loading label={t("notifications.loadingYourWorkspaces")} />}
        {meState.status === "error" && <ErrorBanner error={meState.error} onRetry={reloadMe} />}
        {meState.status === "ready" && meState.me.workspaces.length === 0 && (
          <div className="card">
            <EmptyState icon={Bell} title={t("notifications.noWorkspacesYet")} actions={<Link to="/workspaces" className="btn btn-primary">{t("notifications.openWorkspaces")}</Link>}>
              {t("notifications.notificationsAppearOnceYouBelong")}
            </EmptyState>
          </div>
        )}
        {meState.status === "ready" && (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.8fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {meState.me.workspaces.map((ws) => (
                <Group key={ws.id} ws={ws} filter={filter} onCount={onCount} />
              ))}
              {meState.me.workspaces.length > 0 && unread === 0 && filter === "unread" ? (
                <div className="card">
                  <EmptyState icon={Bell} title={t("notifications.youReCaughtUp")}>
                    {t("notifications.nothingUnreadInAnyWorkspace")}
                  </EmptyState>
                </div>
              ) : null}
            </div>
            <DigestSettings workspaces={meState.me.workspaces} />
          </div>
        )}
      </AccountShell>
    </>
  );
}
