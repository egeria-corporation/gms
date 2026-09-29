// SPDX-License-Identifier: AGPL-3.0-or-later
// R-01 rubric builder — edit an existing rubric. Locked (read-only, "Duplicate rubric") once any reviewer
// has scored with it.
// ?state= weights-invalid (lowers the first weight by 10 points) | locked (shows the locked notice)
import { sql } from '@gms/db';
import { Badge, NotFoundState, PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import { NextLink } from '@/components/next-link';
import { RubricBuilder, type RubricBuilderValue } from '@/components/console/grantmaking/review/rubric-builder';
import { requireStaff } from '@/lib/auth';
import { isUuid, type SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Rubric' };

const EDIT_ROLES: readonly string[] = ['owner', 'admin', 'program_officer'];

export default async function RubricPage({ params, searchParams }: { params: Promise<{ rubricId: string }>; searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'program_officer', 'auditor'])]);
  const { rubricId } = await params;
  const forced = forcedState(await searchParams);
  const canEdit = Boolean(viewer.role && EDIT_ROLES.includes(viewer.role));

  const data = isUuid(rubricId)
    ? await rls(async (trx) => {
        const rubric = await trx.selectFrom('rubrics').select(['id', 'name', 'description']).where('id', '=', rubricId).where('workspace_id', '=', tenant.id).executeTakeFirst();
        if (!rubric) return null;
        const [criteria, scored] = await Promise.all([
          trx
            .selectFrom('rubric_criteria')
            .select(['label', 'guidance', 'weight_pct', 'scale_min', 'scale_max', 'scale_labels'])
            .where('rubric_id', '=', rubric.id)
            .where('workspace_id', '=', tenant.id)
            .orderBy('position')
            .execute(),
          sql<{ n: number }>`select count(*)::int as n from public.review_scores s join public.rubric_criteria c on c.id = s.criterion_id where c.rubric_id = ${rubric.id}::uuid`.execute(trx),
        ]);
        return { rubric, criteria, scored: Number(scored.rows[0]?.n ?? 0) > 0 };
      })
    : null;

  if (!data) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Rubric not found" breadcrumbs={[{ label: 'Review', href: '/console/review' }, { label: 'Rubric' }]} linkComponent={NextLink} />
        <NotFoundState title="We couldn’t find that rubric" description="It may have been removed. Go back to Review to see every rubric." />
      </div>
    );
  }

  const criteria = data.criteria.map((c) => ({
    label: c.label,
    guidance: c.guidance,
    weightPct: Number(c.weight_pct),
    scaleMin: c.scale_min,
    scaleMax: c.scale_max,
    scaleLabels: Object.fromEntries(Object.entries((c.scale_labels ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)])),
  }));
  if (forced === 'weights-invalid' && criteria[0]) criteria[0].weightPct = Math.max(1, criteria[0].weightPct - 10);
  const locked = data.scored || forced === 'locked';
  const initial: RubricBuilderValue = { rubricId: data.rubric.id, name: data.rubric.name, description: data.rubric.description ?? '', criteria };

  return (
    <div className="grid max-w-4xl gap-6">
      <PageHeader
        title={data.rubric.name}
        description="Criteria, weights and scales reviewers score with."
        breadcrumbs={[{ label: 'Review', href: '/console/review' }, { label: data.rubric.name }]}
        linkComponent={NextLink}
        meta={locked ? <Badge variant="neutral">Locked — scored</Badge> : null}
      />
      <RubricBuilder key={`${data.rubric.id}-${forced ?? ''}`} initial={initial} locked={locked} canEdit={canEdit} />
    </div>
  );
}
