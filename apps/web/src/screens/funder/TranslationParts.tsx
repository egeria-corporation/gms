// SPDX-License-Identifier: AGPL-3.0-only
// The parts the form builder and the opportunity builder share for a funder's own text in a
// second language (docs/forms.md, "Languages"): the language picker and "Add Spanish", the
// completeness indicator, one side-by-side row per text, and "Draft with the assistant".
// Status is always an icon and a label.
import { useId, type ReactNode } from "react";
import { CircleCheck, CircleDashed, Languages, Sparkles, TriangleAlert } from "lucide-react";
import type { FormLanguage, TextState } from "@gms/forms";
import type { AssistQuota } from "../../api/funderFull.ts";
import { Field } from "../../components/ui.tsx";
import { t, useFunderMessages } from "./i18n.ts";

export const OTHER_LANGUAGE: Record<FormLanguage, FormLanguage> = { en: "es", es: "en" };

/** How far a translation has come, as an icon and a label for each part. */
export interface Progress {
  total: number;
  done: number;
  stale: number;
  drafts: number;
  complete: boolean;
}

/** "Spanish complete", or "Spanish: 4 of 9 translated", with what needs updating and what awaits review. */
export function LanguageProgress({ language, progress }: { language: FormLanguage; progress: Progress }) {
  useFunderMessages();
  return (
    <span className="row wrap" style={{ gap: "6px" }} data-testid="translation-progress">
      {progress.complete ? (
        <span className="bdg bdg-ok">
          <CircleCheck className="ic" aria-hidden="true" />
          {t("translation.progress.complete", { language })}
        </span>
      ) : (
        <span className="bdg bdg-neutral">
          <CircleDashed className="ic" aria-hidden="true" />
          {t("translation.progress.partial", { language, done: progress.done, total: progress.total })}
        </span>
      )}
      {progress.stale > 0 && (
        <span className="bdg bdg-warn">
          <TriangleAlert className="ic" aria-hidden="true" />
          {t("translation.progress.stale", { count: progress.stale })}
        </span>
      )}
      {progress.drafts > 0 && (
        <span className="bdg bdg-agent">
          <Sparkles className="ic" aria-hidden="true" />
          {t("translation.progress.drafts", { count: progress.drafts })}
        </span>
      )}
    </span>
  );
}

/**
 * The record's own language, and "Add Spanish" (or the added language's progress and "Remove").
 * The own language is fixed while another one is added.
 */
export function LanguagePicker({ idPrefix, source, added, progress, readOnly, onSource, onAdd, onRemove }: { idPrefix: string; source: FormLanguage; added: FormLanguage | null; progress: Progress | null; readOnly: boolean; onSource: (l: FormLanguage) => void; onAdd: (l: FormLanguage) => void; onRemove: (l: FormLanguage) => void }) {
  useFunderMessages();
  const other = OTHER_LANGUAGE[source];
  return (
    <div className="row wrap" style={{ gap: "12px", alignItems: "flex-end" }}>
      <Field id={`${idPrefix}-language`} label={t("translation.language.writtenIn")} help={added ? t("translation.language.lockedHelp", { language: added }) : undefined}>
        <select className="sel" id={`${idPrefix}-language`} value={source} disabled={readOnly || !!added} onChange={(e) => onSource(e.target.value as FormLanguage)}>
          {(["en", "es"] as const).map((l) => (
            <option key={l} value={l}>
              {t("translation.language.name", { language: l })}
            </option>
          ))}
        </select>
      </Field>
      {added && progress ? (
        <div className="row wrap" style={{ gap: "8px", paddingBottom: "6px" }}>
          <LanguageProgress language={added} progress={progress} />
          {!readOnly && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onRemove(added)}>
              {t("translation.language.remove", { language: added })}
            </button>
          )}
        </div>
      ) : (
        !readOnly && (
          <button type="button" className="btn btn-secondary" onClick={() => onAdd(other)} style={{ marginBottom: "2px" }}>
            <Languages className="ic" aria-hidden="true" />
            {t("translation.language.add", { language: other })}
          </button>
        )
      )}
    </div>
  );
}

export type RowKind = "title" | "section" | "label" | "help" | "option" | "oppTitle" | "oppSummary" | "oppEligibility";
const KIND_KEY = {
  title: "translation.kind.title",
  section: "translation.kind.section",
  label: "translation.kind.label",
  help: "translation.kind.help",
  option: "translation.kind.option",
  oppTitle: "translation.kind.oppTitle",
  oppSummary: "translation.kind.oppSummary",
  oppEligibility: "translation.kind.oppEligibility",
} as const;

