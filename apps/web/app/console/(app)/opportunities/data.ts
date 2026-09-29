// SPDX-License-Identifier: AGPL-3.0-or-later
// Reads for the opportunity editor (C-04) and publish screen (C-05), under RLS and scoped to the workspace.
import 'server-only';
import type { Tx } from '@gms/db';
import { toLocalInputValue } from '@gms/domain';
import type { Distribution, EligibilityRuleView, OpportunityDetails, PublishableForm, RuleKind, StageView, TaxonomyTerm } from '@/components/console/grantmaking/opportunities/types';

export async function loadOpportunity(trx: Tx, workspaceId: string, id: string) {
  return trx
    .selectFrom('opportunities as o')
    .leftJoin('programs as p', 'p.id', 'o.program_id')
    .selectAll('o')
    .select(['p.name as program_name'])
    .where('o.workspace_id', '=', workspaceId)
    .where('o.id', '=', id)
    .executeTakeFirst();
}

export type OpportunityRecord = NonNullable<Awaited<ReturnType<typeof loadOpportunity>>>;

export async function loadStages(trx: Tx, workspaceId: string, opportunityId: string, tz: string): Promise<StageView[]> {
  const [comps, cfs] = await Promise.all([
    trx.selectFrom('competitions').selectAll().where('workspace_id', '=', workspaceId).where('opportunity_id', '=', opportunityId).orderBy('stage_order').execute(),
    trx
      .selectFrom('competition_forms as cf')
      .innerJoin('competitions as c', 'c.id', 'cf.competition_id')
      .innerJoin('forms as f', 'f.id', 'cf.form_id')
      .leftJoin('form_versions as v', 'v.id', 'cf.form_version_id')
      .leftJoin('form_versions as cur', 'cur.id', 'f.current_version_id')
      .select(['cf.competition_id', 'cf.form_id', 'cf.form_version_id', 'cf.position', 'f.name', 'v.version', 'v.status as version_status', 'cur.version as current_version'])
      .where('cf.workspace_id', '=', workspaceId)
      .where('c.opportunity_id', '=', opportunityId)
      .orderBy('cf.position')
      .execute(),
  ]);
  return comps.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description ?? '',
    order: c.stage_order,
    access: c.access === 'invite' ? 'invite' : 'public',
    status: c.status,
    opensAt: toLocalInputValue(c.opens_at, tz),
    closesAt: toLocalInputValue(c.closes_at, tz),
    opensAtIso: c.opens_at,
    closesAtIso: c.closes_at,
    graceMinutes: c.grace_minutes,
    submissionCap: c.submission_cap,
    perOrgLimit: c.per_org_limit,
    allowExtensions: c.allow_extensions,
    forms: cfs
      .filter((f) => f.competition_id === c.id)
      .map((f) => ({ formId: f.form_id, formName: f.name, versionId: f.form_version_id, version: f.version ?? null, versionStatus: f.version_status ?? null, currentVersion: f.current_version ?? null })),
  }));
}

export async function loadEligibility(trx: Tx, workspaceId: string, opportunityId: string): Promise<EligibilityRuleView[]> {
  const rows = await trx
    .selectFrom('eligibility_rules')
    .select(['question', 'help_text', 'kind', 'config', 'knockout_message'])
    .where('workspace_id', '=', workspaceId)
    .where('opportunity_id', '=', opportunityId)
    .orderBy('position')
    .execute();
  return rows.map((r) => ({
    question: r.question,
    helpText: r.help_text ?? '',
    kind: r.kind as RuleKind,
    config: r.config && typeof r.config === 'object' && !Array.isArray(r.config) ? (r.config as Record<string, unknown>) : {},
    knockoutMessage: r.knockout_message,
  }));
}

/** Active forms that have a published version (the only ones a stage can pin). */
export async function loadPublishableForms(trx: Tx, workspaceId: string): Promise<PublishableForm[]> {
  const rows = await trx
    .selectFrom('forms as f')
    .innerJoin('form_versions as v', 'v.id', 'f.current_version_id')
    .select(['f.id', 'f.name', 'f.kind', 'v.version'])
    .where('f.workspace_id', '=', workspaceId)
    .where('f.status', '=', 'active')
    .where('v.status', '=', 'published')
    .orderBy('f.name')
    .execute();
  return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, version: r.version }));
}

const dollars = (c: number | null): string => (c === null ? '' : (c / 100).toLocaleString('en-US', { maximumFractionDigits: 2, useGrouping: true }));

export function detailsOf(o: OpportunityRecord | null, tz: string): OpportunityDetails {
  const faq = Array.isArray(o?.faq) ? (o.faq as { q?: unknown; a?: unknown }[]).map((f) => ({ q: String(f.q ?? ''), a: String(f.a ?? '') })) : [];
  return {
    title: o?.title ?? '',
    summary: o?.summary ?? '',
    descriptionMd: o?.description_md ?? '',
    eligibilityMd: o?.eligibility_md ?? '',
    guidelinesMd: o?.guidelines_md ?? '',
    faq,
    fundingTotal: dollars(o?.funding_total_cents ?? null),
    awardMin: dollars(o?.award_min_cents ?? null),
    awardMax: dollars(o?.award_max_cents ?? null),
    expectedAwardCount: o?.expected_award_count === null || o?.expected_award_count === undefined ? '' : String(o.expected_award_count),
    applicantTypes: o?.applicant_types ?? [],
    causeTerms: o?.cause_terms ?? [],
    geographyTerms: o?.geography_terms ?? [],
    populationTerms: o?.population_terms ?? [],
    programId: o?.program_id ?? null,
    contactEmail: o?.contact_email ?? '',
    visibility: o?.visibility === 'unlisted' ? 'unlisted' : 'public',
    decisionExpectedOn: o?.decision_expected_on ? String(o.decision_expected_on).slice(0, 10) : '',
    forecastAt: toLocalInputValue(o?.forecast_at, tz),
    opensAt: toLocalInputValue(o?.opens_at, tz),
    closesAt: toLocalInputValue(o?.closes_at, tz),
  };
}

export async function loadTerms(trx: Tx, workspaceId: string): Promise<TaxonomyTerm[]> {
  const rows = await trx.selectFrom('taxonomy_terms').select(['kind', 'code', 'label']).where('workspace_id', '=', workspaceId).where('kind', 'in', ['cause', 'geography', 'population']).orderBy('label').execute();
  return rows.map((r) => ({ kind: r.kind as TaxonomyTerm['kind'], code: r.code, label: r.label }));
}

export async function loadPrograms(trx: Tx, workspaceId: string) {
  return trx.selectFrom('programs').select(['id', 'name']).where('workspace_id', '=', workspaceId).where('status', '=', 'active').orderBy('name').execute();
}

export function distributionOf(v: unknown): Distribution {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  return { site: o.site !== false, embed: o.embed !== false, cgFeed: o.cgFeed !== false, openGrants: o.openGrants === true };
}
