// SPDX-License-Identifier: AGPL-3.0-only
// The questions of an outside application and the answers to them. Questions are typed in or
// pasted from the funder's guidelines (split into questions for review before anything is saved).
// Each answer is written here with live counts against the funder's limit, can start from the
// answer library or an organization fact, and every save is a new version. Written together, each
// question shows who is in it, is read-only while someone else types in it, and takes their saved
// answer within seconds unless this person has unsaved changes there (lib/presence.ts).
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { BookOpen, Bot, CircleCheck, ClipboardList, Clock, FileClock, Pencil, Plus, Sparkles, Trash, TriangleExclamationPoint, Building, X } from "lucide-react";
import type { ApplicantMember, MyOrganization } from "../../../api/applicant.ts";
import type { AdaptedDraft, AssistStatus } from "../../../api/applicantFull.ts";
import { useFullMutation, useFullQuery } from "../../../api/applicantFullHooks.ts";
import type { AnswerInput, LimitKind, OutsideAnswer, OutsideDetail, OutsideQuestion, QuestionInput, QuestionPhase, QuestionStatus } from "../../../api/outside.ts";
import { useOutsideMutation, useOutsideQuery } from "../../../api/outsideHooks.ts";
import type { DraftInvitation, DraftInvitationList } from "../../../api/invites.ts";
import type { LibraryAnswer } from "../../../api/writeKeep.ts";
import { useWriteKeepApi } from "../../../api/writeKeepHooks.ts";
import { useServices } from "../../../app/services.tsx";
import { useCurrentWorkspace } from "../../../app/workspace.tsx";
import { CopyButton } from "../../../components/CopyButton.tsx";
import { Dialog } from "../../../components/Dialog.tsx";
import { Loaded, timeAgo } from "../../../components/applicant.tsx";
import { StatusBadge } from "../../../components/status.tsx";
import { EmptyState, ErrorBanner, Field, Notice, SaveNote } from "../../../components/ui.tsx";
import { quotaSpent, QuotaSpentNote } from "../../../components/launch.tsx";
import { downloadBlob } from "../../../lib/browser.ts";
import { countFor, countText, isOverLimit, type ParsedQuestion, type TextCounts } from "../../../lib/outside.ts";
import { bestVariant, canApprove as mayApprove, mergeRequired, variantChoices, type RequiredDocument } from "../../../lib/writeKeep.ts";
import { InviteDialog, InviteOptions, InvitePicker, InviteSentNote, TeamNote, useDraftInvites } from "../inviteDraft.tsx";
import { GuidelinesReader } from "./guidelines.tsx";
import { orgFacts } from "./shared.tsx";
import { AiUseNote, CommentsButton, CommentsPanel, DraftPanel, ReuseDialog, StaleBadge } from "./writeFaster.tsx";
import type { DraftPresence } from "../../../lib/presence.ts";
import { ChangedNote, EditingChips, LockNote } from "../editorPresence.tsx";
import { t } from "../i18n.ts";
import { limitPhrase, variantLabel } from "../labels.ts";

/** Each part's name, read in the page's language every time. */
export const PHASE_LABELS: Record<QuestionPhase, string> = {
  get loi() { return t("outsideQuestionsTab.phase.loi"); },
  get full() { return t("outsideQuestionsTab.phase.full"); },
  get report() { return t("outsideQuestionsTab.phase.report"); },
};
// Tables of labels are functions, so they follow the page's language (docs/i18n.md).
const STATUS_OPTIONS = (): { value: QuestionStatus; label: string }[] => [
  { value: "empty", label: t("outsideQuestionsTab.status.empty") },
  { value: "draft", label: t("outsideQuestionsTab.status.draft") },
  { value: "ready", label: t("outsideQuestionsTab.status.ready") },
  { value: "approved", label: t("outsideQuestionsTab.status.approved") },
];
const LIMIT_OPTIONS = (): { value: LimitKind | ""; label: string }[] => [
  { value: "", label: t("labels.limit.none") },
  { value: "words", label: t("outsideQuestionsTab.limitKind.words") },
  { value: "chars", label: t("outsideQuestionsTab.limitKind.chars") },
  { value: "chars_no_spaces", label: t("outsideQuestionsTab.limitKind.charsNoSpaces") },
];

/** Every question and its latest answer as plain text, ready to paste into a funder's portal. */
export function plainText(questions: OutsideQuestion[]): string {
  return questions.map((q, i) => `${i + 1}. ${q.prompt}\n\n${q.answer?.body.trim() || t("outsideQuestionsTab.noAnswerYet")}`).join("\n\n");
}

// ------------------------------------------------------------------------------------ counters

