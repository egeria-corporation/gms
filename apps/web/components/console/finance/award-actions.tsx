// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// Award detail client parts: activate (people-only), the agreement workflow (generate → send → grantee signs →
// countersign with typed name, people-only with step-up), close/cancel, and amendments (draft, approve/reject).
import { formatDateOnly, formatInZone, formatMoney, parseMoneyToCents } from '@gms/domain';
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
  DialogTrigger,
  Field,
  FieldSet,
  Input,
  MoneyDisplay,
  RadioGroup,
  RadioOption,
  StatusChip,
  Textarea,
} from '@gms/ui';
import { FileText, Send } from 'lucide-react';
import * as React from 'react';
import {
  activateAwardAction,
  amendAwardAction,
  approveAmendmentAction,
  closeAwardAction,
  countersignAction,
  generateAgreementAction,
  sendAgreementAction,
} from '@/app/console/(app)/awards/actions';
import { FeedbackRegion, useRunner } from './client-utils';

export function ActivateAwardButton({ awardId, scheduleMatches, amountCents, scheduledCents }: { awardId: string; scheduleMatches: boolean; amountCents: number; scheduledCents: number }) {
  const { run, pending, feedback, dialog } = useRunner({ reason: 'Activating an award commits the foundation’s money, so we check your authenticator app first.', actionLabel: 'Activate award' });
  return (
    <div className="grid gap-2">
      {!scheduleMatches ? (
        <Alert variant="warning" title="The schedule doesn’t add up">
          Installments total {formatMoney(scheduledCents)} but the award is {formatMoney(amountCents)}. Fix the schedule before activating.
        </Alert>
      ) : null}
      <div>
        <Button
          disabled={!scheduleMatches}
          pending={pending}
          pendingLabel="Activating…"
          onClick={() =>
            run(
              () => activateAwardAction(awardId),
              () => ({ variant: 'success', title: 'Award activated', detail: 'Report requirements were created and a sanctions screening is queued. Next: generate and send the agreement.' }),
              { stepUp: true },
            )
          }
        >
          Activate award
        </Button>
      </div>
      <FeedbackRegion feedback={feedback} />
      {dialog}
    </div>
  );
}

export interface AgreementView {
  id: string;
  status: string;
  documentHash: string | null;
  sentAt: string | null;
  signatures: { role: string; typedName: string; signedAt: string }[];
}

function CountersignForm({ agreementId, awardId, viewerName, documentHash }: { agreementId: string; awardId: string; viewerName: string; documentHash: string | null }) {
  const [name, setName] = React.useState('');
  const [agree, setAgree] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { run, pending, feedback, dialog } = useRunner({ reason: 'Countersigning is people-only, so we check your authenticator app first.', actionLabel: 'Countersign' });
  const id = React.useId();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim().length < 2) {
          setError('Type your full name to countersign.');
          return;
        }
        if (!agree) {
          setError('Check the box to confirm you are authorized.');
          return;
        }
        setError(null);
        void run(
          () => countersignAction({ agreementId, awardId, typedName: name.trim() }),
          () => ({ variant: 'success', title: 'Countersigned', detail: '“Agreement pending” is cleared and payee onboarding can start.' }),
          { stepUp: true },
        );
      }}
    >
      {error ? <Alert variant="danger">{error}</Alert> : null}
      <Field label="Type your full name to countersign" htmlFor={id} description={`Signing as ${viewerName} for the foundation.`} required>
        <Input id={id} autoComplete="name" className="font-heading text-base" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <CheckboxField label="I am authorized to sign for the foundation, and I agree to the terms of this grant agreement." checked={agree} onCheckedChange={(c) => setAgree(c === true)} />
      {documentHash ? (
        <p className="text-xs text-muted-foreground">
          Your signature binds to document SHA-256 <code className="break-all">{documentHash.slice(0, 16)}…</code>
        </p>
      ) : null}
      <div>
        <Button type="submit" pending={pending} pendingLabel="Countersigning…">
          Countersign agreement
        </Button>
      </div>
      <FeedbackRegion feedback={feedback} />
      {dialog}
    </form>
  );
}

