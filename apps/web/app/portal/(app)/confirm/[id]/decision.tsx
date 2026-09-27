// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import type { RiskTier } from '@gms/domain';
import { Alert, ApprovalRequestCard, Button, CheckboxField, type ApprovalChange } from '@gms/ui';
import Link from 'next/link';
import { useState } from 'react';
import { decide } from './actions';

export interface ConfirmView {
  id: string;
  title: string;
  summary: string;
  requester: { name: string; onBehalfOfName: string | null };
  requestedAt: string;
  expiresAt: string;
  timeZone: string;
  risk: RiskTier;
  changes: ApprovalChange[];
  applicantSupplied: { label: string; text: string }[];
  attestation: string | null;
  status: string;
  entityHref: string | null;
}

export function ConfirmDecision({ view, token }: { view: ConfirmView; token: string | null }) {
  const [agreed, setAgreed] = useState(false);
  const [done, setDone] = useState<null | { status: string; error?: string }>(null);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return done.status === 'confirmed' ? (
      <Alert variant="success" title="Done — you confirmed it">
        <p>GMS carried out the request. {view.entityHref ? <Link className="underline" href={view.entityHref}>See the result</Link> : null}</p>
      </Alert>
    ) : done.status === 'rejected' ? (
      <Alert variant="info" title="You said no">
        <p>Nothing was changed. The agent will be told the request was rejected.</p>
      </Alert>
    ) : (
      <Alert variant="danger" title="We couldn’t finish this">
        <p>{done.error ?? 'Something went wrong.'} Nothing was submitted. You can do it yourself from your dashboard.</p>
      </Alert>
    );
  }

  const run = async (decision: 'confirm' | 'reject') => {
    setError(null);
    const r = await decide(view.id, decision, token, null);
    if (!r.ok) setError(r.problem.detail);
    else setDone({ status: r.status, error: r.error });
  };

  return (
    <div className="grid gap-4">
      {error ? <Alert variant="danger" title="That didn’t work">{error}</Alert> : null}
      <ApprovalRequestCard
        title={view.title}
        requester={{ type: 'agent', name: view.requester.name, onBehalfOfName: view.requester.onBehalfOfName }}
        requestedAt={view.requestedAt}
        timeZone={view.timeZone}
        risk={view.risk}
        expiresAt={view.expiresAt}
        reason={view.summary}
        changes={view.changes}
        applicantSupplied={view.applicantSupplied.map((a) => ({ source: a.label, text: a.text }))}
        attestation={
          view.attestation ? (
            <CheckboxField id="attest" size="lg" label={view.attestation} checked={agreed} onCheckedChange={(c) => setAgreed(c === true)} />
          ) : null
        }
        confirmDisabled={Boolean(view.attestation) && !agreed}
        onConfirm={() => run('confirm')}
        onReject={() => run('reject')}
        state={view.status === 'awaiting_confirmation' ? undefined : (view.status as 'confirmed' | 'rejected' | 'expired' | 'failed')}
      />
      <Button asChild variant="ghost" className="justify-self-start">
        <Link href="/portal">Back to my dashboard</Link>
      </Button>
    </div>
  );
}
