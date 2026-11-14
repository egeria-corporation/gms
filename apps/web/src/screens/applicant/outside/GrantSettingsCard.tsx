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
import { CRITERION_LABELS, GO_CRITERIA, MONTHS, type Criterion } from "../../../lib/writeKeep.ts";

function Form({ initial, admin }: { initial: GrantSettings; admin: boolean }) {
  const [base, setBase] = useState(initial);
  const [form, setForm] = useState(initial);
  const [weights, setWeights] = useState<Record<Criterion, string>>(() => Object.fromEntries(GO_CRITERIA.map((c) => [c, String(initial.goNoGoWeights[c])])) as Record<Criterion, string>);
  const save = useWKMutation((api, next: Partial<GrantSettings>) => api.saveSettings(next));
  const parsed = Object.fromEntries(GO_CRITERIA.map((c) => [c, Number(weights[c])])) as Record<Criterion, number>;
  const badWeight = GO_CRITERIA.some((c) => !(Number.isInteger(parsed[c]) && parsed[c] >= 0 && parsed[c] <= 5) || weights[c].trim() === "");
  const dirty = form.goNoGoEnabled !== base.goNoGoEnabled || form.fiscalYearStartMonth !== base.fiscalYearStartMonth || GO_CRITERIA.some((c) => parsed[c] !== base.goNoGoWeights[c]);
  return (
    <>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div className="row" style={{ gap: "12px", justifyContent: "space-between" }}>
          <div>
            <div className="b" id="gs-gng-l">
              Go/no-go scorecard
            </div>
            <div className="small muted">At the Deciding stage, score eligibility, fit, capacity, effort and the relationship before you apply.</div>
          </div>
          <button type="button" className={`tog${form.goNoGoEnabled ? " on" : ""}`} role="switch" aria-checked={form.goNoGoEnabled} aria-labelledby="gs-gng-l" disabled={!admin} onClick={() => setForm({ ...form, goNoGoEnabled: !form.goNoGoEnabled })}></button>
        </div>
        {form.goNoGoEnabled && (
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px" }}>
            <legend className="lbl" style={{ marginBottom: "6px" }}>
              Weights, 0 to 5
            </legend>
            {GO_CRITERIA.map((c) => (
              <Field key={c} id={`gs-w-${c}`} label={CRITERION_LABELS[c].label}>
                <input id={`gs-w-${c}`} className="inp" inputMode="numeric" readOnly={!admin} value={weights[c]} onChange={(e) => setWeights({ ...weights, [c]: e.target.value })} />
              </Field>
            ))}
            {badWeight && (
              <span className="err-msg" role="alert" style={{ gridColumn: "1 / -1" }}>
                Each weight is a whole number from 0 to 5.
              </span>
            )}
          </fieldset>
        )}
        <Field id="gs-fy" label="Fiscal year starts in" help="The funding summary counts applications and awards by fiscal year.">
          <select id="gs-fy" className="sel" disabled={!admin} value={form.fiscalYearStartMonth} onChange={(e) => setForm({ ...form, fiscalYearStartMonth: Number(e.target.value) })}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        {!admin && <p className="small muted">A workspace admin changes these.</p>}
        {save.error ? <ErrorBanner error={save.error} title="The settings were not saved" /> : null}
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
            {save.state === "saving" ? "Saving…" : "Save"}
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
            Grant seeking
          </h2>
          <p className="small muted">How your team decides what to apply for, and how the funding summary counts.</p>
        </div>
      </div>
      <Loaded query={query} label="Loading the settings">
        {(s) => <Form key={JSON.stringify(s)} initial={s} admin={ws?.member.role === "admin"} />}
      </Loaded>
    </section>
  );
}
