// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
// R-05 decision queue table (server-paged via the URL): review aggregates, latest recommendation, final
// decision, and per-row Recommend / Record final decision. Bulk decline uses the shared BulkDeclineDialog.
import { formatInZone } from '@gms/domain';
import { Badge, Button, EmptyState, MoneyDisplay, StatusChip, type ColumnDefFor } from '@gms/ui';
import { ArrowRight, Gavel, MessageSquarePlus, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { BulkDeclineDialog } from '../bulk-decline-dialog';
import { UrlDataTable, type UrlTableState } from '../url-data-table';
import { FinalDecisionDialog, type FinalTarget } from './final-decision-dialog';
import { DecisionOutcomeChip } from './outcome-chips';
import { RecommendDialog, type RecommendTarget } from './recommend-dialog';

export interface DecisionRow {
  id: string;
  reference: string;
  title: string;
  opportunity: string;
  organization: string | null;
  status: string;
  viaAgent: boolean;
  requestedCents: number | null;
  submittedAt: string | null;
  reviewCount: number;
  meanScore: number | null;
  tally: { fund: number; maybe: number; decline: number };
  recommendation: { outcome: string; amountCents: number | null; reason: string | null; by: string | null; at: string } | null;
  final: { outcome: string; amountCents: number | null; by: string | null; at: string; letterSent: boolean } | null;
  awardId: string | null;
  awardStatus: string | null;
}

const PENDING = ['submitted', 'under_review', 'invited_to_next_stage'];

export function DecisionsTable({
  rows,
  totalRows,
  state,
  canDecide,
  timeZone,
  openFinalFor,
  openBulkWith,
  caption,
}: {
  rows: DecisionRow[];
  totalRows: number;
  state: UrlTableState;
  canDecide: boolean;
  timeZone: string;
  openFinalFor: string | null;
  openBulkWith: string[] | null;
  caption: string;
}) {
  const [recommendFor, setRecommendFor] = useState<RecommendTarget | null>(null);
  const [finalFor, setFinalFor] = useState<FinalTarget | null>(() => {
    const r = openFinalFor ? rows.find((x) => x.id === openFinalFor) : null;
    return r ? toFinal(r) : null;
  });
  const [bulk, setBulk] = useState<{ ids: string[]; labels: string[] } | null>(() => {
    if (!openBulkWith?.length) return null;
    const picked = rows.filter((r) => openBulkWith.includes(r.id));
    return { ids: picked.map((r) => r.id), labels: picked.map((r) => `${r.reference} ${r.organization ?? r.title}`) };
  });

  const columns = useMemo<ColumnDefFor<DecisionRow>[]>(
    () => [
      {
        id: 'reference',
        accessorKey: 'reference',
        header: 'Application',
        meta: { alwaysVisible: true },
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="grid min-w-52 gap-0.5">
              <Link href={`/console/applications/${r.id}`} className="font-medium hover:underline">
                {r.title}
              </Link>
              <span className="text-xs text-muted-foreground">
                {r.reference} · {r.organization ?? 'Individual applicant'}
              </span>
              <span className="flex flex-wrap gap-1">
                <StatusChip kind="application" value={r.status} size="sm" />
                {r.viaAgent ? <Badge variant="agent">Via agent</Badge> : null}
              </span>
            </div>
          );
        },
      },
      {
        id: 'requested',
        accessorKey: 'requestedCents',
        header: 'Requested',
        meta: { align: 'right' },
        cell: ({ row }) => <MoneyDisplay cents={row.original.requestedCents} compact />,
      },
      {
        id: 'score',
        accessorKey: 'meanScore',
        header: 'Reviews',
        meta: { align: 'right', label: 'Mean weighted score' },
        cell: ({ row }) => {
          const r = row.original;
          if (!r.reviewCount) return <span className="text-xs text-muted-foreground">No submitted reviews</span>;
          return (
            <div className="grid justify-items-end gap-0.5 text-xs">
              <span className="text-sm font-medium tabular-nums">
                {r.meanScore?.toFixed(1) ?? '—'}
                <span className="font-normal text-muted-foreground"> / 100</span>
              </span>
              <span className="text-muted-foreground">
                {r.reviewCount} review{r.reviewCount === 1 ? '' : 's'}
              </span>
              <span className="text-muted-foreground" aria-label={`Reviewer recommendations: ${r.tally.fund} fund, ${r.tally.maybe} maybe, ${r.tally.decline} decline`}>
                Fund {r.tally.fund} · Maybe {r.tally.maybe} · Decline {r.tally.decline}
              </span>
            </div>
          );
        },
      },
      {
        id: 'recommended',
        accessorFn: (r) => r.recommendation?.amountCents ?? null,
        header: 'Latest recommendation',
        meta: { label: 'Latest recommendation' },
        cell: ({ row }) => {
          const rec = row.original.recommendation;
          if (!rec) return <span className="text-xs text-muted-foreground">None yet</span>;
          return (
            <div className="grid max-w-72 gap-0.5 text-xs">
              <span className="flex items-center gap-2">
                <DecisionOutcomeChip outcome={rec.outcome} />
                {rec.outcome === 'approve' && rec.amountCents !== null ? <MoneyDisplay cents={rec.amountCents} compact className="text-sm font-medium" /> : null}
              </span>
              {rec.reason ? <span className="line-clamp-2 text-foreground">{rec.reason}</span> : null}
              <span className="text-muted-foreground">
                {rec.by ?? 'Someone'} · {formatInZone(rec.at, timeZone, { withZone: false })}
              </span>
            </div>
          );
        },
      },
      {
        id: 'final',
        accessorFn: (r) => r.final?.outcome ?? null,
        header: 'Final decision',
        enableSorting: false,
        cell: ({ row }) => {
          const f = row.original.final;
          if (!f) return <span className="text-xs text-muted-foreground">Not recorded</span>;
          return (
            <div className="grid gap-0.5 text-xs">
              <span className="flex items-center gap-2">
                <DecisionOutcomeChip outcome={f.outcome} final />
                {f.outcome === 'approve' && f.amountCents !== null ? <MoneyDisplay cents={f.amountCents} compact className="text-sm font-medium" /> : null}
              </span>
              <span className="text-muted-foreground">
                {f.by ?? 'Someone'} · {formatInZone(f.at, timeZone, { withZone: false })}
                {f.letterSent ? ' · letter sent' : ''}
              </span>
            </div>
          );
        },
      },
      {
        id: 'actions',
        header: 'Actions',
        enableSorting: false,
        enableHiding: false,
        meta: { alwaysVisible: true, align: 'right' },
        cell: ({ row }) => {
          const r = row.original;
          const pending = PENDING.includes(r.status);
          return (
            <div className="flex flex-wrap justify-end gap-1.5">
              {pending && canDecide ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => setRecommendFor(toRecommend(r))} aria-label={`Recommend a decision for ${r.reference}`}>
                    <MessageSquarePlus aria-hidden="true" /> Recommend
                  </Button>
                  <Button size="sm" onClick={() => setFinalFor(toFinal(r))} aria-label={`Record the final decision for ${r.reference}`}>
                    <Gavel aria-hidden="true" /> Record final
                  </Button>
                </>
              ) : null}
              {r.status === 'awarded' ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/console/decisions/${r.id}/award`} aria-label={`Award builder for ${r.reference}`}>
                    {r.awardStatus === 'active' ? 'Award' : 'Build award'} <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              ) : null}
              {pending && !canDecide ? (
                <span className="text-xs text-muted-foreground">View only (program staff decide)</span>
              ) : null}
            </div>
          );
        },
      },
    ],
    [canDecide, timeZone],
  );

  return (
    <>
      <UrlDataTable<DecisionRow>
        caption={caption}
        columns={columns}
        data={rows}
        state={state}
        totalRows={totalRows}
        getRowId={(r) => r.id}
        getRowLabel={(r) => `${r.reference} ${r.organization ?? r.title}`}
        itemLabel="applications"
        searchPlaceholder="Search reference, title or organization"
        enableRowSelection={canDecide ? (row) => PENDING.includes(row.original.status) : false}
        bulkActions={
          canDecide
            ? (selected, clear) => (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setBulk({ ids: selected.map((s) => s.id), labels: selected.map((s) => `${s.reference} ${s.organization ?? s.title}`) });
                    clear();
                  }}
                >
                  <XCircle aria-hidden="true" /> Decline {selected.length} with letter…
                </Button>
              )
            : undefined
        }
        emptyState={<EmptyState variant="inline" level={3} title="No applications match" description="Try another opportunity or recommendation filter, or clear the search." />}
      />
      <RecommendDialog target={recommendFor} open={recommendFor !== null} onOpenChange={(o) => (o ? null : setRecommendFor(null))} />
      <FinalDecisionDialog target={finalFor} open={finalFor !== null} onOpenChange={(o) => (o ? null : setFinalFor(null))} />
      <BulkDeclineDialog open={bulk !== null} onOpenChange={(o) => (o ? null : setBulk(null))} applicationIds={bulk?.ids ?? []} labels={bulk?.labels ?? []} />
    </>
  );
}

function toRecommend(r: DecisionRow): RecommendTarget {
  return {
    id: r.id,
    reference: r.reference,
    title: r.title,
    requestedCents: r.requestedCents,
    current: r.recommendation ? { outcome: r.recommendation.outcome, amountCents: r.recommendation.amountCents, reason: r.recommendation.reason } : null,
  };
}

function toFinal(r: DecisionRow): FinalTarget {
  return {
    id: r.id,
    reference: r.reference,
    title: r.title,
    organization: r.organization,
    requestedCents: r.requestedCents,
    recommendation: r.recommendation ? { outcome: r.recommendation.outcome, amountCents: r.recommendation.amountCents, reason: r.recommendation.reason } : null,
  };
}
