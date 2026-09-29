// SPDX-License-Identifier: AGPL-3.0-or-later
// Applicant-side reads (RLS as the signed-in person).
import 'server-only';
import { sql } from '@gms/db';
import { rls } from './server/db';

export async function myApplications(workspaceId: string) {
  return rls((trx) =>
    trx
      .selectFrom('applications as a')
      .innerJoin('opportunities as o', 'o.id', 'a.opportunity_id')
      .innerJoin('competitions as c', 'c.id', 'a.competition_id')
      .leftJoin('applicant_orgs as g', 'g.id', 'a.applicant_org_id')
      .select([
        'a.id',
        'a.reference_number',
        'a.title',
        'a.status',
        'a.submitted_at',
        'a.last_modified_at',
        'a.info_requested_at',
        'a.created_via',
        'o.title as opportunity_title',
        'o.slug as opportunity_slug',
        'c.name as stage_name',
        'c.closes_at',
        'c.grace_minutes',
        'g.legal_name as org_name',
        'a.applicant_org_id',
      ])
      .where('a.workspace_id', '=', workspaceId)
      .orderBy('a.last_modified_at', 'desc')
      .execute(),
  );
}

export async function myPendingApprovals(userId: string, workspaceId: string) {
  return rls((trx) =>
    trx
      .selectFrom('approval_requests')
      .select(['id', 'action_id', 'preview', 'requester_name', 'expires_at', 'created_at', 'status'])
      .where('on_behalf_of', '=', userId)
      .where('workspace_id', '=', workspaceId)
      .where('status', '=', 'awaiting_confirmation')
      .where('expires_at', '>', new Date().toISOString())
      .orderBy('created_at', 'desc')
      .execute(),
  );
}

export async function myGrants(workspaceId: string) {
  return rls((trx) =>
    trx
      .selectFrom('awards as a')
      .leftJoin('applicant_orgs as g', 'g.id', 'a.applicant_org_id')
      .select(['a.id', 'a.reference', 'a.title', 'a.status', 'a.amount_cents', 'a.disbursed_cents', 'a.currency', 'a.start_date', 'a.end_date', 'a.agreement_pending', 'a.on_hold', 'a.report_overdue', 'g.legal_name'])
      .where('a.workspace_id', '=', workspaceId)
      .where('a.kind', '=', 'original')
      .where('a.status', '!=', 'draft')
      .orderBy('a.created_at', 'desc')
      .execute(),
  );
}

export async function myReports(workspaceId: string) {
  return rls((trx) =>
    trx
      .selectFrom('report_requirements as r')
      .innerJoin('awards as a', 'a.id', 'r.award_id')
      .select(['r.id', 'r.title', 'r.kind', 'r.due_date', 'r.status', 'a.id as award_id', 'a.reference', 'a.title as award_title'])
      .where('r.workspace_id', '=', workspaceId)
      .where('r.status', 'not in', ['accepted'])
      .orderBy('r.due_date')
      .execute(),
  );
}

export async function orgDetail(orgId: string) {
  return rls(async (trx) => {
    const org = await trx.selectFrom('applicant_orgs').selectAll().where('id', '=', orgId).executeTakeFirst();
    if (!org) return null;
    const [address, docs, members] = await Promise.all([
      trx.selectFrom('org_addresses').selectAll().where('org_id', '=', orgId).where('kind', '=', 'mailing').executeTakeFirst(),
      trx.selectFrom('org_documents').selectAll().where('org_id', '=', orgId).orderBy('created_at', 'desc').execute(),
      trx
        .selectFrom('applicant_org_members as m')
        .innerJoin('profiles as p', 'p.id', 'm.user_id')
        .select(['m.id', 'm.role', 'm.title', 'p.full_name', 'p.email', 'p.id as user_id'])
        .where('m.org_id', '=', orgId)
        .execute(),
    ]);
    return { org, address, docs, members };
  });
}

export async function unreadCount(userId: string) {
  return rls(async (trx) => {
    const r = await trx.selectFrom('notifications').select(sql<number>`count(*)::int`.as('n')).where('user_id', '=', userId).where('read_at', 'is', null).executeTakeFirst();
    return Number(r?.n ?? 0);
  });
}