export function AgreementPanel({
  awardId,
  awardStatus,
  agreement,
  canManage,
  canCountersign,
  viewerName,
  timeZone,
}: {
  awardId: string;
  awardStatus: string;
  agreement: AgreementView | null;
  canManage: boolean;
  canCountersign: boolean;
  viewerName: string;
  timeZone: string;
}) {
  const { run, pending, feedback } = useRunner();
  const status = agreement?.status ?? 'none';
  const pdf = agreement?.documentHash ? (
    <Button asChild variant="outline" size="sm">
      <a href={`/console/awards/${awardId}/agreement`} target="_blank" rel="noopener">
        <FileText aria-hidden="true" /> Open the agreement (PDF)
      </a>
    </Button>
  ) : null;
  return (
    <div className="grid gap-3 text-sm">
      {awardStatus === 'draft' ? <p className="text-muted-foreground">Activate the award to prepare its agreement.</p> : null}
      {awardStatus === 'active' && (status === 'none' || status === 'draft') ? (
        <>
          <p>{status === 'draft' ? 'A draft agreement is ready. Review it, then send it to the grantee’s admins to sign in GMS.' : 'Generate the award letter and agreement from the award’s terms, schedule and reporting requirements.'}</p>
          <div className="flex flex-wrap gap-2">
            {pdf}
            {canManage ? (
              <Button
                size="sm"
                variant={status === 'draft' ? 'outline' : 'default'}
                pending={pending}
                onClick={() => run(() => generateAgreementAction(awardId), () => ({ variant: 'success', title: status === 'draft' ? 'Agreement regenerated.' : 'Agreement generated.' }))}
              >
                {status === 'draft' ? 'Regenerate' : 'Generate agreement'}
              </Button>
            ) : null}
            {canManage && status === 'draft' && agreement ? (
              <Button size="sm" pending={pending} onClick={() => run(() => sendAgreementAction({ agreementId: agreement.id, awardId }), () => ({ variant: 'success', title: 'Sent for signature', detail: 'The grantee’s admins get an email with a link to sign.' }))}>
                <Send aria-hidden="true" /> Send for signature
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
      {status === 'sent' ? (
        <>
          <Alert variant="info" title="Waiting for the grantee to sign">
            Sent {agreement?.sentAt ? formatInZone(agreement.sentAt, timeZone) : ''}. An admin of the grantee organization signs in their portal.
          </Alert>
          <div>{pdf}</div>
        </>
      ) : null}
      {agreement?.signatures.length ? (
        <ul className="grid gap-1">
          {agreement.signatures.map((s) => (
            <li key={s.role} className="rounded-md border p-2">
              <strong>{s.role === 'grantee' ? 'Signed for the grantee' : 'Countersigned for the foundation'}</strong> by “{s.typedName}” · {formatInZone(s.signedAt, timeZone)}
            </li>
          ))}
        </ul>
      ) : null}
      {status === 'signed' ? (
        canCountersign && agreement ? (
          <div className="grid gap-2">
            <div>{pdf}</div>
            <CountersignForm agreementId={agreement.id} awardId={awardId} viewerName={viewerName} documentHash={agreement.documentHash} />
          </div>
        ) : (
          <Alert variant="warning" title="Ready to countersign">
            The grantee signed. A workspace owner or admin countersigns.
          </Alert>
        )
      ) : null}
      {status === 'countersigned' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Alert variant="success" title="Fully signed" className="flex-1">
            Both sides have signed.
          </Alert>
          {pdf}
        </div>
      ) : null}
      <FeedbackRegion feedback={feedback} />
    </div>
  );
}

export function CloseAwardDialog({ awardId, reference, reportsOpen, scheduledCents }: { awardId: string; reference: string; reportsOpen: number; scheduledCents: number }) {
  const [open, setOpen] = React.useState(false);
  const [status, setStatus] = React.useState<'completed' | 'cancelled'>('completed');
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const { run, pending, feedback, setFeedback, dialog } = useRunner({ reason: 'Closing an award is people-only, so we check your authenticator app first.', actionLabel: 'Close award' });
  const id = React.useId();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setFeedback(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">Close award</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close {reference}</DialogTitle>
          <DialogDescription>Closing is final. Completed awards keep their history; cancelling also cancels every payment that hasn’t been sent.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (status === 'cancelled' && !reason.trim()) {
              setError('Say why the award is cancelled.');
              return;
            }
            setError(null);
            void run(() => closeAwardAction({ awardId, status, reason }), () => ({ variant: 'success', title: status === 'completed' ? `${reference} is completed.` : `${reference} is cancelled.` }), { stepUp: true }).then((ok) => {
              if (ok) setTimeout(() => setOpen(false), 900);
            });
          }}
        >
          <FieldSet legend="How is it closing?">
            <RadioGroup value={status} onValueChange={(v) => setStatus(v as 'completed' | 'cancelled')}>
              <RadioOption value="completed" label="Completed" description={reportsOpen ? `${reportsOpen} report(s) aren’t accepted yet.` : 'All reports are accepted.'} />
              <RadioOption value="cancelled" label="Cancelled" description={scheduledCents ? `${formatMoney(scheduledCents)} in unpaid installments will be cancelled.` : 'No unpaid installments remain.'} />
            </RadioGroup>
          </FieldSet>
          <Field label="Reason" htmlFor={id} required={status === 'cancelled'} optional={status === 'completed'} error={error}>
            <Textarea id={id} rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <FeedbackRegion feedback={feedback} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Keep it open
            </Button>
            <Button type="submit" variant={status === 'cancelled' ? 'destructive' : 'default'} pending={pending} pendingLabel="Closing…">
              {status === 'completed' ? 'Mark completed' : 'Cancel award'}
            </Button>
          </DialogFooter>
        </form>
        {dialog}
      </DialogContent>
    </Dialog>
  );
}

export interface AmendmentView {
  id: string;
  reference: string;
  kind: string;
  amountCents: number;
  endDate: string | null;
  purpose: string | null;
  status: string;
  createdAt: string;
}

function AmendmentDecision({ a, parentAwardId }: { a: AmendmentView; parentAwardId: string }) {
  const { run, pending, feedback, dialog } = useRunner({ reason: 'Approving an amendment changes committed funds, so we check your authenticator app first.', actionLabel: 'Approve' });
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          pending={pending}
          onClick={() =>
            run(
              () => approveAmendmentAction({ amendmentId: a.id, parentAwardId, approve: true }),
              (d) => ({ variant: 'success', title: `Approved. The award total is now ${formatMoney(d.newTotalCents)}.`, detail: 'Update the payment schedule to include the new amount.' }),
              { stepUp: true },
            )
          }
        >
          Approve {a.kind}
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => approveAmendmentAction({ amendmentId: a.id, parentAwardId, approve: false }), () => ({ variant: 'info', title: 'Rejected.' }), { stepUp: true })}>
          Reject
        </Button>
      </div>
      <FeedbackRegion feedback={feedback} />
      {dialog}
    </div>
  );
}

