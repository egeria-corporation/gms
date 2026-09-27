// SPDX-License-Identifier: AGPL-3.0-only
'use server';
// E-02 board voting. board.vote is R3 (people only): for a signed-in board member it runs directly and
// records the voter and time; agents can never vote.
import { revalidatePath } from 'next/cache';
import { act } from '@/lib/server/act';

export type BoardVote = 'approve' | 'decline' | 'abstain' | 'recuse';

export async function castVoteAction(docketId: string, docketItemId: string, vote: BoardVote) {
  const r = await act<{ recordedAt: string }>('board.vote', { docketItemId, vote });
  revalidatePath(`/board/${docketId}`);
  revalidatePath('/board');
  revalidatePath(`/console/dockets/${docketId}`);
  return r;
}
