// SPDX-License-Identifier: AGPL-3.0-only
// "What we email you": the opt-in Monday digests for the signed-in person in one workspace, each
// off until they turn it on, with a preview of next Monday's email. Shown in the digest settings
// beside the notifications list and in the applicant workspace's Settings (the same choices).
import { Eye, EyeOff, Mail, MailX } from "lucide-react";
import { useState } from "react";
import { mondayLabel, type DigestChoice, type DigestPreview, type DigestSettings } from "../../api/digests.ts";
import { useDigestsApi, useDigestsQuery } from "../../api/digestsHooks.ts";
import { ErrorBanner, SaveNote } from "../../components/ui.tsx";

function Preview({ preview }: { preview: DigestPreview }) {
  if (!preview.willSend || !preview.text) {
    return (
      <p className="small muted" role="status">
        Nothing new to send yet. If that is still true on {mondayLabel(preview.sendsOn)}, no email goes out.
      </p>
    );
  }
  return (
    <div role="region" aria-label={`Preview of ${preview.label} email`} style={{ border: "1px solid var(--og-gray-200)", borderRadius: "8px", background: "var(--og-gray-50)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "8px" }}>
      <div className="small">
        <span className="muted">Subject: </span>
        <strong>{preview.subject}</strong>
      </div>
      <div className="mono" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "320px", overflowY: "auto" }} tabIndex={0}>
        {preview.text}
      </div>
    </div>
  );
}

function Choice({ workspaceId, choice, nextSendOn, onChange }: { workspaceId: string; choice: DigestChoice; nextSendOn: string; onChange: (next: DigestSettings) => void }) {
  const api = useDigestsApi();
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<unknown>(null);
  const [preview, setPreview] = useState<DigestPreview | null>(null);
  const [showing, setShowing] = useState(false);
  const [loading, setLoading] = useState(false);
  const id = `digest-${choice.key}`;

  const toggle = async () => {
    setState("saving");
    setError(null);
    try {
      onChange(await api.save(workspaceId, { [choice.key]: !choice.on }));
      setState("saved");
      if (choice.on) setShowing(false);
    } catch (e) {
      setError(e);
      setState("idle");
    }
  };
  const showPreview = async () => {
    if (showing) return setShowing(false);
    setLoading(true);
    setError(null);
    try {
      setPreview(await api.preview(workspaceId, choice.key));
      setShowing(true);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div className="row" style={{ justifyContent: "space-between", gap: "12px", alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <strong id={id}>{choice.label}</strong>
          <span className="small muted" id={`${id}-d`}>
            {choice.description}
          </span>
          <span className="small" role="status">
            {choice.on ? <Mail className="ic ic-sm" aria-hidden="true" /> : <MailX className="ic ic-sm" aria-hidden="true" />} {choice.on ? `On: next email ${mondayLabel(nextSendOn)}, if there is something new` : "Off"}
          </span>
        </div>
        <button type="button" className={`tog${choice.on ? " on" : ""}`} role="switch" aria-checked={choice.on} aria-labelledby={id} aria-describedby={`${id}-d`} disabled={state === "saving"} onClick={() => void toggle()}></button>
      </div>
      {choice.on ? (
        <div className="row" style={{ gap: "8px" }}>
          <button type="button" className="btn btn-sm btn-ghost" aria-expanded={showing} disabled={loading} onClick={() => void showPreview()}>
            {showing ? <EyeOff className="ic" aria-hidden="true" /> : <Eye className="ic" aria-hidden="true" />}
            {showing ? "Hide the preview" : "Preview next Monday's email"}
          </button>
          <SaveNote state={state} />
        </div>
      ) : null}
      {showing && preview ? <Preview preview={preview} /> : null}
      {error ? <ErrorBanner error={error} title="That did not work" /> : null}
    </div>
  );
}

/** The section itself, for one workspace. Renders nothing when the person is offered no digest there. */
export function WhatWeEmailYou({ workspaceId, heading = "h3" }: { workspaceId: string; heading?: "h2" | "h3" }) {
  const query = useDigestsQuery((api) => api.settings(workspaceId), [workspaceId]);
  if (query.status === "loading") return <p className="small muted">Loading what we email you…</p>;
  if (query.status === "error") return <ErrorBanner error={query.error} onRetry={query.reload} title="What we email you could not be loaded" />;
  const settings = query.data;
  if (!settings.digests.length) return null;
  const H = heading;
  return (
    <section aria-labelledby={`wwe-${workspaceId}`} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div>
        <H id={`wwe-${workspaceId}`} style={{ fontSize: "15px" }}>
          What we email you
        </H>
        <p className="small muted">Weekly emails you choose, on Mondays. Each is off until you turn it on, and every email has a link to stop it.</p>
      </div>
      {!settings.emailAvailable ? <p className="small muted">Email is not set up on this installation yet, so nothing is sent until it is.</p> : null}
      {settings.digests.map((c) => (
        <Choice key={c.key} workspaceId={workspaceId} choice={c} nextSendOn={settings.nextSendOn} onChange={query.set} />
      ))}
    </section>
  );
}

/** As a card, for the workspace Settings screen. */
export function WhatWeEmailYouCard({ workspaceId }: { workspaceId: string }) {
  return (
    <div className="card" id="digests">
      <div className="card-b">
        <WhatWeEmailYou workspaceId={workspaceId} heading="h2" />
      </div>
    </div>
  );
}
