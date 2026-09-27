// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Alert, ApprovalRequestCard, CheckboxField, toast } from '@gms/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { decideApprovalAction } from './actions';
import type { ApprovalView } from './shared';

/** An agent request with Confirm / Reject for people allowed to decide it; read-only otherwise. */
export function ApprovalCard({ view, timeZone, now, showLink = false }: { view: ApprovalView; timeZone: string; now: string; showLink?: boolean }) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [outcome, setOutcome] = useState<null | { status: string; error?: string }>(null);
  const status = (outcome?.status ?? view.status) as ApprovalView['status'];
  const preview = view.id.startsWith('preview-');

  const run = async (decision: 'confirm' | 'reject') => {
    if (preview) throw new Error('This is a preview request. Nothing was changed.');
    const r = await decideApprovalAction(view.id, decision, null);
    if (!r.ok) throw new Error(r.problem.detail);
    setOutcome({ status: r.status, error: r.error });
    if (r.status === 'confirmed') toast.success(`Confirmed: ${view.title}`);
    else if (r.status === 'rejected') toast.info('Rejected. Nothing was changed.');
    else toast.error(r.error ?? 'Confirmed, but it couldn’t be carried out.');
    router.refresh();
  };

  return (
    <div className="grid gap-2">
      <ApprovalRequestCard
        title={
          showLink ? (
            <Link href={`/console/approvals/${view.id}`} className="hover:underline">
              {view.title}
            </Link>
          ) : (
            view.title
          )
        }
        requester={{ type: 'agent', name: view.requesterName, onBehalfOfName: view.onBehalfOfName }}
        requestedAt={view.requestedAt}
        timeZone={timeZone}
        risk={view.risk}
        expiresAt={view.expiresAt}
        reason={view.summary}
        changes={view.changes.length ? view.changes : [{ field: 'Action', after: view.actionId }]}
        applicantSupplied={view.applicantSupplied.map((a) => ({ source: a.label, text: a.text }))}
        attestation={view.attestation && view.canDecide ? <CheckboxField id={`attest-${view.id}`} label={view.attestation} checked={agreed} onCheckedChange={(c) => setAgreed(c === true)} /> : null}
        confirmDisabled={Boolean(view.attestation) && !agreed}
        onConfirm={view.canDecide ? () => run('confirm') : undefined}
        onReject={view.canDecide ? () => run('reject') : undefined}
        state={status}
        now={new Date(now)}
      />
      {!view.canDecide && status === 'awaiting_confirmation' ? (
        <p className="text-sm text-muted-foreground">
          {view.audience === 'staff' ? 'Only an owner or admin, or the person the agent acts for, can decide this.' : `Only ${view.onBehalfOfName ?? 'the person the agent acts for'} can decide this.`}
        </p>
      ) : null}
      {status === 'confirmed' ? (
        <Alert variant="success" title="Confirmed — GMS carried out the request" role="status">
          {view.entityHref ? (
            <Link href={view.entityHref} className="underline">
              See the result
            </Link>
          ) : (
            'The agent will see that it went through.'
          )}
        </Alert>
      ) : status === 'rejected' ? (
        <Alert variant="info" title="Rejected — nothing was changed" role="status">
          The agent is told the request was rejected.
        </Alert>
      ) : status === 'failed' ? (
        <Alert variant="danger" title="Confirmed, but it couldn’t be carried out" role="status">
          {outcome?.error ?? view.resultError ?? 'Something went wrong.'} Nothing was changed. You can do it yourself in GMS.
        </Alert>
      ) : null}
    </div>
  );
}
