// SPDX-License-Identifier: AGPL-3.0-or-later
import { formatDateOnly } from '@gms/domain';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, MoneyDisplay, PageHeader, StatusChip } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { myGrants } from '@/lib/portal-data';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Grants & reports' };

export default async function GrantsPage() {
  const tenant = await requireTenant();
  const grants = await myGrants(tenant.id);
  return (
    <div className="grid gap-8 pb-16">
      <PageHeader density="spacious" title="Grants & reports" description="Your grants from this foundation, with agreements, payments and reports in one place." />
      {grants.length ? (
        <ul className="grid gap-3 md:grid-cols-2">
          {grants.map((g) => (
            <li key={g.id}>
              <Card className="relative h-full">
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip kind="award" value={g.status} />
                    {g.agreement_pending ? <Badge variant="warning">Agreement pending</Badge> : null}
                    {g.report_overdue ? <Badge variant="danger">Report overdue</Badge> : null}
                    {g.on_hold ? <Badge variant="danger">On hold</Badge> : null}
                  </div>
                  <CardTitle as="h2" className="text-lg">
                    <Link className="after:absolute after:inset-0" href={`/portal/grants/${g.id}`}>
                      {g.title}
                    </Link>
                  </CardTitle>
                  <CardDescription>
                    {g.reference} · {formatDateOnly(g.start_date)} – {formatDateOnly(g.end_date)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex gap-6 text-sm">
                  <span>
                    <span className="block text-muted-foreground">Award</span>
                    <MoneyDisplay cents={g.amount_cents} currency={g.currency} />
                  </span>
                  <span>
                    <span className="block text-muted-foreground">Paid</span>
                    <MoneyDisplay cents={g.disbursed_cents} currency={g.currency} />
                  </span>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No grants yet" description="When an application is funded, your grant shows up here with next steps." />
      )}
    </div>
  );
}
