// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type OnChangeFn,
  type PaginationState,
  type Row,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type Updater,
  type VisibilityState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, Search, SlidersHorizontal, X } from 'lucide-react';
import * as React from 'react';
import { Button } from '../components/button';
import { Checkbox } from '../components/checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/dropdown-menu';
import { Input } from '../components/input';
import { Pagination } from '../components/pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/select';
import { Skeleton } from '../components/skeleton';
import { cn } from '../lib/utils';
import { EmptyState } from './states';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- must match TanStack's generic signature
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Right-align numbers and money. */
    align?: 'left' | 'right' | 'center';
    /** Plain-text name for the column chooser and sort labels (when the header isn't a string). */
    label?: string;
    headerClassName?: string;
    cellClassName?: string;
    /** Can't be hidden in the column chooser. */
    alwaysVisible?: boolean;
  }
}

export type TableDensity = 'compact' | 'comfortable';

/** Column definition type DataTable expects: `const columns: ColumnDefFor<Row>[] = [...]`. */
export type ColumnDefFor<TData> = ColumnDef<TData, unknown>;
export type { ColumnDef, ColumnFiltersState, PaginationState, RowSelectionState, SortingState, VisibilityState };

export interface DataTableProps<TData> {
  /** Accessible name for the table, e.g. "Applications". */
  caption: string;
  /** Define as `ColumnDef<Row, unknown>[]`; use `getValue<string>()` in cells. */
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  getRowId?: (row: TData, index: number) => string;
  /** Short name for a row, used in checkbox labels ("Select Riverbend Food Pantry"). */
  getRowLabel?: (row: TData) => string;

  /** 'server': you page/sort/filter via the callbacks. 'client': the table does it in memory. */
  mode?: 'server' | 'client';
  pagination?: PaginationState;
  onPaginationChange?: (next: PaginationState) => void;
  /** Server mode: total pages. */
  pageCount?: number;
  /** Server mode: total rows (for "1–25 of 312"). */
  totalRows?: number;
  pageSizeOptions?: number[];
  sorting?: SortingState;
  onSortingChange?: (next: SortingState) => void;
  globalFilter?: string;
  onGlobalFilterChange?: (next: string) => void;
  columnFilters?: ColumnFiltersState;
  onColumnFiltersChange?: (next: ColumnFiltersState) => void;
  /** Show the search box. Default true when onGlobalFilterChange is set or in client mode. */
  searchable?: boolean;
  searchPlaceholder?: string;
  searchLabel?: string;

  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (next: VisibilityState) => void;
  density?: TableDensity;
  onDensityChange?: (next: TableDensity) => void;

  enableRowSelection?: boolean | ((row: Row<TData>) => boolean);
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (next: RowSelectionState) => void;
  /** Rendered in the bulk-action bar when rows are selected. */
  bulkActions?: (selected: TData[], clearSelection: () => void) => React.ReactNode;

  /** Filters and other controls, rendered next to the search box. */
  toolbar?: React.ReactNode;
  loading?: boolean;
  /** Shown when there are no rows. */
  emptyState?: React.ReactNode;
  /** Max height of the scroll area (the header sticks inside it). Default "70dvh". */
  maxHeight?: string;
  itemLabel?: string;
  className?: string;
}

function useControllable<T>(value: T | undefined, onChange: ((next: T) => void) | undefined, initial: T): [T, OnChangeFn<T>] {
  const [inner, setInner] = React.useState<T>(initial);
  const current = value ?? inner;
  const set = React.useCallback<OnChangeFn<T>>(
    (updater: Updater<T>) => {
      const next = typeof updater === 'function' ? (updater as (old: T) => T)(current) : updater;
      if (value === undefined) setInner(next);
      onChange?.(next);
    },
    [current, value, onChange],
  );
  return [current, set];
}

function columnName<TData>(col: { id: string; columnDef: ColumnDef<TData, unknown> }): string {
  const meta = col.columnDef.meta;
  if (meta?.label) return meta.label;
  return typeof col.columnDef.header === 'string' ? col.columnDef.header : col.id;
}

/**
 * The console's table: server-side pagination/sorting/filtering via controlled props, column chooser,
 * density toggle, row selection with a bulk-action bar, loading and empty states, sticky header.
 */
