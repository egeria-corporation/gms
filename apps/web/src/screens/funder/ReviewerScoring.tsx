// SPDX-License-Identifier: AGPL-3.0-only
// Reviewer portal — scoring one assignment. The application shows in reviewer mode (fields the
// funder hid from reviewers are absent; personal fields are masked for external reviewers), beside
// a score card built from the stage's rubric. Scores save as a draft and lock on submit.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Check, EyeOff, Lock } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { InboxApplication, ReviewAssignmentDetail, ReviewAssignmentPatch } from "../../api/funder.ts";
import type { RubricCriterion } from "../../api/types.ts";
import { ErrorBanner, Loading, Notice, problemsOf } from "../../components/ui.tsx";
import { ResponseCard } from "./ApplicationDetail.tsx";
import { ASSIGNMENT_LOOK, ReviewerFrame, usePortal } from "./ReviewerAssignments.tsx";

type ScoreValue = number | string;
interface Entry {
  value?: ScoreValue;
  comment?: string;
}

const entryOf = (raw: unknown): Entry => (raw !== null && typeof raw === "object" ? (raw as Entry) : raw === undefined || raw === null ? {} : { value: raw as ScoreValue });
const toScores = (entries: Record<string, Entry>) =>
  Object.fromEntries(Object.entries(entries).flatMap(([k, e]) => (e.value === undefined || e.value === "" ? [] : [[k, e.comment?.trim() ? { value: e.value, comment: e.comment.trim() } : e.value]])));

function ScoreCard({ c, entry, onChange, readOnly, error }: { c: RubricCriterion; entry: Entry; onChange: (e: Entry) => void; readOnly: boolean; error: boolean }) {
  const id = `score-${c.key}`;
  return (
    <div className="score" style={error ? { borderColor: "#C53030" } : undefined}>
      <div className="hd">
        <div>
          <h3 id={`${id}-h`}>{c.label}</h3>
          {(c.guidance ?? c.description) && <div className="guide">{c.guidance ?? c.description}</div>}
        </div>
        <span className="w">Weight {c.weight}</span>
      </div>
      {c.scale.type === "numeric" ? (
        <div className="scale">
          <input type="range" aria-labelledby={`${id}-h`} min={c.scale.min} max={c.scale.max} step={1} value={typeof entry.value === "number" ? entry.value : c.scale.min} disabled={readOnly} onChange={(e) => onChange({ ...entry, value: Number(e.target.value) })} />
          <input
            className={error ? "inp v err" : "inp v"}
            type="number"
            aria-label={`${c.label} score, ${c.scale.min} to ${c.scale.max}`}
            min={c.scale.min}
            max={c.scale.max}
            value={typeof entry.value === "number" ? entry.value : ""}
            readOnly={readOnly}
            onChange={(e) => onChange({ ...entry, value: e.target.value === "" ? "" : Math.min(c.scale.type === "numeric" ? c.scale.max : 0, Math.max(c.scale.type === "numeric" ? c.scale.min : 0, Number(e.target.value))) })}
          />
        </div>
      ) : (
        <div className="scale-cat" role="radiogroup" aria-labelledby={`${id}-h`}>
          {c.scale.options.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={entry.value === o.value} className={entry.value === o.value ? "on" : undefined} disabled={readOnly} onClick={() => onChange({ ...entry, value: o.value })}>
              {o.label ?? o.value}
            </button>
          ))}
        </div>
      )}
      {error && <span className="err-msg">Score this criterion before submitting</span>}
      <textarea className="ta" style={{ minHeight: "64px" }} aria-label={`Comment on ${c.label}`} placeholder="Comment (optional)" value={entry.comment ?? ""} readOnly={readOnly} onChange={(e) => onChange({ ...entry, comment: e.target.value })} />
    </div>
  );
}

