// SPDX-License-Identifier: AGPL-3.0-only
// The panel's working area for one application: each reviewer's score per rubric criterion, the
// panel's discussion notes (the funder-internal thread; the applicant never sees it), and the
// letter the applicant would receive for the decision being considered. Beside it, a summary of
// the decisions typed so far.
import { useState, type FormEvent } from "react";
import { Lock } from "lucide-react";
import type { RankingRow } from "../../api/funder.ts";
import { useApiMutation, useApiQuery } from "../../api/hooks.ts";
import { ErrorBanner, errorMessage, Loading, Notice } from "../../components/ui.tsx";
import { formatMinor } from "../../lib/format.ts";
import { dateTime, usePeople } from "./shared.tsx";
import { t } from "./i18n.ts";

type Outcome = "approve" | "decline" | "waitlist";

/** Criterion value from a stored score, which is either the value or `{ value, comment }`. */
const valueOf = (score: unknown): string => {
  const v = typeof score === "object" && score !== null && "value" in score ? (score as { value: unknown }).value : score;
  return v === undefined || v === null || v === "" ? "—" : String(v);
};

function Scores({ row, stage, rubricId }: { row: RankingRow; stage: string; rubricId: string }) {
  const { person } = usePeople();
  const reviews = useApiQuery((api) => api.listReviews(row.applicationId, stage), [row.applicationId, stage]);
  const rubrics = useApiQuery((api) => api.listRubrics(), []);
  const criteria = rubrics.data?.find((r) => r.id === rubricId)?.criteria ?? [];
  if (reviews.status === "loading" || rubrics.status === "loading") return <Loading label={t("panelDetail.loadingScores")} />;
  if (reviews.status === "error") return <ErrorBanner error={reviews.error} onRetry={reviews.reload} />;
  const submitted = (reviews.data ?? []).filter((r) => r.submittedAt);
  if (!submitted.length) return <p className="muted small">{t("panelDetail.noReviewHasBeen")}</p>;
  return (
    <div className="tbl-wrap" tabIndex={0} role="region" aria-label={t("panelDetail.scoresByReviewerScrollable")}>
      <table className="tbl tbl-compact" aria-label={t("panelDetail.scoresByReviewerFor", { applicant: row.applicant ?? row.title })}>
        <thead>
          <tr>
            <th>{t("panelDetail.reviewer")}</th>
            {criteria.map((c) => (
              <th key={c.key} className="num" title={c.label}>
                {c.label}
              </th>
            ))}
            <th className="num">{t("panelDetail.weighted")}</th>
            <th>{t("panelDetail.recommendation")}</th>
          </tr>
        </thead>
        <tbody>
          {submitted.map((r) => (
            <tr key={r.id}>
              <td className="b">{person(r.reviewerUserId)?.name ?? t("panelDetail.reviewer")}</td>
              {criteria.map((c) => (
                <td key={c.key} className="num">
                  {valueOf(r.scores[c.key])}
                </td>
              ))}
              <td className="num b">{r.overall === null ? "—" : r.overall.toFixed(1)}</td>
              <td>{r.recommendation ? r.recommendation.replace(/_/g, " ") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiscussionNotes({ applicationId }: { applicationId: string }) {
  const { person } = usePeople();
  const threads = useApiQuery((api) => api.listThreads(applicationId), [applicationId]);
  const [text, setText] = useState("");
  const post = useApiMutation(async (api, body: string) => {
    const existing = threads.data?.find((item) => item.visibility === "funder_internal");
    const thread = existing ?? (await api.openThread(applicationId, "internal"));
    return api.postMessage(thread.id, body);
  });
  const notes = threads.data?.find((item) => item.visibility === "funder_internal")?.messages ?? [];
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    if (await post.run(text.trim())) {
      setText("");
      threads.reload();
    }
  }
  return (
    <div className="col" style={{ gap: "8px" }}>
      <div className="row" style={{ gap: "8px" }}>
        <h3>{t("panelDetail.discussionNotes")}</h3>
        <span className="int-mark">
          <Lock className="ic" aria-hidden="true" />
          {t("panelDetail.internal")}
        </span>
      </div>
      {threads.status === "error" && <ErrorBanner error={threads.error} onRetry={threads.reload} />}
      {threads.status === "ready" && !notes.length && <p className="muted small">{t("panelDetail.noNotesYetNotes")}</p>}
      {notes.map((m) => (
        <div key={m.id} className="msg msg-int">
          <div className="bub">
            <div className="hd">
              <span className="who">{(m.authorUserId ? person(m.authorUserId)?.name : null) ?? t("panelDetail.aTeammate")}</span>
              <span>· {dateTime(m.createdAt)}</span>
            </div>
            <div className="bd">{m.body}</div>
          </div>
        </div>
      ))}
      <form className="composer" onSubmit={submit}>
        <textarea className="ta" style={{ minHeight: "44px" }} aria-label={t("panelDetail.addADiscussionNote")} placeholder={t("panelDetail.addANoteFor")} value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn btn-secondary" disabled={!text.trim() || post.state === "saving"}>
          {t("panelDetail.addNote")}
        </button>
      </form>
      {post.error !== null && <ErrorBanner error={post.error} />}
    </div>
  );
}

const LETTER_KIND: Record<Outcome, RegExp | null> = { approve: /award/i, decline: /decline/i, waitlist: /waitlist/i };

function LetterPreview({ row, initial, amountMinor }: { row: RankingRow; initial: Outcome; amountMinor: number | null }) {
  const [outcome, setOutcome] = useState<Outcome>(initial);
  const templates = useApiQuery((api) => api.listTemplates(), []);
  const all = [...(templates.data?.items ?? []), ...(templates.data?.builtIn ?? [])];
  const template = all.find((item) => item.kind !== "agreement" && LETTER_KIND[outcome]?.test(item.name));
  const preview = useApiQuery(
    async (api) => (template ? api.renderTemplate(template.id, { applicationId: row.applicationId, fields: { award: { amount: formatMinor(amountMinor ?? row.requestedAmountMinor, row.currency), title: row.title } } }) : null),
    [template?.id, row.applicationId, amountMinor],
  );
  return (
    <div className="col" style={{ gap: "8px" }}>
      <h3>{t("panelDetail.letterPreview")}</h3>
      <div className="seg" role="radiogroup" aria-label={t("panelDetail.letterFor")}>
        {(["approve", "decline", "waitlist"] as const).map((o) => (
          <button key={o} type="button" role="radio" aria-checked={outcome === o} className={outcome === o ? "on" : undefined} onClick={() => setOutcome(o)}>
            {o === "approve" ? t("panelDetail.approve") : o === "decline" ? t("panelDetail.decline") : t("panelDetail.waitlist")}
          </button>
        ))}
      </div>
      {templates.status === "ready" && !template && <p className="muted small">{outcome === "waitlist" ? t("panelDetail.aWaitlistedApplicantGets") : t("panelDetail.noTemplateForThis")}</p>}
      {preview.status === "error" && <Notice tone="warn" title={t("panelDetail.thisLetterCantBe")}>{t("panelDetail.theLetterIsRendered", { errorMessage: errorMessage(preview.error) })}</Notice>}
      {preview.data && (
        <div className="letter" role="group" aria-label={t("panelDetail.to", { name: template?.name ?? t("panelDetail.letter"), applicant: row.applicant ?? t("panelDetail.theApplicant") })}>
          {preview.data.subject && <div className="b">{preview.data.subject}</div>}
          <div style={{ whiteSpace: "pre-wrap" }}>{preview.data.text}</div>
        </div>
      )}
      {template && (
        <p className="small muted">
          {t("panelDetail.fromLettersAreSent", { name: template.name })}
        </p>
      )}
    </div>
  );
}

export interface DecisionTally {
  approve: number;
  decline: number;
  waitlist: number;
  approvedMinor: number;
  undecided: number;
}

export function DecisionSummary({ tally, remainingMinor }: { tally: DecisionTally; remainingMinor: number | null }) {
  return (
    <section className="card" aria-labelledby="decision-summary-h">
      <div className="card-h">
        <h3 id="decision-summary-h">{t("panelDetail.decisionSummary")}</h3>
        <span className="small muted">{t("panelDetail.typedNotYetCommitted")}</span>
      </div>
      <div className="card-b">
        <dl className="kv">
          <dt>{t("panelDetail.approve")}</dt>
          <dd>
            {tally.approve} · {formatMinor(tally.approvedMinor)}
          </dd>
          <dt>{t("panelDetail.waitlist")}</dt>
          <dd>{tally.waitlist}</dd>
          <dt>{t("panelDetail.decline")}</dt>
          <dd>{tally.decline}</dd>
          <dt>{t("panelDetail.noDecisionYet")}</dt>
          <dd>{tally.undecided}</dd>
          <dt>{t("panelDetail.headroomAfter")}</dt>
          <dd className={remainingMinor !== null && remainingMinor < 0 ? "var-neg b" : undefined}>{remainingMinor === null ? t("panelDetail.noProgramBudgetSet") : formatMinor(remainingMinor)}</dd>
        </dl>
      </div>
    </section>
  );
}

export function PanelDetail({ row, stage, rubricId, outcome, amountMinor }: { row: RankingRow; stage: string; rubricId: string; outcome: Outcome | ""; amountMinor: number | null }) {
  return (
    <section className="card" aria-labelledby="panel-detail-h">
      <div className="card-h">
        <h3 id="panel-detail-h">{row.applicant ?? row.title}</h3>
        <span className="small muted">
          {t("panelDetail.requested", { title: row.title, amount: formatMinor(row.requestedAmountMinor, row.currency) })}
        </span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <Scores row={row} stage={stage} rubricId={rubricId} />
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
          <DiscussionNotes applicationId={row.applicationId} />
          <LetterPreview key={`${row.applicationId}-${outcome}`} row={row} initial={outcome || "approve"} amountMinor={amountMinor} />
        </div>
      </div>
    </section>
  );
}
