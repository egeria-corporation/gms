// SPDX-License-Identifier: AGPL-3.0-only
'use client';
// E-02 voting on one docket item (board.vote — R3, people only). Choose approve / decline / abstain /
// recuse, then press "Record my vote" (the explicit confirm step). Shows "Your vote: … recorded …".
import { Button, FieldSet, RadioGroup, RadioOption } from '@gms/ui';
import { Vote } from 'lucide-react';
import { useId, useState } from 'react';
import { castVoteAction, type BoardVote } from '@/app/board/actions';
import { useRunAction } from '../run-action';
import { VoteChip } from '../decisions/outcome-chips';

const OPTIONS: { value: BoardVote; label: string; description: string }[] = [
  { value: 'approve', label: 'Approve', description: 'Fund at the recommended amount.' },
  { value: 'decline', label: 'Decline', description: 'Do not fund.' },
  { value: 'abstain', label: 'Abstain', description: 'Counts toward quorum, not for or against.' },
  { value: 'recuse', label: 'Recuse', description: 'You have a conflict of interest. Doesn’t count toward quorum.' },
];

export function VotePanel({
  docketId,
  itemId,
  itemLabel,
  mine,
  preview = false,
}: {
  docketId: string;
  itemId: string;
  itemLabel: string;
  mine: { vote: string; recordedAt: string } | null;
  /** Forced ?state=voted preview on a docket that isn't in session: show, don't submit. */
  preview?: boolean;
}) {
  const ids = useId();
  const { run, pending } = useRunAction();
  const [choice, setChoice] = useState<BoardVote | ''>((mine?.vote as BoardVote | undefined) ?? '');
  const [status, setStatus] = useState('');
  const changed = choice !== '' && choice !== mine?.vote;

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!choice || preview) return;
        void run(() => castVoteAction(docketId, itemId, choice), {
          success: `Vote recorded: ${OPTIONS.find((o) => o.value === choice)?.label}.`,
          onDone: () => setStatus(`Your vote on ${itemLabel} was recorded.`),
        });
      }}
    >
      <FieldSet legend={<span className="text-base">Your vote on {itemLabel}</span>}>
        <RadioGroup value={choice} onValueChange={(v) => setChoice(v as BoardVote)} className="grid gap-2 sm:grid-cols-2" aria-describedby={`${ids}-mine`}>
          {OPTIONS.map((o) => (
            <RadioOption key={o.value} value={o.value} label={o.label} description={o.description} size="lg" className="rounded-lg border px-3" />
          ))}
        </RadioGroup>
      </FieldSet>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={!changed || preview} pending={pending} pendingLabel="Recording…">
          <Vote aria-hidden="true" /> {mine ? 'Change my vote' : 'Record my vote'}
        </Button>
        <p id={`${ids}-mine`} className="flex flex-wrap items-center gap-2 text-base" aria-live="polite">
          {mine ? (
            <>
              Your vote: <VoteChip vote={mine.vote} size="default" /> <span className="text-muted-foreground">recorded {mine.recordedAt}</span>
            </>
          ) : (
            <span className="text-muted-foreground">You haven’t voted on this item.</span>
          )}
          <span className="sr-only">{status}</span>
        </p>
      </div>
    </form>
  );
}
