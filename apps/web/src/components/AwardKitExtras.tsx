// SPDX-License-Identifier: AGPL-3.0-only
// The award kit, plus (v1.12.0), inside "Share this award":
//   * the federal share: the funder marks an award federally funded with the federal amount and
//     percentage; the kit's statement (the Stevens Amendment) appears only once both are entered;
//   * the portrait card (1080 × 1350, drawn here in the browser with the share card's renderer;
//     the amount is left off until the person asks for it), the carousel PDF with each slide's alt
//     text, the press release, and the other side's page to tag (only with its consent);
//   * the workspace's share-kit settings: its social page, consent to be tagged, and a funder's
//     credit wording ("funded by" or "supported by") and standard description.
// Nothing is posted from here.
import { useEffect, useId, useState } from "react";
import { BadgeCheck, Download, FileText, ImageIcon, Landmark, Settings2, Tag } from "lucide-react";
import type { AwardFederalFunding, AwardShareKit, AwardSharing, CreditWording, ShareKitProfile, ShareSide } from "../api/awardSharing.ts";
import { useAwardSharingMutation, useAwardSharingQuery, useAwardSharingApi } from "../api/awardSharingHooks.ts";
import { CopyButton } from "./CopyButton.tsx";
import { Dialog } from "./Dialog.tsx";
import { ErrorBanner, Notice, SaveNote } from "./ui.tsx";

import { formatMoney } from "../lib/format.ts";
import { intlLocale, translator } from "../i18n/index.tsx";

const t = translator("shared");

/** Saves a file the browser made, under its name. */
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Draws the portrait card with the share card's renderer, loaded only when asked for. */
async function portraitPng(kit: AwardShareKit, withAmount: boolean): Promise<Blob> {
  const [{ CARD_FILES, loadCardAssets }, { renderPortraitCard }] = await Promise.all([import("../edge/og/card.ts"), import("../edge/og/portrait.ts")]);
  const files = new Map<string, Uint8Array>();
  await Promise.all(
    Object.values(CARD_FILES).map(async (path) => {
      const res = await fetch(path);
      if (res.ok) files.set(path, new Uint8Array(await res.arrayBuffer()));
    }),
  );
  const assets = await loadCardAssets((path) => files.get(path) ?? null);
  const p = kit.portrait;
  const png = await renderPortraitCard(
    {
      site: window.location.host,
      eyebrow: t("awardKit.portrait.eyebrow"),
      funder: p.funder,
      connector: t("awardKit.portrait.connector"),
      recipient: p.recipient,
      program: p.program ? t("awardKit.portrait.program", { program: p.program }) : null,
      detail: p.purpose,
      amount: withAmount && p.amount ? formatMoney(p.amount) : null,
      status: { label: t("awardKit.portrait.year", { year: String(p.year) }), tone: "neutral" },
      note: p.verified ? null : t("awardKit.portrait.notVerified"),
    },
    assets,
  );
  return new Blob([png], { type: "image/png" });
}

const percentText = (p: number) => new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 2 }).format(p);

// ------------------------------------------------------------------------------------ the federal share

