// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// D-03 rubric panel: a radio scale per criterion (with point labels and guidance), optional comments, overall
// comment, private note, recommendation, a live weighted score, "Save draft" (review.save) and "Submit review"
// (review.save + review.submit; missing criteria come back as field errors).
import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  DescriptionList,
  Field,
  FieldSet,
  RadioGroup,
  RadioOption,
  StatusChip,
  Textarea,
  toast,
} from '@gms/ui';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { fmtScore, RECOMMENDATION, weightedScore } from '@/components/console/grantmaking/review/meta';
import { saveReviewAction, submitReviewAction, type ReviewDraft } from '../actions';

export interface ScoringCriterion {
  id: string;
  label: string;
  guidance: string | null;
  weightPct: number;
  scaleMin: number;
  scaleMax: number;
  scaleLabels: Record<string, string>;
}

export interface ScoringInitial {
  scores: Record<string, { score: number; comment: string | null }>;
  overallComment: string;
  privateNote: string;
  recommendation: 'fund' | 'maybe' | 'decline' | null;
}

type Rec = 'fund' | 'maybe' | 'decline';

export function ScoringPanel({
  assignmentId,
  criteria,
  initial,
  readOnly,
  readOnlyReason,
}: {
  assignmentId: string;
  criteria: ScoringCriterion[];
  initial: ScoringInitial;
  readOnly: boolean;
  readOnlyReason?: string;
}) {
  const router = useRouter();
  const [scores, setScores] = useState<Record<string, number | undefined>>(() => Object.fromEntries(Object.entries(initial.scores).map(([k, v]) => [k, v.score])));
  const [comments, setComments] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initial.scores).map(([k, v]) => [k, v.comment ?? ''])));
  const [overall, setOverall] = useState(initial.overallComment);
  const [privateNote, setPrivateNote] = useState(initial.privateNote);
  const [rec, setRec] = useState<Rec | null>(initial.recommendation);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, start] = useTransition();

  const live = useMemo(() => weightedScore(criteria, scores), [criteria, scores]);
  const scoredCount = criteria.filter((c) => scores[c.id] !== undefined).length;
  const touch = () => {
    setDirty(true);
    setSavedAt(null);
  };

  const draft = (): ReviewDraft => ({
    scores: criteria.filter((c) => scores[c.id] !== undefined).map((c) => ({ criterionId: c.id, score: scores[c.id]!, comment: comments[c.id]?.trim() || null })),
    overallComment: overall.trim() || null,
    privateNote: privateNote.trim() || null,
    recommendation: rec,
  });

  const saveDraft = () =>
    start(async () => {
      setFormError(null);
      const r = await saveReviewAction(assignmentId, draft());
      if (r.ok) {
        setDirty(false);
        setSavedAt(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
        toast.success('Draft saved.');
      } else {
        setFormError(r.problem.detail);
        toast.error(r.problem.detail);
      }
    });

  const submit = () =>
    start(async () => {
      setFormError(null);
      const missing = criteria.filter((c) => scores[c.id] === undefined);
      if (missing.length) {
        setFieldErrors(Object.fromEntries(missing.map((c) => [c.id, `Score “${c.label}”.`])));
        setFormError(`Score every criterion before submitting (${missing.length} left).`);
        setConfirmOpen(false);
        return;
      }
      const r = await submitReviewAction(assignmentId, draft());
      setConfirmOpen(false);
      if (r.ok) {
        setFieldErrors({});
        setDirty(false);
        toast.success('Review submitted. Thank you!');
        router.refresh();
      } else {
        const errs: Record<string, string> = {};
        for (const e of r.problem.errors ?? []) {
          const m = /^\/scores\/([0-9a-f-]{36})$/i.exec(e.pointer ?? '');
          if (m?.[1]) errs[m[1]] = e.message;
        }
        setFieldErrors(errs);
        setFormError(r.problem.detail);
      }
    });

  if (readOnly) {
    return (
      <div className="grid gap-5">
        <div className="grid gap-1">
          <h2 className="font-heading text-lg font-semibold">Your scores</h2>
          {readOnlyReason ? <p className="text-sm text-muted-foreground">{readOnlyReason}</p> : null}
        </div>
        <p className="text-2xl font-semibold tabular-nums">
          {fmtScore(live)} <span className="text-base font-normal text-muted-foreground">/ 100 weighted</span>
        </p>
        <DescriptionList
          layout="stacked"
          items={[
            ...criteria.map((c) => ({
              term: `${c.label} (${c.weightPct}%)`,
              detail:
                scores[c.id] !== undefined ? (
                  <span className="whitespace-pre-wrap">
                    {`${scores[c.id]} of ${c.scaleMax}${c.scaleLabels[String(scores[c.id])] ? ` — ${c.scaleLabels[String(scores[c.id])]}` : ''}${comments[c.id] ? `\n${comments[c.id]}` : ''}`}
                  </span>
                ) : (
                  ''
                ),
            })),
            { term: 'Recommendation', detail: rec ? <StatusChip meta={RECOMMENDATION[rec]} /> : '' },
            { term: 'Overall comment', detail: overall ? <span className="whitespace-pre-wrap">{overall}</span> : '' },
            { term: 'Private note', detail: privateNote ? <span className="whitespace-pre-wrap">{privateNote}</span> : '' },
          ]}
        />
      </div>
    );
  }

  const missingList = criteria.filter((c) => fieldErrors[c.id]);
  return (
    <form
      className="grid gap-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        saveDraft();
      }}
    >
      <div className="grid gap-1">
        <h2 className="font-heading text-lg font-semibold">Score this application</h2>
        <p aria-live="polite" aria-atomic="true" className="rounded-md border bg-muted/50 p-3 text-sm">
          <span className="block text-2xl font-semibold tabular-nums text-foreground">
            {fmtScore(live)} <span className="text-sm font-normal text-muted-foreground">/ 100</span>
          </span>
          Weighted score · {scoredCount} of {criteria.length} criteria scored
        </p>
      </div>

      {formError ? (
        <Alert variant="danger" role="alert" title={formError}>
          {missingList.length ? (
            <ul className="list-disc pl-5">
              {missingList.map((c) => (
                <li key={c.id}>
                  <a href={`#crit-${c.id}`}>{fieldErrors[c.id]}</a>
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      {criteria.length === 0 ? <p className="text-sm text-muted-foreground">This stage has no rubric. Leave an overall comment and a recommendation.</p> : null}

      {criteria.map((c) => {
        const points = Array.from({ length: c.scaleMax - c.scaleMin + 1 }, (_, k) => c.scaleMin + k);
        return (
          <div key={c.id} className="grid gap-3 border-b pb-5">
            <FieldSet id={`crit-${c.id}`} legend={`${c.label} · ${c.weightPct}%`} description={c.guidance ?? undefined} error={fieldErrors[c.id]} required>
              <RadioGroup
                value={scores[c.id] === undefined ? '' : String(scores[c.id])}
                onValueChange={(v) => {
                  setScores((s) => ({ ...s, [c.id]: Number(v) }));
                  setFieldErrors((f) => {
                    const next = { ...f };
                    delete next[c.id];
                    return next;
                  });
                  touch();
                }}
                aria-label={`${c.label} score, ${c.scaleMin} to ${c.scaleMax}`}
              >
                {points.map((p) => (
                  <RadioOption key={p} id={`crit-${c.id}-${p}`} value={String(p)} label={c.scaleLabels[String(p)] ? `${p} — ${c.scaleLabels[String(p)]}` : String(p)} />
                ))}
              </RadioGroup>
            </FieldSet>
            <Field label={`Comment on ${c.label}`} htmlFor={`crit-${c.id}-comment`} optional>
              <Textarea
                id={`crit-${c.id}-comment`}
                rows={2}
                maxLength={5000}
                value={comments[c.id] ?? ''}
                onChange={(e) => {
                  setComments((m) => ({ ...m, [c.id]: e.target.value }));
                  touch();
                }}
              />
            </Field>
          </div>
        );
      })}

      <FieldSet legend="Recommendation" optional>
        <RadioGroup
          value={rec ?? ''}
          onValueChange={(v) => {
            setRec(v as Rec);
            touch();
          }}
          aria-label="Recommendation"
        >
          {(['fund', 'maybe', 'decline'] as const).map((k) => (
            <RadioOption key={k} id={`rec-${k}`} value={k} label={RECOMMENDATION[k].label} />
          ))}
        </RadioGroup>
      </FieldSet>

      <Field label="Overall comment" htmlFor="overall-comment" optional description="Staff and the panel see this.">
        <Textarea
          id="overall-comment"
          rows={4}
          maxLength={20000}
          value={overall}
          onChange={(e) => {
            setOverall(e.target.value);
            touch();
          }}
        />
      </Field>
      <Field label="Private note" htmlFor="private-note" optional description="Only you and staff see this. Not shared with the panel.">
        <Textarea
          id="private-note"
          rows={3}
          maxLength={20000}
          value={privateNote}
          onChange={(e) => {
            setPrivateNote(e.target.value);
            touch();
          }}
        />
      </Field>

      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {dirty ? 'You have unsaved changes.' : savedAt ? `Draft saved at ${savedAt}.` : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="outline" size="lg" pending={pending && !confirmOpen} pendingLabel="Saving…">
            Save draft
          </Button>
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger asChild>
              <Button type="button" size="lg" disabled={pending}>
                Submit review
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Submit your review?</AlertDialogTitle>
                <AlertDialogDescription>
                  Your weighted score is {fmtScore(live)} / 100 ({scoredCount} of {criteria.length} criteria scored). After you submit, only a program officer can reopen it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep editing</AlertDialogCancel>
                <AlertDialogAction
                  disabled={pending}
                  onClick={(e) => {
                    e.preventDefault();
                    submit();
                  }}
                >
                  {pending ? 'Submitting…' : 'Submit review'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </form>
  );
}
