// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// DataTable in server mode with its state in the URL: `page`, `size`, `sort`, `dir`, `q`, `hide`
// (hidden columns; `none` = show all) and `density`. The page (a Server Component) reads the same params with
// `tableParams()` from lib/grantmaking-data and queries under RLS.
import { DataTable, type ColumnDefFor, type DataTableProps, type RowSelectionState, type TableDensity, type VisibilityState } from '@gms/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

export interface UrlTableState {
  page: number;
  pageSize: number;
  sort: string;
  dir: 'asc' | 'desc';
  q: string;
}

export type UrlDataTableProps<T> = Omit<
  DataTableProps<T>,
  | 'mode'
  | 'pagination'
  | 'onPaginationChange'
  | 'pageCount'
  | 'sorting'
  | 'onSortingChange'
  | 'globalFilter'
  | 'onGlobalFilterChange'
  | 'columnVisibility'
  | 'onColumnVisibilityChange'
  | 'density'
  | 'onDensityChange'
  | 'columns'
  | 'rowSelection'
  | 'onRowSelectionChange'
  | 'loading'
> & {
  columns: ColumnDefFor<T>[];
  state: UrlTableState;
  totalRows: number;
  /** Column ids hidden by default (the URL `hide` param overrides). */
  defaultHidden?: string[];
};

/** Returns a function that merges params into the current URL and navigates (replace, no scroll). */
export function useUrlParams() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (patch: Record<string, string | null | undefined>, opts: { resetPage?: boolean } = {}) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (opts.resetPage) next.delete('page');
    const qs = next.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  return { set, pending, params: sp, pathname };
}

export function UrlDataTable<T>({ columns, state, totalRows, defaultHidden = [], ...rest }: UrlDataTableProps<T>) {
  const { set, pending, params } = useUrlParams();
  const [selection, setSelection] = useState<RowSelectionState>({});
  const hideParam = params.get('hide');
  const defaultKey = defaultHidden.join(',');
  const visibility = useMemo<VisibilityState>(() => {
    const hidden = hideParam === 'none' ? [] : hideParam !== null ? hideParam.split(',') : defaultKey.split(',');
    return Object.fromEntries(hidden.filter(Boolean).map((h) => [h, false]));
  }, [hideParam, defaultKey]);
  const density = (params.get('density') as TableDensity | null) ?? 'compact';
  return (
    <DataTable<T>
      {...rest}
      mode="server"
      columns={columns}
      loading={pending}
      totalRows={totalRows}
      pageCount={Math.max(1, Math.ceil(totalRows / state.pageSize))}
      pagination={{ pageIndex: state.page - 1, pageSize: state.pageSize }}
      onPaginationChange={(p) => {
        setSelection({});
        set({ page: p.pageIndex > 0 ? String(p.pageIndex + 1) : null, size: String(p.pageSize) });
      }}
      sorting={[{ id: state.sort, desc: state.dir === 'desc' }]}
      onSortingChange={(s) => {
        const first = s[0];
        set({ sort: first?.id ?? null, dir: first ? (first.desc ? 'desc' : 'asc') : null }, { resetPage: true });
      }}
      globalFilter={state.q}
      onGlobalFilterChange={(q) => set({ q }, { resetPage: true })}
      columnVisibility={visibility}
      onColumnVisibilityChange={(v) => {
        const nextHidden = Object.entries({ ...visibility, ...v })
          .filter(([, on]) => on === false)
          .map(([k]) => k);
        set({ hide: nextHidden.join(',') || (defaultHidden.length ? 'none' : null) });
      }}
      density={density}
      onDensityChange={(d) => set({ density: d === 'compact' ? null : d })}
      rowSelection={selection}
      onRowSelectionChange={setSelection}
    />
  );
}
