// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// Interactive demos for DS-02 (anything that needs state or function props).
import { formatDateOnly } from '@gms/domain';
import {
  Button,
  CountyMap,
  DataTable,
  MoneyDisplay,
  Pagination,
  StatusChip,
  toast,
  type ColumnDefFor,
} from '@gms/ui';
import * as React from 'react';
import { COUNTY_VIEWBOX, DEMO_APPLICATIONS, DEMO_COUNTIES, type DemoApplication } from './fixtures';

const columns: ColumnDefFor<DemoApplication>[] = [
  { accessorKey: 'org', header: 'Organization', meta: { alwaysVisible: true } },
  { accessorKey: 'project', header: 'Project' },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => <StatusChip kind="application" value={row.original.status} size="sm" />,
  },
  { accessorKey: 'county', header: 'County' },
  {
    accessorKey: 'requestedCents',
    header: 'Requested',
    meta: { align: 'right' },
    cell: ({ row }) => <MoneyDisplay cents={row.original.requestedCents} compact />,
  },
  {
    accessorKey: 'submittedAt',
    header: 'Submitted',
    cell: ({ row }) => formatDateOnly(row.original.submittedAt.slice(0, 10)),
  },
];

export function DataTableDemo() {
  return (
    <DataTable
      caption="Sample applications"
      columns={columns}
      data={DEMO_APPLICATIONS}
      mode="client"
      getRowId={(r) => r.id}
      getRowLabel={(r) => r.org}
      enableRowSelection
      pageSizeOptions={[5, 10, 25]}
      itemLabel="applications"
      searchPlaceholder="Search organizations or projects"
      bulkActions={(selected, clear) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            toast.success(
              `Assigned ${selected.length} ${selected.length === 1 ? 'application' : 'applications'} to Priya Natarajan (demo).`,
            );
            clear();
          }}
        >
          Assign reviewer
        </Button>
      )}
      maxHeight="28rem"
    />
  );
}

export function CountyMapDemo() {
  const totals = React.useMemo(() => {
    const byCounty = new Map<string, number>();
    for (const a of DEMO_APPLICATIONS)
      if (a.status === 'awarded' || a.status === 'under_review')
        byCounty.set(a.county, (byCounty.get(a.county) ?? 0) + a.requestedCents);
    return byCounty;
  }, []);
  const [selected, setSelected] = React.useState<string | null>('bramble');
  const regions = DEMO_COUNTIES.map((c) => ({
    ...c,
    value: totals.get(c.name.replace(' County', '')) ?? null,
  }));
  const current = regions.find((r) => r.id === selected);
  return (
    <div className="grid gap-2">
      <CountyMap
        title="Funding under review or awarded, by county"
        description="Three fictional counties. Select a county to see its total."
        regions={regions}
        viewBox={COUNTY_VIEWBOX}
        valueLabel="Amount"
        valueFormat="money"
        steps={3}
        selectedId={selected}
        onSelect={setSelected}
        className="max-w-md"
      />
      <p className="text-sm" aria-live="polite">
        {current ? (
          <>
            <span className="font-medium">{current.name}:</span>{' '}
            {current.value === null ? 'No data' : <MoneyDisplay cents={current.value} compact />}
          </>
        ) : (
          'No county selected.'
        )}
      </p>
    </div>
  );
}

export function PaginationDemo() {
  const [page, setPage] = React.useState(4);
  return (
    <Pagination
      page={page}
      pageCount={13}
      onPageChange={setPage}
      total={312}
      pageSize={25}
      itemLabel="applications"
    />
  );
}

export function ToastDemo() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => toast.success('Branding saved.')}>
        Show success toast
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => toast.error('We couldn’t save your changes. Try again.')}
      >
        Show error toast
      </Button>
    </div>
  );
}
