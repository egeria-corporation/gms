// SPDX-License-Identifier: AGPL-3.0-only
// A-05 Awarded grants (optional transparency, fed by awards; state: empty).
import { NextLink } from '@/components/next-link';
import { formatDateOnly, formatMoneyShort } from '@gms/domain';
import { EmptyState, Input, MoneyDisplay, PageHeader, Pagination, Button, StatTile, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { publicAwards } from '@/lib/public-data';
import { forcedState, one } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Grants awarded' };

export default async function AwardsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tenant = await requireTenant();
  const sp = await searchParams;
  const q = one(sp.q) ?? '';
  const res = await publicAwards(tenant, { page: Number(one(sp.page) ?? 1) || 1, q });
  const items = forcedState(sp) === 'empty' ? [] : res.items;
  return (
    <div className="grid gap-8 pb-16">
      <PageHeader
        density="spacious"
        title="Grants awarded"
        description={`Every grant ${tenant.brand.displayName} has made through this site, published so anyone can see where the money goes.`}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <StatTile label="Grants" value={res.total} />
        <StatTile label="Total awarded" value={formatMoneyShort(res.totalCents)} />
      </div>
      <form method="get" className="flex max-w-md gap-2" role="search">
        <label htmlFor="award-q" className="sr-only">
          Search grantees or projects
        </label>
        <Input id="award-q" name="q" type="search" defaultValue={q} placeholder="" aria-describedby="award-q-hint" />
        <Button type="submit" variant="secondary">
          Search
        </Button>
        <span id="award-q-hint" className="sr-only">
          Search by grantee or project name
        </span>
      </form>
      {items.length ? (
        <div className="overflow-x-auto rounded-xl border">
          <Table containerLabel="Grants awarded">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Grantee</TableHead>
                <TableHead scope="col">Project</TableHead>
                <TableHead scope="col">Program</TableHead>
                <TableHead scope="col">Where</TableHead>
                <TableHead scope="col">Period</TableHead>
                <TableHead scope="col" className="text-right">
                  Amount
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.recipient_name}</TableCell>
                  <TableCell>{a.title}</TableCell>
                  <TableCell>{a.program_name ?? '—'}</TableCell>
                  <TableCell>{[a.recipient_city, a.recipient_county ? `${a.recipient_county} County` : null].filter(Boolean).join(', ') || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDateOnly(a.start_date)} – {formatDateOnly(a.end_date)}
                  </TableCell>
                  <TableCell className="text-right">
                    <MoneyDisplay cents={a.amount_cents ?? 0} currency={a.currency ?? 'USD'} compact />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          title={q ? 'No grants match that search' : 'No grants published yet'}
          description={q ? 'Try a different name.' : 'Grants appear here once they are awarded.'}
          action={
            <Button asChild variant="secondary">
              <Link href="/opportunities">See open opportunities</Link>
            </Button>
          }
        />
      )}
      {res.total > res.pageSize ? (
        <Pagination
          page={res.page}
          pageCount={Math.ceil(res.total / res.pageSize)}
          getHref={(p) => `/awards?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) }).toString()}`}
          linkComponent={NextLink}
          total={res.total}
          pageSize={res.pageSize}
          itemLabel="grants"
        />
      ) : null}
    </div>
  );
}
