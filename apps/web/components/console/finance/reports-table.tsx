// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// PA-01 table: report requirements (overdue first) with status, the per-report payment-hold switch and the
// award hold control.
import { formatDateOnly, REPORT_STATUS } from '@gms/domain';
import { Badge, DataTable, EmptyState, StatusChip, type ColumnDefFor } from '@gms/ui';
import Link from 'next/link';
import * as React from 'react';
import { AwardHoldControl, ReportHoldSwitch } from './award-hold';
import { UrlFilterSelect, useUrlPagination, useUrlParams } from './client-utils';

export interface ReportRow {
  id: string;
  title: string;
  kind: string;
  dueDate: string;
  status: string;
  holdsPayments: boolean;
  awardId: string;
  awardReference: string;
  grantee: string;
  program: string | null;
  awardOnHold: boolean;
  holdReason: string | null;
  daysLate: number;
}

const KIND_LABEL: Record<string, string> = { interim: 'Interim', final: 'Final', financial: 'Financial', narrative: 'Narrative' };

export function ReportsTable({
  rows,
  total,
  page,
  pageSize,
  filters,
  programs,
  canWriteReports,
  canHoldAwards,
}: {
  rows: ReportRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: { status?: string; program?: string; q?: string };
  programs: { id: string; name: string }[];
  canWriteReports: boolean;
  canHoldAwards: boolean;
}) {
  const { pagination, onPaginationChange, loading } = useUrlPagination(page, pageSize);
  const { set } = useUrlParams();
  const columns = React.useMemo<ColumnDefFor<ReportRow>[]>(
    () => [
      {
        id: 'report',
        header: 'Report',
        enableSorting: false,
        meta: { alwaysVisible: true },
        cell: ({ row }) => (
          <div className="grid">
            <Link href={`/console/reports/${row.original.id}`} className="font-medium hover:underline">
              {row.original.title}
            </Link>
            <span className="text-xs text-muted-foreground">{KIND_LABEL[row.original.kind] ?? row.original.kind}</span>
          </div>
        ),
      },
      {
        id: 'grant',
        header: 'Grant',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="grid">
            <Link href={`/console/awards/${row.original.awardId}`} className="hover:underline">
              {row.original.awardReference}
            </Link>
            <span className="max-w-56 truncate text-xs text-muted-foreground">{row.original.grantee}</span>
          </div>
        ),
      },
      { id: 'program', header: 'Program', enableSorting: false, cell: ({ row }) => row.original.program ?? '—' },
      {
        id: 'due',
        header: 'Due',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="grid whitespace-nowrap">
            {formatDateOnly(row.original.dueDate)}
            {row.original.status === 'overdue' && row.original.daysLate > 0 ? <span className="text-xs text-status-danger-fg">{row.original.daysLate} days late</span> : null}
          </div>
        ),
      },
      { id: 'status', header: 'Status', enableSorting: false, cell: ({ row }) => <StatusChip kind="report" value={row.original.status} size="sm" /> },
      {
        id: 'hold',
        header: 'Report hold',
        enableSorting: false,
        meta: { label: 'Report hold' },
        cell: ({ row }) => <ReportHoldSwitch requirementId={row.original.id} title={row.original.title} holdsPayments={row.original.holdsPayments} canWrite={canWriteReports} />,
      },
      {
        id: 'award',
        header: 'Award hold',
        enableSorting: false,
        meta: { label: 'Award hold' },
        cell: ({ row }) => (
          <div className="grid justify-items-start gap-1">
            {row.original.awardOnHold ? <StatusChip kind="awardFlag" value="on_hold" size="sm" /> : <Badge variant="muted">Paying normally</Badge>}
            <AwardHoldControl awardId={row.original.awardId} reference={row.original.awardReference} onHold={row.original.awardOnHold} reason={row.original.holdReason} canWrite={canHoldAwards} />
          </div>
        ),
      },
    ],
    [canWriteReports, canHoldAwards],
  );
  return (
    <DataTable
      caption="Report requirements"
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
      searchLabel="Search reports"
      itemLabel="reports"
      toolbar={
        <>
          <UrlFilterSelect param="status" label="Status" value={filters.status} options={Object.entries(REPORT_STATUS).map(([value, m]) => ({ value, label: m.label }))} />
          {programs.length ? <UrlFilterSelect param="program" label="Program" value={filters.program} options={programs.map((p) => ({ value: p.id, label: p.name }))} /> : null}
        </>
      }
      emptyState={
        <EmptyState
          level={3}
          title={filters.status || filters.program || filters.q ? 'No reports match' : 'No reports due yet'}
          description={filters.status || filters.program || filters.q ? 'Try a different filter.' : 'Activating an award creates its interim and final report requirements.'}
        />
      }
    />
  );
}
