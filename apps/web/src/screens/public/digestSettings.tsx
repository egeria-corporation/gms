// SPDX-License-Identifier: AGPL-3.0-only
// Digest settings beside the notifications list: what reaches the person, per workspace, and how
// email is batched. The same preferences the workspace Settings screen edits.
import { useEffect, useState } from "react";
import type { MeWorkspace } from "../../api/client.ts";
import type { NotificationPreferences } from "../../api/applicantMore.ts";
import { useMoreApi } from "../../api/applicantMoreHooks.ts";
import { ErrorBanner, SaveNote } from "../../components/ui.tsx";

const EVENTS: { key: string; label: string }[] = [
  { key: "approval", label: "An agent needs my approval" },
  { key: "payment", label: "A payment is sent, settles or is paused" },
  { key: "submission", label: "A report is received or reviewed" },
  { key: "application", label: "An application changes status" },
  { key: "decision", label: "A decision is made" },
  { key: "agreement", label: "An agreement is sent or signed" },
  { key: "organization", label: "A Passport record or consent changes" },
];
const DIGESTS: { value: NotificationPreferences["digest"]; label: string }[] = [
  { value: "daily", label: "Daily digest" },
  { value: "weekly", label: "Weekly digest" },
  { value: "immediate", label: "Immediately, each event" },
  { value: "off", label: "Off" },
];

export function DigestSettings({ workspaces }: { workspaces: MeWorkspace[] }) {
  const [wsId, setWsId] = useState(workspaces[0]?.id ?? "");
  const api = useMoreApi(wsId || null);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!wsId) return;
    let live = true;
    setPrefs(null);
    setError(null);
    api.notificationPreferences(wsId).then(
      (p) => live && setPrefs(p),
      (e: unknown) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, [api, wsId]);

  const save = async (next: NotificationPreferences) => {
    setPrefs(next);
    setState("saving");
    setError(null);
    try {
      setPrefs(await api.saveNotificationPreferences(next, wsId));
      setState("saved");
    } catch (e) {
      setError(e);
      setState("idle");
    }
  };
  const on = (key: string) => prefs?.channels[key]?.inApp ?? true;
  const toggle = (key: string) => {
    if (!prefs) return;
    const current = prefs.channels[key] ?? { inApp: true, email: true };
    void save({ ...prefs, channels: { ...prefs.channels, [key]: { ...current, inApp: !current.inApp } } });
  };

  if (workspaces.length === 0) return null;
  return (
    <aside className="card" aria-labelledby="digest-h">
      <div className="card-h">
        <h2 id="digest-h" style={{ fontSize: "15px" }}>
          Digest settings
        </h2>
        <SaveNote state={state} />
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {workspaces.length > 1 ? (
          <div className="fld">
            <label className="lbl" htmlFor="digest-ws">
              Workspace
            </label>
            <select className="sel" id="digest-ws" value={wsId} onChange={(e) => setWsId(e.target.value)}>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div className="eyebrow">Notify me when</div>
          {EVENTS.map((e) => (
            <div className="row" style={{ justifyContent: "space-between", gap: "12px" }} key={e.key}>
              <span id={`digest-${e.key}`}>{e.label}</span>
              <button type="button" className={`tog${on(e.key) ? " on" : ""}`} role="switch" aria-checked={on(e.key)} aria-labelledby={`digest-${e.key}`} disabled={!prefs} onClick={() => toggle(e.key)}></button>
            </div>
          ))}
        </div>
        <div className="divider"></div>
        <div className="fld">
          <label className="lbl" htmlFor="digest">
            Email digest
          </label>
          <select className="sel" id="digest" value={prefs?.digest ?? "daily"} disabled={!prefs} onChange={(e) => prefs && void save({ ...prefs, digest: e.target.value as NotificationPreferences["digest"] })}>
            {DIGESTS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
          <span className="help">Approval requests are always shown at once in the app.</span>
        </div>
        {error ? <ErrorBanner error={error} title="Your settings were not saved" /> : null}
      </div>
    </aside>
  );
}
