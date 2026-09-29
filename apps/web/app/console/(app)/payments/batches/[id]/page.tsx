// SPDX-License-Identifier: AGPL-3.0-or-later
// P-04 Batch approval: the exact payments, totals, source account + mask, method and fees; maker-checker
// decision panel; approvals so far.
// ?state= (non-production): awaiting-approval · creator · needs-second-approval · approved · submitted · rejected · error
import { formatDateOnly, formatInZone, formatMoney, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@gms/domain';
import {
  ActorBadge,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DescriptionList,
  ErrorState,
  MoneyDisplay,
  PageHeader,
  StatusChip,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BatchDecision } from '@/components/console/finance/batch-decision';
import { can, FINANCE_READ, FINANCE_WRITE, type SearchParams } from '@/components/console/finance/params';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Payment batch' };

const FORCED_STATUS: Record<string, string> = {
  'awaiting-approval': 'awaiting_approval',
  creator: 'awaiting_approval',
  'needs-second-approval': 'awaiting_approval',
  approved: 'approved',
  submitted: 'submitted',
  rejected: 'rejected',
};

export default async function BatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(FINANCE_READ)]);
  const { id } = await params;
  const forced = forcedState(await searchParams);
  const breadcrumbs = [{ label: 'Payments', href: '/console/payments' }, { label: 'Batches', href: '/console/payments/batches' }, { label: 'Batch' }];
  if (forced === 'error') {
    return (
      <div className="grid gap-6">
        <PageHeader title="Payment batch" breadcrumbs={breadcrumbs} linkComponent={NextLink} />
        <ErrorState title="We couldn’t load this batch" description="Nothing was changed or approved. Refresh to try again." />
      </div>
    );
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await rls(async (trx) => {
    const batch = await trx
      .selectFrom('payment_batches as b')
      .leftJoin('bank_accounts as a', 'a.id', 'b.source_account_id')
      .leftJoin('profiles as c', 'c.id', 'b.created_by')
      .leftJoin('profiles as f', 'f.id', 'b.approved_by')
      .leftJoin('profiles as s', 's.id', 'b.second_approved_by')
      .select([
        'b.id',
        'b.name',
        'b.status',
        'b.method',
        'b.total_cents',
        'b.requires_second_approval',
        'b.created_by',
        'b.created_at',
        'b.approved_by',
        'b.approved_at',
        'b.second_approved_by',
        'b.second_approved_at',
        'b.submitted_at',
        'b.note',
        'b.created_by_agent_client_id',
        'a.name as account_name',
        'a.mask as account_mask',
        'a.available_cents',
        'a.currency as account_currency',
        'c.full_name as creator_name',
        'c.email as creator_email',
        'f.full_name as first_name',
        's.full_name as second_name',
      ])
      .where('b.id', '=', id)
      .where('b.workspace_id', '=', tenant.id)
      .executeTakeFirst();
    if (!batch) return null;
    const [payments, approvals, settings] = await Promise.all([
      trx
        .selectFrom('payments as p')
        .innerJoin('awards as w', 'w.id', 'p.award_id')
        .leftJoin('applicant_orgs as o', 'o.id', 'w.applicant_org_id')
        .leftJoin('installments as i', 'i.id', 'p.installment_id')
        .leftJoin('payees as y', 'y.id', 'p.payee_id')
        .select(['p.id', 'p.status', 'p.amount_cents', 'p.fee_cents', 'p.currency', 'w.id as award_id', 'w.reference', 'o.legal_name', 'i.due_date', 'i.position', 'y.status as payee_status'])
        .where('p.batch_id', '=', id)
        .orderBy('w.reference')
        .execute(),
      trx
        .selectFrom('payment_approvals as pa')
        .leftJoin('profiles as u', 'u.id', 'pa.approver_id')
        .select(['pa.id', 'pa.approver_id', 'pa.decision', 'pa.note', 'pa.aal', 'pa.created_at', 'u.full_name', 'u.email'])
        .where('pa.batch_id', '=', id)
        .orderBy('pa.created_at')
        .execute(),
      trx.selectFrom('workspace_settings').select('second_approval_threshold_cents').where('workspace_id', '=', tenant.id).executeTakeFirst(),
    ]);
    return { batch, payments, approvals, threshold: settings?.second_approval_threshold_cents ?? null };
  });
  if (!d) notFound();
  const { batch, payments, approvals } = d;

  const status = (forced && FORCED_STATUS[forced]) || batch.status;
  const isCreator = forced === 'creator' ? true : forced && FORCED_STATUS[forced] ? false : batch.created_by === viewer.userId;
  const needsSecond = forced === 'needs-second-approval' || (batch.requires_second_approval && Boolean(batch.approved_by) && !batch.second_approved_by);
  const approvedByMe = forced ? false : batch.approved_by === viewer.userId;
  const count = payments.length;
  const fees = payments.reduce((s, p) => s + p.fee_cents, 0);
  const method = batch.method as PaymentMethod;
  const creator = batch.creator_name || batch.creator_email || 'A teammate';

  return (
    <div className="grid gap-6">
      <PageHeader
        title={batch.name}
        breadcrumbs={[...breadcrumbs.slice(0, 2), { label: batch.name }]}
        linkComponent={NextLink}
        meta={
          <>
            <StatusChip kind="batch" value={status} />
            {batch.requires_second_approval || forced === 'needs-second-approval' ? <Badge variant="warning">Two approvals required</Badge> : null}
          </>
        }
        description={`Created by ${creator} · ${formatInZone(batch.created_at, tenant.timezone)}`}
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionList
                layout="grid"
                columns={3}
                items={[
                  {
                    term: 'Source account',
                    detail: method === 'manual' ? 'Your own bank (outside GMS)' : batch.account_name ? `${batch.account_name}${batch.account_mask ? ` ··${batch.account_mask}` : ''}` : '—',
                  },
                  { term: 'Available balance', detail: method === 'manual' ? '—' : <MoneyDisplay cents={batch.available_cents} currency={batch.account_currency ?? 'USD'} />, numeric: true },
                  { term: 'Method', detail: PAYMENT_METHOD_LABELS[method] ?? batch.method },
                  { term: 'Payments', detail: count, numeric: true },
                  { term: 'Total to grantees', detail: <MoneyDisplay cents={batch.total_cents} className="font-semibold" />, numeric: true },
                  { term: 'Mercury fees', detail: <MoneyDisplay cents={fees} />, numeric: true },
                  { term: 'Total leaving the account', detail: <MoneyDisplay cents={batch.total_cents + fees} />, numeric: true },
                  {
                    term: 'Approval rule',
                    detail: batch.requires_second_approval
                      ? `Two different approvers (at or above ${d.threshold !== null ? formatMoney(d.threshold) : 'the threshold'}); never the creator`
                      : 'One approver who is not the creator',
                  },
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Payments in this batch
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table containerLabel="Payments in this batch">
                <TableHeader>
                  <TableRow>
                    <TableHead>Grant</TableHead>
                    <TableHead>Grantee</TableHead>
                    <TableHead>Installment</TableHead>
                    <TableHead>Payee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Fee</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link className="font-medium hover:underline" href={`/console/awards/${p.award_id}`}>
                          {p.reference}
                        </Link>
                      </TableCell>
                      <TableCell>{p.legal_name ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">{p.due_date ? `#${p.position} · due ${formatDateOnly(p.due_date)}` : '—'}</TableCell>
                      <TableCell>{p.payee_status ? <StatusChip kind="payee" value={p.payee_status} size="sm" /> : '—'}</TableCell>
                      <TableCell>
                        <Link href={`/console/payments/${p.id}`} className="hover:underline">
                          <StatusChip kind="payment" value={p.status} size="sm" />
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">
                        <MoneyDisplay cents={p.fee_cents} />
                      </TableCell>
                      <TableCell className="text-right">
                        <MoneyDisplay cents={p.amount_cents} currency={p.currency} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={5}>
                      Total ({count} payment{count === 1 ? '' : 's'})
                    </TableCell>
                    <TableCell className="text-right">
                      <MoneyDisplay cents={fees} />
                    </TableCell>
                    <TableCell className="text-right">
                      <MoneyDisplay cents={batch.total_cents} />
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Decision
              </CardTitle>
            </CardHeader>
            <CardContent>
              <BatchDecision
                batchId={batch.id}
                status={status}
                count={count}
                totalCents={batch.total_cents}
                feeCents={fees}
                isCreator={isCreator}
                approvedByMe={approvedByMe}
                firstApproverName={forced === 'needs-second-approval' ? (batch.first_name ?? 'Another approver') : batch.first_name}
                needsSecondApproval={needsSecond}
                canWrite={can(viewer.role, FINANCE_WRITE)}
                rejectionReason={batch.note}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Approvals
              </CardTitle>
            </CardHeader>
            <CardContent>
              {approvals.length ? (
                <ol className="grid gap-3">
                  {approvals.map((a) => (
                    <li key={a.id} className="grid gap-1 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <ActorBadge actor={{ type: 'human', name: a.full_name || a.email || 'A teammate' }} size="sm" />
                        <Badge variant={a.decision === 'approve' ? 'success' : 'danger'}>{a.decision === 'approve' ? 'Approved' : 'Rejected'}</Badge>
                        {a.aal === 'aal2' ? <span className="text-xs text-muted-foreground">Authenticator verified</span> : null}
                      </div>
                      <time className="text-xs text-muted-foreground" dateTime={a.created_at}>
                        {formatInZone(a.created_at, tenant.timezone)}
                      </time>
                      {a.note ? <p className="text-muted-foreground">“{a.note}”</p> : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">No approvals yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
