// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Alert, Button, Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, toast, ToneChip } from '@gms/ui';
import { CircleX, Clock, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useStepUp } from '@/components/console/step-up';
import { grantSupportAccessAction, revokeSupportAccessAction } from './actions';

export interface SupportGrantRow {
  id: string;
  operator: string;
  reason: string;
  grantedBy: string | null;
  createdAt: string;
  expiresAt: string;
  active: boolean;
  revokedAt: string | null;
}

export function SupportAccess({ grants, operators, canEdit, timeZone }: { grants: SupportGrantRow[]; operators: { id: string; label: string }[]; canEdit: boolean; timeZone: string }) {
  const router = useRouter();
  const { withStepUp, dialog } = useStepUp({ reason: 'Letting someone outside your foundation see your data is a people-only action, so we check your authenticator app first.', actionLabel: 'Grant access' });
  const [operator, setOperator] = useState(operators[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState('24');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fmt = (iso: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso));
  const active = grants.filter((g) => g.active);
  const past = grants.filter((g) => !g.active);

  return (
    <div className="grid gap-4">
      {dialog}
      {active.length ? (
        <ul className="grid gap-2" aria-label="Active support access">
          {active.map((g) => (
            <li key={g.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-status-warning-border bg-status-warning-bg/40 p-3 text-sm" data-testid="support-grant-active">
              <div className="grid gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <ToneChip tone="warning" icon={ShieldCheck} label="Support access on" size="sm" />
                  <strong>{g.operator}</strong>
                </span>
                <span>“{g.reason}”</span>
                <span className="text-xs text-muted-foreground">
                  Granted {g.grantedBy ? `by ${g.grantedBy} ` : ''}on {fmt(g.createdAt)} · ends {fmt(g.expiresAt)}
                </span>
              </div>
              {canEdit ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending || g.id === 'preview-grant'}
                  onClick={() =>
                    start(async () => {
                      const r = await revokeSupportAccessAction(g.id);
                      if (r.ok) {
                        toast.success('Support access ended.');
                        router.refresh();
                      } else toast.error(r.problem.detail);
                    })
                  }
                >
                  End access now
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 text-sm">
          <ToneChip tone="muted" icon={CircleX} label="No support access" size="sm" /> Operators can see your workspace’s name, plan and usage counts, but none of your data.
        </p>
      )}

      {canEdit ? (
        operators.length ? (
          <form
            className="grid gap-4 rounded-xl border bg-card p-4 lg:grid-cols-2"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              const h = Number(hours);
              if (!operator) return setError('Choose who needs access.');
              if (reason.trim().length < 10) return setError('Say why access is needed (at least 10 characters), for example a ticket number and the problem.');
              if (!Number.isInteger(h) || h < 1 || h > 72) return setError('Access can last from 1 to 72 hours.');
              start(async () => {
                const r = await withStepUp(() => grantSupportAccessAction({ operatorUserId: operator, reason: reason.trim(), hours: h }));
                if (r.ok) {
                  toast.success(`Support access granted for ${h} hours.`);
                  setReason('');
                  router.refresh();
                } else if (r.problem.code !== 'step_up_required') setError(r.problem.detail);
              });
            }}
          >
            {error ? (
              <Alert variant="danger" title="Access not granted" role="alert" className="lg:col-span-2">
                {error}
              </Alert>
            ) : null}
            <Field label="Who needs access" htmlFor="support-operator">
              <Select value={operator} onValueChange={setOperator}>
                <SelectTrigger id="support-operator">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {operators.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="For how many hours" htmlFor="support-hours" description="1 to 72 hours. You can end it early.">
              <Input id="support-hours" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^\d]/g, ''))} className="max-w-24" />
            </Field>
            <Field label="Reason" htmlFor="support-reason" className="lg:col-span-2" description="Recorded in your audit log with every view they make.">
              <Textarea id="support-reason" rows={2} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} placeholder="Ticket 4821: payment batch stuck in “Submitting to bank”." />
            </Field>
            <Button type="submit" className="justify-self-start" pending={pending} pendingLabel="Granting…">
              <Clock aria-hidden="true" /> Grant time-boxed access
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">This deployment has no platform operators, so there’s no one to grant access to.</p>
        )
      ) : null}

      {past.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Past access ({past.length})</summary>
          <ul className="mt-2 grid gap-1 text-muted-foreground">
            {past.map((g) => (
              <li key={g.id}>
                {g.operator} · “{g.reason}” · {fmt(g.createdAt)} – {g.revokedAt ? `ended early ${fmt(g.revokedAt)}` : `expired ${fmt(g.expiresAt)}`}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
