// SPDX-License-Identifier: AGPL-3.0-only
// CM-02 Bulk message composer (states: confirm-count, bounced, empty). Segment builder + message, count
// recipients, type the count to confirm, then send; below, message history with delivery results.
import { sql } from '@gms/db';
import { MERGE_FIELDS } from '@gms/email';
import { Alert, PageHeader, Section } from '@gms/ui';
import type { Metadata } from 'next';
import { Composer, type ComposerDraft, type SegmentValue } from '@/components/console/admin/comms/composer';
import { MessageHistory, type HistoryMessage } from '@/components/console/admin/comms/message-history';
import type { RecipientRow } from '../actions';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState, one } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { renderMessagePreview } from '../preview';

export const metadata: Metadata = { title: 'Send a message' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toSegment(raw: unknown): SegmentValue {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    opportunityId: str(s.opportunityId),
    competitionId: str(s.competitionId),
    applicationStatuses: arr(s.applicationStatuses),
    awardStatuses: arr(s.awardStatuses),
    programId: str(s.programId),
    reportOverdue: s.reportOverdue === true,
  };
}

const EMPTY_SEGMENT: SegmentValue = { opportunityId: '', competitionId: '', applicationStatuses: [], awardStatuses: [], programId: '', reportOverdue: false };

const PREVIEW_DRAFT: ComposerDraft = {
  id: null,
  subject: 'Info session for {{opportunity.name}} on October 14',
  bodyMd: [
    'Hi {{applicant.first_name}},',
    '',
    'We’re hosting a **free online info session** for {{opportunity.name}} on *October 14 at noon Pacific*.',
    '',
    'Bring your questions about eligibility and budgets.',
    '',
    'Warmly,',
    '{{sender.name}}',
  ].join('\n'),
  segment: { ...EMPTY_SEGMENT, applicationStatuses: ['in_progress', 'submitted'] },
  templateKey: null,
  recipientCount: 142,
};

