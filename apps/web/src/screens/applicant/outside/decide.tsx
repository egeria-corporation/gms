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
import { CRITERION_LABELS, GO_CRITERIA, goNoGoTotal, type Criterion } from "../../../lib/writeKeep.ts";

const SCORE_WORDS = ["", "Poor", "Weak", "Fair", "Good", "Strong"];

function GoNoGoSummary({ app, members }: { app: OutsideApplication; members: ApplicantMember[] }) {
  const g = app.goNoGo!;
  const who = members.find((m) => m.userId === g.decidedBy)?.name ?? "A teammate";
  const go = g.decision === "go";
  return (
    <section className="card" aria-labelledby="gng-h">
      <div className="card-h">
        <div>
          <h2 id="gng-h" style={{ fontSize: "18px" }}>
            Go/no-go
          </h2>
          <p className="small muted">
            Decided by {who}
            {g.decidedAt ? ` on ${formatDate(g.decidedAt)}` : ""}
          </p>
        </div>
        <span className={go ? "bdg bdg-ok bdg-lg" : "bdg bdg-neutral bdg-lg"}>
          {go ? <CircleCheck className="ic" aria-hidden="true" /> : <CircleX className="ic" aria-hidden="true" />}
          {go ? "Go" : "No-go"}
        </span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "14px" }}>
        <dl className="kv">
          <dt>Eligibility</dt>
          <dd>{g.eligibility === "pass" ? "Passes" : "Does not pass"}</dd>
          {GO_CRITERIA.map((c) => (
            <div key={c} style={{ display: "contents" }}>
              <dt>{CRITERION_LABELS[c].label}</dt>
              <dd>
                {g.scores[c] ? `${g.scores[c]} of 5 (${SCORE_WORDS[g.scores[c]!]})` : "—"}
                {g.weights[c] !== undefined ? <span className="muted"> · weight {g.weights[c]}</span> : null}
              </dd>
            </div>
          ))}
          <dt>Score</dt>
          <dd className="b">
            {g.total}
            {g.max ? ` of ${g.max}` : ""}
          </dd>
          {g.reason && (
            <>
              <dt>Why</dt>
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
    const a = await decide.run({ eligibility: eligibility as "pass" | "fail", scores: scores as Record<Criterion, number>, decision, ...(reason.trim() ? { reason: reason.trim() } : {}), ...(nextStage ? { nextStage } : {}) });
    if (a) onDone(a, decision === "go" ? `Go. Moved to ${nextStage === "loi" ? "Letter of inquiry" : "Drafting"}.` : "No-go. Moved to Not pursuing.");
  };
  return (
    <section className="card" aria-labelledby="gng-h">
      <div className="card-h">
        <div>
          <h2 id="gng-h" style={{ fontSize: "18px" }}>
            Go or no-go?
          </h2>
          <p className="small muted">Score this opportunity before you spend time on it. The weights are your workspace’s, set in Settings.</p>
        </div>
        <span className="tag row" style={{ gap: "6px", whiteSpace: "nowrap", flex: "none" }} aria-live="polite">
          <Gauge className="ic ic-sm" aria-hidden="true" />
          Score {total} of {max}
        </span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
          <legend className="lbl">Eligibility: does your organization meet the funder’s rules?</legend>
          <div className="row" style={{ gap: "16px", flexWrap: "wrap", fontSize: "14px" }}>
            {(["pass", "fail"] as const).map((v) => (
              <label key={v} className="row" style={{ gap: "6px" }}>
                <input type="radio" name="gng-elig" value={v} checked={eligibility === v} onChange={() => setEligibility(v)} />
                {v === "pass" ? "Yes, it passes" : "No, it does not"}
              </label>
            ))}
          </div>
        </fieldset>
        {GO_CRITERIA.map((c) => (
          <fieldset key={c} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
            <legend className="lbl">
              {CRITERION_LABELS[c].label} <span className="muted" style={{ fontWeight: 400 }}>· weight {weights[c]}</span>
            </legend>
            <span className="help">{CRITERION_LABELS[c].help}</span>
            <div className="row" style={{ gap: "12px", flexWrap: "wrap", fontSize: "14px" }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className="row" style={{ gap: "4px" }}>
                  <input type="radio" name={`gng-${c}`} value={n} checked={scores[c] === n} onChange={() => setScores({ ...scores, [c]: n })} aria-label={`${CRITERION_LABELS[c].label}: ${n}, ${SCORE_WORDS[n]}`} />
                  <span aria-hidden="true">
                    {n} <span className="muted">{SCORE_WORDS[n]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <Field id="gng-reason" label="Why (optional)">
          <textarea id="gng-reason" className="ta" style={{ minHeight: "56px" }} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {eligibility === "fail" && <Notice tone="warn" title="It does not pass eligibility">An application that fails the funder’s rules can only be a no-go.</Notice>}
        {decide.error ? <ErrorBanner error={decide.error} title="The decision was not recorded" /> : null}
        <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" disabled={!ready || eligibility === "fail" || decide.state === "saving"} onClick={() => void run("go", "drafting")}>
            Go: start the application
          </button>
          <button type="button" className="btn btn-secondary" disabled={!ready || eligibility === "fail" || decide.state === "saving"} onClick={() => void run("go", "loi")}>
            Go: write a letter of inquiry
          </button>
          <button type="button" className="btn btn-secondary" disabled={!ready || decide.state === "saving"} onClick={() => void run("no_go")}>
            No-go: not pursuing
          </button>
        </div>
        {!ready && <span className="help">Answer eligibility and score each line to decide.</span>}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------ next cycle

/** After a decline: when to try again, the reminder that goes that day, and an alert on the program. */
export function NextCycleCard({ detail }: { detail: OutsideDetail }) {
  const query = (detail.programName ?? detail.title).trim();
  const make = useWKMutation((api) => api.createAlert(query));
  const [made, setMade] = useState<string | null>(null);
  if (detail.stage !== "declined") return null;
  return (
    <div className="bnr bnr-neu" role="region" aria-label="Next cycle">
      <RotateCcw className="ic" aria-hidden="true" />
      <div className="grow">
        <div className="t">{detail.nextCycleOn ? `Next cycle: ${formatDate(detail.nextCycleOn)}` : "Try again next cycle"}</div>
        <div className="d">
          {detail.nextCycleOn ? "A reminder goes to the application’s owner by email on that day. " : "Record when the next cycle opens in the decision notes. "}
          {made ? `Alert set for “${made}”. New listings that match appear in Find funding, under Alerts.` : "An alert can tell you when matching opportunities appear."}
        </div>
        {make.error ? <ErrorBanner error={make.error} title="The alert was not set" /> : null}
      </div>
      {!made && (
        <button
          type="button"
          className="btn btn-sm btn-secondary act"
          disabled={!query || make.state === "saving"}
          onClick={async () => {
            const a = await make.run();
            if (a) setMade(a.query);
          }}
        >
          <BellPlus className="ic" aria-hidden="true" />
          {make.state === "saving" ? "Setting…" : "Get an alert when it reopens"}
        </button>
      )}
    </div>
  );
}
