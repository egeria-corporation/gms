// SPDX-License-Identifier: AGPL-3.0-only
// The questions of an outside application and the answers to them. Questions are typed in or
// pasted from the funder's guidelines (split into questions for review before anything is saved).
// Each answer is written here with live counts against the funder's limit, can start from the
// answer library or an organization fact, and every save is a new version.
import { useMemo, useRef, useState, type FormEvent } from "react";
import { BookOpen, Bot, CircleCheck, ClipboardList, Clock, FileClock, Pencil, Plus, Sparkles, Trash, TriangleExclamationPoint, Building, X } from "lucide-react";
import type { ApplicantMember, MyOrganization } from "../../../api/applicant.ts";
import type { AdaptedDraft, AssistStatus } from "../../../api/applicantFull.ts";
import { useFullMutation, useFullQuery } from "../../../api/applicantFullHooks.ts";
import type { AnswerInput, LimitKind, OutsideAnswer, OutsideDetail, OutsideQuestion, QuestionInput, QuestionPhase, QuestionStatus } from "../../../api/outside.ts";
import { useOutsideMutation, useOutsideQuery } from "../../../api/outsideHooks.ts";
import type { LibraryAnswer } from "../../../api/writeKeep.ts";
import { useServices } from "../../../app/services.tsx";
import { useCurrentWorkspace } from "../../../app/workspace.tsx";
import { CopyButton } from "../../../components/CopyButton.tsx";
import { Dialog } from "../../../components/Dialog.tsx";
import { Loaded, timeAgo } from "../../../components/applicant.tsx";
import { StatusBadge } from "../../../components/status.tsx";
import { EmptyState, ErrorBanner, Field, Notice, SaveNote } from "../../../components/ui.tsx";
import { quotaSpent, QuotaSpentNote } from "../../../components/launch.tsx";
import { downloadBlob } from "../../../lib/browser.ts";
import { countFor, countText, isOverLimit, LIMIT_UNITS, limitPhrase, type ParsedQuestion, type TextCounts } from "../../../lib/outside.ts";
import { bestVariant, canApprove as mayApprove, mergeRequired, variantChoices, type RequiredDocument } from "../../../lib/writeKeep.ts";
import { GuidelinesReader } from "./guidelines.tsx";
import { orgFacts } from "./shared.tsx";
import { AiUseNote, CommentsButton, CommentsPanel, DraftPanel, ReuseDialog, StaleBadge } from "./writeFaster.tsx";

export const PHASE_LABELS: Record<QuestionPhase, string> = { loi: "Letter of inquiry", full: "Full application", report: "Report" };
const STATUS_OPTIONS: { value: QuestionStatus; label: string }[] = [
  { value: "empty", label: "Not started" },
  { value: "draft", label: "Draft" },
  { value: "ready", label: "Ready for review" },
  { value: "approved", label: "Approved" },
];
const LIMIT_OPTIONS: { value: LimitKind | ""; label: string }[] = [
  { value: "", label: "No limit" },
  { value: "words", label: "Words" },
  { value: "chars", label: "Characters" },
  { value: "chars_no_spaces", label: "Characters without spaces" },
];

/** Every question and its latest answer as plain text, ready to paste into a funder's portal. */
export function plainText(questions: OutsideQuestion[]): string {
  return questions.map((q, i) => `${i + 1}. ${q.prompt}\n\n${q.answer?.body.trim() || "(no answer yet)"}`).join("\n\n");
}

// ------------------------------------------------------------------------------------ counters

