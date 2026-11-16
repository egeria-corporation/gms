// SPDX-License-Identifier: AGPL-3.0-only
// "Who can apply": applicant types plus eligibility rules edited as rows. Rows compile to the
// rules DSL (lib/rules.ts); each row shows the sentence applicants read. The dry run sends the
// rules and a set of facts to `POST /gms/eligibility/evaluate`.
import { useId, useState } from "react";
import { Check, CircleCheck, CircleDashed, CircleX, MessageSquare, Plus, Trash2 } from "lucide-react";
import { useApiMutation } from "../../api/hooks.ts";
import type { Evaluation } from "../../api/types.ts";
import { ErrorBanner } from "../../components/ui.tsx";
import { APPLICANT_TYPE_LABELS } from "../../lib/format.ts";
import { describeRow, FACTS, IRS_SUBSECTIONS, LEVELS, newRow, rowsToRules, US_STATES, type FactKey, type RuleRow } from "../../lib/rules.ts";
import { t } from "./i18n.ts";

/** The applicant types offered as chips; the rest of the CommonGrants list stays available in rules. */
export const APPLICANT_TYPE_CHOICES = [
  "non_profit_with_501c3",
  "nonprofit_without_501c3",
  "government_tribal",
  "government_municipal",
  "government_county",
  "government_special_district",
  "school_district_independent",
  "higher_education_public",
  "for_profit_small_business",
  "individual",
] as const;

export function ApplicantTypes({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const toggle = (code: string) => onChange(value.includes(code) ? value.filter((v) => v !== code) : [...value, code]);
  return (
    <div className="fld">
      <span className="lbl" id="applicant-types-label">
        {t("eligibilityEditor.applicantTypes")}
      </span>
      <div className="row wrap" style={{ gap: "6px" }} role="group" aria-labelledby="applicant-types-label">
        {APPLICANT_TYPE_CHOICES.map((code) => {
          const on = value.includes(code);
          return (
            <button key={code} type="button" className={on ? "fchip on" : "fchip"} aria-pressed={on} onClick={() => toggle(code)}>
              {on && <Check className="ic ic-sm" aria-hidden="true" />}
              {APPLICANT_TYPE_LABELS[code]}
            </button>
          );
        })}
      </div>
      <span className="help">
        {t.rich("eligibilityEditor.mapsToCommongrantsAcceptedapplicanttypes", { span: (chunks) => <span className="mono">{chunks}</span> })}
      </span>
    </div>
  );
}

function MultiChips({ label, options, value, onChange }: { label: string; options: Record<string, string>; value: string[]; onChange: (next: string[]) => void }) {
  const id = useId();
  const remaining = Object.entries(options).filter(([code]) => !value.includes(code));
  return (
    <div className="row wrap" style={{ gap: "6px" }}>
      {value.map((code) => (
        <span className="tag" key={code} style={{ gap: "4px" }}>
          {options[code] ?? code}
          <button type="button" className="iconbtn" style={{ width: "18px", height: "18px" }} aria-label={t("eligibilityEditor.remove", { options: options[code] ?? code })} onClick={() => onChange(value.filter((v) => v !== code))}>
            ×
          </button>
        </span>
      ))}
      <label className="sr" htmlFor={id}>
        {label}
      </label>
      <select
        className="sel"
        id={id}
        style={{ width: "auto", minWidth: "140px" }}
        value=""
        onChange={(e) => {
          if (e.target.value) onChange([...value, e.target.value]);
        }}
      >
        <option value="">{t("eligibilityEditor.add")}</option>
        {remaining.map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}

function RowValue({ row, n, onChange }: { row: RuleRow; n: number; onChange: (row: RuleRow) => void }) {
  switch (row.fact) {
    case "taxStatus":
      return <MultiChips label={t("eligibilityEditor.taxExemptStatusesRule", { n })} options={IRS_SUBSECTIONS} value={row.values} onChange={(values) => onChange({ ...row, values })} />;
    case "state":
      return <MultiChips label={t("eligibilityEditor.statesRule", { n })} options={US_STATES} value={row.values} onChange={(values) => onChange({ ...row, values })} />;
    case "level":
      return (
        <select className="sel" aria-label={t("eligibilityEditor.minimumLevelRule", { n })} value={row.level} onChange={(e) => onChange({ ...row, level: e.target.value as (typeof LEVELS)[number] })}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {t("eligibilityEditor.orHigher", { l })}
            </option>
          ))}
        </select>
      );
    case "revenueUnder":
      return (
        <input
          className={row.amount > 0 ? "inp" : "inp err"}
          aria-label={t("eligibilityEditor.amountInDollarsRule", { n })}
          inputMode="numeric"
          value={row.amount ? String(row.amount) : ""}
          onChange={(e) => onChange({ ...row, amount: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })}
        />
      );
    case "orgActive":
      return <span className="muted small">{t("eligibilityEditor.noValueNeeded")}</span>;
    case "custom":
      return <span className="muted small">{t("eligibilityEditor.writtenOutsideThisEditor")}</span>;
  }
}

