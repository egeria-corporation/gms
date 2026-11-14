// SPDX-License-Identifier: AGPL-3.0-only
// Writing faster as a team (v1.6): the AI draft panel (drafts from the organization's own library
// and facts, with what it used, what it did not know and which figures need checking), the "AI
// use" note, comments per question, reuse from an earlier report, and the library freshness badge.
// AI actions appear only when the server says the assistant is on; a draft is never saved until
// the person accepts it.
import { useState } from "react";
import { BookOpen, CalendarCheck, CalendarX, MessageSquare, Send, Sparkles, X } from "lucide-react";
import type { ApplicantMember } from "../../../api/applicant.ts";
import type { AssistStatus } from "../../../api/applicantFull.ts";
import type { OutsideQuestion } from "../../../api/outside.ts";
import type { AnswerDraft, LibraryAnswer, PriorReportAnswer } from "../../../api/writeKeep.ts";
import { useWKMutation, useWKQuery } from "../../../api/writeKeepHooks.ts";
import { CopyButton } from "../../../components/CopyButton.tsx";
import { Dialog } from "../../../components/Dialog.tsx";
import { Loaded, timeAgo } from "../../../components/applicant.tsx";
import { quotaSpent, QuotaSpentNote } from "../../../components/launch.tsx";
import { ErrorBanner, Notice } from "../../../components/ui.tsx";
import { formatDate } from "../../../lib/format.ts";
import { countText } from "../../../lib/outside.ts";
import { isStale, splitUnknowns, STALE_AFTER_MONTHS } from "../../../lib/writeKeep.ts";

// ------------------------------------------------------------------------------------ freshness

/** "Verified Mar 2026", or "Needs checking" (icon and words) once a year has passed or it never was. */
export function StaleBadge({ lastVerifiedAt, compact = false }: { lastVerifiedAt: string | null | undefined; compact?: boolean }) {
  if (isStale(lastVerifiedAt)) {
    return (
      <span className="bdg bdg-warn" title={lastVerifiedAt ? `Last verified ${formatDate(lastVerifiedAt)}` : "Never verified"}>
        <CalendarX className="ic" aria-hidden="true" />
        {compact ? "Needs checking" : lastVerifiedAt ? `Needs checking · verified ${formatDate(lastVerifiedAt)}` : "Needs checking · never verified"}
      </span>
    );
  }
  return (
    <span className="bdg bdg-ok">
      <CalendarCheck className="ic" aria-hidden="true" />
      {compact ? "Verified" : `Verified ${formatDate(lastVerifiedAt)}`}
    </span>
  );
}

// ------------------------------------------------------------------------------------ draft