export function FederalFundingSection({ awardId, federal, onSaved }: { awardId: string; federal: AwardFederalFunding; onSaved: (next: AwardSharing) => void }) {
  const id = useId();
  const [funded, setFunded] = useState(federal.funded);
  const [amount, setAmount] = useState(federal.amount ? String(Number(federal.amount)) : "");
  const [percent, setPercent] = useState(federal.percent !== null ? String(federal.percent) : "");
  const [source, setSource] = useState(federal.source ?? "");
  const write = useAwardSharingMutation((api, input: Parameters<typeof api.setFederalFunding>[1]) => api.setFederalFunding(awardId, input));
  useEffect(() => {
    setFunded(federal.funded);
    setAmount(federal.amount ? String(Number(federal.amount)) : "");
    setPercent(federal.percent !== null ? String(federal.percent) : "");
    setSource(federal.source ?? "");
  }, [federal.funded, federal.amount, federal.percent, federal.source]);

  const summary = federal.funded && federal.amount && federal.percent !== null ? t("awardKit.federal.summary", { amount: formatMoney({ amount: federal.amount, currency: "USD" }), percent: percentText(federal.percent) }) : null;
  if (!federal.canChange) {
    return federal.funded ? (
      <p className="small" style={{ display: "flex", alignItems: "center", gap: "6px", margin: 0 }}>
        <Landmark className="ic" aria-hidden="true" />
        <span>{summary ?? t("awardKit.federal.markedNoNumbers")}</span>
      </p>
    ) : null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = amount.replace(/[$,\s]/g, "");
    const out = await write.run(funded ? { federallyFunded: true, amount: clean ? clean : null, percent: percent.trim() ? Number(percent) : null, source: source.trim() ? source.trim() : null } : { federallyFunded: false });
    if (out) onSaved(out);
  }

  return (
    <form onSubmit={(e) => void submit(e)} aria-labelledby={`${id}-h`} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div className="row wrap" style={{ justifyContent: "space-between", gap: "8px" }}>
        <h3 id={`${id}-h`} style={{ fontSize: "14px", display: "flex", alignItems: "center", gap: "8px", margin: 0 }}>
          <Landmark className="ic" aria-hidden="true" />
          {t("awardKit.federal.title")}
        </h3>
        <SaveNote state={write.state} />
      </div>
      <label className="cb" htmlFor={`${id}-funded`}>
        <input type="checkbox" id={`${id}-funded`} checked={funded} onChange={(e) => setFunded(e.target.checked)} style={{ marginTop: "3px" }} />
        <span>{t("awardKit.federal.paidWithFederalMoney")}</span>
      </label>
      {funded && (
        <div className="row wrap" style={{ gap: "12px", alignItems: "flex-start" }}>
          <div className="fld" style={{ flex: "1 1 160px" }}>
            <label className="lbl" htmlFor={`${id}-amount`}>
              {t("awardKit.federal.amount")}
            </label>
            <input id={`${id}-amount`} className="inp" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="fld" style={{ flex: "1 1 160px" }}>
            <label className="lbl" htmlFor={`${id}-percent`}>
              {t("awardKit.federal.percent")}
            </label>
            <input id={`${id}-percent`} className="inp" type="number" min="0.01" max="100" step="0.01" value={percent} onChange={(e) => setPercent(e.target.value)} />
          </div>
          <div className="fld" style={{ flex: "2 1 240px" }}>
            <label className="lbl" htmlFor={`${id}-source`}>
              {t("awardKit.federal.agency")}
            </label>
            <input id={`${id}-source`} className="inp" maxLength={200} value={source} onChange={(e) => setSource(e.target.value)} aria-describedby={`${id}-source-help`} />
            <span className="help" id={`${id}-source-help`}>
              {t("awardKit.federal.agencyHelp")}
            </span>
          </div>
        </div>
      )}
      <p className="help" style={{ margin: 0 }}>
        {t("awardKit.federal.onlyWithBoth")}
      </p>
      {write.error !== null && <ErrorBanner error={write.error} title={t("awardKit.federal.notSaved")} />}
      {federal.funded && !federal.statement && <Notice tone="neu" title={t("awardKit.federal.noStatementYet")} />}
      <div>
        <button type="submit" className="btn btn-sm btn-secondary" disabled={write.state === "saving"}>
          {t("awardKit.federal.save")}
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------------------------ the kit's extras

export function KitExtras({ kit, side, awardId }: { kit: AwardShareKit; side: ShareSide; awardId: string }) {
  const api = useAwardSharingApi();
  const id = (k: string) => `kit-${k}-${awardId}`;
  const [press, setPress] = useState(kit.pressRelease);
  useEffect(() => setPress(kit.pressRelease), [kit.pressRelease]);
  const [withAmount, setWithAmount] = useState(false);
  const [busy, setBusy] = useState<"portrait" | "carousel" | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const tag = side === "funder" ? kit.tags.grantee : kit.tags.funder;
  const other = side === "funder" ? kit.portrait.recipient : kit.portrait.funder;

  async function download(which: "portrait" | "carousel") {
    setBusy(which);
    setFailed(null);
    try {
      if (which === "portrait") save(await portraitPng(kit, withAmount), `${kit.award.slug}-portrait.png`);
      else save(await api.carouselPdf(kit.carousel.path), kit.carousel.fileName);
    } catch (e) {
      setFailed(e);
    } finally {
      setBusy(null);
    }
  }
  const alts = kit.carousel.pages.map((p) => p.alt).join("\n");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {failed !== null && <ErrorBanner error={failed} title={t("awardKit.downloadFailed")} />}
      <div>
        <div className="small b" id={id("portrait")}>
          {t("awardKit.portrait.title")}
        </div>
        <p className="small muted" style={{ margin: "4px 0 8px" }}>
          {t("awardKit.portrait.detail")}
        </p>
        <div className="row wrap" style={{ gap: "12px", alignItems: "center" }}>
          <button type="button" className="btn btn-secondary" aria-describedby={id("portrait")} disabled={busy !== null} onClick={() => void download("portrait")}>
            <ImageIcon className="ic" aria-hidden="true" />
            {busy === "portrait" ? t("awardKit.drawing") : t("awardKit.portrait.download")}
          </button>
          <label className="cb" htmlFor={id("amount")}>
            <input type="checkbox" id={id("amount")} checked={withAmount && !!kit.portrait.amount} disabled={!kit.portrait.amount} onChange={(e) => setWithAmount(e.target.checked)} style={{ marginTop: "3px" }} />
            <span>{kit.portrait.amount ? t("awardKit.portrait.showAmount") : t("awardKit.portrait.amountHidden")}</span>
          </label>
        </div>
      </div>

      <div>
        <div className="small b" id={id("carousel")}>
          {t("awardKit.carousel.title")}
        </div>
        <p className="small muted" style={{ margin: "4px 0 8px" }}>
          {t("awardKit.carousel.detail", { count: kit.carousel.pages.length })}
        </p>
        <div className="row wrap" style={{ gap: "10px" }}>
          <button type="button" className="btn btn-secondary" aria-describedby={id("carousel")} disabled={busy !== null} onClick={() => void download("carousel")}>
            <Download className="ic" aria-hidden="true" />
            {busy === "carousel" ? t("awardKit.drawing") : t("awardKit.carousel.download")}
          </button>
          <CopyButton value={alts} what={t("awardKit.carousel.whatAlt")} className="btn btn-sm btn-secondary" label={t("awardKit.carousel.copyAlt")} />
        </div>
        <details style={{ marginTop: "8px" }}>
          <summary className="small">{t("awardKit.carousel.altTitle")}</summary>
          <ol aria-label={t("awardKit.carousel.altTitle")} className="small" style={{ margin: "6px 0 0", paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "4px" }}>
            {kit.carousel.pages.map((p) => (
              <li key={p.alt}>{p.alt}</li>
            ))}
          </ol>
        </details>
      </div>

      <div>
        <label htmlFor={id("press")} className="small b">
          {t("awardKit.press.title")}
        </label>
        <p className="small muted" style={{ margin: "4px 0 6px" }}>
          {t("awardKit.press.detail", { credit: kit.creditLine })}
        </p>
        <textarea id={id("press")} className="ta" rows={10} value={press} onChange={(e) => setPress(e.target.value)} />
        <div className="row" style={{ justifyContent: "flex-end", marginTop: "6px" }}>
          <CopyButton value={press} what={t("awardKit.press.what")} className="btn btn-sm btn-secondary" />
        </div>
      </div>

      {kit.federalStatement && (
        <div>
          <label htmlFor={id("federal")} className="small b" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Landmark className="ic" aria-hidden="true" />
            {t("awardKit.federal.statementTitle")}
          </label>
          <p className="small muted" style={{ margin: "4px 0 6px" }}>
            {t("awardKit.federal.statementDetail")}
          </p>
          <textarea id={id("federal")} className="ta" rows={4} readOnly value={kit.federalStatement} />
          <div className="row" style={{ justifyContent: "flex-end", marginTop: "6px" }}>
            <CopyButton value={kit.federalStatement} what={t("awardKit.federal.what")} className="btn btn-sm btn-secondary" />
          </div>
        </div>
      )}

      <div>
        <div className="small b" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Tag className="ic" aria-hidden="true" />
          {t("awardKit.tag.title")}
        </div>
        {tag ? (
          <div className="row wrap" style={{ gap: "10px", alignItems: "center", marginTop: "6px" }}>
            <span className="small">{t("awardKit.tag.on", { name: tag.name, handle: tag.handle, platform: PLATFORM_NAME[tag.platform] })}</span>
            <a href={tag.url} target="_blank" rel="noopener noreferrer" className="small">
              {t("awardKit.tag.openPage")}
            </a>
            <CopyButton value={tag.handle} what={t("awardKit.tag.what")} className="btn btn-sm btn-secondary" />
          </div>
        ) : (
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            {t("awardKit.tag.none", { name: other })}
          </p>
        )}
      </div>
    </div>
  );
}

const PLATFORM_NAME: Record<string, string> = { linkedin: "LinkedIn", facebook: "Facebook", instagram: "Instagram", x: "X", bluesky: "Bluesky", threads: "Threads" };

// ------------------------------------------------------------------------------------ share-kit settings

export function ShareKitSettings({ side }: { side: ShareSide }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" className="btn btn-sm btn-secondary" onClick={() => setOpen(true)}>
        <Settings2 className="ic" aria-hidden="true" />
        {t("awardKit.settings.open")}
      </button>
      {open && <ShareKitSettingsDialog side={side} onClose={() => setOpen(false)} />}
    </div>
  );
}

