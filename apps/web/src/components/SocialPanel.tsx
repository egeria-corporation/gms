// SPDX-License-Identifier: AGPL-3.0-only
// "Share on social media": mounted with one line on the opportunity's Publish step, the funder's
// award screen and the grantee's award screen. Hidden when social posting is not set up on this
// server; never offers the composer for an award that is not publicly listed; links to
// Settings › Social accounts when no account is connected yet. Below it, the reach report.
// v1.12.0: a call's "Two weeks left" prompt (Post a reminder, or Dismiss; the notification opens
// this panel with `?compose=reminder`), and on the funder's award screen "Meet our grantees", a
// post about the award's program. Nothing posts without the person's click on Post.
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { BellRing, PenLine, Share2, Users } from "lucide-react";
import { ApiError } from "../api/client.ts";
import type { SocialDraft, SocialSubject } from "../api/social.ts";
import { useSocialMutation, useSocialQuery } from "../api/socialHooks.ts";
import { useCurrentWorkspace } from "../app/workspace.tsx";
import { PostComposer } from "./PostComposer.tsx";
import { ReachPanel } from "./ReachPanel.tsx";
import { ErrorBanner, Notice } from "./ui.tsx";

import { formatDateAs } from "../lib/format.ts";
import { translator } from "../i18n/index.tsx";

const t = translator("shared");
export function SocialPanel({ subject }: { subject: SocialSubject }) {
  const ws = useCurrentWorkspace();
  const [search] = useSearchParams();
  const [composing, setComposing] = useState(0);
  // "Meet our grantees": the program's draft, once asked for.
  const [meet, setMeet] = useState<SocialDraft | null>(null);
  const opened = useRef(false);
  const q = useSocialQuery(
    async (api) => {
      const settings = await api.settings();
      if (!settings) return null;
      const [draft, reach] = await Promise.all([api.draft(subject), api.reach(subject)]);
      return { settings, draft, reach };
    },
    [subject.type, subject.id],
  );
  const dismiss = useSocialMutation((api, id: string) => api.dismissReminder(id));
  const program = useSocialMutation((api, id: string) => api.draft({ type: "program", id }));
  const data = q.status === "ready" ? q.data : null;
  const canWrite = !!data && data.draft.shareable && data.settings.accounts.length > 0 && data.settings.canPost;

  // The notification's link opens the composer on the reminder, once.
  useEffect(() => {
    if (!opened.current && canWrite && data?.draft.reminder && search.get("compose") === "reminder") {
      opened.current = true;
      setComposing((n) => n + 1);
    }
  }, [canWrite, data?.draft.reminder, search]);

  if (!ws || q.status === "loading" || (q.status === "ready" && !q.data)) return null;
  // A record this person cannot see, or a server without the feature: say nothing.
  if (q.status === "error" && q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403)) return null;
  if (q.status === "ready" && q.data && subject.type === "award" && !q.data.draft.shareable && q.data.reach.posts.length === 0) return null;

  const settingsPath = `/w/${ws.handle}/settings/social`;
  const reminder = data?.draft.reminder ?? null;
  const openMeet = async () => {
    if (!data?.draft.program) return;
    const d = await program.run(data.draft.program.id);
    if (d) setMeet(d);
  };
  const doDismiss = async () => {
    if (!reminder) return;
    if (await dismiss.run(reminder.id)) q.reload();
  };
  return (
    <section className="card" aria-labelledby={`social-${subject.id}`} style={{ boxShadow: "none" }}>
      <div className="card-h">
        <div>
          <h3 id={`social-${subject.id}`} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Share2 className="ic" aria-hidden="true" />
            {t("socialPanel.shareOnSocialMedia")}
          </h3>
          <p className="small muted">{t("socialPanel.postToYourOwnAccounts")}</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {q.status === "error" && <ErrorBanner error={q.error} onRetry={q.reload} title={t("socialPanel.socialPostingCouldNotBe")} />}
        {data && (
          <>
            {reminder && data.draft.shareable && (
              <div className="bnr bnr-info" role="group" aria-labelledby={`reminder-${subject.id}`}>
                <BellRing className="ic" aria-hidden="true" />
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div className="t" id={`reminder-${subject.id}`}>
                    {t("socialPanel.twoWeeksLeft")}
                  </div>
                  <div className="d">{t("socialPanel.deadlineIsPostAReminder", { date: formatDateAs(reminder.deadline, "medium") })}</div>
                  <div className="row wrap" style={{ gap: "8px" }}>
                    {canWrite && (
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => setComposing((n) => n + 1)}>
                        <PenLine className="ic" aria-hidden="true" />
                        {t("socialPanel.postAReminder")}
                      </button>
                    )}
                    {data.settings.canConnect && (
                      <button type="button" className="btn btn-sm btn-secondary" disabled={dismiss.state === "saving"} onClick={() => void doDismiss()}>
                        {t("socialPanel.dismissReminder")}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
            {dismiss.error !== null && <ErrorBanner error={dismiss.error} title={t("socialPanel.reminderNotDismissed")} />}
            {!data.draft.shareable ? (
              <Notice tone="neu" title={data.draft.reason ?? t("socialPanel.notOfferedForPosting")} />
            ) : data.settings.accounts.length === 0 ? (
              <Notice tone="info" title={t("socialPanel.noSocialAccountsConnectedYet")}>
                {data.settings.canConnect ? (
                  <Link to={settingsPath}>{t("socialPanel.connectAnAccount")}</Link>
                ) : (
                  <>
                    {t.rich("socialPanel.aWorkspaceAdminConnectsAccounts", { link: (chunks) => <Link to={settingsPath}>{chunks}</Link> })}
                  </>
                )}
              </Notice>
            ) : data.settings.canPost ? (
              <div className="row wrap" style={{ gap: "8px", alignItems: "center" }}>
                <button type="button" className="btn btn-primary" onClick={() => setComposing((n) => n + 1)}>
                  <PenLine className="ic" aria-hidden="true" />
                  {t("socialPanel.writeAPost")}
                </button>
                {data.draft.program && (
                  <button type="button" className="btn btn-secondary" disabled={program.state === "saving"} onClick={() => void openMeet()}>
                    <Users className="ic" aria-hidden="true" />
                    {t("socialPanel.meetOurGrantees")}
                  </button>
                )}
                <span className="small muted">
                  {t.rich("socialPanel.toManageAccounts", { join: data.settings.accounts.map((a) => a.label).join(", "), link: (chunks) => <Link to={settingsPath}>{chunks}</Link> })}
                </span>
              </div>
            ) : (
              <p className="small muted">{t("socialPanel.adminsAndEditorsCanPost")}</p>
            )}
            {program.error !== null && <ErrorBanner error={program.error} title={t("socialPanel.granteesCouldNotBeLoaded")} />}
            {meet && !meet.shareable && <Notice tone="neu" title={meet.reason ?? t("socialPanel.notOfferedForPosting")} />}
            {data.reach.posts.length > 0 && <ReachPanel reach={data.reach} subjectType={subject.type} />}
            {composing > 0 && data.draft.shareable && (
              // A fresh composer (and a fresh Idempotency-Key) each time it is opened.
              <PostComposer key={composing} open onClose={() => setComposing(0)} draft={data.draft} settings={data.settings} onPosted={() => q.reload()} />
            )}
            {meet?.shareable && <PostComposer key={`meet-${meet.subject.id}`} open onClose={() => setMeet(null)} draft={meet} settings={data.settings} onPosted={() => q.reload()} />}
          </>
        )}
      </div>
    </section>
  );
}
