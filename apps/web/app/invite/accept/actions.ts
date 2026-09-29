// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
import { redirect } from 'next/navigation';
import { act } from '@/lib/server/act';

export type AcceptState = { status: 'idle' } | { status: 'error'; message: string };

/** Accepts the invitation for the signed-in person, then sends them to the surface their role uses. */
export async function acceptInviteAction(_prev: AcceptState, form: FormData): Promise<AcceptState> {
  const token = String(form.get('token') ?? '');
  if (token.length < 10) return { status: 'error', message: 'This invitation link is incomplete. Open it again from the email.' };
  const r = await act<{ workspaceId: string; role: string }>('team.accept_invite', { token });
  if (!r.ok) return { status: 'error', message: r.problem.detail };
  redirect(r.data.role === 'reviewer' ? '/review' : r.data.role === 'board' ? '/board' : '/console');
}
