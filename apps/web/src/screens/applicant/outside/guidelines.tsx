// SPDX-License-Identifier: AGPL-3.0-only
// "Read the funder's guidelines": the person pastes the guidelines or uploads them (a PDF or a
// plain text file), and the assistant proposes the questions, their limits and the documents the
// funder asks for. Only what is pasted or uploaded here is ever read by AI, never the vault.
// Nothing is saved until the person reviews and saves (in the paste dialog).
import { useState } from "react";
import { FileUp, Lock, Sparkles } from "lucide-react";
import type { AssistStatus } from "../../../api/applicantFull.ts";
import type { GuidelinesRead } from "../../../api/writeKeep.ts";
import { useWKMutation } from "../../../api/writeKeepHooks.ts";
import { quotaSpent, QuotaSpentNote } from "../../../components/launch.tsx";
import { ErrorBanner, Field } from "../../../components/ui.tsx";
import { MAX_UPLOAD_BYTES, toBase64 } from "./shared.tsx";
import { t } from "../i18n.ts";

/** As the API: pasted guidelines up to this many characters. */
export const GUIDELINES_MAX_CHARS = 60_000;
const READABLE = /\.(pdf|txt)$/i;

export function GuidelinesReader({ applicationId, assist, onRead }: { applicationId: string; assist: AssistStatus; onRead: (r: GuidelinesRead) => void }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const read = useWKMutation(async (api) => {
    if (file) return api.uploadGuidelines(applicationId, { name: file.name, mime: /\.pdf$/i.test(file.name) ? "application/pdf" : "text/plain", contentBase64: await toBase64(file) });
    return api.readGuidelines(applicationId, text);
  });
  const spent = quotaSpent(assist.quota);
  const tooLong = text.length > GUIDELINES_MAX_CHARS;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <Field
        id="gl-text"
        label={t("outsideGuidelines.theFundersGuidelines")}
        help={
          <span className={tooLong ? "err-msg" : undefined}>
            {t("outsideGuidelines.charCount", { count: text.length, max: GUIDELINES_MAX_CHARS })}
          </span>
        }
      >
        <textarea id="gl-text" className={tooLong ? "ta err" : "ta"} style={{ minHeight: "180px" }} disabled={!!file} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("outsideGuidelines.pasteTheRequestForProposalsThe")} />
      </Field>
      <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
        <span className="small muted">{t("outsideGuidelines.orUploadThem")}</span>
        <label className="btn btn-sm btn-secondary" style={{ cursor: "pointer" }}>
          <FileUp className="ic" aria-hidden="true" />
          {file ? t("outsideGuidelines.chooseAnotherFile") : t("outsideGuidelines.uploadAPdfOrTextFile")}
          <input
            type="file"
            className="sr"
            accept=".pdf,.txt,application/pdf,text/plain"
            aria-label={t("outsideGuidelines.uploadTheFundersGuidelines")}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.target.value = "";
              setProblem(null);
              if (!f) return;
              if (!READABLE.test(f.name)) return setProblem(t("outsideGuidelines.wrongType"));
              if (f.size > MAX_UPLOAD_BYTES) return setProblem(t("outsideGuidelines.tooLarge", { name: f.name }));
              setFile(f);
            }}
          />
        </label>
        {file && (
          <span className="row small" style={{ gap: "6px" }}>
            <span className="b">{file.name}</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFile(null)}>
              {t("outsideGuidelines.remove")}
            </button>
          </span>
        )}
      </div>
      {problem && (
        <p className="err-msg" role="alert">
          {problem}
        </p>
      )}
      <p className="small muted row" style={{ gap: "6px", alignItems: "flex-start" }}>
        <Lock className="ic ic-sm" aria-hidden="true" style={{ marginTop: "2px" }} />
        <span>{t("outsideGuidelines.onlyTheGuidelinesYouPasteOr")}</span>
      </p>
      {spent ? <QuotaSpentNote resetsAt={assist.quota?.resetsAt} /> : null}
      {read.error ? <ErrorBanner error={read.error} title={t("outsideGuidelines.theGuidelinesCouldNotBeRead")} /> : null}
      <button
        type="button"
        className="btn btn-primary"
        style={{ alignSelf: "flex-start" }}
        disabled={spent || read.state === "saving" || (!file && (!text.trim() || tooLong))}
        onClick={async () => {
          const r = await read.run();
          if (r) onRead(r);
        }}
      >
        <Sparkles className="ic" aria-hidden="true" />
        {read.state === "saving" ? t("outsideGuidelines.reading") : t("outsideGuidelines.readTheGuidelines")}
      </button>
    </div>
  );
}
