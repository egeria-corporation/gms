// SPDX-License-Identifier: AGPL-3.0-only
// Notifications for the signed-in person, grouped by workspace. Each one opens the record it is
// about; reading is per person and per workspace.
import { useState } from "react";
import { Link } from "react-router";
import { Award, Bell, Bot, Building, ClipboardCheck, FileText, Landmark, Send, Star, type LucideIcon } from "lucide-react";
import type { MemberNotification, NotificationList } from "../../api/applicantMore.ts";
import { useMoreApi, useMoreQuery } from "../../api/applicantMoreHooks.ts";
import type { MeWorkspace } from "../../api/client.ts";
import { useServices } from "../../app/services.tsx";
import { AccountShell } from "../../components/AccountShell.tsx";
import { timeAgo } from "../../components/applicant.tsx";
import { EmptyState, ErrorBanner, Loading } from "../../components/ui.tsx";

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
};

/** The screen a notification is about, in the workspace it belongs to. */
export function hrefFor(n: MemberNotification, ws: MeWorkspace): string {
  const base = `/w/${ws.handle}`;
  const funder = ws.kind === "funder";
  if (n.category === "approval") return funder ? `${base}/approvals` : `${base}/team`;
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
  const markAll = async (list: NotificationList) => {
    const r = await api.markRead({ all: true }, ws.id);
    onCount(ws.id, r.unread);
    query.set({ unread: r.unread, items: list.items.map((n) => ({ ...n, read: true })) });
  };
  const markOne = async (list: NotificationList, id: string) => {
    const r = await api.markRead({ ids: [id] }, ws.id);
    onCount(ws.id, r.unread);
    query.set({ unread: r.unread, items: list.items.map((n) => (n.id === id ? { ...n, read: true } : n)) });
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
          <span className="role">{ws.kind === "funder" ? "Funder" : "Applicant"}</span>
        </div>
        <div className="row" style={{ gap: "10px" }}>
          {list && <span className="muted small">{list.unread > 0 ? `${list.unread} new` : "All read"}</span>}
          {list && list.unread > 0 && (
            <button className="btn btn-sm btn-secondary" type="button" onClick={() => void markAll(list)}>
              Mark all read<span className="sr"> in {ws.name}</span>
            </button>
          )}
        </div>
      </div>
      {query.status === "loading" && (
        <div style={{ padding: "0 20px" }}>
          <Loading label="Loading notifications" />
        </div>
      )}
      {query.status === "error" && (
        <div style={{ padding: "16px 20px" }}>
          <ErrorBanner error={query.error} onRetry={query.reload} />
        </div>
      )}
      {list && items.length === 0 && <p className="small muted" style={{ padding: "16px 20px" }}>{filter === "unread" ? "Nothing unread here." : "Nothing has happened here yet."}</p>}
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
                      {n.title}
                    </Link>
                    {n.message ? <span> {n.message}</span> : null}
                  </div>
                  <div className="small muted row" style={{ gap: "8px", marginTop: "2px", flexWrap: "wrap" }}>
                    <span>{timeAgo(n.at)}</span>
                    <span aria-hidden="true">·</span>
                    <span style={{ textTransform: "capitalize" }}>{n.category}</span>
                    {!n.read && <span className="tag">Unread</span>}
                  </div>
                </div>
                {!n.read ? (
                  <button className="btn btn-sm btn-ghost" type="button" onClick={() => void markOne(list, n.id)}>
                    Mark read<span className="sr">: {n.title}</span>
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
      <title>Notifications — OpenGrants GMS</title>
      <AccountShell active="notifications">
        <div className="ph">
          <div>
            <div className="title">
              <h1>Notifications</h1>
              <span className="bdg bdg-info" role="status">
                <Bell className="ic" aria-hidden="true" />
                {unread} unread
              </span>
            </div>
            <div className="meta">
              <span>Grouped by workspace. Each one opens the record it refers to.</span>
              <span aria-hidden="true">·</span>
              <span>Choose what reaches you in each workspace's settings.</span>
            </div>
          </div>
          <div className="actions">
            <div className="seg" role="group" aria-label="Filter">
              <button type="button" className={filter === "all" ? "on" : undefined} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
                All
              </button>
              <button type="button" className={filter === "unread" ? "on" : undefined} aria-pressed={filter === "unread"} onClick={() => setFilter("unread")}>
                Unread
              </button>
            </div>
          </div>
        </div>
        {meState.status === "loading" && <Loading label="Loading your workspaces" />}
        {meState.status === "error" && <ErrorBanner error={meState.error} onRetry={reloadMe} />}
        {meState.status === "ready" && meState.me.workspaces.length === 0 && (
          <div className="card">
            <EmptyState icon={Bell} title="No workspaces yet" actions={<Link to="/workspaces" className="btn btn-primary">Open workspaces</Link>}>
              Notifications appear once you belong to a funder or applicant workspace.
            </EmptyState>
          </div>
        )}
        {meState.status === "ready" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "960px" }}>
            {meState.me.workspaces.map((ws) => (
              <Group key={ws.id} ws={ws} filter={filter} onCount={onCount} />
            ))}
          </div>
        )}
      </AccountShell>
    </>
  );
}
