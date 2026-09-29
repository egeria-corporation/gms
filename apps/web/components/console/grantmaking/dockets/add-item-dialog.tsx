// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// E-01: add an application with an approve recommendation (not already on a docket) to this docket
// (board.add_docket_item), with the recommended amount and a short recommendation for the board.
import { formatMoney, parseMoneyToCents } from '@gms/domain';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, EmptyState, Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from '@gms/ui';
import { Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { addDocketItemAction } from '@/app/console/(app)/dockets/actions';
import { useRunAction } from '../run-action';

export interface DocketCandidate {
  applicationId: string;
  label: string;
  recommendedCents: number | null;
  recommendation: string | null;
}

export function AddDocketItemDialog({ docketId, candidates }: { docketId: string; candidates: DocketCandidate[] }) {
  const ids = useId();
  const { run, pending } = useRunAction();
  const [open, setOpen] = useState(false);
  const [appId, setAppId] = useState('');
  const [amount, setAmount] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const pick = (id: string) => {
    setAppId(id);
    const c = candidates.find((x) => x.applicationId === id);
    setAmount(c?.recommendedCents != null ? (c.recommendedCents / 100).toFixed(2) : '');
    setText(c?.recommendation ?? '');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setAppId('');
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus aria-hidden="true" /> Add application
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an application to the docket</DialogTitle>
          <DialogDescription>Only applications with an approve recommendation that aren’t on a docket yet are listed.</DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? (
          <EmptyState variant="inline" level={3} title="Nothing to add" description="Every application with an approve recommendation is already on a docket. Record more recommendations on the decisions page." />
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const cents = amount.trim() ? parseMoneyToCents(amount) : null;
              if (!appId) {
                setError('Choose an application.');
                return;
              }
              if (amount.trim() && (cents === null || cents < 0)) {
                setError('Enter the recommended amount, for example 12,000.');
                return;
              }
              setError(null);
              void run(() => addDocketItemAction({ docketId, applicationId: appId, recommendedAmountCents: cents, recommendation: text || null }), {
                success: 'Added to the docket.',
                onDone: () => {
                  setOpen(false);
                  setAppId('');
                },
              });
            }}
          >
            <Field label="Application" htmlFor={`${ids}-app`} required error={error ?? undefined}>
              <Select value={appId} onValueChange={pick}>
                <SelectTrigger id={`${ids}-app`}>
                  <SelectValue placeholder="Choose an application" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((c) => (
                    <SelectItem key={c.applicationId} value={c.applicationId}>
                      {c.label}
                      {c.recommendedCents != null ? ` · ${formatMoney(c.recommendedCents)}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Recommended amount (USD)" htmlFor={`${ids}-amt`} optional>
              <Input id={`${ids}-amt`} inputMode="decimal" className="w-48 tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Recommendation for the board" htmlFor={`${ids}-rec`} optional>
              <Textarea id={`${ids}-rec`} rows={3} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" pending={pending} pendingLabel="Adding…">
                Add to docket
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
