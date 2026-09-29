// SPDX-License-Identifier: AGPL-3.0-or-later
// C-07 Application detail (staff): header (status, reference, organization, stage, amount, deadline/extension,
// agent-submitted treatment), tabs for answers, eligibility, attachments, activity, messages and internal
// notes, plus staff actions and the H-03 packet PDF.
// Supported `?state=` values (non-production): in-progress (show the unsubmitted answers view),
// info-requested, agent (agent-submitted treatment), not-found. `?tab=` picks the open tab.
import { sql } from '@gms/db';
import { APPLICATION_STATUS, formatInZone, toLocalInputValue, type ApplicationStatus } from '@gms/domain';
import {
  ActorBadge,
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DeadlineChip,
  DescriptionList,
  EmptyState,
  formatBytes,
  MoneyDisplay,
  NotFoundState,
  PageHeader,
  StatusChip,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Timeline,
  ToneChip,
  type FileScanStatus,
  type TimelineEvent,
} from '@gms/ui';
import { Bot, CheckCircle2, CircleHelp, Download, Loader, Paperclip, ShieldAlert, ShieldCheck, ShieldX, XCircle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ApplicationActions } from '@/components/console/grantmaking/applications/application-actions';
import { ApplicationFormView, type FormAnswers } from '@/components/console/grantmaking/applications/application-form-view';
import { sendStaffMessageAction } from '@/components/console/grantmaking/applications/actions';
import { NoteComposer } from '@/components/console/grantmaking/applications/note-composer';
import { DuplicateFlags } from '@/components/console/grantmaking/pipeline/pipeline-table';
import { MessageThread } from '@/components/messages/thread';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { actionLabel, applicationAudit, auditActor, compiledFromModel, isUuid, oneParam, type SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Application' };

const STATUS_ACTIONS = new Set([
  'applications.submit',
  'applications.withdraw',
  'applications.advance',
  'applications.mark_ineligible',
  'applications.request_info',
  'competitions.invite_applicants',
  'decisions.record_final',
  'decisions.bulk_decline',
]);

const TABS = ['application', 'eligibility', 'attachments', 'activity', 'messages', 'notes'] as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function scanStatus(s: string): FileScanStatus {
  if (s === 'infected') return 'infected';
  if (s === 'pending') return 'scanning';
  return 'clean';
}

function ScanChip({ status }: { status: string }) {
  if (status === 'clean') return <ToneChip tone="success" icon={ShieldCheck} size="sm" label="Clean" />;
  if (status === 'infected') return <ToneChip tone="danger" icon={ShieldX} size="sm" label="Infected — blocked" />;
  if (status === 'pending') return <ToneChip tone="muted" icon={Loader} size="sm" label="Scanning" />;
  return <ToneChip tone="warning" icon={ShieldAlert} size="sm" label="Not scanned" />;
}

function notFoundView() {
  return (
    <div className="grid gap-4">
      <PageHeader title="Application not found" linkComponent={NextLink} breadcrumbs={[{ label: 'Pipeline', href: '/console/pipeline' }, { label: 'Not found' }]} />
      <NotFoundState
        title="We couldn’t find that application"
        description="It may have been removed, or it belongs to another workspace."
        action={
          <Button asChild size="sm">
            <Link href="/console/pipeline">Back to the pipeline</Link>
          </Button>
        }
      />
    </div>
  );
}

export default async function ApplicationDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff()]);
  const { id } = await params;
  const sp = await searchParams;
  const forced = forcedState(sp);
  if (forced === 'not-found' || !isUuid(id)) return notFoundView();
  const tz = tenant.timezone;
  const canEdit = Boolean(viewer.role && ['owner', 'admin', 'program_officer'].includes(viewer.role));
  const canNote = Boolean(viewer.role && ['owner', 'admin', 'program_officer', 'finance'].includes(viewer.role));

  const data = await rls(async (trx) => {
    const app = await trx
      .selectFrom('applications as a')
      .innerJoin('opportunities as o', 'o.id', 'a.opportunity_id')
      .innerJoin('competitions as c', 'c.id', 'a.competition_id')
      .leftJoin('applicant_orgs as g', 'g.id', 'a.applicant_org_id')
      .leftJoin('profiles as p', 'p.id', 'a.applicant_user_id')
      .select([
        'a.id',
        'a.reference_number',
        'a.title',
        'a.status',
        'a.requested_amount_cents',
        'a.currency',
        'a.submitted_at',
        'a.submitted_via',
        'a.submitted_by_agent_client_id',
        'a.deadline_override_at',
        'a.info_requested_at',
        'a.info_request_note',
        'a.duplicate_of',
        'a.tags',
        'a.ai_disclosure',
        'a.created_at',
        'a.opportunity_id',
        'a.competition_id',
        'a.applicant_org_id',
        'o.title as opp_title',
        'c.name as stage_name',
        'c.closes_at',
        'c.allow_extensions',
        'g.legal_name',
        'g.dba_name',
        'g.ein',
        'p.full_name as applicant_name',
        'p.email as applicant_email',
      ])
      .where('a.id', '=', id)
      .where('a.workspace_id', '=', tenant.id)
      .executeTakeFirst();
    if (!app) return null;
    const [submission, responses, eligibility, rules, attachments, audit, history, thread, notes, extension, dupRows, inviteStages, reviews] = await Promise.all([
      trx
        .selectFrom('application_submissions as s')
        .leftJoin('profiles as sp', 'sp.id', 's.submitted_by')
        .select(['s.responses', 's.form_versions', 's.submitted_at', 's.receipt_number', 's.submitted_by_agent_client_id', 'sp.full_name as submitter_name'])
        .where('s.application_id', '=', id)
        .orderBy('s.submitted_at', 'desc')
        .executeTakeFirst(),
      trx.selectFrom('form_responses').select(['form_id', 'form_version_id', 'data']).where('application_id', '=', id).execute(),
      trx.selectFrom('eligibility_results').select(['id', 'question', 'passed', 'source', 'answer', 'evaluated_at']).where('application_id', '=', id).orderBy('evaluated_at').execute(),
      trx.selectFrom('eligibility_rules').select(['id', 'question', 'kind', 'knockout_message']).where('opportunity_id', '=', app.opportunity_id).orderBy('position').execute(),
      trx.selectFrom('attachments').select(['id', 'file_name', 'field_path', 'content_type', 'size_bytes', 'scan_status', 'created_at']).where('application_id', '=', id).where('status', '!=', 'deleted').orderBy('created_at').execute(),
      applicationAudit(trx, tenant.id, id),
      trx.selectFrom('status_history').select(['id', 'from_status', 'to_status', 'reason', 'actor_type', 'actor_name', 'created_at']).where('application_id', '=', id).orderBy('created_at', 'desc').execute(),
      trx.selectFrom('threads').select(['id']).where('application_id', '=', id).orderBy('created_at').executeTakeFirst(),
      trx
        .selectFrom('internal_notes as n')
        .leftJoin('profiles as p', 'p.id', 'n.author_id')
        .select(['n.id', 'n.body', 'n.created_at', 'p.full_name'])
        .where('n.workspace_id', '=', tenant.id)
        .where('n.entity_type', '=', 'application')
        .where('n.entity_id', '=', id)
        .orderBy('n.created_at', 'desc')
        .execute(),
      trx.selectFrom('applicant_extensions').select(['new_deadline', 'reason', 'created_at']).where('application_id', '=', id).orderBy('created_at', 'desc').executeTakeFirst(),
      sql<{ application_id: string; other_application_id: string; reason: string }>`
        select application_id, other_application_id, reason from gms.application_duplicates(${tenant.id}::uuid)
        where application_id = ${id}::uuid or other_application_id = ${id}::uuid`.execute(trx),
      trx.selectFrom('competitions').select(['id', 'name', 'opportunity_id', 'status']).where('opportunity_id', '=', app.opportunity_id).where('access', '=', 'invite').execute(),
      trx
        .selectFrom('review_assignments as ra')
        .leftJoin('reviews as r', 'r.assignment_id', 'ra.id')
        .select(['ra.status', 'r.status as review_status', 'r.weighted_score'])
        .where('ra.application_id', '=', id)
        .execute(),
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
    const agentClientId = submission?.submitted_by_agent_client_id ?? app.submitted_by_agent_client_id;
    const agentClient = agentClientId ? await trx.selectFrom('agent_clients').select(['name']).where('id', '=', agentClientId).executeTakeFirst() : undefined;

    // Forms: the submitted snapshot, or (not submitted / forced) the in-progress answers.
    const useDraft = !submission || forced === 'in-progress';
    let forms: { formId: string; versionId: string; data: Record<string, unknown> }[];
    if (!useDraft && submission) {
      const versions = (Array.isArray(submission.form_versions) ? submission.form_versions : []) as { formId?: string; formVersionId?: string }[];
      const resp = isObj(submission.responses) ? submission.responses : {};
      forms = versions.filter((v) => v.formVersionId).map((v) => ({ formId: v.formId ?? '', versionId: v.formVersionId!, data: (isObj(resp[v.formId ?? '']) ? resp[v.formId ?? ''] : {}) as Record<string, unknown> }));
    } else {
      forms = responses.map((r) => ({ formId: r.form_id, versionId: r.form_version_id, data: (isObj(r.data) ? r.data : {}) as Record<string, unknown> }));
    }
    const versionRows = forms.length
      ? await trx
          .selectFrom('form_versions as v')
          .innerJoin('forms as f', 'f.id', 'v.form_id')
          .select(['v.id', 'v.builder_model', 'f.name'])
          .where('v.id', 'in', forms.map((f) => f.versionId))
          .execute()
      : [];
    const otherIds = [...new Set([...dupRows.rows.map((d) => (d.application_id === id ? d.other_application_id : d.application_id)), ...(app.duplicate_of ? [app.duplicate_of] : [])])];
    const refs = otherIds.length ? await trx.selectFrom('applications').select(['id', 'reference_number']).where('id', 'in', otherIds).execute() : [];
    return { app, submission, useDraft, forms, versionRows, eligibility, rules, attachments, audit, history, messages, thread, notes, extension, dupRows: dupRows.rows, refs, inviteStages, reviews, agentName: agentClient?.name ?? null };
  });
  if (!data) return notFoundView();
  const { app } = data;

  const status = (forced === 'in-progress' ? 'in_progress' : app.status) as ApplicationStatus;
  const orgName = app.dba_name || app.legal_name || app.applicant_name || 'Individual applicant';
  const infoRequested = forced === 'info-requested' || Boolean(app.info_requested_at);
  const submitAudit = data.audit.find((a) => a.action === 'applications.submit');
  const viaAgent = forced === 'agent' || app.submitted_via === 'agent';
  const agentActor = viaAgent
    ? submitAudit?.actor_type === 'agent'
      ? auditActor(submitAudit)
      : { type: 'agent' as const, name: data.agentName ?? 'Grant Writer Assistant', onBehalfOfName: data.submission?.submitter_name ?? app.applicant_name ?? null }
    : null;
  const refOf = new Map(data.refs.map((r) => [r.id, r.reference_number]));
  const deadline = app.deadline_override_at ?? app.closes_at;
  const fileStatus = Object.fromEntries(data.attachments.map((a) => [a.id, scanStatus(a.scan_status)]));
  const forms: FormAnswers[] = data.forms.map((f) => {
    const v = data.versionRows.find((x) => x.id === f.versionId);
    return { formId: f.formId, versionId: f.versionId, title: v?.name ?? 'Application form', compiled: v ? compiledFromModel(v.id, v.builder_model) : null, data: f.data };
  });
  const submittedReviews = data.reviews.filter((r) => r.review_status === 'submitted');
  const scores = submittedReviews.map((r) => r.weighted_score).filter((x): x is number => x !== null).map(Number);
  const avg = scores.length ? scores.reduce((s, x) => s + x, 0) / scores.length : null;

  // Activity: audit entries plus status changes that have no audit entry at (about) the same time.
  const auditTimes = data.audit.filter((a) => STATUS_ACTIONS.has(a.action)).map((a) => new Date(a.occurred_at).getTime());
  const events: (TimelineEvent & { t: number })[] = [
    ...data.audit.map((a) => {
      const t = new Date(a.occurred_at).getTime();
      const h = STATUS_ACTIONS.has(a.action) ? data.history.find((x) => Math.abs(new Date(x.created_at).getTime() - t) < 5000) : undefined;
      return {
        id: `a-${a.id}`,
        t,
        at: a.occurred_at,
        actor: auditActor(a),
        action: actionLabel(a.action),
        tone: a.actor_type === 'agent' ? ('agent' as const) : undefined,
        detail: h ? (
          <span className="flex flex-wrap items-center gap-2">
            <StatusChip kind="application" value={h.to_status} size="sm" />
            {h.reason ? <span className="text-muted-foreground whitespace-pre-wrap">{h.reason}</span> : null}
          </span>
        ) : undefined,
      };
    }),
    ...data.history
      .filter((h) => !auditTimes.some((t) => Math.abs(t - new Date(h.created_at).getTime()) < 5000))
      .map((h) => ({
        id: `h-${h.id}`,
        t: new Date(h.created_at).getTime(),
        at: h.created_at,
        actor: auditActor({ actor_type: h.actor_type, actor_name: h.actor_name, on_behalf_of_name: null }),
        action: `changed the status to ${APPLICATION_STATUS[h.to_status as ApplicationStatus]?.label ?? h.to_status}`,
        detail: h.reason ? <p className="text-muted-foreground whitespace-pre-wrap">{h.reason}</p> : undefined,
      })),
  ].sort((a, b) => b.t - a.t);
  const tab = oneParam(sp, 'tab');
  const defaultTab = tab && (TABS as readonly string[]).includes(tab) ? tab : 'application';

  return (
    <div className="grid gap-4">
      <PageHeader
        linkComponent={NextLink}
        breadcrumbs={[{ label: 'Pipeline', href: '/console/pipeline' }, { label: app.reference_number }]}
        title={app.title ?? app.opp_title}
        description={`${app.reference_number} · ${orgName} · ${app.opp_title} / ${app.stage_name}`}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <StatusChip kind="application" value={status} />
            {viaAgent ? (
              <Badge variant="agent">
                <Bot aria-hidden="true" /> Via agent
              </Badge>
            ) : null}
            {app.requested_amount_cents !== null ? (
              <span className="text-sm">
                Requested <MoneyDisplay cents={Number(app.requested_amount_cents)} currency={app.currency} className="font-medium" />
              </span>
            ) : null}
            {deadline && status === 'in_progress' ? <DeadlineChip at={deadline} timeZone={tz} label={app.deadline_override_at ? 'Extended to' : 'Due'} size="sm" /> : null}
          </span>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <a href={`/console/applications/${app.id}/packet`} download>
              <Download aria-hidden="true" /> Packet PDF
            </a>
          </Button>
        }
      />

      {agentActor ? (
        <Alert variant="info" title="Submitted by an AI agent">
          <span className="flex flex-wrap items-center gap-2">
            <ActorBadge actor={agentActor} />
            <span className="text-muted-foreground">submitted this application{data.submission ? ` on ${formatInZone(data.submission.submitted_at, tz)}` : ''}. The applicant attested to it; answers are applicant-supplied.</span>
          </span>
        </Alert>
      ) : null}
      {infoRequested ? (
        <Alert variant="warning" title={`More information requested${app.info_requested_at ? ` on ${formatInZone(app.info_requested_at, tz)}` : ''}`}>
          <p className="whitespace-pre-wrap">{app.info_request_note ?? 'See the Messages tab for the request.'}</p>
        </Alert>
      ) : null}
      {app.duplicate_of ? (
        <Alert variant="info" title={`Marked as a duplicate of ${refOf.get(app.duplicate_of) ?? 'another application'}`}>
          <Link className="underline" href={`/console/applications/${app.duplicate_of}`}>
            Open {refOf.get(app.duplicate_of) ?? 'the original'}
          </Link>
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Tabs defaultValue={defaultTab} className="min-w-0">
          <TabsList className="flex-wrap">
            <TabsTrigger value="application">Application</TabsTrigger>
            <TabsTrigger value="eligibility">Eligibility ({data.eligibility.length})</TabsTrigger>
            <TabsTrigger value="attachments">Attachments ({data.attachments.length})</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="messages">Messages ({data.messages.length})</TabsTrigger>
            <TabsTrigger value="notes">Notes ({data.notes.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="application" className="grid gap-3">
            <h2 className="sr-only">Application answers</h2>
            {data.useDraft ? (
              <Alert variant="warning" title="Not submitted yet">
                These are the applicant’s in-progress answers. They can still change until the application is submitted.
              </Alert>
            ) : (
              <p className="text-xs text-muted-foreground">
                Submitted snapshot{data.submission ? ` · receipt ${data.submission.receipt_number} · ${formatInZone(data.submission.submitted_at, tz)}` : ''}. Answers are applicant-supplied.
              </p>
            )}
            {forms.length ? (
              <ApplicationFormView applicationId={app.id} forms={forms} fileStatus={fileStatus} />
            ) : (
              <EmptyState level={3} variant="inline" title="No answers yet" description="The applicant hasn’t saved any answers." />
            )}
          </TabsContent>

          <TabsContent value="eligibility" className="grid gap-4">
            <h2 className="text-base font-semibold">Eligibility results</h2>
            {data.eligibility.length ? (
              <ul className="grid gap-2 text-sm">
                {data.eligibility.map((e) => {
                  const note = isObj(e.answer) && typeof e.answer.note === 'string' ? e.answer.note : null;
                  return (
                    <li key={e.id} className="grid gap-1 rounded-md border p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{e.question}</span>
                        <span className="flex items-center gap-2">
                          {e.passed ? <ToneChip tone="success" icon={CheckCircle2} size="sm" label="Passed" /> : <ToneChip tone="danger" icon={XCircle} size="sm" label="Did not pass" />}
                          {e.source === 'agent' ? (
                            <Badge variant="agent">
                              <Bot aria-hidden="true" /> Agent suggestion
                            </Badge>
                          ) : (
                            <Badge variant="outline">{e.source === 'staff' ? 'Staff' : 'Applicant answer'}</Badge>
                          )}
                        </span>
                      </div>
                      {note ? <p className="text-muted-foreground whitespace-pre-wrap">{note}</p> : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No eligibility results recorded.</p>
            )}
            <h3 className="text-sm font-semibold">Opportunity eligibility rules</h3>
            {data.rules.length ? (
              <ol className="grid list-decimal gap-1 pl-5 text-sm">
                {data.rules.map((r) => (
                  <li key={r.id}>
                    {r.question} <span className="text-xs text-muted-foreground">({r.kind.replace(/_/g, ' ')}) — if not met: {r.knockout_message}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">This opportunity has no eligibility rules.</p>
            )}
          </TabsContent>

          <TabsContent value="attachments">
            <h2 className="sr-only">Attachments</h2>
            {data.attachments.length ? (
              <ul className="divide-y rounded-lg border text-sm">
                {data.attachments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <Paperclip aria-hidden="true" className="size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      {a.scan_status === 'infected' ? (
                        <span className="font-medium">{a.file_name}</span>
                      ) : (
                        <a className="font-medium underline-offset-2 hover:underline" href={`/console/applications/${app.id}/attachments/${a.id}`} download>
                          {a.file_name}
                        </a>
                      )}
                      <span className="block text-xs text-muted-foreground">
                        {a.field_path ?? 'Attachment'} · {formatBytes(Number(a.size_bytes))} · {formatInZone(a.created_at, tz)}
                      </span>
                    </span>
                    <ScanChip status={a.scan_status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No files uploaded.</p>
            )}
          </TabsContent>

          <TabsContent value="activity">
            <h2 className="sr-only">Activity</h2>
            {events.length ? <Timeline events={events} timeZone={tz} /> : <p className="text-sm text-muted-foreground">No activity yet.</p>}
          </TabsContent>

          <TabsContent value="messages">
            <h2 className="sr-only">Messages with the applicant</h2>
            <MessageThread
              messages={data.messages.map((m) => ({ id: m.id, body: m.body, side: m.author_side as 'staff' | 'applicant', authorName: m.full_name, viaAgent: m.agent_name, createdAt: m.created_at }))}
              timeZone={tz}
              viewerSide="staff"
              foundationName={tenant.brand.displayName}
              onSend={sendStaffMessageAction.bind(null, app.id)}
              emptyText="No messages yet. Messages you send here are emailed to the applicant and shown in their portal."
              disabled={!canNote}
            />
          </TabsContent>

          <TabsContent value="notes" className="grid gap-4">
            <h2 className="sr-only">Internal notes</h2>
            {canNote ? <NoteComposer entityType="application" entityId={app.id} /> : null}
            {data.notes.length ? (
              <ul className="grid gap-2">
                {data.notes.map((n) => (
                  <li key={n.id} className="rounded-md border bg-card p-3 text-sm">
                    <p className="mb-1 text-xs text-muted-foreground">
                      {n.full_name ?? 'Staff'} · {formatInZone(n.created_at, tz)}
                    </p>
                    <p className="whitespace-pre-wrap">{n.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No internal notes yet.</p>
            )}
          </TabsContent>
        </Tabs>

        <aside className="grid content-start gap-4">
          {canEdit ? (
            <Card>
              <CardHeader>
                <CardTitle as="h2" className="text-base">
                  Actions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ApplicationActions
                  applicationId={app.id}
                  reference={app.reference_number}
                  status={app.status}
                  opportunityId={app.opportunity_id}
                  competitionId={app.competition_id}
                  tags={app.tags}
                  deadlineLocal={toLocalInputValue(deadline, tz)}
                  timeZone={tz}
                  inviteStages={data.inviteStages.map((c) => ({ id: c.id, name: c.name, opportunityId: c.opportunity_id, status: c.status }))}
                />
              </CardContent>
            </Card>
          ) : null}
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
                  {
                    term: 'Organization',
                    detail: app.applicant_org_id ? (
                      <Link className="underline-offset-2 hover:underline" href={`/console/grantees/${app.applicant_org_id}`}>
                        {orgName}
                      </Link>
                    ) : (
                      orgName
                    ),
                  },
                  { term: 'EIN', detail: app.ein },
                  { term: 'Contact', detail: app.applicant_name ? `${app.applicant_name}${app.applicant_email ? ` · ${app.applicant_email}` : ''}` : app.applicant_email },
                  { term: 'Opportunity / stage', detail: `${app.opp_title} / ${app.stage_name}` },
                  { term: 'Requested', detail: app.requested_amount_cents !== null ? <MoneyDisplay cents={Number(app.requested_amount_cents)} currency={app.currency} /> : null },
                  { term: 'Started', detail: formatInZone(app.created_at, tz) },
                  { term: 'Submitted', detail: app.submitted_at ? formatInZone(app.submitted_at, tz) : 'Not yet' },
                  { term: 'Stage deadline', detail: app.closes_at ? formatInZone(app.closes_at, tz) : 'None' },
                  {
                    term: 'Extension',
                    detail: data.extension ? `${formatInZone(data.extension.new_deadline, tz)}${data.extension.reason ? ` — ${data.extension.reason}` : ''}` : app.allow_extensions ? 'None granted' : 'Not allowed on this stage',
                  },
                  { term: 'AI use disclosed', detail: app.ai_disclosure },
                  {
                    term: 'Tags',
                    detail: app.tags.length ? (
                      <span className="flex flex-wrap gap-1">
                        {app.tags.map((t) => (
                          <Badge key={t} variant="outline">
                            {t}
                          </Badge>
                        ))}
                      </span>
                    ) : null,
                  },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Reviews
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {data.reviews.length ? (
                <p>
                  {submittedReviews.length} of {data.reviews.filter((r) => r.status !== 'recused').length} submitted
                  {avg !== null ? ` · average ${avg.toFixed(1)}` : ''}
                  {data.reviews.some((r) => r.status === 'recused') ? ` · ${data.reviews.filter((r) => r.status === 'recused').length} recused` : ''}
                </p>
              ) : (
                <p className="text-muted-foreground">No reviewers assigned yet. Assign them from the pipeline.</p>
              )}
            </CardContent>
          </Card>
          {data.dupRows.length || app.duplicate_of ? (
            <Card>
              <CardHeader>
                <CardTitle as="h2" className="text-base">
                  Duplicates
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <DuplicateFlags
                  canEdit={canEdit}
                  row={{
                    id: app.id,
                    reference: app.reference_number,
                    duplicateOf: app.duplicate_of ? { id: app.duplicate_of, reference: refOf.get(app.duplicate_of) ?? 'another application' } : null,
                    possibleDuplicates: data.dupRows.map((d) => {
                      const other = d.application_id === app.id ? d.other_application_id : d.application_id;
                      return { otherId: other, otherReference: refOf.get(other) ?? 'another application', reason: d.reason };
                    }),
                  }}
                />
                {data.dupRows.length ? (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CircleHelp aria-hidden="true" className="size-3.5" /> Open the flag to mark it a duplicate or dismiss it.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
