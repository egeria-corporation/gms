// SPDX-License-Identifier: AGPL-3.0-or-later
// P-01 Payments overview: balances per account, installments due in the next 30 days, batches awaiting
// approval (GMS), payments awaiting bank approval (Mercury), and open reconciliation exceptions.
// ?state= (non-production): no-bank · empty · error
import { sql } from '@gms/db';
import { formatDateOnly, formatInZone, formatMoney } from '@gms/domain';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  MoneyDisplay,
  PageHeader,
  StatTile,
  StatusChip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gms/ui';
import { Landmark, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { addDays, can, FINANCE_READ, FINANCE_WRITE, todayIn, type SearchParams } from '@/components/console/finance/params';
import { SyncBalancesButton } from '@/components/console/finance/sync-button';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Payments' };

export default async function PaymentsOverview({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(FINANCE_READ)]);
  const forced = forcedState(await searchParams);
  if (forced === 'error') {
    return (
      <div className="grid gap-6">
        <PageHeader title="Payments" />
        <ErrorState title="We couldn’t load payments" description="Nothing was changed. Refresh the page to try again." action={<Button asChild><Link href="/console/payments">Try again</Link></Button>} />
      </div>
    );
  }
  const today = todayIn(tenant.timezone);
  const horizon = addDays(today, 30);
  const d = await rls(async (trx) => {
    const conn = await trx
      .selectFrom('bank_connections')
      .select(['id', 'provider', 'environment', 'webhook_status', 'last_synced_at', 'status'])
      .where('workspace_id', '=', tenant.id)
      .where('status', '!=', 'disconnected')
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    const [accounts, due, batches, bank, exceptions, failed] = await Promise.all([
      conn
        ? trx.selectFrom('bank_accounts').select(['id', 'name', 'mask', 'available_cents', 'current_cents', 'currency', 'balance_updated_at']).where('connection_id', '=', conn.id).orderBy('name').execute()
        : Promise.resolve([]),
      trx
        .selectFrom('installments as i')
        .innerJoin('awards as a', 'a.id', 'i.award_id')
        .leftJoin('applicant_orgs as o', 'o.id', 'a.applicant_org_id')
        .select(['i.id', 'i.due_date', 'i.amount_cents', 'a.id as award_id', 'a.reference', 'a.on_hold', 'a.agreement_pending', 'a.report_overdue', 'a.status as award_status', 'o.legal_name'])
        .where('i.workspace_id', '=', tenant.id)
        .where('i.status', '=', 'scheduled')
        .where('i.due_date', '<=', horizon)
        .where('a.status', '=', 'active')
        .where((eb) => eb.not(eb.exists(eb.selectFrom('payments as p').select('p.id').whereRef('p.installment_id', '=', 'i.id').where('p.status', 'not in', ['failed', 'cancelled']))))
        .orderBy('i.due_date')
        .limit(200)
        .execute(),
      trx
        .selectFrom('payment_batches as b')
        .select(['b.id', 'b.name', 'b.total_cents', 'b.method', 'b.created_by', 'b.approved_by', 'b.requires_second_approval', 'b.created_at'])
        .select((eb) => eb.selectFrom('payments as p').select(sql<number>`count(*)::int`.as('n')).whereRef('p.batch_id', '=', 'b.id').as('count'))
        .where('b.workspace_id', '=', tenant.id)
        .where('b.status', '=', 'awaiting_approval')
        .orderBy('b.created_at')
        .execute(),
      trx
        .selectFrom('payments')
        .select([sql<number>`count(*)::int`.as('n'), sql<number>`coalesce(sum(amount_cents),0)::bigint`.as('c')])
        .where('workspace_id', '=', tenant.id)
        .where('status', '=', 'awaiting_bank_approval')
        .executeTakeFirst(),
      trx.selectFrom('recon_exceptions').select(sql<number>`count(*)::int`.as('n')).where('workspace_id', '=', tenant.id).where('status', '=', 'open').executeTakeFirst(),
      trx.selectFrom('payments').select(sql<number>`count(*)::int`.as('n')).where('workspace_id', '=', tenant.id).where('status', '=', 'failed').executeTakeFirst(),
    ]);
    return { conn, accounts, due, batches, bank, exceptions: Number(exceptions?.n ?? 0), failed: Number(failed?.n ?? 0) };
  });

  const conn = forced === 'no-bank' ? undefined : d.conn;
  const empty = forced === 'empty';
  const due = empty ? [] : d.due;
  const batches = empty ? [] : d.batches;
  const writer = can(viewer.role, FINANCE_WRITE);
  const manual = conn?.provider === 'manual';
  const dueTotal = due.reduce((s, r) => s + r.amount_cents, 0);
  const payable = due.filter((r) => !r.on_hold && !r.agreement_pending);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Payments"
        description={
          conn
            ? manual
              ? 'You pay grants outside GMS. Record payments here so award balances and reports stay accurate.'
              : `Paid from your Mercury account (${conn.environment === 'fake' ? 'simulated bank' : conn.environment}). GMS never holds funds and never sees bank account numbers.`
            : 'Connect your bank to pay grants, or choose to pay outside GMS.'
        }
        actions={
          conn && writer ? (
            manual ? (
              <Button asChild>
                <Link href="/console/payments/manual">
                  <Plus aria-hidden="true" /> Record a payment
                </Link>
              </Button>
            ) : (
              <>
                <SyncBalancesButton />
                <Button asChild>
                  <Link href="/console/payments/batches/new">
                    <Plus aria-hidden="true" /> Build a payment batch
                  </Link>
                </Button>
              </>
            )
          ) : null
        }
      />

      {!conn ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              variant="page"
              icon={Landmark}
              title="Connect your bank"
              description="Pay grants from your own Mercury account with maker-checker approval in GMS, or record payments you make elsewhere. Bank account numbers never pass through GMS."
              action={
                writer ? (
                  <Button asChild>
                    <Link href="/console/payments/connect">Connect your bank</Link>
                  </Button>
                ) : (
                  <p className="text-sm">Ask a finance admin or workspace owner to connect the bank.</p>
                )
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <section aria-label="Account balances" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {manual ? (
              <StatTile label="Bank" value="Paid outside GMS" footnote={<Link className="text-link underline" href="/console/payments/connect">Change how you pay</Link>} />
            ) : d.accounts.length ? (
              d.accounts.map((a) => (
                <StatTile
                  key={a.id}
                  label={
                    <>
                      {a.name}
                      {a.mask ? <span className="text-muted-foreground"> ··{a.mask}</span> : null}
                    </>
                  }
                  value={<MoneyDisplay cents={a.available_cents} currency={a.currency} />}
                  footnote={`Available · current ${formatMoney(a.current_cents, a.currency)} · updated ${formatInZone(a.balance_updated_at, tenant.timezone)}`}
                />
              ))
            ) : (
              <StatTile label="Accounts" value="None found" footnote="Refresh balances after adding accounts in Mercury." />
            )}
            <StatTile
              label="Awaiting bank approval (Mercury)"
              value={<MoneyDisplay cents={Number(d.bank?.c ?? 0)} />}
              footnote={`${Number(d.bank?.n ?? 0)} payment${Number(d.bank?.n ?? 0) === 1 ? '' : 's'} — a person approves each one in Mercury`}
              action={<Link className="text-link underline" href="/console/payments/status?status=awaiting_bank_approval">View payments</Link>}
            />
            <StatTile
              label="Reconciliation exceptions"
              value={d.exceptions}
              footnote={d.failed ? `${d.failed} failed payment${d.failed === 1 ? '' : 's'} need a next step` : 'Open items to review'}
              action={<Link className="text-link underline" href="/console/payments/exceptions">Review exceptions</Link>}
            />
          </section>

          <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
            <Card>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle as="h2" className="text-base">
                  Due in the next 30 days
                </CardTitle>
                <span className="text-sm text-muted-foreground">
                  {due.length} installment{due.length === 1 ? '' : 's'} · <MoneyDisplay cents={dueTotal} /> · {payable.length} ready to batch
                </span>
              </CardHeader>
              <CardContent>
                {due.length ? (
                  <Table containerLabel="Installments due in the next 30 days">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Due</TableHead>
                        <TableHead>Grant</TableHead>
                        <TableHead>Grantee</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Flags</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {due.slice(0, 15).map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="whitespace-nowrap">
                            {formatDateOnly(r.due_date)}
                            {r.due_date < today ? (
                              <Badge variant="danger" className="ml-2">
                                Past due
                              </Badge>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <Link className="font-medium hover:underline" href={`/console/awards/${r.award_id}`}>
                              {r.reference}
                            </Link>
                          </TableCell>
                          <TableCell className="max-w-56 truncate">{r.legal_name ?? '—'}</TableCell>
                          <TableCell className="text-right">
                            <MoneyDisplay cents={r.amount_cents} />
                          </TableCell>
                          <TableCell>
                            <span className="flex flex-wrap gap-1">
                              {r.agreement_pending ? <StatusChip kind="awardFlag" value="agreement_pending" size="sm" /> : null}
                              {r.on_hold ? <StatusChip kind="awardFlag" value="on_hold" size="sm" /> : null}
                              {r.report_overdue ? <StatusChip kind="awardFlag" value="report_overdue" size="sm" /> : null}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyState variant="inline" level={3} title="Nothing due in the next 30 days" description="Installments from active awards appear here as their due dates approach." />
                )}
                {due.length > 15 ? <p className="mt-2 text-sm text-muted-foreground">Showing the first 15. The batch builder includes all of them.</p> : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle as="h2" className="text-base">
                  Batches awaiting approval (GMS)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {batches.length ? (
                  <ul className="grid gap-3">
                    {batches.map((b) => (
                      <li key={b.id} className="grid gap-1 rounded-md border p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <Link href={`/console/payments/batches/${b.id}`} className="font-medium hover:underline">
                            {b.name}
                          </Link>
                          <MoneyDisplay cents={b.total_cents} className="font-medium" />
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>
                            {Number(b.count ?? 0)} payment{Number(b.count ?? 0) === 1 ? '' : 's'}
                          </span>
                          {b.created_by === viewer.userId ? <Badge variant="neutral">You created this</Badge> : null}
                          {b.requires_second_approval ? <Badge variant="warning">{b.approved_by ? 'Needs second approval' : 'Two approvals needed'}</Badge> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No batches are waiting for approval.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <nav aria-label="Payments sections" className="flex flex-wrap gap-2 text-sm">
            <Button asChild variant="outline" size="sm">
              <Link href="/console/payments/payees">Payee onboarding</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/console/payments/batches">All batches</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/console/payments/status">Payment status</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/console/payments/exceptions">Exceptions</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/console/payments/manual">Record or import payments</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/console/payments/connect">Bank connection</Link>
            </Button>
          </nav>
        </>
      )}
    </div>
  );
}
