// SPDX-License-Identifier: AGPL-3.0-only
// Public (anonymous, RLS-enforced) queries for the funding site, feeds and agent discovery files.
import 'server-only';
import { sql } from '@gms/db';
import { anon } from './server/db';
import type { Tenant } from './tenant';

export interface PublicOpportunity {
  id: string;
  slug: string;
  title: string;
  status: 'forecasted' | 'open' | 'closed';
  summary: string | null;
  descriptionMd: string | null;
  eligibilityMd: string | null;
  guidelinesMd: string | null;
  faq: { q: string; a: string }[];
  fundingTotalCents: number | null;
  awardMinCents: number | null;
  awardMaxCents: number | null;
  expectedAwardCount: number | null;
  currency: string;
  applicantTypes: string[];
  causeTerms: string[];
  geographyTerms: string[];
  populationTerms: string[];
  forecastAt: string | null;
  opensAt: string | null;
  closesAt: string | null;
  decisionExpectedOn: string | null;
  contactEmail: string | null;
  visibility: string;
  distribution: { site?: boolean; embed?: boolean; cgFeed?: boolean; openGrants?: boolean };
  programName: string | null;
  publishedAt: string | null;
  lastModifiedAt: string;
}

export interface OpportunityFilters {
  q?: string;
  status?: string[];
  cause?: string[];
  geography?: string[];
  page?: number;
  pageSize?: number;
}

function mapOpp(r: Record<string, unknown>): PublicOpportunity {
  return {
    id: String(r.id),
    slug: String(r.slug),
    title: String(r.title),
    status: r.status as PublicOpportunity['status'],
    summary: (r.summary as string | null) ?? null,
    descriptionMd: (r.description_md as string | null) ?? null,
    eligibilityMd: (r.eligibility_md as string | null) ?? null,
    guidelinesMd: (r.guidelines_md as string | null) ?? null,
    faq: (r.faq as { q: string; a: string }[] | null) ?? [],
    fundingTotalCents: (r.funding_total_cents as number | null) ?? null,
    awardMinCents: (r.award_min_cents as number | null) ?? null,
    awardMaxCents: (r.award_max_cents as number | null) ?? null,
    expectedAwardCount: (r.expected_award_count as number | null) ?? null,
    currency: String(r.currency ?? 'USD'),
    applicantTypes: (r.applicant_types as string[]) ?? [],
    causeTerms: (r.cause_terms as string[]) ?? [],
    geographyTerms: (r.geography_terms as string[]) ?? [],
    populationTerms: (r.population_terms as string[]) ?? [],
    forecastAt: (r.forecast_at as string | null) ?? null,
    opensAt: (r.opens_at as string | null) ?? null,
    closesAt: (r.closes_at as string | null) ?? null,
    decisionExpectedOn: (r.decision_expected_on as string | null) ?? null,
    contactEmail: (r.contact_email as string | null) ?? null,
    visibility: String(r.visibility ?? 'public'),
    distribution: (r.distribution as PublicOpportunity['distribution']) ?? {},
    programName: (r.program_name as string | null) ?? null,
    publishedAt: (r.published_at as string | null) ?? null,
    lastModifiedAt: String(r.last_modified_at),
  };
}

export async function listOpportunities(tenant: Tenant, f: OpportunityFilters = {}) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 12, 1), 50);
  const page = Math.max(f.page ?? 1, 1);
  return anon(async (trx) => {
    let q = trx
      .selectFrom('opportunities as o')
      .leftJoin('public_programs as p', 'p.id', 'o.program_id')
      .where('o.workspace_id', '=', tenant.id)
      .where('o.status', 'in', ['forecasted', 'open', 'closed'])
      .where('o.visibility', '=', 'public')
      .where(sql<boolean>`coalesce((o.distribution->>'site')::boolean, true)`);
    if (f.status?.length) q = q.where('o.status', 'in', f.status);
    if (f.cause?.length) q = q.where(sql<boolean>`o.cause_terms && ${sql.val(f.cause)}::text[]`);
    if (f.geography?.length) q = q.where(sql<boolean>`o.geography_terms && ${sql.val(f.geography)}::text[]`);
    if (f.q?.trim()) q = q.where(sql<boolean>`o.search @@ websearch_to_tsquery('english', ${f.q.trim()})`);
    const total = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await q
      .selectAll('o')
      .select('p.name as program_name')
      .orderBy(sql`case o.status when 'open' then 0 when 'forecasted' then 1 else 2 end`)
      .orderBy('o.closes_at', 'asc')
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .execute();
    const facets = await trx
      .selectFrom('opportunities')
      .select([sql<string[]>`array(select distinct unnest(cause_terms) order by 1)`.as('cause'), sql<string[]>`array(select distinct unnest(geography_terms) order by 1)`.as('geo')])
      .where('workspace_id', '=', tenant.id)
      .where('status', 'in', ['forecasted', 'open', 'closed'])
      .execute();
    const cause = [...new Set(facets.flatMap((x) => x.cause))].sort();
    const geography = [...new Set(facets.flatMap((x) => x.geo))].sort();
    return { items: rows.map((r) => mapOpp(r as unknown as Record<string, unknown>)), total: Number(total?.n ?? 0), page, pageSize, facets: { cause, geography } };
  });
}

