// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// Award payment hold: put on hold (reason required) or release. Held awards can't have payments batched.
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  Switch,
  Textarea,
} from '@gms/ui';
import * as React from 'react';
import { setAwardHoldAction } from '@/app/console/(app)/awards/actions';
import { setReportHoldAction } from '@/app/console/(app)/reports/actions';
import { FeedbackRegion, useRunner } from './client-utils';

export function AwardHoldControl({ awardId, reference, onHold, reason, canWrite, size = 'sm' }: { awardId: string; reference: string; onHold: boolean; reason: string | null; canWrite: boolean; size?: 'sm' | 'default' }) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const { run, pending, feedback, setFeedback } = useRunner();
  const id = React.useId();
  if (!canWrite) return onHold ? <span className="text-xs text-muted-foreground">{reason ?? 'On hold'}</span> : null;
  if (onHold) {
    return (
      <div className="grid justify-items-start gap-1">
        {reason ? <span className="max-w-64 text-xs text-muted-foreground">“{reason}”</span> : null}
        <Button size={size} variant="outline" pending={pending} pendingLabel="Releasing…" onClick={() => run(() => setAwardHoldAction({ awardId, onHold: false }), () => ({ variant: 'success', title: `Released the hold on ${reference}.` }))}>
          Release hold<span className="sr-only"> on {reference}</span>
        </Button>
        <FeedbackRegion feedback={feedback} className="max-w-xs" />
      </div>
    );
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setFeedback(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size={size} variant="outline">
          Put on hold<span className="sr-only"> {reference}</span>
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Put {reference} on hold?</DialogTitle>
          <DialogDescription>No payments can be batched for this award until you release the hold. Scheduled payments show as Held.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) {
              setError('Say why the award is on hold.');
              return;
            }
            setError(null);
            void run(() => setAwardHoldAction({ awardId, onHold: true, reason: text.trim() }), () => ({ variant: 'success', title: `${reference} is on hold.` })).then((ok) => {
              if (ok) {
                setOpen(false);
                setText('');
              }
            });
          }}
        >
          <Field label="Reason" htmlFor={id} required error={error} description="Staff see this reason next to the award and its payments.">
            <Textarea id={id} rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <FeedbackRegion feedback={feedback} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" pending={pending} pendingLabel="Saving…">
              Put on hold
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Per-requirement switch: whether this report being overdue holds the grant's payments. */
export function ReportHoldSwitch({ requirementId, title, holdsPayments, canWrite }: { requirementId: string; title: string; holdsPayments: boolean; canWrite: boolean }) {
  const [checked, setChecked] = React.useState(holdsPayments);
  const { run, pending, feedback } = useRunner();
  const id = React.useId();
  React.useEffect(() => setChecked(holdsPayments), [holdsPayments]);
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <Switch
          id={id}
          checked={checked}
          disabled={!canWrite || pending}
          onCheckedChange={(v) => {
            setChecked(v);
            void run(
              () => setReportHoldAction({ requirementId, holdsPayments: v }),
              () => ({ variant: 'success', title: v ? `${title}: holds payments when overdue.` : `${title}: no longer holds payments.` }),
            ).then((ok) => {
              if (!ok) setChecked(!v);
            });
          }}
        />
        <label htmlFor={id} className="text-xs">
          {checked ? 'Holds payments' : 'Doesn’t hold'}
          <span className="sr-only"> when “{title}” is overdue</span>
        </label>
      </div>
      <FeedbackRegion feedback={feedback?.variant === 'success' ? null : feedback} className="max-w-xs" />
      <span className="sr-only" aria-live="polite">
        {feedback?.variant === 'success' ? feedback.title : ''}
      </span>
    </div>
  );
}
