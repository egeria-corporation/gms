// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// C-03 opportunities table (server mode, state in the URL) with status and program filters.
import { OPPORTUNITY_STATUS, formatInZone, type OpportunityStatus } from '@gms/domain';
import {
  Badge,
  Button,
  DeadlineChip,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusChip,
  type ColumnDefFor,
} from '@gms/ui';
import { Filter, X } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { UrlDataTable, useUrlParams, type UrlTableState } from '../url-data-table';

export interface OpportunityRow {
  id: string;
  title: string;
  slug: string;
  status: string;
  visibility: string;
  programName: string | null;
  opensAt: string | null;
  closesAt: string | null;
  forecastAt: string | null;
  apps: number;
  submitted: number;
}

const ALL = '__all__';

export function OpportunitiesTable({
  rows,
  total,
  state,
  timeZone,
  programs,
  statuses,
  programId,
}: {
  rows: OpportunityRow[];
  total: number;
  state: UrlTableState;
  timeZone: string;
  programs: { id: string; name: string }[];
  statuses: string[];
  programId: string | null;
}) {
  const { set } = useUrlParams();
  const columns = useMemo<ColumnDefFor<OpportunityRow>[]>(
    () => [
      {
        id: 'title',
        accessorKey: 'title',
        header: 'Opportunity',
        meta: { alwaysVisible: true },
        cell: ({ row }) => (
          <div className="grid">
            <Link href={`/console/opportunities/${row.original.id}`} className="font-medium hover:underline">
              {row.original.title}
            </Link>
            <span className="text-xs text-muted-foreground">
              /{row.original.slug}
              {row.original.visibility === 'unlisted' ? ' · Unlisted' : ''}
            </span>
          </div>
        ),
      },
      { id: 'status', accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusChip kind="opportunity" value={row.original.status} size="sm" /> },
      { id: 'program', accessorKey: 'programName', header: 'Program', cell: ({ row }) => row.original.programName ?? <span className="text-muted-foreground">No program</span> },
      {
        id: 'opens',
        accessorKey: 'opensAt',
        header: 'Opens',
        cell: ({ row }) => <span className="whitespace-nowrap">{formatInZone(row.original.opensAt, timeZone)}</span>,
      },
      {
        id: 'closes',
        accessorKey: 'closesAt',
        header: 'Closes',
        cell: ({ row }) => {
          const r = row.original;
          if (!r.closesAt) return <span className="text-muted-foreground">Not set</span>;
          if (r.status === 'open' || r.status === 'forecasted') return <DeadlineChip at={r.closesAt} timeZone={timeZone} label="Closes" size="sm" />;
          return <span className="whitespace-nowrap">{formatInZone(r.closesAt, timeZone)}</span>;
        },
      },
      {
        id: 'apps',
        accessorKey: 'apps',
        header: 'Applications',
        meta: { align: 'right' },
        cell: ({ row }) => (
          <Link href={`/console/pipeline?opportunity=${row.original.id}`} className="tabular-nums hover:underline">
            {row.original.apps}
            <span className="text-xs text-muted-foreground"> · {row.original.submitted} submitted</span>
          </Link>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        meta: { label: 'Actions', alwaysVisible: true, align: 'right' },
        cell: ({ row }) => (
          <Button asChild variant="ghost" size="sm">
            <Link href={`/console/opportunities/${row.original.id}/publish`}>
              {row.original.status === 'draft' ? 'Review & publish' : 'Lifecycle'}
              <span className="sr-only"> for {row.original.title}</span>
            </Link>
          </Button>
        ),
      },
    ],
    [timeZone],
  );

  const toggleStatus = (s: string, on: boolean) => {
    const next = on ? [...new Set([...statuses, s])] : statuses.filter((x) => x !== s);
    set({ status: next.join(',') || null }, { resetPage: true });
  };

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Filter aria-hidden="true" />
            Status
            {statuses.length ? <Badge variant="neutral">{statuses.length}</Badge> : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Show statuses</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {(Object.keys(OPPORTUNITY_STATUS) as OpportunityStatus[]).map((s) => (
            <DropdownMenuCheckboxItem key={s} checked={statuses.includes(s)} onCheckedChange={(v) => toggleStatus(s, v === true)} onSelect={(e) => e.preventDefault()}>
              {OPPORTUNITY_STATUS[s].label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <label htmlFor="opp-program-filter" className="sr-only">
        Program
      </label>
      <Select value={programId ?? ALL} onValueChange={(v) => set({ program: v === ALL ? null : v }, { resetPage: true })}>
        <SelectTrigger id="opp-program-filter" size="sm" className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All programs</SelectItem>
          {programs.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {statuses.length || programId ? (
        <Button variant="ghost" size="sm" onClick={() => set({ status: null, program: null }, { resetPage: true })}>
          <X aria-hidden="true" /> Clear filters
        </Button>
      ) : null}
    </div>
  );

  return (
    <UrlDataTable<OpportunityRow>
      caption="Opportunities"
      columns={columns}
      data={rows}
      state={state}
      totalRows={total}
      getRowId={(r) => r.id}
      getRowLabel={(r) => r.title}
      itemLabel="opportunities"
      searchPlaceholder="Search by title"
      toolbar={toolbar}
    />
  );
}
