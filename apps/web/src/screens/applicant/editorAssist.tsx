// SPDX-License-Identifier: AGPL-3.0-only
// The editor's assistant panel: adapt a library answer to the question in focus. Output is a draft
// shown in the panel; nothing is written into the form until the person copies it in themselves.
// Renders nothing unless the assistant is switched on for the workspace.
import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { Answer } from "../../api/applicant.ts";
import type { AdaptedDraft } from "../../api/applicantFull.ts";
import { useFullMutation, useFullQuery } from "../../api/applicantFullHooks.ts";
import { CopyButton } from "../../components/CopyButton.tsx";
import { ErrorBanner } from "../../components/ui.tsx";

export function EditorAssistant({ answers, fields }: { answers: Answer[]; fields: { key: string; label: string }[] }) {
  const status = useFullQuery((api) => api.assistStatus(), []);
  const [answerId, setAnswerId] = useState(answers[0]?.id ?? "");
  const [field, setField] = useState(fields[0]?.key ?? "");
  const [draft, setDraft] = useState<AdaptedDraft | null>(null);
  const adapt = useFullMutation((api, id: string, question: string) => api.adaptAnswer(id, { question }));
  if (status.status !== "ready" || !status.data.enabled || answers.length === 0 || fields.length === 0) return null;
  const quota = status.data.quota;
  const question = fields.find((f) => f.key === field)?.label ?? "";
  const run = async () => {
    const r = await adapt.run(answerId, question);
    if (r) {
      setDraft(r);
      status.reload();
    }
  };
  return (
    <section className="assist" aria-labelledby="ed-assist-h">
      <div className="hd">
        <Sparkles className="ic" aria-hidden="true" style={{ color: "var(--s-agent-fg)" }} />
        <h3 id="ed-assist-h">Assistant</h3>
        <span className="draft-mark">Draft — review before use</span>
        {quota && quota.limit !== undefined ? (
          <span className="quota">
            {quota.used ?? 0} of {quota.limit} this month
          </span>
        ) : null}
      </div>
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "14px" }}>
        <p>Adapt a library answer to a question on this form. Output appears here first; nothing is written into the form until you insert it.</p>
        <div className="fld">
          <label className="lbl" htmlFor="ed-assist-answer">
            Library answer
          </label>
          <select className="sel" id="ed-assist-answer" value={answerId} onChange={(e) => setAnswerId(e.target.value)}>
            {answers.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </div>
        <div className="fld">
          <label className="lbl" htmlFor="ed-assist-field">
            Question
          </label>
          <select className="sel" id="ed-assist-field" value={field} onChange={(e) => setField(e.target.value)}>
            {fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn btn-sm btn-secondary" style={{ alignSelf: "flex-start" }} disabled={adapt.state === "saving"} onClick={() => void run()}>
          {adapt.state === "saving" ? "Adapting…" : "Adapt to this question"}
        </button>
        {adapt.error ? <ErrorBanner error={adapt.error} title="The assistant could not draft this" /> : null}
        {draft ? (
          <div role="status" style={{ border: "1px dashed var(--s-agent-fg)", borderRadius: "8px", padding: "10px 12px", background: "var(--s-agent-bg)", display: "flex", flexDirection: "column", gap: "8px" }}>
            <p style={{ whiteSpace: "pre-wrap" }}>{draft.text}</p>
            <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
              <CopyButton value={draft.text} what="the draft" label="Copy draft" className="btn btn-sm btn-primary" />
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setDraft(null)}>
                Discard
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
