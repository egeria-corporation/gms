// SPDX-License-Identifier: AGPL-3.0-only
// "Share this call", on the opportunity's Publish step (mounted with one line): the open-call
// feeds the call is in, with their addresses and the switch that takes it out; whether it is in
// the feed OpenGrants can pull; and Philanthropy News Digest, which a person who edits calls
// previews and sends, once per call, by the date PND's four weeks allow. Below, the applications
// started from those links. Status is always an icon with words (Notice).
import { useState } from "react";
import { Megaphone, Send } from "lucide-react";
import type { Opportunity } from "../../api/types.ts";
import type { PndBlock, PndPreview, Syndication } from "../../api/syndication.ts";
import { useSyndicationMutation, useSyndicationQuery } from "../../api/syndicationHooks.ts";
import { CopyButton } from "../../components/CopyButton.tsx";
import { ErrorBanner, Notice } from "../../components/ui.tsx";
import { formatDateAs } from "../../lib/format.ts";
import { t, useFunderMessages } from "./i18n.ts";

const BLOCKED_TITLE: Record<Exclude<PndBlock, "sent" | "too_late">, () => string> = {
  person_only: () => t("sharePanel.pnd.blocked.personOnly"),
  role: () => t("sharePanel.pnd.blocked.role"),
  not_listed: () => t("sharePanel.pnd.blocked.notListed"),
  closed: () => t("sharePanel.pnd.blocked.closed"),
  mail_not_configured: () => t("sharePanel.pnd.blocked.mailNotConfigured"),
  no_reply_to: () => t("sharePanel.pnd.blocked.noReplyTo"),
  sending: () => t("sharePanel.pnd.blocked.sending"),
};

const day = (d: string) => formatDateAs(d, "medium");

