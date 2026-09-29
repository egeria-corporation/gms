// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// Dialogs for pipeline bulk actions and board moves: assign reviewers (auto plan or manual), draft a bulk
// message, tag, mark ineligible (R3, applicant-visible reason) and invite to an invite-only stage.
import {
  Alert,
  Button,
  CheckboxField,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldSet,
  Input,
  RadioGroup,
  RadioOption,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@gms/ui';
import { ArrowRightCircle, Ban, Mail, Tags, UserPlus, Wand2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { problemMessage } from '../run-action';
import {
  assignReviewersAction,
  autoAssignAction,
  draftBulkMessageAction,
  inviteToStageAction,
  markIneligibleAction,
  tagAction,
  type AutoAssignResult,
} from './actions';
import type { InviteStageOption, PersonOption, ReviewStageOption } from './types';

export interface SelectedApp {
  id: string;
  reference: string;
  competitionId: string;
  opportunityId: string;
  tags: string[];
}

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function Summary({ apps }: { apps: SelectedApp[] }) {
  const refs = apps.map((a) => a.reference);
  return (
    <p className="text-sm text-muted-foreground">
      {refs.slice(0, 6).join(', ')}
      {refs.length > 6 ? ` and ${refs.length - 6} more` : ''}
    </p>
  );
}

// Assign reviewers --------------------------------------------------------------------------------
export function AssignReviewersDialog({ open, onOpenChange, onDone, apps, stages, reviewers }: BaseProps & { apps: SelectedApp[]; stages: ReviewStageOption[]; reviewers: PersonOption[] }) {
  const router = useRouter();
  const comps = useMemo(() => new Set(apps.map((a) => a.competitionId)), [apps]);
  const choices = stages.filter((s) => comps.has(s.competitionId) && ['active', 'draft'].includes(s.status));
  const [stageId, setStageId] = useState<string>('');
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [picked, setPicked] = useState<string[]>([]);
  const [plan, setPlan] = useState<AutoAssignResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const stage = choices.find((s) => s.id === stageId) ?? (choices.length === 1 ? choices[0] : undefined);
  const refOf = useMemo(() => new Map(apps.map((a) => [a.id, a.reference])), [apps]);
  const ids = apps.map((a) => a.id);

  const reset = () => {
    setPlan(null);
    setError(null);
    setPicked([]);
  };

  const finish = (msg: string) => {
    toast.success(msg);
    onOpenChange(false);
    reset();
    onDone?.();
    router.refresh();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Assign reviewers to {plural(apps.length, 'application')}</DialogTitle>
          <DialogDescription>Pick a review stage, then let GMS balance the load or choose reviewers yourself. Reviewers with a declared conflict for an applicant are skipped automatically.</DialogDescription>
        </DialogHeader>
        <Summary apps={apps} />
        {choices.length === 0 ? (
          <Alert variant="warning" title="No review stage for these applications">
            Add an active or draft review stage to the application stage first (Reviews → Stages).
          </Alert>
        ) : (
          <div className="grid gap-4">
            <Field label="Review stage" htmlFor="assign-stage" required>
              <Select
                value={stage?.id ?? ''}
                onValueChange={(v) => {
                  setStageId(v);
                  setPlan(null);
                }}
              >
                <SelectTrigger id="assign-stage">
                  <SelectValue placeholder="Choose a review stage" />
                </SelectTrigger>
                <SelectContent>
                  {choices.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.status === 'draft' ? 'draft' : 'active'}, {plural(s.reviewersPerApplication, 'reviewer')} each)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <FieldSet legend="How">
              <RadioGroup
                value={mode}
                onValueChange={(v) => {
                  setMode(v as 'auto' | 'manual');
                  setPlan(null);
                  setError(null);
                }}
              >
                <RadioOption value="auto" label="Auto-assign" description="Round-robin with load balancing and reviewer capacity. You see the plan before anything is created." />
                <RadioOption value="manual" label="Pick reviewers" description="Every selected reviewer is assigned to every selected application." />
              </RadioGroup>
            </FieldSet>
            {mode === 'manual' ? (
              <FieldSet legend="Reviewers" error={error ?? undefined}>
                {reviewers.length ? (
                  <div className="grid max-h-56 gap-1 overflow-auto sm:grid-cols-2">
                    {reviewers.map((r) => (
                      <CheckboxField
                        key={r.id}
                        label={r.name}
                        description={r.role.replace(/_/g, ' ')}
                        checked={picked.includes(r.id)}
                        onCheckedChange={(v) => setPicked((p) => (v === true ? [...p, r.id] : p.filter((x) => x !== r.id)))}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">There are no reviewers on the team yet.</p>
                )}
              </FieldSet>
            ) : plan ? (
              <div className="grid gap-2 rounded-lg border p-3 text-sm" aria-live="polite">
                <p className="font-medium">
                  Plan: {plural(plan.plan.length, 'assignment')}
                  {plan.unassigned.length ? `, ${plural(plan.unassigned.length, 'application')} short of reviewers` : ''}
                </p>
                {plan.plan.length ? (
                  <ul className="grid max-h-48 gap-1 overflow-auto">
                    {Object.entries(
                      plan.plan.reduce<Record<string, string[]>>((acc, p) => {
                        (acc[p.applicationId] ??= []).push(p.reviewerName ?? 'Reviewer');
                        return acc;
                      }, {}),
                    ).map(([appId, names]) => (
                      <li key={appId}>
                        <span className="font-mono text-xs">{refOf.get(appId) ?? appId.slice(0, 8)}</span> → {names.join(', ')}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">Nothing to assign: every application already has enough reviewers on this stage, or none are eligible.</p>
                )}
                {plan.unassigned.length ? (
                  <Alert variant="warning" title="Some applications need more reviewers">
                    <ul className="grid gap-1">
                      {plan.unassigned.map((u) => (
                        <li key={u.applicationId}>
                          {refOf.get(u.applicationId) ?? 'Application'}: {u.reason}
                        </li>
                      ))}
                    </ul>
                  </Alert>
                ) : null}
                {plan.overCapacity.length ? <p className="text-muted-foreground">{plural(plan.overCapacity.length, 'reviewer')} reached their review capacity.</p> : null}
              </div>
            ) : error ? (
              <Alert variant="danger">{error}</Alert>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {choices.length && mode === 'auto' && !plan ? (
            <Button
              type="button"
              disabled={!stage}
              pending={pending}
              pendingLabel="Planning…"
              onClick={() =>
                stage &&
                start(async () => {
                  setError(null);
                  const r = await autoAssignAction(stage.id, ids, true);
                  if (r.ok) setPlan(r.data);
                  else setError(problemMessage(r.problem));
                })
              }
            >
              <Wand2 aria-hidden="true" /> Preview plan
            </Button>
          ) : null}
          {choices.length && mode === 'auto' && plan ? (
            <Button
              type="button"
              disabled={!stage || plan.plan.length === 0}
              pending={pending}
              pendingLabel="Assigning…"
              onClick={() =>
                stage &&
                start(async () => {
                  const r = await autoAssignAction(stage.id, ids, false);
                  if (r.ok) finish(`Created ${plural(r.data.created, 'assignment')}.`);
                  else setError(problemMessage(r.problem));
                })
              }
            >
              <UserPlus aria-hidden="true" /> Create {plural(plan.plan.length, 'assignment')}
            </Button>
          ) : null}
          {choices.length && mode === 'manual' ? (
            <Button
              type="button"
              disabled={!stage}
              pending={pending}
              pendingLabel="Assigning…"
              onClick={() => {
                if (!stage) return;
                if (!picked.length) {
                  setError('Pick at least one reviewer.');
                  return;
                }
                start(async () => {
                  setError(null);
                  const r = await assignReviewersAction(stage.id, ids, picked);
                  if (r.ok) finish(`Created ${plural(r.data.created, 'assignment')}${r.data.created < ids.length * picked.length ? ' (some already existed)' : ''}.`);
                  else setError(problemMessage(r.problem));
                });
              }}
            >
              <UserPlus aria-hidden="true" /> Assign {plural(picked.length, 'reviewer')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Bulk message -------------------------------------------------------------------------------------------
export function BulkMessageDialog({ open, onOpenChange, apps }: BaseProps & { apps: SelectedApp[] }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id: string; recipientCount: number } | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setDraft(null);
          setError(null);
        }
      }}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Message applicants of {plural(apps.length, 'application')}</DialogTitle>
          <DialogDescription>This saves a draft. You review the recipient count and send it from the message composer; nothing is emailed yet.</DialogDescription>
        </DialogHeader>
        <Summary apps={apps} />
        {draft ? (
          <div className="grid gap-3" aria-live="polite">
            <Alert variant="success" title="Draft saved">
              It would reach {plural(draft.recipientCount, 'person', 'people')} (each applicant’s primary contact, once).
            </Alert>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button asChild>
                <Link href={`/console/comms/messages/${draft.id}`}>
                  <Mail aria-hidden="true" /> Review and send
                </Link>
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!subject.trim() || !body.trim()) {
                setError('Write a subject and a message.');
                return;
              }
              setError(null);
              start(async () => {
                const r = await draftBulkMessageAction(
                  apps.map((a) => a.id),
                  subject.trim(),
                  body,
                );
                if (r.ok) setDraft(r.data);
                else setError(problemMessage(r.problem));
              });
            }}
          >
            <Field label="Subject" htmlFor="bulk-subject" required>
              <Input id="bulk-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} />
            </Field>
            <Field label="Message" htmlFor="bulk-body" required description="Markdown. You can edit it again in the composer before sending." error={error ?? undefined}>
              <Textarea id="bulk-body" rows={8} value={body} onChange={(e) => setBody(e.target.value)} maxLength={50000} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" pending={pending} pendingLabel="Saving draft…">
                <Mail aria-hidden="true" /> Save draft
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Tags ---------------------------------------------------------------------------------------------------
export function TagDialog({ open, onOpenChange, onDone, apps }: BaseProps & { apps: SelectedApp[] }) {
  const router = useRouter();
  const [add, setAdd] = useState('');
  const [remove, setRemove] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const existing = [...new Set(apps.flatMap((a) => a.tags))].sort();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tag {plural(apps.length, 'application')}</DialogTitle>
          <DialogDescription>Tags are staff-only labels. Applicants never see them.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const toAdd = [
              ...new Set(
                add
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean),
              ),
            ];
            if (toAdd.some((t) => t.length > 40)) {
              setError('Keep each tag to 40 characters or fewer.');
              return;
            }
            if (!toAdd.length && !remove.length) {
              setError('Add a tag or pick one to remove.');
              return;
            }
            setError(null);
            start(async () => {
              const r = await tagAction(
                apps.map((a) => a.id),
                toAdd,
                remove,
              );
              if (r.ok) {
                toast.success(`Updated tags on ${plural(r.data.updated, 'application')}.`);
                setAdd('');
                setRemove([]);
                onOpenChange(false);
                onDone?.();
                router.refresh();
              } else setError(problemMessage(r.problem));
            });
          }}
        >
          <Field label="Add tags" htmlFor="tag-add" description="Separate tags with commas, e.g. rural, first-time applicant." error={error ?? undefined}>
            <Input id="tag-add" value={add} onChange={(e) => setAdd(e.target.value)} />
          </Field>
          {existing.length ? (
            <FieldSet legend="Remove tags">
              <div className="grid gap-1 sm:grid-cols-2">
                {existing.map((t) => (
                  <CheckboxField key={t} label={t} checked={remove.includes(t)} onCheckedChange={(v) => setRemove((r) => (v === true ? [...r, t] : r.filter((x) => x !== t)))} />
                ))}
              </div>
            </FieldSet>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" pending={pending} pendingLabel="Saving…">
              <Tags aria-hidden="true" /> Save tags
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Mark ineligible (R3) -----------------------------------------------------------------------------------
export function IneligibleDialog({ open, onOpenChange, onDone, apps }: BaseProps & { apps: SelectedApp[] }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark {plural(apps.length, 'application')} ineligible</DialogTitle>
          <DialogDescription>The applicant sees the status change and the reason you give here. You can move it back to review later if this was a mistake.</DialogDescription>
        </DialogHeader>
        <Summary apps={apps} />
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason.trim()) {
              setError('Give the reason the applicant will see.');
              return;
            }
            setError(null);
            start(async () => {
              const r = await markIneligibleAction(
                apps.map((a) => a.id),
                reason.trim(),
              );
              if (r.ok) {
                toast.success(`Marked ${plural(r.data.updated, 'application')} ineligible.`);
                setReason('');
                onDone?.();
                onOpenChange(false);
                router.refresh();
              } else setError(problemMessage(r.problem));
            });
          }}
        >
          <Field label="Reason (shown to the applicant)" htmlFor="inelig-reason" required error={error ?? undefined}>
            <Textarea id="inelig-reason" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" pending={pending} pendingLabel="Saving…">
              <Ban aria-hidden="true" /> Mark ineligible
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Invite to next stage -----------------------------------------------------------------------------------
export function InviteDialog({ open, onOpenChange, onDone, apps, stages }: BaseProps & { apps: SelectedApp[]; stages: InviteStageOption[] }) {
  const router = useRouter();
  const opps = new Set(apps.map((a) => a.opportunityId));
  const comps = new Set(apps.map((a) => a.competitionId));
  const choices = stages.filter((s) => opps.has(s.opportunityId) && !comps.has(s.id));
  const [stageId, setStageId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const stage = choices.find((s) => s.id === stageId) ?? (choices.length === 1 ? choices[0] : undefined);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite to the next stage</DialogTitle>
          <DialogDescription>Applicants get an email invitation and their application shows “Invited to next stage”.</DialogDescription>
        </DialogHeader>
        <Summary apps={apps} />
        {choices.length === 0 ? (
          <Alert variant="warning" title="No invite-only stage">
            This opportunity has no invite-only stage to invite to. Add one on the opportunity first.
          </Alert>
        ) : (
          <div className="grid gap-4">
            <Field label="Stage" htmlFor="invite-stage" required>
              <Select value={stage?.id ?? ''} onValueChange={setStageId}>
                <SelectTrigger id="invite-stage">
                  <SelectValue placeholder="Choose the invite-only stage" />
                </SelectTrigger>
                <SelectContent>
                  {choices.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Message" htmlFor="invite-msg" optional description="Added to the invitation email and the status history." error={error ?? undefined}>
              <Textarea id="invite-msg" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={5000} />
            </Field>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!stage}
            pending={pending}
            pendingLabel="Inviting…"
            onClick={() =>
              stage &&
              start(async () => {
                setError(null);
                const r = await inviteToStageAction(
                  stage.id,
                  apps.map((a) => a.id),
                  message,
                );
                if (r.ok) {
                  toast.success(r.data.invited ? `Invited ${plural(r.data.invited, 'applicant')} to ${stage.name}.` : 'Nobody was invited: only submitted or under-review applications can be invited.');
                  setMessage('');
                  onDone?.();
                  onOpenChange(false);
                  router.refresh();
                } else setError(problemMessage(r.problem));
              })
            }
          >
            <ArrowRightCircle aria-hidden="true" /> Invite {plural(apps.length, 'applicant')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
