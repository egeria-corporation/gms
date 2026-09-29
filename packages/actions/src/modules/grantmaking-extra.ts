// SPDX-License-Identifier: AGPL-3.0-or-later
// Grantmaking console gaps: grantee CRM profile (tags, relationship owner), "not a duplicate"
// dismissals, board docket curation (add / remove / reorder items) and form metadata.
// grantee_profiles and application_duplicate_dismissals (migration 1500) are not in the generated
// Kysely types yet, so they are written with parameterized SQL.
import { sql } from '@gms/db';
import { DomainError } from '@gms/domain';
import { z } from 'zod';
import { defineAction, type RunContext } from '../define';
import { found, Ok, uid, uuid, ws } from './lib';

const PROGRAM_ROLES = ['owner', 'admin', 'program_officer'] as const;

// Grantee CRM ---------------------------------------------------------------------------------
export const updateGranteeProfile = defineAction({
  id: 'grantees.update_profile',
  title: 'Update a grantee profile',
  description:
    'Updates the foundation’s own notes about an applicant organization: staff-only tags, the relationship owner (a team member) and a short relationship summary. Applicants never see these.',
  input: z.object({
    applicantOrgId: uuid,
    tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
    relationshipOwnerId: uuid.nullable().optional(),
    summary: z.string().max(5000).nullable().optional(),
  }),
  output: Ok,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    found(
      await ctx.db
        .selectFrom('applicant_orgs as o')
        .select('o.id')
        .where('o.id', '=', input.applicantOrgId)
        .where((eb) => eb.exists(eb.selectFrom('applications as a').select('a.id').whereRef('a.applicant_org_id', '=', 'o.id').where('a.workspace_id', '=', w.id)))
        .executeTakeFirst(),
      'organization',
    );
    if (input.relationshipOwnerId) {
      found(
        await ctx.db.selectFrom('workspace_members').select('id').where('workspace_id', '=', w.id).where('user_id', '=', input.relationshipOwnerId).where('status', '=', 'active').executeTakeFirst(),
        'team member',
      );
    }
    const before = await sql<{ tags: string[]; relationship_owner_id: string | null; summary: string | null }>`
      select tags, relationship_owner_id, summary from public.grantee_profiles
      where workspace_id = ${w.id}::uuid and applicant_org_id = ${input.applicantOrgId}::uuid`.execute(ctx.db);
    const prev = before.rows[0];
    const tags = input.tags !== undefined ? [...new Set(input.tags)] : (prev?.tags ?? []);
    const owner = input.relationshipOwnerId !== undefined ? input.relationshipOwnerId : (prev?.relationship_owner_id ?? null);
    const summary = input.summary !== undefined ? input.summary : (prev?.summary ?? null);
    await sql`
      insert into public.grantee_profiles (workspace_id, applicant_org_id, tags, relationship_owner_id, summary)
      values (${w.id}::uuid, ${input.applicantOrgId}::uuid, ${tags}::text[], ${owner}::uuid, ${summary})
      on conflict (workspace_id, applicant_org_id)
      do update set tags = excluded.tags, relationship_owner_id = excluded.relationship_owner_id, summary = excluded.summary`.execute(ctx.db);
    ctx.audit({ entityType: 'org', entityId: input.applicantOrgId, action: 'grantees.update_profile', before: prev ?? null, after: { tags, relationshipOwnerId: owner, summary } });
    return { ok: true as const };
  },
});

// Duplicates --------------------------------------------------------------------------------------
export const dismissDuplicate = defineAction({
  id: 'applications.dismiss_duplicate',
  title: 'Mark as not a duplicate',
  description: 'Records that two applications flagged as possible duplicates are distinct, so the flag stops showing on the pipeline.',
  input: z.object({ applicationId: uuid, otherApplicationId: uuid, reason: z.string().trim().max(1000).optional() }),
  output: Ok,
  scopes: ['pipeline:read'],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    if (input.applicationId === input.otherApplicationId) throw new DomainError('validation_failed', 'Pick two different applications.');
    const apps = await ctx.db.selectFrom('applications').select('id').where('id', 'in', [input.applicationId, input.otherApplicationId]).where('workspace_id', '=', w.id).execute();
    if (apps.length !== 2) throw new DomainError('not_found', 'One of those applications was not found, or you do not have access to it.');
    const [a, b] = [input.applicationId, input.otherApplicationId].sort();
    await sql`
      insert into public.application_duplicate_dismissals (workspace_id, application_id, other_application_id, reason, dismissed_by)
      values (${w.id}::uuid, ${a}::uuid, ${b}::uuid, ${input.reason ?? null}, ${uid(ctx)}::uuid)
      on conflict (application_id, other_application_id) do update set reason = excluded.reason, dismissed_by = excluded.dismissed_by`.execute(ctx.db);
    ctx.audit({ entityType: 'application', entityId: input.applicationId, action: 'applications.dismiss_duplicate', after: { otherApplicationId: input.otherApplicationId, reason: input.reason ?? null } });
    return { ok: true as const };
  },
});