export async function getOpportunity(tenant: Tenant, slugOrId: string): Promise<PublicOpportunity | null> {
  return anon(async (trx) => {
    const isId = /^[0-9a-f-]{36}$/i.test(slugOrId);
    const r = await trx
      .selectFrom('opportunities as o')
      .leftJoin('public_programs as p', 'p.id', 'o.program_id')
      .selectAll('o')
      .select('p.name as program_name')
      .where('o.workspace_id', '=', tenant.id)
      .where(isId ? 'o.id' : 'o.slug', '=', slugOrId)
      .executeTakeFirst();
    return r ? mapOpp(r as unknown as Record<string, unknown>) : null;
  });
}

export async function competitionsFor(opportunityId: string) {
  return anon((trx) =>
    trx
      .selectFrom('competitions')
      .select(['id', 'name', 'description', 'stage_order', 'access', 'status', 'opens_at', 'closes_at', 'grace_minutes'])
      .where('opportunity_id', '=', opportunityId)
      .orderBy('stage_order')
      .execute(),
  );
}

export async function eligibilityRules(opportunityId: string) {
  return anon((trx) =>
    trx.selectFrom('eligibility_rules').select(['id', 'position', 'question', 'help_text', 'kind', 'config', 'knockout_message']).where('opportunity_id', '=', opportunityId).orderBy('position').execute(),
  );
}

export async function publicAwards(tenant: Tenant, opts: { page?: number; q?: string } = {}) {
  const pageSize = 25;
  const page = Math.max(opts.page ?? 1, 1);
  return anon(async (trx) => {
    let q = trx.selectFrom('public_awards').where('workspace_id', '=', tenant.id);
    if (opts.q?.trim()) q = q.where((eb) => eb.or([eb('recipient_name', 'ilike', `%${opts.q}%`), eb('title', 'ilike', `%${opts.q}%`)]));
    const total = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const items = await q.selectAll().orderBy('created_at', 'desc').limit(pageSize).offset((page - 1) * pageSize).execute();
    const sum = await trx.selectFrom('public_awards').select(sql<number>`coalesce(sum(amount_cents),0)::bigint`.as('s')).where('workspace_id', '=', tenant.id).executeTakeFirst();
    return { items, total: Number(total?.n ?? 0), page, pageSize, totalCents: Number(sum?.s ?? 0) };
  });
}

export async function publicStats(tenant: Tenant) {
  return anon(async (trx) => {
    const open = await trx
      .selectFrom('opportunities')
      .select([(eb) => eb.fn.countAll<number>().as('n'), sql<number>`coalesce(sum(funding_total_cents),0)::bigint`.as('funding')])
      .where('workspace_id', '=', tenant.id)
      .where('status', '=', 'open')
      .executeTakeFirst();
    const awarded = await trx.selectFrom('public_awards').select([(eb) => eb.fn.countAll<number>().as('n'), sql<number>`coalesce(sum(amount_cents),0)::bigint`.as('s')]).where('workspace_id', '=', tenant.id).executeTakeFirst();
    return { openCount: Number(open?.n ?? 0), openFundingCents: Number(open?.funding ?? 0), awardCount: Number(awarded?.n ?? 0), awardedCents: Number(awarded?.s ?? 0) };
  });
}

export async function agentPolicy(tenantId: string) {
  return anon((trx) =>
    trx.selectFrom('agent_policies').select(['ai_use', 'disclosure_prompt', 'agent_submissions_enabled', 'mcp_enabled', 'a2a_enabled']).where('workspace_id', '=', tenantId).executeTakeFirst(),
  );
}
