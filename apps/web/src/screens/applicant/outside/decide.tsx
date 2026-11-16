// SPDX-License-Identifier: AGPL-3.0-only
// Deciding whether to apply, and what happens after a no. The go/no-go scorecard (when the
// workspace turns it on) scores eligibility as pass or fail, then fit, capacity, effort against the
// amount and the relationship, 1 to 5 each with the workspace's weights; go moves the application
// to a letter of inquiry or drafting, no-go to not pursuing, both through the workflow. A declined
// application shows its next cycle and can set a funding alert on the program.
import { useState } from "react";
import { BellPlus, CircleCheck, CircleX, Gauge, RotateCcw } from "lucide-react";
import type { ApplicantMember } from "../../../api/applicant.ts";
import type { OutsideApplication, OutsideDetail } from "../../../api/outside.ts";
import type { GoNoGoInput, GrantSettings } from "../../../api/writeKeep.ts";
import { useWKMutation } from "../../../api/writeKeepHooks.ts";
import { ErrorBanner, Field, Notice } from "../../../components/ui.tsx";
import { formatDate } from "../../../lib/format.ts";
import { GO_CRITERIA, goNoGoTotal, type Criterion } from "../../../lib/writeKeep.ts";
import { intlLocale } from "../../../i18n/index.tsx";
import { t } from "../i18n.ts";
import { criterionLabel } from "../labels.ts";

/** What a score of 1 to 5 means, in words. */
const scoreWord = (n: number): string =>
  n === 1 ? t("outsideDecide.scorePoor") : n === 2 ? t("outsideDecide.scoreWeak") : n === 3 ? t("outsideDecide.scoreFair") : n === 4 ? t("outsideDecide.scoreGood") : n === 5 ? t("outsideDecide.scoreStrong") : "";
/** The weighted mean of the scores, out of 5. */
const scoreText = (n: number) => n.toLocaleString(intlLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 2 });

function GoNoGoSummary({ app, members }: { app: OutsideApplication; members: ApplicantMember[] }) {
  const g = app.goNoGo!;
  const who = members.find((m) => m.userId === g.decidedBy)?.name ?? t("outsideDecide.aTeammate");
  const go = g.decision === "go";
  return (
    <section className="card" aria-labelledby="gng-h">
      <div className="card-h">
        <div>
          <h2 id="gng-h" style={{ fontSize: "18px" }}>
            {t("outsideDecide.goNoGo")}
          </h2>
          <p className="small muted">
            {g.decidedAt ? t("outsideDecide.decidedByOn", { who, date: formatDate(g.decidedAt) }) : t("outsideDecide.decidedBy", { who })}
          </p>
        </div>
        <span className={go ? "bdg bdg-ok bdg-lg" : "bdg bdg-neutral bdg-lg"}>
          {go ? <CircleCheck className="ic" aria-hidden="true" /> : <CircleX className="ic" aria-hidden="true" />}
          {go ? t("outsideDecide.go") : t("outsideDecide.noGo")}
        </span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "14px" }}>
        <dl className="kv">
          <dt>{t("outsideDecide.eligibility")}</dt>
          <dd>{g.eligibility === "pass" ? t("outsideDecide.passes") : t("outsideDecide.doesNotPass")}</dd>
          {GO_CRITERIA.map((c) => (
            <div key={c} style={{ display: "contents" }}>
              <dt>{criterionLabel(c).label}</dt>
              <dd>
                {g.scores[c] ? t("outsideDecide.scoreOf5", { score: g.scores[c], word: scoreWord(g.scores[c]!) }) : "—"}
                {g.weights[c] !== undefined ? <span className="muted"> · {t("outsideDecide.weight", { weight: g.weights[c] })}</span> : null}
              </dd>
            </div>
          ))}
          <dt>{t("outsideDecide.score")}</dt>
          <dd className="b">{t("outsideDecide.totalOf5", { score: scoreText(g.total) })}</dd>
          {g.reason && (
            <>
              <dt>{t("outsideDecide.why")}</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>{g.reason}</dd>
            </>
          )}
        </dl>
      </div>
    </section>
  );
}

