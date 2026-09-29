// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// P-05 table: every payment with its status (incl. "Awaiting bank approval (Mercury)"), failed payments
// with the next step and Retry, URL filters and server-side pagination.
import { formatDateOnly, PAYMENT_METHOD_LABELS, PAYMENT_STATUS, type PaymentMethod } from '@gms/domain';
import { Button, DataTable, EmptyState, MoneyDisplay, StatusChip, type ColumnDefFor } from '@gms/ui';
import { RotateCw } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { retryPaymentAction } from '@/app/console/(app)/payments/actions';
import { FeedbackRegion, UrlFilterSelect, useRunner, useUrlPagination, useUrlParams } from './client-utils';

export interface PaymentRow {
  id: string;
  awardId: string;
  awardReference: string;
  grantee: string;
  amountCents: number;
  currency: string;
  method: string;
  rail: string;
  status: string;
  failureReason: string | null;
  holdReason: string | null;
  batchId: string | null;
  batchName: string | null;
  requestedAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

function nextStep(r: PaymentRow): string | null {
  if (r.status === 'failed') {
    const why = (r.failureReason ?? '').toLowerCase();
    if (why.includes('recipient') || why.includes('payee')) return 'Check the grantee’s payee onboarding, then retry.';
    if (why.includes('rejected') || why.includes('cancelled')) return 'The request was declined in Mercury. Confirm with your approver, then retry.';
    if (why.includes('insufficient')) return 'Add funds to the account, then retry.';
    return 'Retry puts the installment back on the schedule for the next batch.';
  }
  if (r.status === 'awaiting_bank_approval') return 'Waiting for a person to approve the request in Mercury.';
  if (r.status === 'held') return r.holdReason ? `On hold: ${r.holdReason}` : 'On hold.';
  if (r.status === 'exception') return 'Resolve it on the Exceptions page.';
  return null;
}

export function RetryPaymentButton({ id }: { id: string }) {
  const { run, pending, feedback } = useRunner();
  return (
    <div className="grid justify-items-end gap-1">
      <Button size="sm" variant="outline" pending={pending} pendingLabel="Retrying…" onClick={() => run(() => retryPaymentAction(id), () => ({ variant: 'success', title: 'Ready to batch again.' }))}>
        <RotateCw aria-hidden="true" /> Retry
      </Button>
      <FeedbackRegion feedback={feedback} className="max-w-xs text-left" />
    </div>
  );
}

export function PaymentsTable({
  rows,
  total,
  page,
  pageSize,
  filters,
  batches,
  canWrite,
}: {
  rows: PaymentRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: { status?: string; method?: string; batch?: string; q?: string };
  batches: { id: string; name: string }[];
  canWrite: boolean;
}) {
  const { pagination, onPaginationChange, loading } = useUrlPagination(page, pageSize);
  const { set } = useUrlParams();
  const columns = React.useMemo<ColumnDefFor<PaymentRow>[]>(
    () => [
      {
        id: 'grant',
        header: 'Grant',
        enableSorting: false,
        meta: { alwaysVisible: true },
        cell: ({ row }) => (
          <div className="grid">
            <Link href={`/console/payments/${row.original.id}`} className="font-medium hover:underline">
              {row.original.awardReference}
            </Link>
            <span className="max-w-56 truncate text-xs text-muted-foreground">{row.original.grantee}</span>
          </div>
        ),
      },
      {
        id: 'amount',
        header: 'Amount',
        enableSorting: false,
        meta: { align: 'right' },
        cell: ({ row }) => <MoneyDisplay cents={row.original.amountCents} currency={row.original.currency} />,
      },
      {
        id: 'method',
        header: 'Method',
        enableSorting: false,
        cell: ({ row }) => PAYMENT_METHOD_LABELS[row.original.method as PaymentMethod] ?? row.original.method,
      },
      {
        id: 'status',
        header: 'Status',
        enableSorting: false,
        cell: ({ row }) => {
          const step = nextStep(row.original);
          return (
            <div className="grid max-w-80 gap-1">
              <StatusChip kind="payment" value={row.original.status} size="sm" />
              {row.original.status === 'failed' && row.original.failureReason ? <span className="text-xs text-status-danger-fg">{row.original.failureReason}</span> : null}
              {step ? <span className="text-xs text-muted-foreground">{step}</span> : null}
            </div>
          );
        },
      },
      {
        id: 'batch',
        header: 'Batch',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.batchId ? (
            <Link href={`/console/payments/batches/${row.original.batchId}`} className="hover:underline">
              {row.original.batchName}
            </Link>
          ) : row.original.rail === 'manual' ? (
            <span className="text-muted-foreground">Recorded</span>
          ) : (
            '—'
          ),
      },
      {
        id: 'dates',
        header: 'Sent',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.sentAt ? formatDateOnly(row.original.sentAt) : row.original.requestedAt ? <span className="text-muted-foreground">Requested {formatDateOnly(row.original.requestedAt)}</span> : '—',
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        meta: { align: 'right', label: 'Actions', alwaysVisible: true },
        cell: ({ row }) => (canWrite && row.original.status === 'failed' ? <RetryPaymentButton id={row.original.id} /> : null),
      },
    ],
    [canWrite],
  );
  return (
    <DataTable
      caption="Payments"
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      mode="server"
      pagination={pagination}
      onPaginationChange={onPaginationChange}
      pageCount={Math.max(1, Math.ceil(total / pageSize))}
      totalRows={total}
      loading={loading}
      globalFilter={filters.q ?? ''}
      onGlobalFilterChange={(q) => set({ q })}
      searchPlaceholder="Grant reference or grantee"
      searchLabel="Search payments"
      itemLabel="payments"
      toolbar={
        <>
          <UrlFilterSelect param="status" label="Status" value={filters.status} options={Object.entries(PAYMENT_STATUS).map(([value, m]) => ({ value, label: m.label }))} />
          <UrlFilterSelect param="method" label="Method" value={filters.method} options={Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label }))} />
          {batches.length ? <UrlFilterSelect param="batch" label="Batch" value={filters.batch} options={batches.map((b) => ({ value: b.id, label: b.name }))} /> : null}
        </>
      }
      emptyState={
        <EmptyState
          level={3}
          title={filters.status || filters.method || filters.batch || filters.q ? 'No payments match' : 'No payments yet'}
          description={filters.status || filters.method || filters.batch || filters.q ? 'Try a different filter.' : 'Payments appear here once a batch is built or a payment is recorded.'}
        />
      }
    />
  );
}
