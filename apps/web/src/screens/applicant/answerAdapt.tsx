// SPDX-License-Identifier: AGPL-3.0-only
// "Adapt to a question": the assistant rewrites a library answer for one question, within a word
// limit. The result is a draft the person copies and edits; nothing is written into an application.
// Hidden entirely unless the assistant is switched on for the workspace.
import { quotaSpent, QuotaSpentNote } from "../../components/launch.tsx";
import { useState } from "react";
import { Bot, Sparkles } from "lucide-react";
import type { Answer } from "../../api/applicant.ts";
import type { AdaptedDraft } from "../../api/applicantFull.ts";
import { useFullMutation, useFullQuery } from "../../api/applicantFullHooks.ts";
import { CopyButton } from "../../components/CopyButton.tsx";
import { ErrorBanner, Field } from "../../components/ui.tsx";
import { t } from "./i18n.ts";

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export function AdaptPanel({ answer }: { answer: Answer }) {
  const status = useFullQuery((api) => api.assistStatus(), []);
  const [question, setQuestion] = useState("");
  const [maxWords, setMaxWords] = useState("500");
  const [draft, setDraft] = useState<AdaptedDraft | null>(null);
  const adapt = useFullMutation((api, input: { question: string; maxWords?: number }) => api.adaptAnswer(answer.id, input));
  if (status.status !== "ready" || !status.data.enabled) return null;
  const quota = status.data.quota;
  const spent = quotaSpent(quota);
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
        <h3 id="adapt-h">{t("answerAdapt.title", { title: answer.title })}</h3>
        <span className="draft-mark">{t("answerAdapt.draftReviewBeforeUse")}</span>
        {quota && quota.limit !== undefined ? (
          <span className="quota">
            {t("answerAdapt.quota", { used: quota.used ?? 0, limit: quota.limit })}
          </span>
        ) : null}
      </div>
      <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <Field id="adapt-question" label={t("answerAdapt.targetQuestion")} help={t("answerAdapt.pasteTheQuestionFromTheApplication")}>
          <textarea id="adapt-question" className="ta" style={{ minHeight: "56px" }} value={question} onChange={(e) => setQuestion(e.target.value)} />
        </Field>
        <Field id="adapt-limit" label={t("answerAdapt.wordLimit")}>
          <input id="adapt-limit" className="inp" inputMode="numeric" style={{ maxWidth: "120px" }} value={maxWords} onChange={(e) => setMaxWords(e.target.value)} />
        </Field>
        <dl className="kv" style={{ fontSize: "14px" }}>
          <dt>{t("answerAdapt.source")}</dt>
          <dd>
            {t("answerAdapt.sourceLine", { title: answer.title, version: String(answer.version), count: answer.words })}
          </dd>
        </dl>
        <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" disabled={spent || !question.trim() || adapt.state === "saving"} onClick={() => void run()}>
            <Sparkles className="ic" aria-hidden="true" />
            {adapt.state === "saving" ? t("answerAdapt.adapting") : t("answerAdapt.adapt")}
          </button>
          <span className="help">{t("answerAdapt.nothingIsWrittenIntoAnApplication")}</span>
        </div>
        {spent ? <QuotaSpentNote resetsAt={quota?.resetsAt} /> : null}
        {adapt.error ? <ErrorBanner error={adapt.error} title={t("answerAdapt.theAssistantCouldNotDraftThis")} /> : null}
        {draft ? (
          <div style={{ border: "1px dashed var(--s-agent-fg)", borderRadius: "8px", padding: "14px 16px", background: "var(--s-agent-bg)", display: "flex", flexDirection: "column", gap: "8px", fontSize: "15px" }} role="status">
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
              <span className="attrib">
                <Bot className="ic" aria-hidden="true" />
                {t.rich("answerAdapt.draftBy", { ag: (chunks) => <span className="ag">{chunks}</span> })}
              </span>
              <span className={draft.overLimit ? "counter over" : "counter"}>
                {Number.isFinite(limit) && limit > 0 ? t("answerAdapt.wordsOfLimit", { count: words(draft.text), limit }) : t("answerAdapt.wordsCount", { count: words(draft.text) })}
              </span>
            </div>
            <p style={{ whiteSpace: "pre-wrap" }}>{draft.text}</p>
            <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
              <CopyButton value={draft.text} what={t("answerAdapt.theDraft")} label={t("answerAdapt.copyDraft")} className="btn btn-sm btn-primary" />
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setDraft(null)}>
                {t("answerAdapt.discard")}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
