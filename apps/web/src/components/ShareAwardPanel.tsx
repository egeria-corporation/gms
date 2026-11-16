// SPDX-License-Identifier: AGPL-3.0-only
// "Share this award" (v1.9.0), on the funder's award screen and the grantee's: whether the award is
// on the funder's public page and why not, the switch each side owns (the funder's "Keep this award
// confidential", the grantee's "Don't list us publicly"), and while it is public the share kit:
// three ready-to-edit posts, the award page link, the card image and the "Funded by" badge, each
// with a copy button. Nothing is posted from here.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Circle, CircleCheck, Download, EyeOff, Globe, Info, Lock, ShieldCheck } from "lucide-react";
import { badgeDataUrl, notListedText, type AwardShareKit, type AwardSharing, type ShareSide } from "../api/awardSharing.ts";
import { useAwardSharingMutation, useAwardSharingQuery } from "../api/awardSharingHooks.ts";
import { CopyButton } from "./CopyButton.tsx";
import { ErrorBanner, Loading, Notice, SaveNote } from "./ui.tsx";

import { translator } from "../i18n/index.tsx";


const t = translator("shared");
/** Listed or not, as an icon and a label. */
export function ListedBadge({ listed }: { listed: boolean }) {
  return listed ? (
    <span className="bdg bdg-ok">
      <Globe className="ic" aria-hidden="true" />
      {t("shareAwardPanel.listedPublicly")}
    </span>
  ) : (
    <span className="bdg bdg-neutral">
      <EyeOff className="ic" aria-hidden="true" />
      {t("shareAwardPanel.notPublic")}
    </span>
  );
}

function SwitchRow({ id, label, detail, on, disabled, onToggle }: { id: string; label: string; detail: string; on: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <div className="rc">
      <div className={on ? "rc-row rc-pass" : "rc-row rc-unk"}>
        {disabled ? <Lock className="ic" aria-hidden="true" /> : on ? <CircleCheck className="ic" aria-hidden="true" /> : <Circle className="ic" aria-hidden="true" />}
        <div>
          <div className="l" id={id}>
            {label}
          </div>
          <div className="r">
            {on ? t("shareAwardPanel.on") : t("shareAwardPanel.off")} · {detail}
          </div>
        </div>
        <button type="button" className={on ? "tog on" : "tog"} role="switch" aria-checked={on} aria-labelledby={id} disabled={disabled} onClick={onToggle}></button>
      </div>
    </div>
  );
}

const POSTS = [
  { key: "linkedin", rows: 7 },
  { key: "short", rows: 3 },
  { key: "newsletter", rows: 4 },
] as const;
/** Where the award is listed: on the funder's own page, a named funder's, or a funder not named; with or without the amount. */
const LISTED = {
  yours: ["shareAwardPanel.listed.yours.amount", "shareAwardPanel.listed.yours.noAmount"],
  theirs: ["shareAwardPanel.listed.theirs.amount", "shareAwardPanel.listed.theirs.noAmount"],
  funder: ["shareAwardPanel.listed.funder.amount", "shareAwardPanel.listed.funder.noAmount"],
} as const;
const POST_LABEL = { linkedin: "shareAwardPanel.post.linkedin", short: "shareAwardPanel.post.short", newsletter: "shareAwardPanel.post.newsletter" } as const;
const POST_WHAT = { linkedin: "shareAwardPanel.what.linkedin", short: "shareAwardPanel.what.short", newsletter: "shareAwardPanel.what.newsletter" } as const;

