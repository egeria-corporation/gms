// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// P-08 client parts: choose how to pay (Mercury token mode, Mercury OAuth — pending partner approval, or pay
// outside GMS) and map programs to paying accounts. Both are people-only and ask for authenticator step-up.
import { formatMoney } from '@gms/domain';
import {
  Alert,
  Badge,
  Button,
  Field,
  FieldSet,
  Input,
  RadioGroup,
  RadioOption,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gms/ui';
import { KeyRound } from 'lucide-react';
import * as React from 'react';
import { connectBankAction, mapProgramAccountAction } from '@/app/console/(app)/payments/actions';
import { FeedbackRegion, useRunner } from './client-utils';

type Choice = 'mercury' | 'mercury_oauth' | 'manual';

export function ConnectBankForm({ connected, oauthPreview }: { connected: { provider: string; environment: string } | null; oauthPreview: boolean }) {
  const [choice, setChoice] = React.useState<Choice>('mercury');
  const [environment, setEnvironment] = React.useState<'fake' | 'sandbox'>('fake');
  const [token, setToken] = React.useState('');
  const [tokenError, setTokenError] = React.useState<string | null>(null);
  const { run, pending, feedback, dialog } = useRunner({ reason: 'Connecting or changing the bank is people-only, so we check your authenticator app first.', actionLabel: 'Connect' });
  const ids = { env: React.useId(), token: React.useId() };

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (choice === 'mercury_oauth') return;
        if (choice === 'mercury' && environment === 'sandbox' && token.trim().length < 10) {
          setTokenError('Paste your Mercury sandbox API token.');
          return;
        }
        setTokenError(null);
        void run(
          () => connectBankAction({ provider: choice === 'manual' ? 'manual' : 'mercury', environment, apiToken: choice === 'mercury' && environment === 'sandbox' ? token.trim() : undefined }),
          (d) =>
            choice === 'manual'
              ? { variant: 'success', title: 'Done — you’ll pay grants outside GMS', detail: 'Record payments on the Record payments page so balances and reports stay accurate.' }
              : {
                  variant: d.webhook === 'active' ? 'success' : 'warning',
                  title: `Connected. Found ${d.accounts} account${d.accounts === 1 ? '' : 's'}.`,
                  detail: d.webhook === 'active' ? 'Bank updates will arrive by webhook.' : `The webhook couldn’t be registered (${d.webhook}). GMS will still check for updates every few minutes.`,
                },
          { stepUp: true },
        ).then((ok) => {
          if (ok) setToken('');
        });
      }}
    >
      {connected ? (
        <Alert variant="warning" title="This replaces your current connection">
          You’re connected to {connected.provider === 'manual' ? 'paying outside GMS' : `Mercury (${connected.environment === 'fake' ? 'simulated' : connected.environment})`}. Connecting again disconnects it; existing payments keep their history.
        </Alert>
      ) : null}
      <FieldSet legend="How do you pay grants?">
        <RadioGroup value={choice} onValueChange={(v) => setChoice(v as Choice)} className="grid gap-3">
          <RadioOption
            value="mercury"
            label="Mercury — API token"
            description="GMS asks Mercury to send each approved payment; a person approves every request in Mercury. Your token goes straight into the secret store and is never shown again."
          />
          <RadioOption
            value="mercury_oauth"
            disabled
            label={
              <span className="inline-flex flex-wrap items-center gap-2">
                Mercury — sign in with Mercury (OAuth)
                <Badge variant="muted">{oauthPreview ? 'Preview enabled — not available yet' : 'Requires Mercury partner approval'}</Badge>
              </span>
            }
            description="Connect without copying a token. Available once Mercury approves GMS as a partner."
          />
          <RadioOption value="manual" label="Pay outside GMS" description="Use your own bank portal, checks or a fiscal host. You record payments in GMS (one at a time or by CSV) so awards and reports stay accurate." />
        </RadioGroup>
      </FieldSet>

      {choice === 'mercury' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Environment" htmlFor={ids.env} description="Live money movement is not available in this version.">
            <Select value={environment} onValueChange={(v) => setEnvironment(v as 'fake' | 'sandbox')}>
              <SelectTrigger id={ids.env}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fake">Simulated bank (try GMS safely)</SelectItem>
                <SelectItem value="sandbox">Mercury sandbox</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {environment === 'sandbox' ? (
            <Field label="Mercury sandbox API token" htmlFor={ids.token} required error={tokenError} description="Create a read-write token with “request send money” permission in Mercury’s sandbox dashboard.">
              <Input id={ids.token} type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} />
            </Field>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" pending={pending} pendingLabel="Connecting…" disabled={choice === 'mercury_oauth'}>
          <KeyRound aria-hidden="true" /> {choice === 'manual' ? 'Pay outside GMS' : 'Connect Mercury'}
        </Button>
        <span className="text-sm text-muted-foreground">You’ll confirm with your authenticator app.</span>
      </div>
      <FeedbackRegion feedback={feedback} />
      {dialog}
    </form>
  );
}

export interface MappingProgram {
  id: string;
  name: string;
  bankAccountId: string | null;
}

export interface MappingAccount {
  id: string;
  name: string;
  mask: string | null;
  availableCents: number | null;
}

function MappingRow({ program, accounts, canWrite }: { program: MappingProgram; accounts: MappingAccount[]; canWrite: boolean }) {
  const [value, setValue] = React.useState(program.bankAccountId ?? '');
  const { run, pending, feedback, dialog } = useRunner({ reason: 'Changing which account pays a program is people-only, so we check your authenticator app first.', actionLabel: 'Save' });
  const id = React.useId();
  const dirty = value && value !== program.bankAccountId;
  return (
    <TableRow>
      <TableCell className="font-medium">
        <label htmlFor={id}>{program.name}</label>
      </TableCell>
      <TableCell>
        <Select value={value} onValueChange={setValue} disabled={!canWrite}>
          <SelectTrigger id={id} size="sm" className="min-w-64">
            <SelectValue placeholder="Not set (the batch builder asks)" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
                {a.mask ? ` ··${a.mask}` : ''} — {formatMoney(a.availableCents)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FeedbackRegion feedback={feedback} className="mt-1" />
        {dialog}
      </TableCell>
      <TableCell className="text-right">
        {canWrite ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!dirty}
            pending={pending}
            pendingLabel="Saving…"
            onClick={() => run(() => mapProgramAccountAction({ programId: program.id, bankAccountId: value }), () => ({ variant: 'success', title: 'Saved.' }), { stepUp: true })}
          >
            Save<span className="sr-only"> paying account for {program.name}</span>
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

export function ProgramAccountMapping({ programs, accounts, canWrite }: { programs: MappingProgram[]; accounts: MappingAccount[]; canWrite: boolean }) {
  if (!accounts.length) return <p className="text-sm text-muted-foreground">No bank accounts yet. Refresh balances after connecting.</p>;
  if (!programs.length) return <p className="text-sm text-muted-foreground">Create a program to choose which account pays it.</p>;
  return (
    <Table containerLabel="Program paying accounts">
      <TableHeader>
        <TableRow>
          <TableHead>Program</TableHead>
          <TableHead>Pays from</TableHead>
          <TableHead className="text-right">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {programs.map((p) => (
          <MappingRow key={p.id} program={p} accounts={accounts} canWrite={canWrite} />
        ))}
      </TableBody>
    </Table>
  );
}
