// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// E-01 docket items: order (Move up / Move down → board.reorder_docket with the full ordered list), remove
// (board.remove_docket_item), amounts, review aggregates, vote tallies with voters, and outcomes after close.
import { Button, MoneyDisplay, StatusChip, cn } from '@gms/ui';
import { ArrowDown, ArrowRight, ArrowUp, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { removeDocketItemAction, reorderDocketAction } from '@/app/console/(app)/dockets/actions';
import { ConfirmActionButton, useRunAction } from '../run-action';
import { DocketOutcomeChip, VoteChip } from '../decisions/outcome-chips';

export interface DocketItemView {
  id: string;
  applicationId: string;
  position: number;
  reference: string;
  title: string;
  organization: string | null;
  opportunity: string;
  requestedCents: number | null;
  recommendedCents: number | null;
  recommendation: string | null;
  outcome: string | null;
  applicationStatus: string;
  reviews: { count: number; average: number | null; min: number | null; max: number | null };
  tally: { approve: number; decline: number; abstain: number; recuse: number };
  voters: { name: string; vote: string; at: string }[];
}

export function DocketItems({
  docketId,
  items,
  editable,
  status,
  quorum,
  totalRecommendedCents,
}: {
  docketId: string;
  items: DocketItemView[];
  editable: boolean;
  status: string;
  quorum: number;
  totalRecommendedCents: number;
}) {
  const { run, pending } = useRunAction();
  const [order, setOrder] = useState(items);
  const [announce, setAnnounce] = useState('');
  useEffect(() => setOrder(items), [items]);

  const move = (idx: number, by: -1 | 1) => {
    const j = idx + by;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    const prev = order;
    setOrder(next);
    const moved = next[j]!;
    setAnnounce(`${moved.reference} moved to position ${j + 1} of ${next.length}.`);
    void run(() => reorderDocketAction(docketId, next.map((i) => i.id))).then((r) => {
      if (!r.ok) setOrder(prev);
      else requestAnimationFrame(() => document.getElementById(`move-${by < 0 ? 'up' : 'down'}-${moved.id}`)?.focus());
    });
  };

  return (
    <section aria-labelledby="docket-items-heading" className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="docket-items-heading" className="font-heading text-lg font-semibold">
          Items in discussion order
        </h2>
        <p className="text-sm text-muted-foreground">
          Total recommended <MoneyDisplay cents={totalRecommendedCents} className="font-medium text-foreground" />
        </p>
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <ol className="grid gap-3">
        {order.map((it, idx) => {
          const present = it.tally.approve + it.tally.decline + it.tally.abstain;
          return (
            <li key={it.id} className={cn('grid gap-3 rounded-lg border bg-card p-4 shadow-soft', pending && 'opacity-90')}>
              <div className="flex flex-wrap items-start gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold tabular-nums" aria-hidden="true">
                  {idx + 1}
                </span>
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <h3 className="font-medium">
                    <span className="sr-only">Item {idx + 1}: </span>
                    <Link href={`/console/applications/${it.applicationId}`} className="hover:underline">
                      {it.organization ?? 'Individual applicant'} — {it.title}
                    </Link>
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {it.reference} · {it.opportunity}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip kind="application" value={it.applicationStatus} size="sm" />
                  {it.outcome ? <DocketOutcomeChip outcome={it.outcome} /> : null}
                </div>
                {editable ? (
                  <div className="flex gap-1">
                    <Button id={`move-up-${it.id}`} variant="ghost" size="icon-sm" disabled={idx === 0 || pending} aria-label={`Move ${it.reference} up`} onClick={() => move(idx, -1)}>
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button id={`move-down-${it.id}`} variant="ghost" size="icon-sm" disabled={idx === order.length - 1 || pending} aria-label={`Move ${it.reference} down`} onClick={() => move(idx, 1)}>
                      <ArrowDown aria-hidden="true" />
                    </Button>
                    <ConfirmActionButton
                      label={<span className="sr-only">Remove {it.reference}</span>}
                      icon={<Trash2 aria-hidden="true" />}
                      variant="ghost"
                      size="icon-sm"
                      title={`Remove ${it.reference} from this docket?`}
                      description="The recommendation stays on the application, so you can add it to this or another docket later."
                      confirmLabel="Remove item"
                      destructive
                      success="Item removed."
                      action={() => removeDocketItemAction(docketId, it.id)}
                    />
                  </div>
                ) : null}
              </div>

              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Requested</dt>
                  <dd>
                    <MoneyDisplay cents={it.requestedCents} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Recommended</dt>
                  <dd className="font-medium">
                    <MoneyDisplay cents={it.recommendedCents} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Review score (of 100)</dt>
                  <dd className="tabular-nums">
                    {it.reviews.count ? (
                      <>
                        {it.reviews.average?.toFixed(1)} avg · {it.reviews.min?.toFixed(1)}–{it.reviews.max?.toFixed(1)} · {it.reviews.count} review{it.reviews.count === 1 ? '' : 's'}
                      </>
                    ) : (
                      <span className="text-muted-foreground">No submitted reviews</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Votes</dt>
                  <dd className="tabular-nums">
                    {status === 'draft' || status === 'published' ? (
                      <span className="text-muted-foreground">Voting not open</span>
                    ) : (
                      <>
                        Approve {it.tally.approve} · Decline {it.tally.decline} · Abstain {it.tally.abstain} · Recuse {it.tally.recuse}
                        <span className={cn('block text-xs', present >= quorum ? 'text-status-success-fg' : 'text-muted-foreground')}>
                          {present} of {quorum} needed for quorum
                        </span>
                      </>
                    )}
                  </dd>
                </div>
              </dl>

              {it.recommendation ? (
                <p className="text-sm">
                  <span className="text-muted-foreground">Staff recommendation: </span>
                  {it.recommendation}
                </p>
              ) : null}

              {it.voters.length ? (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">Who voted ({it.voters.length})</summary>
                  <ul className="mt-2 grid gap-1">
                    {it.voters.map((v) => (
                      <li key={`${v.name}-${v.at}`} className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{v.name}</span>
                        <VoteChip vote={v.vote} />
                        <span className="text-xs text-muted-foreground">{v.at}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {status === 'closed' && it.outcome === 'approved' ? (
                <div>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/console/decisions/${it.applicationId}/award`}>
                      Open the award builder <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
