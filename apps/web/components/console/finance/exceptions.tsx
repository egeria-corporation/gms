// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// P-06 Reconciliation exceptions: the list and the resolve dialog (link to a payment, mark resolved, or ignore,
// always with a note for the audit trail).
import { formatDateOnly, formatMoney } from '@gms/domain';
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  Field,
  FieldSet,
  MoneyDisplay,
  RadioGroup,
  RadioOption,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  ToneChip,
  type ColumnDefFor,
} from '@gms/ui';
import { CircleAlert, CircleCheck, CircleMinus, Scale, Unlink } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { resolveExceptionAction } from '@/app/console/(app)/payments/actions';
import { FeedbackRegion, UrlFilterSelect, useRunner, useUrlPagination } from './client-utils';

export interface ExceptionRow {
  id: string;
  kind: string;
  status: string;
  details: string;
  createdAt: string;
  note: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  tx: { id: string; providerId: string; amountCents: number; counterparty: string | null; postedAt: string | null; memo: string | null } | null;
  payment: { id: string; awardReference: string; amountCents: number; status: string } | null;
}

export interface CandidatePayment {
  id: string;
  awardReference: string;
  grantee: string;
  amountCents: number;
  status: string;
}

const KIND: Record<string, { label: string; icon: typeof Unlink }> = {
  unmatched_transaction: { label: 'Bank transaction with no payment', icon: Unlink },
  unmatched_payment: { label: 'Payment with no bank transaction', icon: CircleAlert },
  amount_mismatch: { label: 'Amounts don’t match', icon: Scale },
  status_mismatch: { label: 'Statuses don’t match', icon: CircleAlert },
};

function ExceptionStatus({ status }: { status: string }) {
  if (status === 'resolved') return <ToneChip tone="success" icon={CircleCheck} label="Resolved" size="sm" />;
  if (status === 'ignored') return <ToneChip tone="muted" icon={CircleMinus} label="Ignored" size="sm" />;
  return <ToneChip tone="danger" icon={CircleAlert} label="Open" size="sm" />;
}

