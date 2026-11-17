// SPDX-License-Identifier: AGPL-3.0-only
// "Share to the gallery" for a funder's own form, rubric or email template, and the list of what
// the workspace has shared. The dialog shows what will be shared before anything is sent: contact
// details and the organization's names are taken out (the person may add more names to replace),
// the person agrees to CC BY 4.0, and a moderator reviews it. A workspace admin only; the server
// holds the same rule, and no agent can share.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { LayoutTemplate, Share2, Undo2 } from "lucide-react";
import { LICENCE, type GalleryKind, type GalleryPreview, type GallerySource, type GallerySubmission, type GalleryTags } from "../../api/gallery.ts";
import { useGalleryMutation, useGalleryQuery } from "../../api/galleryHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { ErrorBanner, Field, Loading, Notice, problemFor } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";
import { StrippedList, SnapshotPreview, SubmissionBadge, tagLabel } from "../public/galleryParts.tsx";
import { t } from "./i18n.ts";
import { usePublicMessages } from "../../i18n/index.tsx";

/** Only a workspace admin shares (the API refuses anyone else). */
export const useCanShare = () => (useWorkspace("funder").member.role ?? "admin") === "admin";

// The gallery's tag vocabulary: the values are stored and filtered on as written (English);
// the labels are what people read.
const TAG_GROUPS: { key: keyof GalleryTags; readonly label: string; values: string[] }[] = [
  { key: "fieldOfWork", get label() { return t("shareToGallery.tags.fieldOfWork"); }, values: ["Any field", "Arts and culture", "Community development", "Education", "Environment", "Health", "Housing", "Human services", "Youth and families"] },
  { key: "grantSize", get label() { return t("shareToGallery.tags.grantSize"); }, values: ["Under $10,000", "$10,000 to $50,000", "$50,000 to $250,000", "Over $250,000", "Any size"] },
  { key: "audience", get label() { return t("shareToGallery.tags.audience"); }, values: ["Nonprofits", "Community groups", "Schools", "Small organizations", "Faith-based organizations"] },
];
const KIND: Record<GalleryKind, () => string> = {
  application_form: () => t("shareToGallery.kind.applicationForm"),
  report_form: () => t("shareToGallery.kind.reportForm"),
  rubric: () => t("shareToGallery.kind.rubric"),
  email_template: () => t("shareToGallery.kind.emailTemplate"),
  program_kit: () => t("shareToGallery.kind.programKit"),
};
const kindLabel = (kind: GalleryKind) => KIND[kind]?.() ?? kind;

