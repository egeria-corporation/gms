// SPDX-License-Identifier: AGPL-3.0-only
// The reach report for one opportunity or award: each post with its status, where it went (with a
// link to it on the platform once it is out) and the counts Zernio reports; the totals; and, for
// an opportunity, the applications started from a shared link. Status is an icon and a label.
import { CircleCheck, CircleX, Clock, ExternalLink, Loader, TriangleExclamationPoint, type LucideIcon } from "lucide-react";
import type { SocialPost, SocialPostStatus, SocialReach } from "../api/social.ts";

const POST_STATUS: Record<SocialPostStatus, { icon: LucideIcon; label: string; tone: string }> = {
  sending: { icon: Loader, label: "Sending", tone: "prog" },
  scheduled: { icon: Clock, label: "Scheduled", tone: "info" },
  published: { icon: CircleCheck, label: "Published", tone: "ok" },
  partial: { icon: TriangleExclamationPoint, label: "Partly published", tone: "warn" },
  failed: { icon: CircleX, label: "Failed", tone: "dng" },
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

const num = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString("en-US") : null);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");

function Counts({ m }: { m: SocialPost["metrics"] }) {
  const parts = [m.impressions !== null ? `${num(m.impressions)} impressions` : null, m.clicks !== null ? `${num(m.clicks)} clicks` : null, m.engagements !== null ? `${num(m.engagements)} engagements` : null].filter(Boolean);
  return <span className="small muted">{parts.length ? parts.join(" · ") : "No counts from Zernio yet"}</span>;
}

export function ReachPanel({ reach, subjectType }: { reach: SocialReach; subjectType: "opportunity" | "award" }) {
  const t = reach.totals;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <h4 id="reach-title" style={{ fontSize: "14px" }}>
        Reach
      </h4>
      <dl className="kv" aria-labelledby="reach-title">
        <dt>Posts</dt>
        <dd>{num(t.posts)}</dd>
        <dt>Impressions</dt>
        <dd>{num(t.impressions) ?? "Not reported"}</dd>
        <dt>Clicks</dt>
        <dd>{num(t.clicks) ?? "Not reported"}</dd>
        <dt>Engagements</dt>
        <dd>{num(t.engagements) ?? "Not reported"}</dd>
        {subjectType === "opportunity" && (
          <>
            <dt>Applications from social</dt>
            <dd>{num(reach.applicationsFromSocial ?? 0)}</dd>
          </>
        )}
      </dl>
      <ul aria-label="Posts" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
        {reach.posts.map((p) => (
          <li key={p.id} className="card card-b-tight" style={{ boxShadow: "none", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <div className="row wrap" style={{ gap: "8px", alignItems: "center" }}>
              <PostStatusBadge status={p.status} />
              <span className="small muted">{p.status === "scheduled" && p.scheduledFor ? `For ${when(p.scheduledFor)}${p.timezone ? ` (${p.timezone})` : ""}` : `Sent ${when(p.sentAt ?? p.createdAt)}`}</span>
            </div>
            <ul aria-label="Accounts" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
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
                        View on {a.label}
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
