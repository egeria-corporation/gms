// SPDX-License-Identifier: AGPL-3.0-only
// Styleguide: the form renderer drawing one library form in each of its four modes.
import { useState } from "react";
import { validateResponse, type JsonObject } from "@gms/forms";
import { FormView, type FormMode } from "../../forms/FormView.tsx";
import { LOI_FORM, LOI_PROVENANCE, LOI_RESPONSE } from "../../mocks/forms.ts";

const MODES: Array<{ mode: FormMode; label: string; note: string }> = [
  { mode: "edit", label: "Edit", note: "Applicant editor: inputs, inline validation, word counters, provenance, autosave." },
  {
    mode: "reviewer",
    label: "Reviewer",
    note: "Read-only. Fields not visible to reviewers are removed; PII is masked for external reviewers.",
  },
  { mode: "funder", label: "Funder", note: "Read-only with the source of every value." },
  { mode: "print", label: "Print", note: "Flat read-only layout used for the PDF snapshot." },
];

export default function FormRenderer() {
  const [mode, setMode] = useState<FormMode>("edit");
  const [response, setResponse] = useState<JsonObject>(LOI_RESPONSE);
  const [saved, setSaved] = useState<string | null>(null);
  const [external, setExternal] = useState(true);
  const current = MODES.find((m) => m.mode === mode)!;
  const { validationErrors } = validateResponse(LOI_FORM, response);

  return (
    <>
      <title>{"Form renderer — styleguide"}</title>
      <div className="gms gms-applicant gms-frame">
        <main className="main" style={{ maxWidth: "960px", width: "100%", margin: "0 auto" }}>
          <div className="ph">
            <div>
              <div className="title">
                <h1>Form renderer</h1>
                <span className="tag">
                  {LOI_FORM.title} · v{LOI_FORM.version}
                </span>
              </div>
              <div className="meta">
                <span>{current.note}</span>
              </div>
            </div>
            <div className="actions">
              <div className="seg" role="group" aria-label="Mode">
                {MODES.map((m) => (
                  <button
                    key={m.mode}
                    type="button"
                    className={m.mode === mode ? "on" : ""}
                    aria-pressed={m.mode === mode}
                    onClick={() => setMode(m.mode)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {mode === "edit" && (
            <div className="notice" aria-live="polite">
              {validationErrors.length === 0
                ? "No validation errors."
                : `${validationErrors.length} validation error${validationErrors.length === 1 ? "" : "s"}.`}
              {saved && <span>· Autosaved {saved}</span>}
            </div>
          )}
          {mode === "reviewer" && (
            <label className="cb" style={{ fontSize: "14px" }}>
              <input type="checkbox" className="sr" checked={external} onChange={(e) => setExternal(e.target.checked)} />
              <span className={external ? "c on" : "c"} aria-hidden="true"></span>
              <span>View as an external reviewer</span>
            </label>
          )}
          <div className={mode === "print" ? "print" : undefined} style={mode === "print" ? { margin: "0 auto" } : undefined}>
            <FormView
              form={LOI_FORM}
              response={response}
              mode={mode}
              provenance={LOI_PROVENANCE}
              externalReviewer={external}
              showAllErrors
              onChange={setResponse}
              onAutosave={() => setSaved(new Date().toLocaleTimeString("en-US"))}
              uploadFile={async (file) => ({ documentId: `doc_${file.name}`, name: file.name, size: file.size })}
            />
          </div>
        </main>
      </div>
    </>
  );
}
