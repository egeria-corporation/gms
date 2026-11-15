// SPDX-License-Identifier: AGPL-3.0-only
// "Share to the gallery" for a funder's own form, rubric or email template, and the list of what
// the workspace has shared. The dialog shows what will be shared before anything is sent: contact
// details and the organization's names are taken out (the person may add more names to replace),
// the person agrees to CC BY 4.0, and a moderator reviews it. A workspace admin only; the server
// holds the same rule, and no agent can share.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { LayoutTemplate, Share2, Undo2 } from "lucide-react";
import { KIND_LABEL, LICENCE, type GalleryPreview, type GallerySource, type GallerySubmission, type GalleryTags } from "../../api/gallery.ts";
import { useGalleryMutation, useGalleryQuery } from "../../api/galleryHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { ErrorBanner, Field, Loading, Notice, problemFor } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";
import { StrippedList, SnapshotPreview, SubmissionBadge } from "../public/galleryParts.tsx";

/** Only a workspace admin shares (the API refuses anyone else). */
export const useCanShare = () => (useWorkspace("funder").member.role ?? "admin") === "admin";

const TAG_GROUPS: { key: keyof GalleryTags; label: string; values: string[] }[] = [
  { key: "fieldOfWork", label: "Field of work", values: ["Any field", "Arts and culture", "Community development", "Education", "Environment", "Health", "Housing", "Human services", "Youth and families"] },
  { key: "grantSize", label: "Grant size", values: ["Under $10,000", "$10,000 to $50,000", "$50,000 to $250,000", "Over $250,000", "Any size"] },
  { key: "audience", label: "Audience", values: ["Nonprofits", "Community groups", "Schools", "Small organizations", "Faith-based organizations"] },
];

