// SPDX-License-Identifier: AGPL-3.0-only
// Reviewer portal — scoring one assignment. The application shows in reviewer mode (fields the
// funder hid from reviewers are absent; personal fields are masked for external reviewers), beside
// a score card built from the stage's rubric. Scores save as a draft and lock on submit.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Check, EyeOff, Lock } from "lucide-react";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import type { InboxApplication, ReviewAssignment, ReviewAssignmentDetail, ReviewAssignmentPatch } from "../../api/funder.ts";
import { useServices } from "../../app/services.tsx";
import type { RubricCriterion } from "../../api/types.ts";
import { ErrorBanner, Loading, Notice, problemsOf } from "../../components/ui.tsx";
import { ResponseCard } from "./ApplicationDetail.tsx";
import { ASSIGNMENT_LOOK, ReviewerFrame, assignmentName, usePortal } from "./ReviewerAssignments.tsx";
import { AiSummaryPanel } from "./ApplicationPanels.tsx";
import { formatDateAs } from "../../lib/format.ts";
import { t, useFunderMessages } from "./i18n.ts";

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
        <span className="w">{t("reviewerScoring.weight", { weight: c.weight })}</span>
      </div>
      {c.scale.type === "numeric" ? (
        <div className="scale">
          <input type="range" aria-labelledby={`${id}-h`} min={c.scale.min} max={c.scale.max} step={1} value={typeof entry.value === "number" ? entry.value : c.scale.min} disabled={readOnly} onChange={(e) => onChange({ ...entry, value: Number(e.target.value) })} />
          <input
            className={error ? "inp v err" : "inp v"}
            type="number"
            aria-label={t("reviewerScoring.scoreTo", { label: c.label, min: c.scale.min, max: c.scale.max })}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-err` : undefined}
            min={c.scale.min}
            max={c.scale.max}
            value={typeof entry.value === "number" ? entry.value : ""}
            readOnly={readOnly}
            onChange={(e) => onChange({ ...entry, value: e.target.value === "" ? "" : Math.min(c.scale.type === "numeric" ? c.scale.max : 0, Math.max(c.scale.type === "numeric" ? c.scale.min : 0, Number(e.target.value))) })}
          />
        </div>
      ) : (
        <div className="scale-cat" role="radiogroup" aria-labelledby={`${id}-h`} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : undefined}>
          {c.scale.options.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={entry.value === o.value} className={entry.value === o.value ? "on" : undefined} disabled={readOnly} onClick={() => onChange({ ...entry, value: o.value })}>
              {o.label ?? o.value}
            </button>
          ))}
        </div>
      )}
      {error && (
        <span className="err-msg" id={`${id}-err`}>
          {t("reviewerScoring.scoreThisCriterionBefore")}
        </span>
      )}
      <textarea className="ta" style={{ minHeight: "64px" }} aria-label={t("reviewerScoring.commentOn", { label: c.label })} placeholder={t("reviewerScoring.commentOptional")} value={entry.comment ?? ""} readOnly={readOnly} onChange={(e) => onChange({ ...entry, comment: e.target.value })} />
    </div>
  );
}

/** A guest reviewer is done when at least one review is submitted and none is still open (recusals aside). */
export const guestReviewDone = (rows: Pick<ReviewAssignment, "status">[]) => rows.some((r) => r.status === "submitted") && rows.every((r) => r.status === "submitted" || r.status === "recused");

function Scoring({ assignmentId }: { assignmentId: string }) {
  const { userId, workspace } = usePortal();
  const { api } = useServices();
  const navigate = useNavigate();
  /** After a submit: a guest reviewer whose last review this was goes to the done screen. */
  const afterSubmit = async () => {
    if (workspace.member.role === "external_reviewer") {
      const mine = await api.listAssignments({ reviewerUserId: userId }).catch(() => null);
      if (mine && guestReviewDone(mine)) return navigate(`/review/done?ws=${encodeURIComponent(workspace.handle)}`);
    }
    detail.reload();
  };
  const detail = useApiQuery((api) => api.getAssignment(assignmentId), [assignmentId]);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [narrative, setNarrative] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [visibility, setVisibility] = useState<"panel" | "funder_only">("panel");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const save = useApiMutation((api, action: "save" | "submit") => {
    const patch: ReviewAssignmentPatch = { action, scores: toScores(entries), ...(narrative.trim() ? { narrative: narrative.trim() } : {}), ...(recommendation ? { recommendation } : {}), visibility };
    return api.updateAssignment(assignmentId, patch);
  });

  // What the reviewer has changed on this assignment. The saved review fills the form only where
  // they have not: the assignment can arrive, or arrive again, after their first keystroke, and
  // filling the whole form then threw away what they had typed.
  const touched = useRef(new Set<string>());
  const edit = (field: string) => touched.current.add(field);
  useEffect(() => {
    touched.current.clear();
  }, [assignmentId]);

  useEffect(() => {
    const d: ReviewAssignmentDetail | undefined = detail.data;
    if (!d) return;
    const saved = Object.fromEntries(Object.entries(d.myReview?.scores ?? {}).map(([k, v]) => [k, entryOf(v)]));
    setEntries((now) => {
      const next: Record<string, Entry> = { ...saved };
      for (const [key, entry] of Object.entries(now)) if (touched.current.has(`score:${key}`)) next[key] = entry;
      return next;
    });
    if (!touched.current.has("narrative")) setNarrative(d.myReview?.narrative ?? "");
    if (!touched.current.has("recommendation")) setRecommendation(d.myReview?.recommendation ?? "");
    if (!touched.current.has("visibility")) setVisibility(d.myReview?.visibility ?? "panel");
  }, [detail.data]);

  if (detail.status === "loading") return <Loading label={t("reviewerScoring.loadingTheApplication")} />;
  if (detail.status === "error") return <ErrorBanner error={detail.error} onRetry={detail.reload} title={t("reviewerScoring.thisAssignmentCouldNot")} />;
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
            <Link to="/review/assignments">{t("reviewerScoring.myAssignments")}</Link>
            <span>›</span>
            <span>{assignmentName(d)}</span>
          </div>
          <div className="title">
            <h1>{assignmentName(d)}</h1>
            <span className={`bdg bdg-${look.tone}`}>
              <Check className="ic" aria-hidden="true" />
              {look.label}
            </span>
          </div>
          <div className="meta">
            <span>{d.anonymized ? d.applicationTitle : app?.applicant.name}</span>
            <span>·</span>
            <span>
              {t("reviewerScoring.rubricVersion", { name: d.rubric.name, version: d.rubric.version })}
            </span>
            {d.dueAt && (
              <>
                <span>·</span>
                <span>{t("reviewerScoring.due", { date: formatDateAs(d.dueAt, "short") })}</span>
              </>
            )}
          </div>
        </div>
      </div>
      {needsCoi && (
        <Notice tone="warn" title={t("reviewerScoring.declareAnyConflictOf")}>
          {t.rich("reviewerScoring.goBackToMy", { link: (chunks) => <Link to="/review/assignments">{chunks}</Link> })}
        </Notice>
      )}
      {d.anonymized && (
        <Notice tone="neu" title={t("reviewerScoring.anonymizedReview")}>
          {t("reviewerScoring.youDoNotSee")}
        </Notice>
      )}
      {!own && <Notice tone="info" title={t("reviewerScoring.youAreViewingAnother")}>{t("reviewerScoring.onlyTheAssignedReviewer")}</Notice>}
      {d.status === "recused" && <Notice tone="neu" title={t("reviewerScoring.recused")}>{t("reviewerScoring.thisApplicationIsNot")}</Notice>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
        <div className="col" style={{ gap: "16px" }}>
          {app && !needsCoi && d.status !== "recused" && <AiSummaryPanel applicationId={app.id} />}
          {app && !app.organization && (
            <span className="masked">
              <EyeOff className="ic ic-sm" aria-hidden="true" />
              {t("reviewerScoring.applicantContactDetailsAre")}
            </span>
          )}
          {(app?.formResponses ?? []).map((r) => (
            <ResponseCard key={`${r.formId}:${r.formVersion}`} r={r} mode="reviewer" external={!app?.organization} />
          ))}
        </div>
        <aside className="col" style={{ gap: "12px" }} aria-label={t("reviewerScoring.scoreCard")}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ fontSize: "16px" }}>{t("reviewerScoring.scoreCard")}</h2>
            <span className="small muted">
              {t("reviewerScoring.ofScored", { scored, count: criteria.length })}
            </span>
          </div>
          {criteria.map((c) => (
            <ScoreCard key={c.key} c={c} entry={entries[c.key] ?? {}} readOnly={readOnly || needsCoi} error={missing.includes(c.key)} onChange={(e) => { edit(`score:${c.key}`); setEntries((all) => ({ ...all, [c.key]: e })); }} />
          ))}
          <div className="score">
            <div className="hd">
              <div>
                <h3 id="rec-h">{t("reviewerScoring.overallRecommendation")}</h3>
                <div className="guide">{d.review?.overall !== null && d.review?.overall !== undefined ? t("reviewerScoring.panelSeesCurrently", { overall: d.review.overall.toFixed(1) }) : t("reviewerScoring.panelSees")}</div>
              </div>
            </div>
            {recommendations.length > 0 && (
              <div className="scale-cat" role="radiogroup" aria-labelledby="rec-h">
                {recommendations.map((r) => (
                  <button key={r} type="button" role="radio" aria-checked={recommendation === r} className={recommendation === r ? "on" : undefined} disabled={readOnly || needsCoi} onClick={() => { edit("recommendation"); setRecommendation(r); }}>
                    {r}
                  </button>
                ))}
              </div>
            )}
            <label className="lbl" htmlFor="narr" style={{ marginTop: "4px" }}>
              {t("reviewerScoring.narrativeForThePanel")}
            </label>
            <textarea className="ta" id="narr" value={narrative} readOnly={readOnly || needsCoi} onChange={(e) => { edit("narrative"); setNarrative(e.target.value); }} />
            {/* .col spaces the two radios so each keeps a 24px target (WCAG 2.5.8). */}
            <fieldset className="col" style={{ border: 0, padding: 0, margin: "4px 0 0" }}>
              <legend className="lbl">{t("reviewerScoring.whoReadsYourNarrative")}</legend>
              <label className="radio">
                <input type="radio" name="visibility" checked={visibility === "panel"} disabled={readOnly || needsCoi} onChange={() => { edit("visibility"); setVisibility("panel"); }} />
                <span>{t("reviewerScoring.thePanel")}</span>
              </label>
              <label className="radio">
                <input type="radio" name="visibility" checked={visibility === "funder_only"} disabled={readOnly || needsCoi} onChange={() => { edit("visibility"); setVisibility("funder_only"); }} />
                <span>{t("reviewerScoring.programStaffOnlyLeft")}</span>
              </label>
            </fieldset>
          </div>
          {save.error !== null && <ErrorBanner error={save.error} />}
          <div className="card stick-foot" style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
            <span className="small muted row" style={{ gap: "6px" }} role="status">
              {d.status === "submitted" ? (
                <>
                  <Lock className="ic" aria-hidden="true" />
                  {t("reviewerScoring.submittedYourScoresAre")}
                </>
              ) : savedAt ? (
                <>
                  <Check className="ic" aria-hidden="true" style={{ color: "#0B5E47" }} />
                  {t("reviewerScoring.draftSaved")}
                </>
              ) : (
                t("reviewerScoring.submittingLocksYourScores")
              )}
            </span>
            {!readOnly && !needsCoi && (
              <div className="row">
                <button type="button" className="btn btn-secondary" disabled={save.state === "saving"} onClick={async () => (await save.run("save")) && setSavedAt(new Date().toISOString())}>
                  {t("reviewerScoring.saveDraft")}
                </button>
                <button type="button" className="btn btn-primary" disabled={save.state === "saving"} onClick={async () => (await save.run("submit")) && (await afterSubmit())}>
                  {t("reviewerScoring.submitReview")}
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
  useFunderMessages();
  // The route names the review assignment; the reviewer never needs the application's own id.
  const { appId = "" } = useParams();
  return (
    <ReviewerFrame tab="scoring" title={t("reviewerScoring.scoring")}>
      <Scoring assignmentId={appId} />
    </ReviewerFrame>
  );
}
