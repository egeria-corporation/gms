// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// P-04 decision panel. Maker-checker: the creator never sees an Approve button. Approval is people-only (R3)
// and asks for a fresh authenticator code (useStepUp) before it runs.
import { formatMoney } from '@gms/domain';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  Textarea,
} from '@gms/ui';
import { Check, UserCheck, X } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { approveBatchAction, cancelBatchAction, rejectBatchAction, submitBatchAction } from '@/app/console/(app)/payments/actions';
import { FeedbackRegion, useRunner } from './client-utils';

export interface BatchDecisionProps {
  batchId: string;
  status: string;
  count: number;
  totalCents: number;
  feeCents: number;
  isCreator: boolean;
  approvedByMe: boolean;
  firstApproverName: string | null;
  needsSecondApproval: boolean;
  canWrite: boolean;
  rejectionReason: string | null;
}

function RejectDialog({ batchId, count }: { batchId: string; count: number }) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const { run, pending, feedback } = useRunner();
  const id = React.useId();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <X aria-hidden="true" /> Reject
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Reject this batch?</DialogTitle>
          <DialogDescription>
            None of the {count} payments will be sent. Their installments go back to the schedule so they can be batched again. The creator sees your reason.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason.trim()) {
              setError('Say why you are rejecting it.');
              return;
            }
            setError(null);
            void run(() => rejectBatchAction({ batchId, reason: reason.trim() }), () => ({ variant: 'success', title: 'Batch rejected.' })).then((ok) => {
              if (ok) setOpen(false);
            });
          }}
        >
          <Field label="Reason" htmlFor={id} required error={error}>
            <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} />
          </Field>
          <FeedbackRegion feedback={feedback} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button type="submit" variant="destructive" pending={pending} pendingLabel="Rejecting…">
              Reject {count} payment{count === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BatchDecision(p: BatchDecisionProps) {
  const approver = useRunner({ reason: 'Approving payments is people-only, so we check your authenticator app first.', actionLabel: `Approve ${p.count} payments` });
  const other = useRunner();
  const [note, setNote] = React.useState('');
  const noteId = React.useId();

  if (p.status === 'draft') {
    return (
      <div className="grid gap-3">
        <Alert variant="info" title="This batch is a draft">
          Nobody has been asked to approve it yet.
        </Alert>
        {p.canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Button pending={other.pending} onClick={() => other.run(() => submitBatchAction(p.batchId), () => ({ variant: 'success', title: 'Sent for approval.' }))}>
              Send {p.count} payment{p.count === 1 ? '' : 's'} for approval
            </Button>
            <Button variant="outline" disabled={other.pending} onClick={() => other.run(() => cancelBatchAction(p.batchId), () => ({ variant: 'info', title: 'Draft discarded.' }))}>
              Discard draft
            </Button>
          </div>
        ) : null}
        <FeedbackRegion feedback={other.feedback} />
      </div>
    );
  }
  if (p.status === 'approved' || p.status === 'submitting') {
    return (
      <Alert variant="success" title="Approved">
        GMS is sending each payment to Mercury as a request. A person approves each request in Mercury before money moves.
      </Alert>
    );
  }
  if (p.status === 'submitted') {
    return (
      <Alert variant="info" title="Submitted to the bank" actions={<Link href={`/console/payments/status?batch=${p.batchId}`}>Track these payments</Link>}>
        Each payment now shows <strong>Awaiting bank approval (Mercury)</strong> until someone approves it in Mercury, then <strong>Sent</strong>.
      </Alert>
    );
  }
  if (p.status === 'rejected') {
    return (
      <Alert variant="danger" title="Rejected">
        {p.rejectionReason ? <>Reason: “{p.rejectionReason}”. </> : null}The installments are back on the schedule and can be batched again.
      </Alert>
    );
  }
  if (p.status === 'cancelled') {
    return <Alert variant="info" title="Cancelled">This batch was discarded before approval.</Alert>;
  }

  // awaiting_approval
  if (p.isCreator) {
    return (
      <div className="grid gap-3">
        <Alert variant="info" icon={<UserCheck aria-hidden="true" />} title="You created this batch — someone else must approve it">
          GMS uses maker-checker: the person who builds a batch can’t approve it{p.needsSecondApproval ? ', and batches this size need two different approvers' : ''}. Approvers were notified.
        </Alert>
        {p.canWrite ? (
          <div>
            <Button variant="outline" pending={other.pending} onClick={() => other.run(() => cancelBatchAction(p.batchId), () => ({ variant: 'info', title: 'Batch cancelled.' }))}>
              Cancel this batch
            </Button>
          </div>
        ) : null}
        <FeedbackRegion feedback={other.feedback} />
      </div>
    );
  }
  if (p.approvedByMe) {
    return (
      <Alert variant="info" title="You gave the first approval">
        This batch is at or above the two-approval threshold. A second, different person must approve it before anything is sent.
      </Alert>
    );
  }
  if (!p.canWrite) {
    return <Alert variant="info" title="Awaiting approval">A finance admin or workspace owner approves payment batches. You can view it but not approve it.</Alert>;
  }
  return (
    <div className="grid gap-4">
      {p.needsSecondApproval ? (
        <Alert variant="warning" title="Needs a second approval">
          {p.firstApproverName ? `${p.firstApproverName} approved first. ` : ''}Your approval completes it.
        </Alert>
      ) : null}
      <p className="text-sm">
        You are approving <strong>{p.count}</strong> payment{p.count === 1 ? '' : 's'} totaling <strong className="tabular-nums">{formatMoney(p.totalCents)}</strong>
        {p.feeCents ? (
          <>
            {' '}
            plus <strong className="tabular-nums">{formatMoney(p.feeCents)}</strong> in Mercury fees
          </>
        ) : null}
        . After approval, GMS asks Mercury to send each one; a person approves each request in Mercury.
      </p>
      <Field label="Note for the record" htmlFor={noteId} optional>
        <Textarea id={noteId} value={note} rows={2} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          pending={approver.pending}
          pendingLabel="Approving…"
          onClick={() =>
            approver.run(
              () => approveBatchAction({ batchId: p.batchId, note }),
              (d) =>
                d.needsSecondApproval
                  ? { variant: 'success', title: 'First approval recorded', detail: 'A second, different person must approve before anything is sent.' }
                  : { variant: 'success', title: 'Batch approved', detail: 'GMS is sending the payment requests to Mercury now.' },
              { stepUp: true },
            )
          }
        >
          <Check aria-hidden="true" /> Approve {p.count} payment{p.count === 1 ? '' : 's'}
        </Button>
        <RejectDialog batchId={p.batchId} count={p.count} />
      </div>
      <FeedbackRegion feedback={approver.feedback} />
      {approver.dialog}
    </div>
  );
}