/**
 * One text side by side: what the funder wrote (in its own language) and its translation. The
 * input is named by the kind of text and the source text, and described by its state.
 */
export function TranslationRow({ kind, source, sourceLanguage, language, text, state, was, multiline = false, readOnly, onText, onConfirm }: { kind: RowKind; source: string; sourceLanguage: FormLanguage; language: FormLanguage; text: string; state: TextState; was?: string; multiline?: boolean; readOnly: boolean; onText: (text: string) => void; onConfirm: () => void }) {
  useFunderMessages();
  const id = useId();
  const input = { id, lang: language, value: text, disabled: readOnly, "aria-labelledby": `${id}-k ${id}-s`, "aria-describedby": `${id}-st`, onChange: (e: { target: { value: string } }) => onText(e.target.value) };
  return (
    <li style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "12px", padding: "10px 0", borderBottom: "1px solid var(--og-gray-100)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
        <span className="tag" id={`${id}-k`} style={{ alignSelf: "flex-start" }}>
          {t(KIND_KEY[kind])}
        </span>
        <span id={`${id}-s`} lang={sourceLanguage} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {source}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
        {multiline ? <textarea className="ta" style={{ minHeight: "64px" }} {...input} /> : <input className="inp" {...input} />}
        <span id={`${id}-st`} className="row wrap small" style={{ gap: "8px" }}>
          {state === "missing" && (
            <span className="row muted" style={{ gap: "4px" }}>
              <CircleDashed className="ic ic-sm" aria-hidden="true" />
              {t("translation.row.missing")}
            </span>
          )}
          {state === "stale" && (
            <>
              <span className="pill-warn">
                <TriangleAlert className="ic ic-sm" aria-hidden="true" />
                {t("translation.row.stale")}
              </span>
              {was !== undefined && (
                <span className="muted">
                  {t("translation.row.was")} <span lang={sourceLanguage}>{was}</span>
                </span>
              )}
            </>
          )}
          {state === "draft" && (
            <span className="draft-mark">
              <Sparkles className="ic ic-sm" aria-hidden="true" />
              {t("translation.row.draft")}
            </span>
          )}
          {state === "done" && (
            <span className="row" style={{ gap: "4px", color: "var(--s-ok-fg)" }}>
              <CircleCheck className="ic ic-sm" aria-hidden="true" />
              {t("translation.row.done")}
            </span>
          )}
        </span>
        {!readOnly && (state === "stale" || state === "draft") && (
          <button type="button" className="btn btn-sm btn-secondary" style={{ alignSelf: "flex-start" }} onClick={onConfirm} aria-describedby={`${id}-k ${id}-s`}>
            {state === "stale" ? t("translation.row.stillCorrect") : t("translation.row.markReviewed")}
          </button>
        )}
      </div>
    </li>
  );
}

/** The two column heads above the rows. */
export function RowsHead({ source, language }: { source: FormLanguage; language: FormLanguage }) {
  useFunderMessages();
  return (
    <div aria-hidden="true" className="eyebrow" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "12px" }}>
      <span>{t("translation.columns.source", { language: source })}</span>
      <span>{t("translation.language.name", { language })}</span>
    </div>
  );
}

/** "Draft with the assistant": shown only while the assistant is on. Saves nothing; the drafts are marked until reviewed. */
export function TranslateAssist({ id, help, quota, busy, disabled, result, error, onDraft }: { id: string; help: string; quota: AssistQuota | null; busy: boolean; disabled: boolean; result: number | null; error: ReactNode; onDraft: () => void }) {
  useFunderMessages();
  return (
    <section className="assist" aria-labelledby={`${id}-h`}>
      <div className="hd">
        <Sparkles className="ic" aria-hidden="true" style={{ color: "var(--s-agent-fg)" }} />
        <h4 id={`${id}-h`}>{t("translation.assist.title")}</h4>
        <span className="draft-mark">{t("translation.assist.draftMark")}</span>
        {quota && <span className="quota">{t("translation.assist.quota", { used: quota.used, limit: quota.limit })}</span>}
      </div>
      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
        <p className="muted small">{help}</p>
        <div className="row wrap" style={{ gap: "10px" }}>
          <button type="button" className="btn btn-sm btn-secondary" onClick={onDraft} disabled={busy || disabled}>
            <Sparkles className="ic" aria-hidden="true" />
            {busy ? t("translation.assist.busy") : t("translation.assist.button")}
          </button>
          {result !== null && (
            <span className="small" role="status">
              {t("translation.assist.drafted", { count: result })}
            </span>
          )}
        </div>
        {error}
      </div>
    </section>
  );
}
