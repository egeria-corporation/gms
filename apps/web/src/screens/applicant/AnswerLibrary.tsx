// SPDX-License-Identifier: AGPL-3.0-only
// Answer library: reusable answers the team inserts into applications. Editing an answer saves a
// new version; applications that used an earlier version keep the text they inserted.
import { useEffect, useState } from "react";
import { BookOpen, CalendarCheck, Plus } from "lucide-react";
import type { Answer } from "../../api/applicant.ts";
import { useApplicantApi, useApplicantMutation } from "../../api/applicantHooks.ts";
import { libraryWithMeta, type LibraryAnswer } from "../../api/writeKeep.ts";
import { useWKMutation, useWKQuery } from "../../api/writeKeepHooks.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { Loaded, timeAgo } from "../../components/applicant.tsx";
import { ApplicantShell } from "../../components/shells.tsx";
import { EmptyState, ErrorBanner, Field, problemFor, SaveNote } from "../../components/ui.tsx";
import { formatDate } from "../../lib/format.ts";
import { countText } from "../../lib/outside.ts";
import { STALE_AFTER_MONTHS, VARIANT_KEYS, VARIANT_LABELS, VARIANT_WORDS, type VariantKey, type Variants } from "../../lib/writeKeep.ts";
import { AdaptPanel } from "./answerAdapt.tsx";
import { StaleBadge } from "./outside/writeFaster.tsx";

