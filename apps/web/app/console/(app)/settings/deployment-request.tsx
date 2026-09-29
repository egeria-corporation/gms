// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// Hosted service: foundations use {slug}.{root domain}; anyone needing their own domain or a dedicated deployment
// asks the platform team here.
import { Alert, Button, Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, toast, ToneChip } from '@gms/ui';
import { CircleCheck, Clock, Inbox } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { requestCustomDeploymentAction } from './actions';

export interface DeploymentRequestRow {
  id: string;
  kind: 'custom_domain' | 'dedicated' | 'other';
  desiredDomain: string | null;
  status: 'new' | 'in_review' | 'closed';
  createdAt: string;
}

const KIND_LABELS: Record<DeploymentRequestRow['kind'], string> = {
  custom_domain: 'Our own domain',
  dedicated: 'A dedicated deployment',
  other: 'Something else',
};

const STATUS: Record<DeploymentRequestRow['status'], { label: string; tone: 'info' | 'progress' | 'muted'; icon: typeof Inbox }> = {
  new: { label: 'Sent', tone: 'info', icon: Inbox },
  in_review: { label: 'In review', tone: 'progress', icon: Clock },
  closed: { label: 'Closed', tone: 'muted', icon: CircleCheck },
};

export function DeploymentRequest({
  requests,
  canEdit,
  defaultEmail,
  host,
  timeZone,
}: {
  requests: DeploymentRequestRow[];
  canEdit: boolean;
  defaultEmail: string;
  host: string;
  timeZone: string;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<DeploymentRequestRow['kind']>('custom_domain');
  const [domain, setDomain] = useState('');
  const [details, setDetails] = useState('');
  const [email, setEmail] = useState(defaultEmail);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fmt = (iso: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone }).format(new Date(iso));

  return (
    <div className="grid gap-5">
      <p className="text-sm">
        Your foundation’s GMS lives at <strong>{host}</strong>. If you need your own domain or a dedicated deployment, tell us what you need and
        we’ll reply by email.
      </p>
      {requests.length ? (
        <ul className="grid gap-2" aria-label="Your requests">
          {requests.map((r) => {
            const s = STATUS[r.status];
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3 text-sm">
                <span>
                  {KIND_LABELS[r.kind]}
                  {r.desiredDomain ? ` · ${r.desiredDomain}` : ''} · {fmt(r.createdAt)}
                </span>
                <ToneChip tone={s.tone} icon={s.icon} label={s.label} size="sm" />
              </li>
            );
          })}
        </ul>
      ) : null}
      {canEdit ? (
        <form
          className="grid max-w-2xl gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            start(async () => {
              const r = await requestCustomDeploymentAction({ kind, desiredDomain: kind === 'custom_domain' ? domain : '', details, contactEmail: email });
              if (r.ok) {
                toast.success('Request sent. We’ll reply by email.');
                setDetails('');
                setDomain('');
                router.refresh();
              } else setError(r.problem.detail ?? 'We couldn’t send your request.');
            });
          }}
        >
          {error ? (
            <Alert variant="danger" title="Not sent" role="alert">
              {error}
            </Alert>
          ) : null}
          <Field label="What do you need?" htmlFor="deploy-kind" required>
            <Select value={kind} onValueChange={(v) => setKind(v as DeploymentRequestRow['kind'])}>
              <SelectTrigger id="deploy-kind" className="max-w-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(KIND_LABELS) as DeploymentRequestRow['kind'][]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {kind === 'custom_domain' ? (
            <Field label="Domain you’d like to use" htmlFor="deploy-domain" description="For example, grants.yourfoundation.org.">
              <Input id="deploy-domain" value={domain} onChange={(e) => setDomain(e.target.value)} autoComplete="off" spellCheck={false} className="max-w-sm" />
            </Field>
          ) : null}
          <Field label="Tell us more" htmlFor="deploy-details" description="What you need and why, and any timing we should know about." required>
            <Textarea id="deploy-details" value={details} onChange={(e) => setDetails(e.target.value)} rows={4} maxLength={4000} />
          </Field>
          <Field label="Where should we reply?" htmlFor="deploy-email" required>
            <Input id="deploy-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="max-w-sm" />
          </Field>
          <Button type="submit" className="justify-self-start" pending={pending} pendingLabel="Sending…">
            Send request
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">Only owners and admins can send a request.</p>
      )}
    </div>
  );
}
