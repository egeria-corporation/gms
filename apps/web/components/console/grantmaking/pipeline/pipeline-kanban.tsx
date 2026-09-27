// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// C-06 pipeline board. Moving a card runs the matching action: Under review → applications.advance,
// Declined → BulkDeclineDialog, Ineligible → reason dialog (R3), Invited → pick the invite-only stage.
// Awarded is blocked (final decisions are recorded in Decisions). The board reverts when a move is
// cancelled or fails.
import { applicationMachine, type ApplicationStatus } from '@gms/domain';
import { Badge, Kanban, MoneyDisplay, toast, type KanbanColumn, type KanbanMove } from '@gms/ui';
import { Bot, Copy } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { BulkDeclineDialog } from '../bulk-decline-dialog';
import { problemMessage } from '../run-action';
import { advanceAction } from './actions';
import { IneligibleDialog, InviteDialog } from './bulk-dialogs';
import { toSelected } from './pipeline-table';
import type { InviteStageOption, PipelineRow } from './types';

const COLUMNS: KanbanColumn[] = [
  { id: 'submitted', title: 'Submitted', description: 'Waiting for screening' },
  { id: 'under_review', title: 'Under review' },
  { id: 'invited_to_next_stage', title: 'Invited to next stage' },
  { id: 'awarded', title: 'Awarded', description: 'Record final decisions in Decisions' },
  { id: 'declined', title: 'Declined' },
  { id: 'ineligible', title: 'Ineligible' },
];

type Card = PipelineRow & { columnId: string };

function allowed(from: string, to: string): boolean {
  return (applicationMachine.transitions[from as ApplicationStatus] ?? []).includes(to as ApplicationStatus);
}

export function PipelineKanban({ rows, inviteStages, canEdit }: { rows: PipelineRow[]; inviteStages: InviteStageOption[]; canEdit: boolean }) {
  const router = useRouter();
  const initial = useMemo<Card[]>(() => rows.map((r) => ({ ...r, columnId: r.status })), [rows]);
  const [items, setItems] = useState<Card[]>(initial);
  useEffect(() => setItems(initial), [initial]);
  const [dialog, setDialog] = useState<{ kind: 'declined' | 'ineligible' | 'invited_to_next_stage'; card: Card } | null>(null);
  const done = useRef(false);
  const [, start] = useTransition();
  const revert = () => setItems((x) => [...x]);

  const canMove = (item: Card, to: string) => {
    if (!canEdit) return false;
    if (to === 'awarded' || to === 'submitted') return false;
    if (!allowed(item.status, to)) return false;
    if (to === 'under_review') return ['submitted', 'ineligible'].includes(item.status);
    if (to === 'invited_to_next_stage') return ['submitted', 'under_review'].includes(item.status) && inviteStages.some((s) => s.opportunityId === item.opportunityId && s.id !== item.competitionId);
    return true;
  };

  const onMove = (m: KanbanMove) => {
    if (m.fromColumnId === m.toColumnId) return;
    const card = items.find((c) => c.id === m.itemId);
    if (!card) return;
    if (m.toColumnId === 'under_review') {
      start(async () => {
        const r = await advanceAction([card.id]);
        if (r.ok && r.data.moved) {
          toast.success(`${card.reference} moved to Under review.`);
          router.refresh();
        } else {
          toast.error(r.ok ? (r.data.skipped[0]?.reason ?? 'It could not be moved.') : problemMessage(r.problem));
          revert();
          router.refresh();
        }
      });
      return;
    }
    if (m.toColumnId === 'declined' || m.toColumnId === 'ineligible' || m.toColumnId === 'invited_to_next_stage') {
      done.current = false;
      setDialog({ kind: m.toColumnId, card });
      return;
    }
    revert();
  };

  const close = (o: boolean) => {
    if (o) return;
    setDialog(null);
    if (!done.current) revert();
  };
  const markDone = () => {
    done.current = true;
  };
  const apps = dialog ? [toSelected(dialog.card)] : [];

  return (
    <>
      <Kanban<Card>
        label="Application pipeline board"
        columns={COLUMNS}
        items={items}
        getItemLabel={(c) => `${c.reference} ${c.title}`}
        canMove={canMove}
        onMove={onMove}
        renderItem={(c) => (
          <div className="grid gap-1">
            <Link href={`/console/applications/${c.id}`} className="line-clamp-2 font-medium hover:underline">
              {c.title}
            </Link>
            <span className="truncate text-xs text-muted-foreground">
              {c.reference} · {c.orgName ?? 'Individual'}
            </span>
            <span className="flex flex-wrap items-center gap-1">
              {c.requestedCents !== null ? <MoneyDisplay className="text-xs" cents={c.requestedCents} currency={c.currency} /> : null}
              {c.viaAgent ? (
                <Badge variant="agent">
                  <Bot aria-hidden="true" /> Via agent
                </Badge>
              ) : null}
              {c.possibleDuplicates.length ? (
                <Badge variant="warning">
                  <Copy aria-hidden="true" /> Possible duplicate
                </Badge>
              ) : null}
              {c.duplicateOf ? <Badge variant="neutral">Duplicate of {c.duplicateOf.reference}</Badge> : null}
            </span>
          </div>
        )}
      />
      <BulkDeclineDialog open={dialog?.kind === 'declined'} onOpenChange={close} applicationIds={apps.map((a) => a.id)} labels={dialog ? [`${dialog.card.reference} ${dialog.card.title}`] : []} onDone={markDone} />
      <IneligibleDialog open={dialog?.kind === 'ineligible'} onOpenChange={close} apps={apps} onDone={markDone} />
      <InviteDialog open={dialog?.kind === 'invited_to_next_stage'} onOpenChange={close} apps={apps} stages={inviteStages} onDone={markDone} />
    </>
  );
}
