// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// Staff actions on one application: advance to review, request info, mark ineligible (R3, applicant-visible
// reason), grant a deadline extension, and a link to record a recommendation in Decisions.
import {
  Button,
  CheckboxField,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Textarea,
  toast,
} from '@gms/ui';
import { Ban, CalendarClock, Gavel, MessageSquareWarning, MoveRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { advanceAction } from '../pipeline/actions';
import { IneligibleDialog, InviteDialog } from '../pipeline/bulk-dialogs';
import type { InviteStageOption } from '../pipeline/types';
import { problemMessage, useRunAction } from '../run-action';
import { grantExtensionAction, requestInfoAction } from './actions';

export interface ApplicationActionsProps {
  applicationId: string;
  reference: string;
  status: string;
  opportunityId: string;
  competitionId: string;
  tags: string[];
  /** Wall-clock deadline in the workspace tz ("YYYY-MM-DDTHH:mm"), used to prefill the extension. */
  deadlineLocal: string;
  timeZone: string;
  inviteStages: InviteStageOption[];
}

export function ApplicationActions(p: ApplicationActionsProps) {
  const router = useRouter();
  const { run, pending } = useRunAction();
  const [open, setOpen] = useState<'info' | 'ineligible' | 'extension' | 'invite' | null>(null);
  const [note, setNote] = useState('');
  const [reopen, setReopen] = useState(false);
  const [deadline, setDeadline] = useState(p.deadlineLocal);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const apps = [{ id: p.applicationId, reference: p.reference, competitionId: p.competitionId, opportunityId: p.opportunityId, tags: p.tags }];
  const s = p.status;
  const canAdvance = s === 'submitted' || s === 'ineligible';
  const canIneligible = ['in_progress', 'submitted', 'under_review'].includes(s);
  const canRequestInfo = ['in_progress', 'submitted', 'under_review'].includes(s);
  const canReopen = s === 'submitted' || s === 'under_review';
  const canExtend = s === 'in_progress';
  const canInvite = (s === 'submitted' || s === 'under_review') && p.inviteStages.some((x) => x.opportunityId === p.opportunityId && x.id !== p.competitionId);
  const canDecide = ['submitted', 'under_review', 'invited_to_next_stage'].includes(s);
  const close = () => {
    setOpen(null);
    setError(null);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {canAdvance ? (
        <Button
          size="sm"
          pending={pending}
          pendingLabel="Moving…"
          onClick={() =>
            void run(() => advanceAction([p.applicationId]), {
              success: (d) => (d.moved ? 'Moved to Under review.' : `Not moved: ${d.skipped[0]?.reason ?? 'already under review'}.`),
            })
          }
        >
          <MoveRight aria-hidden="true" /> Advance to review
        </Button>
      ) : null}
      {canInvite ? (
        <Button size="sm" variant="outline" onClick={() => setOpen('invite')}>
          <MoveRight aria-hidden="true" /> Invite to next stage
        </Button>
      ) : null}
      {canRequestInfo ? (
        <Button size="sm" variant="outline" onClick={() => setOpen('info')}>
          <MessageSquareWarning aria-hidden="true" /> Request info
        </Button>
      ) : null}
      {canExtend ? (
        <Button size="sm" variant="outline" onClick={() => setOpen('extension')}>
          <CalendarClock aria-hidden="true" /> Grant extension
        </Button>
      ) : null}
      {canDecide ? (
        <Button asChild size="sm" variant="outline">
          <Link href={`/console/decisions?q=${encodeURIComponent(p.reference)}`}>
            <Gavel aria-hidden="true" /> Record a recommendation
          </Link>
        </Button>
      ) : null}
      {canIneligible ? (
        <Button size="sm" variant="outline" className="text-destructive" onClick={() => setOpen('ineligible')}>
          <Ban aria-hidden="true" /> Mark ineligible
        </Button>
      ) : null}

      <IneligibleDialog open={open === 'ineligible'} onOpenChange={(o) => (o ? setOpen('ineligible') : close())} apps={apps} />
      <InviteDialog open={open === 'invite'} onOpenChange={(o) => (o ? setOpen('invite') : close())} apps={apps} stages={p.inviteStages} />

      <Dialog open={open === 'info'} onOpenChange={(o) => (o ? setOpen('info') : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request more information</DialogTitle>
            <DialogDescription>Your note is posted in the application’s message thread and emailed to the applicant.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!note.trim()) {
                setError('Say what you need from the applicant.');
                return;
              }
              start(async () => {
                const r = await requestInfoAction(p.applicationId, note.trim(), canReopen && reopen);
                if (r.ok) {
                  toast.success(reopen && canReopen ? 'Request sent. The application is open for edits again.' : 'Request sent to the applicant.');
                  setNote('');
                  setReopen(false);
                  close();
                  router.refresh();
                } else setError(problemMessage(r.problem));
              });
            }}
          >
            <Field label="What do you need?" htmlFor="info-note" required error={error ?? undefined}>
              <Textarea id="info-note" rows={5} value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} />
            </Field>
            {canReopen ? (
              <CheckboxField
                label="Reopen the application for edits"
                description="Moves it back to In progress so the applicant can change answers and submit again."
                checked={reopen}
                onCheckedChange={(v) => setReopen(v === true)}
              />
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" pending={saving} pendingLabel="Sending…">
                Send request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={open === 'extension'} onOpenChange={(o) => (o ? setOpen('extension') : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grant a deadline extension</DialogTitle>
            <DialogDescription>Only this applicant gets the new deadline. Times are in {p.timeZone}.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(deadline)) {
                setError('Pick the new date and time.');
                return;
              }
              start(async () => {
                const r = await grantExtensionAction(p.applicationId, deadline, reason);
                if (r.ok) {
                  toast.success('Extension granted.');
                  setReason('');
                  close();
                  router.refresh();
                } else setError(problemMessage(r.problem));
              });
            }}
          >
            <Field label={`New deadline (${p.timeZone})`} htmlFor="ext-deadline" required error={error ?? undefined}>
              <Input id="ext-deadline" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </Field>
            <Field label="Reason" htmlFor="ext-reason" optional description="Kept in the audit log.">
              <Textarea id="ext-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" pending={saving} pendingLabel="Saving…">
                <CalendarClock aria-hidden="true" /> Grant extension
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
