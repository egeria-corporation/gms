// SPDX-License-Identifier: AGPL-3.0-only
// The import wizard's first question for a funder (v1.12.0): what the file holds. Grant history
// (past awards) as before, or imported history from the system it used before: past applications,
// the reviews of them, or the reports on its past grants. History is read-only once imported.
import { ClipboardCheck, FileClock, FileStack, History } from "lucide-react";
import type { ReactNode } from "react";
import type { ImportTarget } from "../../api/imports.ts";
import { translator } from "../../i18n/index.tsx";

const tr = translator("shared");

/** The targets a funder imports into, in the order to import them. */
export const FUNDER_TARGETS = ["award_history", "history_applications", "history_reviews", "history_reports"] as const satisfies readonly ImportTarget[];
export type FunderTarget = (typeof FUNDER_TARGETS)[number];
export const isFunderTarget = (v: unknown): v is FunderTarget => typeof v === "string" && (FUNDER_TARGETS as readonly string[]).includes(v);

/** The word the wizard's messages use for one record of a target. */
export const KIND_OF: Record<ImportTarget, "award" | "application" | "pastApplication" | "pastReview" | "pastReport"> = {
  award_history: "award",
  outside_applications: "application",
  history_applications: "pastApplication",
  history_reviews: "pastReview",
  history_reports: "pastReport",
};

const OPTIONS: { target: FunderTarget; icon: ReactNode; title: () => string; hint: () => string }[] = [
  { target: "award_history", icon: <History className="ic" aria-hidden="true" />, title: () => tr("importWizard.target.awards"), hint: () => tr("importWizard.target.awardsHint") },
  { target: "history_applications", icon: <FileStack className="ic" aria-hidden="true" />, title: () => tr("importWizard.target.applications"), hint: () => tr("importWizard.target.applicationsHint") },
  { target: "history_reviews", icon: <ClipboardCheck className="ic" aria-hidden="true" />, title: () => tr("importWizard.target.reviews"), hint: () => tr("importWizard.target.reviewsHint") },
  { target: "history_reports", icon: <FileClock className="ic" aria-hidden="true" />, title: () => tr("importWizard.target.reports"), hint: () => tr("importWizard.target.reportsHint") },
];

export function ImportTargetPicker({ target, onChange }: { target: FunderTarget; onChange: (t: FunderTarget) => void }) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: "0 0 6px", display: "flex", flexDirection: "column", gap: "8px" }}>
      <legend className="lbl" style={{ marginBottom: "6px" }}>
        {tr("importWizard.target.legend")}
      </legend>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "8px" }}>
        {OPTIONS.map((o) => (
          <label key={o.target} className="card" style={{ display: "flex", gap: "10px", padding: "10px 12px", cursor: "pointer", alignItems: "flex-start", borderColor: target === o.target ? "var(--og-teal-dark)" : undefined }}>
            <input type="radio" name="import-target" value={o.target} checked={target === o.target} onChange={() => onChange(o.target)} style={{ marginTop: "3px" }} />
            <span style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1 }}>
              <span className="row" style={{ gap: "8px", fontWeight: 700 }}>
                {o.icon}
                {o.title()}
              </span>
              <span className="small muted">{o.hint()}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="help" style={{ margin: 0 }}>
        {tr("importWizard.target.order")}
      </p>
    </fieldset>
  );
}
