// SPDX-License-Identifier: AGPL-3.0-only
// `/partners/moderation` (E4): the partner directory's queue, for the operators in
// DIRECTORY_MODERATORS (else GALLERY_MODERATORS). Each request shows the intermediary, how it is
// verified, its region and how many funds it runs; a moderator approves it (it appears at
// /partners) or declines it with a reason the intermediary reads. Nothing here is open to agents.
import { useState } from "react";
import { Link } from "react-router";
import { CircleCheck, CircleX, ShieldCheck } from "lucide-react";
import type { DirectoryQueueItem } from "../../api/loops.ts";
import { useLoopsMutation, useLoopsQuery } from "../../api/loopsHooks.ts";
import { VerificationBadge } from "../../components/status.tsx";
import { EmptyState, ErrorBanner, Loading, Notice } from "../../components/ui.tsx";
import { translator } from "../../i18n/index.tsx";
import { formatDate } from "../../lib/format.ts";
import { LoopsFrame } from "./loopsParts.tsx";

const t = translator("public");

function QueueCard({ item, onDone }: { item: DirectoryQueueItem; onDone: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const [declining, setDeclining] = useState(false);
  const approve = useLoopsMutation((api) => api.approveListing(item.id));
  const reject = useLoopsMutation((api, why: string) => api.rejectListing(item.id, why));
  const busy = approve.state === "saving" || reject.state === "saving";
  const titleId = `listing-${item.id}`;
  const name = item.partner?.name ?? t("partnersModeration.unknown");
  return (
    <li className="card" aria-labelledby={titleId}>
      <div className="card-h" style={{ flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <h2 id={titleId} style={{ fontSize: "17px", margin: 0 }}>
            {name}
          </h2>
          {item.partner && <VerificationBadge verification={item.partner.verification} />}
          <span className="small muted">{t("partnersModeration.asked", { date: formatDate(item.submittedAt) })}</span>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {(approve.error !== null || reject.error !== null) && <ErrorBanner error={approve.error ?? reject.error} />}
        <dl className="kv">
          <dt>{t("partnersModeration.region")}</dt>
          <dd>{item.region}</dd>
          <dt>{t("partnersModeration.funds")}</dt>
          <dd>{t("partners.fundCount", { count: item.funds })}</dd>
          {item.partner && (
            <>
              <dt>{t("partnersModeration.publicPage")}</dt>
              <dd>
                <Link to={`/f/${item.partner.handle}`}>{t("partnersModeration.publicPageOf", { name: item.partner.name })}</Link>
              </dd>
            </>
          )}
        </dl>
        {!item.eligible && <Notice tone="warn" title={t("partnersModeration.notEligible")} />}
        {declining && (
          <div className="fld">
            <label className="lbl" htmlFor={`${titleId}-reason`}>
              {t("partnersModeration.whyDeclined")}
            </label>
            <textarea className="ta" id={`${titleId}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} />
            <span className="help">{t("partnersModeration.whyDeclinedHelp")}</span>
          </div>
        )}
      </div>
      <div className="card-f" style={{ justifyContent: "flex-end" }}>
        {declining ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setDeclining(false)} disabled={busy}>
              {t("partnersModeration.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy || reason.trim().length < 3}
              onClick={async () => {
                if (await reject.run(reason.trim())) onDone(t("partnersModeration.declinedDone", { name }));
              }}
            >
              <CircleX className="ic" aria-hidden="true" />
              {t("partnersModeration.decline")}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setDeclining(true)} disabled={busy}>
              <CircleX className="ic" aria-hidden="true" />
              {t("partnersModeration.declineStart")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !item.eligible}
              onClick={async () => {
                if (await approve.run()) onDone(t("partnersModeration.approvedDone", { name }));
              }}
            >
              <CircleCheck className="ic" aria-hidden="true" />
              {t("partnersModeration.approve")}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export default function PartnersModeration() {
  const moderator = useLoopsQuery((api) => api.isDirectoryModerator(), []);
  const queue = useLoopsQuery((api) => (moderator.status === "ready" && moderator.data ? api.directoryQueue() : Promise.resolve([] as DirectoryQueueItem[])), [moderator.status, moderator.data]);
  const [note, setNote] = useState<string | null>(null);
  return (
    <LoopsFrame>
      <title>{t("partnersModeration.pageTitle")}</title>
      <div className="wrap-c" style={{ display: "flex", flexDirection: "column", gap: "16px", paddingTop: "28px", paddingBottom: "48px" }}>
        <nav aria-label={t("partnersModeration.breadcrumb")} className="crumbs">
          <Link to="/partners">{t("partners.title")}</Link>
        </nav>
        <h1 style={{ fontSize: "28px", color: "var(--og-navy-dark)" }} className="row">
          <ShieldCheck className="ic ic-lg" aria-hidden="true" />
          {t("partnersModeration.title")}
        </h1>
        {moderator.status === "loading" && <Loading />}
        {moderator.status === "error" && <ErrorBanner error={moderator.error} onRetry={moderator.reload} />}
        {moderator.status === "ready" && !moderator.data && (
          <Notice tone="neu" title={t("partnersModeration.onlyModerators")}>
            {t("partnersModeration.onlyModeratorsNote")}
          </Notice>
        )}
        {moderator.status === "ready" && moderator.data && (
          <>
            <p className="muted">{t("partnersModeration.intro")}</p>
            {note && (
              <Notice tone="ok" title={t("partnersModeration.done")}>
                {note}
              </Notice>
            )}
            {queue.status === "loading" && <Loading label={t("partnersModeration.loading")} />}
            {queue.status === "error" && <ErrorBanner error={queue.error} onRetry={queue.reload} />}
            {queue.status === "ready" &&
              (queue.data.length === 0 ? (
                <EmptyState icon={ShieldCheck} title={t("partnersModeration.nothingWaiting")} />
              ) : (
                <ul aria-label={t("partnersModeration.waiting")} style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "16px" }}>
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
    </LoopsFrame>
  );
}
