// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// E-01 docket lifecycle (board.set_docket_status, R2 — runs for a person): publish to the board → open
// voting (in session) → close and tally against the quorum. Each step is confirmed; closing shows the
// returned outcome per item.
import { Alert, Button } from '@gms/ui';
import { Gavel, Lock, Send } from 'lucide-react';
import { useState } from 'react';
import { setDocketStatusAction, type DocketOutcome } from '@/app/console/(app)/dockets/actions';
import { ConfirmActionButton } from '../run-action';
import { DocketOutcomeChip } from '../decisions/outcome-chips';

export function DocketLifecycle({
  docketId,
  status,
  itemCount,
  quorum,
  boardMembers,
  labels,
}: {
  docketId: string;
  status: string;
  itemCount: number;
  quorum: number;
  boardMembers: number;
  /** applicationId → short label (reference · organization). */
  labels: Record<string, string>;
}) {
  const [outcomes, setOutcomes] = useState<DocketOutcome[] | null>(null);
  return (
    <>
      {status === 'draft' ? (
        <ConfirmActionButton
          label="Publish to board"
          icon={<Send aria-hidden="true" />}
          variant="default"
          disabled={itemCount === 0}
          title="Publish this docket to the board?"
          description={`All ${boardMembers} board member${boardMembers === 1 ? '' : 's'} can then read the ${itemCount} item${itemCount === 1 ? '' : 's'} and the board book in the board portal. You can still reorder, add and remove items until voting opens.`}
          confirmLabel="Publish"
          success="Published to the board."
          action={() => setDocketStatusAction(docketId, 'published')}
        />
      ) : status === 'published' ? (
        <ConfirmActionButton
          label="Open voting"
          icon={<Gavel aria-hidden="true" />}
          variant="default"
          title="Open voting on this docket?"
          description={`Board members can vote approve, decline, abstain or recuse on each item. The items are locked while the docket is in session. Each item needs ${quorum} vote${quorum === 1 ? '' : 's'} (recusals don’t count) for a result.`}
          confirmLabel="Open voting"
          success="Voting is open."
          action={() => setDocketStatusAction(docketId, 'in_session')}
        />
      ) : status === 'in_session' ? (
        <ConfirmActionButton
          label="Close and tally"
          icon={<Lock aria-hidden="true" />}
          variant="default"
          title="Close voting and tally the results?"
          description={`Voting stops for everyone. Each item is approved or declined by majority if at least ${quorum} member${quorum === 1 ? '' : 's'} voted; ties are deferred; items short of quorum are marked “No quorum”. This can’t be reopened.`}
          confirmLabel="Close and tally"
          success="Docket closed."
          action={() => setDocketStatusAction(docketId, 'closed')}
          onDone={(d) => setOutcomes(d.outcomes)}
        />
      ) : null}
      {outcomes ? (
        <div className="basis-full" aria-live="polite">
          <Alert
            variant="success"
            title="Tally"
            actions={
              <Button variant="ghost" size="sm" onClick={() => setOutcomes(null)}>
                Dismiss
              </Button>
            }
          >
            <ul className="grid gap-1">
              {outcomes.map((o) => (
                <li key={o.applicationId} className="flex flex-wrap items-center gap-2">
                  <span>{labels[o.applicationId] ?? 'Item'}</span>
                  <DocketOutcomeChip outcome={o.outcome} size="sm" />
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Approve {o.approve} · Decline {o.decline} · Abstain {o.abstain}
                  </span>
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : null}
    </>
  );
}
