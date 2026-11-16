// SPDX-License-Identifier: AGPL-3.0-only
// The reach report for one opportunity or award: each post with its status, where it went (with a
// link to it on the platform once it is out) and the counts Zernio reports; the totals; and, for
// an opportunity, the applications started from a shared link. Status is an icon and a label.
import { CircleCheck, CircleX, Clock, ExternalLink, Loader, TriangleExclamationPoint, type LucideIcon } from "lucide-react";
import type { SocialPost, SocialPostStatus, SocialReach } from "../api/social.ts";

import { intlLocale, translator } from "../i18n/index.tsx";

const tr = translator("shared");
const POST_STATUS: Record<SocialPostStatus, { icon: LucideIcon; label: string; tone: string }> = {
  sending: {
    icon: Loader,
    get label() {
      return tr("reachPanel.status.sending");
    },
    tone: "prog",
  },
  scheduled: {
    icon: Clock,
    get label() {
      return tr("reachPanel.status.scheduled");
    },
    tone: "info",
  },
  published: {
    icon: CircleCheck,
    get label() {
      return tr("reachPanel.status.published");
    },
    tone: "ok",
  },
  partial: {
    icon: TriangleExclamationPoint,
    get label() {
      return tr("reachPanel.status.partial");
    },
    tone: "warn",
  },
  failed: {
    icon: CircleX,
    get label() {
      return tr("reachPanel.status.failed");
    },
    tone: "dng",
  },
};
const ACCOUNT_STATUS: Record<SocialPost["accounts"][number]["status"], { icon: LucideIcon; label: string; tone: string }> = {
  sending: POST_STATUS.sending,
  scheduled: POST_STATUS.scheduled,
  published: POST_STATUS.published,
  failed: POST_STATUS.failed,
};

export function PostStatusBadge({ status }: { status: SocialPostStatus }) {
  const { icon: Icon, label, tone } = POST_STATUS[status] ?? POST_STATUS.sending;
  return (
    <span className={`bdg bdg-${tone}`}>
      <Icon className="ic" aria-hidden="true" />
      {label}
    </span>
  );
}

const num = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString(intlLocale()) : null);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(intlLocale(), { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");

function Counts({ m }: { m: SocialPost["metrics"] }) {
  const parts = [m.impressions !== null ? `${num(m.impressions)} impressions` : null, m.clicks !== null ? `${num(m.clicks)} clicks` : null, m.engagements !== null ? `${num(m.engagements)} engagements` : null].filter(Boolean);
  return <span className="small muted">{parts.length ? parts.join(" · ") : tr("reachPanel.noCountsFromZernioYet")}</span>;
}

export function ReachPanel({ reach, subjectType }: { reach: SocialReach; subjectType: "opportunity" | "award" }) {
  const t = reach.totals;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <h4 id="reach-title" style={{ fontSize: "14px" }}>
        {tr("reachPanel.reach")}
      </h4>
      <dl className="kv" aria-labelledby="reach-title">
        <dt>{tr("reachPanel.posts")}</dt>
        <dd>{num(t.posts)}</dd>
        <dt>{tr("reachPanel.impressions")}</dt>
        <dd>{num(t.impressions) ?? tr("reachPanel.notReported")}</dd>
        <dt>{tr("reachPanel.clicks")}</dt>
        <dd>{num(t.clicks) ?? tr("reachPanel.notReported")}</dd>
        <dt>{tr("reachPanel.engagements")}</dt>
        <dd>{num(t.engagements) ?? tr("reachPanel.notReported")}</dd>
        {subjectType === "opportunity" && (
          <>
            <dt>{tr("reachPanel.applicationsFromSocial")}</dt>
            <dd>{num(reach.applicationsFromSocial ?? 0)}</dd>
          </>
        )}
      </dl>
      <ul aria-label={tr("reachPanel.posts")} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
        {reach.posts.map((p) => (
          <li key={p.id} className="card card-b-tight" style={{ boxShadow: "none", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <div className="row wrap" style={{ gap: "8px", alignItems: "center" }}>
              <PostStatusBadge status={p.status} />
              <span className="small muted">{p.status === "scheduled" && p.scheduledFor ? tr("reachPanel.for", { scheduledFor: when(p.scheduledFor), value: p.timezone ? ` (${p.timezone})` : "" }) : tr("reachPanel.sent", { when: when(p.sentAt ?? p.createdAt) })}</span>
            </div>
            <ul aria-label={tr("reachPanel.accounts")} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
              {p.accounts.map((a) => {
                const s = ACCOUNT_STATUS[a.status] ?? ACCOUNT_STATUS.sending;
                return (
                  <li key={a.accountId} className="small" style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                    <span className="b">{a.label}</span>
                    {a.username && <span className="muted">{a.username}</span>}
                    <span className={`bdg bdg-${s.tone}`}>
                      <s.icon className="ic" aria-hidden="true" />
                      {s.label}
                    </span>
                    {a.url && (
                      <a href={a.url} target="_blank" rel="noopener noreferrer">
                        {tr("reachPanel.viewOn", { label: a.label })}
                        <ExternalLink className="ic" aria-hidden="true" />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
            {p.error && <span className="small">{p.error}</span>}
            <Counts m={p.metrics} />
          </li>
        ))}
      </ul>
    </div>
  );
}