function ShareDialog({ source, name, onClose }: { source: GallerySource; name: string; onClose: () => void }) {
  // Loaded already by the button that opens the dialog, so the dialog never waits (or loses focus) for it.
  usePublicMessages();
  const ws = useWorkspace("funder");
  const [extra, setExtra] = useState("");
  const extraNames = extra.split(",").map((s) => s.trim()).filter((s) => s.length >= 3);
  const preview = useGalleryMutation((api, names: string[]) => api.preview(ws.id, { source, extraNames: names }));
  const submit = useGalleryMutation((api, input: Parameters<typeof api.submit>[1]) => api.submit(ws.id, input));
  const [shown, setShown] = useState<GalleryPreview | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [tags, setTags] = useState<GalleryTags>({ fieldOfWork: [], grantSize: [], audience: [] });
  const [agreed, setAgreed] = useState(false);
  const [sent, setSent] = useState<GallerySubmission | null>(null);

  const load = async (names: string[]) => {
    const p = await preview.run(names);
    if (p) {
      setShown(p);
      setTitle((item) => item || p.suggestedTitle);
    }
  };
  useEffect(() => {
    void load([]);
    // Load once when the dialog opens; "Update preview" reloads with more names.
  }, []);

  const toggle = (key: keyof GalleryTags, value: string) => setTags((item) => ({ ...item, [key]: item[key].includes(value) ? item[key].filter((v) => v !== value) : [...item[key], value] }));
  const send = async () => {
    const out = await submit.run({ source, title: title.trim(), summary: summary.trim(), tags, extraNames, licence: "CC-BY-4.0" });
    if (out) setSent(out);
  };
  const ready = !!shown && title.trim().length >= 3 && summary.trim().length >= 10 && agreed;

  return (
    <Dialog open onClose={onClose} labelledBy="share-gallery-title" size="lg">
      <div className="hd">
        <h2 id="share-gallery-title">{sent ? t("shareToGallery.sentForReview") : t("shareToGallery.shareToTheGallery", { name })}</h2>
      </div>
      <div className="bd" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {sent ? (
          <>
            <Notice tone="ok" title={t("shareToGallery.aModeratorWillReview")}>
              {t("shareToGallery.nothingIsPublicUntil")}
            </Notice>
            <p className="small muted">{t("shareToGallery.youCanWithdrawIt")}</p>
          </>
        ) : (
          <>
            {preview.error !== null && <ErrorBanner error={preview.error} title={t("shareToGallery.itCannotBeShared")} />}
            {submit.error !== null && <ErrorBanner error={submit.error} title={t("shareToGallery.itCouldNotBe")} />}
            {!shown && preview.state === "saving" && <Loading label={t("shareToGallery.preparingACopyTo")} />}
            {shown && (
              <>
                <p>
                  {t("shareToGallery.theGalleryGetsA", { kind: shown.kind, version: shown.source.version })}
                </p>
                <section aria-labelledby="share-taken-out">
                  <h3 id="share-taken-out" style={{ fontSize: "14px" }}>
                    {t("shareToGallery.whatWeTookOut")}
                  </h3>
                  <StrippedList stripped={shown.stripped} />
                  <p className="small muted" style={{ marginTop: "6px" }}>
                    {t("shareToGallery.emailAddressesPhoneNumbers", { placeholder: shown.placeholder })} {shown.names.join(", ") || t("shareToGallery.none")}.
                  </p>
                </section>
                <div className="fld-row" style={{ alignItems: "flex-end" }}>
                  <Field id="share-extra" label={t("shareToGallery.otherNamesToReplace")} help={t("shareToGallery.separateWithCommasA")}>
                    <input className="inp" id="share-extra" value={extra} onChange={(e) => setExtra(e.target.value)} />
                  </Field>
                  <button type="button" className="btn btn-secondary" disabled={preview.state === "saving"} onClick={() => load(extraNames)}>
                    {t("shareToGallery.updatePreview")}
                  </button>
                </div>
                <details>
                  <summary className="b">{t("shareToGallery.seeExactlyWhatWill")}</summary>
                  <div style={{ marginTop: "12px" }}>
                    <SnapshotPreview snapshot={shown.snapshot} />
                  </div>
                </details>
                <Field id="share-title" label={t("shareToGallery.titleInTheGallery")} required error={problemFor(submit.error, "title")}>
                  <input className="inp" id="share-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
                </Field>
                <Field id="share-summary" label={t("shareToGallery.summary")} required help={t("shareToGallery.twoOrThreeSentences")} error={problemFor(submit.error, "summary")}>
                  <textarea className="ta" id="share-summary" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={1000} />
                </Field>
                {TAG_GROUPS.map((g) => (
                  <fieldset key={g.key} style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend className="lbl">{g.label}</legend>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: "6px" }}>
                      {g.values.map((v) => (
                        <label key={v} className="cb">
                          <input type="checkbox" checked={tags[g.key].includes(v)} onChange={() => toggle(g.key, v)} />
                          <span>{tagLabel(v)}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
                <label className="cb">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  <span>
                    {t.rich("shareToGallery.iAgreeToShare", { name: LICENCE.name, name2: ws.name, link: (chunks) => <a href={LICENCE.url} target="_blank" rel="license noreferrer">{chunks}</a> })}
                  </span>
                </label>
              </>
            )}
          </>
        )}
      </div>
      <div className="ft">
        {sent ? (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t("shareToGallery.done")}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t("shareToGallery.cancel")}
            </button>
            <button type="button" className="btn btn-primary" disabled={!ready || submit.state === "saving"} onClick={send}>
              <Share2 className="ic" aria-hidden="true" />
              {t("shareToGallery.sendForReview")}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}

/** One button for a form, a rubric or an email template. Renders nothing for anyone but an admin. */
export function ShareToGalleryButton({ source, name, small = false, disabledReason }: { source: GallerySource; name: string; small?: boolean; disabledReason?: string }) {
  // The dialog shows the gallery's own parts (screens/public/galleryParts.tsx): their messages load with the button.
  usePublicMessages();
  const canShare = useCanShare();
  const [open, setOpen] = useState(false);
  if (!canShare) return null;
  return (
    <>
      <button type="button" className={small ? "btn btn-sm btn-secondary" : "btn btn-secondary"} onClick={() => setOpen(true)} disabled={!!disabledReason} title={disabledReason}>
        <Share2 className="ic" aria-hidden="true" />
        {t.rich("shareToGallery.shareToTheGallery2", { name, span: (chunks) => <span className="sr">{chunks}</span> })}
      </button>
      {open && <ShareDialog source={source} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

/** What the workspace has shared: the moderator's decision and reason, and withdraw. */
export function GallerySubmissionsPanel() {
  usePublicMessages();
  const ws = useWorkspace("funder");
  const canShare = useCanShare();
  const list = useGalleryQuery((api) => api.submissions(ws.id), [ws.id]);
  const withdraw = useGalleryMutation((api, id: string) => api.withdraw(ws.id, id));
  if (list.status === "ready" && list.data.length === 0) return null;
  return (
    <section className="card" aria-labelledby="shared-gallery-title">
      <div className="card-h">
        <h3 id="shared-gallery-title">{t("shareToGallery.sharedToTheGallery")}</h3>
        <Link to="/templates" className="btn btn-sm btn-ghost">
          <LayoutTemplate className="ic" aria-hidden="true" />
          {t("shareToGallery.templateGallery")}
        </Link>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {list.status === "loading" && <Loading label={t("shareToGallery.loadingWhatYouShared")} />}
        {list.status === "error" && <ErrorBanner error={list.error} onRetry={list.reload} />}
        {withdraw.error !== null && <ErrorBanner error={withdraw.error} title={t("shareToGallery.itCouldNotBe2")} />}
        {list.status === "ready" && (
          <ul aria-label={t("shareToGallery.sharedToTheGallery")} style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "12px" }}>
            {list.data.map((s) => (
              <li key={s.id} style={{ display: "flex", flexDirection: "column", gap: "4px", borderBottom: "1px solid var(--og-gray-200)", paddingBottom: "10px" }}>
                <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
                  <span className="b">{s.title}</span>
                  <span className="tag">{kindLabel(s.kind)}</span>
                  <SubmissionBadge status={s.status} />
                  <span className="small muted">{t("shareToGallery.sent", { date: formatDate(s.createdAt) })}</span>
                </div>
                {s.status === "rejected" && s.decisionReason && (
                  <p className="small">
                    <span className="b">{t("shareToGallery.whyItWasDeclined")} </span>
                    {s.decisionReason}
                  </p>
                )}
                {s.status === "approved" && s.item?.live && (
                  <p className="small">
                    {t.rich("shareToGallery.publishedAtTemplates", { slug: s.item.slug, link: (chunks) => <Link to={`/templates/${s.item?.slug}`}>{chunks}</Link> })}
                  </p>
                )}
                {canShare && (s.status === "pending" || s.status === "approved") && (
                  <div>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={withdraw.state === "saving"}
                      onClick={async () => {
                        if (await withdraw.run(s.id)) list.reload();
                      }}
                    >
                      <Undo2 className="ic" aria-hidden="true" />
                      {t.rich("shareToGallery.withdraw", { title: s.title, span: (chunks) => <span className="sr">{chunks}</span> })}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