function DraftAmendmentDialog({ awardId, endDate }: { awardId: string; endDate: string | null }) {
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<'amendment' | 'supplement'>('supplement');
  const [amount, setAmount] = React.useState('');
  const [newEnd, setNewEnd] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { run, pending, feedback, setFeedback } = useRunner();
  const ids = { amount: React.useId(), end: React.useId(), reason: React.useId() };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setFeedback(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Draft amendment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Draft an amendment or supplement</DialogTitle>
          <DialogDescription>A drafted change doesn’t affect payments until someone approves it.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const cents = parseMoneyToCents(amount || '0');
            const errs: Record<string, string> = {};
            if (cents === null) errs.amount = 'Enter an amount like 5,000 or -2,500.';
            else if (kind === 'supplement' && cents <= 0) errs.amount = 'A supplement adds money; enter a positive amount.';
            if (!reason.trim()) errs.reason = 'Explain the change.';
            setErrors(errs);
            if (Object.keys(errs).length) return;
            void run(() => amendAwardAction({ awardId, kind, amountCents: cents!, newEndDate: newEnd || undefined, reason: reason.trim() }), () => ({ variant: 'success', title: 'Drafted. Approve it below.' })).then((ok) => {
              if (ok) setTimeout(() => setOpen(false), 700);
            });
          }}
        >
          <FieldSet legend="Type">
            <RadioGroup value={kind} onValueChange={(v) => setKind(v as 'amendment' | 'supplement')}>
              <RadioOption value="supplement" label="Supplement" description="Additional funds." />
              <RadioOption value="amendment" label="Amendment" description="Change the amount (up or down) and/or extend the end date." />
            </RadioGroup>
          </FieldSet>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Change in amount (USD)" htmlFor={ids.amount} error={errors.amount} description={kind === 'amendment' ? 'Use a minus sign to reduce.' : undefined}>
              <Input id={ids.amount} inputMode="decimal" className="tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5,000.00" />
            </Field>
            <Field label="New end date" htmlFor={ids.end} optional description={endDate ? `Currently ${formatDateOnly(endDate)}.` : undefined}>
              <Input id={ids.end} type="date" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
            </Field>
          </div>
          <Field label="Reason" htmlFor={ids.reason} required error={errors.reason}>
            <Textarea id={ids.reason} rows={3} maxLength={5000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <FeedbackRegion feedback={feedback} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" pending={pending} pendingLabel="Saving…">
              Save draft
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AmendmentsPanel({ awardId, awardStatus, endDate, items, canManage }: { awardId: string; awardStatus: string; endDate: string | null; items: AmendmentView[]; canManage: boolean }) {
  return (
    <div className="grid gap-3 text-sm">
      {items.length ? (
        <ul className="grid gap-2">
          {items.map((a) => (
            <li key={a.id} className="grid gap-1 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <strong>{a.reference}</strong>
                <span className="capitalize">{a.kind}</span>
                <MoneyDisplay cents={a.amountCents} showPlus signColors />
                {a.status === 'approved' ? <StatusChip kind="award" value="active" size="sm" label="Approved" /> : a.status === 'rejected' ? <StatusChip kind="award" value="cancelled" size="sm" label="Rejected" /> : <StatusChip kind="award" value="draft" size="sm" label="Awaiting approval" />}
              </div>
              {a.endDate && a.endDate !== endDate ? <span className="text-xs text-muted-foreground">New end date {formatDateOnly(a.endDate)}</span> : null}
              {a.purpose ? <p className="text-muted-foreground">{a.purpose}</p> : null}
              {a.status === 'draft' && canManage ? <AmendmentDecision a={a} parentAwardId={awardId} /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">No amendments or supplements.</p>
      )}
      {canManage && awardStatus === 'active' ? (
        <div>
          <DraftAmendmentDialog awardId={awardId} endDate={endDate} />
        </div>
      ) : null}
    </div>
  );
}