function Scoring({ assignmentId }: { assignmentId: string }) {
  const { userId } = usePortal();
  const detail = useApiQuery((api) => api.getAssignment(assignmentId), [assignmentId]);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [narrative, setNarrative] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const save = useApiMutation((api, action: "save" | "submit") => {
    const patch: ReviewAssignmentPatch = { action, scores: toScores(entries), ...(narrative.trim() ? { narrative: narrative.trim() } : {}), ...(recommendation ? { recommendation } : {}) };
    return api.updateAssignment(assignmentId, patch);
  });

  useEffect(() => {
    const d: ReviewAssignmentDetail | undefined = detail.data;
    if (!d) return;
    setEntries(Object.fromEntries(Object.entries(d.myReview?.scores ?? {}).map(([k, v]) => [k, entryOf(v)])));
    setNarrative(d.myReview?.narrative ?? "");
    setRecommendation(d.myReview?.recommendation ?? "");
  }, [detail.data]);

  if (detail.status === "loading") return <Loading label="Loading the application" />;
  if (detail.status === "error") return <ErrorBanner error={detail.error} onRetry={detail.reload} title="This assignment could not be opened" />;
  const d = detail.data;
  const app = d.application as InboxApplication | null;
  const criteria = d.rubric.criteria as RubricCriterion[];
  const own = d.reviewerUserId === userId;
  const readOnly = !own || d.status === "submitted" || d.status === "recused";
  const needsCoi = d.status === "assigned";
  const missing = problemsOf(save.error).map((p) => (p.path ?? (p as { field?: string }).field ?? "").replace(/^scores\./, ""));
  const scored = criteria.filter((c) => entries[c.key]?.value !== undefined && entries[c.key]?.value !== "").length;
  const recommendations = (d.rubric.overall as { recommendations?: string[] }).recommendations ?? [];
  const look = ASSIGNMENT_LOOK[d.status];

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumbs">
            <Link to="/review/assignments">My assignments</Link>
            <span>›</span>
            <span>{d.applicationTitle}</span>
          </div>
          <div className="title">
            <h1>{d.applicationTitle}</h1>
            <span className={`bdg bdg-${look.tone}`}>
              <Check className="ic" aria-hidden="true" />
              {look.label}
            </span>
          </div>
          <div className="meta">
            <span>{app?.applicant.name}</span>
            <span>·</span>
            <span>
              {d.rubric.name} v{d.rubric.version}
            </span>
            {d.dueAt && (
              <>
                <span>·</span>
                <span>Due {new Date(d.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</span>
              </>
            )}
          </div>
        </div>
      </div>
      {needsCoi && (
        <Notice tone="warn" title="Declare any conflict of interest first">
          Go back to <Link to="/review/assignments">My assignments</Link> and open this application from there.
        </Notice>
      )}
      {!own && <Notice tone="info" title="You are viewing another reviewer’s assignment">Only the assigned reviewer can score it.</Notice>}
      {d.status === "recused" && <Notice tone="neu" title="Recused">This application is not shown to a recused reviewer.</Notice>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
        <div className="col" style={{ gap: "16px" }}>
          {app && !app.organization && (
            <span className="masked">
              <EyeOff className="ic ic-sm" aria-hidden="true" />
              Applicant contact details are hidden
            </span>
          )}
          {(app?.formResponses ?? []).map((r) => (
            <ResponseCard key={`${r.formId}:${r.formVersion}`} r={r} mode="reviewer" external={!app?.organization} />
          ))}
        </div>
        <aside className="col" style={{ gap: "12px" }} aria-label="Score card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ fontSize: "16px" }}>Score card</h2>
            <span className="small muted">
              {scored} of {criteria.length} scored
            </span>
          </div>
          {criteria.map((c) => (
            <ScoreCard key={c.key} c={c} entry={entries[c.key] ?? {}} readOnly={readOnly || needsCoi} error={missing.includes(c.key)} onChange={(e) => setEntries((all) => ({ ...all, [c.key]: e }))} />
          ))}
          <div className="score">
            <div className="hd">
              <div>
                <h3 id="rec-h">Overall recommendation</h3>
                <div className="guide">The panel sees your recommendation beside your weighted score{d.review?.overall !== null && d.review?.overall !== undefined ? ` (currently ${d.review.overall.toFixed(1)} of 100)` : ""}.</div>
              </div>
            </div>
            {recommendations.length > 0 && (
              <div className="scale-cat" role="radiogroup" aria-labelledby="rec-h">
                {recommendations.map((r) => (
                  <button key={r} type="button" role="radio" aria-checked={recommendation === r} className={recommendation === r ? "on" : undefined} disabled={readOnly || needsCoi} onClick={() => setRecommendation(r)}>
                    {r}
                  </button>
                ))}
              </div>
            )}
            <label className="lbl" htmlFor="narr" style={{ marginTop: "4px" }}>
              Narrative for the panel
            </label>
            <textarea className="ta" id="narr" value={narrative} readOnly={readOnly || needsCoi} onChange={(e) => setNarrative(e.target.value)} />
          </div>
          {save.error !== null && <ErrorBanner error={save.error} />}
          <div className="card" style={{ position: "sticky", bottom: 0, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
            <span className="small muted row" style={{ gap: "6px" }} role="status">
              {d.status === "submitted" ? (
                <>
                  <Lock className="ic" aria-hidden="true" />
                  Submitted. Your scores are locked.
                </>
              ) : savedAt ? (
                <>
                  <Check className="ic" aria-hidden="true" style={{ color: "#0B5E47" }} />
                  Draft saved
                </>
              ) : (
                "Submitting locks your scores until the panel opens."
              )}
            </span>
            {!readOnly && !needsCoi && (
              <div className="row">
                <button type="button" className="btn btn-secondary" disabled={save.state === "saving"} onClick={async () => (await save.run("save")) && setSavedAt(new Date().toISOString())}>
                  Save draft
                </button>
                <button type="button" className="btn btn-primary" disabled={save.state === "saving"} onClick={async () => (await save.run("submit")) && detail.reload()}>
                  Submit review
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

export default function ReviewerScoring() {
  // The route names the review assignment; the reviewer never needs the application's own id.
  const { appId = "" } = useParams();
  return (
    <ReviewerFrame tab="scoring" title="Scoring">
      <Scoring assignmentId={appId} />
    </ReviewerFrame>
  );
}
