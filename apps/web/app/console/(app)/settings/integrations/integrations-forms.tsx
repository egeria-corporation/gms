// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Button, Field, Input, Switch, toast } from '@gms/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setEmailDomainAction, setSyndicationAction } from './actions';

export function EmailDomainForm({ domain, disabled }: { domain: string | null; disabled: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(domain ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = (next: string | null) =>
    start(async () => {
      setError(null);
      const r = await setEmailDomainAction(next);
      if (r.ok) {
        toast.success(next ? `Saved. Add the DNS records below for ${next}.` : 'Sending domain removed.');
        router.refresh();
      } else setError(r.problem.errors?.[0]?.message ?? r.problem.detail);
    });
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim().toLowerCase();
        if (!v) return submit(null);
        if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(v)) {
          setError('Enter a domain like grants.example.org (no https:// or @).');
          return;
        }
        submit(v);
      }}
      noValidate
    >
      <Field label="Sending domain" htmlFor="email-domain" error={error ?? undefined} description="A subdomain such as grants.yourfoundation.org keeps your main email reputation separate." className="min-w-64 flex-1">
        <Input id="email-domain" value={value} disabled={disabled} autoComplete="off" spellCheck={false} placeholder="grants.example.org" onChange={(e) => setValue(e.target.value)} />
      </Field>
      <Button type="submit" variant="secondary" disabled={disabled} pending={pending} pendingLabel="Saving…">
        Save domain
      </Button>
      {domain && !disabled ? (
        <Button type="button" variant="ghost" disabled={pending} onClick={() => {
          setValue('');
          submit(null);
        }}>
          Remove
        </Button>
      ) : null}
    </form>
  );
}

export function SyndicationToggle({ enabled, disabled }: { enabled: boolean; disabled: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
      <span>
        <span className="block font-medium">Offer opportunities to OpenGrants</span>
        <span className="block text-muted-foreground">{on ? 'On: published opportunities are offered to the directory.' : 'Off: opportunities stay only on your site.'}</span>
      </span>
      <Switch
        checked={on}
        disabled={disabled || pending}
        onCheckedChange={(v) => {
          setOn(v);
          start(async () => {
            const r = await setSyndicationAction(v);
            if (r.ok) {
              toast.success(v ? 'OpenGrants syndication turned on.' : 'OpenGrants syndication turned off.');
              router.refresh();
            } else {
              setOn(!v);
              toast.error(r.problem.detail);
            }
          });
        }}
      />
    </label>
  );
}
