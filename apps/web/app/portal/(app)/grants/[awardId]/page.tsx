// SPDX-License-Identifier: AGPL-3.0-or-later
// B-10 Grant hub: accept & sign, bank onboarding (Mercury invite), payments, reports.
import { formatDateOnly, formatInZone, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@gms/domain';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, DescriptionList, MoneyDisplay, PageHeader, Section, StatusChip, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@gms/ui';
import { ExternalLink, FileSignature, Landmark } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NextLink } from '@/components/next-link';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Your grant' };

export default async function GrantPage({ params, searchParams }: { params: Promise<{ awardId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tenant = await requireTenant();
  const { awardId } = await params;
  const forced = forcedState(await searchParams);
  const d = await rls(async (trx) => {
    const award = await trx.selectFrom('awards').selectAll().where('id', '=', awardId).where('workspace_id', '=', tenant.id).executeTakeFirst();
    if (!award) return null;
    const [agreement, payee, installments, payments, reports, conditions, changes] = await Promise.all([
      trx.selectFrom('agreements').select(['id', 'status', 'document_hash', 'sent_at']).where('award_id', '=', awardId).where('status', '!=', 'void').orderBy('created_at', 'desc').executeTakeFirst(),
      award.applicant_org_id ? trx.selectFrom('payees').select(['status', 'onboarding_url', 'invited_at', 'ready_at']).where('applicant_org_id', '=', award.applicant_org_id).where('workspace_id', '=', tenant.id).executeTakeFirst() : Promise.resolve(undefined),
      trx.selectFrom('installments').select(['id', 'position', 'due_date', 'amount_cents', 'condition', 'status']).where('award_id', '=', awardId).orderBy('position').execute(),
      trx.selectFrom('payments').select(['id', 'amount_cents', 'status', 'method', 'sent_at', 'installment_id']).where('award_id', '=', awardId).orderBy('created_at').execute(),
      trx.selectFrom('report_requirements').select(['id', 'title', 'due_date', 'status', 'kind']).where('award_id', '=', awardId).orderBy('due_date').execute(),
      trx.selectFrom('award_conditions').select(['id', 'body', 'due_date', 'status']).where('award_id', '=', awardId).execute(),
      trx.selectFrom('change_requests').select(['id', 'kind', 'status', 'created_at', 'reason']).where('award_id', '=', awardId).orderBy('created_at', 'desc').execute(),
    ]);
    return { award, agreement, payee, installments, payments, reports, conditions, changes };
  });
  if (!d) notFound();
  const { award, agreement, payee, installments, payments, reports, conditions, changes } = d;
  const agreementStatus = forced === 'sign' ? 'sent' : agreement?.status;
  const payeeStatus = (forced && ['invite_sent', 'onboarding', 'ready', 'invite_expired'].includes(forced) ? forced : payee?.status) ?? null;

  return (
    <div className="grid gap-8 pb-16">
      <PageHeader
        density="spacious"
        linkComponent={NextLink}
        breadcrumbs={[{ label: 'Grants & reports', href: '/portal/grants' }, { label: award.reference }]}
        title={award.title}
        description={`Grant ${award.reference} from ${tenant.brand.displayName}`}
        meta={<StatusChip kind="award" value={award.status} />}
      />

      {agreementStatus === 'sent' ? (
        <Alert variant="info" title="Next step: review and sign your grant agreement" icon={<FileSignature aria-hidden="true" />}>
          <p>Read the agreement, then sign by typing your name. It takes about five minutes.</p>
          <Button asChild className="mt-3" size="lg">
            <Link href={`/portal/grants/${award.id}/agreement`}>Review and sign</Link>
          </Button>
        </Alert>
      ) : null}

      {payeeStatus && payeeStatus !== 'ready' ? (
        <Alert variant={payeeStatus === 'invite_expired' ? 'warning' : 'info'} title="Set up how you’ll receive payments" icon={<Landmark aria-hidden="true" />}>
          {payeeStatus === 'invite_expired' ? (
            <p>Your bank setup link expired. We’ve let the foundation know; they’ll send a new one.</p>
          ) : (
            <>
              <p>
                {tenant.brand.displayName} pays grants through its bank, Mercury. Enter your bank details and tax form on Mercury’s secure page. GMS and the foundation never see your account numbers.
              </p>
              {payee?.onboarding_url ? (
                <Button asChild className="mt-3" size="lg">
                  <a href={payee.onboarding_url} target="_blank" rel="noopener noreferrer">
                    Set up payments <ExternalLink aria-hidden="true" />
                  </a>
                </Button>
              ) : null}
            </>
          )}
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              Grant details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList
              layout="grid"
              items={[
                { term: 'Amount', detail: <MoneyDisplay cents={award.amount_cents} currency={award.currency} /> },
                { term: 'Paid so far', detail: <MoneyDisplay cents={award.disbursed_cents} currency={award.currency} /> },
                { term: 'Grant period', detail: `${formatDateOnly(award.start_date)} – ${formatDateOnly(award.end_date)}` },
                { term: 'Agreement', detail: agreement ? <StatusChip kind="agreement" value={agreement.status} /> : 'Not sent yet' },
                { term: 'Purpose', detail: award.purpose, wide: true },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              Bank setup
            </CardTitle>
          </CardHeader>
          <CardContent>{payeeStatus ? <StatusChip kind="payee" value={payeeStatus} /> : <p className="text-sm text-muted-foreground">Starts after you sign the agreement.</p>}</CardContent>
        </Card>
      </div>

      {conditions.length ? (
        <Section title="Conditions">
          <ul className="grid gap-2">
            {conditions.map((c) => (
              <li key={c.id} className="rounded-lg border bg-card p-3 text-sm">
                {c.body}
                {c.due_date ? <span className="block text-xs text-muted-foreground">Due {formatDateOnly(c.due_date)}</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section id="payments" title="Payment schedule">
        <div className="overflow-x-auto rounded-xl border">
          <Table containerLabel="Payment schedule">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Installment</TableHead>
                <TableHead scope="col">Expected</TableHead>
                <TableHead scope="col">Condition</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col" className="text-right">
                  Amount
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {installments.map((i) => {
                const p = [...payments].reverse().find((x) => x.installment_id === i.id);
                return (
                  <TableRow key={i.id}>
                    <TableCell>#{i.position}</TableCell>
                    <TableCell>{formatDateOnly(i.due_date)}</TableCell>
                    <TableCell className="max-w-64">{i.condition ?? '—'}</TableCell>
                    <TableCell>
                      {p ? (
                        <span className="grid gap-1">
                          <StatusChip kind="payment" value={p.status} size="sm" />
                          {p.sent_at ? (
                            <span className="text-xs text-muted-foreground">
                              {PAYMENT_METHOD_LABELS[p.method as PaymentMethod]} · {formatInZone(p.sent_at, tenant.timezone, { dateOnly: true })}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <StatusChip kind="payment" value="scheduled" size="sm" />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <MoneyDisplay cents={i.amount_cents} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title="Reports" description="Reports tell the foundation how the work is going. Some payments wait for a report.">
        {reports.length ? (
          <ul className="grid gap-2">
            {reports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
                <span className="grid">
                  <Link className="font-medium text-link underline underline-offset-2" href={`/portal/grants/${award.id}/reports/${r.id}`}>
                    {r.title}
                  </Link>
                  <span className="text-sm text-muted-foreground">Due {formatDateOnly(r.due_date)}</span>
                </span>
                <StatusChip kind="report" value={r.status} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No reports are scheduled.</p>
        )}
      </Section>

      <Section
        title="Need a change?"
        description="Ask for more time on a report, a change to your grant, or a budget change."
        actions={
          <Button asChild variant="secondary">
            <Link href={`/portal/grants/${award.id}/requests/new`}>Make a request</Link>
          </Button>
        }
      >
        {changes.length ? (
          <ul className="grid gap-2 text-sm">
            {changes.map((c) => (
              <li key={c.id} className="rounded-lg border bg-card p-3">
                <span className="font-medium capitalize">{c.kind.replace(/_/g, ' ')}</span> · {c.status} · {formatInZone(c.created_at, tenant.timezone, { dateOnly: true })}
                <span className="block text-muted-foreground">{c.reason}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>
    </div>
  );
}
