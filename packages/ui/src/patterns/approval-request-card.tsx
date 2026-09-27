// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { formatInZone, type Actor, type RiskTier } from '@gms/domain';
import { Check, Clock, X } from 'lucide-react';
import * as React from 'react';
import { Button } from '../components/button';
import { cn } from '../lib/utils';
import { ActorBadge } from './actor-badge';
import { ApplicantSuppliedQuote } from './applicant-supplied-quote';
import { RiskChip } from './risk-chip';
import { StatusChip } from './status-chip';
import { useNow } from './use-now';

export interface ApprovalChange {
  /** Human label of the field, e.g. "Amount". */
  field: string;
  /** Current value (omit for new records). */
  before?: React.ReactNode;
  /** Proposed value. */
  after: React.ReactNode;
}

export interface ApplicantSuppliedExcerpt {
  fieldLabel?: string;
  source?: string;
  text: string;
}

export type ApprovalState = 'awaiting_confirmation' | 'confirmed' | 'rejected' | 'expired' | 'failed';

export interface ApprovalRequestCardProps extends Omit<React.ComponentProps<'article'>, 'title'> {
  /** What will happen, as a sentence: "Send award letter to Riverbend Food Pantry". */
  title: React.ReactNode;
  requester: Pick<Actor, 'type' | 'name' | 'onBehalfOfName'>;
  requestedAt: string;
  timeZone: string;
  risk: RiskTier;
  /** When the request lapses (ISO). Buttons disable once passed. */
  expiresAt?: string | null;
  /** Why the requester asked, in their words or the system's. */
  reason?: React.ReactNode;
  /** The exact fields that will change. */
  changes: ApprovalChange[];
  /** Applicant-written text the request relies on; always quoted and labeled. */
  applicantSupplied?: ApplicantSuppliedExcerpt[];
  /** Slot for an attestation checkbox (e.g. "I have checked the bank details with the grantee"). */
  attestation?: React.ReactNode;
  /** Disable Confirm, e.g. until the attestation is checked. */
  confirmDisabled?: boolean;
  onConfirm?: () => void | Promise<void>;
  onReject?: () => void | Promise<void>;
  confirmLabel?: string;
  rejectLabel?: string;
  /** Final state once decided; hides the buttons. */
  state?: ApprovalState;
  /** Server time for the first render (avoids a countdown flash). */
  now?: Date;
}

function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * An agent's (or colleague's) request that a person confirms inside GMS. Shows exactly what will
 * change, who asked, the risk tier, and quoted applicant text; the person holds the pen.
 */
export function ApprovalRequestCard({
  title,
  requester,
  requestedAt,
  timeZone,
  risk,
  expiresAt,
  reason,
  changes,
  applicantSupplied = [],
  attestation,
  confirmDisabled = false,
  onConfirm,
  onReject,
  confirmLabel = 'Confirm',
  rejectLabel = 'Reject',
  state = 'awaiting_confirmation',
  now: initialNow,
  className,
  ...props
}: ApprovalRequestCardProps) {
  const now = useNow(1000, initialNow);
  const [pending, setPending] = React.useState<'confirm' | 'reject' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const expiry = expiresAt ? new Date(expiresAt) : null;
  const msLeft = expiry ? expiry.getTime() - now.getTime() : Infinity;
  const expired = state === 'expired' || msLeft <= 0;
  const open = state === 'awaiting_confirmation' && !expired;
  const headingId = React.useId();

  const run = async (which: 'confirm' | 'reject', fn?: () => void | Promise<void>) => {
    if (!fn) return;
    setPending(which);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'That didn’t go through. Try again.');
    } finally {
      setPending(null);
    }
  };

  return (
    <article
      data-slot="approval-request"
      aria-labelledby={headingId}
      className={cn('grid gap-4 rounded-lg border bg-card p-5 text-card-foreground shadow-soft', className)}
      {...props}
    >
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <RiskChip tier={risk} />
          <StatusChip kind="agentAction" value={expired && state === 'awaiting_confirmation' ? 'expired' : state} />
          {expiry && open ? (
            <span className={cn('inline-flex items-center gap-1 text-xs tabular-nums', msLeft < 5 * 60_000 ? 'text-status-danger-fg' : 'text-muted-foreground')}>
              <Clock className="size-3.5" aria-hidden="true" />
              <span suppressHydrationWarning>Expires in {countdown(msLeft)}</span>
              <span className="sr-only">, at {formatInZone(expiry, timeZone)}</span>
            </span>
          ) : null}
        </div>
        <h3 id={headingId} className="font-heading text-base leading-snug font-semibold">
          {title}
        </h3>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>Requested by</span>
          <ActorBadge actor={requester} size="sm" />
          <time dateTime={requestedAt} className="tabular-nums">
            · {formatInZone(requestedAt, timeZone)}
          </time>
        </div>
        {reason ? <p className="text-sm">{reason}</p> : null}
      </header>

      <section aria-label="Changes to confirm" className="overflow-hidden rounded-md border">
        <table className="w-full text-sm tabular-nums">
          <caption className="sr-only">Exactly what will change</caption>
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Field
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Now
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                After
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {changes.map((c) => (
              <tr key={c.field}>
                <th scope="row" className="px-3 py-2 text-left align-top font-medium">
                  {c.field}
                </th>
                <td className="px-3 py-2 align-top text-muted-foreground">
                  {c.before === undefined ? (
                    <span className="italic">New</span>
                  ) : (
                    <del className="decoration-status-danger-fg/60">
                      <span className="sr-only">Current value: </span>
                      {c.before}
                    </del>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  <ins className="font-medium no-underline">
                    <span className="sr-only">New value: </span>
                    {c.after}
                  </ins>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {applicantSupplied.length > 0 ? (
        <div className="grid gap-2">
          {applicantSupplied.map((q, i) => (
            <ApplicantSuppliedQuote key={i} fieldLabel={q.fieldLabel} source={q.source} maxLines={6}>
              {q.text}
            </ApplicantSuppliedQuote>
          ))}
        </div>
      ) : null}

      {open && attestation ? <div className="rounded-md bg-muted/50 p-3">{attestation}</div> : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-status-danger-fg">
          {error}
        </p>
      ) : null}

      {open ? (
        <footer className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => run('reject', onReject)}
            pending={pending === 'reject'}
            pendingLabel="Rejecting…"
            disabled={pending !== null || !onReject}
          >
            <X aria-hidden="true" />
            {rejectLabel}
          </Button>
          <Button
            onClick={() => run('confirm', onConfirm)}
            pending={pending === 'confirm'}
            pendingLabel="Confirming…"
            disabled={pending !== null || confirmDisabled || !onConfirm}
          >
            <Check aria-hidden="true" />
            {confirmLabel}
          </Button>
        </footer>
      ) : expired && state === 'awaiting_confirmation' ? (
        <p className="text-sm text-muted-foreground">This request expired. Ask the requester to send it again if it’s still needed.</p>
      ) : null}
    </article>
  );
}
