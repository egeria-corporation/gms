// SPDX-License-Identifier: AGPL-3.0-only
// B-09 Application detail: status tracker, receipt, message thread (every status; info requested).
import { APPLICATION_STATUS, formatInZone, type ApplicationStatus } from '@gms/domain';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, DescriptionList, PageHeader, Section, StatusChip } from '@gms/ui';
import { Check, Circle, Download, PencilLine } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MessageThread } from '@/components/messages/thread';
import { NextLink } from '@/components/next-link';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { sendApplicantMessage } from '../actions';
import { WithdrawButton } from './withdraw';

export const metadata: Metadata = { title: 'Application' };

const NEXT_STEP: Record<ApplicationStatus, string> = {
  in_progress: 'Finish your answers and submit before the deadline. Your work saves automatically.',
  submitted: 'We received your application. Staff check that it’s complete, then reviewers read it. We’ll email you when your status changes.',
  under_review: 'Reviewers are reading your application. There’s nothing you need to do right now.',
  invited_to_next_stage: 'Congratulations — you’re invited to the next stage. Start the next application from the invitation link or your dashboard.',
  awarded: 'Congratulations! Watch for your award letter and agreement to sign.',
  declined: 'We weren’t able to fund this request. You’re welcome to apply again in a future round.',
  withdrawn: 'You withdrew this application. It won’t be reviewed.',
  ineligible: 'This application didn’t meet the eligibility requirements. See the note below.',
};

const TRACK: { status: ApplicationStatus[]; label: string }[] = [
  { status: ['in_progress'], label: 'Started' },
  { status: ['submitted'], label: 'Submitted' },
  { status: ['under_review', 'invited_to_next_stage'], label: 'In review' },
  { status: ['awarded', 'declined', 'ineligible', 'withdrawn'], label: 'Decision' },
];