function Feeds({ s, onChange, saving }: { s: Syndication; onChange: (on: boolean) => void; saving: boolean }) {
  const formats = [
    { key: "rss", label: t("sharePanel.feeds.rss"), what: t("sharePanel.feeds.rssWhat"), url: s.feeds.urls.rss },
    { key: "json", label: t("sharePanel.feeds.json"), what: t("sharePanel.feeds.jsonWhat"), url: s.feeds.urls.json },
    { key: "csv", label: t("sharePanel.feeds.csv"), what: t("sharePanel.feeds.csvWhat"), url: s.feeds.urls.csv },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <h4 id="share-feeds">{t("sharePanel.feeds.heading")}</h4>
      <p className="small muted">{t("sharePanel.feeds.help")}</p>
      {s.feeds.listed ? <Notice tone="ok" title={t("sharePanel.feeds.listed")} /> : !s.feeds.on ? <Notice tone="neu" title={t("sharePanel.feeds.off")} /> : <Notice tone="neu" title={t("sharePanel.feeds.notListed")} />}
      <label className="cb" htmlFor="share-feeds-on">
        <input type="checkbox" id="share-feeds-on" checked={s.feeds.on} disabled={saving} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: "3px" }} />
        <span>
          <span className="b">{t("sharePanel.feeds.include")}</span>
          <span className="help" style={{ display: "block" }}>
            {t("sharePanel.feeds.includeHelp")}
          </span>
        </span>
      </label>
      <dl className="kv" aria-labelledby="share-feeds">
        {formats.map((f) => (
          <div key={f.key} style={{ display: "contents" }}>
            <dt>{f.label}</dt>
            <dd className="row wrap" style={{ gap: "8px", alignItems: "center" }}>
              <code className="mono" style={{ fontSize: "12px", overflowWrap: "anywhere" }}>
                {f.url}
              </code>
              <CopyButton value={f.url} what={f.what} className="btn btn-ghost btn-sm" />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function OpenGrants({ s }: { s: Syndication }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <h4>{t("sharePanel.openGrants.heading")}</h4>
      {s.openGrants.inFeed ? (
        <Notice tone="ok" title={t("sharePanel.openGrants.inFeed")}>
          {s.openGrants.pulling ? t("sharePanel.openGrants.pulling") : t("sharePanel.openGrants.notPulling")}
        </Notice>
      ) : !s.openGrants.on ? (
        <Notice tone="neu" title={t("sharePanel.openGrants.off")}>
          {t("sharePanel.openGrants.offHelp")}
        </Notice>
      ) : (
        <Notice tone="neu" title={t("sharePanel.openGrants.notListed")} />
      )}
      <p className="small">
        <a href={s.openGrants.feedUrl}>{t("sharePanel.openGrants.feedLink")}</a>
      </p>
    </div>
  );
}

function PndStatus({ s }: { s: Syndication }) {
  const p = s.pnd;
  if (p.sent) return <Notice tone="ok" title={t("sharePanel.pnd.sent", { date: day(p.sent.sentAt) })}>{t("sharePanel.pnd.sentBody", { replyTo: p.sent.replyTo })}</Notice>;
  if (p.blocked === "too_late") return <Notice tone="warn" title={t("sharePanel.pnd.tooLate")}>{t("sharePanel.pnd.tooLateBody", { sendBy: day(p.sendBy ?? ""), deadline: day(p.earliestDeadline ?? "") })}</Notice>;
  if (p.blocked && p.blocked !== "sent") {
    const body = p.blocked === "mail_not_configured" ? t("sharePanel.pnd.blocked.mailNotConfiguredBody", { address: p.address }) : p.blocked === "no_reply_to" ? t("sharePanel.pnd.blocked.noReplyToBody") : undefined;
    return (
      <Notice tone="neu" title={BLOCKED_TITLE[p.blocked]()}>
        {body}
      </Notice>
    );
  }
  return p.sendBy ? <Notice tone="info" title={t("sharePanel.pnd.sendBy", { date: day(p.sendBy) })}>{t("sharePanel.pnd.sendByBody", { deadline: day(p.earliestDeadline ?? "") })}</Notice> : <Notice tone="info" title={t("sharePanel.pnd.noDeadline")} />;
}

function PndPreviewView({ preview, onSend, onCancel, sending }: { preview: PndPreview; onSend: () => void; onCancel: () => void; sending: boolean }) {
  return (
    <section className="card" aria-labelledby="pnd-preview-title" style={{ boxShadow: "none" }}>
      <div className="card-h">
        <div>
          <h4 id="pnd-preview-title">{t("sharePanel.pnd.previewTitle")}</h4>
          <p className="small muted">{t("sharePanel.pnd.previewNote")}</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <dl className="kv">
          <dt>{t("sharePanel.pnd.to")}</dt>
          <dd className="mono">{preview.to}</dd>
          <dt>{t("sharePanel.pnd.replyTo")}</dt>
          <dd className="mono">{preview.replyTo}</dd>
          <dt>{t("sharePanel.pnd.subject")}</dt>
          <dd>{preview.subject}</dd>
        </dl>
        <dl className="kv" aria-label={t("sharePanel.pnd.fieldsLabel")}>
          {preview.fields.map((f) => (
            <div key={f.key} style={{ display: "contents" }}>
              <dt>{f.label}</dt>
              <dd style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{f.value}</dd>
            </div>
          ))}
        </dl>
        <div className="row wrap" style={{ gap: "8px" }}>
          <button type="button" className="btn btn-primary" onClick={onSend} disabled={sending}>
            <Send className="ic" aria-hidden="true" />
            {sending ? t("sharePanel.pnd.sending") : t("sharePanel.pnd.send")}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={sending}>
            {t("sharePanel.pnd.cancel")}
          </button>
        </div>
      </div>
    </section>
  );
}

function Pnd({ s, opportunityId, onSent }: { s: Syndication; opportunityId: string; onSent: () => void }) {
  const [preview, setPreview] = useState<PndPreview | null>(null);
  const [justSent, setJustSent] = useState<string | null>(null);
  const load = useSyndicationMutation((api) => api.previewPnd(opportunityId));
  const send = useSyndicationMutation((api, digest: string) => api.sendPnd(opportunityId, digest));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <h4>{t("sharePanel.pnd.heading")}</h4>
      <p className="small muted">
        {t("sharePanel.pnd.about")}{" "}
        <a href={s.pnd.sourceUrl} target="_blank" rel="noopener noreferrer">
          {t("sharePanel.pnd.howLink")}
        </a>
      </p>
      {justSent ? <Notice tone="ok" title={t("sharePanel.pnd.sentNow")}>{t("sharePanel.pnd.sentNowBody", { replyTo: justSent })}</Notice> : <PndStatus s={s} />}
      {load.error !== null && <ErrorBanner error={load.error} title={t("sharePanel.pnd.previewFailed")} />}
      {send.error !== null && <ErrorBanner error={send.error} title={t("sharePanel.pnd.sendFailed")} />}
      {preview && !justSent ? (
        <PndPreviewView
          preview={preview}
          sending={send.state === "saving"}
          onCancel={() => {
            setPreview(null);
            send.reset();
          }}
          onSend={async () => {
            const done = await send.run(preview.digest);
            if (done) {
              setJustSent(done.replyTo);
              setPreview(null);
              onSent();
            }
          }}
        />
      ) : (
        s.pnd.canSend &&
        !justSent && (
          <div>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={load.state === "saving"}
              onClick={async () => {
                const p = await load.run();
                if (p) setPreview(p);
              }}
            >
              {load.state === "saving" ? t("sharePanel.pnd.previewing") : t("sharePanel.pnd.preview")}
            </button>
          </div>
        )
      )}
    </div>
  );
}

export function SyndicationPanel({ opportunity }: { opportunity: Opportunity }) {
  useFunderMessages();
  const q = useSyndicationQuery((api) => api.get(opportunity.id), [opportunity.id, opportunity.updatedAt, opportunity.status, opportunity.published]);
  const feeds = useSyndicationMutation((api, on: boolean) => api.setFeeds(opportunity.id, on));
  return (
    <section className="card" aria-labelledby="share-call-title" style={{ boxShadow: "none" }}>
      <div className="card-h">
        <div>
          <h3 id="share-call-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Megaphone className="ic" aria-hidden="true" />
            {t("sharePanel.title")}
          </h3>
          <p className="small muted">{t("sharePanel.intro")}</p>
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
        {q.status === "error" && <ErrorBanner error={q.error} onRetry={q.reload} title={t("sharePanel.loadFailed")} />}
        {!opportunity.published && <Notice tone="neu" title={t("sharePanel.publishFirst")}>{t("sharePanel.publishFirstBody")}</Notice>}
        {feeds.error !== null && <ErrorBanner error={feeds.error} title={t("sharePanel.feeds.saveFailed")} />}
        {q.status === "ready" && (
          <>
            <Feeds
              s={q.data}
              saving={feeds.state === "saving"}
              onChange={async (on) => {
                const next = await feeds.run(on);
                if (next) q.set(next);
              }}
            />
            <OpenGrants s={q.data} />
            <Pnd s={q.data} opportunityId={opportunity.id} onSent={q.reload} />
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <h4>{t("sharePanel.counts.heading")}</h4>
              <p className="small">{t("sharePanel.counts.feed", { count: q.data.startedFrom.feed })}</p>
              <p className="small">{t("sharePanel.counts.pnd", { count: q.data.startedFrom.pnd })}</p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
