// SPDX-License-Identifier: AGPL-3.0-only
// `/gallery/moderation` — the gallery moderators' queue (operators listed in GALLERY_MODERATORS).
// Each submission shows what was taken out before it was sent, who sent it and a preview of its
// content; a moderator approves it (it becomes public) or declines it with a reason the author
// reads. Nothing here is available to agents.
import { useState } from "react";
import { Link } from "react-router";
import { CircleCheck, CircleX, ShieldCheck } from "lucide-react";
import type { GalleryQueueItem } from "../../api/gallery.ts";
import { useGalleryMutation, useGalleryQuery } from "../../api/galleryHooks.ts";
import { EmptyState, ErrorBanner, Loading, Notice } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";
import { AuthorLine, GalleryFrame, KindBadge, SnapshotPreview, StrippedList, TagList } from "./galleryParts.tsx";

import { translator } from "../../i18n/index.tsx";


const t = translator("public");
function QueueCard({ item, onDone }: { item: GalleryQueueItem; onDone: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const [declining, setDeclining] = useState(false);
  const approve = useGalleryMutation((api) => api.approve(item.id));
  const reject = useGalleryMutation((api, why: string) => api.reject(item.id, why));
  const busy = approve.state === "saving" || reject.state === "saving";
  const titleId = `queue-${item.id}`;
  return (
    <li className="card" aria-labelledby={titleId}>
      <div className="card-h" style={{ flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <KindBadge kind={item.kind} />
          <h2 id={titleId} style={{ fontSize: "17px", margin: 0 }}>
            {item.title}
          </h2>
          <AuthorLine author={item.author} />
          <span className="small muted">{t("galleryModeration.sent", { createdAt: formatDate(item.createdAt) })}</span>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {(approve.error !== null || reject.error !== null) && <ErrorBanner error={approve.error ?? reject.error} />}
        <p>{item.summary}</p>
        <TagList tags={item.tags} />
        <div>
          <h3 style={{ fontSize: "14px" }}>{t("galleryModeration.takenOutBeforeItWas")}</h3>
          <StrippedList stripped={item.stripped} />
        </div>
        <details>
          <summary className="b">{t("galleryModeration.previewTheContent")}</summary>
          <div style={{ marginTop: "12px" }}>
            <SnapshotPreview snapshot={item.snapshot} />
          </div>
        </details>
        <p className="small muted">{t("galleryModeration.checkThatItNamesNo")}</p>
        {declining && (
          <div className="fld">
            <label className="lbl" htmlFor={`${titleId}-reason`}>
              {t("galleryModeration.whyItIsDeclined")}
            </label>
            <textarea className="ta" id={`${titleId}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} />
            <span className="help">{t("galleryModeration.theAuthorReadsThisBeside")}</span>
          </div>
        )}
      </div>
      <div className="card-f" style={{ justifyContent: "flex-end" }}>
        {declining ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setDeclining(false)} disabled={busy}>
              {t("galleryModeration.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy || reason.trim().length < 3}
              onClick={async () => {
                if (await reject.run(reason.trim())) onDone(t("galleryModeration.declinedTheAuthorCanSee", { title: item.title }));
              }}
            >
              <CircleX className="ic" aria-hidden="true" />
              {t("galleryModeration.decline")}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setDeclining(true)} disabled={busy}>
              <CircleX className="ic" aria-hidden="true" />
              {t("galleryModeration.decline2")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={async () => {
                const out = await approve.run();
                if (out) onDone(t("galleryModeration.publishedAtTemplates", { title: item.title, slug: out.item.slug }));
              }}
            >
              <CircleCheck className="ic" aria-hidden="true" />
              {t("galleryModeration.approveAndPublish")}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export default function GalleryModeration() {
  const moderator = useGalleryQuery((api) => api.isModerator(), []);
  const queue = useGalleryQuery((api) => (moderator.status === "ready" && moderator.data ? api.queue() : Promise.resolve([] as GalleryQueueItem[])), [moderator.status, moderator.data]);
  const [note, setNote] = useState<string | null>(null);
  return (
    <GalleryFrame>
      <title>{t("galleryModeration.reviewSharedTemplatesOpengrantsGms")}</title>
      <div className="wrap-c" style={{ display: "flex", flexDirection: "column", gap: "16px", paddingTop: "28px", paddingBottom: "48px" }}>
        <nav aria-label={t("galleryModeration.breadcrumb")} className="crumbs">
          <Link to="/templates">{t("galleryModeration.templateGallery")}</Link>
        </nav>
        <h1 style={{ fontSize: "28px", color: "var(--og-navy-dark)" }} className="row">
          <ShieldCheck className="ic ic-lg" aria-hidden="true" />
          {t("galleryModeration.reviewSharedTemplates")}
        </h1>
        {moderator.status === "loading" && <Loading />}
        {moderator.status === "error" && <ErrorBanner error={moderator.error} onRetry={moderator.reload} />}
        {moderator.status === "ready" && !moderator.data && (
          <Notice tone="neu" title={t("galleryModeration.onlyTheGallerySModerators")}>
            {t("galleryModeration.templatesSharedByFundersAre")}
          </Notice>
        )}
        {moderator.status === "ready" && moderator.data && (
          <>
            <p className="muted">{t("galleryModeration.nothingIsPublicUntilYou")}</p>
            {note && (
              <Notice tone="ok" title={t("galleryModeration.done")}>
                {note}
              </Notice>
            )}
            {queue.status === "loading" && <Loading label={t("galleryModeration.loadingTheQueue")} />}
            {queue.status === "error" && <ErrorBanner error={queue.error} onRetry={queue.reload} />}
            {queue.status === "ready" &&
              (queue.data.length === 0 ? (
                <EmptyState icon={ShieldCheck} title={t("galleryModeration.nothingWaitingForReview")} />
              ) : (
                <ul aria-label={t("galleryModeration.waitingForReview")} style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "16px" }}>
                  {queue.data.map((item) => (
                    <QueueCard
                      key={item.id}
                      item={item}
                      onDone={(message) => {
                        setNote(message);
                        queue.set(queue.data.filter((q) => q.id !== item.id));
                      }}
                    />
                  ))}
                </ul>
              ))}
          </>
        )}
      </div>
    </GalleryFrame>
  );
}
