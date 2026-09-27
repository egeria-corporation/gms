// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Alert, Button, Field, Input } from '@gms/ui';
import { ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { enrollTotpAction, verifyTotpAction } from './actions';

export function MfaForm({ mode, next }: { mode: 'enroll' | 'verify'; next: string }) {
  const router = useRouter();
  const [enroll, setEnroll] = useState<null | { factorId: string; secret: string; qr: string }>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const verify = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.replace(/\s/g, ''))) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    start(async () => {
      const r = await verifyTotpAction(enroll?.factorId ?? null, code.replace(/\s/g, ''));
      if (r.ok) {
        router.replace(next);
        router.refresh();
      } else setError(r.message ?? 'That code didn’t work.');
    });
  };

  if (mode === 'enroll' && !enroll) {
    return (
      <div className="grid gap-4">
        <p>Staff accounts use a second step to sign in, because the console can move money and see applicants’ information.</p>
        <ol className="grid list-decimal gap-1 pl-5 text-sm">
          <li>Install an authenticator app (for example 1Password, Google Authenticator, or Microsoft Authenticator).</li>
          <li>Scan the code we show you next.</li>
          <li>Type the 6-digit code to finish.</li>
        </ol>
        {error ? <Alert variant="danger" title="Couldn’t start setup">{error}</Alert> : null}
        <Button
          size="lg"
          className="justify-self-start"
          pending={pending}
          onClick={() =>
            start(async () => {
              const r = await enrollTotpAction();
              if (r.ok) setEnroll(r);
              else setError(r.message);
            })
          }
        >
          <ShieldCheck aria-hidden="true" /> Set up my authenticator
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={verify} className="grid gap-5">
      {enroll ? (
        <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center">
          <img src={enroll.qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded-md border bg-white p-2" />
          <div className="grid gap-1 text-sm">
            <p>Scan this with your authenticator app.</p>
            <p className="text-muted-foreground">Can’t scan? Enter this key instead:</p>
            <code className="rounded bg-muted px-2 py-1 font-mono tracking-wider break-all">{enroll.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
          </div>
        </div>
      ) : (
        <p>Open your authenticator app and enter the current code for GMS.</p>
      )}
      {error ? <Alert variant="danger" title="Try again">{error}</Alert> : null}
      <Field label="6-digit code" htmlFor="totp-code">
        <Input id="totp-code" inputMode="numeric" autoComplete="one-time-code" inputSize="lg" className="max-w-48 font-mono text-lg tracking-[0.3em]" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <Button type="submit" size="lg" className="justify-self-start" pending={pending} pendingLabel="Checking…">
        {enroll ? 'Finish setup' : 'Continue'}
      </Button>
    </form>
  );
}
