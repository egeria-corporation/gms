// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { Alert, Button } from '@gms/ui';
import { useActionState } from 'react';
import { acceptInviteAction, type AcceptState } from './actions';

export function AcceptForm({ token, joinLabel }: { token: string; joinLabel: string }) {
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptInviteAction, { status: 'idle' });
  return (
    <form action={action} className="grid gap-4">
      {state.status === 'error' ? (
        <Alert variant="danger" title="We couldn’t accept this invitation" role="alert">
          {state.message}
        </Alert>
      ) : null}
      <input type="hidden" name="token" value={token} />
      <Button type="submit" size="lg" pending={pending} pendingLabel="Joining…" className="justify-self-start">
        {joinLabel}
      </Button>
    </form>
  );
}
