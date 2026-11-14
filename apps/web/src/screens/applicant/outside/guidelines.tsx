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

/** As the API: pasted guidelines up to this many characters. */
export const GUIDELINES_MAX_CHARS = 60_000;
const READABLE = /\.(pdf|txt)$/i;

export function GuidelinesReader({ applicationId, assist, onRead }: { applicationId: string; assist: AssistStatus; onRead: (r: GuidelinesRead) => void }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const read = useWKMutation(async (api) => {
    if (file) return api.uploadGuidelines(applicationId, { name: file.name, mime: file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : "text/plain"), contentBase64: await toBase64(file) });
    return api.readGuidelines(applicationId, text);
  });
  const spent = quotaSpent(assist.quota);
  const tooLong = text.length > GUIDELINES_MAX_CHARS;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <Field
        id="gl-text"
        label="The funder’s guidelines"
        help={
          <span className={tooLong ? "err-msg" : undefined}>
            {text.length.toLocaleString("en-US")} of {GUIDELINES_MAX_CHARS.toLocaleString("en-US")} characters
          </span>
        }
      >
        <textarea id="gl-text" className={tooLong ? "ta err" : "ta"} style={{ minHeight: "180px" }} disabled={!!file} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the request for proposals, the guidelines page or the portal’s instructions." />
      </Field>
      <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
        <span className="small muted">Or upload them:</span>
        <label className="btn btn-sm btn-secondary" style={{ cursor: "pointer" }}>
          <FileUp className="ic" aria-hidden="true" />
          {file ? "Choose another file" : "Upload a PDF or text file"}
          <input
            type="file"
            className="sr"
            accept=".pdf,.txt,application/pdf,text/plain"
            aria-label="Upload the funder’s guidelines"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.target.value = "";
              setProblem(null);
              if (!f) return;
              if (!READABLE.test(f.name)) return setProblem("Upload the guidelines as a PDF or a plain text (.txt) file.");
              if (f.size > MAX_UPLOAD_BYTES) return setProblem(`${f.name} is larger than 10 MB. Upload a smaller file, or paste the text.`);
              setFile(f);
            }}
          />
        </label>
        {file && (
          <span className="row small" style={{ gap: "6px" }}>
            <span className="b">{file.name}</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFile(null)}>
              Remove
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
        <span>Only the guidelines you paste or upload here are read by AI, never your document vault. It looks for questions, limits, deadlines and required documents, and ignores anything personal. An uploaded file (up to 50 pages) is kept with this application. Each reading uses one AI draft.</span>
      </p>
      {spent ? <QuotaSpentNote resetsAt={assist.quota?.resetsAt} /> : null}
      {read.error ? <ErrorBanner error={read.error} title="The guidelines could not be read" /> : null}
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
        {read.state === "saving" ? "Reading…" : "Read the guidelines"}
      </button>
    </div>
  );
}
