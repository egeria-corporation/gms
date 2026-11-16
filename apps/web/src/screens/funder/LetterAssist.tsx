// SPDX-License-Identifier: AGPL-3.0-only
// Communications → draft a letter from a saved template with the assistant. The draft appears
// here for the person to read and copy; it is never written into the template, saved as a version
// or sent. Rendered only when the install has the assistant switched on.
import { useEffect, useState } from "react";
import { Bot, Sparkles } from "lucide-react";
import type { LetterDraft } from "../../api/funderFull.ts";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import { CopyButton } from "../../components/CopyButton.tsx";
import { quotaSpent, QuotaSpentNote } from "../../components/launch.tsx";
import { ErrorBanner } from "../../components/ui.tsx";
import { t } from "./i18n.ts";

const PURPOSES = [
  ["decision", "Decision"],
  ["award", "Award"],
  ["decline", "Decline"],
  ["revision request", "Revision request"],
  ["reminder", "Reminder"],
] as const;

export function LetterAssistant({ templateId, templateName }: { templateId: string; templateName: string }) {
  const status = useApiQuery((api) => api.assistStatus(), []);
  const [purpose, setPurpose] = useState<string>("decision");
  const [tone, setTone] = useState("");
  const [draft, setDraft] = useState<LetterDraft | null>(null);
  const write = useApiMutation((api) => api.assistDraftLetter(templateId, { purpose, ...(tone.trim() ? { tone: tone.trim() } : {}) }));
  const reset = write.reset;
  // A draft belongs to the template it was written from.
  useEffect(() => {
    setDraft(null);
    reset();
  }, [templateId, reset]);
  if (!status.data?.enabled) return null;
  const quota = draft?.quota ?? status.data.quota;
  const spent = quotaSpent(quota);

  return (
    <section className="assist" aria-labelledby="letter-assist-h">
      <div className="hd">
        <Sparkles className="ic" aria-hidden="true" style={{ color: "var(--s-agent-fg)" }} />
        <h4 id="letter-assist-h">{t("letterAssist.assistant")}</h4>
        <span className="draft-mark">{t("letterAssist.draftReviewBeforeUse")}</span>
        {quota && (
          <span className="quota">
            {t("letterAssist.ofThisMonth", { used: quota.used, limit: quota.limit })}
          </span>
        )}
      </div>
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px", fontSize: "13px" }}>
        <p className="muted small">{t("letterAssist.draftsALetterFrom", { templateName })}</p>
        <div className="row wrap" style={{ gap: "12px", alignItems: "flex-end" }}>
          <div className="fld" style={{ flex: "0 1 200px" }}>
            <label className="lbl" htmlFor="letter-assist-purpose">
              {t("letterAssist.purpose")}
            </label>
            <select id="letter-assist-purpose" className="sel" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
              {PURPOSES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="fld" style={{ flex: "1 1 220px" }}>
            <label className="lbl" htmlFor="letter-assist-tone">
              {t("letterAssist.toneOptional")}
            </label>
            <input id="letter-assist-tone" className="inp" value={tone} maxLength={120} placeholder={t("letterAssist.warmAndPlain")} onChange={(e) => setTone(e.target.value)} />
          </div>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={spent || write.state === "saving"}
            onClick={async () => {
              const r = await write.run();
              if (r) setDraft(r);
            }}
          >
            {write.state === "saving" ? t("letterAssist.drafting") : t("letterAssist.draftALetter")}
          </button>
        </div>
        {spent && <QuotaSpentNote resetsAt={quota?.resetsAt} />}
        {write.error !== null && <ErrorBanner error={write.error} title={t("letterAssist.theAssistantCouldNot")} />}
        {draft && (
          <div role="group" aria-label={t("letterAssist.letterDraft")} style={{ border: "1px dashed var(--s-agent-fg)", borderRadius: "8px", padding: "14px 16px", background: "var(--s-agent-bg)", display: "flex", flexDirection: "column", gap: "8px", fontSize: "14px" }}>
            <span className="attrib">
              <Bot className="ic" aria-hidden="true" />
              {t.rich("letterAssist.draftByGmsAssistant", { span: (chunks) => <span className="ag">{chunks}</span> })}
            </span>
            {draft.subject && <div className="b">{draft.subject}</div>}
            <div style={{ whiteSpace: "pre-wrap" }}>{draft.body}</div>
            {draft.cautions.length > 0 && (
              <ul className="small muted" aria-label={t("letterAssist.cautions")} style={{ paddingLeft: "18px" }}>
                {draft.cautions.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
            <div className="row wrap" style={{ gap: "10px" }}>
              <CopyButton value={draft.subject ? `${draft.subject}\n\n${draft.body}` : draft.body} what="the draft" label={t("letterAssist.copyDraft")} className="btn btn-sm btn-primary" />
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setDraft(null)}>
                {t("letterAssist.discard")}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
