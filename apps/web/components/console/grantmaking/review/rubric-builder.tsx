// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// R-01 rubric builder: criteria with add / remove / move up / move down (buttons, no drag), weights that must
// total 100% (live total announced politely; save is blocked until it is exactly 100), scale min/max with a
// label per point, and guidance. Rubrics that reviewers already scored with are locked → "Duplicate rubric".
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Textarea,
  ToneChip,
} from '@gms/ui';
import { ArrowDown, ArrowUp, CircleCheck, Copy, Plus, Scale, Trash2, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { saveRubricAction, type CriterionInput } from '@/app/console/(app)/review/actions';
import { problemMessage, useRunAction } from '../run-action';

export interface RubricBuilderValue {
  rubricId?: string;
  name: string;
  description: string;
  criteria: CriterionInput[];
}

interface Row {
  key: string;
  label: string;
  guidance: string;
  weight: string;
  scaleMin: string;
  scaleMax: string;
  scaleLabels: Record<string, string>;
}

const MAX_POINTS = 11;

function toRow(c: CriterionInput, i: number): Row {
  return {
    key: `crit-${i}`,
    label: c.label,
    guidance: c.guidance ?? '',
    weight: String(c.weightPct),
    scaleMin: String(c.scaleMin),
    scaleMax: String(c.scaleMax),
    scaleLabels: { ...c.scaleLabels },
  };
}

const blankRow = (key: string, weight = ''): Row => ({ key, label: '', guidance: '', weight, scaleMin: '1', scaleMax: '5', scaleLabels: {} });

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export function RubricBuilder({ initial, locked, canEdit }: { initial: RubricBuilderValue; locked: boolean; canEdit: boolean }) {
  const router = useRouter();
  const { run, pending } = useRunAction();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [rows, setRows] = useState<Row[]>(() => (initial.criteria.length ? initial.criteria.map(toRow) : [blankRow('crit-0', '100')]));
  // Stable, hydration-safe keys (they also build the input ids): initial rows use their index.
  const seq = useRef(Math.max(initial.criteria.length, 1));
  const addRow = () => setRows((rs) => [...rs, blankRow(`crit-${seq.current++}`)]);
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [lockedByServer, setLockedByServer] = useState(false);
  const readOnly = locked || lockedByServer || !canEdit;

  const total = useMemo(() => Math.round(rows.reduce((s, r) => s + (Number.isFinite(num(r.weight)) ? num(r.weight) : 0), 0) * 100) / 100, [rows]);
  const totalOk = total === 100;

  const rowErrors = rows.map((r) => {
    const e: Partial<Record<'label' | 'weight' | 'scale', string>> = {};
    if (!r.label.trim()) e.label = 'Name the criterion.';
    const w = num(r.weight);
    if (!(w > 0 && w <= 100)) e.weight = 'Use a weight above 0 and at most 100.';
    const lo = num(r.scaleMin);
    const hi = num(r.scaleMax);
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) e.scale = 'Scale ends must be whole numbers.';
    else if (lo >= hi) e.scale = 'The maximum must be above the minimum.';
    else if (hi - lo + 1 > MAX_POINTS) e.scale = `Use at most ${MAX_POINTS} points on a scale.`;
    return e;
  });
  const valid = Boolean(name.trim()) && totalOk && rowErrors.every((e) => Object.keys(e).length === 0);

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const remove = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));
  const distribute = () =>
    setRows((rs) => {
      const n = rs.length;
      const base = Math.floor((100 / n) * 100) / 100;
      const last = Math.round((100 - base * (n - 1)) * 100) / 100;
      return rs.map((r, i) => ({ ...r, weight: String(i === n - 1 ? last : base) }));
    });

  const payload = (asCopy: boolean) => ({
    ...(initial.rubricId && !asCopy ? { rubricId: initial.rubricId } : {}),
    name: asCopy ? `${name.trim()} (copy)` : name.trim(),
    description: description.trim() || null,
    criteria: rows.map((r) => {
      const lo = num(r.scaleMin);
      const hi = num(r.scaleMax);
      const labels = Object.fromEntries(Object.entries(r.scaleLabels).filter(([k, v]) => v.trim() && Number(k) >= lo && Number(k) <= hi).map(([k, v]) => [k, v.trim()]));
      return { label: r.label.trim(), guidance: r.guidance.trim() || null, weightPct: num(r.weight), scaleMin: lo, scaleMax: hi, scaleLabels: labels };
    }),
  });

  const save = () => {
    setAttempted(true);
    setServerError(null);
    if (!valid) return;
    void run(() => saveRubricAction(payload(false)), {
      success: 'Rubric saved.',
      onDone: (d) => {
        if (!initial.rubricId) router.push(`/console/review/rubrics/${d.id}`);
      },
    }).then((r) => {
      if (!r.ok) {
        setServerError(problemMessage(r.problem));
        if (r.problem.status === 409 || /Duplicate it/i.test(r.problem.detail)) setLockedByServer(true);
      }
    });
  };

  const duplicate = () => {
    void run(() => saveRubricAction(payload(true)), {
      success: 'Rubric duplicated. You’re editing the copy.',
      onDone: (d) => router.push(`/console/review/rubrics/${d.id}`),
    });
  };

  return (
    <div className="grid gap-5">
      {locked || lockedByServer ? (
        <Alert
          variant="info"
          title="This rubric is locked"
          actions={
            canEdit ? (
              <Button size="sm" onClick={duplicate} pending={pending} pendingLabel="Duplicating…">
                <Copy aria-hidden="true" />
                Duplicate rubric
              </Button>
            ) : null
          }
        >
          Reviewers have already scored with this rubric, so changing it would make scores inconsistent. Duplicate it to make changes, then point the stage at the copy.
        </Alert>
      ) : null}
      {serverError && !lockedByServer ? (
        <Alert variant="danger" role="alert" title="The rubric wasn’t saved">
          {serverError}
        </Alert>
      ) : null}

      <Card>
        <CardContent className="grid gap-4 pt-6">
          <Field label="Rubric name" htmlFor="rubric-name" required error={attempted && !name.trim() ? 'Name the rubric.' : undefined}>
            <Input id="rubric-name" value={name} maxLength={200} disabled={readOnly} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="rubric-desc" optional description="Shown to staff when choosing a rubric.">
            <Textarea id="rubric-desc" rows={2} value={description} maxLength={3000} disabled={readOnly} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
        <div aria-live="polite" aria-atomic="true" className="flex items-center gap-2 text-sm">
          {totalOk ? (
            <ToneChip tone="success" icon={CircleCheck} label={`Weights total ${total}%`} />
          ) : (
            <ToneChip tone="warning" icon={TriangleAlert} label={`Weights total ${total}% — adjust to 100%`} />
          )}
          <span className="text-muted-foreground">
            {rows.length} criteri{rows.length === 1 ? 'on' : 'a'}
          </span>
        </div>
        {!readOnly ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={distribute}>
              <Scale aria-hidden="true" />
              Split weights evenly
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={rows.length >= 20} onClick={addRow}>
              <Plus aria-hidden="true" />
              Add criterion
            </Button>
          </div>
        ) : null}
      </div>

      <ol className="grid gap-4" aria-label="Criteria">
        {rows.map((r, i) => {
          const err = attempted ? rowErrors[i]! : {};
          const lo = num(r.scaleMin);
          const hi = num(r.scaleMax);
          const points = Number.isInteger(lo) && Number.isInteger(hi) && hi > lo && hi - lo + 1 <= MAX_POINTS ? Array.from({ length: hi - lo + 1 }, (_, k) => lo + k) : [];
          const n = i + 1;
          return (
            <li key={r.key}>
              <Card>
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                  <CardTitle as="h2" className="text-base">
                    Criterion {n}
                    {r.label.trim() ? `: ${r.label.trim()}` : ''}
                  </CardTitle>
                  {!readOnly ? (
                    <div className="flex gap-1">
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move criterion ${n} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move criterion ${n} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown aria-hidden="true" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove criterion ${n}`} disabled={rows.length === 1} onClick={() => remove(i)}>
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  ) : null}
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                    <Field label="Criterion" htmlFor={`${r.key}-label`} required error={err.label}>
                      <Input id={`${r.key}-label`} value={r.label} maxLength={200} disabled={readOnly} onChange={(e) => update(i, { label: e.target.value })} />
                    </Field>
                    <Field label="Weight (%)" htmlFor={`${r.key}-weight`} required error={err.weight}>
                      <Input
                        id={`${r.key}-weight`}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={100}
                        step="any"
                        value={r.weight}
                        disabled={readOnly}
                        onChange={(e) => update(i, { weight: e.target.value })}
                      />
                    </Field>
                  </div>
                  <Field label="Guidance for reviewers" htmlFor={`${r.key}-guidance`} optional description="What a strong answer looks like.">
                    <Textarea id={`${r.key}-guidance`} rows={2} maxLength={3000} value={r.guidance} disabled={readOnly} onChange={(e) => update(i, { guidance: e.target.value })} />
                  </Field>
                  <fieldset className="grid gap-3">
                    <legend className="mb-1 text-sm font-medium">Scale</legend>
                    <div className="grid grid-cols-2 gap-4 sm:max-w-sm">
                      <Field label="Lowest score" htmlFor={`${r.key}-min`}>
                        <Input id={`${r.key}-min`} type="number" step={1} value={r.scaleMin} disabled={readOnly} onChange={(e) => update(i, { scaleMin: e.target.value })} />
                      </Field>
                      <Field label="Highest score" htmlFor={`${r.key}-max`} error={err.scale}>
                        <Input id={`${r.key}-max`} type="number" step={1} value={r.scaleMax} disabled={readOnly} onChange={(e) => update(i, { scaleMax: e.target.value })} />
                      </Field>
                    </div>
                    {points.length ? (
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {points.map((p) => (
                          <Field key={p} label={`Label for ${p}`} htmlFor={`${r.key}-pt-${p}`} optional>
                            <Input
                              id={`${r.key}-pt-${p}`}
                              value={r.scaleLabels[String(p)] ?? ''}
                              maxLength={120}
                              disabled={readOnly}
                              onChange={(e) => update(i, { scaleLabels: { ...r.scaleLabels, [String(p)]: e.target.value } })}
                            />
                          </Field>
                        ))}
                      </div>
                    ) : null}
                  </fieldset>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>

      {!readOnly ? (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {!totalOk ? (
            <p className="text-sm text-status-warning-fg" id="rubric-save-hint">
              Weights must total exactly 100% before you can save.
            </p>
          ) : null}
          <Button type="button" onClick={save} pending={pending} pendingLabel="Saving…" disabled={!totalOk} aria-describedby={!totalOk ? 'rubric-save-hint' : undefined}>
            Save rubric
          </Button>
        </div>
      ) : null}
    </div>
  );
}
