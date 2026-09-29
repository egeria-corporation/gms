// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// Awards list: status + flag chips (Agreement pending, On hold, Report overdue), amounts, URL filters, paging.
import { AWARD_FLAGS, AWARD_STATUS, formatDateOnly } from '@gms/domain';
import { DataTable, EmptyState, MoneyDisplay, StatusChip, type ColumnDefFor } from '@gms/ui';
import Link from 'next/link';
import * as React from 'react';
import { UrlFilterSelect, useUrlPagination, useUrlParams } from './client-utils';

export interface AwardRow {
  id: string;
  reference: string;
  title: string;
  grantee: string;
  program: string | null;
  amountCents: number;
  totalCents: number;
  disbursedCents: number;
  currency: string;
  status: string;
  agreementPending: boolean;
  onHold: boolean;
  reportOverdue: boolean;
  startDate: string | null;
  endDate: string | null;
}

export function AwardsTable({
  rows,
  total,
  page,
  pageSize,
  filters,
  programs,
}: {
  rows: AwardRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: { status?: string; flag?: string; program?: string; q?: string };
  programs: { id: string; name: string }[];
}) {
  const { pagination, onPaginationChange, loading } = useUrlPagination(page, pageSize);
  const { set } = useUrlParams();
  const columns = React.useMemo<ColumnDefFor<AwardRow>[]>(
    () => [
      {
        id: 'award',
        header: 'Award',
        enableSorting: false,
        meta: { alwaysVisible: true },
        cell: ({ row }) => (
          <div className="grid max-w-80">
            <Link href={`/console/awards/${row.original.id}`} className="font-medium hover:underline">
              {row.original.reference}
            </Link>
            <span className="truncate text-xs text-muted-foreground">{row.original.title}</span>
          </div>
        ),
      },
      { id: 'grantee', header: 'Grantee', enableSorting: false, cell: ({ row }) => <span className="block max-w-56 truncate">{row.original.grantee}</span> },
      { id: 'program', header: 'Program', enableSorting: false, cell: ({ row }) => row.original.program ?? '—' },
      {
        id: 'amount',
        header: 'Awarded',
        enableSorting: false,
        meta: { align: 'right' },
        cell: ({ row }) => (
          <div className="grid justify-items-end">
            <MoneyDisplay cents={row.original.totalCents} currency={row.original.currency} />
            {row.original.totalCents !== row.original.amountCents ? <span className="text-xs text-muted-foreground">incl. amendments</span> : null}
          </div>
        ),
      },
      {
        id: 'paid',
        header: 'Paid',
        enableSorting: false,
        meta: { align: 'right' },
        cell: ({ row }) => <MoneyDisplay cents={row.original.disbursedCents} currency={row.original.currency} />,
      },
      {
        id: 'status',
        header: 'Status',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex max-w-72 flex-wrap gap-1">
            <StatusChip kind="award" value={row.original.status} size="sm" />
            {row.original.status === 'active' && row.original.agreementPending ? <StatusChip kind="awardFlag" value="agreement_pending" size="sm" /> : null}
            {row.original.onHold ? <StatusChip kind="awardFlag" value="on_hold" size="sm" /> : null}
            {row.original.reportOverdue ? <StatusChip kind="awardFlag" value="report_overdue" size="sm" /> : null}
          </div>
        ),
      },
      {
        id: 'period',
        header: 'Period',
        enableSorting: false,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{row.original.startDate ? `${formatDateOnly(row.original.startDate)} – ${formatDateOnly(row.original.endDate)}` : '—'}</span>,
      },
    ],
    [],
  );
  const filtered = Boolean(filters.status || filters.flag || filters.program || filters.q);
  return (
    <DataTable
      caption="Awards"
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
      searchPlaceholder="Reference, title or grantee"
      searchLabel="Search awards"
      itemLabel="awards"
      toolbar={
        <>
          <UrlFilterSelect param="status" label="Status" value={filters.status} options={Object.entries(AWARD_STATUS).map(([value, m]) => ({ value, label: m.label }))} />
          <UrlFilterSelect param="flag" label="Flag" value={filters.flag} allLabel="Any" options={Object.entries(AWARD_FLAGS).map(([value, m]) => ({ value, label: m.label }))} />
          {programs.length ? <UrlFilterSelect param="program" label="Program" value={filters.program} options={programs.map((p) => ({ value: p.id, label: p.name }))} /> : null}
        </>
      }
      emptyState={<EmptyState level={3} title={filtered ? 'No awards match' : 'No awards yet'} description={filtered ? 'Try a different filter.' : 'Awards are created when a final decision approves an application.'} />}
    />
  );
}
