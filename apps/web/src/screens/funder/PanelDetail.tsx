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
  if (reviews.status === "loading" || rubrics.status === "loading") return <Loading label="Loading scores" />;
  if (reviews.status === "error") return <ErrorBanner error={reviews.error} onRetry={reviews.reload} />;
  const submitted = (reviews.data ?? []).filter((r) => r.submittedAt);
  if (!submitted.length) return <p className="muted small">No review has been submitted for this application at this stage.</p>;
  return (
    <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Scores by reviewer, scrollable">
      <table className="tbl tbl-compact" aria-label={`Scores by reviewer for ${row.applicant ?? row.title}`}>
        <thead>
          <tr>
            <th>Reviewer</th>
            {criteria.map((c) => (
              <th key={c.key} className="num" title={c.label}>
                {c.label}
              </th>
            ))}
            <th className="num">Weighted</th>
            <th>Recommendation</th>
          </tr>
        </thead>
        <tbody>
          {submitted.map((r) => (
            <tr key={r.id}>
              <td className="b">{person(r.reviewerUserId)?.name ?? "Reviewer"}</td>
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
    const existing = threads.data?.find((t) => t.visibility === "funder_internal");
    const thread = existing ?? (await api.openThread(applicationId, "internal"));
    return api.postMessage(thread.id, body);
  });
  const notes = threads.data?.find((t) => t.visibility === "funder_internal")?.messages ?? [];
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
        <h3>Discussion notes</h3>
        <span className="int-mark">
          <Lock className="ic" aria-hidden="true" />
          Internal
        </span>
      </div>
      {threads.status === "error" && <ErrorBanner error={threads.error} onRetry={threads.reload} />}
      {threads.status === "ready" && !notes.length && <p className="muted small">No notes yet. Notes stay with your team and are never shown to the applicant.</p>}
      {notes.map((m) => (
        <div key={m.id} className="msg msg-int">
          <div className="bub">
            <div className="hd">
              <span className="who">{(m.authorUserId ? person(m.authorUserId)?.name : null) ?? "A teammate"}</span>
              <span>· {dateTime(m.createdAt)}</span>
            </div>
            <div className="bd">{m.body}</div>
          </div>
        </div>
      ))}
      <form className="composer" onSubmit={submit}>
        <textarea className="ta" style={{ minHeight: "44px" }} aria-label="Add a discussion note" placeholder="Add a note for the panel" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn btn-secondary" disabled={!text.trim() || post.state === "saving"}>
          Add note
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
  const template = all.find((t) => t.kind !== "agreement" && LETTER_KIND[outcome]?.test(t.name));
  const preview = useApiQuery(
    async (api) => (template ? api.renderTemplate(template.id, { applicationId: row.applicationId, fields: { award: { amount: formatMinor(amountMinor ?? row.requestedAmountMinor, row.currency), title: row.title } } }) : null),
    [template?.id, row.applicationId, amountMinor],
  );
  return (
    <div className="col" style={{ gap: "8px" }}>
      <h3>Letter preview</h3>
      <div className="seg" role="radiogroup" aria-label="Letter for">
        {(["approve", "decline", "waitlist"] as const).map((o) => (
          <button key={o} type="button" role="radio" aria-checked={outcome === o} className={outcome === o ? "on" : undefined} onClick={() => setOutcome(o)}>
            {o === "approve" ? "Approve" : o === "decline" ? "Decline" : "Waitlist"}
          </button>
        ))}
      </div>
      {templates.status === "ready" && !template && <p className="muted small">{outcome === "waitlist" ? "A waitlisted applicant gets no letter: only the status changes." : "No template for this letter. Add one under Communications."}</p>}
      {preview.status === "error" && <Notice tone="warn" title="This letter can’t be previewed yet">{errorMessage(preview.error)}. The letter is rendered in full when the decision is committed and the award exists.</Notice>}
      {preview.data && (
        <div className="letter" role="group" aria-label={`${template?.name ?? "Letter"} to ${row.applicant ?? "the applicant"}`}>
          {preview.data.subject && <div className="b">{preview.data.subject}</div>}
          <div style={{ whiteSpace: "pre-wrap" }}>{preview.data.text}</div>
        </div>
      )}
      {template && (
        <p className="small muted">
          From “{template.name}”. Letters are sent when decisions are committed, not before.
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
        <h3 id="decision-summary-h">Decision summary</h3>
        <span className="small muted">Typed, not yet committed</span>
      </div>
      <div className="card-b">
        <dl className="kv">
          <dt>Approve</dt>
          <dd>
            {tally.approve} · {formatMinor(tally.approvedMinor)}
          </dd>
          <dt>Waitlist</dt>
          <dd>{tally.waitlist}</dd>
          <dt>Decline</dt>
          <dd>{tally.decline}</dd>
          <dt>No decision yet</dt>
          <dd>{tally.undecided}</dd>
          <dt>Headroom after</dt>
          <dd className={remainingMinor !== null && remainingMinor < 0 ? "var-neg b" : undefined}>{remainingMinor === null ? "No program budget set" : formatMinor(remainingMinor)}</dd>
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
          {row.title} · requested {formatMinor(row.requestedAmountMinor, row.currency)}
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
