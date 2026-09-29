// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// R-05: record a (non-final) recommendation — approve with an amount, decline or defer — with a reason.
// Recommendations feed the board docket and never notify the applicant.
import { formatMoney, parseMoneyToCents } from '@gms/domain';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldSet, Input, RadioGroup, RadioOption, Textarea } from '@gms/ui';
import { useEffect, useState } from 'react';
import { recommendAction } from '@/app/console/(app)/decisions/actions';
import { useRunAction } from '../run-action';

export interface RecommendTarget {
  id: string;
  reference: string;
  title: string;
  requestedCents: number | null;
  current: { outcome: string; amountCents: number | null; reason: string | null } | null;
}

type Outcome = 'approve' | 'decline' | 'defer';

export function RecommendDialog({ target, open, onOpenChange }: { target: RecommendTarget | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { run, pending } = useRunAction();
  const [outcome, setOutcome] = useState<Outcome>('approve');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target || !open) return;
    const cur = target.current;
    setOutcome(cur && ['approve', 'decline', 'defer'].includes(cur.outcome) ? (cur.outcome as Outcome) : 'approve');
    const cents = cur?.amountCents ?? target.requestedCents;
    setAmount(cents !== null && cents !== undefined ? (cents / 100).toFixed(2) : '');
    setReason(cur?.reason ?? '');
    setError(null);
  }, [target, open]);

  if (!target) return null;
  const cents = parseMoneyToCents(amount);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Recommend a decision</DialogTitle>
          <DialogDescription>
            {target.reference} · {target.title}. A recommendation is not final and does not notify the applicant. Approve recommendations can be added to a board docket.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (outcome === 'approve' && (cents === null || cents <= 0)) {
              setError('Enter the amount you recommend, for example 12,000.');
              return;
            }
            setError(null);
            void run(() => recommendAction({ applicationId: target.id, outcome, reason: reason || null, recommendedAmountCents: outcome === 'approve' ? cents : null }), {
              success: 'Recommendation recorded.',
              onDone: () => onOpenChange(false),
            });
          }}
        >
          <FieldSet legend="Recommendation" required>
            <RadioGroup value={outcome} onValueChange={(v) => setOutcome(v as Outcome)}>
              <RadioOption value="approve" label="Approve" description="Fund it, at the amount below." />
              <RadioOption value="decline" label="Decline" />
              <RadioOption value="defer" label="Defer" description="Revisit in a later round or meeting." />
            </RadioGroup>
          </FieldSet>
          {outcome === 'approve' ? (
            <Field
              label="Recommended amount (USD)"
              htmlFor="rec-amount"
              required
              error={error ?? undefined}
              description={target.requestedCents !== null ? `Requested: ${formatMoney(target.requestedCents)}` : undefined}
            >
              <Input id="rec-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-48 tabular-nums" />
            </Field>
          ) : null}
          <Field label="Reason" htmlFor="rec-reason" optional description="Shown to staff and on the board docket. Not sent to the applicant.">
            <Textarea id="rec-reason" rows={3} value={reason} maxLength={5000} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" pending={pending} pendingLabel="Saving…">
              Save recommendation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
