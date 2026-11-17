// SPDX-License-Identifier: AGPL-3.0-only
// The post composer: the person edits the text (prefilled from the call or the award), picks the
// workspace's accounts, keeps or drops the share card, and posts now or schedules. Before anything
// goes out the composer shows the exact post as it will be sent: text, picture, accounts and time.
// Only the Post button on that preview sends it, once: a retry sends the same Idempotency-Key.
import { useMemo, useRef, useState } from "react";
import { CalendarClock, CircleCheck, ExternalLink, Eye, ImageIcon, PenLine, Send } from "lucide-react";
import { lengthCheck, type Platform } from "@gms/social";
import type { SocialAccount, SocialComposeInput, SocialDraft, SocialPost, SocialPreview, SocialSettings } from "../api/social.ts";
import { useSocialMutation } from "../api/socialHooks.ts";
import { Dialog } from "./Dialog.tsx";
import { PostStatusBadge } from "./ReachPanel.tsx";
import { ErrorBanner, Notice } from "./ui.tsx";

const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};
const zones = (): string[] => {
  const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  const here = browserZone();
  return [...new Set([here, "UTC", ...all])];
};
const whenText = (iso: string | null | undefined, tz: string) =>
  iso ? new Date(iso).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }) : "";

export function PostComposer({ open, onClose, draft, settings, onPosted }: { open: boolean; onClose: () => void; draft: SocialDraft; settings: SocialSettings; onPosted: (post: SocialPost) => void }) {
  const accounts: SocialAccount[] = settings.accounts;
  const [suggestion, setSuggestion] = useState(0);
  const [text, setText] = useState(draft.suggestions[0]?.text ?? "");
  const [chosen, setChosen] = useState<string[]>(() => accounts.map((a) => a.id));
  const [includeImage, setIncludeImage] = useState(!!draft.imageUrl);
  const [mode, setMode] = useState<"now" | "later">("now");
  const [at, setAt] = useState("");
  const [zone, setZone] = useState(browserZone);
  const [stage, setStage] = useState<"edit" | "preview" | "done">("edit");
  const [preview, setPreview] = useState<SocialPreview | null>(null);
  const [posted, setPosted] = useState<SocialPost | null>(null);
  // One key per logical post: kept while the previewed body stays the same, so a retry posts once.
  const keyFor = useRef<{ body: string; key: string } | null>(null);
  const zoneList = useMemo(zones, []);

  const input: SocialComposeInput = { subject: { type: draft.subject.type, id: draft.subject.id }, content: text, accountIds: chosen, includeImage, schedule: mode === "later" ? { scheduledFor: at, timezone: zone } : null };
  const doPreview = useSocialMutation((api, i: SocialComposeInput) => api.preview(i));
  const doPost = useSocialMutation((api, i: SocialComposeInput & { previewToken: string }, key: string) => api.post(i, key));
  const selected = accounts.filter((a) => chosen.includes(a.id));
  const platforms = [...new Set(selected.map((a) => a.platform))] as Platform[];
  const lengths = platforms.map((p) => lengthCheck(p, text));

  const toPreview = async () => {
    const p = await doPreview.run(input);
    if (!p) return;
    const body = JSON.stringify(p.body);
    if (keyFor.current?.body !== body) keyFor.current = { body, key: crypto.randomUUID() };
    setPreview(p);
    setStage("preview");
  };
  const send = async () => {
    if (!preview?.previewToken || !keyFor.current) return;
    const post = await doPost.run({ ...input, previewToken: preview.previewToken }, keyFor.current.key);
    if (!post) return;
    setPosted(post);
    setStage("done");
    onPosted(post);
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy="composer-title" size="lg">
      <div className="hd">
        <div>
          <h2 id="composer-title" style={{ fontSize: "16px" }}>
            {stage === "edit" ? "Write a post" : stage === "preview" ? "Check the post" : posted?.status === "scheduled" ? "Post scheduled" : "Posted"}
          </h2>
          <p className="small muted" style={{ marginTop: "4px" }}>
            About {draft.subject.title}. It goes to your own accounts through Zernio, and only when you press Post.
          </p>
        </div>
      </div>

      {stage === "edit" && (
        <div className="bd">
          {draft.suggestions.length > 1 && (
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", gap: "16px", flexWrap: "wrap" }}>
              <legend className="lbl" style={{ marginBottom: "6px" }}>
                Start from
              </legend>
              {draft.suggestions.map((s, i) => (
                <label key={s.label} className="cb" htmlFor={`suggestion-${i}`}>
                  <input
                    type="radio"
                    id={`suggestion-${i}`}
                    name="suggestion"
                    checked={suggestion === i}
                    onChange={() => {
                      setSuggestion(i);
                      setText(s.text);
                    }}
                  />
                  <span>{s.label}</span>
                </label>
              ))}
            </fieldset>
          )}
          <div>
            <label className="lbl" htmlFor="post-text">
              Post text
            </label>
            <textarea id="post-text" className="ta" rows={7} value={text} onChange={(e) => setText(e.target.value)} />
            <div aria-label="Length on each platform" role="group" style={{ display: "flex", gap: "12px", justifyContent: "flex-end", flexWrap: "wrap", marginTop: "4px" }}>
              {lengths.map((l) => (
                <span key={l.platform} className={l.over ? "counter over" : "counter"}>
                  {l.label} {l.length.toLocaleString("en-US")} / {l.limit.toLocaleString("en-US")}
                  {l.over ? " · too long" : ""}
                </span>
              ))}
            </div>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
            <legend className="lbl" style={{ marginBottom: "6px" }}>
              Accounts
            </legend>
            {accounts.map((a) => (
              <label key={a.id} className="cb" htmlFor={`acct-${a.id}`}>
                <input type="checkbox" id={`acct-${a.id}`} checked={chosen.includes(a.id)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, a.id] : c.filter((x) => x !== a.id)))} style={{ marginTop: "3px" }} />
                <span>
                  <span className="b">{a.label}</span> {a.username && <span className="muted">{a.username}</span>}
                </span>
              </label>
            ))}
          </fieldset>
          {draft.imageUrl && (
            <label className="cb" htmlFor="post-image">
              <input type="checkbox" id="post-image" checked={includeImage} onChange={(e) => setIncludeImage(e.target.checked)} style={{ marginTop: "3px" }} />
              <span>
                <span className="b">Attach the share card</span>
                <span className="help" style={{ display: "block" }}>
                  <a href={draft.imageUrl} target="_blank" rel="noopener noreferrer">
                    View the share card
                    <ExternalLink className="ic" aria-hidden="true" />
                  </a>
                </span>
              </span>
            </label>
          )}
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
            <legend className="lbl" style={{ marginBottom: "6px" }}>
              When
            </legend>
            <label className="cb" htmlFor="when-now">
              <input type="radio" id="when-now" name="when" checked={mode === "now"} onChange={() => setMode("now")} />
              <span>Post now</span>
            </label>
            <label className="cb" htmlFor="when-later">
              <input type="radio" id="when-later" name="when" checked={mode === "later"} onChange={() => setMode("later")} />
              <span>Schedule</span>
            </label>
            {mode === "later" && (
              <div className="row wrap" style={{ gap: "12px" }}>
                <div>
                  <label className="lbl" htmlFor="when-at">
                    Date and time
                  </label>
                  <input id="when-at" type="datetime-local" className="inp" value={at} onChange={(e) => setAt(e.target.value)} />
                </div>
                <div>
                  <label className="lbl" htmlFor="when-zone">
                    Time zone
                  </label>
                  <select id="when-zone" className="sel" value={zone} onChange={(e) => setZone(e.target.value)}>
                    {zoneList.map((z) => (
                      <option key={z} value={z}>
                        {z.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </fieldset>
          {doPreview.error !== null && <ErrorBanner error={doPreview.error} title="The preview could not be made" />}
        </div>
      )}

      {stage === "preview" && preview && (
        <div className="bd">
          <p className="small b">This is exactly what will be posted.</p>
          <div className="card card-b" style={{ boxShadow: "none", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }} aria-label="Post text as it will appear" role="region">
            {preview.content}
          </div>
          <dl className="kv">
            <dt>Picture</dt>
            <dd>
              {preview.imageUrl ? (
                <a href={preview.imageUrl} target="_blank" rel="noopener noreferrer">
                  <ImageIcon className="ic" aria-hidden="true" /> The share card
                </a>
              ) : (
                "None"
              )}
            </dd>
            <dt>Accounts</dt>
            <dd>{preview.accounts.map((a) => `${a.label}${a.username ? ` (${a.username})` : ""}`).join(", ")}</dd>
            <dt>When</dt>
            <dd>{preview.publishNow ? "Now, when you press Post" : `${whenText(preview.schedule?.at, preview.schedule?.timezone ?? "UTC")} (${preview.schedule?.timezone ?? ""})`}</dd>
            {preview.lengths.map((l) => (
              <div key={l.platform} style={{ display: "contents" }}>
                <dt>{l.label}</dt>
                <dd>
                  {l.length.toLocaleString("en-US")} of {l.limit.toLocaleString("en-US")} characters{l.over ? " (too long)" : ""}
                </dd>
              </div>
            ))}
          </dl>
          {preview.problems.length > 0 && (
            <Notice tone="warn" title="Fix these before posting">
              <ul style={{ margin: 0, paddingLeft: "18px" }}>
                {preview.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Notice>
          )}
          {doPost.error !== null && <ErrorBanner error={doPost.error} title="The post did not go out" />}
        </div>
      )}

      {stage === "done" && posted && (
        <div className="bd">
          <div className="bnr bnr-ok" role="status">
            <CircleCheck className="ic" aria-hidden="true" />
            <div className="grow">
              <div className="t">{posted.status === "scheduled" ? "Scheduled with Zernio" : "Sent to Zernio"}</div>
              <div className="d">It shows under Reach with a link to each post once it is out.</div>
            </div>
          </div>
          <ul aria-label="Where it went" style={{ margin: 0, paddingLeft: "18px" }}>
            {posted.accounts.map((a) => (
              <li key={a.accountId} className="small">
                {a.label} {a.username ? `(${a.username})` : ""}{" "}
                {a.url && (
                  <a href={a.url} target="_blank" rel="noopener noreferrer">
                    View on {a.label}
                  </a>
                )}
              </li>
            ))}
          </ul>
          <PostStatusBadge status={posted.status} />
        </div>
      )}

      <div className="ft">
        {stage === "edit" && (
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!text.trim() || !chosen.length || (mode === "later" && !at) || doPreview.state === "saving"} onClick={toPreview}>
              <Eye className="ic" aria-hidden="true" />
              Preview
            </button>
          </>
        )}
        {stage === "preview" && (
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                doPost.reset();
                setStage("edit");
              }}
            >
              <PenLine className="ic" aria-hidden="true" />
              Edit
            </button>
            <button type="button" className="btn btn-primary" disabled={!preview?.previewToken || doPost.state === "saving"} onClick={send}>
              {preview?.publishNow ? <Send className="ic" aria-hidden="true" /> : <CalendarClock className="ic" aria-hidden="true" />}
              {preview?.publishNow ? "Post" : "Schedule post"}
            </button>
          </>
        )}
        {stage === "done" && (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        )}
      </div>
    </Dialog>
  );
}
