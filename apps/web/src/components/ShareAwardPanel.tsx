// SPDX-License-Identifier: AGPL-3.0-only
// "Share this award" (v1.8.0), on the funder's award screen and the grantee's: whether the award is
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

/** Listed or not, as an icon and a label. */
export function ListedBadge({ listed }: { listed: boolean }) {
  return listed ? (
    <span className="bdg bdg-ok">
      <Globe className="ic" aria-hidden="true" />
      Listed publicly
    </span>
  ) : (
    <span className="bdg bdg-neutral">
      <EyeOff className="ic" aria-hidden="true" />
      Not public
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
            {on ? "On" : "Off"} · {detail}
          </div>
        </div>
        <button type="button" className={on ? "tog on" : "tog"} role="switch" aria-checked={on} aria-labelledby={id} disabled={disabled} onClick={onToggle}></button>
      </div>
    </div>
  );
}

const POSTS = [
  { key: "linkedin", label: "LinkedIn post", what: "the LinkedIn post", rows: 7 },
  { key: "short", label: "Short post", what: "the short post", rows: 3 },
  { key: "newsletter", label: "Newsletter paragraph", what: "the newsletter paragraph", rows: 4 },
] as const;

/** The posts (editable here; the copy button copies what is in the box), link, card and badge. */
function Kit({ kit, awardId }: { kit: AwardShareKit; awardId: string }) {
  const [posts, setPosts] = useState(kit.posts);
  useEffect(() => setPosts(kit.posts), [kit.posts]);
  const id = (k: string) => `share-${k}-${awardId}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div>
        <div className="small b" id={id("link")}>
          Award page
        </div>
        <div className="row wrap" style={{ gap: "10px", marginTop: "6px" }}>
          <a href={kit.links.page} className="mono" aria-describedby={id("link")} style={{ wordBreak: "break-all" }}>
            {kit.links.page}
          </a>
          <CopyButton value={kit.links.page} what="the award page link" className="btn btn-sm btn-secondary" label="Copy link" />
        </div>
      </div>
      {POSTS.map((p) => (
        <div key={p.key}>
          <label htmlFor={id(p.key)} className="small b">
            {p.label}
          </label>
          <textarea id={id(p.key)} className="ta" rows={p.rows} style={{ marginTop: "6px" }} value={posts[p.key]} onChange={(e) => setPosts({ ...posts, [p.key]: e.target.value })} />
          <div className="row wrap" style={{ justifyContent: "space-between", gap: "10px", marginTop: "6px" }}>
            <span className="small muted">{posts[p.key].length} characters</span>
            <CopyButton value={posts[p.key]} what={p.what} className="btn btn-sm btn-secondary" />
          </div>
        </div>
      ))}
      <div className="row wrap" style={{ gap: "10px" }}>
        <a href={kit.links.image} download className="btn btn-secondary">
          <Download className="ic" aria-hidden="true" />
          Download the card image
        </a>
        <span className="small muted">1200 × 627, for posts that take an image.</span>
      </div>
      <div>
        <div className="small b">“Funded by” badge for your website</div>
        <div className="row wrap" style={{ gap: "12px", marginTop: "8px", alignItems: "center" }}>
          <img src={badgeDataUrl(kit.badge.svg)} alt={kit.badge.text} height={20} />
          {kit.badge.verified ? (
            <span className="small muted" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <ShieldCheck className="ic" aria-hidden="true" />
              Verified: the funder is linked to OpenGrants Passport.
            </span>
          ) : (
            <span className="small muted">Not marked verified: the funder is not linked to OpenGrants Passport.</span>
          )}
        </div>
        <label htmlFor={id("badge")} className="small b" style={{ display: "block", marginTop: "10px" }}>
          Badge code
        </label>
        <textarea id={id("badge")} className="ta mono" rows={3} readOnly value={kit.badge.snippet} style={{ marginTop: "6px", fontSize: "12px" }} />
        <div className="row" style={{ justifyContent: "flex-end", marginTop: "6px" }}>
          <CopyButton value={kit.badge.snippet} what="the badge code" className="btn btn-sm btn-secondary" />
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
          <h2 id={`share-h-${awardId}`}>Share this award</h2>
          <p className="small muted">Posts, a link, a card and a badge built only from what is public about this award. Nothing is posted from here.</p>
        </div>
        <div className="row" style={{ gap: "10px" }}>
          <SaveNote state={save.state} />
          {data && <ListedBadge listed={data.listed} />}
        </div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {q.status === "loading" && <Loading label="Loading sharing" />}
        {q.status === "error" && <ErrorBanner error={q.error} onRetry={q.reload} />}
        {failed && save.error !== null && <ErrorBanner error={save.error} title="The setting did not change." />}
        {data && (
          <>
            {side === "funder" ? (
              <SwitchRow id={`share-conf-${awardId}`} label="Keep this award confidential" detail="A confidential award never appears on your public pages, in feeds, badges, open data or share cards." on={on} disabled={!data.canChange || save.state === "saving"} onToggle={() => void toggle()} />
            ) : (
              <SwitchRow id={`share-unlist-${awardId}`} label="Don’t list us publicly" detail={`Keeps this award off ${funderName ?? "the funder"}’s public page and badge. Your team’s admins can change it.`} on={on} disabled={!data.canChange || save.state === "saving"} onToggle={() => void toggle()} />
            )}
            {!data.listed && (
              <Notice tone="neu" title="Not on the public page">
                {notListedText(data.reason, side, funderName)}
                {side === "funder" && data.reason === "listing_off" && settingsHref && (
                  <>
                    {" "}
                    <Link to={settingsHref}>Open Settings › Public page</Link>
                  </>
                )}
              </Notice>
            )}
            {data.listed && data.awardsPage && (
              <p className="small" style={{ display: "flex", alignItems: "center", gap: "6px", margin: 0 }}>
                <Info className="ic" aria-hidden="true" />
                <span>
                  Listed on{" "}
                  <Link to={new URL(data.awardsPage).pathname}>{side === "funder" ? "your grants-awarded page" : `${funderName ?? "the funder"}’s grants-awarded page`}</Link>
                  {data.amountsShown ? "." : ", without the amount."}
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
