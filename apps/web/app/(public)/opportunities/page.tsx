// SPDX-License-Identifier: AGPL-3.0-or-later
// A-02 Opportunity listing with filters (states: none; mobile sheet).
import { NextLink } from '@/components/next-link';
import { Button, EmptyState, PageHeader, Pagination } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { OpportunityCard } from '@/components/public/opportunity-card';
import { OpportunityFilters } from '@/components/public/opportunity-filters';
import { listOpportunities } from '@/lib/public-data';
import { forcedState, many, one } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Funding opportunities' };

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tenant = await requireTenant();
  const sp = await searchParams;
  const filters = { q: one(sp.q) ?? '', status: many(sp.status), cause: many(sp.cause), geography: many(sp.geography) };
  const page = Number(one(sp.page) ?? 1) || 1;
  const res = await listOpportunities(tenant, { ...filters, page });
  const items = forcedState(sp) === 'none' ? [] : res.items;
  const active = filters.status.length + filters.cause.length + filters.geography.length + (filters.q ? 1 : 0);
  const qs = (p: number) => {
    const u = new URLSearchParams();
    if (filters.q) u.set('q', filters.q);
    for (const s of filters.status) u.append('status', s);
    for (const c of filters.cause) u.append('cause', c);
    for (const g of filters.geography) u.append('geography', g);
    u.set('page', String(p));
    return `/opportunities?${u.toString()}`;
  };
  return (
    <div className="grid gap-8 pb-12">
      <PageHeader
        title="Funding opportunities"
        description={`Current and upcoming grants from ${tenant.brand.displayName}. Deadlines are shown in ${tenant.timezone.replace('_', ' ')} time.`}
        density="spacious"
      />
      <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
        <aside aria-label="Filters">
          <OpportunityFilters facets={res.facets} value={filters} activeCount={active} />
        </aside>
        <div className="grid content-start gap-5">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {items.length ? `${res.total} opportunit${res.total === 1 ? 'y' : 'ies'}` : 'No matches'}
            {active ? ' match your filters' : ''}
          </p>
          {items.length ? (
            <ul className="grid gap-4 md:grid-cols-2">
              {items.map((o) => (
                <li key={o.id} className="relative">
                  <OpportunityCard o={o} timeZone={tenant.timezone} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title={active ? 'Nothing matches those filters' : 'No opportunities are posted yet'}
              description={active ? 'Try removing a filter or searching for a different word.' : 'Check back soon — new rounds are posted here first.'}
              action={
                active ? (
                  <Button asChild variant="secondary">
                    <Link href="/opportunities">Clear filters</Link>
                  </Button>
                ) : undefined
              }
            />
          )}
          {res.total > res.pageSize ? (
            <Pagination page={res.page} pageCount={Math.ceil(res.total / res.pageSize)} getHref={qs} linkComponent={NextLink} total={res.total} pageSize={res.pageSize} itemLabel="opportunities" />
          ) : null}
        </div>
      </div>
    </div>
  );
}
