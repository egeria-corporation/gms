// SPDX-License-Identifier: AGPL-3.0-only
// R-07 Award letter & agreement for an application's active award: generate (agreements.generate → PDF +
// SHA-256), preview the exact PDF, send for signature (agreements.send, R2 — runs for a person), and follow
// draft → sent → signed → countersigned with signatures. Countersigning happens on the award page.
// ?state= no-award | draft | sent | signed | error
import { formatInZone, formatMoney } from '@gms/domain';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, NotFoundState, PageHeader, StatusChip, Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@gms/ui';
import { ArrowRight, Circle, CircleCheck, CircleDot, FileSignature } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AgreementActions } from '@/components/console/grantmaking/decisions/agreement-actions';
import { AgreementStatusChip } from '@/components/console/grantmaking/decisions/outcome-chips';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { isUuid, type SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Award letter & agreement' };

const STEPS = ['draft', 'sent', 'signed', 'countersigned'] as const;
const STEP_LABEL: Record<(typeof STEPS)[number], string> = {
  draft: 'Generated (draft)',
  sent: 'Sent to the grantee',
  signed: 'Signed by the grantee',
  countersigned: 'Countersigned by the foundation',
};

export default async function AgreementPage({ params, searchParams }: { params: Promise<{ applicationId: string }>; searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff()]);
  const { applicationId } = await params;
  const forced = forcedState(await searchParams);
  const canAct = Boolean(viewer.role && ['owner', 'admin', 'program_officer'].includes(viewer.role));

  const data = !isUuid(applicationId)
    ? undefined
    : await rls(async (trx) => {
        const app = await trx
          .selectFrom('applications as a')
          .leftJoin('applicant_orgs as g', 'g.id', 'a.applicant_org_id')
          .select(['a.id', 'a.reference_number', 'a.title', 'a.status', 'a.applicant_org_id', 'g.legal_name'])
          .where('a.id', '=', applicationId)
          .where('a.workspace_id', '=', tenant.id)
          .executeTakeFirst();
        if (!app) return undefined;
        const award = await trx
          .selectFrom('awards')
          .select(['id', 'reference', 'status', 'amount_cents', 'currency', 'agreement_pending'])
          .where('application_id', '=', app.id)
          .where('kind', '=', 'original')
          .where('workspace_id', '=', tenant.id)
          .executeTakeFirst();
        const agreement = award
          ? await trx
              .selectFrom('agreements as g')
              .leftJoin('profiles as p', 'p.id', 'g.created_by')
              .select(['g.id', 'g.status', 'g.document_hash', 'g.document_path', 'g.created_at', 'g.last_modified_at', 'g.sent_at', 'p.full_name as created_by_name'])
              .where('g.award_id', '=', award.id)
              .where('g.status', '!=', 'void')
              .orderBy('g.created_at', 'desc')
              .executeTakeFirst()
          : undefined;
        const [signatures, admins] = await Promise.all([
          agreement
            ? trx
                .selectFrom('signatures as s')
                .leftJoin('profiles as p', 'p.id', 's.signer_id')
                .select(['s.id', 's.signer_role', 's.typed_name', 's.signed_at', 's.document_hash', 'p.full_name', 'p.email'])
                .where('s.agreement_id', '=', agreement.id)
                .orderBy('s.signed_at')
                .execute()
            : Promise.resolve([]),
          app.applicant_org_id
            ? trx
                .selectFrom('applicant_org_members as m')
                .innerJoin('profiles as p', 'p.id', 'm.user_id')
                .select(['p.full_name', 'p.email'])
                .where('m.org_id', '=', app.applicant_org_id)
                .where('m.role', '=', 'org_admin')
                .orderBy('p.full_name')
                .execute()
            : Promise.resolve([]),
        ]);
        return { app, award, agreement, signatures, admins };
      }).catch((e: unknown) => {
        console.error('[agreement] load failed', e);
        return null;
      });

  const crumbs = [
    { label: 'Console', href: '/console' },
    { label: 'Decisions', href: '/console/decisions?final=decided' },
    ...(data ? [{ label: 'Award builder', href: `/console/decisions/${data.app.id}/award` }] : []),
    { label: 'Letter & agreement' },
  ];

  if (data === null || forced === 'error') {
    return (
      <div className="grid gap-4">
        <PageHeader title="Award letter & agreement" breadcrumbs={crumbs} linkComponent={NextLink} />
        <ErrorState description="We couldn’t load the agreement. Your data is safe; try again in a moment." />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="grid gap-4">
        <PageHeader title="Award letter & agreement" breadcrumbs={crumbs} linkComponent={NextLink} />
        <NotFoundState description="That application doesn’t exist, or you don’t have access to it." action={<Button asChild variant="outline"><Link href="/console/decisions">Back to decisions</Link></Button>} />
      </div>
    );
  }

  const { app, award, agreement, signatures, admins } = data;
  const title = app.title ?? app.reference_number;
  const header = (
    <PageHeader
      title="Award letter & agreement"
      description={`${app.reference_number} · ${title} · ${app.legal_name ?? 'Individual applicant'}`}
      breadcrumbs={crumbs}
      linkComponent={NextLink}
      meta={
        award ? (
          <>
            <StatusChip kind="award" value={award.status} size="sm" />
            <span className="text-xs text-muted-foreground">
              Award {award.reference} · {formatMoney(award.amount_cents, award.currency)}
            </span>
          </>
        ) : undefined
      }
      actions={
        award ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/console/awards/${award.id}`}>Award page</Link>
          </Button>
        ) : undefined
      }
    />
  );

  if (forced === 'no-award' || !award || award.status !== 'active') {
    return (
      <div className="grid gap-4">
        {header}
        <EmptyState
          variant="page"
          icon={FileSignature}
          title={award?.status === 'draft' && forced !== 'no-award' ? 'Activate the award first' : 'There is no active award yet'}
          description="The award letter and grant agreement are generated from an active award: its amount, period, conditions, payment schedule and reporting requirements."
          action={
            <Button asChild>
              <Link href={`/console/decisions/${app.id}/award`}>
                Open the award builder <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const forcedStatus = forced === 'draft' || forced === 'sent' || forced === 'signed' ? forced : null;
  const status = forcedStatus ?? agreement?.status ?? 'none';
  const hasDocument = Boolean(agreement?.document_path);
  const grantee = signatures.find((s) => s.signer_role === 'grantee');
  const foundation = signatures.find((s) => s.signer_role === 'foundation');
  const stepIndex = STEPS.indexOf(status as (typeof STEPS)[number]);
  const stepDetail: Record<(typeof STEPS)[number], string | null> = {
    draft: agreement ? `${formatInZone(agreement.created_at, tenant.timezone)}${agreement.created_by_name ? ` · ${agreement.created_by_name}` : ''}` : null,
    sent: agreement?.sent_at ? formatInZone(agreement.sent_at, tenant.timezone) : null,
    signed: grantee ? `${formatInZone(grantee.signed_at, tenant.timezone)} · typed “${grantee.typed_name}”` : null,
    countersigned: foundation ? `${formatInZone(foundation.signed_at, tenant.timezone)} · typed “${foundation.typed_name}”` : null,
  };

  return (
    <div className="grid gap-6">
      {header}
      {forcedStatus && forcedStatus !== agreement?.status ? (
        <Alert variant="info" title={`Preview of the “${forcedStatus}” state`}>
          This view is forced with ?state={forcedStatus}; the real agreement is {agreement ? `“${agreement.status}”` : 'not generated yet'}.
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Status
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div>{status === 'none' ? <span className="text-sm text-muted-foreground">Not generated yet</span> : <AgreementStatusChip status={status} />}</div>
              <ol className="grid gap-3" aria-label="Agreement progress">
                {STEPS.map((s, i) => {
                  const done = stepIndex >= i;
                  const current = stepIndex + 1 === i;
                  const Icon = done ? CircleCheck : current ? CircleDot : Circle;
                  return (
                    <li key={s} className="flex items-start gap-2 text-sm">
                      <Icon aria-hidden="true" className={done ? 'mt-0.5 size-4 shrink-0 text-status-success-fg' : current ? 'mt-0.5 size-4 shrink-0 text-status-progress-fg' : 'mt-0.5 size-4 shrink-0 text-muted-foreground'} />
                      <span className="grid">
                        <span className={done ? 'font-medium' : 'text-muted-foreground'}>
                          {STEP_LABEL[s]}
                          <span className="sr-only">{done ? ' (done)' : current ? ' (next)' : ' (not yet)'}</span>
                        </span>
                        {done && stepDetail[s] ? <span className="text-xs text-muted-foreground">{stepDetail[s]}</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>

          <AgreementActions
            applicationId={app.id}
            awardId={award.id}
            agreementId={agreement?.id ?? null}
            status={status}
            canAct={canAct}
            recipients={admins.map((a) => ({ name: a.full_name || a.email, email: a.email }))}
            organization={app.legal_name}
          />

          {status === 'signed' ? (
            <Alert variant="info" title="Ready to countersign" actions={<Button asChild size="sm"><Link href={`/console/awards/${award.id}`}>Countersign on the award page</Link></Button>}>
              The grantee signed. An owner or admin countersigns for the foundation on the award page.
            </Alert>
          ) : null}
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Document
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {agreement?.document_hash ? (
                <p className="grid gap-1 text-sm">
                  <span className="text-muted-foreground">SHA-256 of the PDF (signatures bind to this hash)</span>
                  <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs break-all">{agreement.document_hash}</code>
                </p>
              ) : null}
              {hasDocument ? (
                <>
                  <iframe title={`Grant agreement PDF for award ${award.reference}`} src={`/console/decisions/${app.id}/agreement/pdf`} className="h-[70dvh] w-full rounded-md border bg-card" />
                  <p className="text-xs text-muted-foreground">
                    <a className="text-link underline" href={`/console/decisions/${app.id}/agreement/pdf`} target="_blank" rel="noreferrer">
                      Open the PDF in a new tab
                    </a>
                  </p>
                </>
              ) : (
                <EmptyState variant="inline" level={3} title="No document yet" description="Generate the award letter and agreement to preview the exact PDF the grantee will sign." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Signatures
              </CardTitle>
            </CardHeader>
            <CardContent>
              {signatures.length ? (
                <Table>
                  <TableCaption className="sr-only">Signatures on the agreement</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>For</TableHead>
                      <TableHead>Signed by</TableHead>
                      <TableHead>Typed name</TableHead>
                      <TableHead>When</TableHead>
                      <TableHead>Hash matches</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {signatures.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{s.signer_role === 'grantee' ? 'Grantee' : 'Foundation'}</TableCell>
                        <TableCell>{s.full_name ?? s.email ?? '—'}</TableCell>
                        <TableCell className="font-medium">{s.typed_name}</TableCell>
                        <TableCell>{formatInZone(s.signed_at, tenant.timezone)}</TableCell>
                        <TableCell>{s.document_hash === agreement?.document_hash ? 'Yes' : 'No — the document changed'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">No signatures yet. The grantee signs in their portal after you send the agreement.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