function ResolveDialog({ row, candidates }: { row: ExceptionRow; candidates: CandidatePayment[] }) {
  const canLink = Boolean(row.tx);
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<'link' | 'resolved' | 'ignored'>(canLink && !row.payment ? 'link' : 'resolved');
  const [paymentId, setPaymentId] = React.useState(row.payment?.id ?? '');
  const [note, setNote] = React.useState('');
  const [errors, setErrors] = React.useState<{ note?: string; payment?: string }>({});
  const { run, pending, feedback, setFeedback } = useRunner();
  const ids = { note: React.useId(), payment: React.useId() };
  const target = row.tx ? -row.tx.amountCents : null;
  const sorted = React.useMemo(() => [...candidates].sort((a, b) => Number(b.amountCents === target) - Number(a.amountCents === target)), [candidates, target]);

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
          Resolve
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolve exception</DialogTitle>
          <DialogDescription>{row.details}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const errs: typeof errors = {};
            if (!note.trim()) errs.note = 'Add a note explaining the resolution.';
            if (mode === 'link' && !paymentId) errs.payment = 'Choose the payment this transaction pays.';
            setErrors(errs);
            if (Object.keys(errs).length) return;
            void run(
              () =>
                resolveExceptionAction({
                  exceptionId: row.id,
                  resolution: mode === 'ignored' ? 'ignored' : 'resolved',
                  paymentId: mode === 'link' ? paymentId : undefined,
                  note: note.trim(),
                }),
              () => ({ variant: 'success', title: mode === 'ignored' ? 'Exception ignored.' : 'Exception resolved.' }),
            ).then((ok) => {
              if (ok) setTimeout(() => setOpen(false), 700);
            });
          }}
        >
          <FieldSet legend="What should happen?">
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
              {canLink ? <RadioOption value="link" label="Link the bank transaction to a payment" description="Marks the payment Reconciled." /> : null}
              <RadioOption value="resolved" label="Mark resolved" description={row.payment ? 'The payment is correct as recorded; mark it Reconciled.' : 'Handled outside GMS.'} />
              <RadioOption value="ignored" label="Ignore" description="Not a grant payment (for example, a vendor bill paid from the same account)." />
            </RadioGroup>
          </FieldSet>
          {mode === 'link' ? (
            <Field label="Payment" htmlFor={ids.payment} required error={errors.payment} description={target !== null ? `Payments of ${formatMoney(target)} are listed first.` : undefined}>
              <Select value={paymentId} onValueChange={setPaymentId}>
                <SelectTrigger id={ids.payment}>
                  <SelectValue placeholder="Choose a payment" />
                </SelectTrigger>
                <SelectContent>
                  {sorted.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.awardReference} · {c.grantee} · {formatMoney(c.amountCents)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field label="Note" htmlFor={ids.note} required error={errors.note}>
            <Textarea id={ids.note} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <FeedbackRegion feedback={feedback} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" pending={pending} pendingLabel="Saving…">
              {mode === 'ignored' ? 'Ignore exception' : mode === 'link' ? 'Link and resolve' : 'Mark resolved'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ExceptionsTable({
  rows,
  total,
  page,
  pageSize,
  status,
  candidates,
  canWrite,
}: {
  rows: ExceptionRow[];
  total: number;
  page: number;
  pageSize: number;
  status: string;
  candidates: CandidatePayment[];
  canWrite: boolean;
}) {
  const { pagination, onPaginationChange, loading } = useUrlPagination(page, pageSize);
  const columns = React.useMemo<ColumnDefFor<ExceptionRow>[]>(
    () => [
      {
        id: 'kind',
        header: 'Exception',
        enableSorting: false,
        cell: ({ row }) => {
          const k = KIND[row.original.kind] ?? { label: row.original.kind, icon: CircleAlert };
          return (
            <div className="grid max-w-96 gap-1">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <k.icon aria-hidden="true" className="size-4 text-muted-foreground" /> {k.label}
              </span>
              <span className="text-xs text-muted-foreground">{row.original.details}</span>
              {row.original.note ? <span className="text-xs">Note: “{row.original.note}”</span> : null}
            </div>
          );
        },
      },
      {
        id: 'tx',
        header: 'Bank transaction',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.tx ? (
            <div className="grid text-xs">
              <MoneyDisplay cents={row.original.tx.amountCents} className="text-sm" />
              <span className="text-muted-foreground">
                {row.original.tx.counterparty ?? 'Unknown counterparty'}
                {row.original.tx.postedAt ? ` · ${formatDateOnly(row.original.tx.postedAt)}` : ''}
              </span>
              <code className="text-muted-foreground">{row.original.tx.providerId}</code>
            </div>
          ) : (
            '—'
          ),
      },
      {
        id: 'payment',
        header: 'GMS payment',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.payment ? (
            <div className="grid text-xs">
              <Link href={`/console/payments/${row.original.payment.id}`} className="text-sm font-medium hover:underline">
                {row.original.payment.awardReference}
              </Link>
              <MoneyDisplay cents={row.original.payment.amountCents} />
            </div>
          ) : (
            '—'
          ),
      },
      { id: 'status', header: 'Status', enableSorting: false, cell: ({ row }) => <ExceptionStatus status={row.original.status} /> },
      { id: 'found', header: 'Found', enableSorting: false, cell: ({ row }) => formatDateOnly(row.original.createdAt) },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        meta: { align: 'right', label: 'Actions', alwaysVisible: true },
        cell: ({ row }) => (canWrite && row.original.status === 'open' ? <ResolveDialog row={row.original} candidates={candidates} /> : row.original.status !== 'open' ? <Badge variant="muted">Closed</Badge> : null),
      },
    ],
    [canWrite, candidates],
  );
  return (
    <DataTable
      caption="Reconciliation exceptions"
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      mode="server"
      pagination={pagination}
      onPaginationChange={onPaginationChange}
      pageCount={Math.max(1, Math.ceil(total / pageSize))}
      totalRows={total}
      loading={loading}
      searchable={false}
      itemLabel="exceptions"
      toolbar={
        <UrlFilterSelect
          param="status"
          label="Status"
          value={status}
          includeAll={false}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'ignored', label: 'Ignored' },
            { value: 'any', label: 'Any status' },
          ]}
        />
      }
      emptyState={<EmptyState level={3} title={status === 'open' ? 'No open exceptions' : 'No exceptions'} description="Nightly reconciliation matches bank transactions to payments. Anything it can’t match shows up here." />}
    />
  );
}