// Board dockets ------------------------------------------------------------------------------------
async function editableDocket(ctx: RunContext, docketId: string) {
  const d = found(await ctx.db.selectFrom('dockets').select(['id', 'status', 'workspace_id']).where('id', '=', docketId).executeTakeFirst(), 'docket');
  if (d.status === 'in_session' || d.status === 'closed') throw new DomainError('conflict', 'Voting has started on this docket, so its items can no longer change.');
  return d;
}

export const reorderDocket = defineAction({
  id: 'board.reorder_docket',
  title: 'Reorder a board docket',
  description: 'Sets the order of items on a draft or published board docket (the order the board discusses them).',
  input: z.object({ docketId: uuid, itemIds: z.array(uuid).min(1).max(500) }),
  output: Ok,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    await editableDocket(ctx, input.docketId);
    const items = await ctx.db.selectFrom('docket_items').select('id').where('docket_id', '=', input.docketId).execute();
    const known = new Set(items.map((i) => i.id));
    if (input.itemIds.length !== known.size || input.itemIds.some((id) => !known.has(id)) || new Set(input.itemIds).size !== input.itemIds.length) {
      throw new DomainError('validation_failed', 'The list of items changed. Reload the docket and try again.');
    }
    for (const [i, id] of input.itemIds.entries()) {
      await ctx.db.updateTable('docket_items').set({ position: i + 1 }).where('id', '=', id).execute();
    }
    ctx.audit({ entityType: 'docket', entityId: input.docketId, action: 'board.reorder_docket', after: { order: input.itemIds } });
    return { ok: true as const };
  },
});

export const addDocketItem = defineAction({
  id: 'board.add_docket_item',
  title: 'Add an application to a docket',
  description: 'Adds an application to a draft or published board docket with the recommended amount and a short recommendation.',
  input: z.object({ docketId: uuid, applicationId: uuid, recommendedAmountCents: z.number().int().min(0).nullable().optional(), recommendation: z.string().max(5000).nullable().optional() }),
  output: z.object({ id: z.string().uuid() }),
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const d = await editableDocket(ctx, input.docketId);
    const app = found(await ctx.db.selectFrom('applications').select(['id', 'status']).where('id', '=', input.applicationId).where('workspace_id', '=', d.workspace_id).executeTakeFirst(), 'application');
    if (['awarded', 'declined', 'withdrawn', 'in_progress'].includes(app.status)) throw new DomainError('conflict', 'Only submitted applications that are still under consideration can go on a docket.');
    const existing = await ctx.db.selectFrom('docket_items').select('id').where('docket_id', '=', d.id).where('application_id', '=', app.id).executeTakeFirst();
    if (existing) return { id: existing.id };
    const pos = await ctx.db.selectFrom('docket_items').select((eb) => eb.fn.max('position').as('m')).where('docket_id', '=', d.id).executeTakeFirst();
    const r = await ctx.db
      .insertInto('docket_items')
      .values({ workspace_id: d.workspace_id, docket_id: d.id, application_id: app.id, position: Number(pos?.m ?? 0) + 1, recommended_amount_cents: input.recommendedAmountCents ?? null, recommendation: input.recommendation ?? null })
      .returning('id')
      .executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'docket', entityId: d.id, action: 'board.add_docket_item', after: { applicationId: app.id } });
    return { id: r.id };
  },
});

export const removeDocketItem = defineAction({
  id: 'board.remove_docket_item',
  title: 'Remove an item from a docket',
  description: 'Removes an application from a draft or published board docket (before voting starts).',
  input: z.object({ docketItemId: uuid }),
  output: Ok,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const it = found(await ctx.db.selectFrom('docket_items').select(['id', 'docket_id', 'application_id']).where('id', '=', input.docketItemId).executeTakeFirst(), 'docket item');
    await editableDocket(ctx, it.docket_id);
    await ctx.db.deleteFrom('docket_items').where('id', '=', it.id).execute();
    ctx.audit({ entityType: 'docket', entityId: it.docket_id, action: 'board.remove_docket_item', before: { applicationId: it.application_id } });
    return { ok: true as const };
  },
});

// Forms ----------------------------------------------------------------------------------------------
export const updateForm = defineAction({
  id: 'forms.update',
  title: 'Rename or archive a form',
  description: 'Changes a form’s name or description, or archives it (archived forms stay attached to past stages but are hidden from pickers).',
  input: z.object({ formId: uuid, name: z.string().trim().min(1).max(200).optional(), description: z.string().max(2000).nullable().optional(), status: z.enum(['active', 'archived']).optional() }),
  output: Ok,
  scopes: [],
  roles: PROGRAM_ROLES,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const f = found(await ctx.db.selectFrom('forms').select(['id', 'name', 'status', 'description']).where('id', '=', input.formId).executeTakeFirst(), 'form');
    await ctx.db
      .updateTable('forms')
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where('id', '=', f.id)
      .execute();
    ctx.audit({ entityType: 'form', entityId: f.id, before: { name: f.name, status: f.status }, after: input });
    return { ok: true as const };
  },
});
