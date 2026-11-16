// SPDX-License-Identifier: AGPL-3.0-only
// Workspace settings for grant seeking: whether the Deciding stage shows the go/no-go scorecard and
// with which weights, and when the fiscal year starts (the funding summary counts by it). Admins
// change them; everyone else sees them.
import { useState } from "react";
import type { GrantSettings } from "../../../api/writeKeep.ts";
import { useWKMutation, useWKQuery } from "../../../api/writeKeepHooks.ts";
import { useCurrentWorkspace } from "../../../app/workspace.tsx";
import { Loaded } from "../../../components/applicant.tsx";
import { ErrorBanner, Field, SaveNote } from "../../../components/ui.tsx";
import { GO_CRITERIA, WEIGHT_MAX, type Criterion } from "../../../lib/writeKeep.ts";
import { criterionLabel, monthName } from "../labels.ts";
import { t } from "../i18n.ts";

function Form({ initial, admin }: { initial: GrantSettings; admin: boolean }) {
  const [base, setBase] = useState(initial);
  const [form, setForm] = useState(initial);
  const [weights, setWeights] = useState<Record<Criterion, string>>(() => Object.fromEntries(GO_CRITERIA.map((c) => [c, String(initial.goNoGoWeights[c])])) as Record<Criterion, string>);
  const save = useWKMutation((api, next: Partial<GrantSettings>) => api.saveSettings(next));
  const parsed = Object.fromEntries(GO_CRITERIA.map((c) => [c, Number(weights[c])])) as Record<Criterion, number>;
  const badWeight = GO_CRITERIA.some((c) => !(Number.isInteger(parsed[c]) && parsed[c] >= 0 && parsed[c] <= WEIGHT_MAX) || weights[c].trim() === "") || GO_CRITERIA.every((c) => parsed[c] === 0);
  const dirty = form.goNoGoEnabled !== base.goNoGoEnabled || form.fiscalYearStartMonth !== base.fiscalYearStartMonth || GO_CRITERIA.some((c) => parsed[c] !== base.goNoGoWeights[c]);
  return (
    <>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div className="row" style={{ gap: "12px", justifyContent: "space-between" }}>
          <div>
            <div className="b" id="gs-gng-l">
              {t("outsideGrantSettingsCard.goNoGoScorecard")}
            </div>
            <div className="small muted">{t("outsideGrantSettingsCard.atTheDecidingStageScoreEligibility")}</div>
          </div>
          <button type="button" className={`tog${form.goNoGoEnabled ? " on" : ""}`} role="switch" aria-checked={form.goNoGoEnabled} aria-labelledby="gs-gng-l" disabled={!admin} onClick={() => setForm({ ...form, goNoGoEnabled: !form.goNoGoEnabled })}></button>
        </div>
        {form.goNoGoEnabled && (
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px" }}>
            <legend className="lbl" style={{ marginBottom: "6px" }}>
              {t("outsideGrantSettingsCard.weights", { max: WEIGHT_MAX })}
            </legend>
            {GO_CRITERIA.map((c) => (
              <Field key={c} id={`gs-w-${c}`} label={criterionLabel(c).label}>
                <input id={`gs-w-${c}`} className="inp" inputMode="numeric" readOnly={!admin} value={weights[c]} onChange={(e) => setWeights({ ...weights, [c]: e.target.value })} />
              </Field>
            ))}
            {badWeight && (
              <span className="err-msg" role="alert" style={{ gridColumn: "1 / -1" }}>
                {t("outsideGrantSettingsCard.badWeight", { max: WEIGHT_MAX })}
              </span>
            )}
          </fieldset>
        )}
        <Field id="gs-fy" label={t("outsideGrantSettingsCard.fiscalYearStartsIn")} help={t("outsideGrantSettingsCard.theFundingSummaryCountsApplicationsAnd")}>
          <select id="gs-fy" className="sel" disabled={!admin} value={form.fiscalYearStartMonth} onChange={(e) => setForm({ ...form, fiscalYearStartMonth: Number(e.target.value) })}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i + 1}>
                {monthName(i + 1)}
              </option>
            ))}
          </select>
        </Field>
        {!admin && <p className="small muted">{t("outsideGrantSettingsCard.aWorkspaceAdminChangesThese")}</p>}
        {save.error ? <ErrorBanner error={save.error} title={t("outsideGrantSettingsCard.theSettingsWereNotSaved")} /> : null}
      </div>
      {admin && (
        <div className="card-f">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!dirty || badWeight || save.state === "saving"}
            onClick={async () => {
              const next = await save.run({ goNoGoEnabled: form.goNoGoEnabled, fiscalYearStartMonth: form.fiscalYearStartMonth, goNoGoWeights: parsed });
              if (next) {
                setBase(next);
                setForm(next);
              }
            }}
          >
            {save.state === "saving" ? t("outsideGrantSettingsCard.saving") : t("outsideGrantSettingsCard.save")}
          </button>
          <SaveNote state={save.state === "saved" && !dirty ? "saved" : "idle"} />
        </div>
      )}
    </>
  );
}

export function GrantSettingsCard() {
  const ws = useCurrentWorkspace();
  const query = useWKQuery((api) => api.settings(), [ws?.id]);
  return (
    <section className="card" aria-labelledby="gs-h">
      <div className="card-h">
        <div>
          <h2 id="gs-h" style={{ fontSize: "18px" }}>
            {t("outsideGrantSettingsCard.grantSeeking")}
          </h2>
          <p className="small muted">{t("outsideGrantSettingsCard.howYourTeamDecidesWhatTo")}</p>
        </div>
      </div>
      <Loaded query={query} label={t("outsideGrantSettingsCard.loadingTheSettings")}>
        {(s) => <Form key={JSON.stringify(s)} initial={s} admin={ws?.member.role === "admin"} />}
      </Loaded>
    </section>
  );
}
