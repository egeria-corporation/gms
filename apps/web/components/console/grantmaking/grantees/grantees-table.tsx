// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// C-08 grantee list: organizations that applied to this workspace, server-paged with URL state.
import { Badge, CheckboxField, EmptyState, Field, MoneyDisplay, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusChip, type ColumnDefFor } from '@gms/ui';
import Link from 'next/link';
import { useMemo } from 'react';
import { UrlDataTable, useUrlParams, type UrlTableState } from '../url-data-table';

export interface GranteeRow {
  id: string;
  name: string;
  legalName: string;
  ein: string | null;
  applications: number;
  activeAwards: number;
  awardedCents: number;
  latestStatus: string | null;
  diligence: string | null;
  screening: string | null;
  tags: string[];
  owner: string | null;
}

const ALL = 'all';

function Filters({ tags, tag, active }: { tags: string[]; tag: string; active: boolean }) {
  const { set } = useUrlParams();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Field label="Filter by tag" htmlFor="gr-tag" hideLabel>
        <Select value={tag || ALL} onValueChange={(v) => set({ tag: v === ALL ? null : v }, { resetPage: true })}>
          <SelectTrigger id="gr-tag" size="sm" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All tags</SelectItem>
            {tags.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <CheckboxField label="Has an active award" checked={active} onCheckedChange={(v) => set({ active: v === true ? '1' : null }, { resetPage: true })} />
    </div>
  );
}

export function GranteesTable({ rows, state, totalRows, tags, tag, active }: { rows: GranteeRow[]; state: UrlTableState; totalRows: number; tags: string[]; tag: string; active: boolean }) {
  const columns = useMemo<ColumnDefFor<GranteeRow>[]>(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: 'Organization',
        meta: { alwaysVisible: true },
        cell: ({ row }) => (
          <Link href={`/console/grantees/${row.original.id}`} className="font-medium hover:underline">
            {row.original.name}
            {row.original.name !== row.original.legalName ? <span className="block text-xs font-normal text-muted-foreground">{row.original.legalName}</span> : null}
          </Link>
        ),
      },
      { id: 'ein', accessorKey: 'ein', header: 'EIN', enableSorting: false, cell: ({ row }) => <span className="font-mono text-xs">{row.original.ein ?? '—'}</span> },
      { id: 'applications', accessorKey: 'applications', header: 'Applications', meta: { align: 'right' } },
      { id: 'active', accessorKey: 'activeAwards', header: 'Active awards', meta: { align: 'right' } },
      { id: 'awarded', accessorKey: 'awardedCents', header: 'Total awarded', meta: { align: 'right' }, cell: ({ row }) => <MoneyDisplay cents={row.original.awardedCents} /> },
      { id: 'latest', accessorKey: 'latestStatus', header: 'Latest application', enableSorting: false, cell: ({ row }) => (row.original.latestStatus ? <StatusChip kind="application" value={row.original.latestStatus} size="sm" /> : '—') },
      {
        id: 'diligence',
        header: 'Diligence',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.diligence || row.original.screening ? (
            <span className="flex flex-wrap gap-1">
              {row.original.diligence ? <StatusChip kind="diligence" value={row.original.diligence} size="sm" /> : null}
              {row.original.screening ? <StatusChip kind="screening" value={row.original.screening} size="sm" /> : null}
            </span>
          ) : (
            <span className="text-muted-foreground">Not run</span>
          ),
      },
      {
        id: 'tags',
        header: 'Tags',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            {row.original.tags.map((t) => (
              <Badge key={t} variant="outline">
                {t}
              </Badge>
            ))}
          </span>
        ),
      },
      { id: 'owner', accessorKey: 'owner', header: 'Relationship owner', enableSorting: false, cell: ({ row }) => row.original.owner ?? <span className="text-muted-foreground">Unassigned</span> },
    ],
    [],
  );
  return (
    <UrlDataTable<GranteeRow>
      caption="Grantees and applicant organizations"
      itemLabel="organizations"
      columns={columns}
      data={rows}
      state={state}
      totalRows={totalRows}
      getRowId={(r) => r.id}
      searchPlaceholder="Name or EIN"
      searchLabel="Search organizations"
      toolbar={<Filters tags={tags} tag={tag} active={active} />}
      emptyState={<EmptyState level={3} title="No organizations match" description="Try a different search or clear the filters." />}
    />
  );
}
