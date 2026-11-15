// SPDX-License-Identifier: AGPL-3.0-only
// "Share on social media": mounted with one line on the opportunity's Publish step, the funder's
// award screen and the grantee's award screen. Hidden when social posting is not set up on this
// server; never offers the composer for an award that is not publicly listed; links to
// Settings › Social accounts when no account is connected yet. Below it, the reach report.
import { useState } from "react";
import { Link } from "react-router";
import { PenLine, Share2 } from "lucide-react";
import { ApiError } from "../api/client.ts";
import type { SocialSubject } from "../api/social.ts";
import { useSocialQuery } from "../api/socialHooks.ts";
import { useCurrentWorkspace } from "../app/workspace.tsx";
import { PostComposer } from "./PostComposer.tsx";
import { ReachPanel } from "./ReachPanel.tsx";
import { ErrorBanner, Notice } from "./ui.tsx";

export function SocialPanel({ subject }: { subject: SocialSubject }) {
  const ws = useCurrentWorkspace();
  const [composing, setComposing] = useState(0);
  const q = useSocialQuery(
    async (api) => {
      const settings = await api.settings();
      if (!settings) return null;
      const [draft, reach] = await Promise.all([api.draft(subject), api.reach(subject)]);
      return { settings, draft, reach };
    },
    [subject.type, subject.id],
  );
  if (!ws || q.status === "loading" || (q.status === "ready" && !q.data)) return null;
  // A record this person cannot see, or a server without the feature: say nothing.
  if (q.status === "error" && q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403)) return null;
  if (q.status === "ready" && q.data && subject.type === "award" && !q.data.draft.shareable && q.data.reach.posts.length === 0) return null;

  const settingsPath = `/w/${ws.handle}/settings/social`;
  return (
    <section className="card" aria-labelledby={`social-${subject.id}`} style={{ boxShadow: "none" }}>
      <div className="card-h">
        <div>
          <h3 id={`social-${subject.id}`} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Share2 className="ic" aria-hidden="true" />
            Share on social media
          </h3>
          <p className="small muted">Post to your own accounts through Zernio. You see the exact post before it goes out, and nothing is posted until you press Post.</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {q.status === "error" && <ErrorBanner error={q.error} onRetry={q.reload} title="Social posting could not be loaded" />}
        {q.status === "ready" && q.data && (
          <>
            {!q.data.draft.shareable ? (
              <Notice tone="neu" title={q.data.draft.reason ?? "Not offered for posting"} />
            ) : q.data.settings.accounts.length === 0 ? (
              <Notice tone="info" title="No social accounts connected yet">
                {q.data.settings.canConnect ? (
                  <Link to={settingsPath}>Connect an account</Link>
                ) : (
                  <>
                    A workspace admin connects accounts in <Link to={settingsPath}>Settings › Social accounts</Link>.
                  </>
                )}
              </Notice>
            ) : q.data.settings.canPost ? (
              <div className="row wrap" style={{ gap: "8px", alignItems: "center" }}>
                <button type="button" className="btn btn-primary" onClick={() => setComposing((n) => n + 1)}>
                  <PenLine className="ic" aria-hidden="true" />
                  Write a post
                </button>
                <span className="small muted">
                  To {q.data.settings.accounts.map((a) => a.label).join(", ")}. <Link to={settingsPath}>Manage accounts</Link>
                </span>
              </div>
            ) : (
              <p className="small muted">Admins and editors can post from here.</p>
            )}
            {q.data.reach.posts.length > 0 && <ReachPanel reach={q.data.reach} subjectType={subject.type} />}
            {composing > 0 && q.data.draft.shareable && (
              // A fresh composer (and a fresh Idempotency-Key) each time it is opened.
              <PostComposer key={composing} open onClose={() => setComposing(0)} draft={q.data.draft} settings={q.data.settings} onPosted={() => q.reload()} />
            )}
          </>
        )}
      </div>
    </section>
  );
}