/** Words, characters and characters without spaces. The funder's limit is highlighted; over it is said in words. */
export function Counters({ counts, limitKind, limitValue, id }: { counts: TextCounts; limitKind: LimitKind | null; limitValue: number | null; id?: string }) {
  const over = isOverLimit(counts, limitKind, limitValue);
  const item = (kind: LimitKind, n: number) => {
    const active = kind === limitKind && !!limitValue;
    const text =
      kind === "words"
        ? active ? t("outsideQuestionsTab.counter.wordsOf", { count: n, limit: limitValue! }) : t("outsideQuestionsTab.counter.words", { count: n })
        : kind === "chars"
          ? active ? t("outsideQuestionsTab.counter.charsOf", { count: n, limit: limitValue! }) : t("outsideQuestionsTab.counter.chars", { count: n })
          : active ? t("outsideQuestionsTab.counter.noSpacesOf", { count: n, limit: limitValue! }) : t("outsideQuestionsTab.counter.noSpaces", { count: n });
    return (
      <span key={kind} className={active ? (over ? "counter over" : "counter b") : "counter"} data-active={active ? "true" : undefined} style={active ? { color: over ? undefined : "var(--og-navy-dark)" } : undefined}>
        {text}
      </span>
    );
  };
  return (
    <div className="row" id={id} style={{ gap: "14px", flexWrap: "wrap", justifyContent: "flex-end" }}>
      {item("words", counts.words)}
      {item("chars", counts.chars)}
      {item("chars_no_spaces", counts.charsNoSpaces)}
      <span role="status" aria-live="polite" className="row" style={{ gap: "6px" }}>
        {over && limitKind && limitValue ? (
          <span className="counter over row" style={{ gap: "4px" }}>
            <TriangleExclamationPoint className="ic ic-sm" aria-hidden="true" />
            {t("outsideQuestionsTab.overBy", { kind: limitKind, count: countFor(counts, limitKind) - limitValue })}
          </span>
        ) : limitKind && limitValue ? (
          <span className="counter row" style={{ gap: "4px", color: "var(--s-ok-fg)" }}>
            <CircleCheck className="ic ic-sm" aria-hidden="true" />
            {t("outsideQuestionsTab.withinTheLimit")}
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
  const limitError = limitKind && !(value > 0) ? t("outsideQuestionsTab.limitNumber") : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || limitError) return;
    onSave({ prompt: prompt.trim(), guidance: guidance.trim() || null, phase, section: section.trim() || null, limitKind: limitKind || null, limitValue: limitKind ? value : null, required });
  };
  return (
    <form onSubmit={submit} className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "12px" }} aria-label={initial ? t("outsideQuestionsTab.editQuestion") : t("outsideQuestionsTab.newQuestion")}>
      <Field id={`qf-prompt-${key}`} label={t("outsideQuestionsTab.question")} required>
        <textarea id={`qf-prompt-${key}`} className="ta" style={{ minHeight: "64px" }} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </Field>
      <Field id={`qf-guidance-${key}`} label={t("outsideQuestionsTab.guidance")} help={t("outsideQuestionsTab.anythingTheFunderSaysAboutHow")}>
        <textarea id={`qf-guidance-${key}`} className="ta" style={{ minHeight: "48px" }} value={guidance} onChange={(e) => setGuidance(e.target.value)} />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "12px" }}>
        <Field id={`qf-phase-${key}`} label={t("outsideQuestionsTab.part")}>
          <select id={`qf-phase-${key}`} className="sel" value={phase} onChange={(e) => setPhase(e.target.value as QuestionPhase)}>
            {(Object.keys(PHASE_LABELS) as QuestionPhase[]).map((p) => (
              <option key={p} value={p}>
                {PHASE_LABELS[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`qf-section-${key}`} label={t("outsideQuestionsTab.section")}>
          <input id={`qf-section-${key}`} className="inp" value={section} onChange={(e) => setSection(e.target.value)} />
        </Field>
        <Field id={`qf-limitkind-${key}`} label={t("outsideQuestionsTab.limit")}>
          <select id={`qf-limitkind-${key}`} className="sel" value={limitKind} onChange={(e) => setLimitKind(e.target.value as LimitKind | "")}>
            {LIMIT_OPTIONS().map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`qf-limit-${key}`} label={t("outsideQuestionsTab.limitAmount")} error={limitError}>
          <input id={`qf-limit-${key}`} className="inp" inputMode="numeric" disabled={!limitKind} value={limitValue} onChange={(e) => setLimitValue(e.target.value)} />
        </Field>
      </div>
      <label className="row" style={{ gap: "8px", fontSize: "14px" }}>
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
        {t("outsideQuestionsTab.theFunderRequiresAnAnswer")}
      </label>
      <div className="row" style={{ gap: "8px", justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          {t("outsideQuestionsTab.cancel")}
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving || !prompt.trim() || !!limitError}>
          {saving ? t("outsideQuestionsTab.saving") : submitLabel}
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
  const wk = useWriteKeepApi();
  const save = useOutsideMutation(async (api, qs: QuestionInput[], labels: string[]) => {
    // Report questions are kept on their report; the application's on the application.
    const made = !qs.length ? [] : obligationId ? await wk.addReportQuestions(obligationId, qs) : await api.addQuestions(applicationId, qs);
    if (labels.length) await wk.setRequiredDocuments(applicationId, mergeRequired(requiredDocuments, labels));
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
            {t("outsideQuestionsTab.pasteTheFundersQuestions")}
          </h3>
          <p className="small muted">
            {proposed
              ? t("outsideQuestionsTab.checkEachQuestionAndItsLimit")
              : mode === "ai"
                ? t("outsideQuestionsTab.theAssistantReadsTheFundersGuidelines")
                : t("outsideQuestionsTab.pasteTheQuestionsFromTheFunders")}
          </p>
        </div>
        <button className="iconbtn" type="button" aria-label={t("outsideQuestionsTab.close")} onClick={onClose}>
          <X className="ic ic-md" aria-hidden="true" />
        </button>
      </div>
      <div className="bd">
        {!proposed && aiOn && (
          <div className="seg" role="group" aria-label={t("outsideQuestionsTab.howToFindTheQuestions")}>
            <button type="button" className={mode === "text" ? "on" : undefined} aria-pressed={mode === "text"} onClick={() => setMode("text")}>
              <ClipboardList className="ic ic-sm" aria-hidden="true" />
              {t("outsideQuestionsTab.pasteTheQuestions")}
            </button>
            <button type="button" className={mode === "ai" ? "on" : undefined} aria-pressed={mode === "ai"} onClick={() => setMode("ai")}>
              <Sparkles className="ic ic-sm" aria-hidden="true" />
              {t("outsideQuestionsTab.readTheFundersGuidelines")}
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
          <Field id="paste-q-text" label={t("outsideQuestionsTab.questions")}>
            <textarea id="paste-q-text" className="ta" style={{ minHeight: "220px" }} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("outsideQuestionsTab.n1DescribeTheNeedYourProject")} />
          </Field>
        ) : proposed.length === 0 && docs.length === 0 ? (
          <Notice tone="neu" title={t("outsideQuestionsTab.noQuestionsWereFoundInThat")}>
            {t("outsideQuestionsTab.goBackAndPasteTheQuestions")}
          </Notice>
        ) : (
          <ol aria-label={t("outsideQuestionsTab.proposedQuestions")} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {proposed.map((q, i) => (
              <li key={i} className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "8px", opacity: q.keep ? 1 : 0.6 }}>
                <div className="row" style={{ justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                  <label className="row small b" style={{ gap: "6px" }}>
                    <input type="checkbox" checked={q.keep} onChange={(e) => update(i, { keep: e.target.checked })} />
                    {t("outsideQuestionsTab.keepQuestion", { n: i + 1 })}
                  </label>
                  <span className="small muted">
                    {PHASE_LABELS[q.phase]} · {limitPhrase(q.limitKind, q.limitValue)}
                    {q.limitKind ? ` ${t("outsideQuestionsTab.foundInText")}` : ""}
                  </span>
                </div>
                <label className="sr" htmlFor={`pq-${i}`}>
                  {t("outsideQuestionsTab.questionN", { n: i + 1 })}
                </label>
                <textarea id={`pq-${i}`} className="ta" style={{ minHeight: "48px" }} value={q.prompt} onChange={(e) => update(i, { prompt: e.target.value })} />
                <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                  <label className="sr" htmlFor={`pq-kind-${i}`}>
                    {t("outsideQuestionsTab.limitFor", { n: i + 1 })}
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
                    {LIMIT_OPTIONS().map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {q.limitKind && (
                    <>
                      <label className="sr" htmlFor={`pq-val-${i}`}>
                        {t("outsideQuestionsTab.limitAmountFor", { n: i + 1 })}
                      </label>
                      <input id={`pq-val-${i}`} className="inp" inputMode="numeric" style={{ maxWidth: "120px" }} value={q.limitValue ?? ""} onChange={(e) => update(i, { limitValue: Number.parseInt(e.target.value.replace(/,/g, ""), 10) || 0 })} />
                    </>
                  )}
                  <label className="sr" htmlFor={`pq-phase-${i}`}>
                    {t("outsideQuestionsTab.partFor", { n: i + 1 })}
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
        {proposed && kept && <p className="small muted">{t("outsideQuestionsTab.guidelinesKept", { name: kept })}</p>}
        {proposed && docs.length > 0 && (
          <fieldset className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "6px", margin: 0 }}>
            <legend className="small b" style={{ padding: "0 4px" }}>
              {t("outsideQuestionsTab.documentsTheFunderAsksFor")}
            </legend>
            {docs.map((d, i) => (
              <label key={d.label} className="row small" style={{ gap: "8px" }}>
                <input type="checkbox" checked={d.keep} onChange={(e) => setDocs(docs.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} />
                {d.label}
              </label>
            ))}
            <span className="help">{t("outsideQuestionsTab.keptOnesGoOnTheChecklist")}</span>
          </fieldset>
        )}
        {parse.error ? <ErrorBanner error={parse.error} title={t("outsideQuestionsTab.theQuestionsCouldNotBeRead")} /> : null}
        {save.error ? <ErrorBanner error={save.error} title={t("outsideQuestionsTab.theQuestionsWereNotSaved")} /> : null}
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
              {mode === "ai" ? t("outsideQuestionsTab.backToTheGuidelines") : t("outsideQuestionsTab.backToTheText")}
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={(keep.length === 0 && keepDocs.length === 0) || save.state === "saving"}
              onClick={async () => {
                const made = await save.run(
                  keep.map((q) => ({ prompt: q.prompt.trim(), phase: obligationId ? "report" : q.phase, limitKind: q.limitKind ?? null, limitValue: q.limitKind && q.limitValue ? q.limitValue : null })),
                  keepDocs,
                );
                if (made) onSaved(made.length, keepDocs.length);
              }}
            >
              {save.state === "saving" ? t("outsideQuestionsTab.saving") : saveLabel(keep.length, keepDocs.length)}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-secondary" type="button" onClick={onClose}>
              {t("outsideQuestionsTab.cancel")}
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
                {parse.state === "saving" ? t("outsideQuestionsTab.reading") : t("outsideQuestionsTab.findTheQuestions")}
              </button>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

const saveLabel = (q: number, d: number) => (d === 0 ? t("outsideQuestionsTab.saveQuestions", { count: q }) : q === 0 ? t("outsideQuestionsTab.saveDocuments", { count: d }) : t("outsideQuestionsTab.saveBoth", { questions: q, documents: d }));

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
            {t("outsideQuestionsTab.insertFromAnswerLibrary")}
          </h3>
          <p className="small muted">{t("outsideQuestionsTab.theLibraryTextReplacesTheAnswer")}</p>
        </div>
        <button className="iconbtn" type="button" aria-label={t("outsideQuestionsTab.close")} onClick={onClose}>
          <X className="ic ic-md" aria-hidden="true" />
        </button>
      </div>
      <div className="bd">
        <Field id="olib-answer" label={t("outsideQuestionsTab.libraryAnswer")}>
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
                {a.title} · {t("outsideQuestionsTab.versionShort", { version: String(a.version) })} · {t("outsideQuestionsTab.wordsCount", { count: a.words })}
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
          <Field id="olib-variant" label={t("outsideQuestionsTab.version")} help={question.limitKind && question.limitValue ? t("outsideQuestionsTab.fitsBest", { name: best ? variantLabel(best.key) : t("outsideQuestionsTab.thisVersion"), limit: limitPhrase(question.limitKind, question.limitValue) }) : undefined}>
            <select id="olib-variant" className="sel" value={choice.key} onChange={(e) => setPicked(e.target.value)}>
              {choices.map((c) => (
                <option key={c.key} value={c.key}>
                  {variantLabel(c.key)} · {t("outsideQuestionsTab.wordsCount", { count: c.counts.words })}
                  {question.limitKind && question.limitValue && countFor(c.counts, question.limitKind) > question.limitValue ? ` · ${t("outsideQuestionsTab.overTheLimit")}` : ""}
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
        {error ? <ErrorBanner error={error} title={t("outsideQuestionsTab.theAnswerWasNotInserted")} /> : null}
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          {t("outsideQuestionsTab.cancel")}
        </button>
        <button className="btn btn-primary" type="button" disabled={!answer || !choice || busy} onClick={() => answer && choice && onInsert(answer, choice.text)}>
          {busy ? t("outsideQuestionsTab.inserting") : t("outsideQuestionsTab.insert")}
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
            {t("outsideQuestionsTab.insertAFactAboutYourOrganization")}
          </h3>
          <p className="small muted">{t("outsideQuestionsTab.theFactGoesInWhereYour")}</p>
        </div>
        <button className="iconbtn" type="button" aria-label={t("outsideQuestionsTab.close")} onClick={onClose}>
          <X className="ic ic-md" aria-hidden="true" />
        </button>
      </div>
      <div className="bd">
        {facts.length === 0 ? (
          <Notice tone="neu" title={t("outsideQuestionsTab.noOrganizationFactsYet")}>
            {t("outsideQuestionsTab.addYourOrganizationsDetailsUnderOrganization")}
          </Notice>
        ) : (
          <ul aria-label={t("outsideQuestionsTab.organizationFacts")} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {facts.map((f) => (
              <li key={f.key} className="row" style={{ gap: "12px", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--og-gray-100)" }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small b">{f.label}</div>
                  <div style={{ fontSize: "14px", overflowWrap: "anywhere" }}>{f.value}</div>
                  <div className="small muted">{f.from}</div>
                </div>
                <button type="button" className="btn btn-sm btn-secondary" aria-label={t("outsideQuestionsTab.insertLabel", { label: f.label })} onClick={() => onInsert(f.value)}>
                  {t("outsideQuestionsTab.insert")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="ft">
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          {t("outsideQuestionsTab.close")}
        </button>
      </div>
    </Dialog>
  );
}

export const provenanceTag = (p: string) =>
  p === "assist" ? (
    <span className="prov prov-agent">
      <Sparkles className="ic" aria-hidden="true" />
      {t("outsideQuestionsTab.draftedWithAi")}
    </span>
  ) : p === "prior_submission" ? (
    <span className="prov prov-report">
      <FileClock className="ic" aria-hidden="true" />
      {t("outsideQuestionsTab.fromAnEarlierReport")}
    </span>
  ) : p === "library" ? (
    <span className="prov prov-library">
      <BookOpen className="ic" aria-hidden="true" />
      {t("outsideQuestionsTab.fromLibrary")}
    </span>
  ) : p.startsWith("agent") ? (
    <span className="prov prov-agent">
      <Bot className="ic" aria-hidden="true" />
      {t("outsideQuestionsTab.draftedByAnAgent")}
    </span>
  ) : (
    <span className="prov prov-entered">
      <Pencil className="ic" aria-hidden="true" />
      {t("outsideQuestionsTab.writtenByYourTeam")}
    </span>
  );

function HistoryDialog({ question, onUse, onClose, nameOf }: { question: OutsideQuestion; onUse: (body: string) => void; onClose: () => void; nameOf: (id: string | null) => string }) {
  const history = useOutsideQuery((api) => api.answerHistory(question.id), [question.id]);
  return (
    <Dialog open onClose={onClose} labelledBy="ohist-title" size="lg">
      <div className="hd">
        <div>
          <h3 id="ohist-title" style={{ fontSize: "16px" }}>
            {t("outsideQuestionsTab.earlierVersions")}
          </h3>
          <p className="small muted">{question.prompt}</p>
        </div>
        <button className="iconbtn" type="button" aria-label={t("outsideQuestionsTab.close")} onClick={onClose}>
          <X className="ic ic-md" aria-hidden="true" />
        </button>
      </div>
      <div className="bd" style={{ maxHeight: "60vh", overflow: "auto" }}>
        <Loaded query={history} label={t("outsideQuestionsTab.loadingVersions")}>
          {(versions) => (
            <ol aria-label={t("outsideQuestionsTab.versions")} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {versions.map((v: OutsideAnswer) => (
                <li key={v.id} className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                    <span className="b">{t("outsideQuestionsTab.versionN", { version: String(v.version) })}</span>
                    {provenanceTag(v.provenance)}
                    <span className="small muted">
                      {nameOf(v.createdBy)} · {timeAgo(v.createdAt)}
                    </span>
                  </div>
                  <p style={{ whiteSpace: "pre-wrap", fontSize: "14px" }}>{v.body || <span className="muted">{t("outsideQuestionsTab.empty")}</span>}</p>
                  <div className="row" style={{ gap: "8px" }}>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => onUse(v.body)}>
                      {t("outsideQuestionsTab.putThisVersionInTheEditor")}
                    </button>
                    <CopyButton value={v.body} what={t("outsideQuestionsTab.versionLower", { version: String(v.version) })} className="btn btn-sm btn-ghost" />
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
        <h3 id={`fit-${question.id}`}>{t("outsideQuestionsTab.fitToLimit")}</h3>
        <span className="draft-mark">{t("outsideQuestionsTab.draftReviewBeforeUse")}</span>
        <button className="iconbtn" type="button" aria-label={t("outsideQuestionsTab.closeFitToLimit")} onClick={onClose} style={{ marginLeft: "auto" }}>
          <X className="ic" aria-hidden="true" />
        </button>
      </div>
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "14px" }}>
        <p>{maxWords ? t("outsideQuestionsTab.fitIntroWords", { words: maxWords }) : t("outsideQuestionsTab.fitIntro")}</p>
        <Field id={`fit-answer-${question.id}`} label={t("outsideQuestionsTab.libraryAnswer")}>
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
          {adapt.state === "saving" ? t("outsideQuestionsTab.adapting") : t("outsideQuestionsTab.adaptToThisQuestion")}
        </button>
        {spent ? <QuotaSpentNote resetsAt={quota?.resetsAt} /> : null}
        {adapt.error ? <ErrorBanner error={adapt.error} title={t("outsideQuestionsTab.theAssistantCouldNotDraftThis")} /> : null}
        {draft ? (
          <div role="status" style={{ border: "1px dashed var(--s-agent-fg)", borderRadius: "8px", padding: "10px 12px", background: "var(--s-agent-bg)", display: "flex", flexDirection: "column", gap: "8px" }}>
            <p style={{ whiteSpace: "pre-wrap" }}>{draft.text}</p>
            <Counters counts={countText(draft.text)} limitKind={question.limitKind} limitValue={question.limitValue} />
            <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => onUse(draft.text)}>
                {t("outsideQuestionsTab.putTheDraftInTheEditor")}
              </button>
              <CopyButton value={draft.text} what={t("outsideQuestionsTab.theDraft")} label={t("outsideQuestionsTab.copyDraft")} className="btn btn-sm btn-secondary" />
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
  reportOf = null,
  cowriter = false,
  invites = null,
  onInvite,
  live = null,
}: {
  q: OutsideQuestion;
  /** The draft's live channel: who is in this question, its soft lock, and announcing a save. */
  live?: DraftPresence | null;
  n: number;
  applicationId: string;
  /** The signed-in person is a consultant invited into this draft: they write answers, the team sets up the questions. */
  cowriter?: boolean;
  /** Invitations into this application still waiting, for the assignee picker. */
  invites?: DraftInvitationList | null;
  /** Offers "Invite someone by email" in the assignee picker. */
  onInvite?: (questionId: string) => void;
  /** A report question: the report obligation it belongs to (offers reuse from earlier reports). */
  reportOf?: string | null;
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
  // A cowriter's AI drafts would spend the team's quota on a draft they were only invited into: not offered.
  const assistOn = !!assist?.enabled && !cowriter;
  const { meState } = useServices();
  const myId = meState.status === "ready" ? meState.me.userId : null;
  const put = useOutsideMutation((api, input: AnswerInput) => api.putAnswer(q.id, input));
  const patch = useOutsideMutation((api, p: Parameters<typeof api.updateQuestion>[1]) => api.updateQuestion(q.id, p));
  const remove = useOutsideMutation(async (api) => {
    await api.deleteQuestion(q.id);
    return true;
  });
  const counts = useMemo(() => countText(draft), [draft]);
  const dirty = draft !== saved;
  const nameOf = (id: string | null) => members.find((m) => m.userId === id)?.name ?? (id ? t("outsideQuestionsTab.aTeammate") : t("outsideQuestionsTab.someone"));
  const headId = `oq-${q.id}-h`;

  // Live co-editing. Someone else typing here makes the answer read-only for this person (never
  // while this person is in it); a new saved answer replaces what is shown unless this person has
  // unsaved changes, which stay, with "{name} changed this" and the other version a click away.
  const [inside, setInside] = useState(false);
  const holder = live?.lockOf(q.id);
  const lockedOut = !!holder && !inside;
  const answerReadOnly = readOnly || lockedOut;
  const here = (live?.inField(q.id) ?? []).filter((p) => p !== holder);
  const lastSaved = useRef(saved);
  const lastSent = useRef<string | null>(null);
  const [clash, setClash] = useState<{ by: string; theirs: string } | null>(null);
  useEffect(() => {
    const was = lastSaved.current;
    if (saved === was) return;
    lastSaved.current = saved;
    if (draft === was || draft === saved) {
      setDraft(saved);
      return;
    }
    const mine = saved === lastSent.current || (!!myId && q.answer?.createdBy === myId);
    if (!mine) setClash({ by: nameOf(q.answer?.createdBy ?? null), theirs: saved });
    // Only a new saved answer decides; the draft is read as it is at that moment.
  }, [saved]);
  const announce = () => live?.saved(q.id, [q.id]);

  const save = async () => {
    lastSent.current = draft;
    const r = await put.run({ body: draft, ...(fromAi ? { provenance: "assist" as const } : {}) });
    if (r) {
      setFromAi(false);
      announce();
      onChanged();
    }
  };
  const insertLibrary = async (a: LibraryAnswer, text: string) => {
    lastSent.current = text;
    const r = await put.run({ body: text, libraryAnswerId: a.id });
    if (r) {
      setDraft(text);
      setFromAi(false);
      setDialog(null);
      announce();
      onChanged();
    }
  };
  const acceptAi = async (text: string) => {
    lastSent.current = text;
    const r = await put.run({ body: text, provenance: "assist" });
    if (r) {
      setDraft(text);
      setFromAi(false);
      setAi(false);
      announce();
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
        submitLabel={t("outsideQuestionsTab.saveQuestion")}
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
            {t("outsideQuestionsTab.questionN", { n })} · {PHASE_LABELS[q.phase]}
            {q.section ? ` · ${q.section}` : ""}
            {q.required ? "" : ` · ${t("outsideQuestionsTab.optional")}`}
          </span>
          <h3 id={headId} style={{ fontSize: "16px", overflowWrap: "anywhere" }}>
            {q.prompt}
          </h3>
          {q.guidance && <p className="small muted">{q.guidance}</p>}
          <EditingChips peers={here} />
        </div>
        <StatusBadge kind="outsideQuestion" status={q.status} />
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
          <span className="tag">{t("outsideQuestionsTab.limitTag", { limit: limitPhrase(q.limitKind, q.limitValue) })}</span>
          {cowriter ? (
            <span className="tag">{q.assigneeUserId && q.assigneeUserId === myId ? t("outsideQuestionsTab.assignedToYou") : q.assigneeUserId ? t("outsideQuestionsTab.assignedToATeammate") : t("outsideQuestionsTab.noOneAssigned")}</span>
          ) : (
            <>
              <label className="sr" htmlFor={`oq-assignee-${q.id}`}>
                {t("outsideQuestionsTab.whoWrites", { n })}
              </label>
              <InvitePicker
                id={`oq-assignee-${q.id}`}
                className="sel"
                style={{ maxWidth: "220px", height: "30px" }}
                disabled={readOnly}
                value={q.assigneeUserId ?? ""}
                onInvite={() => onInvite?.(q.id)}
                onChoose={async (value) => {
                  if ((await patch.run({ assigneeUserId: value || null })) !== undefined) onChanged();
                }}
              >
                <option value="">{t("outsideQuestionsTab.noOneAssigned")}</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name ?? m.email}
                  </option>
                ))}
                {!readOnly && <InviteOptions list={invites} match={(d) => d.questionId === q.id} />}
              </InvitePicker>
            </>
          )}
          <label className="sr" htmlFor={`oq-status-${q.id}`}>
            {t("outsideQuestionsTab.statusOf", { n })}
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
            {STATUS_OPTIONS().map((o) => (
              <option key={o.value} value={o.value} disabled={o.value === "approved" && !canApprove}>
                {o.label}
                {o.value === "approved" && !canApprove ? ` ${t("outsideQuestionsTab.adminOrOwner")}` : ""}
              </option>
            ))}
          </select>
          {!canApprove && !readOnly && (
            <span id={`oq-approve-${q.id}`} className="small muted">
              {t("outsideQuestionsTab.aWorkspaceAdminOrTheApplications")}
            </span>
          )}
          {!readOnly && !cowriter && (
            <span className="row" style={{ gap: "4px", marginLeft: "auto" }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(true)} aria-label={t("outsideQuestionsTab.editQuestionN", { n })}>
                <Pencil className="ic" aria-hidden="true" />
                {t("outsideQuestionsTab.edit")}
              </button>
              {confirmDelete ? (
                <>
                  <button type="button" className="btn btn-sm btn-danger" onClick={async () => (await remove.run()) && onChanged()}>
                    {t("outsideQuestionsTab.deleteWithAnswers", { n })}
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(false)}>
                    {t("outsideQuestionsTab.keepIt")}
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(true)} aria-label={t("outsideQuestionsTab.deleteQuestionN", { n })}>
                  <Trash className="ic" aria-hidden="true" />
                  {t("outsideQuestionsTab.delete")}
                </button>
              )}
            </span>
          )}
        </div>
        <label className="lbl" htmlFor={`oq-answer-${q.id}`}>
          {t("outsideQuestionsTab.answerTo", { n })}
        </label>
        {lockedOut && holder ? <LockNote peer={holder} id={`oq-lock-${q.id}`} /> : null}
        {clash && (
          <ChangedNote
            name={clash.by}
            theirs={clash.theirs || null}
            onKeep={() => setClash(null)}
            onUseTheirs={() => {
              setDraft(clash.theirs);
              setClash(null);
            }}
          />
        )}
        <textarea
          ref={area}
          id={`oq-answer-${q.id}`}
          className={isOverLimit(counts, q.limitKind, q.limitValue) ? "ta err" : "ta"}
          style={{ minHeight: "140px" }}
          readOnly={answerReadOnly}
          value={draft}
          aria-describedby={lockedOut ? `oq-lock-${q.id} oq-counts-${q.id}` : `oq-counts-${q.id}`}
          onChange={(e) => setDraft(e.target.value)}
          onSelect={(e) => (cursor.current = e.currentTarget.selectionStart)}
          onFocus={() => {
            setInside(true);
            live?.focus({ ...(q.section ? { section: q.section } : {}), field: q.id });
          }}
          onInput={() => {
            if (!answerReadOnly) live?.input(q.id);
          }}
          onBlur={(e) => {
            cursor.current = e.currentTarget.selectionStart;
            setInside(false);
            live?.blur(q.id);
            live?.focus(q.section ? { section: q.section } : {});
          }}
        />
        <Counters id={`oq-counts-${q.id}`} counts={counts} limitKind={q.limitKind} limitValue={q.limitValue} />
        <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
          {!readOnly && (
            <button type="button" className="btn btn-sm btn-primary" disabled={!dirty || put.state === "saving" || lockedOut} onClick={() => void save()}>
              {put.state === "saving" ? t("outsideQuestionsTab.saving") : t("outsideQuestionsTab.saveAnswer")}
            </button>
          )}
          {!readOnly && (
            <button type="button" className="btn btn-sm btn-secondary" aria-haspopup="dialog" disabled={!answers.length || lockedOut} onClick={() => setDialog("library")}>
              <BookOpen className="ic" aria-hidden="true" />
              {t("outsideQuestionsTab.insertFromLibrary")}
            </button>
          )}
          {!readOnly && (
            <button type="button" className="btn btn-sm btn-secondary" aria-haspopup="dialog" disabled={lockedOut} onClick={() => setDialog("fact")}>
              <Building className="ic" aria-hidden="true" />
              {t("outsideQuestionsTab.insertAFact")}
            </button>
          )}
          {!readOnly && assistOn && (
            <button type="button" className="btn btn-sm btn-secondary" aria-expanded={ai} disabled={lockedOut} onClick={() => setAi((v) => !v)}>
              <Sparkles className="ic" aria-hidden="true" />
              {t("outsideQuestionsTab.draftWithAi")}
            </button>
          )}
          {!readOnly && assistOn && answers.length > 0 && (
            <button type="button" className="btn btn-sm btn-secondary" aria-expanded={fit} disabled={lockedOut} onClick={() => setFit((v) => !v)}>
              <Sparkles className="ic" aria-hidden="true" />
              {t("outsideQuestionsTab.fitToLimit")}
            </button>
          )}
          {!readOnly && reportOf && (
            <button type="button" className="btn btn-sm btn-secondary" aria-haspopup="dialog" disabled={lockedOut} onClick={() => setDialog("reuse")}>
              <FileClock className="ic" aria-hidden="true" />
              {t("outsideQuestionsTab.reuseFromAnEarlierReport")}
            </button>
          )}
          <CopyButton value={draft} what={t("outsideQuestionsTab.theAnswerTo", { n })} className="btn btn-sm btn-ghost" />
          <CommentsButton open={comments} onToggle={() => setComments((v) => !v)} />
          {q.answer && (
            <button type="button" className="btn btn-sm btn-ghost" aria-haspopup="dialog" onClick={() => setDialog("history")}>
              <Clock className="ic" aria-hidden="true" />
              {t("outsideQuestionsTab.versionHistory", { version: String(q.answer.version) })}
            </button>
          )}
          <span className="row" style={{ gap: "8px", marginLeft: "auto" }}>
            {dirty ? <span className="small muted">{fromAi ? t("outsideQuestionsTab.unsavedAiDraft") : t("outsideQuestionsTab.unsavedChanges")}</span> : q.answer ? provenanceTag(q.answer.provenance) : null}
            <SaveNote state={put.state === "saved" && !dirty ? "saved" : "idle"} savedText={t("outsideQuestionsTab.savedAsVersion", { version: String(q.answer?.version ?? 1) })} />
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
        {put.error && dialog !== "library" && dialog !== "reuse" ? <ErrorBanner error={put.error} title={t("outsideQuestionsTab.theAnswerWasNotSaved")} /> : null}
        {patch.error ? <ErrorBanner error={patch.error} title={t("outsideQuestionsTab.theQuestionWasNotChanged")} /> : null}
        {remove.error ? <ErrorBanner error={remove.error} title={t("outsideQuestionsTab.theQuestionWasNotDeleted")} /> : null}
      </div>
      {dialog === "library" && <LibraryDialog answers={answers} question={q} busy={put.state === "saving"} error={put.error} onClose={() => setDialog(null)} onInsert={(a, t) => void insertLibrary(a, t)} />}
      {dialog === "reuse" && reportOf && (
        <ReuseDialog
          question={q}
          obligationId={reportOf}
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

export function QuestionsTab({ detail, members, answers, org, readOnly, onChanged, live = null }: { detail: OutsideDetail; members: ApplicantMember[]; answers: LibraryAnswer[]; org: MyOrganization | null; readOnly: boolean; onChanged: () => void; live?: DraftPresence | null }) {
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
  // A consultant invited into this draft writes answers; the team sets up the questions and invites.
  const cowriter = detail.cowriter === true;
  const setupLocked = readOnly || cowriter;
  const invites = useDraftInvites("outside_application", detail.id, !cowriter);
  const inviteList = invites.status === "ready" ? invites.data : null;
  const [inviting, setInviting] = useState<{ questionId: string | null } | null>(null);
  const [sent, setSent] = useState<DraftInvitation | null>(null);
  const invitingPrompt = inviting?.questionId ? (questions.find((q) => q.id === inviting.questionId)?.prompt ?? null) : null;
  // Arriving from an accepted invitation (`?question=`): go straight to that answer.
  const [params] = useSearchParams();
  const focusQuestion = params.get("question");
  useEffect(() => {
    if (!focusQuestion) return;
    const el = document.getElementById(`oq-answer-${focusQuestion}`);
    el?.scrollIntoView?.({ block: "center" });
    el?.focus();
  }, [focusQuestion]);

  return (
    <>
      <div className="row" style={{ gap: "8px", flexWrap: "wrap", justifyContent: "space-between" }}>
        <span className="small muted">
          {t("outsideQuestionsTab.questionCount", { count: questions.length })} · {t("outsideQuestionsTab.approvedCount", { count: approved })}
        </span>
        <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
          {!setupLocked && (
            <>
              <button type="button" className="btn btn-sm btn-primary" aria-haspopup="dialog" onClick={() => setPasting(true)}>
                <ClipboardList className="ic" aria-hidden="true" />
                {t("outsideQuestionsTab.pasteQuestions")}
              </button>
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setAdding(true)} disabled={adding}>
                <Plus className="ic" aria-hidden="true" />
                {t("outsideQuestionsTab.addAQuestion")}
              </button>
            </>
          )}
          {questions.length > 0 && <CopyButton value={plainText(questions)} what={t("outsideQuestionsTab.allAsPlainText")} label={t("outsideQuestionsTab.copyAllAsPlainText")} className="btn btn-sm btn-secondary" />}
          {questions.length > 0 && (
            <span className="row" style={{ gap: "4px" }}>
              <label className="sr" htmlFor="oq-export">
                {t("outsideQuestionsTab.downloadFormat")}
              </label>
              <select id="oq-export" className="sel" style={{ height: "30px", width: "auto" }} defaultValue="" onChange={(e) => {
                const v = e.target.value as "txt" | "md" | "pdf" | "";
                e.target.value = "";
                if (v) void exp.run(v);
              }}>
                <option value="" disabled>
                  {t("outsideQuestionsTab.download")}
                </option>
                <option value="txt">{t("outsideQuestionsTab.plainTextTxt")}</option>
                <option value="md">{t("outsideQuestionsTab.markdownMd")}</option>
                <option value="pdf">PDF</option>
              </select>
            </span>
          )}
        </div>
      </div>
      {note && (
        <Notice tone="ok" title={note}>
          {t("outsideQuestionsTab.writeEachAnswerBelowCountsFollow")}
        </Notice>
      )}
      {cowriter && (
        <Notice tone="info" title={t("outsideQuestionsTab.youWereInvitedToHelpWrite")}>
          {t("outsideQuestionsTab.writeAndSaveYourAnswersHere")}
        </Notice>
      )}
      {!cowriter && <TeamNote canInvite={!readOnly && !!inviteList?.canInvite} onInvite={() => setInviting({ questionId: null })} />}
      {sent && <InviteSentNote sent={sent} onDone={() => setSent(null)} />}
      <AiUseNote questions={questions} />
      {exp.error ? <ErrorBanner error={exp.error} title={t("outsideQuestionsTab.theDownloadDidNotStart")} /> : null}
      {adding && (
        <QuestionForm
          submitLabel={t("outsideQuestionsTab.addQuestion")}
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
      {add.error ? <ErrorBanner error={add.error} title={t("outsideQuestionsTab.theQuestionWasNotAdded")} /> : null}
      {questions.length === 0 && !adding ? (
        <div className="card">
          <EmptyState
            icon={ClipboardList}
            title={t("outsideQuestionsTab.noQuestionsYet")}
            actions={
              !setupLocked ? (
                <button type="button" className="btn btn-primary" onClick={() => setPasting(true)}>
                  {t("outsideQuestionsTab.pasteQuestions")}
                </button>
              ) : undefined
            }
          >
            {t("outsideQuestionsTab.pasteTheQuestionsFromTheFunders2")}
          </EmptyState>
        </div>
      ) : (
        questions.map((q, i) => (
          <QuestionCard
            key={q.id}
            q={q}
            n={i + 1}
            applicationId={detail.id}
            members={members}
            answers={answers}
            org={org}
            readOnly={readOnly}
            assist={assistStatus}
            onAssistUsed={assist.reload}
            canApprove={canApprove}
            onChanged={onChanged}
            cowriter={cowriter}
            invites={inviteList}
            live={live}
            {...(inviteList?.canInvite ? { onInvite: (questionId: string) => setInviting({ questionId }) } : {})}
          />
        ))
      )}
      {inviting && (
        <InviteDialog
          draft={{ kind: "outside_application", id: detail.id, ...(inviting.questionId ? { questionId: inviting.questionId } : {}) }}
          title={detail.title}
          part={invitingPrompt}
          remainingToday={inviteList?.remainingToday ?? null}
          onClose={() => setInviting(null)}
          onSent={(r) => {
            setInviting(null);
            setSent(r);
            invites.reload();
          }}
        />
      )}
      {pasting && (
        <PasteQuestionsDialog
          applicationId={detail.id}
          assist={assistStatus}
          requiredDocuments={detail.requiredDocuments}
          onClose={() => setPasting(false)}
          onSaved={(n, docs = 0) => {
            setPasting(false);
            setNote([n || !docs ? t("outsideQuestionsTab.questionsAdded", { count: n }) : null, docs ? t("outsideQuestionsTab.documentsAdded", { count: docs }) : null].filter(Boolean).join(" · "));
            assist.reload();
            onChanged();
          }}
        />
      )}
    </>
  );
}
