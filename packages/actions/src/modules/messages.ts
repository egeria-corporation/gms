// SPDX-License-Identifier: AGPL-3.0-only
// Threaded messages between applicants and foundation staff, and internal notes.
import { DomainError } from '@gms/domain';
import { z } from 'zod';
import { defineAction } from '../define';
import { agentClientId, found, uid, uuid, ws } from './lib';

export const sendMessage = defineAction({
  id: 'messages.send',
  title: 'Send a message',
  description:
    'Sends a message in the thread for an application (or award). Applicants use it to reply to the foundation; staff use it to write to the applicant. Creates the thread on first use.',
  input: z.object({
    applicationId: uuid.optional(),
    awardId: uuid.optional(),
    threadId: uuid.optional(),
    subject: z.string().trim().max(200).optional(),
    body: z.string().trim().min(1).max(20000),
  }),
  output: z.object({ threadId: z.string().uuid(), messageId: z.string().uuid() }),
  scopes: ['messages:write'],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const me = uid(ctx);
    const isStaff = ctx.roles.some((r) => ['owner', 'admin', 'program_officer', 'finance'].includes(r));
    let threadId = input.threadId ?? null;
    let applicationId = input.applicationId ?? null;
    if (threadId) {
      const t = found(await ctx.db.selectFrom('threads').selectAll().where('id', '=', threadId).executeTakeFirst(), 'thread');
      applicationId = t.application_id;
    } else {
      if (!applicationId && !input.awardId) throw new DomainError('validation_failed', 'Say which application or award this message is about.');
      let tq = ctx.db.selectFrom('threads').select('id').where('workspace_id', '=', w.id);
      tq = applicationId ? tq.where('application_id', '=', applicationId) : tq.where('award_id', '=', input.awardId!);
      const existing = await tq.orderBy('created_at').executeTakeFirst();
      if (existing) threadId = existing.id;
      else {
        let subject = input.subject;
        if (!subject && applicationId) {
          const app = found(await ctx.db.selectFrom('applications').select(['reference_number', 'title']).where('id', '=', applicationId).executeTakeFirst(), 'application');
          subject = `${app.title ?? 'Application'} (${app.reference_number})`;
        }
        const t = await ctx.db
          .insertInto('threads')
          .values({ workspace_id: w.id, application_id: applicationId, award_id: input.awardId ?? null, subject: subject ?? 'Message', created_by: me })
          .returning('id')
          .executeTakeFirstOrThrow();
        threadId = t.id;
      }
    }
    const side = isStaff ? 'staff' : 'applicant';
    const m = await ctx.db
      .insertInto('messages')
      .values({
        workspace_id: w.id,
        thread_id: threadId!,
        author_id: me,
        author_side: side,
        agent_client_id: agentClientId(ctx),
        body: input.body,
        ...(side === 'staff' ? { read_by_staff_at: ctx.now().toISOString() } : { read_by_applicant_at: ctx.now().toISOString() }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await ctx.db.updateTable('threads').set({ last_message_at: ctx.now().toISOString() }).where('id', '=', threadId!).execute();
    ctx.audit({ entityType: 'message', entityId: m.id, after: { threadId, side, length: input.body.length } });
    ctx.emit('message.sent', { type: 'thread', id: threadId }, { messageId: m.id, side, applicationId, authorName: ctx.actor.name });
    return { threadId: threadId!, messageId: m.id };
  },
});

export const markThreadRead = defineAction({
  id: 'messages.mark_read',
  title: 'Mark a thread read',
  description: 'Marks every message in a thread as read for your side of the conversation (applicant or foundation).',
  input: z.object({ threadId: uuid }),
  output: z.object({ ok: z.literal(true) }),
  scopes: ['messages:read'],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const isStaff = ctx.roles.some((r) => ['owner', 'admin', 'program_officer', 'finance'].includes(r));
    const now = ctx.now().toISOString();
    if (isStaff) {
      await ctx.db.updateTable('messages').set({ read_by_staff_at: now }).where('thread_id', '=', input.threadId).where('read_by_staff_at', 'is', null).execute();
    } else {
      await ctx.db.updateTable('messages').set({ read_by_applicant_at: now }).where('thread_id', '=', input.threadId).where('read_by_applicant_at', 'is', null).execute();
    }
    return { ok: true as const };
  },
});

export const addInternalNote = defineAction({
  id: 'notes.add',
  title: 'Add an internal note',
  description: 'Adds a staff-only note to an application, organization, award or payment. Applicants never see notes.',
  input: z.object({ entityType: z.enum(['application', 'org', 'award', 'payment']), entityId: uuid, body: z.string().trim().min(1).max(20000) }),
  output: z.object({ id: z.string().uuid() }),
  scopes: ['pipeline:read'],
  roles: ['owner', 'admin', 'program_officer', 'finance'],
  riskTier: 'R1',
  idempotent: false,
  async run(input, ctx) {
    const w = ws(ctx);
    const r = await ctx.db
      .insertInto('internal_notes')
      .values({ workspace_id: w.id, entity_type: input.entityType, entity_id: input.entityId, author_id: uid(ctx), body: input.body })
      .returning('id')
      .executeTakeFirstOrThrow();
    ctx.audit({ entityType: input.entityType, entityId: input.entityId, action: 'notes.add', after: { noteId: r.id } });
    return { id: r.id };
  },
});
