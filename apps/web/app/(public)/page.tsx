// SPDX-License-Identifier: AGPL-3.0-or-later
// A-01 Foundation landing.
import { formatMoneyShort } from '@gms/domain';
import { BrandPattern, Button, EmptyState, StatTile } from '@gms/ui';
import { ArrowRight, ClipboardCheck, FileText, Send } from 'lucide-react';
import Link from 'next/link';
import { OpportunityCard } from '@/components/public/opportunity-card';
import { Markdown } from '@/lib/markdown';
import { listOpportunities, publicStats } from '@/lib/public-data';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export default async function LandingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tenant = await requireTenant();
  const state = forcedState(await searchParams);
  const [list, stats] = await Promise.all([listOpportunities(tenant, { status: ['open', 'forecasted'], pageSize: 6 }), publicStats(tenant)]);
  const items = state === 'empty' ? [] : list.items;
  return (
    <div className="grid gap-12 pb-12">
      <section aria-labelledby="hero-title" className="relative -mx-4 overflow-hidden rounded-b-xl border-b bg-brand-50 sm:-mx-6 lg:rounded-xl lg:border">
        <BrandPattern color={tenant.brand.resolved.adjusted.primary} seed={3} className="absolute inset-0 opacity-25" aria-hidden="true" />
        <div className="relative grid gap-5 px-6 py-14 sm:px-10 lg:py-20">
          <p className="text-sm font-medium text-brand-800">{tenant.brand.displayName}</p>
          <h1 id="hero-title" className="max-w-3xl font-heading text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Funding for the work that holds our communities together
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            Find an opportunity, check if you’re eligible in two minutes, and apply online. We’ll tell you what happens next at every step.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/opportunities">
                See open opportunities <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/portal">Continue an application</Link>
            </Button>
          </div>
        </div>
      </section>

      <section aria-label="At a glance" className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Open opportunities" value={stats.openCount} />
        <StatTile label="Available now" value={formatMoneyShort(stats.openFundingCents)} />
        <StatTile label="Grants awarded" value={`${stats.awardCount} · ${formatMoneyShort(stats.awardedCents)}`} />
      </section>

      <section aria-labelledby="open-title" className="grid gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="open-title" className="font-heading text-2xl font-semibold">
            Open and upcoming
          </h2>
          <Link className="text-sm text-link underline underline-offset-2" href="/opportunities">
            All opportunities
          </Link>
        </div>
        {items.length ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((o) => (
              <li key={o.id} className="relative">
                <OpportunityCard o={o} timeZone={tenant.timezone} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No open opportunities right now"
            description="New funding rounds are posted here first. Check back soon, or look at the grants we’ve made."
            action={
              <Button asChild variant="secondary">
                <Link href="/awards">See grants awarded</Link>
              </Button>
            }
          />
        )}
      </section>

      <section aria-labelledby="how-title" className="grid gap-5">
        <h2 id="how-title" className="font-heading text-2xl font-semibold">
          How applying works
        </h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: ClipboardCheck, title: '1. Check eligibility', body: 'Answer a few questions to see if an opportunity fits. No account needed.' },
            { icon: FileText, title: '2. Apply online', body: 'Your work saves automatically. Invite teammates to help, and come back anytime.' },
            { icon: Send, title: '3. Hear back', body: 'You get a receipt right away, and we tell you each time your status changes.' },
          ].map((s) => (
            <li key={s.title} className="grid gap-2 rounded-xl border bg-card p-5">
              <s.icon className="size-6 text-brand-700" aria-hidden="true" />
              <h3 className="font-semibold">{s.title}</h3>
              <p className="text-sm text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {tenant.aboutMd ? (
        <section aria-labelledby="about-title" className="grid gap-3">
          <h2 id="about-title" className="font-heading text-2xl font-semibold">
            About {tenant.brand.displayName}
          </h2>
          <Markdown source={tenant.aboutMd} className="max-w-3xl text-base" />
        </section>
      ) : null}
    </div>
  );
}