/** "[placeholders]" marked so the person sees what the material did not say. */
export function DraftText({ text }: { text: string }) {
  return (
    <p style={{ whiteSpace: "pre-wrap" }}>
      {splitUnknowns(text).map((p, i) =>
        p.unknown ? (
          <mark key={i} className="ins" style={{ background: "var(--s-warn-bg)", color: "var(--s-warn-fg)", fontWeight: 700 }}>
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}

const quotaLine = (q: AssistStatus["quota"]) => (q && q.limit !== undefined ? `${Math.max(0, q.remaining ?? q.limit - (q.used ?? 0))} of ${q.limit} AI drafts left this month` : null);

/**
 * Drafts an answer from the library and the organization's facts. Accept saves it as a new version
 * marked as drafted with AI; Edit puts it in the editor (still marked when saved); Discard drops it.
 */
export function DraftPanel({
  question,
  library,
  status,
  onStatusChange,
  onAccept,
  onEdit,
  onClose,
  accepting,
}: {
  question: OutsideQuestion;
  library: LibraryAnswer[];
  status: AssistStatus;
  onStatusChange: () => void;
  onAccept: (text: string) => void;
  onEdit: (text: string) => void;
  onClose: () => void;
  accepting: boolean;
}) {
  const [draft, setDraft] = useState<AnswerDraft | null>(null);
  const write = useWKMutation((api) => api.draftAnswer(question.id));
  const spent = quotaSpent(status.quota);
  const used = draft ? library.filter((a) => draft.usedAnswerIds.includes(a.id)) : [];
  const titleOf = (id: string | null) => library.find((a) => a.id === id)?.title ?? "a library answer";
  const headId = `draft-${question.id}`;
  return (
    <section className="assist" aria-labelledby={headId}>
      <div className="hd">
        <Sparkles className="ic" aria-hidden="true" style={{ color: "var(--s-agent-fg)" }} />
        <h3 id={headId}>AI draft</h3>
        <span className="draft-mark">Draft — review before use</span>
        {quotaLine(status.quota) && <span className="quota">{quotaLine(status.quota)}</span>}
        <button className="iconbtn" type="button" aria-label="Close the AI draft" onClick={onClose} style={{ marginLeft: quotaLine(status.quota) ? undefined : "auto" }}>
          <X className="ic" aria-hidden="true" />
        </button>
      </div>
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "14px" }}>
        <p>The assistant writes from your answer library and your organization’s details only. It adds no facts of its own and leaves [brackets] where something is missing. Nothing is saved until you accept.</p>
        {!draft && (
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            style={{ alignSelf: "flex-start" }}
            disabled={spent || write.state === "saving"}
            onClick={async () => {
              const d = await write.run();
              if (d) setDraft(d);
              onStatusChange();
            }}
          >
            <Sparkles className="ic" aria-hidden="true" />
            {write.state === "saving" ? "Writing a draft…" : "Write a draft"}
          </button>
        )}
        {spent ? <QuotaSpentNote resetsAt={status.quota?.resetsAt} /> : null}
        {write.error ? <ErrorBanner error={write.error} title="The assistant could not write a draft" /> : null}
        {draft && (
          <div role="status" aria-label="The draft" style={{ border: "1px dashed var(--s-agent-fg)", borderRadius: "8px", padding: "10px 12px", background: "var(--s-agent-bg)", display: "flex", flexDirection: "column", gap: "10px" }}>
            <DraftText text={draft.draft} />
            <span className="small muted">
              {countText(draft.draft).words.toLocaleString("en-US")} words · {countText(draft.draft).chars.toLocaleString("en-US")} characters
              {draft.overLimit ? " · still over the limit: shorten it before you accept" : ""}
            </span>
            <div className="small">
              <span className="b">Drawn from: </span>
              {used.length ? (
                <ul aria-label="Library answers used" style={{ display: "inline-flex", gap: "8px", flexWrap: "wrap", listStyle: "none", padding: 0, margin: 0 }}>
                  {used.map((a) => (
                    <li key={a.id} className="row" style={{ gap: "6px" }}>
                      <span className="prov prov-library">
                        <BookOpen className="ic" aria-hidden="true" />
                        {a.title}
                      </span>
                      <StaleBadge lastVerifiedAt={a.lastVerifiedAt} compact />
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="muted">your organization’s details only (no library answer matched)</span>
              )}
            </div>
            {draft.unknowns.length > 0 && (
              <div className="small">
                <span className="b">Fill in before you use it: </span>
                {draft.unknowns.map((u) => `[${u}]`).join(", ")}
              </div>
            )}
            {draft.staleFlags.length > 0 && (
              <Notice tone="warn" title="Check these figures">
                <ul style={{ margin: 0, paddingLeft: "18px" }}>
                  {draft.staleFlags.map((f, i) => (
                    <li key={i}>
                      “{f.figure}” comes from {titleOf(f.answerId)}, {f.lastVerifiedAt ? `last verified ${formatDate(f.lastVerifiedAt)}` : "never verified"} (over {STALE_AFTER_MONTHS} months).
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
            <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-sm btn-primary" disabled={accepting} onClick={() => onAccept(draft.draft)}>
                {accepting ? "Saving…" : "Accept the draft"}
              </button>
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => onEdit(draft.draft)}>
                Edit before saving
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDraft(null)}>
                Discard
              </button>
              <CopyButton value={draft.draft} what="the draft" label="Copy draft" className="btn btn-sm btn-ghost" />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------ AI use

/** Names the questions whose current answer was drafted with AI. Nothing when there are none. */
export function AiUseNote({ questions }: { questions: OutsideQuestion[] }) {
  const assisted = questions.map((q, i) => ({ q, n: i + 1 })).filter(({ q }) => q.answer?.provenance === "assist");
  if (!assisted.length) return null;
  return (
    <div className="bnr bnr-agent" role="note" aria-label="AI use">
      <Sparkles className="ic" aria-hidden="true" />
      <div>
        <div className="t">AI use</div>
        <div className="d">
          The current answer{assisted.length === 1 ? " to question" : "s to questions"} {assisted.map((x) => x.n).join(", ")} {assisted.length === 1 ? "was" : "were"} drafted with AI from your own library and reviewed by your team. Some funders ask you to say so.
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------ comments

export function CommentsPanel({ applicationId, question, n, members, readOnly }: { applicationId: string; question: OutsideQuestion; n: number; members: ApplicantMember[]; readOnly: boolean }) {
  const list = useWKQuery((api) => api.comments(applicationId, question.id), [applicationId, question.id]);
  const [body, setBody] = useState("");
  const add = useWKMutation((api, text: string) => api.addComment(applicationId, question.id, text));
  const nameOf = (id: string | null) => members.find((m) => m.userId === id)?.name ?? "A teammate";
  return (
    <section aria-label={`Comments on question ${n}`} style={{ borderTop: "1px solid var(--og-gray-100)", paddingTop: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
      <Loaded query={list} label="Loading comments">
        {(comments) =>
          comments.length === 0 ? (
            <p className="small muted">No comments yet. Only your team sees them.</p>
          ) : (
            <ul aria-label="Comments" style={{ display: "flex", flexDirection: "column", gap: "6px", listStyle: "none", padding: 0, margin: 0 }}>
              {comments.map((c) => (
                <li key={c.id} className="cmt">
                  <div className="hd">
                    <span className="who">{nameOf(c.authorUserId)}</span>
                    <span>{timeAgo(c.createdAt)}</span>
                  </div>
                  <div className="bd" style={{ whiteSpace: "pre-wrap" }}>
                    {c.body}
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
      {!readOnly && (
        <form
          className="composer"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!body.trim()) return;
            if (await add.run(body.trim())) {
              setBody("");
              list.reload();
            }
          }}
        >
          <label className="sr" htmlFor={`cmt-${question.id}`}>
            Comment on question {n}
          </label>
          <textarea id={`cmt-${question.id}`} className="ta grow" style={{ minHeight: "40px" }} placeholder="Add a comment for your team" value={body} onChange={(e) => setBody(e.target.value)} />
          <button type="submit" className="btn btn-sm btn-secondary" disabled={!body.trim() || add.state === "saving"}>
            <Send className="ic" aria-hidden="true" />
            {add.state === "saving" ? "Posting…" : "Post"}
          </button>
        </form>
      )}
      {add.error ? <ErrorBanner error={add.error} title="The comment was not posted" /> : null}
    </section>
  );
}

export const CommentsButton = ({ open, onToggle }: { open: boolean; onToggle: () => void }) => (
  <button type="button" className="btn btn-sm btn-ghost" aria-expanded={open} onClick={onToggle}>
    <MessageSquare className="ic" aria-hidden="true" />
    Comments
  </button>
);

// ------------------------------------------------------------------------------------ reuse

/** Earlier report answers in this workspace; choosing one saves it as a new version marked as reused. */
export function ReuseDialog({ question, onInsert, onClose, busy, error }: { question: OutsideQuestion; onInsert: (a: PriorReportAnswer) => void; onClose: () => void; busy: boolean; error: unknown }) {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const list = useWKQuery((api) => api.priorReportAnswers(search), [search]);
  return (
    <Dialog open onClose={onClose} labelledBy="reuse-title" size="lg">
      <div className="hd">
        <div>
          <h3 id="reuse-title" style={{ fontSize: "16px" }}>
            Reuse from an earlier report
          </h3>
          <p className="small muted">{question.prompt}</p>
        </div>
        <button className="iconbtn" type="button" aria-label="Close" onClick={onClose}>
          <X className="ic ic-md" aria-hidden="true" />
        </button>
      </div>
      <div className="bd" style={{ maxHeight: "60vh", overflow: "auto" }}>
        <form
          className="row"
          style={{ gap: "8px" }}
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q);
          }}
        >
          <label className="sr" htmlFor="reuse-q">
            Search earlier report answers
          </label>
          <input id="reuse-q" type="search" className="inp" placeholder="A word from the question or answer" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit" className="btn btn-secondary">
            Search
          </button>
        </form>
        <Loaded query={list} label="Loading earlier reports">
          {(rows) =>
            rows.length === 0 ? (
              <p className="muted">No earlier report answers{search ? " match that" : " yet"}. Answers appear here once a report is recorded as submitted.</p>
            ) : (
              <ol aria-label="Earlier report answers" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {rows.map((r) => (
                  <li key={r.answerId} className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span className="small muted">
                      {r.applicationTitle} · {r.funderName}
                      {r.obligationTitle ? ` · ${r.obligationTitle}` : ""}
                      {r.submittedAt ? ` · submitted ${formatDate(r.submittedAt)}` : ""}
                    </span>
                    <span className="b">{r.prompt}</span>
                    <p style={{ whiteSpace: "pre-wrap", fontSize: "14px" }}>{r.body}</p>
                    <button type="button" className="btn btn-sm btn-secondary" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => onInsert(r)} aria-label={`Use the answer to “${r.prompt}”`}>
                      Use this answer
                    </button>
                  </li>
                ))}
              </ol>
            )
          }
        </Loaded>
        {error ? <ErrorBanner error={error} title="The answer was not inserted" /> : null}
      </div>
    </Dialog>
  );
}