const PREVIEW_BOUNCED: { message: HistoryMessage; recipients: RecipientRow[] } = {
  message: {
    id: 'preview-bounced',
    subject: 'Reminder: final reports are due October 31',
    status: 'sent',
    recipientCount: 38,
    date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: 'Priya Natarajan',
    viaAgent: false,
    counts: { delivered: 35, bounced: 2, sent: 1 },
  },
  recipients: [
    { id: 'p1', email: 'director@riverbend-food-share.example', status: 'bounced', error: 'Mailbox does not exist (550 5.1.1)', updatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
    { id: 'p2', email: 'grants@old-mill-arts.example', status: 'bounced', error: 'Domain has no mail server', updatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
    { id: 'p3', email: 'maya@eastside-youth-music.example', status: 'sent', error: null, updatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
    { id: 'p4', email: 'luis@harborview-tenants.example', status: 'delivered', error: null, updatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
    { id: 'p5', email: 'office@cedar-hollow-library.example', status: 'delivered', error: null, updatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
  ],
};

export default async function ComposePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'program_officer', 'auditor'])]);
  const forced = forcedState(sp);
  const canSend = viewer.role !== 'auditor';
  const draftParam = one(sp.draft);

  const d = await rls(async (trx) => {
    const [opportunities, competitions, programs, templates, messages, editing, latestDraft] = await Promise.all([
      trx.selectFrom('opportunities').select(['id', 'title']).where('workspace_id', '=', tenant.id).orderBy('title').execute(),
      trx.selectFrom('competitions').select(['id', 'name', 'opportunity_id']).where('workspace_id', '=', tenant.id).orderBy('stage_order').execute(),
      trx.selectFrom('programs').select(['id', 'name']).where('workspace_id', '=', tenant.id).orderBy('name').execute(),
      trx.selectFrom('email_templates').select(['key', 'name', 'subject', 'body_md']).where('workspace_id', '=', tenant.id).orderBy('name').execute(),
      trx
        .selectFrom('bulk_messages as m')
        .leftJoin('profiles as p', 'p.id', 'm.created_by')
        .select(['m.id', 'm.subject', 'm.status', 'm.recipient_count', 'm.sent_at', 'm.created_at', 'm.created_by_agent_client_id', 'p.full_name'])
        .where('m.workspace_id', '=', tenant.id)
        .orderBy('m.created_at', 'desc')
        .limit(25)
        .execute(),
      draftParam && UUID.test(draftParam)
        ? trx.selectFrom('bulk_messages').select(['id', 'subject', 'body_md', 'segment', 'template_key', 'recipient_count']).where('workspace_id', '=', tenant.id).where('id', '=', draftParam).where('status', '=', 'draft').executeTakeFirst()
        : Promise.resolve(undefined),
      forced === 'confirm-count'
        ? trx.selectFrom('bulk_messages').select(['id', 'subject', 'body_md', 'segment', 'template_key', 'recipient_count']).where('workspace_id', '=', tenant.id).where('status', '=', 'draft').where('recipient_count', '>', 0).orderBy('last_modified_at', 'desc').executeTakeFirst()
        : Promise.resolve(undefined),
    ]);
    const ids = messages.map((m) => m.id);
    const counts = ids.length
      ? await trx
          .selectFrom('email_deliveries')
          .select(['bulk_message_id', 'status', sql<number>`count(*)::int`.as('n')])
          .where('workspace_id', '=', tenant.id)
          .where('bulk_message_id', 'in', ids)
          .groupBy(['bulk_message_id', 'status'])
          .execute()
      : [];
    return { opportunities, competitions, programs, templates, messages, counts, editing, latestDraft };
  });

  let history: HistoryMessage[] =
    forced === 'empty'
      ? []
      : d.messages.map((m) => ({
          id: m.id,
          subject: m.subject,
          status: m.status,
          recipientCount: m.recipient_count,
          date: m.sent_at ?? m.created_at,
          createdBy: m.full_name,
          viaAgent: Boolean(m.created_by_agent_client_id),
          counts: Object.fromEntries(d.counts.filter((c) => c.bulk_message_id === m.id).map((c) => [c.status, Number(c.n)])),
        }));
  let previewRecipients: Record<string, RecipientRow[]> = {};
  let expandedId: string | null = null;
  if (forced === 'bounced') {
    const real = history.find((m) => (m.counts.bounced ?? 0) > 0);
    if (real) expandedId = real.id;
    else {
      history = [PREVIEW_BOUNCED.message, ...history];
      previewRecipients = { [PREVIEW_BOUNCED.message.id]: PREVIEW_BOUNCED.recipients };
      expandedId = PREVIEW_BOUNCED.message.id;
    }
  }

  const source = d.editing ?? (forced === 'confirm-count' ? d.latestDraft : undefined);
  let draft: ComposerDraft | null = source
    ? { id: source.id, subject: source.subject, bodyMd: source.body_md, segment: toSegment(source.segment), templateKey: source.template_key, recipientCount: source.recipient_count }
    : null;
  let previewOnly = false;
  if (forced === 'confirm-count' && !draft) {
    draft = PREVIEW_DRAFT;
    previewOnly = true;
  }
  const initialPreview = await renderMessagePreview(tenant, viewer.name, draft?.subject ?? '', draft?.bodyMd ?? '');

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Send a message"
        description="Email a group of applicants or grantees. Count the recipients first; nothing is sent until you confirm the exact number."
        breadcrumbs={[{ label: 'Messages & email', href: '/console/comms' }, { label: 'Send a message' }]}
        linkComponent={NextLink}
      />
      {canSend ? (
        <Composer
          key={draft?.id ?? (previewOnly ? 'preview' : 'new')}
          initialDraft={draft}
          openConfirm={forced === 'confirm-count'}
          previewOnly={previewOnly}
          initialPreview={initialPreview}
          opportunities={d.opportunities.map((o) => ({ id: o.id, label: o.title }))}
          competitions={d.competitions.map((c) => ({ id: c.id, label: c.name, opportunityId: c.opportunity_id }))}
          programs={d.programs.map((p) => ({ id: p.id, label: p.name }))}
          templates={d.templates.map((t) => ({ key: t.key, name: t.name, subject: t.subject, bodyMd: t.body_md }))}
          mergeFields={MERGE_FIELDS.map((f) => ({ key: f.key, label: f.label, example: f.example }))}
        />
      ) : (
        <Alert variant="info" title="View only">
          Auditors can review message history and delivery results but can’t write or send messages.
        </Alert>
      )}
      <Section title="Message history" description="Drafts and sent messages, newest first. Open a message to see each recipient’s delivery status.">
        <MessageHistory messages={history} timeZone={tenant.timezone} canEdit={canSend} previewRecipients={previewRecipients} expandedId={expandedId} />
      </Section>
    </div>
  );
}