function ShareDialog({ source, name, onClose }: { source: GallerySource; name: string; onClose: () => void }) {
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
      setTitle((t) => t || p.suggestedTitle);
    }
  };
  useEffect(() => {
    void load([]);
    // Load once when the dialog opens; "Update preview" reloads with more names.
  }, []);

  const toggle = (key: keyof GalleryTags, value: string) => setTags((t) => ({ ...t, [key]: t[key].includes(value) ? t[key].filter((v) => v !== value) : [...t[key], value] }));
  const send = async () => {
    const out = await submit.run({ source, title: title.trim(), summary: summary.trim(), tags, extraNames, licence: "CC-BY-4.0" });
    if (out) setSent(out);
  };
  const ready = !!shown && title.trim().length >= 3 && summary.trim().length >= 10 && agreed;

  return (
    <Dialog open onClose={onClose} labelledBy="share-gallery-title" size="lg">
      <div className="hd">
        <h2 id="share-gallery-title">{sent ? "Sent for review" : `Share “${name}” to the gallery`}</h2>
      </div>
      <div className="bd" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {sent ? (
          <>
            <Notice tone="ok" title="A moderator will review it">
              Nothing is public until it is approved. You will see the decision, and the reason if it is declined, under Forms, in “Shared to the gallery”.
            </Notice>
            <p className="small muted">You can withdraw it at any time, before or after it is published.</p>
          </>
        ) : (
          <>
            {preview.error !== null && <ErrorBanner error={preview.error} title="It cannot be shared yet" />}
            {submit.error !== null && <ErrorBanner error={submit.error} title="It could not be sent" />}
            {!shown && preview.state === "saving" && <Loading label="Preparing a copy to share" />}
            {shown && (
              <>
                <p>
                  The gallery gets a copy of this {KIND_LABEL[shown.kind].toLowerCase()} (version {shown.source.version}), not a link: your own stays as it is, and later edits are not shared.
                </p>
                <section aria-labelledby="share-taken-out">
                  <h3 id="share-taken-out" style={{ fontSize: "14px" }}>
                    What we took out
                  </h3>
                  <StrippedList stripped={shown.stripped} />
                  <p className="small muted" style={{ marginTop: "6px" }}>
                    Email addresses, phone numbers and web addresses other than your own site are removed. These names become “{shown.placeholder}”: {shown.names.join(", ") || "none"}.
                  </p>
                </section>
                <div className="fld-row" style={{ alignItems: "flex-end" }}>
                  <Field id="share-extra" label="Other names to replace" help="Separate with commas: a program's name, a person's name, a town.">
                    <input className="inp" id="share-extra" value={extra} onChange={(e) => setExtra(e.target.value)} />
                  </Field>
                  <button type="button" className="btn btn-secondary" disabled={preview.state === "saving"} onClick={() => load(extraNames)}>
                    Update preview
                  </button>
                </div>
                <details>
                  <summary className="b">See exactly what will be shared</summary>
                  <div style={{ marginTop: "12px" }}>
                    <SnapshotPreview snapshot={shown.snapshot} />
                  </div>
                </details>
                <Field id="share-title" label="Title in the gallery" required error={problemFor(submit.error, "title")}>
                  <input className="inp" id="share-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
                </Field>
                <Field id="share-summary" label="Summary" required help="Two or three sentences: what it is for, and who it suits." error={problemFor(submit.error, "summary")}>
                  <textarea className="ta" id="share-summary" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={1000} />
                </Field>
                {TAG_GROUPS.map((g) => (
                  <fieldset key={g.key} style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend className="lbl">{g.label}</legend>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: "6px" }}>
                      {g.values.map((v) => (
                        <label key={v} className="cb">
                          <input type="checkbox" checked={tags[g.key].includes(v)} onChange={() => toggle(g.key, v)} />
                          <span>{v}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
                <label className="cb">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  <span>
                    I agree to share it under{" "}
                    <a href={LICENCE.url} target="_blank" rel="license noreferrer">
                      {LICENCE.name}
                    </a>
                    : anyone may use and change it, with credit to {ws.name}.
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
            Done
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!ready || submit.state === "saving"} onClick={send}>
              <Share2 className="ic" aria-hidden="true" />
              Send for review
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}

/** One button for a form, a rubric or an email template. Renders nothing for anyone but an admin. */
export function ShareToGalleryButton({ source, name, small = false, disabledReason }: { source: GallerySource; name: string; small?: boolean; disabledReason?: string }) {
  const canShare = useCanShare();
  const [open, setOpen] = useState(false);
  if (!canShare) return null;
  return (
    <>
      <button type="button" className={small ? "btn btn-sm btn-secondary" : "btn btn-secondary"} onClick={() => setOpen(true)} disabled={!!disabledReason} title={disabledReason}>
        <Share2 className="ic" aria-hidden="true" />
        Share to the gallery<span className="sr">: {name}</span>
      </button>
      {open && <ShareDialog source={source} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

/** What the workspace has shared: the moderator's decision and reason, and withdraw. */
export function GallerySubmissionsPanel() {
  const ws = useWorkspace("funder");
  const canShare = useCanShare();
  const list = useGalleryQuery((api) => api.submissions(ws.id), [ws.id]);
  const withdraw = useGalleryMutation((api, id: string) => api.withdraw(ws.id, id));
  if (list.status === "ready" && list.data.length === 0) return null;
  return (
    <section className="card" aria-labelledby="shared-gallery-title">
      <div className="card-h">
        <h3 id="shared-gallery-title">Shared to the gallery</h3>
        <Link to="/templates" className="btn btn-sm btn-ghost">
          <LayoutTemplate className="ic" aria-hidden="true" />
          Template gallery
        </Link>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {list.status === "loading" && <Loading label="Loading what you shared" />}
        {list.status === "error" && <ErrorBanner error={list.error} onRetry={list.reload} />}
        {withdraw.error !== null && <ErrorBanner error={withdraw.error} title="It could not be withdrawn" />}
        {list.status === "ready" && (
          <ul aria-label="Shared to the gallery" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "12px" }}>
            {list.data.map((s) => (
              <li key={s.id} style={{ display: "flex", flexDirection: "column", gap: "4px", borderBottom: "1px solid var(--og-gray-200)", paddingBottom: "10px" }}>
                <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
                  <span className="b">{s.title}</span>
                  <span className="tag">{KIND_LABEL[s.kind]}</span>
                  <SubmissionBadge status={s.status} />
                  <span className="small muted">Sent {formatDate(s.createdAt)}</span>
                </div>
                {s.status === "rejected" && s.decisionReason && (
                  <p className="small">
                    <span className="b">Why it was declined: </span>
                    {s.decisionReason}
                  </p>
                )}
                {s.status === "approved" && s.item?.live && (
                  <p className="small">
                    Published at <Link to={`/templates/${s.item.slug}`}>/templates/{s.item.slug}</Link>
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
                      Withdraw<span className="sr">: {s.title}</span>
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
