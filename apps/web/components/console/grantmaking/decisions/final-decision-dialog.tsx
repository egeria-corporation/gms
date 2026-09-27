// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// R-05: record the final decision (decisions.record_final — R3, people only; no step-up). Two steps: choose,
// then a confirmation that restates exactly what will happen. Approve → Awarded + a draft award (then the
// award builder); decline → Declined (+ optional letter); defer → recorded, status unchanged.
import { formatMoney, parseMoneyToCents } from '@gms/domain';
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
  Textarea,
} from '@gms/ui';
import { ArrowRight, Gavel } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { recordFinalAction } from '@/app/console/(app)/decisions/actions';
import { useRunAction } from '../run-action';
import { DecisionOutcomeChip } from './outcome-chips';

export interface FinalTarget {
  id: string;
  reference: string;
  title: string;
  organization: string | null;
  requestedCents: number | null;
  recommendation: { outcome: string; amountCents: number | null; reason: string | null } | null;
}

type Outcome = 'approve' | 'decline' | 'defer';

export function consequence(outcome: Outcome, amountCents: number | null, sendLetter: boolean): string[] {
  if (outcome === 'approve') {
    return [
      `The application moves to Awarded. This is final and can’t be undone here.`,
      `A draft award for ${amountCents ? formatMoney(amountCents) : 'the amount you enter'} is created. Nothing is paid until you activate the award and the agreement is signed.`,
      sendLetter ? 'The applicant is notified by email and sees the status in their portal.' : 'No email is sent; the applicant sees the status change in their portal.',
    ];
  }
  if (outcome === 'decline') {
    return [
      'The application moves to Declined. This is final and can’t be undone here.',
      sendLetter ? 'The applicant gets the decline letter by email, including your reason.' : 'No letter is sent; the applicant sees the status change in their portal.',
    ];
  }
  return ['The deferral is recorded with your reason. The application’s status does not change and the applicant is not notified.'];
}

export function FinalDecisionDialog({ target, open, onOpenChange }: { target: FinalTarget | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { run, pending } = useRunAction();
  const [step, setStep] = useState<'choose' | 'confirm' | 'done'>('choose');
  const [outcome, setOutcome] = useState<Outcome>('approve');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [sendLetter, setSendLetter] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [awardId, setAwardId] = useState<string | null>(null);

  useEffect(() => {
    if (!target || !open) return;
    const rec = target.recommendation;
    setStep('choose');
    setOutcome(rec && ['approve', 'decline', 'defer'].includes(rec.outcome) ? (rec.outcome as Outcome) : 'approve');
    const cents = rec?.amountCents ?? target.requestedCents;
    setAmount(cents !== null && cents !== undefined ? (cents / 100).toFixed(2) : '');
    setReason(rec?.reason ?? '');
    setSendLetter(true);
    setError(null);
    setAwardId(null);
  }, [target, open]);

  if (!target) return null;
  const cents = parseMoneyToCents(amount);
  const lines = consequence(outcome, cents, sendLetter);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{step === 'done' ? 'Final decision recorded' : step === 'confirm' ? 'Confirm the final decision' : 'Record the final decision'}</DialogTitle>
          <DialogDescription>
            {target.reference} · {target.title}
            {target.organization ? ` · ${target.organization}` : ''}
          </DialogDescription>
        </DialogHeader>

        {step === 'done' ? (
          <div className="grid gap-4" aria-live="polite">
            <Alert variant="success" title={outcome === 'approve' ? 'Awarded. A draft award was created.' : outcome === 'decline' ? 'Declined.' : 'Deferral recorded.'}>
              {outcome === 'approve' ? 'Next: set the period, conditions and payment schedule, then activate the award.' : null}
            </Alert>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              {outcome === 'approve' ? (
                <Button asChild>
                  <Link href={`/console/decisions/${target.id}/award`}>
                    Open the award builder <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              ) : null}
            </DialogFooter>
            {awardId ? <span className="sr-only">Award {awardId} created.</span> : null}
          </div>
        ) : step === 'confirm' ? (
          <div className="grid gap-4">
            <Alert variant={outcome === 'defer' ? 'info' : 'warning'} title={`Final decision: ${outcome === 'approve' ? `Approve ${cents ? formatMoney(cents) : ''}` : outcome === 'decline' ? 'Decline' : 'Defer'}`}>
              <ul className="list-disc pl-5">
                {lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </Alert>
            {reason.trim() ? (
              <p className="text-sm">
                <span className="text-muted-foreground">Reason: </span>
                {reason.trim()}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStep('choose')}>
                Back
              </Button>
              <Button
                type="button"
                variant={outcome === 'decline' ? 'destructive' : 'default'}
                pending={pending}
                pendingLabel="Recording…"
                onClick={() =>
                  void run(() => recordFinalAction({ applicationId: target.id, outcome, reason: reason || null, amountCents: outcome === 'approve' ? cents : null, sendLetter }), {
                    success: 'Final decision recorded.',
                    onDone: (d) => {
                      setAwardId(d.awardId);
                      setStep('done');
                    },
                  })
                }
              >
                <Gavel aria-hidden="true" /> Record final decision
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (outcome === 'approve' && (cents === null || cents <= 0)) {
                setError('Enter the award amount, for example 12,000.');
                return;
              }
              setError(null);
              setStep('confirm');
            }}
          >
            {target.recommendation ? (
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                Latest recommendation: <DecisionOutcomeChip outcome={target.recommendation.outcome} />
                {target.recommendation.amountCents ? <span className="tabular-nums text-foreground">{formatMoney(target.recommendation.amountCents)}</span> : null}
              </p>
            ) : null}
            <FieldSet legend="Decision" required>
              <RadioGroup value={outcome} onValueChange={(v) => setOutcome(v as Outcome)}>
                <RadioOption value="approve" label="Approve" description="Awarded; creates a draft award." />
                <RadioOption value="decline" label="Decline" description="Declined; optional letter to the applicant." />
                <RadioOption value="defer" label="Defer" description="Recorded; the status does not change." />
              </RadioGroup>
            </FieldSet>
            {outcome === 'approve' ? (
              <Field
                label="Award amount (USD)"
                htmlFor="final-amount"
                required
                error={error ?? undefined}
                description={target.requestedCents !== null ? `Requested: ${formatMoney(target.requestedCents)}` : undefined}
              >
                <Input id="final-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-48 tabular-nums" />
              </Field>
            ) : null}
            <Field label="Reason" htmlFor="final-reason" optional={outcome !== 'decline'} description={outcome === 'decline' ? 'Included in the decline letter.' : 'Recorded with the decision.'}>
              <Textarea id="final-reason" rows={3} value={reason} maxLength={5000} onChange={(e) => setReason(e.target.value)} />
            </Field>
            {outcome !== 'defer' ? (
              <CheckboxField
                label={outcome === 'decline' ? 'Email the decline letter to the applicant' : 'Notify the applicant by email'}
                checked={sendLetter}
                onCheckedChange={(v) => setSendLetter(v === true)}
              />
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit">Review decision</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
