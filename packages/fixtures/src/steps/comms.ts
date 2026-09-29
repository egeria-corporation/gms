// SPDX-License-Identifier: AGPL-3.0-or-later
// Communications: email template overrides, notification rules, message threads (applications and awards),
// a sent bulk message, and in-app notifications.
import { json, type Row, type SeedContext } from '../context';
import type { Apps } from './applications';
import type { Awards } from './awards';

export async function comms(ctx: SeedContext, apps: Apps, aw: Awards, agentClientId: string): Promise<void> {
  const c = ctx.clock;
  const hal = ctx.ws('halcyon');
  const jordan = ctx.person('jordan');

  const templates: [string, string, string, string, string[]][] = [
    ['submission_receipt', 'Submission receipt', 'We received your application to {{opportunity.name}}', 'Hi {{applicant.first_name}},\n\nThank you! We received **{{application.title}}** ({{application.reference}}). You can see its status any time in your portal: {{portal.url}}\n\nWarmly,\nThe Halcyon Ridge team', ['applicant.first_name', 'opportunity.name', 'application.title', 'application.reference', 'portal.url']],
    ['status_change', 'Status update', 'An update on your application {{application.reference}}', 'Hi {{applicant.first_name}},\n\nYour application **{{application.title}}** is now: **{{application.status}}**.\n\nQuestions? Just reply to this email.', ['applicant.first_name', 'application.title', 'application.status', 'application.reference']],
    ['award_notice', 'Award notice', 'Good news from {{foundation.name}}', 'Hi {{applicant.first_name}},\n\nWe are delighted to award **{{organization.name}}** a grant of **{{award.amount}}** ({{award.reference}}). Your agreement is ready to sign in the portal.', ['applicant.first_name', 'foundation.name', 'organization.name', 'award.amount', 'award.reference']],
    ['deadline_reminder', 'Deadline reminder', '{{opportunity.name}} closes {{opportunity.deadline}}', 'Hi {{applicant.first_name}},\n\nA friendly reminder that **{{opportunity.name}}** closes **{{opportunity.deadline}}**. Your draft is saved. Pick up where you left off: {{application.url}}', ['applicant.first_name', 'opportunity.name', 'opportunity.deadline', 'application.url']],
    ['report_due', 'Report due', 'Your report for {{award.reference}} is due soon', 'Hi {{applicant.first_name}},\n\nYour next report for **{{award.reference}}** is due soon. It takes about 20 minutes, and short answers are fine.', ['applicant.first_name', 'award.reference']],
    ['payment_sent', 'Payment sent', 'A payment is on its way', 'Hi {{applicant.first_name}},\n\nWe sent a payment for **{{award.reference}}**. It should arrive in 1–2 business days.', ['applicant.first_name', 'award.reference']],
  ];
  await ctx.insert(
    'email_templates',
    templates.map(([key, name, subject, body, fields]) => ({ id: ctx.id(`email-template:${key}`), workspace_id: hal.id, key, name, subject, body_md: body, merge_fields: fields, updated_by: jordan.id, created_at: c.iso(-300) })),
  );
  for (const [key, , subject] of templates) ctx.audit({ workspace: 'halcyon', at: c.iso(-300), actor: ctx.human('jordan'), action: 'comms.save_template', entityType: 'email_template', entityId: ctx.id(`email-template:${key}`), after: { key, subject } });

  const rules: [string, 'email' | 'in_app', string, string | null, number | null][] = [
    ['application.submitted', 'email', 'applicant', 'submission_receipt', null],
    ['application.submitted', 'in_app', 'program_officer', null, null],
    ['application.status_changed', 'email', 'applicant', 'status_change', null],
    ['opportunity.deadline', 'email', 'applicant', 'deadline_reminder', -7],
    ['opportunity.deadline', 'email', 'applicant', 'deadline_reminder', -1],
    ['award.created', 'email', 'applicant', 'award_notice', null],
    ['report.due', 'email', 'applicant', 'report_due', -14],
    ['payment.sent', 'email', 'applicant', 'payment_sent', null],
    ['payment.requested', 'in_app', 'finance', null, null],
    ['approval.requested', 'in_app', 'admins', null, null],
  ];
  await ctx.insert(
    'notification_rules',
    rules.map(([event, channel, audience, template, offset], i) => ({ id: ctx.id(`notification-rule:${i}`), workspace_id: hal.id, event_type: event, channel, audience, template_key: template, offset_days: offset, enabled: true, created_at: c.iso(-300) })),
  );

  // Threads & messages -------------------------------------------------------------------------------------------
  const threads: Row<'threads'>[] = [];
  const messages: Row<'messages'>[] = [];
  const thread = (id: string, subject: string, link: { application_id?: string; award_id?: string }, msgs: { side: 'staff' | 'applicant' | 'system'; author: string | null; body: string; at: string; agent?: boolean; read?: boolean }[]) => {
    threads.push({ id, workspace_id: hal.id, ...link, subject, created_by: msgs[0]?.author ?? jordan.id, last_message_at: msgs[msgs.length - 1]!.at, created_at: msgs[0]!.at });
    msgs.forEach((m, i) =>
      messages.push({
        id: ctx.id(`message:${id}:${i}`),
        workspace_id: hal.id,
        thread_id: id,
        author_id: m.author,
        author_side: m.side,
        agent_client_id: m.agent ? agentClientId : null,
        body: m.body,
        read_by_applicant_at: m.side === 'applicant' || m.read !== false ? m.at : null,
        read_by_staff_at: m.side === 'staff' || m.read !== false ? m.at : null,
        created_at: m.at,
      }),
    );
  };
  const maya = ctx.person('maya');
  thread(ctx.id('thread:maya-award'), `Eastside Youth Orchestra (${aw.maya.ref})`, { award_id: aw.maya.id }, [
    { side: 'staff', author: jordan.id, body: 'Hi Maya, congratulations again on a great first year! Your year-two interim report opens next month. Let me know if you would like to talk through it.', at: c.iso(-20) },
    { side: 'applicant', author: maya.id, body: 'Thank you, Jordan! We will send it early. The winter concert is December 12 if you would like to come.', at: c.iso(-19) },
    { side: 'applicant', author: maya.id, body: 'Quick question: can we move $1,500 from instruments to teaching artist fees? We received a donated set of violas.', at: c.iso(-2), agent: true, read: false },
  ]);
  if (apps.mayaLoi) {
    thread(ctx.id('thread:maya-loi'), `Question about the Youth Arts Fund 2027 LOI`, { application_id: apps.mayaLoi.id }, [
      { side: 'applicant', author: maya.id, body: 'Can our summer intensive include students who turn 12 in August?', at: c.iso(-5) },
      { side: 'staff', author: jordan.id, body: 'Yes. Anyone who is 12 by the time the program starts is eligible.', at: c.iso(-4) },
    ]);
  }
  const flagshipQs = apps.byOpp.flagship.filter((a) => a.status === 'submitted').slice(0, 8);
  flagshipQs.forEach((a, i) => {
    thread(ctx.id(`thread:${a.id}`), `${a.title} (${a.ref})`, { application_id: a.id }, [
      { side: 'applicant', author: a.org.admin.id, body: ['Can we attach a letter of support after submitting?', 'Is it OK that our budget includes a small amount for bus passes?', 'We are fiscally sponsored. Whose EIN goes on the form?', 'Will reviewers see our organization’s name?'][i % 4]!, at: a.submittedAt! },
      ...(i % 3 === 2 ? [] : [{ side: 'staff' as const, author: jordan.id, body: ['Yes, send it here and we will add it to your file.', 'Yes, transportation is an allowed cost.', 'Use your sponsor’s EIN, and tell us your sponsor’s name.', 'Not during the first round. Names are hidden from reviewers.'][i % 4]!, at: new Date(Date.parse(a.submittedAt!) + 86_400_000).toISOString() }]),
    ]);
  });
  const infoRequested = apps.byOpp.flagship.filter((a) => a.status === 'under_review')[3];
  if (infoRequested) {
    thread(ctx.id(`thread:${infoRequested.id}`), `${infoRequested.title} (${infoRequested.ref})`, { application_id: infoRequested.id }, [
      { side: 'staff', author: jordan.id, body: 'Thanks for your letter! Could you tell us roughly how many of the young people you serve are 18 or older?', at: c.iso(-3), read: false },
    ]);
    await ctx.db.updateTable('applications').set({ info_requested_at: c.iso(-3), info_request_note: 'How many of the young people you serve are 18 or older?' }).where('id', '=', infoRequested.id).execute();
  }
  await ctx.insert('threads', threads);
  await ctx.insert('messages', messages);

  // A bulk message that went out to all flagship applicants with drafts.
  await ctx.insert('bulk_messages', [
    {
      id: ctx.id('bulk:loi-reminder'),
      workspace_id: hal.id,
      template_key: 'deadline_reminder',
      segment: json({ opportunityId: apps.byOpp.flagship[0]!.opp.id, applicationStatuses: ['in_progress'] }),
      subject: 'Youth Arts Fund 2027: your letter of inquiry is saved',
      body_md: 'Hi {{applicant.first_name}},\n\nYour letter of inquiry is saved. Letters are due **December 5 at 5:00 PM Pacific**.',
      recipient_count: apps.byOpp.flagship.filter((a) => a.status === 'in_progress').length,
      status: 'sent',
      created_by: jordan.id,
      sent_at: c.iso(-2),
      created_at: c.iso(-2, -1),
    },
  ]);
  ctx.audit({ workspace: 'halcyon', at: c.iso(-2), actor: ctx.human('jordan'), action: 'comms.send_bulk_message', entityType: 'bulk_message', entityId: ctx.id('bulk:loi-reminder'), after: { recipients: apps.byOpp.flagship.filter((a) => a.status === 'in_progress').length }, riskTier: 'R2' });

  // In-app notifications ------------------------------------------------------------------------------------------
  const note = (key: string, i: number, title: string, body: string, link: string, at: string, read = false) => ({
    id: ctx.id(`notification:${key}:${i}`),
    workspace_id: hal.id,
    user_id: ctx.person(key).id,
    kind: 'info',
    title,
    body,
    link,
    read_at: read ? at : null,
    created_at: at,
  });
  const notifications: Row<'notifications'>[] = [
    note('marcus', 0, 'Payment batch awaiting your approval', 'Priya Natarajan sent “October grant payments” (4 payments) for approval.', '/console/payments/batches', c.iso(-1)),
    note('priya', 0, 'Bank transaction needs attention', 'An outgoing payment of $1,250.00 has no matching grant payment.', '/console/payments/reconciliation', c.iso(-8), true),
    note('priya', 1, 'Two payments failed', 'The bank rejected two year-two installments. Review and retry.', '/console/payments', c.iso(-20), true),
    note('jordan', 0, 'New letters of inquiry', 'Several letters of inquiry were submitted for Youth Arts Fund 2027.', '/console/applications', c.iso(-1)),
    note('jordan', 1, 'Change request', 'A grantee asked for a two-week report extension.', '/console/awards', c.iso(-2)),
    note('jordan', 2, 'Agent requests waiting', 'Ops Assistant asked for confirmation on 4 actions.', '/console/approvals', c.iso(0, -1)),
    note('helen', 0, 'Sanctions screening needs review', 'Cedar Hollow Food Pantry has a potential match. Payments are blocked until someone reviews it.', '/console/compliance', c.iso(0, -1)),
    note('helen', 1, 'Board meeting in session', 'Board meeting: Rapid Response recommendations is now in session.', '/console/board', c.iso(0, -2)),
    note('ruth', 0, 'Your vote is needed', '4 Rapid Response recommendations are ready for a vote.', '/console/board', c.iso(0, -2)),
    note('samuel', 0, 'New review assignments', 'You have new Youth Arts Fund 2027 letters to review.', '/console/reviews', c.iso(-6)),
    note('maya', 0, 'Your agent needs your confirmation', 'Grant Writer Assistant asked to submit your Year 2 interim report.', '/portal/approvals', c.iso(0, -1)),
    note('maya', 1, 'Payment sent', `A payment for ${aw.maya.ref} is on its way.`, '/portal/awards', c.iso(-4), true),
    note('maya', 2, 'Report due in 30 days', 'Your Year 2 interim report is due next month.', '/portal/awards', c.iso(-1)),
  ];
  await ctx.insert('notifications', notifications);
}