export default async function ApplicationDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tenant = await requireTenant();
  const { id } = await params;
  const forced = forcedState(await searchParams);
  const data = await rls(async (trx) => {
    const app = await trx
      .selectFrom('applications as a')
      .innerJoin('opportunities as o', 'o.id', 'a.opportunity_id')
      .innerJoin('competitions as c', 'c.id', 'a.competition_id')
      .leftJoin('applicant_orgs as g', 'g.id', 'a.applicant_org_id')
      .select(['a.id', 'a.reference_number', 'a.title', 'a.status', 'a.submitted_at', 'a.info_requested_at', 'a.info_request_note', 'a.requested_amount_cents', 'a.created_at', 'o.title as opp_title', 'o.slug as opp_slug', 'c.name as stage', 'c.closes_at', 'g.legal_name'])
      .where('a.id', '=', id)
      .where('a.workspace_id', '=', tenant.id)
      .executeTakeFirst();
    if (!app) return null;
    const [history, submission, thread, decision] = await Promise.all([
      trx.selectFrom('status_history').select(['id', 'from_status', 'to_status', 'reason', 'actor_name', 'actor_type', 'created_at']).where('application_id', '=', id).orderBy('created_at').execute(),
      trx.selectFrom('application_submissions').select(['receipt_number', 'submitted_at', 'content_hash']).where('application_id', '=', id).orderBy('submitted_at', 'desc').executeTakeFirst(),
      trx.selectFrom('threads').select(['id']).where('application_id', '=', id).executeTakeFirst(),
      trx.selectFrom('decisions').select(['outcome', 'reason', 'recorded_at']).where('application_id', '=', id).where('is_final', '=', true).orderBy('recorded_at', 'desc').executeTakeFirst(),
    ]);
    const messages = thread
      ? await trx
          .selectFrom('messages as m')
          .leftJoin('profiles as p', 'p.id', 'm.author_id')
          .leftJoin('agent_clients as ac', 'ac.id', 'm.agent_client_id')
          .select(['m.id', 'm.body', 'm.author_side', 'm.created_at', 'p.full_name', 'ac.name as agent_name'])
          .where('m.thread_id', '=', thread.id)
          .orderBy('m.created_at')
          .execute()
      : [];
    return { app, history, submission, messages, decision };
  });
  if (!data) notFound();
  const { app, history, submission, messages, decision } = data;
  const status = ((forced && forced in APPLICATION_STATUS ? forced : app.status) as ApplicationStatus) ?? 'in_progress';
  const infoRequested = forced === 'info-requested' || Boolean(app.info_requested_at);
  const currentStep = TRACK.findIndex((t) => t.status.includes(status));

  return (
    <div className="grid gap-8 pb-16">
      <PageHeader
        density="spacious"
        linkComponent={NextLink}
        breadcrumbs={[{ label: 'My applications', href: '/portal' }, { label: app.reference_number }]}
        title={app.title ?? app.opp_title}
        description={`${app.opp_title} · ${app.stage}${app.legal_name ? ` · ${app.legal_name}` : ''}`}
        meta={<StatusChip kind="application" value={status} />}
        actions={
          status === 'in_progress' ? (
            <Button asChild size="lg">
              <Link href={`/portal/applications/${app.id}/form`}>
                <PencilLine aria-hidden="true" /> Continue application
              </Link>
            </Button>
          ) : submission ? (
            <Button asChild variant="secondary">
              <a href={`/portal/applications/${app.id}/packet`} download>
                <Download aria-hidden="true" /> Download a copy (PDF)
              </a>
            </Button>
          ) : undefined
        }
      />

      {infoRequested ? (
        <Alert variant="warning" title="The foundation asked for more information">
          <p className="whitespace-pre-wrap">{app.info_request_note ?? 'See the message below.'}</p>
          <p className="mt-2 text-sm">Reply in the messages below{status === 'in_progress' ? ', then update your answers and submit again' : ''}.</p>
        </Alert>
      ) : null}

      <section aria-labelledby="track-h" className="grid gap-4">
        <h2 id="track-h" className="sr-only">
          Where things stand
        </h2>
        <ol className="grid gap-3 sm:grid-cols-4">
          {TRACK.map((t, i) => {
            const done = i < currentStep || (i === currentStep && i === TRACK.length - 1);
            const current = i === currentStep;
            return (
              <li key={t.label} aria-current={current ? 'step' : undefined} className={`flex items-center gap-3 rounded-lg border p-3 ${current ? 'border-brand-600 bg-brand-50' : 'bg-card'}`}>
                <span className={`grid size-7 place-items-center rounded-full ${done || current ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`} aria-hidden="true">
                  {done ? <Check className="size-4" /> : <Circle className="size-3" />}
                </span>
                <span className="font-medium">{i === TRACK.length - 1 && currentStep === i ? APPLICATION_STATUS[status].label : t.label}</span>
              </li>
            );
          })}
        </ol>
        <Card>
          <CardContent className="pt-6">
            <p>
              <strong>What happens next: </strong>
              {NEXT_STEP[status]}
            </p>
            {decision?.reason && (status === 'declined' || status === 'ineligible') ? <p className="mt-2 text-sm text-muted-foreground">Note from the foundation: {decision.reason}</p> : null}
          </CardContent>
        </Card>
      </section>

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <Section id="messages" title="Messages" description={`Questions about this application? Write to ${tenant.brand.displayName} here.`}>
          <MessageThread
            messages={messages.map((m) => ({ id: m.id, body: m.body, side: m.author_side as 'staff' | 'applicant', authorName: m.full_name, viaAgent: m.agent_name, createdAt: m.created_at }))}
            timeZone={tenant.timezone}
            viewerSide="applicant"
            foundationName={tenant.brand.displayName}
            onSend={sendApplicantMessage.bind(null, app.id)}
            emptyText="No messages yet. If you have a question, ask it here — the program team usually replies within two business days."
          />
        </Section>
        <aside className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionList
                layout="stacked"
                items={[
                  { term: 'Reference', detail: app.reference_number },
                  { term: 'Receipt', detail: submission?.receipt_number },
                  { term: 'Submitted', detail: submission ? formatInZone(submission.submitted_at, tenant.timezone) : null },
                  { term: 'Deadline', detail: app.closes_at ? formatInZone(app.closes_at, tenant.timezone) : null },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="grid gap-2 text-sm">
                <li>Started {formatInZone(app.created_at, tenant.timezone)}</li>
                {history.map((h) => (
                  <li key={h.id}>
                    {APPLICATION_STATUS[h.to_status as ApplicationStatus]?.label ?? h.to_status} · {formatInZone(h.created_at, tenant.timezone)}
                    {h.actor_type === 'agent' ? <span className="block text-xs text-muted-foreground">{h.actor_name}</span> : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
          {['in_progress', 'submitted', 'under_review', 'invited_to_next_stage'].includes(status) ? <WithdrawButton applicationId={app.id} /> : null}
        </aside>
      </div>
    </div>
  );
}