/** The scorecard at the Deciding stage, or the decision once made. Nothing when go/no-go is off and none was made. */
export function GoNoGoCard({ detail, settings, members, readOnly, onDone }: { detail: OutsideDetail; settings: GrantSettings | null; members: ApplicantMember[]; readOnly: boolean; onDone: (a: OutsideApplication, message: string) => void }) {
  const [eligibility, setEligibility] = useState<"pass" | "fail" | "">("");
  const [scores, setScores] = useState<Partial<Record<Criterion, number>>>({});
  const [reason, setReason] = useState("");
  const decide = useWKMutation((api, input: GoNoGoInput) => api.decideGoNoGo(detail.id, input));
  if (detail.goNoGo) return <GoNoGoSummary app={detail} members={members} />;
  if (!settings?.goNoGoEnabled || detail.stage !== "deciding" || readOnly) return null;
  const weights = settings.goNoGoWeights;
  const { total, max, complete } = goNoGoTotal(scores, weights);
  const ready = complete && eligibility !== "";
  const run = async (decision: "go" | "no_go", nextStage?: "loi" | "drafting") => {
    const a = await decide.run({ eligibility: eligibility as "pass" | "fail", scores: scores as Record<Criterion, number>, decision, ...(reason.trim() ? { reason: reason.trim() } : {}), ...(nextStage ? { to: nextStage } : {}) });
    if (a) onDone(a, decision === "go" ? (nextStage === "loi" ? t("outsideDecide.goMovedLoi") : t("outsideDecide.goMovedDrafting")) : t("outsideDecide.noGoMoved"));
  };
  return (
    <section className="card" aria-labelledby="gng-h">
      <div className="card-h">
        <div>
          <h2 id="gng-h" style={{ fontSize: "18px" }}>
            {t("outsideDecide.goOrNoGo")}
          </h2>
          <p className="small muted">{t("outsideDecide.scoreThisOpportunityBeforeYouSpend")}</p>
        </div>
        <span className="tag row" style={{ gap: "6px", whiteSpace: "nowrap", flex: "none" }} aria-live="polite">
          <Gauge className="ic ic-sm" aria-hidden="true" />
          {t("outsideDecide.scoreOfMax", { score: complete ? scoreText(total) : "—", max })}
        </span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
          <legend className="lbl">{t("outsideDecide.eligibilityDoesYourOrganizationMeetThe")}</legend>
          <div className="row" style={{ gap: "16px", flexWrap: "wrap", fontSize: "14px" }}>
            {(["pass", "fail"] as const).map((v) => (
              <label key={v} className="row" style={{ gap: "6px" }}>
                <input type="radio" name="gng-elig" value={v} checked={eligibility === v} onChange={() => setEligibility(v)} />
                {v === "pass" ? t("outsideDecide.yesItPasses") : t("outsideDecide.noItDoesNot")}
              </label>
            ))}
          </div>
        </fieldset>
        {GO_CRITERIA.map((c) => (
          <fieldset key={c} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
            <legend className="lbl">
              {criterionLabel(c).label} <span className="muted" style={{ fontWeight: 400 }}>· {t("outsideDecide.weight", { weight: weights[c] })}</span>
            </legend>
            <span className="help">{criterionLabel(c).help}</span>
            <div className="row" style={{ gap: "12px", flexWrap: "wrap", fontSize: "14px" }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className="row" style={{ gap: "4px" }}>
                  <input type="radio" name={`gng-${c}`} value={n} checked={scores[c] === n} onChange={() => setScores({ ...scores, [c]: n })} aria-label={`${criterionLabel(c).label}: ${n}, ${scoreWord(n)}`} />
                  <span aria-hidden="true">
                    {n} <span className="muted">{scoreWord(n)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <Field id="gng-reason" label={t("outsideDecide.whyOptional")}>
          <textarea id="gng-reason" className="ta" style={{ minHeight: "56px" }} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {eligibility === "fail" && <Notice tone="warn" title={t("outsideDecide.itDoesNotPassEligibility")}>{t("outsideDecide.anApplicationThatFailsTheFunders")}</Notice>}
        {decide.error ? <ErrorBanner error={decide.error} title={t("outsideDecide.theDecisionWasNotRecorded")} /> : null}
        <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" disabled={!ready || eligibility === "fail" || decide.state === "saving"} onClick={() => void run("go", "drafting")}>
            {t("outsideDecide.goStartTheApplication")}
          </button>
          <button type="button" className="btn btn-secondary" disabled={!ready || eligibility === "fail" || decide.state === "saving"} onClick={() => void run("go", "loi")}>
            {t("outsideDecide.goWriteALetterOfInquiry")}
          </button>
          <button type="button" className="btn btn-secondary" disabled={!ready || decide.state === "saving"} onClick={() => void run("no_go")}>
            {t("outsideDecide.noGoNotPursuing")}
          </button>
        </div>
        {!ready && <span className="help">{t("outsideDecide.answerEligibilityAndScoreEachLine")}</span>}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------ next cycle

/** After a decline: when to try again, the reminder that goes that day, and an alert on the program. */
export function NextCycleCard({ detail }: { detail: OutsideDetail }) {
  const query = (detail.programName ?? detail.title).trim();
  const make = useWKMutation((api) => api.nextCycleAlert(detail.id));
  const [made, setMade] = useState<string | null>(null);
  if (detail.stage !== "declined") return null;
  return (
    <div className="bnr bnr-neu" role="region" aria-label={t("outsideDecide.nextCycle")}>
      <RotateCcw className="ic" aria-hidden="true" />
      <div className="grow">
        <div className="t">{detail.nextCycleOn ? t("outsideDecide.nextCycleOn", { date: formatDate(detail.nextCycleOn) }) : t("outsideDecide.tryAgainNextCycle")}</div>
        <div className="d">
          {detail.nextCycleOn ? t("outsideDecide.reminderGoes") : t("outsideDecide.recordNextCycle")}{" "}
          {made ? t("outsideDecide.alertSet", { query: made }) : t("outsideDecide.anAlertCanTellYouWhen")}
        </div>
        {make.error ? <ErrorBanner error={make.error} title={t("outsideDecide.theAlertWasNotSet")} /> : null}
      </div>
      {!made && (
        <button
          type="button"
          className="btn btn-sm btn-secondary act"
          disabled={!query || make.state === "saving"}
          onClick={async () => {
            const a = await make.run();
            if (a) setMade(a.query || query);
          }}
        >
          <BellPlus className="ic" aria-hidden="true" />
          {make.state === "saving" ? t("outsideDecide.setting") : t("outsideDecide.getAnAlertWhenItReopens")}
        </button>
      )}
    </div>
  );
}