/** The posts (editable here; the copy button copies what is in the box), link, card and badge. */
function Kit({ kit, awardId }: { kit: AwardShareKit; awardId: string }) {
  const [posts, setPosts] = useState(kit.posts);
  useEffect(() => setPosts(kit.posts), [kit.posts]);
  const id = (k: string) => `share-${k}-${awardId}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div>
        <div className="small b" id={id("link")}>
          {t("shareAwardPanel.awardPage")}
        </div>
        <div className="row wrap" style={{ gap: "10px", marginTop: "6px" }}>
          <a href={kit.links.page} className="mono" aria-describedby={id("link")} style={{ wordBreak: "break-all" }}>
            {kit.links.page}
          </a>
          <CopyButton value={kit.links.page} what={t("shareAwardPanel.what.pageLink")} className="btn btn-sm btn-secondary" label={t("shareAwardPanel.copyPageLink")} />
        </div>
      </div>
      {POSTS.map((p) => (
        <div key={p.key}>
          <label htmlFor={id(p.key)} className="small b">
            {t(POST_LABEL[p.key])}
          </label>
          <textarea id={id(p.key)} className="ta" rows={p.rows} style={{ marginTop: "6px" }} value={posts[p.key]} onChange={(e) => setPosts({ ...posts, [p.key]: e.target.value })} />
          <div className="row wrap" style={{ justifyContent: "space-between", gap: "10px", marginTop: "6px" }}>
            <span className="small muted">{t("shareAwardPanel.characters", { length: posts[p.key].length })}</span>
            <CopyButton value={posts[p.key]} what={t(POST_WHAT[p.key])} className="btn btn-sm btn-secondary" />
          </div>
        </div>
      ))}
      <div className="row wrap" style={{ gap: "10px" }}>
        <a href={kit.links.image} download className="btn btn-secondary">
          <Download className="ic" aria-hidden="true" />
          {t("shareAwardPanel.downloadTheCardImage")}
        </a>
        <span className="small muted">{t("shareAwardPanel.n1200627ForPostsThat")}</span>
      </div>
      <div>
        <div className="small b">{t("shareAwardPanel.fundedByBadgeForYour")}</div>
        <div className="row wrap" style={{ gap: "12px", marginTop: "8px", alignItems: "center" }}>
          <img src={badgeDataUrl(kit.badge.svg)} alt={kit.badge.text} height={20} />
          {kit.badge.verified ? (
            <span className="small muted" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <ShieldCheck className="ic" aria-hidden="true" />
              {t("shareAwardPanel.verifiedTheFunderIsLinked")}
            </span>
          ) : (
            <span className="small muted">{t("shareAwardPanel.notMarkedVerifiedTheFunder")}</span>
          )}
        </div>
        <label htmlFor={id("badge")} className="small b" style={{ display: "block", marginTop: "10px" }}>
          {t("shareAwardPanel.badgeCode")}
        </label>
        <textarea id={id("badge")} className="ta mono" rows={3} readOnly value={kit.badge.snippet} style={{ marginTop: "6px", fontSize: "12px" }} />
        <div className="row" style={{ justifyContent: "flex-end", marginTop: "6px" }}>
          <CopyButton value={kit.badge.snippet} what={t("shareAwardPanel.what.badge")} className="btn btn-sm btn-secondary" />
        </div>
      </div>
    </div>
  );
}

export function ShareAwardPanel({ awardId, side, funderName, settingsHref }: { awardId: string; side: ShareSide; funderName?: string; settingsHref?: string }) {
  const q = useAwardSharingQuery((api) => api.sharing(awardId, side), [awardId, side]);
  const save = useAwardSharingMutation((api, on: boolean) => (side === "funder" ? api.setConfidential(awardId, on) : api.setUnlisted(awardId, on)));
  const [failed, setFailed] = useState(false);
  const data: AwardSharing | undefined = q.data;
  const on = side === "funder" ? !!data?.confidential : !!data?.recipientUnlisted;

  async function toggle() {
    setFailed(false);
    const out = await save.run(!on);
    if (out) q.set(out);
    else setFailed(true);
  }

  return (
    <section className="card" aria-labelledby={`share-h-${awardId}`}>
      <div className="card-h">
        <div>
          <h2 id={`share-h-${awardId}`}>{t("shareAwardPanel.shareThisAward")}</h2>
          <p className="small muted">{t("shareAwardPanel.postsALinkACard")}</p>
        </div>
        <div className="row" style={{ gap: "10px" }}>
          <SaveNote state={save.state} />
          {data && <ListedBadge listed={data.listed} />}
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {q.status === "loading" && <Loading label={t("shareAwardPanel.loadingSharing")} />}
        {q.status === "error" && <ErrorBanner error={q.error} onRetry={q.reload} />}
        {failed && save.error !== null && <ErrorBanner error={save.error} title={t("shareAwardPanel.theSettingDidNotChange")} />}
        {data && (
          <>
            {side === "funder" ? (
              <SwitchRow id={`share-conf-${awardId}`} label={t("shareAwardPanel.keepThisAwardConfidential")} detail={t("shareAwardPanel.aConfidentialAwardNeverAppears")} on={on} disabled={!data.canChange || save.state === "saving"} onToggle={() => void toggle()} />
            ) : (
              <SwitchRow id={`share-unlist-${awardId}`} label={t("shareAwardPanel.donTListUsPublicly")} detail={funderName ? t("shareAwardPanel.keepsThisAwardOffS", { funder: funderName }) : t("shareAwardPanel.keepsThisAwardOffFunder")} on={on} disabled={!data.canChange || save.state === "saving"} onToggle={() => void toggle()} />
            )}
            {!data.listed && (
              <Notice tone="neu" title={t("shareAwardPanel.notOnThePublicPage")}>
                {notListedText(data.reason, side, funderName)}
                {side === "funder" && data.reason === "listing_off" && settingsHref && (
                  <>
                    {" "}
                    <Link to={settingsHref}>{t("shareAwardPanel.openSettingsPublicPage")}</Link>
                  </>
                )}
              </Notice>
            )}
            {data.listed && data.awardsPage && (
              <p className="small" style={{ display: "flex", alignItems: "center", gap: "6px", margin: 0 }}>
                <Info className="ic" aria-hidden="true" />
                <span>
                  {t.rich(LISTED[side === "funder" ? "yours" : funderName ? "theirs" : "funder"][data.amountsShown ? 0 : 1], { funder: funderName ?? "", link: (chunks) => <Link to={new URL(data.awardsPage!).pathname}>{chunks}</Link> })}
                </span>
              </p>
            )}
            {data.kit && <Kit kit={data.kit} awardId={awardId} />}
          </>
        )}
      </div>
    </section>
  );
}
