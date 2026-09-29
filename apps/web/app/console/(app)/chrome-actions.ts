// SPDX-License-Identifier: AGPL-3.0-or-later
'use server';
import { sql } from '@gms/db';
import { act } from '@/lib/server/act';
import { rls } from '@/lib/server/db';
import { requireTenant } from '@/lib/tenant';

export interface SearchHit {
  id: string;
  label: string;
  hint: string;
  href: string;
  kind: 'application' | 'organization' | 'opportunity' | 'award';
}

/** Global console search (Postgres full-text + trigram), always under RLS. */
export async function consoleSearch(q: string): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const tenant = await requireTenant();
  return rls(async (trx) => {
    const like = `%${term.replace(/[%_]/g, '')}%`;
    const [apps, orgs, opps, awards] = await Promise.all([
      trx
        .selectFrom('applications as a')
        .leftJoin('applicant_orgs as g', 'g.id', 'a.applicant_org_id')
        .select(['a.id', 'a.reference_number', 'a.title', 'g.legal_name'])
        .where('a.workspace_id', '=', tenant.id)
        .where((eb) => eb.or([eb(sql`a.search`, '@@', sql`websearch_to_tsquery('english', ${term})`), eb('a.reference_number', 'ilike', like), eb('g.legal_name', 'ilike', like)]))
        .limit(8)
        .execute(),
      trx.selectFrom('applicant_orgs').select(['id', 'legal_name', 'ein']).where((eb) => eb.or([eb('legal_name', 'ilike', like), eb('ein', '=', term)])).limit(5).execute(),
      trx.selectFrom('opportunities').select(['id', 'title', 'status']).where('workspace_id', '=', tenant.id).where('title', 'ilike', like).limit(5).execute(),
      trx.selectFrom('awards').select(['id', 'reference', 'title']).where('workspace_id', '=', tenant.id).where((eb) => eb.or([eb('reference', 'ilike', like), eb('title', 'ilike', like)])).limit(5).execute(),
    ]);
    return [
      ...apps.map((a) => ({ id: a.id, kind: 'application' as const, label: a.title ?? a.reference_number, hint: `${a.reference_number}${a.legal_name ? ` · ${a.legal_name}` : ''}`, href: `/console/applications/${a.id}` })),
      ...orgs.map((o) => ({ id: o.id, kind: 'organization' as const, label: o.legal_name, hint: o.ein ? `EIN ${o.ein}` : 'Organization', href: `/console/grantees/${o.id}` })),
      ...opps.map((o) => ({ id: o.id, kind: 'opportunity' as const, label: o.title, hint: `Opportunity · ${o.status}`, href: `/console/opportunities/${o.id}` })),
      ...awards.map((a) => ({ id: a.id, kind: 'award' as const, label: a.title, hint: a.reference, href: `/console/awards/${a.id}` })),
    ];
  });
}

export async function recentNotifications() {
  return rls((trx) =>
    trx.selectFrom('notifications').select(['id', 'title', 'body', 'link', 'read_at', 'created_at', 'kind']).orderBy('created_at', 'desc').limit(20).execute(),
  );
}

export async function markAllRead() {
  return act('notifications.mark_read', {});
}
