// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// R-06 amendments & supplements for an active award: drafted here as child awards (awards.amend) and
// approved on the award page (/console/awards/[id]).
import { formatDateOnly, formatInZone, formatMoney, parseMoneyToCents } from '@gms/domain';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Field, Input, MoneyDisplay, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow, Textarea } from '@gms/ui';
import { ArrowRight, FilePlus2 } from 'lucide-react';
import Link from 'next/link';
import { useId, useState } from 'react';
import { amendAwardAction } from '@/app/console/(app)/decisions/actions';
import { useRunAction } from '../run-action';
import { AmendmentStatusChip } from './outcome-chips';

export interface AmendmentRow {
  id: string;
  reference: string;
  kind: string;
  amountCents: number;
  endDate: string | null;
  status: string | null;
  reason: string | null;
  createdAt: string;
  createdBy: string | null;
}

export function AmendmentsPanel({
  applicationId,
  awardId,
  awardReference,
  currentEndDate,
  rows,
  canAmend,
  timeZone,
}: {
  applicationId: string;
  awardId: string | null;
  awardReference: string | null;
  currentEndDate: string;
  rows: AmendmentRow[];
  canAmend: boolean;
  timeZone: string;
}) {
  const ids = useId();
  const { run, pending } = useRunAction();
  const [kind, setKind] = useState<'amendment' | 'supplement'>('amendment');
  const [amount, setAmount] = useState('');
  const [newEnd, setNewEnd] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cents = parseMoneyToCents(amount);
  const pendingCount = rows.filter((r) => r.status === 'draft').length;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle as="h2" className="text-base">
          Amendments & supplements
        </CardTitle>
        {awardId ? (
          <Button asChild variant="link" size="sm">
            <Link href={`/console/awards/${awardId}`}>
              Review and approve on the award page <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-5">
        {pendingCount ? (
          <Alert variant="warning" title={`${pendingCount} change${pendingCount === 1 ? '' : 's'} awaiting approval`}>
            Drafted changes don’t affect the award until someone approves them on the award page.
          </Alert>
        ) : null}
        {rows.length ? (
          <Table>
            <TableCaption className="sr-only">Amendments and supplements to award {awardReference ?? ''}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>New end date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.reference}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {r.createdBy ?? 'Someone'} · {formatInZone(r.createdAt, timeZone, { dateOnly: true })}
                    </span>
                  </TableCell>
                  <TableCell>{r.kind === 'supplement' ? 'Supplement' : 'Amendment'}</TableCell>
                  <TableCell className="text-right">
                    <MoneyDisplay cents={r.amountCents} signColors showPlus />
                  </TableCell>
                  <TableCell>{r.endDate && r.endDate !== currentEndDate ? formatDateOnly(r.endDate) : '—'}</TableCell>
                  <TableCell>
                    <AmendmentStatusChip status={r.status} />
                  </TableCell>
                  <TableCell className="max-w-72 text-sm">{r.reason ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState variant="inline" level={3} title="No amendments or supplements" description="Change the amount or end date of an active award here." />
        )}

        {canAmend && awardId ? (
          <form
            className="grid gap-4 border-t pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (cents === null && !(kind === 'amendment' && amount.trim() === '' && newEnd)) {
                setError(kind === 'supplement' ? 'Enter the additional amount.' : 'Enter the change in amount (use a minus sign to reduce).');
                return;
              }
              if (kind === 'amendment' && !cents && !newEnd) {
                setError('Enter a change in amount or a new end date.');
                return;
              }
              if (kind === 'supplement' && (cents ?? 0) <= 0) {
                setError('A supplement adds money; enter a positive amount.');
                return;
              }
              if (!reason.trim()) {
                setError('Say why the award is changing.');
                return;
              }
              setError(null);
              void run(() => amendAwardAction(applicationId, { awardId, kind, amountCents: cents ?? 0, newEndDate: kind === 'amendment' && newEnd ? newEnd : null, reason: reason.trim() }), {
                success: `${kind === 'supplement' ? 'Supplement' : 'Amendment'} drafted. Approve it on the award page.`,
                onDone: () => {
                  setAmount('');
                  setNewEnd('');
                  setReason('');
                },
              });
            }}
          >
            <h3 className="font-heading text-sm font-semibold">Draft a change</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Kind" htmlFor={`${ids}-kind`} required>
                <Select value={kind} onValueChange={(v) => setKind(v as 'amendment' | 'supplement')}>
                  <SelectTrigger id={`${ids}-kind`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="amendment">Amendment (change amount and/or end date)</SelectItem>
                    <SelectItem value="supplement">Supplement (additional funds)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label={kind === 'supplement' ? 'Additional amount (USD)' : 'Change in amount (USD)'}
                htmlFor={`${ids}-amt`}
                required
                description={kind === 'amendment' ? 'Use a minus sign to reduce, e.g. -2,500.' : undefined}
                error={error ?? undefined}
              >
                <Input id={`${ids}-amt`} inputMode="decimal" className="tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              {kind === 'amendment' ? (
                <Field label="New end date" htmlFor={`${ids}-end`} optional description={`Currently ${formatDateOnly(currentEndDate)}`}>
                  <Input id={`${ids}-end`} type="date" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
                </Field>
              ) : null}
            </div>
            <Field label="Reason" htmlFor={`${ids}-reason`} required>
              <Textarea id={`${ids}-reason`} rows={2} maxLength={5000} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="outline" pending={pending} pendingLabel="Drafting…">
                <FilePlus2 aria-hidden="true" /> Draft {kind}
              </Button>
              {cents ? <span className="text-sm text-muted-foreground tabular-nums">{cents > 0 ? `Adds ${formatMoney(cents)}` : `Reduces by ${formatMoney(-cents)}`}</span> : null}
            </div>
          </form>
        ) : !awardId ? (
          <p className="text-sm text-muted-foreground">Preview: there is no active award yet, so changes can’t be drafted.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
