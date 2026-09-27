// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// C-06 pipeline table: server-paged UrlDataTable with duplicate flags, the "Via agent" badge and bulk actions
// (advance, decline, assign reviewers, message, tag).
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  MoneyDisplay,
  StatusChip,
  ToneChip,
  toast,
  type ColumnDefFor,
} from '@gms/ui';
import { Bot, Copy, CopyCheck, CopyX, Mail, MoveRight, Tags, UserPlus, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { BulkDeclineDialog } from '../bulk-decline-dialog';
import { useRunAction } from '../run-action';
import { UrlDataTable, type UrlTableState } from '../url-data-table';
import { advanceAction, dismissDuplicateAction, markDuplicateAction } from './actions';
import { AssignReviewersDialog, BulkMessageDialog, TagDialog, type SelectedApp } from './bulk-dialogs';
import { DUPLICATE_REASON_LABEL, type PersonOption, type PipelineRow, type ReviewStageOption } from './types';

type DialogKind = 'decline' | 'assign' | 'message' | 'tag';

export function toSelected(r: PipelineRow): SelectedApp {
  return { id: r.id, reference: r.reference, competitionId: r.competitionId, opportunityId: r.opportunityId, tags: r.tags };
}

export function DuplicateFlags({ row, canEdit }: { row: Pick<PipelineRow, 'id' | 'reference' | 'possibleDuplicates' | 'duplicateOf'>; canEdit: boolean }) {
  const { run, pending } = useRunAction();
  if (!row.possibleDuplicates.length && !row.duplicateOf) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {row.duplicateOf ? (
        <ToneChip tone="neutral" icon={CopyCheck} size="sm" label={<Link href={`/console/applications/${row.duplicateOf.id}`} className="hover:underline">Duplicate of {row.duplicateOf.reference}</Link>} />
      ) : null}
      {row.possibleDuplicates.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="rounded-md focus-visible:outline-2 focus-visible:outline-ring" disabled={pending} aria-label={`Possible duplicate of ${row.possibleDuplicates.map((d) => d.otherReference).join(', ')}: review`}>
              <ToneChip tone="warning" icon={Copy} size="sm" label={`Possible duplicate (${DUPLICATE_REASON_LABEL[row.possibleDuplicates[0]!.reason] ?? row.possibleDuplicates[0]!.reason})`} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            {row.possibleDuplicates.map((d, i) => (
              <div key={d.otherId}>
                {i > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuLabel className="text-xs font-normal">
                  <Link href={`/console/applications/${d.otherId}`} className="font-medium hover:underline">
                    {d.otherReference}
                  </Link>{' '}
                  · {DUPLICATE_REASON_LABEL[d.reason] ?? d.reason}
                </DropdownMenuLabel>
                <DropdownMenuItem
                  disabled={!canEdit}
                  onSelect={() => void run(() => markDuplicateAction(row.id, d.otherId), { success: `${row.reference} marked as a duplicate of ${d.otherReference}.` })}
                >
                  <CopyCheck aria-hidden="true" /> Mark {row.reference} duplicate of {d.otherReference}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!canEdit} onSelect={() => void run(() => dismissDuplicateAction(row.id, d.otherId), { success: 'Marked as not a duplicate.' })}>
                  <CopyX aria-hidden="true" /> Not a duplicate
                </DropdownMenuItem>
              </div>
            ))}
            {row.duplicateOf ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!canEdit} onSelect={() => void run(() => markDuplicateAction(row.id, null), { success: 'Duplicate link cleared.' })}>
                  <CopyX aria-hidden="true" /> Clear “duplicate of {row.duplicateOf.reference}”
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </span>
  );
}

export function PipelineTable({
  rows,
  state,
  totalRows,
  stages,
  reviewers,
  canEdit,
  emptyTitle,
}: {
  rows: PipelineRow[];
  state: UrlTableState;
  totalRows: number;
  stages: ReviewStageOption[];
  reviewers: PersonOption[];
  canEdit: boolean;
  emptyTitle: string;
}) {
  const [dialog, setDialog] = useState<{ kind: DialogKind; rows: PipelineRow[]; clear: () => void } | null>(null);
  const { run, pending } = useRunAction();

  const columns = useMemo<ColumnDefFor<PipelineRow>[]>(
    () => [
      { id: 'reference', accessorKey: 'reference', header: 'Reference', cell: ({ row }) => <span className="font-mono text-xs whitespace-nowrap">{row.original.reference}</span> },
      {
        id: 'title',
        accessorKey: 'title',
        header: 'Title',
        meta: { alwaysVisible: true },
        cell: ({ row }) => (
          <Link href={`/console/applications/${row.original.id}`} className="font-medium hover:underline">
            {row.original.title}
          </Link>
        ),
      },
      { id: 'org', accessorKey: 'orgName', header: 'Organization', cell: ({ row }) => row.original.orgName ?? <span className="text-muted-foreground">Individual</span> },
      {
        id: 'stage',
        header: 'Opportunity / stage',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="grid">
            <span className="truncate">{row.original.opportunityTitle}</span>
            <span className="text-xs text-muted-foreground">{row.original.stageName}</span>
          </span>
        ),
      },
      { id: 'status', accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusChip kind="application" value={row.original.status} size="sm" /> },
      {
        id: 'requested',
        accessorKey: 'requestedCents',
        header: 'Requested',
        meta: { align: 'right' },
        cell: ({ row }) => (row.original.requestedCents === null ? <span className="text-muted-foreground">—</span> : <MoneyDisplay cents={row.original.requestedCents} currency={row.original.currency} />),
      },
      { id: 'submitted', accessorKey: 'submittedAt', header: 'Submitted', cell: ({ row }) => <span className="whitespace-nowrap">{row.original.submittedLabel}</span> },
      {
        id: 'reviews',
        header: 'Reviews',
        enableSorting: false,
        meta: { align: 'right', label: 'Reviews (submitted/assigned, average)' },
        cell: ({ row }) =>
          row.original.assigned ? (
            <span className="whitespace-nowrap tabular-nums">
              {row.original.reviewsDone}/{row.original.assigned}
              <span className="sr-only"> reviews submitted</span>
              {row.original.avgScore !== null ? <span className="ml-1 text-xs text-muted-foreground">avg {row.original.avgScore.toFixed(1)}</span> : null}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
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
      {
        id: 'flags',
        header: 'Flags',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-1">
            {row.original.viaAgent ? (
              <Badge variant="agent">
                <Bot aria-hidden="true" /> Via agent
              </Badge>
            ) : null}
            <DuplicateFlags row={row.original} canEdit={canEdit} />
          </span>
        ),
      },
    ],
    [canEdit],
  );

  const sel = dialog?.rows.map(toSelected) ?? [];
  const close = (o: boolean) => {
    if (!o) setDialog(null);
  };

  return (
    <>
      <UrlDataTable<PipelineRow>
        caption="Applications in the pipeline"
        itemLabel="applications"
        columns={columns}
        data={rows}
        state={state}
        totalRows={totalRows}
        getRowId={(r) => r.id}
        getRowLabel={(r) => `${r.reference} ${r.title}`}
        searchPlaceholder="Reference, title or organization"
        searchLabel="Search applications"
        enableRowSelection={canEdit}
        emptyState={<EmptyState level={3} title={emptyTitle} description="Try a different search or clear the filters." />}
        bulkActions={(selected, clear) => (
          <>
            <Button
              size="sm"
              variant="outline"
              pending={pending}
              pendingLabel="Moving…"
              onClick={() =>
                void run(
                  () => advanceAction(selected.map((r) => r.id)),
                  {
                    success: (d) => {
                      const refOf = new Map(selected.map((r) => [r.id, r.reference]));
                      const skipped = d.skipped.map((s) => `${refOf.get(s.id) ?? 'one'} (${s.reason})`).join('; ');
                      return `Moved ${d.moved} to Under review.${skipped ? ` Skipped ${skipped}.` : ''}`;
                    },
                    onDone: () => clear(),
                  },
                ).then((r) => {
                  if (r.ok && r.data.moved === 0 && !r.data.skipped.length) toast.info('Those applications are already under review.');
                })
              }
            >
              <MoveRight aria-hidden="true" /> Advance {selected.length}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'decline', rows: selected, clear })}>
              <XCircle aria-hidden="true" /> Decline {selected.length}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'assign', rows: selected, clear })}>
              <UserPlus aria-hidden="true" /> Assign reviewers
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'message', rows: selected, clear })}>
              <Mail aria-hidden="true" /> Message
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'tag', rows: selected, clear })}>
              <Tags aria-hidden="true" /> Tag
            </Button>
          </>
        )}
      />
      <BulkDeclineDialog
        open={dialog?.kind === 'decline'}
        onOpenChange={close}
        applicationIds={sel.map((a) => a.id)}
        labels={dialog?.rows.map((r) => `${r.reference} ${r.title}`) ?? []}
        onDone={() => dialog?.clear()}
      />
      <AssignReviewersDialog open={dialog?.kind === 'assign'} onOpenChange={close} apps={sel} stages={stages} reviewers={reviewers} onDone={() => dialog?.clear()} />
      <BulkMessageDialog open={dialog?.kind === 'message'} onOpenChange={close} apps={sel} />
      <TagDialog open={dialog?.kind === 'tag'} onOpenChange={close} apps={sel} onDone={() => dialog?.clear()} />
    </>
  );
}