export function DataTable<TData>({
  caption,
  columns,
  data,
  getRowId,
  getRowLabel,
  mode: modeProp,
  pagination: paginationProp,
  onPaginationChange,
  pageCount,
  totalRows,
  pageSizeOptions = [25, 50, 100],
  sorting: sortingProp,
  onSortingChange,
  globalFilter: filterProp,
  onGlobalFilterChange,
  columnFilters: columnFiltersProp,
  onColumnFiltersChange,
  searchable,
  searchPlaceholder = 'Search',
  searchLabel = 'Search this table',
  columnVisibility: visibilityProp,
  onColumnVisibilityChange,
  density: densityProp,
  onDensityChange,
  enableRowSelection = false,
  rowSelection: selectionProp,
  onRowSelectionChange,
  bulkActions,
  toolbar,
  loading = false,
  emptyState,
  maxHeight = '70dvh',
  itemLabel = 'rows',
  className,
}: DataTableProps<TData>) {
  const mode = modeProp ?? (onPaginationChange || pageCount !== undefined ? 'server' : 'client');
  const server = mode === 'server';
  const [pagination, setPagination] = useControllable(paginationProp, onPaginationChange, { pageIndex: 0, pageSize: pageSizeOptions[0] ?? 25 });
  const [sorting, setSorting] = useControllable(sortingProp, onSortingChange, []);
  const [globalFilter, setGlobalFilter] = useControllable(filterProp, onGlobalFilterChange, '');
  const [columnFilters, setColumnFilters] = useControllable(columnFiltersProp, onColumnFiltersChange, []);
  const [columnVisibility, setColumnVisibility] = useControllable(visibilityProp, onColumnVisibilityChange, {});
  const [rowSelection, setRowSelection] = useControllable(selectionProp, onRowSelectionChange, {});
  const [density, setDensityState] = React.useState<TableDensity>(densityProp ?? 'compact');
  const currentDensity = densityProp ?? density;
  const setDensity = (d: TableDensity) => {
    setDensityState(d);
    onDensityChange?.(d);
  };
  const pageSizeId = React.useId();
  const [searchDraft, setSearchDraft] = React.useState(globalFilter);
  React.useEffect(() => setSearchDraft(globalFilter), [globalFilter]);

  const selectColumn = React.useMemo<ColumnDef<TData, unknown>>(
    () => ({
      id: '__select',
      enableSorting: false,
      enableHiding: false,
      meta: { alwaysVisible: true, label: 'Select' },
      header: ({ table }) => (
        <Checkbox
          aria-label="Select all rows on this page"
          checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? 'indeterminate' : false}
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(v === true)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={`Select ${getRowLabel ? getRowLabel(row.original) : `row ${row.index + 1}`}`}
          checked={row.getIsSelected()}
          disabled={!row.getCanSelect()}
          onCheckedChange={(v) => row.toggleSelected(v === true)}
        />
      ),
    }),
    [getRowLabel],
  );

  const allColumns = React.useMemo(() => (enableRowSelection ? [selectColumn, ...columns] : columns), [enableRowSelection, selectColumn, columns]);

  const table = useReactTable<TData>({
    data,
    columns: allColumns,
    getRowId,
    state: { pagination, sorting, globalFilter, columnFilters, columnVisibility, rowSelection },
    onPaginationChange: setPagination,
    onSortingChange: (u) => {
      setSorting(u);
      if (server) setPagination((p) => ({ ...p, pageIndex: 0 }));
    },
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    enableRowSelection,
    manualPagination: server,
    manualSorting: server,
    manualFiltering: server,
    pageCount: server ? (pageCount ?? -1) : undefined,
    getCoreRowModel: getCoreRowModel(),
    ...(server
      ? {}
      : { getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel(), getPaginationRowModel: getPaginationRowModel() }),
  });

  const rows = table.getRowModel().rows;
  const selected = table.getSelectedRowModel().rows.map((r) => r.original);
  const clearSelection = () => table.resetRowSelection();
  const showSearch = searchable ?? (Boolean(onGlobalFilterChange) || !server);
  const total = server ? totalRows : table.getFilteredRowModel().rows.length;
  const pages = server ? Math.max(1, pageCount ?? 1) : Math.max(1, table.getPageCount());
  const cellPad = currentDensity === 'compact' ? 'py-1.5' : 'py-3';
  const hideable = table.getAllLeafColumns().filter((c) => c.getCanHide() && !c.columnDef.meta?.alwaysVisible);

  return (
    <div data-slot="data-table" data-density={currentDensity} className={cn('grid gap-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {showSearch ? (
          <form
            role="search"
            className="relative w-full max-w-xs"
            onSubmit={(e) => {
              e.preventDefault();
              setGlobalFilter(searchDraft);
              setPagination((p) => ({ ...p, pageIndex: 0 }));
            }}
          >
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              aria-label={searchLabel}
              placeholder={searchPlaceholder}
              className="pl-8"
              value={searchDraft}
              onChange={(e) => {
                setSearchDraft(e.currentTarget.value);
                if (!server) setGlobalFilter(e.currentTarget.value);
              }}
            />
          </form>
        ) : null}
        {toolbar}
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <SlidersHorizontal aria-hidden="true" />
                View
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Density</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={currentDensity} onValueChange={(v) => setDensity(v as TableDensity)}>
                <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              {hideable.length > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Columns</DropdownMenuLabel>
                  {hideable.map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c.id}
                      checked={c.getIsVisible()}
                      onCheckedChange={(v) => c.toggleVisibility(v === true)}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {columnName(c)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {enableRowSelection && selected.length > 0 ? (
        <div
          role="region"
          aria-label="Bulk actions"
          className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-accent px-3 py-2 text-sm text-accent-foreground"
        >
          <span className="font-medium tabular-nums">{selected.length.toLocaleString('en-US')} selected</span>
          <div className="flex flex-wrap items-center gap-2">{bulkActions?.(selected, clearSelection)}</div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={clearSelection}>
            <X aria-hidden="true" />
            Clear selection
          </Button>
        </div>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {loading ? 'Loading…' : enableRowSelection && selected.length > 0 ? `${selected.length} selected` : ''}
      </p>

      <div
        className="relative overflow-auto rounded-lg border bg-card shadow-soft"
        style={{ maxHeight }}
        role="region"
        aria-label={caption}
        tabIndex={0}
      >
        <table className="w-full border-collapse text-sm tabular-nums" aria-busy={loading || undefined} aria-rowcount={total !== undefined ? total + 1 : undefined}>
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-10 bg-muted shadow-[inset_0_-1px_0_var(--border)]">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const meta = h.column.columnDef.meta;
                  const sort = h.column.getIsSorted();
                  const canSort = h.column.getCanSort();
                  const align = meta?.align ?? 'left';
                  const content = h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext());
                  return (
                    <th
                      key={h.id}
                      scope="col"
                      colSpan={h.colSpan}
                      aria-sort={sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : canSort ? 'none' : undefined}
                      className={cn(
                        'h-9 px-3 text-xs font-medium whitespace-nowrap text-muted-foreground',
                        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
                        h.column.id === '__select' && 'w-10 pr-0',
                        meta?.headerClassName,
                      )}
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className={cn(
                            '-mx-1.5 inline-flex min-h-6 items-center gap-1 rounded-sm px-1.5 hover:text-foreground',
                            align === 'right' && 'flex-row-reverse',
                            sort && 'text-foreground',
                          )}
                        >
                          {content}
                          {sort === 'asc' ? (
                            <ArrowUp className="size-3.5" aria-hidden="true" />
                          ) : sort === 'desc' ? (
                            <ArrowDown className="size-3.5" aria-hidden="true" />
                          ) : (
                            <ArrowUpDown className="size-3.5 opacity-50" aria-hidden="true" />
                          )}
                          <span className="sr-only">
                            {sort === 'asc' ? ', sorted ascending' : sort === 'desc' ? ', sorted descending' : ''}. Sort by {columnName(h.column)}
                          </span>
                        </button>
                      ) : (
                        content
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y">
            {loading && rows.length === 0 ? (
              Array.from({ length: Math.min(pagination.pageSize, 8) }, (_, i) => (
                <tr key={`sk-${i}`}>
                  {table.getVisibleLeafColumns().map((c) => (
                    <td key={c.id} className={cn('px-3', cellPad)}>
                      <Skeleton className="h-4 w-full max-w-40" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length}>
                  {emptyState ?? (
                    <EmptyState
                      level={3}
                      title={globalFilter || columnFilters.length ? 'No matches' : 'Nothing here yet'}
                      description={globalFilter || columnFilters.length ? 'Try a different search or clear the filters.' : undefined}
                    />
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  data-state={row.getIsSelected() ? 'selected' : undefined}
                  className={cn('transition-colors duration-150 hover:bg-muted/50 data-[state=selected]:bg-accent', loading && 'opacity-60')}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta;
                    const align = meta?.align ?? 'left';
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          'px-3 align-middle',
                          cellPad,
                          align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
                          cell.column.id === '__select' && 'w-10 pr-0',
                          meta?.cellClassName,
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <label htmlFor={pageSizeId} className="whitespace-nowrap">
            Rows per page
          </label>
          <Select
            value={String(pagination.pageSize)}
            onValueChange={(v) => setPagination({ pageIndex: 0, pageSize: Number(v) })}
          >
            <SelectTrigger id={pageSizeId} size="sm" className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Pagination
          className="flex-1"
          page={pagination.pageIndex + 1}
          pageCount={pages}
          total={total}
          pageSize={pagination.pageSize}
          itemLabel={itemLabel}
          onPageChange={(p) => setPagination((prev) => ({ ...prev, pageIndex: p - 1 }))}
        />
      </div>
    </div>
  );
}
