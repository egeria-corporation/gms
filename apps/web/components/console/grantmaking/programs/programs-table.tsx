// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// C-02 program list: budget, committed, paid and remaining for the selected fiscal year.
import { DataTable, MoneyDisplay, Progress, ToneChip, type ColumnDefFor } from '@gms/ui';
import { Archive, CircleDot, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';

export interface ProgramRow {
  id: string;
  name: string;
  status: string;
  causeArea: string | null;
  leadName: string | null;
  budgetCents: number | null;
  committedCents: number;
  paidCents: number;
  pendingCents: number;
  opportunities: number;
}

export function ProgramsTable({ rows, fiscalYear }: { rows: ProgramRow[]; fiscalYear: number }) {
  const columns = useMemo<ColumnDefFor<ProgramRow>[]>(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: 'Program',
        meta: { alwaysVisible: true },
        cell: ({ row }) => (
          <div className="grid">
            <Link href={`/console/programs/${row.original.id}`} className="font-medium hover:underline">
              {row.original.name}
            </Link>
            <span className="text-xs text-muted-foreground">{[row.original.causeArea, row.original.leadName ? `Lead: ${row.original.leadName}` : null].filter(Boolean).join(' · ') || '—'}</span>
          </div>
        ),
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) =>
          row.original.status === 'archived' ? <ToneChip tone="muted" icon={Archive} label="Archived" size="sm" /> : <ToneChip tone="success" icon={CircleDot} label="Active" size="sm" />,
      },
      { id: 'budget', accessorKey: 'budgetCents', header: `FY${fiscalYear} budget`, meta: { align: 'right', label: 'Budget' }, cell: ({ row }) => <MoneyDisplay cents={row.original.budgetCents} compact /> },
      { id: 'committed', accessorKey: 'committedCents', header: 'Committed', meta: { align: 'right' }, cell: ({ row }) => <MoneyDisplay cents={row.original.committedCents} compact /> },
      { id: 'paid', accessorKey: 'paidCents', header: 'Paid', meta: { align: 'right' }, cell: ({ row }) => <MoneyDisplay cents={row.original.paidCents} compact /> },
      {
        id: 'remaining',
        accessorFn: (r) => (r.budgetCents === null ? null : r.budgetCents - r.committedCents),
        header: 'Remaining',
        meta: { align: 'right' },
        cell: ({ row }) => {
          const r = row.original;
          if (r.budgetCents === null) return <span className="text-xs text-muted-foreground">No budget set</span>;
          const remaining = r.budgetCents - r.committedCents;
          const pctUsed = r.budgetCents > 0 ? Math.round((r.committedCents / r.budgetCents) * 100) : 0;
          return (
            <div className="grid justify-items-end gap-1">
              <span className="inline-flex items-center gap-1">
                {remaining < 0 ? <TriangleAlert aria-hidden="true" className="size-3.5 text-status-danger-fg" /> : null}
                <MoneyDisplay cents={remaining} compact className={remaining < 0 ? 'text-status-danger-fg' : undefined} />
                {remaining < 0 ? <span className="sr-only">(over budget)</span> : null}
              </span>
              <Progress value={Math.min(100, pctUsed)} label={`${r.name}: ${pctUsed}% of the FY${fiscalYear} budget committed`} className="h-1.5 w-24" indicatorClassName={remaining < 0 ? 'bg-status-danger-fg' : undefined} />
            </div>
          );
        },
      },
      { id: 'pending', accessorKey: 'pendingCents', header: 'Draft awards', meta: { align: 'right' }, cell: ({ row }) => <MoneyDisplay cents={row.original.pendingCents} compact /> },
      { id: 'opportunities', accessorKey: 'opportunities', header: 'Opportunities', meta: { align: 'right' } },
    ],
    [fiscalYear],
  );
  return <DataTable caption={`Programs and FY${fiscalYear} budgets`} columns={columns} data={rows} getRowId={(r) => r.id} itemLabel="programs" searchPlaceholder="Search programs" />;
}