/** When the answer was last checked, the short, medium and long versions, and its tags. */
function KeepCurrent({ answer, onChanged }: { answer: LibraryAnswer; onChanged: (saved: LibraryAnswer | null) => void }) {
  const [variants, setVariants] = useState<Variants>(answer.variants ?? {});
  const [tags, setTags] = useState((answer.tags ?? []).join(", "));
  const verify = useWKMutation((api) => api.verifyAnswer(answer.id));
  const save = useWKMutation((api) => api.updateAnswerMeta(answer.id, { variants, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) }));
  const initialTags = (answer.tags ?? []).join(", ");
  const dirty = tags !== initialTags || VARIANT_KEYS.some((k) => (variants[k] ?? "") !== (answer.variants?.[k] ?? ""));
  return (
    <section className="card" aria-labelledby={`keep-${answer.id}`}>
      <div className="card-h">
        <div>
          <h2 id={`keep-${answer.id}`} style={{ fontSize: "18px" }}>
            Keep it current
          </h2>
          <p className="small muted">An answer not checked in {STALE_AFTER_MONTHS} months is flagged before its figures go into a new application.</p>
        </div>
        <SaveNote state={save.state === "saved" && !dirty ? "saved" : verify.state === "saved" ? "saved" : "idle"} savedText={verify.state === "saved" && save.state !== "saved" ? "Marked as verified" : "Saved"} />
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
          <StaleBadge lastVerifiedAt={answer.lastVerifiedAt} />
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={verify.state === "saving"}
            onClick={async () => {
              const saved = await verify.run();
              if (saved) onChanged(saved);
            }}
          >
            <CalendarCheck className="ic" aria-hidden="true" />
            {verify.state === "saving" ? "Saving…" : "Mark as verified"}
          </button>
          <span className="small muted">{answer.lastVerifiedAt ? `Last checked ${formatDate(answer.lastVerifiedAt)}.` : "Never checked."} Mark it once the facts and figures in it are still true.</span>
        </div>
        {verify.error ? <ErrorBanner error={verify.error} title="It was not marked as verified" /> : null}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <span className="eyebrow">Shorter and longer versions</span>
          <p className="small muted" style={{ margin: 0 }}>When a question has a limit, inserting from the library offers the version that fits best.</p>
          {VARIANT_KEYS.map((k: VariantKey) => (
            <Field key={k} id={`var-${k}-${answer.id}`} label={`${VARIANT_LABELS[k]} (about ${VARIANT_WORDS[k]} words)`} help={`${countText(variants[k] ?? "").words} words`}>
              <textarea id={`var-${k}-${answer.id}`} className="ta" style={{ minHeight: k === "short" ? "56px" : "88px" }} value={variants[k] ?? ""} onChange={(e) => setVariants({ ...variants, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
        <Field id={`tags-${answer.id}`} label="Tags" help="Separate them with commas, such as health, rural, evaluation.">
          <input id={`tags-${answer.id}`} className="inp" value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        {save.error ? <ErrorBanner error={save.error} title="The versions and tags were not saved" /> : null}
      </div>
      <div className="card-f">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!dirty || save.state === "saving"}
          onClick={async () => {
            // On the API this saves a new version of the answer, under a new id.
            const saved = await save.run();
            if (saved) onChanged(saved);
          }}
        >
          Save versions and tags
        </button>
      </div>
    </section>
  );
}

const countWords = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

function AnswerEditor({ answer, onSaved, onCancel }: { answer: Answer | null; onSaved: (a: Answer, replaced: string | null) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(answer?.title ?? "");
  const [body, setBody] = useState(answer?.body ?? "");
  useEffect(() => {
    setTitle(answer?.title ?? "");
    setBody(answer?.body ?? "");
  }, [answer?.id]);
  const save = useApplicantMutation((api) => (answer ? api.updateAnswer(answer.id, { title, body }) : api.createAnswer({ title, body })));
  const dirty = title !== (answer?.title ?? "") || body !== (answer?.body ?? "");
  const used = (answer?.usedIn ?? []) as { applicationId?: string; title?: string }[];

  return (
    <form
      className="card"
      aria-label={answer ? `Edit ${answer.title}` : "New answer"}
      onSubmit={async (e) => {
        e.preventDefault();
        const saved = await save.run();
        if (saved) onSaved(saved, answer?.id ?? null);
      }}
    >
      <div className="card-h">
        <div>
          <h2 style={{ fontSize: "18px" }}>{answer ? answer.title : "New answer"}</h2>
          {answer && (
            <p className="small muted">
              Version {answer.version} · updated {timeAgo(answer.updatedAt)}
            </p>
          )}
        </div>
        <SaveNote state={save.state} savedText={answer ? "Saved as a new version" : "Saved"} />
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {save.error && !problemFor(save.error, "title") ? <ErrorBanner error={save.error} /> : null}
        <Field id="ans-title" label="Title" required error={problemFor(save.error, "title")}>
          <input className="inp" id="ans-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </Field>
        <Field id="ans-body" label="Answer" help="Plain text. Adjust it to each funder’s question after inserting.">
          <textarea className="ta" id="ans-body" style={{ minHeight: "220px" }} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="counter">{countWords(body)} words</div>
        {answer && (
          <div>
            <div className="eyebrow" style={{ marginBottom: "6px" }}>
              Used in
            </div>
            {used.length === 0 ? (
              <p className="small muted">Not used in an application yet.</p>
            ) : (
              <ul style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "14px" }}>
                {used.map((u, i) => (
                  <li key={i}>{u.title ?? u.applicationId}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="card-f">
        <button className="btn btn-primary" type="submit" disabled={save.state === "saving" || !dirty || !title.trim()}>
          {answer ? "Save new version" : "Save answer"}
        </button>
        <button className="btn btn-ghost" type="button" onClick={onCancel}>
          {answer ? "Discard changes" : "Cancel"}
        </button>
      </div>
    </form>
  );
}

export default function AnswerLibrary() {
  const ws = useWorkspace("applicant");
  const applicant = useApplicantApi();
  // The library with each answer's last check, versions and tags (v1.6).
  const query = useWKQuery<LibraryAnswer[]>((api) => libraryWithMeta(() => applicant.answers(), api), [ws.id, applicant]);
  const [selected, setSelected] = useState<string | "new" | null>(null);

  return (
    <>
      <title>{`Answer library — ${ws.name}`}</title>
      <ApplicantShell active="Answer library">
        <main className="main">
          <div className="ph">
            <div>
              <div className="title">
                <h1>Answer library</h1>
              </div>
              <div className="meta">
                <span>Write it once, insert it into any application, and adapt it to the question.</span>
              </div>
            </div>
            <div className="actions">
              <button className="btn btn-primary" type="button" onClick={() => setSelected("new")}>
                <Plus className="ic" aria-hidden="true" />
                New answer
              </button>
            </div>
          </div>
          <Loaded query={query} label="Loading your answers">
            {(answers) => {
              const current = selected === "new" ? null : (answers.find((a) => a.id === selected) ?? answers[0] ?? null);
              const editing = selected === "new" || current;
              return answers.length === 0 && selected !== "new" ? (
                <div className="card">
                  <EmptyState
                    icon={BookOpen}
                    title="No saved answers yet"
                    actions={
                      <button className="btn btn-primary" type="button" onClick={() => setSelected("new")}>
                        Write your first answer
                      </button>
                    }
                  >
                    Mission, need, evaluation approach: the paragraphs every funder asks for in slightly different words.
                  </EmptyState>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.6fr)", gap: "20px", alignItems: "start" }}>
                  <ul className="card" aria-label="Answers" style={{ display: "flex", flexDirection: "column", padding: "8px" }}>
                    {answers.map((a) => {
                      const on = selected !== "new" && current?.id === a.id;
                      return (
                        <li key={a.id}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-block"
                            aria-pressed={on}
                            onClick={() => setSelected(a.id)}
                            style={{ height: "auto", padding: "10px 12px", justifyContent: "flex-start", textAlign: "left", background: on ? "var(--og-teal-soft)" : undefined }}
                          >
                            <span style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
                              <span className="b">{a.title}</span>
                              <span className="small muted" style={{ fontWeight: 400 }}>
                                v{a.version} · {a.words} words · used in {(a.usedIn ?? []).length}
                              </span>
                              <span style={{ fontWeight: 400 }}>
                                <StaleBadge lastVerifiedAt={a.lastVerifiedAt} compact />
                              </span>
                              {(a.tags ?? []).length > 0 && (
                                <span className="row" style={{ gap: "4px", flexWrap: "wrap", fontWeight: 400 }}>
                                  {(a.tags ?? []).map((t) => (
                                    <span key={t} className="tag">
                                      {t}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                    {editing && (
                      <AnswerEditor
                        answer={current}
                        onCancel={() => setSelected(answers[0]?.id ?? null)}
                        onSaved={(saved, replaced) => {
                          // A new version arrives under a new id and takes the old one's place.
                          query.set(replaced ? answers.map((a) => (a.id === replaced ? { ...a, ...saved } : a)) : [saved, ...answers]);
                          setSelected(saved.id);
                          query.reload();
                        }}
                      />
                    )}
                    {selected !== "new" && current ? <KeepCurrent
                        key={`${current.id}-${current.lastVerifiedAt ?? ""}`}
                        answer={current}
                        onChanged={(saved) => {
                          if (saved?.id) setSelected(saved.id);
                          query.reload();
                        }}
                      /> : null}
                    {selected !== "new" && current ? <AdaptPanel key={current.id} answer={current} /> : null}
                  </div>
                </div>
              );
            }}
          </Loaded>
        </main>
      </ApplicantShell>
    </>
  );
}
