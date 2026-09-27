// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// FB-01 forms list: name, kind, published version, draft in progress, where it is used, last modified; kind
// filter and archived toggle in the URL; rename and archive/restore (forms.update).
import { formatInZone } from '@gms/domain';
import {
  Alert,
  Button,
  CheckboxField,
  DataTable,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  ToneChip,
  type ColumnDefFor,
} from '@gms/ui';
import { Archive, ArchiveRestore, CircleCheck, MoreHorizontal, PenLine, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { updateFormAction } from '@/app/console/(app)/forms/actions';
import { problemMessage, useRunAction } from '../run-action';
import { useUrlParams } from '../url-data-table';
import { FORM_KINDS, kindLabel } from './kinds';

export interface FormRow {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  status: string;
  publishedVersion: number | null;
  draftVersion: number | null;
  usedBy: { opportunityId: string; label: string }[];
  lastModifiedAt: string;
}

const ALL = '__all__';

function RenameDialog({ row, onClose }: { row: FormRow; onClose: () => void }) {
  const { run, pending } = useRunAction();
  const [name, setName] = useState(row.name);
  const [description, setDescription] = useState(row.description ?? '');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Rename form</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return setError('Name the form.');
            void run(() => updateFormAction(row.id, { name: name.trim(), description: description.trim() || null }), { success: 'Saved.' }).then((r) => {
              if (r.ok) onClose();
              else setError(problemMessage(r.problem));
            });
          }}
        >
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <Field label="Name" htmlFor="rename-form-name" required>
            <Input id="rename-form-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </Field>
          <Field label="Description" htmlFor="rename-form-desc" optional description="For your team only.">
            <Textarea id="rename-form-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" pending={pending} pendingLabel="Saving…">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FormsTable({ rows, timeZone, kind, showArchived, canEdit }: { rows: FormRow[]; timeZone: string; kind: string | null; showArchived: boolean; canEdit: boolean }) {
  const { set } = useUrlParams();
  const { run } = useRunAction();
  const [renaming, setRenaming] = useState<FormRow | null>(null);
  const columns = useMemo<ColumnDefFor<FormRow>[]>(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: 'Form',
        meta: { alwaysVisible: true },
        cell: ({ row }) => (
          <div className="grid">
            <Link href={`/console/forms/${row.original.id}`} className="font-medium hover:underline">
              {row.original.name}
            </Link>
            {row.original.status === 'archived' ? <span className="text-xs text-muted-foreground">Archived</span> : row.original.description ? <span className="line-clamp-1 text-xs text-muted-foreground">{row.original.description}</span> : null}
          </div>
        ),
      },
      { id: 'kind', accessorFn: (r) => kindLabel(r.kind), header: 'Kind' },
      {
        id: 'published',
        accessorKey: 'publishedVersion',
        header: 'Published',
        cell: ({ row }) => (row.original.publishedVersion !== null ? <ToneChip tone="success" icon={CircleCheck} label={`v${row.original.publishedVersion}`} size="sm" /> : <span className="text-muted-foreground">Not yet</span>),
      },
      {
        id: 'draft',
        accessorKey: 'draftVersion',
        header: 'Draft',
        cell: ({ row }) => (row.original.draftVersion !== null ? <ToneChip tone="progress" icon={PenLine} label={`v${row.original.draftVersion} in progress`} size="sm" /> : <span className="text-muted-foreground">None</span>),
      },
      {
        id: 'usedBy',
        accessorFn: (r) => r.usedBy.length,
        header: 'Used by',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.usedBy.length ? (
            <ul className="grid gap-0.5 text-xs">
              {row.original.usedBy.map((u) => (
                <li key={u.label}>
                  <Link href={`/console/opportunities/${u.opportunityId}?tab=stages`} className="hover:underline">
                    {u.label}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-muted-foreground">Not attached</span>
          ),
      },
      { id: 'modified', accessorKey: 'lastModifiedAt', header: 'Last modified', cell: ({ row }) => <span className="whitespace-nowrap">{formatInZone(row.original.lastModifiedAt, timeZone)}</span> },
      ...(canEdit
        ? ([
            {
              id: 'actions',
              header: () => <span className="sr-only">Actions</span>,
              enableSorting: false,
              meta: { label: 'Actions', alwaysVisible: true, align: 'right' },
              cell: ({ row }) => (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.original.name}`}>
                      <MoreHorizontal aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link href={`/console/forms/${row.original.id}`}>
                        <PenLine aria-hidden="true" /> Open builder
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setRenaming(row.original)}>
                      <Pencil aria-hidden="true" /> Rename
                    </DropdownMenuItem>
                    {row.original.status === 'archived' ? (
                      <DropdownMenuItem onSelect={() => void run(() => updateFormAction(row.original.id, { status: 'active' }), { success: `Restored “${row.original.name}”.` })}>
                        <ArchiveRestore aria-hidden="true" /> Restore
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => void run(() => updateFormAction(row.original.id, { status: 'archived' }), { success: `Archived “${row.original.name}”. Stages already using it keep it.` })}>
                        <Archive aria-hidden="true" /> Archive
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
            },
          ] satisfies ColumnDefFor<FormRow>[])
        : []),
    ],
    [timeZone, canEdit, run],
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor="forms-kind-filter" className="sr-only">
        Kind
      </label>
      <Select value={kind ?? ALL} onValueChange={(v) => set({ kind: v === ALL ? null : v })}>
        <SelectTrigger id="forms-kind-filter" size="sm" className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All kinds</SelectItem>
          {FORM_KINDS.map((k) => (
            <SelectItem key={k.value} value={k.value}>
              {k.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <CheckboxField label="Show archived" checked={showArchived} onCheckedChange={(v) => set({ archived: v === true ? '1' : null })} />
    </div>
  );

  return (
    <>
      <DataTable<FormRow> caption="Forms" columns={columns} data={rows} getRowId={(r) => r.id} getRowLabel={(r) => r.name} itemLabel="forms" searchPlaceholder="Search forms" toolbar={toolbar} />
      {renaming ? <RenameDialog row={renaming} onClose={() => setRenaming(null)} /> : null}
    </>
  );
}
