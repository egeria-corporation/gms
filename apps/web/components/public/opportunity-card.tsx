// SPDX-License-Identifier: AGPL-3.0-only
import { formatInZone, formatMoney } from '@gms/domain';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, DeadlineChip, StatusChip } from '@gms/ui';
import Link from 'next/link';
import type { PublicOpportunity } from '@/lib/public-data';

export function fundingRange(o: Pick<PublicOpportunity, 'awardMinCents' | 'awardMaxCents' | 'currency'>): string | null {
  if (o.awardMinCents && o.awardMaxCents) return `${formatMoney(o.awardMinCents, o.currency, { compact: true })}–${formatMoney(o.awardMaxCents, o.currency, { compact: true })}`;
  if (o.awardMaxCents) return `Up to ${formatMoney(o.awardMaxCents, o.currency, { compact: true })}`;
  if (o.awardMinCents) return `From ${formatMoney(o.awardMinCents, o.currency, { compact: true })}`;
  return null;
}

export function OpportunityCard({ o, timeZone }: { o: PublicOpportunity; timeZone: string }) {
  const range = fundingRange(o);
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip kind="opportunity" value={o.status} />
          {o.programName ? <span className="text-xs text-muted-foreground">{o.programName}</span> : null}
        </div>
        <CardTitle as="h3" className="font-heading text-lg">
          <Link href={`/opportunities/${o.slug}`} className="after:absolute after:inset-0 focus-visible:outline-none">
            {o.title}
          </Link>
        </CardTitle>
        {o.summary ? <CardDescription className="line-clamp-3">{o.summary}</CardDescription> : null}
      </CardHeader>
      <CardContent className="mt-auto grid gap-1 text-sm">
        {range ? (
          <p>
            <span className="text-muted-foreground">Awards: </span>
            <span className="tabular-nums">{range}</span>
          </p>
        ) : null}
        {o.status === 'forecasted' && o.opensAt ? (
          <p>
            <span className="text-muted-foreground">Opens </span>
            {formatInZone(o.opensAt, timeZone)}
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="relative">
        {o.closesAt ? <DeadlineChip at={o.closesAt} timeZone={timeZone} label={o.status === 'forecasted' ? 'Deadline' : 'Closes'} /> : <span className="text-sm text-muted-foreground">Rolling deadline</span>}
      </CardFooter>
    </Card>
  );
}
