// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// R-01 create/edit review stage dialog (review.save_stage).
import {
  Button,
  CheckboxField,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@gms/ui';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { saveStageAction, type StageInput } from '@/app/console/(app)/review/actions';
import { useRunAction } from '../run-action';

export interface StageDialogOption {
  id: string;
  label: string;
}

export interface StageDialogProps {
  competitions: StageDialogOption[];
  rubrics: StageDialogOption[];
  /** Existing stage (edit) — omit to create. `dueAt` is a wall-clock input value in the workspace timezone. */
  stage?: Omit<StageInput, 'stageId'> & { stageId: string };
  /** Pre-selected competition for a new stage. */
  defaultCompetitionId?: string;
  timeZone: string;
  triggerLabel?: string;
}

const NO_RUBRIC = '__none__';

export function StageDialog({ competitions, rubrics, stage, defaultCompetitionId, timeZone, triggerLabel }: StageDialogProps) {
  const [open, setOpen] = useState(false);
  const blank: StageInput = {
    competitionId: defaultCompetitionId ?? competitions[0]?.id ?? '',
    name: '',
    rubricId: rubrics[0]?.id ?? null,
    blind: false,
    reviewersPerApplication: 2,
    dueAt: '',
    status: 'draft',
  };
  const [v, setV] = useState<StageInput>(stage ?? blank);
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useRunAction();
  const set = <K extends keyof StageInput>(k: K, val: StageInput[K]) => setV((p) => ({ ...p, [k]: val }));
  const idp = stage ? `stage-${stage.stageId}` : 'stage-new';

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setV(stage ?? blank);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        {stage ? (
          <Button variant="ghost" size="sm" aria-label={`Edit stage ${stage.name}`}>
            <Pencil aria-hidden="true" />
            Edit
          </Button>
        ) : (
          <Button size="sm" disabled={!competitions.length}>
            <Plus aria-hidden="true" />
            {triggerLabel ?? 'New review stage'}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{stage ? `Edit “${stage.name}”` : 'New review stage'}</DialogTitle>
          <DialogDescription>Reviewers score every application in the competition with the stage’s rubric.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!v.name.trim()) {
              setError('Give the stage a name.');
              return;
            }
            setError(null);
            void run(() => saveStageAction({ ...v, ...(stage ? { stageId: stage.stageId } : {}) }), {
              success: stage ? 'Stage saved.' : 'Stage created.',
              onDone: () => setOpen(false),
            });
          }}
        >
          <Field label="Competition" htmlFor={`${idp}-comp`} required>
            <Select value={v.competitionId} onValueChange={(x) => set('competitionId', x)} disabled={Boolean(stage)}>
              <SelectTrigger id={`${idp}-comp`}>
                <SelectValue placeholder="Choose a competition" />
              </SelectTrigger>
              <SelectContent>
                {competitions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Stage name" htmlFor={`${idp}-name`} required error={error ?? undefined}>
            <Input id={`${idp}-name`} value={v.name} maxLength={200} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Rubric" htmlFor={`${idp}-rubric`} description="Rubrics are managed under “Rubrics” on the review page.">
            <Select value={v.rubricId ?? NO_RUBRIC} onValueChange={(x) => set('rubricId', x === NO_RUBRIC ? null : x)}>
              <SelectTrigger id={`${idp}-rubric`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_RUBRIC}>No rubric (comments only)</SelectItem>
                {rubrics.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reviewers per application" htmlFor={`${idp}-rpa`} required>
              <Input
                id={`${idp}-rpa`}
                type="number"
                min={1}
                max={20}
                value={v.reviewersPerApplication}
                onChange={(e) => set('reviewersPerApplication', Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              />
            </Field>
            <Field label="Status" htmlFor={`${idp}-status`}>
              <Select value={v.status} onValueChange={(x) => set('status', x as StageInput['status'])}>
                <SelectTrigger id={`${idp}-status`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft (reviewers can’t score yet)</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Due" htmlFor={`${idp}-due`} description={`Time zone: ${timeZone}`} optional>
            <Input id={`${idp}-due`} type="datetime-local" value={v.dueAt} onChange={(e) => set('dueAt', e.target.value)} />
          </Field>
          <CheckboxField
            id={`${idp}-blind`}
            checked={v.blind}
            onCheckedChange={(c) => set('blind', c === true)}
            label="Blind review"
            description="Hide the applicant’s identity and blind-flagged answers from reviewers."
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" pending={pending} pendingLabel="Saving…">
              {stage ? 'Save stage' : 'Create stage'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
