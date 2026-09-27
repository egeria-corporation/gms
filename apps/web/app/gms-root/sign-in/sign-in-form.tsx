// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Alert, Button, Field, Input } from '@gms/ui';
import { MailCheck } from 'lucide-react';
import { useActionState } from 'react';
import { sendRootMagicLink, type RootSignInState } from './actions';

export function RootSignInForm({ next, expired, forcedSentTo }: { next: string; expired: boolean; forcedSentTo?: string }) {
  const [state, action, pending] = useActionState<RootSignInState, FormData>(sendRootMagicLink, forcedSentTo ? { status: 'sent', email: forcedSentTo } : { status: 'idle' });
  if (state.status === 'sent') {
    return (
      <Alert variant="success" title="Check your email" icon={<MailCheck aria-hidden="true" />}>
        <p>
          If <strong>{state.email}</strong> can sign in here, a link is on its way. It works once and expires in 15 minutes.
        </p>
        <p className="mt-2 text-sm">Don’t see it? Check your spam folder, or wait a minute and send another.</p>
      </Alert>
    );
  }
  return (
    <form action={action} className="grid gap-5" noValidate>
      {expired ? (
        <Alert variant="warning" title="That link has expired">
          Sign-in links work once and last 15 minutes. Enter your email and we’ll send a fresh one.
        </Alert>
      ) : null}
      {state.status === 'error' && state.field !== 'email' ? (
        <Alert variant="danger" title="Something went wrong">
          {state.message}
        </Alert>
      ) : null}
      <input type="hidden" name="next" value={next} />
      <Field label="Email address" htmlFor="email" error={state.status === 'error' && state.field === 'email' ? state.message : undefined} description="We’ll email you a link — no password needed.">
        <Input id="email" name="email" type="email" autoComplete="email" inputSize="lg" required />
      </Field>
      <Button type="submit" size="lg" pending={pending} pendingLabel="Sending…">
        Email me a sign-in link
      </Button>
    </form>
  );
}