/** A row that cannot be published yet, and why. */
export function rowProblem(row: RuleRow): string | null {
  if ((row.fact === "taxStatus" || row.fact === "state") && row.values.length === 0) return "Choose at least one value or remove this rule. Rules with no value can't be published.";
  if (row.fact === "revenueUnder" && row.amount <= 0) return "Enter an amount or remove this rule. Rules with no value can't be published.";
  return null;
}

export function RuleRows({ rows, onChange }: { rows: RuleRow[]; onChange: (rows: RuleRow[]) => void }) {
  const [seq, setSeq] = useState(rows.length + 1);
  const add = (fact: Exclude<FactKey, "custom">) => {
    onChange([...rows, newRow(fact, `n${seq}`)]);
    setSeq((n) => n + 1);
  };
  const [adding, setAdding] = useState<Exclude<FactKey, "custom">>("taxStatus");
  return (
    <div className="fld">
      <span className="lbl">{t("eligibilityEditor.eligibilityRules")}</span>
      <span className="help">{t("eligibilityEditor.anApplicantMustMeet")}</span>
      <ol style={{ display: "flex", flexDirection: "column", gap: "10px" }} aria-label={t("eligibilityEditor.eligibilityRules")}>
        {rows.map((row, i) => {
          const problem = rowProblem(row);
          return (
            <li key={row.id} style={{ border: "1px solid #D6DEDE", borderRadius: "8px", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "8px", background: "#fff" }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.6fr) 32px", gap: "8px", alignItems: "center" }}>
                <span className="b">{row.fact === "custom" ? t("eligibilityEditor.customRule") : FACTS.find((f) => f.key === row.fact)!.label}</span>
                <RowValue row={row} n={i + 1} onChange={(next) => onChange(rows.map((r) => (r.id === row.id ? next : r)))} />
                <button type="button" className="iconbtn" style={{ width: "32px", height: "32px" }} aria-label={t("eligibilityEditor.removeRule", { i: i + 1 })} onClick={() => onChange(rows.filter((r) => r.id !== row.id))}>
                  <Trash2 className="ic" aria-hidden="true" />
                </button>
              </div>
              {problem ? (
                <span className="err-msg" role="alert">
                  {problem}
                </span>
              ) : (
                <div className="row small" style={{ gap: "6px", color: "#145450" }}>
                  <MessageSquare className="ic ic-sm" aria-hidden="true" />
                  <span>
                    {t.rich("eligibilityEditor.applicantsRead", { describeRow: describeRow(row), span: (chunks) => <span className="b">{chunks}</span> })}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {rows.length === 0 && <p className="muted small">{t("eligibilityEditor.noRulesYetAny")}</p>}
      <div className="row wrap" style={{ gap: "8px" }}>
        <label className="sr" htmlFor="add-rule-fact">
          {t("eligibilityEditor.ruleToAdd")}
        </label>
        <select className="sel" id="add-rule-fact" style={{ width: "auto" }} value={adding} onChange={(e) => setAdding(e.target.value as typeof adding)}>
          {FACTS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label} · {f.source}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => add(adding)}>
          <Plus className="ic" aria-hidden="true" />
          {t("eligibilityEditor.addRule")}
        </button>
        <span className="help" style={{ flex: "1 1 240px" }}>
          {t("eligibilityEditor.aMissingValueShows")}
        </span>
      </div>
    </div>
  );
}

interface Facts {
  /** IRS subsection code, or "" when the organization has not shared one. */
  subsection: string;
  state: string;
  level: string;
  active: boolean;
  revenue: string;
}
const PRESETS: { label: string; facts: Facts }[] = [
  { label: "Verified 501(c)(3)", facts: { subsection: "03", state: "OR", level: "L3", active: true, revenue: "2400000" } },
  { label: "New record, nothing shared", facts: { subsection: "", state: "OR", level: "L1", active: true, revenue: "" } },
  { label: "Out-of-state business", facts: { subsection: "", state: "NV", level: "L0", active: true, revenue: "7800000" } },
];

const OUTCOME = {
  pass: { icon: CircleCheck, cls: "rc-pass", word: "Pass" },
  fail: { icon: CircleX, cls: "rc-fail", word: "Fail" },
  unknown: { icon: CircleDashed, cls: "rc-unk", word: "Unknown" },
} as const;

function Verdict({ result }: { result: Evaluation }) {
  if (result.eligible === true) {
    return (
      <span className="bdg bdg-ok">
        <CircleCheck className="ic" aria-hidden="true" />
        {t("eligibilityEditor.eligible")}
      </span>
    );
  }
  if (result.eligible === false) {
    return (
      <span className="bdg bdg-dng">
        <CircleX className="ic" aria-hidden="true" />
        {t("eligibilityEditor.notEligible")}
      </span>
    );
  }
  return (
    <span className="bdg bdg-neutral">
      <CircleDashed className="ic" aria-hidden="true" />
      {t("eligibilityEditor.unknown")}
    </span>
  );
}

/** Dry-run the rules being edited against facts typed here, before anything is saved. */
export function EligibilityDryRun({ rows }: { rows: RuleRow[] }) {
  const [facts, setFacts] = useState<Facts>(PRESETS[0]!.facts);
  const [result, setResult] = useState<Evaluation | null>(null);
  const run = useApiMutation((api, f: Facts) =>
    api.evaluateEligibility({
      rules: rowsToRules(rows),
      // The same shapes Passport serves: CommonGrants `OrganizationBase` and the Common App profile.
      org: { status: { value: f.active ? "active" : "inactive" }, addresses: { primary: { stateOrProvince: f.state } }, customFields: { verificationLevel: { value: f.level } } },
      profile: {
        commonApp: {
          ...(f.subsection ? { irs: { subsection: f.subsection } } : {}),
          ...(f.revenue.trim() ? { financials: { totalRevenue: Number(f.revenue) } } : {}),
        },
      },
    }),
  );
  const test = async (f: Facts) => {
    setFacts(f);
    setResult((await run.run(f)) ?? null);
  };
  const set = <K extends keyof Facts>(key: K, value: Facts[K]) => {
    setFacts((f) => ({ ...f, [key]: value }));
    setResult(null);
  };
  const blocked = rows.some((r) => rowProblem(r) !== null);

  return (
    <section className="card" aria-labelledby="dry-run-title">
      <div className="card-h" style={{ padding: "12px 16px" }}>
        <h3 id="dry-run-title" style={{ fontSize: "14px" }}>
          {t("eligibilityEditor.testAgainstAnOrg")}
        </h3>
      </div>
      <div className="card-b" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <div className="row wrap" style={{ gap: "6px" }} role="group" aria-label={t("eligibilityEditor.sampleOrganizations")}>
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className="btn btn-sm btn-secondary" disabled={blocked} onClick={() => test(p.facts)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="fld-row" style={{ gap: "8px" }}>
          <div className="fld">
            <label className="lbl" htmlFor="fact-type">
              {t("eligibilityEditor.taxStatus")}
            </label>
            <select className="sel" id="fact-type" value={facts.subsection} onChange={(e) => set("subsection", e.target.value)}>
              <option value="">{t("eligibilityEditor.notShared")}</option>
              {Object.entries(IRS_SUBSECTIONS).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="fld">
            <label className="lbl" htmlFor="fact-state">
              {t("eligibilityEditor.state")}
            </label>
            <select className="sel" id="fact-state" value={facts.state} onChange={(e) => set("state", e.target.value)}>
              {Object.entries(US_STATES).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="fld">
            <label className="lbl" htmlFor="fact-level">
              {t("eligibilityEditor.passportLevel")}
            </label>
            <select className="sel" id="fact-level" value={facts.level} onChange={(e) => set("level", e.target.value)}>
              {LEVELS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </div>
          <div className="fld">
            <label className="lbl" htmlFor="fact-revenue">
              {t("eligibilityEditor.annualRevenue")}
            </label>
            <input className="inp" id="fact-revenue" inputMode="numeric" placeholder={t("eligibilityEditor.notShared")} value={facts.revenue} onChange={(e) => set("revenue", e.target.value.replace(/[^\d]/g, ""))} />
          </div>
        </div>
        <button type="button" className="btn btn-secondary" disabled={blocked || run.state === "saving"} onClick={() => test(facts)}>
          {t("eligibilityEditor.runTest")}
        </button>
        {blocked && <span className="help">{t("eligibilityEditor.finishOrRemoveThe")}</span>}
        {run.error !== null && <ErrorBanner error={run.error} title={t("eligibilityEditor.theRulesCouldNot")} />}
        {result && (
          <div role="status" aria-label={t("eligibilityEditor.testResult")}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="b" style={{ color: "#0D2A43" }}>
                {t("eligibilityEditor.result")}
              </span>
              <Verdict result={result} />
            </div>
            <ul className="rc">
              {result.results.map((r, i) => {
                const o = OUTCOME[r.outcome];
                return (
                  <li key={i} className={`rc-row ${o.cls}`}>
                    <o.icon className="ic" role="img" aria-label={o.word} />
                    <div>
                      <div className="l">{r.label}</div>
                      <div className="r">{r.explain}</div>
                    </div>
                    <span className="fix">{o.word}</span>
                  </li>
                );
              })}
              {result.results.length === 0 && <li className="muted small">{t("eligibilityEditor.noRulesToCheck")}</li>}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
