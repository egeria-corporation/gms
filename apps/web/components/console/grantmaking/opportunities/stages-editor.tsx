// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// C-04 Stages & forms: the opportunity's competitions (stages) in order, each with its window, access and
// caps, and the forms attached to it (pinned to a published version).
import { formatInZone } from '@gms/domain';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CheckboxField,
  DescriptionList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  RadioGroup,
  RadioOption,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  ToneChip,
} from '@gms/ui';
import { CircleCheck, CircleDot, CircleSlash, Clock, FileText, Link2, Lock, PencilLine, Plus, Unlink, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { attachFormAction, createStageAction, detachFormAction, updateStageAction, type StageInput } from '@/app/console/(app)/opportunities/actions';
import { ConfirmActionButton, problemMessage, useRunAction } from '../run-action';
import type { PublishableForm, StageView } from './types';

const STAGE_STATUS: Record<string, { tone: 'muted' | 'info' | 'success' | 'neutral'; icon: typeof CircleDot; label: string }> = {
  draft: { tone: 'muted', icon: PencilLine, label: 'Draft' },
  scheduled: { tone: 'info', icon: Clock, label: 'Scheduled' },
  open: { tone: 'success', icon: CircleDot, label: 'Open' },
  closed: { tone: 'neutral', icon: CircleSlash, label: 'Closed' },
};

export function StageStatusChip({ status }: { status: string }) {
  const s = STAGE_STATUS[status] ?? { tone: 'neutral' as const, icon: CircleDot, label: status };
  return <ToneChip tone={s.tone} icon={s.icon} label={s.label} size="sm" />;
}

interface StageDraft {
  name: string;
  description: string;
  access: 'public' | 'invite';
  opensAt: string;
  closesAt: string;
  graceMinutes: string;
  submissionCap: string;
  perOrgLimit: string;
  allowExtensions: boolean;
}

const EMPTY: StageDraft = { name: '', description: '', access: 'invite', opensAt: '', closesAt: '', graceMinutes: '0', submissionCap: '', perOrgLimit: '1', allowExtensions: true };

function toDraft(s: StageView): StageDraft {
  return {
    name: s.name,
    description: s.description,
    access: s.access,
    opensAt: s.opensAt,
    closesAt: s.closesAt,
    graceMinutes: String(s.graceMinutes),
    submissionCap: s.submissionCap === null ? '' : String(s.submissionCap),
    perOrgLimit: String(s.perOrgLimit),
    allowExtensions: s.allowExtensions,
  };
}

function StageDialog({
  open,
  onOpenChange,
  opportunityId,
  stage,
  timeZone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  opportunityId: string;
  stage: StageView | null;
  timeZone: string;
}) {
  const { run, pending } = useRunAction();
  const [d, setD] = useState<StageDraft>(stage ? toDraft(stage) : EMPTY);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof StageDraft>(k: K, v: StageDraft[K]) => setD((p) => ({ ...p, [k]: v }));
  const idp = stage ? `stage-${stage.id}` : 'stage-new';

  const submit = () => {
    const grace = Number(d.graceMinutes || '0');
    const perOrg = Number(d.perOrgLimit || '1');
    const cap = d.submissionCap.trim() ? Number(d.submissionCap) : null;
    if (!d.name.trim()) return setError('Name the stage.');
    if (!Number.isInteger(grace) || grace < 0 || grace > 1440) return setError('Grace period must be between 0 and 1,440 minutes.');
    if (!Number.isInteger(perOrg) || perOrg < 1 || perOrg > 10) return setError('Applications per organization must be between 1 and 10.');
    if (cap !== null && (!Number.isInteger(cap) || cap < 1)) return setError('The submission cap must be a whole number above zero, or empty.');
    if (d.opensAt && d.closesAt && d.opensAt >= d.closesAt) return setError('The stage must close after it opens.');
    setError(null);
    const input: StageInput = {
      name: d.name.trim(),
      description: d.description.trim() || null,
      access: d.access,
      opensAt: d.opensAt || null,
      closesAt: d.closesAt || null,
      graceMinutes: grace,
      submissionCap: cap,
      perOrgLimit: perOrg,
      allowExtensions: d.allowExtensions,
    };
    void run(() => (stage ? updateStageAction(opportunityId, stage.id, input) : createStageAction(opportunityId, input)), {
      success: stage ? `Saved “${input.name}”.` : `Added the stage “${input.name}”.`,
    }).then((r) => {
      if (r.ok) onOpenChange(false);
      else setError(problemMessage(r.problem));
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{stage ? `Edit “${stage.name}”` : 'Add a stage'}</DialogTitle>
          <DialogDescription>Times are wall-clock in the workspace timezone ({timeZone}).</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {error ? (
            <Alert variant="danger" aria-live="polite">
              {error}
            </Alert>
          ) : null}
          <Field label="Name" htmlFor={`${idp}-name`} required>
            <Input id={`${idp}-name`} value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={200} placeholder="Full proposal" />
          </Field>
          <Field label="Description" htmlFor={`${idp}-desc`} optional>
            <Textarea id={`${idp}-desc`} rows={2} value={d.description} onChange={(e) => set('description', e.target.value)} maxLength={5000} />
          </Field>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Who can apply</legend>
            <RadioGroup value={d.access} onValueChange={(v) => set('access', v as 'public' | 'invite')} className="grid gap-2 sm:grid-cols-2">
              <RadioOption value="public" label="Anyone eligible" description="Open to the public." />
              <RadioOption value="invite" label="Invited applicants only" description="You invite applicants from an earlier stage." />
            </RadioGroup>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Opens" htmlFor={`${idp}-opens`} optional>
              <Input id={`${idp}-opens`} type="datetime-local" value={d.opensAt} onChange={(e) => set('opensAt', e.target.value)} />
            </Field>
            <Field label="Closes" htmlFor={`${idp}-closes`} optional>
              <Input id={`${idp}-closes`} type="datetime-local" value={d.closesAt} onChange={(e) => set('closesAt', e.target.value)} />
            </Field>
            <Field label="Grace period (minutes)" htmlFor={`${idp}-grace`} description="Late submissions accepted for this long after closing.">
              <Input id={`${idp}-grace`} inputMode="numeric" value={d.graceMinutes} onChange={(e) => set('graceMinutes', e.target.value)} />
            </Field>
            <Field label="Submission cap" htmlFor={`${idp}-cap`} optional description="Stop accepting after this many submissions.">
              <Input id={`${idp}-cap`} inputMode="numeric" value={d.submissionCap} onChange={(e) => set('submissionCap', e.target.value)} />
            </Field>
            <Field label="Applications per organization" htmlFor={`${idp}-perorg`}>
              <Input id={`${idp}-perorg`} inputMode="numeric" value={d.perOrgLimit} onChange={(e) => set('perOrgLimit', e.target.value)} />
            </Field>
            <div className="self-end pb-2">
              <CheckboxField label="Allow per-applicant extensions" checked={d.allowExtensions} onCheckedChange={(v) => set('allowExtensions', v === true)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" pending={pending} pendingLabel="Saving…">
              {stage ? 'Save stage' : 'Add stage'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AttachForm({ opportunityId, stage, forms }: { opportunityId: string; stage: StageView; forms: PublishableForm[] }) {
  const { run, pending } = useRunAction();
  const available = forms.filter((f) => !stage.forms.some((sf) => sf.formId === f.id));
  const [formId, setFormId] = useState<string>('');
  if (!available.length) {
    return (
      <p className="text-xs text-muted-foreground">
        No other forms with a published version. <Link href="/console/forms" className="text-link underline">Build or publish a form</Link>.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Attach a form" htmlFor={`attach-${stage.id}`} description="Pinned to its current published version." className="min-w-64">
        <Select value={formId} onValueChange={setFormId}>
          <SelectTrigger id={`attach-${stage.id}`} size="sm">
            <SelectValue placeholder="Choose a form" />
          </SelectTrigger>
          <SelectContent>
            {available.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name} · v{f.version}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!formId}
        pending={pending}
        pendingLabel="Attaching…"
        onClick={() => void run(() => attachFormAction(opportunityId, stage.id, formId), { success: 'Attached the form.', onDone: () => setFormId('') })}
      >
        <Link2 aria-hidden="true" /> Attach form
      </Button>
    </div>
  );
}

export function StagesEditor({
  opportunityId,
  stages,
  forms,
  timeZone,
  readOnly,
}: {
  opportunityId: string;
  stages: StageView[];
  forms: PublishableForm[];
  timeZone: string;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState<StageView | 'new' | null>(null);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Stages run in order. The first stage uses the opportunity’s open and close dates; later stages are often invite-only.</p>
        {!readOnly ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" /> Add a stage
          </Button>
        ) : null}
      </div>
      {stages.length === 0 ? (
        <Alert variant="warning" title="No stages">
          Add at least one stage with a published form before publishing.
        </Alert>
      ) : null}
      <ol className="grid gap-4">
        {stages.map((s) => (
          <li key={s.id}>
            <Card>
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
                <div className="grid gap-1">
                  <CardTitle as="h3" className="text-base">
                    Stage {s.order}: {s.name}
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <StageStatusChip status={s.status} />
                    {s.access === 'invite' ? <ToneChip tone="info" icon={Lock} label="Invite only" size="sm" /> : <ToneChip tone="neutral" icon={Users} label="Public" size="sm" />}
                  </div>
                </div>
                {!readOnly ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditing(s)}>
                    <PencilLine aria-hidden="true" /> Edit stage
                    <span className="sr-only"> {s.name}</span>
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent className="grid gap-4">
                {s.description ? <p className="text-sm">{s.description}</p> : null}
                <DescriptionList
                  layout="grid"
                  columns={3}
                  items={[
                    { term: 'Opens', detail: formatInZone(s.opensAtIso, timeZone) },
                    { term: 'Closes', detail: formatInZone(s.closesAtIso, timeZone) },
                    { term: 'Grace period', detail: s.graceMinutes ? `${s.graceMinutes} min` : 'None' },
                    { term: 'Submission cap', detail: s.submissionCap ?? 'No cap' },
                    { term: 'Per organization', detail: s.perOrgLimit },
                    { term: 'Extensions', detail: s.allowExtensions ? 'Allowed' : 'Not allowed' },
                  ]}
                />
                <div className="grid gap-2">
                  <h4 className="text-sm font-semibold">Forms</h4>
                  {s.forms.length ? (
                    <ul className="grid gap-2">
                      {s.forms.map((f) => (
                        <li key={f.formId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                            <Link href={`/console/forms/${f.formId}`} className="truncate font-medium hover:underline">
                              {f.formName}
                            </Link>
                            {f.version !== null ? (
                              f.versionStatus === 'published' ? (
                                <ToneChip tone="success" icon={CircleCheck} label={`Pinned to v${f.version} (published)`} size="sm" />
                              ) : (
                                <ToneChip tone="warning" icon={Clock} label={`Pinned to v${f.version} (${f.versionStatus ?? 'unknown'})`} size="sm" />
                              )
                            ) : (
                              <ToneChip tone="warning" icon={Clock} label="No published version" size="sm" />
                            )}
                            {f.currentVersion !== null && f.version !== null && f.currentVersion !== f.version ? <Badge variant="info">v{f.currentVersion} is current</Badge> : null}
                          </span>
                          {!readOnly && s.status === 'draft' ? (
                            <ConfirmActionButton
                              label={
                                <>
                                  <Unlink aria-hidden="true" /> Detach<span className="sr-only"> {f.formName}</span>
                                </>
                              }
                              variant="ghost"
                              title={`Detach “${f.formName}”?`}
                              description={`Applicants to “${s.name}” won’t see this form. You can attach it again while the stage is a draft.`}
                              confirmLabel="Detach form"
                              action={() => detachFormAction(opportunityId, s.id, f.formId)}
                              success="Detached the form."
                            />
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No forms attached.</p>
                  )}
                  {!readOnly ? <AttachForm opportunityId={opportunityId} stage={s} forms={forms} /> : null}
                  {!readOnly && s.status !== 'draft' && s.forms.length ? <p className="text-xs text-muted-foreground">Forms can only be detached before a stage opens.</p> : null}
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>
      {editing ? (
        <StageDialog
          key={editing === 'new' ? 'new' : editing.id}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
          opportunityId={opportunityId}
          stage={editing === 'new' ? null : editing}
          timeZone={timeZone}
        />
      ) : null}
    </div>
  );
}