/** Words, characters and characters without spaces. The funder's limit is highlighted; over it is said in words. */
export function Counters({ counts, limitKind, limitValue, id }: { counts: TextCounts; limitKind: LimitKind | null; limitValue: number | null; id?: string }) {
  const over = isOverLimit(counts, limitKind, limitValue);
  const item = (kind: LimitKind, n: number, unit: string) => {
    const active = kind === limitKind && !!limitValue;
    return (
      <span key={kind} className={active ? (over ? "counter over" : "counter b") : "counter"} data-active={active ? "true" : undefined} style={active ? { color: over ? undefined : "var(--og-navy-dark)" } : undefined}>
        {n.toLocaleString("en-US")}
        {active ? ` / ${limitValue!.toLocaleString("en-US")}` : ""} {unit}
      </span>
    );
  };
  return (
    <div className="row" id={id} style={{ gap: "14px", flexWrap: "wrap", justifyContent: "flex-end" }}>
      {item("words", counts.words, "words")}
      {item("chars", counts.chars, "characters")}
      {item("chars_no_spaces", counts.charsNoSpaces, "without spaces")}
      <span role="status" aria-live="polite" className="row" style={{ gap: "6px" }}>
        {over && limitKind && limitValue ? (
          <span className="counter over row" style={{ gap: "4px" }}>
            <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
            Over the limit by {(countFor(counts, limitKind) - limitValue).toLocaleString("en-US")} {LIMIT_UNITS[limitKind]}
          </span>
        ) : limitKind && limitValue ? (
          <span className="counter row" style={{ gap: "4px", color: "var(--s-ok-fg)" }}>
            <CircleCheck className="ic ic-sm" aria-hidden="true" />
            Within the limit
          </span>
        ) : null}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------------------------ question form

function QuestionForm({ initial, onSave, onCancel, saving, submitLabel }: { initial?: OutsideQuestion; onSave: (q: QuestionInput) => void; onCancel: () => void; saving: boolean; submitLabel: string }) {
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [guidance, setGuidance] = useState(initial?.guidance ?? "");
  const [phase, setPhase] = useState<QuestionPhase>(initial?.phase ?? "full");
  const [section, setSection] = useState(initial?.section ?? "");
  const [limitKind, setLimitKind] = useState<LimitKind | "">(initial?.limitKind ?? "");
  const [limitValue, setLimitValue] = useState(initial?.limitValue ? String(initial.limitValue) : "");
  const [required, setRequired] = useState(initial?.required ?? true);
  const key = initial?.id ?? "new";
  const value = Number.parseInt(limitValue.replace(/,/g, ""), 10);
  const limitError = limitKind && !(value > 0) ? "Enter the limit as a number" : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || limitError) return;
    onSave({ prompt: prompt.trim(), guidance: guidance.trim() || null, phase, section: section.trim() || null, limitKind: limitKind || null, limitValue: limitKind ? value : null, required });
  };
  return (
    <form onSubmit={submit} className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "12px" }} aria-label={initial ? "Edit question" : "New question"}>
      <Field id={`qf-prompt-${key}`} label="Question" required>
        <textarea id={`qf-prompt-${key}`} className="ta" style={{ minHeight: "64px" }} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </Field>
      <Field id={`qf-guidance-${key}`} label="Guidance" help="Anything the funder says about how to answer.">
        <textarea id={`qf-guidance-${key}`} className="ta" style={{ minHeight: "48px" }} value={guidance} onChange={(e) => setGuidance(e.target.value)} />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "12px" }}>
        <Field id={`qf-phase-${key}`} label="Part">
          <select id={`qf-phase-${key}`} className="sel" value={phase} onChange={(e) => setPhase(e.target.value as QuestionPhase)}>
            {(Object.keys(PHASE_LABELS) as QuestionPhase[]).map((p) => (
              <option key={p} value={p}>
                {PHASE_LABELS[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`qf-section-${key}`} label="Section">
          <input id={`qf-section-${key}`} className="inp" value={section} onChange={(e) => setSection(e.target.value)} />
        </Field>
        <Field id={`qf-limitkind-${key}`} label="Limit">
          <select id={`qf-limitkind-${key}`} className="sel" value={limitKind} onChange={(e) => setLimitKind(e.target.value as LimitKind | "")}>
            {LIMIT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`qf-limit-${key}`} label="Limit amount" error={limitError}>
          <input id={`qf-limit-${key}`} className="inp" inputMode="numeric" disabled={!limitKind} value={limitValue} onChange={(e) => setLimitValue(e.target.value)} />
        </Field>
      </div>
      <label className="row" style={{ gap: "8px", fontSize: "14px" }}>
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
        The funder requires an answer
      </label>
      <div className="row" style={{ gap: "8px", justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving || !prompt.trim() || !!limitError}>
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------------------------ paste

export function PasteQuestionsDialog({
  applicationId,
  onClose,
  onSaved,
  assist = null,
  requiredDocuments = [],
  obligationId = null,
}: {
  applicationId: string;
  onClose: () => void;
  onSaved: (n: number, documents?: number) => void;
  /** The assistant's status: "Read the funder's guidelines" is offered only when it is on. */
  assist?: AssistStatus | null;
  requiredDocuments?: RequiredDocument[];
  /** Report questions: saved on this report obligation. */
  obligationId?: string | null;
}) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"text" | "ai">("text");
  const [proposed, setProposed] = useState<(ParsedQuestion & { keep: boolean })[] | null>(null);
  const [docs, setDocs] = useState<{ label: string; keep: boolean }[]>([]);
  const [kept, setKept] = useState<string | null>(null);
  const parse = useOutsideMutation((api, t: string) => api.parseQuestions(applicationId, t));
  const save = useOutsideMutation(async (api, qs: QuestionInput[], labels: string[]) => {
    const made = qs.length ? await api.addQuestions(applicationId, qs) : [];
    if (labels.length) await api.update(applicationId, { requiredDocuments: mergeRequired(requiredDocuments, labels) });
    return made;
  });
  const keep = proposed?.filter((q) => q.keep && q.prompt.trim()) ?? [];
  const keepDocs = docs.filter((d) => d.keep).map((d) => d.label);
  const aiOn = !!assist?.enabled && !obligationId;
  const update = (i: number, patch: Partial<ParsedQuestion & { keep: boolean }>) => setProposed((p) => p && p.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  return (
    <Dialog open onClose={onClose} labelledBy="paste-q-title" size="lg">
      <div className="hd">
        <div>
          <h3 id="paste-q-title" style={{ fontSize: "16px" }}>
            Paste the funder’s questions
          </h3>
          <p className="small muted">
            {proposed
              ? "Check each question and its limit. Nothing is saved until you save them."
              : mode === "ai"
                ? "The assistant reads the funder’s guidelines and finds the questions, their limits and the documents the funder asks for."
                : "Paste the questions from the funder’s guidelines or portal. Numbered lists and blank lines are split into questions, and limits such as “250 words” are picked up."}
          </p>
        </div>
        <button className="iconbtn" type="button" aria-label="Close" onClick={onClose}>
          <X className="ic ic-md" aria-hidden="true" />
        </button>
      </div>
      <div className="bd">
        {!proposed && aiOn && (
          <div className="seg" role="group" aria-label="How to find the questions">
            <button type="button" className={mode === "text" ? "on" : undefined} aria-pressed={mode === "text"} onClick={() => setMode("text")}>
              <ClipboardList className="ic ic-sm" aria-hidden="true" />
              Paste the questions
            </button>
            <button type="button" className={mode === "ai" ? "on" : undefined} aria-pressed={mode === "ai"} onClick={() => setMode("ai")}>
              <Sparkles className="ic ic-sm" aria-hidden="true" />
              Read the funder’s guidelines
            </button>
          </div>
        )}
        {!proposed && mode === "ai" && aiOn ? (
          <GuidelinesReader
            applicationId={applicationId}
            assist={assist!}
            onRead={(r) => {
              setProposed(r.questions.map((q) => ({ ...q, keep: true })));
              setDocs(r.requiredDocuments.map((label) => ({ label, keep: true })));
              setKept(r.document ? r.document.name : null);
            }}
          />
        ) : !proposed ? (
          <Field id="paste-q-text" label="Questions">
            <textarea id="paste-q-text" className="ta" style={{ minHeight: "220px" }} value={text} onChange={(e) => setText(e.target.value)} placeholder={"1. Describe the need your project addresses. (250 words)\n2. How will you measure success? Maximum 1,500 characters."} />
          </Field>
        ) : proposed.length === 0 && docs.length === 0 ? (
          <Notice tone="neu" title="No questions were found in that text">
            Go back and paste the questions themselves, one per line or numbered.
          </Notice>
        ) : (
          <ol aria-label="Proposed questions" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {proposed.map((q, i) => (
              <li key={i} className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "8px", opacity: q.keep ? 1 : 0.6 }}>
                <div className="row" style={{ justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                  <label className="row small b" style={{ gap: "6px" }}>
                    <input type="checkbox" checked={q.keep} onChange={(e) => update(i, { keep: e.target.checked })} />
                    Keep question {i + 1}
                  </label>
                  <span className="small muted">
                    {PHASE_LABELS[q.phase]} · {limitPhrase(q.limitKind, q.limitValue)}
                    {q.limitKind ? " (found in the text)" : ""}
                  </span>
                </div>
                <label className="sr" htmlFor={`pq-${i}`}>
                  Question {i + 1}
                </label>
                <textarea id={`pq-${i}`} className="ta" style={{ minHeight: "48px" }} value={q.prompt} onChange={(e) => update(i, { prompt: e.target.value })} />
                <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                  <label className="sr" htmlFor={`pq-kind-${i}`}>
                    Limit for question {i + 1}
                  </label>
                  <select
                    id={`pq-kind-${i}`}
                    className="sel"
                    style={{ maxWidth: "220px" }}
                    value={q.limitKind ?? ""}
                    onChange={(e) => {
                      const v = e.target.value as LimitKind | "";
                      if (v) update(i, { limitKind: v });
                      else setProposed((p) => p && p.map((x, j) => (j === i ? { prompt: x.prompt, phase: x.phase, keep: x.keep } : x)));
                    }}
                  >
                    {LIMIT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {q.limitKind && (
                    <>
                      <label className="sr" htmlFor={`pq-val-${i}`}>
                        Limit amount for question {i + 1}
                      </label>
                      <input id={`pq-val-${i}`} className="inp" inputMode="numeric" style={{ maxWidth: "120px" }} value={q.limitValue ?? ""} onChange={(e) => update(i, { limitValue: Number.parseInt(e.target.value.replace(/,/g, ""), 10) || 0 })} />
                    </>
                  )}
                  <label className="sr" htmlFor={`pq-phase-${i}`}>
                    Part for question {i + 1}
                  </label>
                  <select id={`pq-phase-${i}`} className="sel" style={{ maxWidth: "200px" }} value={q.phase} onChange={(e) => update(i, { phase: e.target.value as QuestionPhase })}>
                    {(Object.keys(PHASE_LABELS) as QuestionPhase[]).map((p) => (
                      <option key={p} value={p}>
                        {PHASE_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ol>
        )}
        {proposed && kept && <p className="small muted">The guidelines file, {kept}, is kept with this application’s attachments.</p>}
        {proposed && docs.length > 0 && (
          <fieldset className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "6px", margin: 0 }}>
            <legend className="small b" style={{ padding: "0 4px" }}>
              Documents the funder asks for
            </legend>
            {docs.map((d, i) => (
              <label key={d.label} className="row small" style={{ gap: "8px" }}>
                <input type="checkbox" checked={d.keep} onChange={(e) => setDocs(docs.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} />
                {d.label}
              </label>
            ))}
            <span className="help">Kept ones go on the Checklist tab, where you can use a document from your vault.</span>
          </fieldset>
        )}
        {parse.error ? <ErrorBanner error={parse.error} title="The questions could not be read" /> : null}
        {save.error ? <ErrorBanner error={save.error} title="The questions were not saved" /> : null}
      </div>
      <div className="ft">
        {proposed ? (
          <>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => {
                setProposed(null);
                setDocs([]);
                setKept(null);
              }}
            >
              {mode === "ai" ? "Back to the guidelines" : "Back to the text"}
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={(keep.length === 0 && keepDocs.length === 0) || save.state === "saving"}
              onClick={async () => {
                const made = await save.run(
                  keep.map((q) => ({ prompt: q.prompt.trim(), phase: obligationId ? "report" : q.phase, limitKind: q.limitKind ?? null, limitValue: q.limitKind && q.limitValue ? q.limitValue : null, ...(obligationId ? { obligationId } : {}) })),
                  keepDocs,
                );
                if (made) onSaved(made.length, keepDocs.length);
              }}
            >
              {save.state === "saving" ? "Saving…" : saveLabel(keep.length, keepDocs.length)}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-secondary" type="button" onClick={onClose}>
              Cancel
            </button>
            {(mode === "text" || !aiOn) && (
              <button
                className="btn btn-primary"
                type="button"
                disabled={!text.trim() || parse.state === "saving"}
                onClick={async () => {
                  const found = await parse.run(text);
                  if (found) {
                    setProposed(found.map((q) => ({ ...q, phase: obligationId ? "report" : q.phase, keep: true })));
                    setDocs([]);
                  }
                }}
              >
                {parse.state === "saving" ? "Reading…" : "Find the questions"}
              </button>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const saveLabel = (q: number, d: number) => (d === 0 ? `Save ${plural(q, "question")}` : q === 0 ? `Save ${plural(d, "document")}` : `Save ${plural(q, "question")} and ${plural(d, "document")}`);

// ------------------------------------------------------------------------------------ inserts

function LibraryDialog({ answers, question, onInsert, onClose, busy, error }: { answers: LibraryAnswer[]; question: OutsideQuestion; onInsert: (a: LibraryAnswer, text: string) => void; onClose: () => void; busy: boolean; error: unknown }) {
  const [id, setId] = useState(answers[0]?.id ?? "");
  const answer = answers.find((a) => a.id === id);
  const choices = answer ? variantChoices(answer) : [];
  const best = bestVariant(choices, question.limitKind, question.limitValue);
  const [picked, setPicked] = useState<string | null>(null);
  const choice = choices.find((c) => c.key === picked) ?? best;
  return (
    <Dialog open onClose={onClose} labelledBy="olib-title">
      <div className="hd">
        <div>
          <h3 id="olib-title" style={{ fontSize: "16px" }}>
            Insert from answer library
          </h3>
          <p className="small muted">The library text replaces the answer and is saved as a new version marked “From library”. The library copy is not changed.</p>
        </div>
        <button className="iconbtn" type="button" aria-label="Close" onClick={onClose}>
          <X className="ic ic-md" aria-hidden="true" />
        </button>
      </div>
      <div className="bd">
        <Field id="olib-answer" label="Library answer">
          <select
            id="olib-answer"
            className="sel"
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              setPicked(null);
            }}
          >
            {answers.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title} · v{a.version} · {a.words} words
              </option>
            ))}
          </select>
        </Field>
        {answer && (
          <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
            <StaleBadge lastVerifiedAt={answer.lastVerifiedAt} />
          </div>
        )}
        {choices.length > 1 && choice && (
          <Field id="olib-variant" label="Version" help={question.limitKind && question.limitValue ? `${best?.label ?? "This version"} fits best within ${limitPhrase(question.limitKind, question.limitValue)}.` : undefined}>
            <select id="olib-variant" className="sel" value={choice.key} onChange={(e) => setPicked(e.target.value)}>
              {choices.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label} · {c.counts.words} words
                  {question.limitKind && question.limitValue && countFor(c.counts, question.limitKind) > question.limitValue ? " · over the limit" : ""}
                </option>
              ))}
            </select>
          </Field>
        )}
        {choice && (
          <p className="small" style={{ maxHeight: "160px", overflow: "auto", whiteSpace: "pre-wrap" }}>
            {choice.text}
          </p>
        )}
        {error ? <ErrorBanner error={error} title="The answer was not inserted" /> : null}
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" type="button" disabled={!answer || !choice || busy} onClick={() => answer && choice && onInsert(answer, choice.text)}>
          {busy ? "Inserting…" : "Insert"}
        </button>
      </div>
    </Dialog>
  );
}

function FactDialog({ org, onInsert, onClose }: { org: MyOrganization | null; onInsert: (value: string) => void; onClose: () => void }) {
  const facts = org ? orgFacts(org) : [];
  return (
    <Dialog open onClose={onClose} labelledBy="ofact-title">
      <div className="hd">
        <div>
          <h3 id="ofact-title" style={{ fontSize: "16px" }}>
            Insert a fact about your organization
          </h3>
          <p className="small muted">The fact goes in where your cursor was. Save the answer to keep it.</p>
        </div>
        <button className="iconbtn" type="button" aria-label="Close" onClick={onClose}>
          <X className="ic ic-md" aria-hidden="true" />
        </button>
      </div>
      <div className="bd">
        {facts.length === 0 ? (
          <Notice tone="neu" title="No organization facts yet">
            Add your organization’s details under Organization, or connect Passport.
          </Notice>
        ) : (
          <ul aria-label="Organization facts" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {facts.map((f) => (
              <li key={f.key} className="row" style={{ gap: "12px", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--og-gray-100)" }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small b">{f.label}</div>
                  <div style={{ fontSize: "14px", overflowWrap: "anywhere" }}>{f.value}</div>
                  <div className="small muted">{f.from}</div>
                </div>
                <button type="button" className="btn btn-sm btn-secondary" aria-label={`Insert ${f.label}`} onClick={() => onInsert(f.value)}>
                  Insert
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

export const provenanceTag = (p: string) =>
  p === "assist" ? (
    <span className="prov prov-agent">
      <Sparkles className="ic" aria-hidden="true" />
      Drafted with AI
    </span>
  ) : p === "prior_submission" ? (
    <span className="prov prov-report">
      <FileClock className="ic" aria-hidden="true" />
      From an earlier report
    </span>
  ) : p === "library" ? (
    <span className="prov prov-library">
      <BookOpen className="ic" aria-hidden="true" />
      From library
    </span>
  ) : p.startsWith("agent") ? (
    <span className="prov prov-agent">
      <Bot className="ic" aria-hidden="true" />
      Drafted by an agent
    </span>
  ) : (
    <span className="prov prov-entered">
      <Pencil className="ic" aria-hidden="true" />
      Written by your team
    </span>
  );

function HistoryDialog({ question, onUse, onClose, nameOf }: { question: OutsideQuestion; onUse: (body: string) => void; onClose: () => void; nameOf: (id: string | null) => string }) {
  const history = useOutsideQuery((api) => api.answerHistory(question.id), [question.id]);
  return (
    <Dialog open onClose={onClose} labelledBy="ohist-title" size="lg">
      <div className="hd">
        <div>
          <h3 id="ohist-title" style={{ fontSize: "16px" }}>
            Earlier versions
          </h3>
          <p className="small muted">{question.prompt}</p>
        </div>
        <button className="iconbtn" type="button" aria-label="Close" onClick={onClose}>
          <X className="ic ic-md" aria-hidden="true" />
        </button>
      </div>
      <div className="bd" style={{ maxHeight: "60vh", overflow: "auto" }}>
        <Loaded query={history} label="Loading versions">
          {(versions) => (
            <ol aria-label="Versions" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {versions.map((v: OutsideAnswer) => (
                <li key={v.id} className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                    <span className="b">Version {v.version}</span>
                    {provenanceTag(v.provenance)}
                    <span className="small muted">
                      {nameOf(v.createdBy)} · {timeAgo(v.createdAt)}
                    </span>
                  </div>
                  <p style={{ whiteSpace: "pre-wrap", fontSize: "14px" }}>{v.body || <span className="muted">(empty)</span>}</p>
                  <div className="row" style={{ gap: "8px" }}>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => onUse(v.body)}>
                      Put this version in the editor
                    </button>
                    <CopyButton value={v.body} what={`version ${v.version}`} className="btn btn-sm btn-ghost" />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Loaded>
      </div>
    </Dialog>
  );
}

/** "Fit to limit": the assistant adapts a library answer to this question and its limit. A draft only. */
function FitToLimit({ question, answers, onUse, onClose }: { question: OutsideQuestion; answers: LibraryAnswer[]; onUse: (text: string) => void; onClose: () => void }) {
  const status = useFullQuery((api) => api.assistStatus(), []);
  const [answerId, setAnswerId] = useState(question.answer?.libraryAnswerId ?? answers[0]?.id ?? "");
  const [draft, setDraft] = useState<AdaptedDraft | null>(null);
  const adapt = useFullMutation((api, id: string, input: { question: string; maxWords?: number }) => api.adaptAnswer(id, input));
  if (status.status !== "ready" || !status.data.enabled) return null;
  const quota = status.data.quota;
  const spent = quotaSpent(quota);
  // The assistant works in words; a character limit is turned into a word budget (six characters a word, rounded down).
  const maxWords = question.limitKind === "words" ? question.limitValue : question.limitValue ? Math.floor(question.limitValue / 6) : null;
  return (
    <section className="assist" aria-labelledby={`fit-${question.id}`}>
      <div className="hd">
        <Sparkles className="ic" aria-hidden="true" style={{ color: "var(--s-agent-fg)" }} />
        <h3 id={`fit-${question.id}`}>Fit to limit</h3>
        <span className="draft-mark">Draft — review before use</span>
        <button className="iconbtn" type="button" aria-label="Close fit to limit" onClick={onClose} style={{ marginLeft: "auto" }}>
          <X className="ic" aria-hidden="true" />
        </button>
      </div>
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "14px" }}>
        <p>The assistant rewrites a library answer for this question{maxWords ? ` in about ${maxWords} words` : ""}. Nothing changes until you put the draft in the editor and save.</p>
        <Field id={`fit-answer-${question.id}`} label="Library answer">
          <select id={`fit-answer-${question.id}`} className="sel" value={answerId} onChange={(e) => setAnswerId(e.target.value)}>
            {answers.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          style={{ alignSelf: "flex-start" }}
          disabled={spent || !answerId || adapt.state === "saving"}
          onClick={async () => {
            const r = await adapt.run(answerId, { question: question.prompt, ...(maxWords ? { maxWords } : {}) });
            if (r) {
              setDraft(r);
              status.reload();
            }
          }}
        >
          {adapt.state === "saving" ? "Adapting…" : "Adapt to this question"}
        </button>
        {spent ? <QuotaSpentNote resetsAt={quota?.resetsAt} /> : null}
        {adapt.error ? <ErrorBanner error={adapt.error} title="The assistant could not draft this" /> : null}
        {draft ? (
          <div role="status" style={{ border: "1px dashed var(--s-agent-fg)", borderRadius: "8px", padding: "10px 12px", background: "var(--s-agent-bg)", display: "flex", flexDirection: "column", gap: "8px" }}>
            <p style={{ whiteSpace: "pre-wrap" }}>{draft.text}</p>
            <Counters counts={countText(draft.text)} limitKind={question.limitKind} limitValue={question.limitValue} />
            <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => onUse(draft.text)}>
                Put the draft in the editor
              </button>
              <CopyButton value={draft.text} what="the draft" label="Copy draft" className="btn btn-sm btn-secondary" />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------ one question

export function QuestionCard({
  q,
  n,
  applicationId,
  members,
  answers,
  org,
  readOnly,
  assist,
  onAssistUsed,
  canApprove,
  onChanged,
}: {
  q: OutsideQuestion;
  n: number;
  applicationId: string;
  members: ApplicantMember[];
  answers: LibraryAnswer[];
  org: MyOrganization | null;
  readOnly: boolean;
  /** The assistant's status; null or off hides every AI action. */
  assist: AssistStatus | null;
  onAssistUsed: () => void;
  /** A workspace admin or the application's owner (the API checks the same). */
  canApprove: boolean;
  onChanged: () => void;
}) {
  const saved = q.answer?.body ?? "";
  const [draft, setDraft] = useState(saved);
  const [dialog, setDialog] = useState<null | "library" | "fact" | "history" | "reuse">(null);
  const [editing, setEditing] = useState(false);
  const [fit, setFit] = useState(false);
  const [ai, setAi] = useState(false);
  const [comments, setComments] = useState(false);
  // The editor holds AI text (put there from the draft panel): it is saved marked as drafted with AI.
  const [fromAi, setFromAi] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cursor = useRef<number | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const assistOn = !!assist?.enabled;
  const put = useOutsideMutation((api, input: AnswerInput) => api.putAnswer(q.id, input));
  const patch = useOutsideMutation((api, p: Parameters<typeof api.updateQuestion>[1]) => api.updateQuestion(q.id, p));
  const remove = useOutsideMutation(async (api) => {
    await api.deleteQuestion(q.id);
    return true;
  });
  const counts = useMemo(() => countText(draft), [draft]);
  const dirty = draft !== saved;
  const nameOf = (id: string | null) => members.find((m) => m.userId === id)?.name ?? (id ? "A teammate" : "Someone");
  const headId = `oq-${q.id}-h`;

  const save = async () => {
    const r = await put.run({ body: draft, ...(fromAi ? { provenance: "assist" as const } : {}) });
    if (r) {
      setFromAi(false);
      onChanged();
    }
  };
  const insertLibrary = async (a: LibraryAnswer, text: string) => {
    const r = await put.run({ body: text, libraryAnswerId: a.id });
    if (r) {
      setDraft(text);
      setFromAi(false);
      setDialog(null);
      onChanged();
    }
  };
  const acceptAi = async (text: string) => {
    const r = await put.run({ body: text, provenance: "assist" });
    if (r) {
      setDraft(text);
      setFromAi(false);
      setAi(false);
      onChanged();
    }
  };
  const insertAtCursor = (value: string) => {
    const at = cursor.current ?? draft.length;
    const before = draft.slice(0, at);
    const sep = before && !/\s$/.test(before) ? " " : "";
    setDraft(`${before}${sep}${value}${draft.slice(at)}`);
    setDialog(null);
    requestAnimationFrame(() => area.current?.focus());
  };

  if (editing) {
    return (
      <QuestionForm
        initial={q}
        submitLabel="Save question"
        saving={patch.state === "saving"}
        onCancel={() => setEditing(false)}
        onSave={async (input) => {
          if (await patch.run(input)) {
            setEditing(false);
            onChanged();
          }
        }}
      />
    );
  }

  return (
    <article className="card" aria-labelledby={headId}>
      <div className="card-h" style={{ alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
          <span className="small muted">
            Question {n} · {PHASE_LABELS[q.phase]}
            {q.section ? ` · ${q.section}` : ""}
            {q.required ? "" : " · Optional"}
          </span>
          <h3 id={headId} style={{ fontSize: "16px", overflowWrap: "anywhere" }}>
            {q.prompt}
          </h3>
          {q.guidance && <p className="small muted">{q.guidance}</p>}
        </div>
        <StatusBadge kind="outsideQuestion" status={q.status} />
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
          <span className="tag">Limit: {limitPhrase(q.limitKind, q.limitValue)}</span>
          <label className="sr" htmlFor={`oq-assignee-${q.id}`}>
            Who writes question {n}
          </label>
          <select id={`oq-assignee-${q.id}`} className="sel" style={{ maxWidth: "200px", height: "30px" }} disabled={readOnly} value={q.assigneeUserId ?? ""} onChange={async (e) => (await patch.run({ assigneeUserId: e.target.value || null })) && onChanged()}>
            <option value="">No one assigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name ?? m.email}
              </option>
            ))}
          </select>
          <label className="sr" htmlFor={`oq-status-${q.id}`}>
            Status of question {n}
          </label>
          <select
            id={`oq-status-${q.id}`}
            className="sel"
            style={{ maxWidth: "180px", height: "30px" }}
            disabled={readOnly || (q.status === "approved" && !canApprove)}
            value={q.status}
            aria-describedby={canApprove ? undefined : `oq-approve-${q.id}`}
            onChange={async (e) => (await patch.run({ status: e.target.value as QuestionStatus })) && onChanged()}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} disabled={o.value === "approved" && !canApprove}>
                {o.label}
                {o.value === "approved" && !canApprove ? " (admin or owner)" : ""}
              </option>
            ))}
          </select>
          {!canApprove && !readOnly && (
            <span id={`oq-approve-${q.id}`} className="small muted">
              A workspace admin or the application’s owner approves answers.
            </span>
          )}
          {!readOnly && (
            <span className="row" style={{ gap: "4px", marginLeft: "auto" }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(true)} aria-label={`Edit question ${n}`}>
                <Pencil className="ic" aria-hidden="true" />
                Edit
              </button>
              {confirmDelete ? (
                <>
                  <button type="button" className="btn btn-sm btn-danger" onClick={async () => (await remove.run()) && onChanged()}>
                    Delete question {n} and its answers
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(false)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(true)} aria-label={`Delete question ${n}`}>
                  <Trash className="ic" aria-hidden="true" />
                  Delete
                </button>
              )}
            </span>
          )}
        </div>
        <label className="lbl" htmlFor={`oq-answer-${q.id}`}>
          Answer to question {n}
        </label>
        <textarea
          ref={area}
          id={`oq-answer-${q.id}`}
          className={isOverLimit(counts, q.limitKind, q.limitValue) ? "ta err" : "ta"}
          style={{ minHeight: "140px" }}
          readOnly={readOnly}
          value={draft}
          aria-describedby={`oq-counts-${q.id}`}
          onChange={(e) => setDraft(e.target.value)}
          onSelect={(e) => (cursor.current = e.currentTarget.selectionStart)}
          onBlur={(e) => (cursor.current = e.currentTarget.selectionStart)}
        />
        <Counters id={`oq-counts-${q.id}`} counts={counts} limitKind={q.limitKind} limitValue={q.limitValue} />
        <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
          {!readOnly && (
            <button type="button" className="btn btn-sm btn-primary" disabled={!dirty || put.state === "saving"} onClick={() => void save()}>
              {put.state === "saving" ? "Saving…" : "Save answer"}
            </button>
          )}
          {!readOnly && (
            <button type="button" className="btn btn-sm btn-secondary" aria-haspopup="dialog" disabled={!answers.length} onClick={() => setDialog("library")}>
              <BookOpen className="ic" aria-hidden="true" />
              Insert from library
            </button>
          )}
          {!readOnly && (
            <button type="button" className="btn btn-sm btn-secondary" aria-haspopup="dialog" onClick={() => setDialog("fact")}>
              <Building className="ic" aria-hidden="true" />
              Insert a fact
            </button>
          )}
          {!readOnly && assistOn && (
            <button type="button" className="btn btn-sm btn-secondary" aria-expanded={ai} onClick={() => setAi((v) => !v)}>
              <Sparkles className="ic" aria-hidden="true" />
              Draft with AI
            </button>
          )}
          {!readOnly && assistOn && answers.length > 0 && (
            <button type="button" className="btn btn-sm btn-secondary" aria-expanded={fit} onClick={() => setFit((v) => !v)}>
              <Sparkles className="ic" aria-hidden="true" />
              Fit to limit
            </button>
          )}
          {!readOnly && q.phase === "report" && (
            <button type="button" className="btn btn-sm btn-secondary" aria-haspopup="dialog" onClick={() => setDialog("reuse")}>
              <FileClock className="ic" aria-hidden="true" />
              Reuse from an earlier report
            </button>
          )}
          <CopyButton value={draft} what={`the answer to question ${n}`} className="btn btn-sm btn-ghost" />
          <CommentsButton open={comments} onToggle={() => setComments((v) => !v)} />
          {q.answer && (
            <button type="button" className="btn btn-sm btn-ghost" aria-haspopup="dialog" onClick={() => setDialog("history")}>
              <Clock className="ic" aria-hidden="true" />
              Version history ({q.answer.version})
            </button>
          )}
          <span className="row" style={{ gap: "8px", marginLeft: "auto" }}>
            {dirty ? <span className="small muted">{fromAi ? "Unsaved AI draft" : "Unsaved changes"}</span> : q.answer ? provenanceTag(q.answer.provenance) : null}
            <SaveNote state={put.state === "saved" && !dirty ? "saved" : "idle"} savedText={`Saved as version ${q.answer?.version ?? 1}`} />
          </span>
        </div>
        {ai && assist && (
          <DraftPanel
            question={q}
            library={answers}
            status={assist}
            onStatusChange={onAssistUsed}
            accepting={put.state === "saving"}
            onClose={() => setAi(false)}
            onAccept={(t) => void acceptAi(t)}
            onEdit={(t) => {
              setDraft(t);
              setFromAi(true);
              setAi(false);
              requestAnimationFrame(() => area.current?.focus());
            }}
          />
        )}
        {fit && <FitToLimit question={q} answers={answers} onClose={() => setFit(false)} onUse={(t) => setDraft(t)} />}
        {comments && <CommentsPanel applicationId={applicationId} question={q} n={n} members={members} readOnly={readOnly} />}
        {put.error && dialog !== "library" && dialog !== "reuse" ? <ErrorBanner error={put.error} title="The answer was not saved" /> : null}
        {patch.error ? <ErrorBanner error={patch.error} title="The question was not changed" /> : null}
        {remove.error ? <ErrorBanner error={remove.error} title="The question was not deleted" /> : null}
      </div>
      {dialog === "library" && <LibraryDialog answers={answers} question={q} busy={put.state === "saving"} error={put.error} onClose={() => setDialog(null)} onInsert={(a, t) => void insertLibrary(a, t)} />}
      {dialog === "reuse" && (
        <ReuseDialog
          question={q}
          busy={put.state === "saving"}
          error={put.error}
          onClose={() => setDialog(null)}
          onInsert={async (prior) => {
            if (await put.run({ body: prior.body, provenance: "prior_submission", sourceAnswerId: prior.answerId })) {
              setDraft(prior.body);
              setDialog(null);
              onChanged();
            }
          }}
        />
      )}
      {dialog === "fact" && <FactDialog org={org} onClose={() => setDialog(null)} onInsert={insertAtCursor} />}
      {dialog === "history" && (
        <HistoryDialog
          question={q}
          nameOf={nameOf}
          onClose={() => setDialog(null)}
          onUse={(body) => {
            setDraft(body);
            setFromAi(false);
            setDialog(null);
          }}
        />
      )}
    </article>
  );
}

// ------------------------------------------------------------------------------------ the tab

/** Whether the signed-in person may approve answers on this application: a workspace admin, or its owner. */
export function useCanApprove(ownerUserId: string | null | undefined): boolean {
  const ws = useCurrentWorkspace();
  const { meState } = useServices();
  return mayApprove(ws?.member.role ?? null, meState.status === "ready" ? meState.me.userId : null, ownerUserId);
}

export function QuestionsTab({ detail, members, answers, org, readOnly, onChanged }: { detail: OutsideDetail; members: ApplicantMember[]; answers: LibraryAnswer[]; org: MyOrganization | null; readOnly: boolean; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const add = useOutsideMutation((api, q: QuestionInput) => api.addQuestions(detail.id, [q]));
  const exp = useOutsideMutation(async (api, format: "txt" | "md" | "pdf") => {
    const f = await api.exportApplication(detail.id, format);
    downloadBlob(f.blob, f.filename);
    return true;
  });
  const assist = useFullQuery((api) => api.assistStatus(), []);
  const assistStatus = assist.status === "ready" ? assist.data : null;
  const canApprove = useCanApprove(detail.owner?.userId);
  // Report questions are written on their report, under Awarded funding.
  const questions = detail.questions.filter((q) => !q.obligationId);
  const approved = questions.filter((q) => q.status === "approved").length;

  return (
    <>
      <div className="row" style={{ gap: "8px", flexWrap: "wrap", justifyContent: "space-between" }}>
        <span className="small muted">
          {questions.length} question{questions.length === 1 ? "" : "s"} · {approved} approved
        </span>
        <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
          {!readOnly && (
            <>
              <button type="button" className="btn btn-sm btn-primary" aria-haspopup="dialog" onClick={() => setPasting(true)}>
                <ClipboardList className="ic" aria-hidden="true" />
                Paste questions
              </button>
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setAdding(true)} disabled={adding}>
                <Plus className="ic" aria-hidden="true" />
                Add a question
              </button>
            </>
          )}
          {questions.length > 0 && <CopyButton value={plainText(questions)} what="all questions and answers as plain text" label="Copy all as plain text" className="btn btn-sm btn-secondary" />}
          {questions.length > 0 && (
            <span className="row" style={{ gap: "4px" }}>
              <label className="sr" htmlFor="oq-export">
                Download format
              </label>
              <select id="oq-export" className="sel" style={{ height: "30px", width: "auto" }} defaultValue="" onChange={(e) => {
                const v = e.target.value as "txt" | "md" | "pdf" | "";
                e.target.value = "";
                if (v) void exp.run(v);
              }}>
                <option value="" disabled>
                  Download…
                </option>
                <option value="txt">Plain text (.txt)</option>
                <option value="md">Markdown (.md)</option>
                <option value="pdf">PDF</option>
              </select>
            </span>
          )}
        </div>
      </div>
      {note && (
        <Notice tone="ok" title={note}>
          Write each answer below; counts follow the funder’s limits as you type.
        </Notice>
      )}
      <AiUseNote questions={questions} />
      {exp.error ? <ErrorBanner error={exp.error} title="The download did not start" /> : null}
      {adding && (
        <QuestionForm
          submitLabel="Add question"
          saving={add.state === "saving"}
          onCancel={() => setAdding(false)}
          onSave={async (q) => {
            if (await add.run(q)) {
              setAdding(false);
              onChanged();
            }
          }}
        />
      )}
      {add.error ? <ErrorBanner error={add.error} title="The question was not added" /> : null}
      {questions.length === 0 && !adding ? (
        <div className="card">
          <EmptyState
            icon={ClipboardList}
            title="No questions yet"
            actions={
              !readOnly ? (
                <button type="button" className="btn btn-primary" onClick={() => setPasting(true)}>
                  Paste questions
                </button>
              ) : undefined
            }
          >
            Paste the questions from the funder’s guidelines or portal, or add them one at a time.
          </EmptyState>
        </div>
      ) : (
        questions.map((q, i) => <QuestionCard key={q.id} q={q} n={i + 1} applicationId={detail.id} members={members} answers={answers} org={org} readOnly={readOnly} assist={assistStatus} onAssistUsed={assist.reload} canApprove={canApprove} onChanged={onChanged} />)
      )}
      {pasting && (
        <PasteQuestionsDialog
          applicationId={detail.id}
          assist={assistStatus}
          requiredDocuments={detail.requiredDocuments}
          onClose={() => setPasting(false)}
          onSaved={(n, docs = 0) => {
            setPasting(false);
            setNote([n || !docs ? `${n} question${n === 1 ? "" : "s"} added` : null, docs ? `${docs} document${docs === 1 ? "" : "s"} added to the checklist` : null].filter(Boolean).join(" · "));
            assist.reload();
            onChanged();
          }}
        />
      )}
    </>
  );
}