function ShareKitSettingsDialog({ side, onClose }: { side: ShareSide; onClose: () => void }) {
  const id = useId();
  const q = useAwardSharingQuery((api) => api.shareProfile(), []);
  const write = useAwardSharingMutation((api, patch: Parameters<typeof api.updateShareProfile>[0]) => api.updateShareProfile(patch));
  const [pageUrl, setPageUrl] = useState("");
  const [consent, setConsent] = useState(false);
  const [wording, setWording] = useState<CreditWording>("funded_by");
  const [description, setDescription] = useState("");
  const p: ShareKitProfile | undefined = q.data;
  useEffect(() => {
    if (!p) return;
    setPageUrl(p.pageUrl ?? "");
    setConsent(p.tagConsent);
    setWording(p.creditWording);
    setDescription(p.standardDescription ?? "");
  }, [p]);
  const funder = side === "funder";
  const disabled = !p?.canChange || write.state === "saving";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const out = await write.run({ pageUrl: pageUrl.trim() ? pageUrl.trim() : null, tagConsent: consent && !!pageUrl.trim(), ...(funder ? { creditWording: wording, standardDescription: description.trim() ? description.trim() : null } : {}) });
    if (out) q.set(out);
  }

  return (
    <Dialog open onClose={onClose} labelledBy={`${id}-title`} size="lg">
      <form onSubmit={(e) => void submit(e)}>
        <div className="hd">
          <div>
            <h2 id={`${id}-title`} style={{ fontSize: "16px" }}>
              {t("awardKit.settings.title")}
            </h2>
            <p className="small muted" style={{ marginTop: "4px" }}>
              {t("awardKit.settings.detail")}
            </p>
          </div>
        </div>
        <div className="bd" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {q.status === "error" && <ErrorBanner error={q.error} onRetry={q.reload} />}
          {write.error !== null && <ErrorBanner error={write.error} title={t("awardKit.settings.notSaved")} />}
          {p && !p.canChange && <Notice tone="neu" title={t("awardKit.settings.adminsChange")} />}
          <div className="fld">
            <label className="lbl" htmlFor={`${id}-page`}>
              {t("awardKit.settings.page")}
            </label>
            <input id={`${id}-page`} className="inp" type="url" inputMode="url" autoComplete="url" placeholder={t("awardKit.settings.pagePlaceholder")} value={pageUrl} disabled={disabled} onChange={(e) => setPageUrl(e.target.value)} aria-describedby={`${id}-page-help`} />
            <span className="help" id={`${id}-page-help`}>
              {t("awardKit.settings.pageHelp")}
            </span>
          </div>
          <label className="cb" htmlFor={`${id}-consent`}>
            <input type="checkbox" id={`${id}-consent`} checked={consent} disabled={disabled || !pageUrl.trim()} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: "3px" }} />
            <span>{funder ? t("awardKit.settings.consentFunder") : t("awardKit.settings.consentGrantee")}</span>
          </label>
          {p?.tagConsent && p.page && (
            <p className="small" style={{ display: "flex", alignItems: "center", gap: "6px", margin: 0 }}>
              <BadgeCheck className="ic" aria-hidden="true" />
              {t("awardKit.settings.consentGiven", { handle: p.page.handle, platform: PLATFORM_NAME[p.page.platform] ?? p.page.platform })}
            </p>
          )}
          {funder && (
            <>
              <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
                <legend className="lbl" style={{ marginBottom: "6px" }}>
                  {t("awardKit.settings.credit")}
                </legend>
                {(["funded_by", "supported_by"] as const).map((w) => (
                  <label key={w} className="radio" htmlFor={`${id}-${w}`}>
                    <input type="radio" id={`${id}-${w}`} name={`${id}-credit`} checked={wording === w} disabled={disabled} onChange={() => setWording(w)} />
                    <span>{w === "funded_by" ? t("awardKit.settings.fundedBy") : t("awardKit.settings.supportedBy")}</span>
                  </label>
                ))}
              </fieldset>
              <div className="fld">
                <label className="lbl" htmlFor={`${id}-about`}>
                  <FileText className="ic" aria-hidden="true" />
                  {t("awardKit.settings.description")}
                </label>
                <textarea id={`${id}-about`} className="ta" rows={4} maxLength={1500} value={description} disabled={disabled} onChange={(e) => setDescription(e.target.value)} aria-describedby={`${id}-about-help`} />
                <span className="help" id={`${id}-about-help`}>
                  {t("awardKit.settings.descriptionHelp")}
                </span>
              </div>
            </>
          )}
        </div>
        <div className="ft">
          <SaveNote state={write.state} />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("awardKit.settings.close")}
          </button>
          {p?.canChange && (
            <button type="submit" className="btn btn-primary" disabled={disabled}>
              {t("awardKit.settings.save")}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
