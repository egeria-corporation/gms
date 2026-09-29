// SPDX-License-Identifier: AGPL-3.0-or-later
// All payment batches, newest first, with status and totals. ?state= (non-production): empty · error
import { sql } from '@gms/db';
import { BATCH_STATUS, formatInZone, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@gms/domain';
import { Badge, Button, EmptyState, ErrorState, MoneyDisplay, PageHeader, Pagination, StatusChip, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@gms/ui';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { can, FINANCE_READ, FINANCE_WRITE, oneOf, paging, type SearchParams } from '@/components/console/finance/params';
import { UrlFilterSelect } from '@/components/console/finance/client-utils';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Payment batches' };

const STATUSES = Object.keys(BATCH_STATUS) as (keyof typeof BATCH_STATUS)[];

export default async function BatchesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(FINANCE_READ)]);
  const sp = await searchParams;
  const forced = forcedState(sp);
  const { page, pageSize, offset } = paging(sp);
  const status = oneOf(sp, 'status', STATUSES);
  const header = (
    <PageHeader
      title="Payment batches"
      breadcrumbs={[{ label: 'Payments', href: '/console/payments' }, { label: 'Batches' }]}
      linkComponent={NextLink}
      actions={
        can(viewer.role, FINANCE_WRITE) ? (
          <Button asChild>
            <Link href="/console/payments/batches/new">
              <Plus aria-hidden="true" /> Build a payment batch
            </Link>
          </Button>
        ) : null
      }
    />
  );
  if (forced === 'error') {
    return (
      <div className="grid gap-6">
        {header}
        <ErrorState title="We couldn’t load batches" description="Refresh to try again." />
      </div>
    );
  }
  const d = await rls(async (trx) => {
    let q = trx.selectFrom('payment_batches as b').where('b.workspace_id', '=', tenant.id);
    if (status) q = q.where('b.status', '=', status);
    const [rows, count] = await Promise.all([
      q
        .leftJoin('profiles as c', 'c.id', 'b.created_by')
        .select(['b.id', 'b.name', 'b.status', 'b.method', 'b.total_cents', 'b.created_at', 'b.created_by', 'b.requires_second_approval', 'c.full_name', 'c.email'])
        .select((eb) => eb.selectFrom('payments as p').select(sql<number>`count(*)::int`.as('n')).whereRef('p.batch_id', '=', 'b.id').as('count'))
        .orderBy('b.created_at', 'desc')
        .limit(pageSize)
        .offset(offset)
        .execute(),
      q.select(sql<number>`count(*)::int`.as('n')).executeTakeFirst(),
    ]);
    return { rows, total: Number(count?.n ?? 0) };
  });
  const rows = forced === 'empty' ? [] : d.rows;
  const total = forced === 'empty' ? 0 : d.total;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (pageSize !== 25) qs.set('size', String(pageSize));
    if (p > 1) qs.set('page', String(p));
    const s = qs.toString();
    return `/console/payments/batches${s ? `?${s}` : ''}`;
  };
  return (
    <div className="grid gap-6">
      {header}
      <div className="flex flex-wrap items-center gap-3">
        <UrlFilterSelect param="status" label="Status" value={status} options={STATUSES.map((s) => ({ value: s, label: BATCH_STATUS[s].label }))} />
      </div>
      {rows.length ? (
        <>
          <Table containerLabel="Payment batches" className="rounded-lg border">
            <TableHeader>
              <TableRow>
                <TableHead>Batch</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Payments</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <Link href={`/console/payments/batches/${b.id}`} className="font-medium hover:underline">
                      {b.name}
                    </Link>
                    {b.created_by === viewer.userId && b.status === 'awaiting_approval' ? (
                      <Badge variant="neutral" className="ml-2">
                        You created this
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <StatusChip kind="batch" value={b.status} size="sm" />
                  </TableCell>
                  <TableCell>{PAYMENT_METHOD_LABELS[b.method as PaymentMethod] ?? b.method}</TableCell>
                  <TableCell className="text-right">{Number(b.count ?? 0)}</TableCell>
                  <TableCell className="text-right">
                    <MoneyDisplay cents={b.total_cents} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatInZone(b.created_at, tenant.timezone, { dateOnly: true })} · {b.full_name || b.email || 'A teammate'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination page={page} pageCount={pageCount} getHref={href} linkComponent={NextLink} total={total} pageSize={pageSize} itemLabel="batches" />
        </>
      ) : (
        <EmptyState title={status ? 'No batches with this status' : 'No payment batches yet'} description="Build a batch from installments that are due." />
      )}
    </div>
  );
}
