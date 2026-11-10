// SPDX-License-Identifier: AGPL-3.0-only
// "Adapt to a question": the assistant rewrites a library answer for one question, within a word
// limit. The result is a draft the person copies and edits; nothing is written into an application.
// Hidden entirely unless the assistant is switched on for the workspace.
import { useState } from "react";
import { Bot, Sparkles } from "lucide-react";
import type { Answer } from "../../api/applicant.ts";
import type { AdaptedDraft } from "../../api/applicantFull.ts";
import { useFullMutation, useFullQuery } from "../../api/applicantFullHooks.ts";
import { CopyButton } from "../../components/CopyButton.tsx";
import { ErrorBanner, Field } from "../../components/ui.tsx";

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export function AdaptPanel({ answer }: { answer: Answer }) {
  const status = useFullQuery((api) => api.assistStatus(), []);
  const [question, setQuestion] = useState("");
  const [maxWords, setMaxWords] = useState("500");
  const [draft, setDraft] = useState<AdaptedDraft | null>(null);
  const adapt = useFullMutation((api, input: { question: string; maxWords?: number }) => api.adaptAnswer(answer.id, input));
  if (status.status !== "ready" || !status.data.enabled) return null;
  const quota = status.data.quota;
  const limit = Number.parseInt(maxWords, 10);
  const run = async () => {
    const r = await adapt.run({ question: question.trim(), ...(Number.isFinite(limit) && limit > 0 ? { maxWords: limit } : {}) });
    if (r) {
      setDraft(r);
      status.reload();
    }
  };
  return (
    <section className="assist" aria-labelledby="adapt-h">
      <div className="hd">
        <Sparkles className="ic" aria-hidden="true" style={{ color: "var(--s-agent-fg)" }} />
        <h3 id="adapt-h">Adapt “{answer.title}” to a question</h3>
        <span className="draft-mark">Draft — review before use</span>
        {quota && quota.limit !== undefined ? (
          <span className="quota">
            {quota.used ?? 0} of {quota.limit} this month
          </span>
        ) : null}
      </div>
      <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <Field id="adapt-question" label="Target question" help="Paste the question from the application.">
          <textarea id="adapt-question" className="ta" style={{ minHeight: "56px" }} value={question} onChange={(e) => setQuestion(e.target.value)} />
        </Field>
        <Field id="adapt-limit" label="Word limit">
          <input id="adapt-limit" className="inp" inputMode="numeric" style={{ maxWidth: "120px" }} value={maxWords} onChange={(e) => setMaxWords(e.target.value)} />
        </Field>
        <dl className="kv" style={{ fontSize: "14px" }}>
          <dt>Source</dt>
          <dd>
            {answer.title} v{answer.version} ({answer.words} words)
          </dd>
        </dl>
        <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" disabled={!question.trim() || adapt.state === "saving"} onClick={() => void run()}>
            <Sparkles className="ic" aria-hidden="true" />
            {adapt.state === "saving" ? "Adapting…" : "Adapt"}
          </button>
          <span className="help">Nothing is written into an application until you insert it yourself.</span>
        </div>
        {adapt.error ? <ErrorBanner error={adapt.error} title="The assistant could not draft this" /> : null}
        {draft ? (
          <div style={{ border: "1px dashed var(--s-agent-fg)", borderRadius: "8px", padding: "14px 16px", background: "var(--s-agent-bg)", display: "flex", flexDirection: "column", gap: "8px", fontSize: "15px" }} role="status">
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
              <span className="attrib">
                <Bot className="ic" aria-hidden="true" />
                Draft by <span className="ag">GMS Assistant</span>
              </span>
              <span className={draft.overLimit ? "counter over" : "counter"}>
                {words(draft.text)}
                {Number.isFinite(limit) && limit > 0 ? ` / ${limit}` : ""} words
              </span>
            </div>
            <p style={{ whiteSpace: "pre-wrap" }}>{draft.text}</p>
            <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
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
