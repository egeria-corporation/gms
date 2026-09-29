// SPDX-License-Identifier: AGPL-3.0-or-later
// Award detail (finance/program side): summary, payment schedule with each installment's payment, payments,
// agreement + signatures (generate, send, countersign), activation, amendments, hold, close, reports, activity.
// ?state= (non-production): draft · countersign · on-hold · report-overdue · completed · error
import { sql } from '@gms/db';
import { formatDateOnly, formatInZone, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@gms/domain';
import {
  Alert,
  Button,
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
  Timeline,
  type TimelineEvent,
} from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auditActor, describeAudit } from '@/components/console/finance/audit-text';
import { ActivateAwardButton, AgreementPanel, AmendmentsPanel, CloseAwardDialog, type AgreementView, type AmendmentView } from '@/components/console/finance/award-actions';
import { AwardHoldControl } from '@/components/console/finance/award-hold';
import { AwardFlags } from '@/components/console/finance/diligence';
import { AWARDS_READ, can, FINANCE_READ, PROGRAM_WRITE, type SearchParams } from '@/components/console/finance/params';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Award' };

export default async function AwardDetail({ params, searchParams }: { params: Promise<{ awardId: string }>; searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(AWARDS_READ)]);
  const { awardId } = await params;
  const forced = forcedState(await searchParams);
  const breadcrumbs = [{ label: 'Awards', href: '/console/awards' }, { label: 'Award' }];
  if (forced === 'error') {
    return (
      <div className="grid gap-6">
        <PageHeader title="Award" breadcrumbs={breadcrumbs} linkComponent={NextLink} />
        <ErrorState title="We couldn’t load this award" description="Refresh to try again." />
      </div>
    );
  }
  if (!/^[0-9a-f-]{36}$/i.test(awardId)) notFound();
  const showMoney = can(viewer.role, FINANCE_READ) || can(viewer.role, PROGRAM_WRITE);
  const d = await rls(async (trx) => {
    const a = await trx
      .selectFrom('awards as a')
      .leftJoin('applicant_orgs as o', 'o.id', 'a.applicant_org_id')
      .leftJoin('programs as p', 'p.id', 'a.program_id')
      .leftJoin('applications as ap', 'ap.id', 'a.application_id')
      .selectAll('a')
      .select(['o.legal_name', 'o.ein', 'p.name as program_name', 'ap.reference_number as application_reference'])
      .where('a.id', '=', awardId)
      .where('a.workspace_id', '=', tenant.id)
      .executeTakeFirst();
    if (!a) return null;
    if (a.kind !== 'original' && a.parent_award_id) return { redirectTo: a.parent_award_id } as const;
    const [installments, payments, agreement, amendments, reports, payee, conditions, screening] = await Promise.all([
      trx
        .selectFrom('installments as i')
        .select(['i.id', 'i.position', 'i.due_date', 'i.amount_cents', 'i.condition', 'i.status'])
        .select((eb) =>
          eb
            .selectFrom('payments as p')
            .select('p.status')
            .whereRef('p.installment_id', '=', 'i.id')
            .where('p.status', 'not in', ['cancelled'])
            .orderBy('p.created_at', 'desc')
            .limit(1)
            .as('payment_status'),
        )
        .select((eb) => eb.selectFrom('payments as p').select('p.id').whereRef('p.installment_id', '=', 'i.id').where('p.status', 'not in', ['cancelled']).orderBy('p.created_at', 'desc').limit(1).as('payment_id'))
        .where('i.award_id', '=', a.id)
        .orderBy('i.position')
        .execute(),
      trx
        .selectFrom('payments as p')
        .leftJoin('payment_batches as b', 'b.id', 'p.batch_id')
        .select(['p.id', 'p.status', 'p.amount_cents', 'p.currency', 'p.method', 'p.rail', 'p.sent_at', 'p.created_at', 'p.failure_reason', 'b.name as batch_name', 'p.batch_id'])
        .where((eb) => eb.or([eb('p.award_id', '=', a.id), eb('p.award_id', 'in', eb.selectFrom('awards as c').select('c.id').where('c.parent_award_id', '=', a.id))]))
        .orderBy('p.created_at', 'desc')
        .limit(100)
        .execute(),
      trx.selectFrom('agreements').select(['id', 'status', 'document_hash', 'sent_at']).where('award_id', '=', a.id).where('status', '!=', 'void').orderBy('created_at', 'desc').executeTakeFirst(),
      trx.selectFrom('awards').select(['id', 'reference', 'kind', 'amount_cents', 'end_date', 'purpose', 'amendment_status', 'created_at']).where('parent_award_id', '=', a.id).orderBy('created_at').execute(),
      trx.selectFrom('report_requirements').select(['id', 'title', 'kind', 'due_date', 'status', 'holds_payments']).where('award_id', '=', a.id).orderBy('due_date').execute(),
      a.applicant_org_id ? trx.selectFrom('payees').select(['id', 'status', 'provider', 'contact_email']).where('workspace_id', '=', tenant.id).where('applicant_org_id', '=', a.applicant_org_id).executeTakeFirst() : Promise.resolve(undefined),
      trx.selectFrom('award_conditions').select(['id', 'body', 'due_date', 'status']).where('award_id', '=', a.id).execute(),
      a.applicant_org_id
        ? trx.selectFrom('sanctions_screenings').select(['status', 'created_at']).where('workspace_id', '=', tenant.id).where('applicant_org_id', '=', a.applicant_org_id).orderBy('created_at', 'desc').executeTakeFirst()
        : Promise.resolve(undefined),
    ]);
    const signatures = agreement ? await trx.selectFrom('signatures').select(['signer_role', 'typed_name', 'signed_at']).where('agreement_id', '=', agreement.id).orderBy('signed_at').execute() : [];
    const audit = await trx
      .selectFrom('audit_log')
      .select(['id', 'occurred_at', 'actor_type', 'actor_name', 'on_behalf_of_name', 'action', 'after'])
      .where('workspace_id', '=', tenant.id)
      .where((eb) =>
        eb.or([
          eb.and([eb('entity_type', '=', 'award'), eb('entity_id', 'in', [a.id, ...amendments.map((m) => m.id)])]),
          ...(agreement ? [eb.and([eb('entity_type', '=', 'agreement'), eb('entity_id', '=', agreement.id)])] : []),
        ]),
      )
      .orderBy('occurred_at', 'desc')
      .limit(50)
      .execute();
    const scheduled = await trx
      .selectFrom('installments')
      .select(sql<number>`coalesce(sum(amount_cents),0)::bigint`.as('s'))
      .where('award_id', '=', a.id)
      .where('status', '=', 'scheduled')
      .executeTakeFirst();
    return { a, installments, payments, agreement, signatures, amendments, reports, payee, conditions, screening, audit, unpaidCents: Number(scheduled?.s ?? 0) };
  });
  if (!d) notFound();
  if ('redirectTo' in d) redirect(`/console/awards/${d.redirectTo}`);
  const { a } = d;

  // Forced states (non-production) override what the page shows, not the data.
  const status = forced === 'draft' ? 'draft' : forced === 'completed' ? 'completed' : forced === 'countersign' || forced === 'on-hold' || forced === 'report-overdue' ? 'active' : a.status;
  const onHold = forced === 'on-hold' ? true : a.on_hold;
  const holdReason = forced === 'on-hold' ? (a.hold_reason ?? 'Waiting for the revised budget.') : a.hold_reason;
  const reportOverdue = forced === 'report-overdue' ? true : a.report_overdue;
  const agreementPending = forced === 'countersign' ? true : a.agreement_pending;
  const agreement: AgreementView | null =
    forced === 'countersign'
      ? {
          id: d.agreement?.id ?? '',
          status: 'signed',
          documentHash: d.agreement?.document_hash ?? null,
          sentAt: d.agreement?.sent_at ?? null,
          signatures: d.signatures.length ? d.signatures.map((s) => ({ role: s.signer_role, typedName: s.typed_name, signedAt: s.signed_at })) : [{ role: 'grantee', typedName: 'Dana Whitfield', signedAt: new Date().toISOString() }],
        }
      : d.agreement
        ? { id: d.agreement.id, status: d.agreement.status, documentHash: d.agreement.document_hash, sentAt: d.agreement.sent_at, signatures: d.signatures.map((s) => ({ role: s.signer_role, typedName: s.typed_name, signedAt: s.signed_at })) }
        : null;

  const approvedAmendments = d.amendments.filter((m) => m.amendment_status === 'approved').reduce((s, m) => s + m.amount_cents, 0);
  const totalCents = a.amount_cents + approvedAmendments;
  const scheduledTotal = d.installments.filter((i) => i.status !== 'cancelled').reduce((s, i) => s + i.amount_cents, 0);
  const programWriter = can(viewer.role, PROGRAM_WRITE);
  const holdWriter = can(viewer.role, [...PROGRAM_WRITE, 'finance']);
  const countersigner = can(viewer.role, ['owner', 'admin']);
  const reportsOpen = d.reports.filter((r) => r.status !== 'accepted').length;
  const amendments: AmendmentView[] = d.amendments.map((m) => ({ id: m.id, reference: m.reference, kind: m.kind, amountCents: m.amount_cents, endDate: m.end_date, purpose: m.purpose, status: m.amendment_status ?? 'draft', createdAt: m.created_at }));
  const events: TimelineEvent[] = d.audit.map((e) => {
    const v = describeAudit(e);
    return { id: e.id, actor: auditActor(e), action: v.text, at: e.occurred_at, tone: v.tone };
  });

  return (
    <div className="grid gap-6">
      <PageHeader
        title={`${a.reference} · ${a.title}`}
        breadcrumbs={[breadcrumbs[0]!, { label: a.reference }]}
        linkComponent={NextLink}
        meta={
          <>
            <StatusChip kind="award" value={status} />
            {status === 'active' && agreementPending ? <StatusChip kind="awardFlag" value="agreement_pending" /> : null}
            {onHold ? <StatusChip kind="awardFlag" value="on_hold" /> : null}
            {reportOverdue ? <StatusChip kind="awardFlag" value="report_overdue" /> : null}
          </>
        }
        description={
          <>
            {a.legal_name ?? 'Grantee'}
            {a.program_name ? ` · ${a.program_name}` : ''}
            {a.application_reference && a.application_id ? (
              <>
                {' · '}
                <Link className="hover:underline" href={`/console/applications/${a.application_id}`}>
                  Application {a.application_reference}
                </Link>
              </>
            ) : null}
          </>
        }
        actions={status === 'active' && programWriter ? <CloseAwardDialog awardId={a.id} reference={a.reference} reportsOpen={reportsOpen} scheduledCents={d.unpaidCents} /> : null}
      />

      {status === 'draft' ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              This award is a draft
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p>Activating it commits the funds, creates the interim and final report requirements, and lets you prepare the agreement. Payments can’t be batched until the agreement is countersigned.</p>
            {programWriter ? (
              <ActivateAwardButton awardId={a.id} scheduleMatches={scheduledTotal === a.amount_cents} amountCents={a.amount_cents} scheduledCents={scheduledTotal} />
            ) : (
              <p className="text-muted-foreground">A program officer or admin activates awards.</p>
            )}
          </CardContent>
        </Card>
      ) : null}
      {onHold ? (
        <Alert variant="danger" title="Payments are on hold">
          {holdReason ?? 'No reason given.'} Nothing can be batched for this award until the hold is released.
        </Alert>
      ) : null}
      {reportOverdue ? (
        <Alert variant="danger" title="A report is overdue">
          <Link href={`/console/reports?q=${encodeURIComponent(a.reference)}`}>See its reports</Link>. While a report is overdue, the batch builder blocks this grant’s payments.
        </Alert>
      ) : null}
      {d.screening?.status === 'potential_match' ? (
        <Alert variant="warning" title="Sanctions match needs review">
          Payments are blocked until someone reviews it in <Link href="/console/diligence?status=needs_review">Diligence</Link>.
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_26rem]">
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
                  { term: 'Awarded', detail: <MoneyDisplay cents={a.amount_cents} currency={a.currency} showCurrencyCode />, numeric: true },
                  { term: 'Total with amendments', detail: <MoneyDisplay cents={totalCents} currency={a.currency} />, numeric: true },
                  { term: 'Paid', detail: showMoney ? <MoneyDisplay cents={a.disbursed_cents} currency={a.currency} /> : null, numeric: true },
                  { term: 'Period', detail: a.start_date ? `${formatDateOnly(a.start_date)} – ${formatDateOnly(a.end_date)}` : null },
                  { term: 'Fiscal year', detail: a.fiscal_year ? `FY${a.fiscal_year}` : null },
                  { term: 'Grantee EIN', detail: a.ein },
                  { term: 'Purpose', detail: a.purpose ? <span className="whitespace-pre-wrap">{a.purpose}</span> : null, wide: true },
                ]}
              />
              {d.conditions.length ? (
                <div className="mt-4 grid gap-1 text-sm">
                  <h3 className="font-medium">Conditions</h3>
                  <ul className="list-disc pl-5">
                    {d.conditions.map((c) => (
                      <li key={c.id}>
                        {c.body}
                        {c.due_date ? ` (by ${formatDateOnly(c.due_date)})` : ''} — {c.status}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle as="h2" className="text-base">
                Payment schedule
              </CardTitle>
              {scheduledTotal !== totalCents && status !== 'cancelled' ? <span className="text-sm text-status-warning-fg">Installments don’t add up to the award total</span> : null}
            </CardHeader>
            <CardContent>
              {d.installments.length ? (
                <Table containerLabel="Payment schedule">
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Condition</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.installments.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell>{i.position}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDateOnly(i.due_date)}</TableCell>
                        <TableCell className="text-muted-foreground">{i.condition ?? '—'}</TableCell>
                        <TableCell>
                          {i.payment_id && i.payment_status ? (
                            <Link href={`/console/payments/${i.payment_id}`}>
                              <StatusChip kind="payment" value={i.payment_status} size="sm" />
                            </Link>
                          ) : i.status === 'cancelled' ? (
                            <StatusChip kind="payment" value="cancelled" size="sm" />
                          ) : onHold ? (
                            <StatusChip kind="payment" value="held" size="sm" />
                          ) : (
                            <StatusChip kind="payment" value="scheduled" size="sm" />
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <MoneyDisplay cents={i.amount_cents} currency={a.currency} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={4}>Scheduled total</TableCell>
                      <TableCell className="text-right">
                        <MoneyDisplay cents={scheduledTotal} currency={a.currency} />
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">No installments scheduled.</p>
              )}
            </CardContent>
          </Card>

          {showMoney ? (
            <Card>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle as="h2" className="text-base">
                  Payments
                </CardTitle>
                {can(viewer.role, FINANCE_READ) ? (
                  <Button asChild variant="link" size="sm">
                    <Link href={`/console/payments/status?q=${encodeURIComponent(a.reference)}`}>All payment activity</Link>
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent>
                {d.payments.length ? (
                  <Table containerLabel="Payments on this award">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Created</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Batch</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.payments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="whitespace-nowrap">
                            <Link href={`/console/payments/${p.id}`} className="hover:underline">
                              {formatInZone(p.created_at, tenant.timezone, { dateOnly: true })}
                            </Link>
                          </TableCell>
                          <TableCell>{PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}</TableCell>
                          <TableCell>
                            <div className="grid gap-0.5">
                              <StatusChip kind="payment" value={p.status} size="sm" />
                              {p.status === 'failed' && p.failure_reason ? <span className="text-xs text-status-danger-fg">{p.failure_reason}</span> : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            {p.batch_id ? (
                              <Link href={`/console/payments/batches/${p.batch_id}`} className="hover:underline">
                                {p.batch_name}
                              </Link>
                            ) : p.rail === 'manual' ? (
                              'Recorded'
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <MoneyDisplay cents={p.amount_cents} currency={p.currency} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground">No payments yet.</p>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Activity
              </CardTitle>
            </CardHeader>
            <CardContent>{events.length ? <Timeline events={events} timeZone={tenant.timezone} /> : <p className="text-sm text-muted-foreground">No activity recorded yet.</p>}</CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Agreement
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AgreementPanel awardId={a.id} awardStatus={status} agreement={agreement} canManage={programWriter} canCountersign={countersigner} viewerName={viewer.name} timeZone={tenant.timezone} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Payment hold
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <p className="text-muted-foreground">{onHold ? 'Payments are held.' : 'Payments can be batched when due.'}</p>
              {status === 'active' || status === 'draft' ? <AwardHoldControl awardId={a.id} reference={a.reference} onHold={onHold} reason={holdReason} canWrite={holdWriter} size="default" /> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Payee
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {d.payee ? (
                <>
                  <StatusChip kind="payee" value={d.payee.status} />
                  <span className="text-muted-foreground">
                    {d.payee.provider === 'manual' ? 'Paid outside GMS' : 'Onboarded with Mercury'} · {d.payee.contact_email}
                  </span>
                </>
              ) : (
                <p className="text-muted-foreground">Not invited to bank onboarding yet.</p>
              )}
              {can(viewer.role, FINANCE_READ) ? (
                <Link className="text-link underline" href="/console/payments/payees">
                  Payee onboarding
                </Link>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Reports
              </CardTitle>
            </CardHeader>
            <CardContent>
              {d.reports.length ? (
                <ul className="grid gap-2 text-sm">
                  {d.reports.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/console/reports/${r.id}`} className="font-medium hover:underline">
                        {r.title}
                      </Link>
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{formatDateOnly(r.due_date)}</span>
                        <StatusChip kind="report" value={r.status} size="sm" />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{status === 'draft' ? 'Created when the award is activated.' : 'No report requirements.'}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Amendments and supplements
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AmendmentsPanel awardId={a.id} awardStatus={status} endDate={a.end_date} items={amendments} canManage={programWriter} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Diligence flags
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <AwardFlags awardId={a.id} reference={a.reference} expenditureResponsibility={a.expenditure_responsibility} grantToIndividual={a.grant_to_individual} canWrite={holdWriter} />
              {d.screening ? (
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  OFAC: <StatusChip kind="screening" value={d.screening.status} size="sm" />
                </span>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
