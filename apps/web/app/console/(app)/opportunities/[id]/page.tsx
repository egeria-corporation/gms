// SPDX-License-Identifier: AGPL-3.0-or-later
// C-04 Opportunity editor: Details (CommonGrants fields), Eligibility questions, Stages & forms, Distribution;
// Duplicate; link to Review & publish (C-05). `?tab=` details | eligibility | stages | distribution.
// ?state= archived (read-only notice) | saving-error (a failed save message on Details) | not-found
import { Alert, Button, NotFoundState, PageHeader, StatusChip } from '@gms/ui';
import { ExternalLink, Rocket } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DuplicateDialog } from '@/components/console/grantmaking/opportunities/duplicate-dialog';
import { OpportunityEditor, type EditorTab } from '@/components/console/grantmaking/opportunities/opportunity-editor';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { isUuid, oneParam, type SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { detailsOf, distributionOf, loadEligibility, loadOpportunity, loadPrograms, loadPublishableForms, loadStages, loadTerms } from '../data';

export const metadata: Metadata = { title: 'Edit opportunity' };

const EDIT_ROLES = ['owner', 'admin', 'program_officer'];
const TABS: EditorTab[] = ['details', 'eligibility', 'stages', 'distribution'];

export default async function OpportunityEditorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff()]);
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const forced = forcedState(sp);
  const tz = tenant.timezone;
  const data =
    forced === 'not-found' || !isUuid(id)
      ? null
      : await rls(async (trx) => {
          const o = await loadOpportunity(trx, tenant.id, id);
          if (!o) return null;
          const [stages, rules, forms, programs, terms] = await Promise.all([loadStages(trx, tenant.id, id, tz), loadEligibility(trx, tenant.id, id), loadPublishableForms(trx, tenant.id), loadPrograms(trx, tenant.id), loadTerms(trx, tenant.id)]);
          return { o, stages, rules, forms, programs, terms };
        });

  const crumbs = [
    { label: 'Console', href: '/console' },
    { label: 'Opportunities', href: '/console/opportunities' },
  ];

  if (!data) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Opportunity not found" breadcrumbs={crumbs} linkComponent={NextLink} />
        <NotFoundState
          title="We couldn’t find that opportunity"
          description="It may have been removed, or the link is wrong."
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/console/opportunities">Back to opportunities</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const { o } = data;
  const canEdit = Boolean(viewer.role && EDIT_ROLES.includes(viewer.role));
  const archived = forced === 'archived' || o.status === 'archived';
  const readOnly = archived || !canEdit;
  const tabParam = oneParam(sp, 'tab') as EditorTab | undefined;
  const programs = o.program_id && !data.programs.some((p) => p.id === o.program_id) ? [...data.programs, { id: o.program_id, name: o.program_name ?? 'Current program' }] : data.programs;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={o.title}
        breadcrumbs={[...crumbs, { label: o.title }]}
        linkComponent={NextLink}
        meta={
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusChip kind="opportunity" value={archived ? 'archived' : o.status} size="sm" />
            <span>/{o.slug}</span>
            {o.program_name ? <span>· {o.program_name}</span> : null}
            <span>· Timezone {tz}</span>
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {o.status !== 'draft' && o.visibility === 'public' ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/opportunities/${o.slug}`}>
                  <ExternalLink aria-hidden="true" /> Public page
                </Link>
              </Button>
            ) : null}
            {canEdit ? <DuplicateDialog opportunityId={o.id} title={o.title} /> : null}
            <Button asChild size="sm">
              <Link href={`/console/opportunities/${o.id}/publish`}>
                <Rocket aria-hidden="true" /> {o.status === 'draft' ? 'Review & publish' : 'Lifecycle & invitations'}
              </Link>
            </Button>
          </div>
        }
      />
      {archived ? (
        <Alert variant="info" title="This opportunity is archived">
          Archived opportunities are read-only and hidden from applicants. Duplicate it to reuse its setup for a new cycle.
        </Alert>
      ) : !canEdit ? (
        <Alert variant="info" title="View only">
          Your role can view opportunities but not change them.
        </Alert>
      ) : o.status === 'open' ? (
        <Alert variant="warning" title="This opportunity is open">
          Applicants see changes right away. Changing dates or eligibility now can affect people who have already started.
        </Alert>
      ) : null}
      {forced === 'saving-error' ? <Alert variant="info">Demo state: the Details tab shows how a failed save looks.</Alert> : null}
      <OpportunityEditor
        key={o.last_modified_at}
        opportunityId={o.id}
        initialTab={forced === 'saving-error' ? 'details' : tabParam && TABS.includes(tabParam) ? tabParam : 'details'}
        details={detailsOf(o, tz)}
        programs={programs}
        terms={data.terms}
        rules={data.rules}
        stages={data.stages}
        forms={data.forms}
        distribution={distributionOf(o.distribution)}
        timeZone={tz}
        readOnly={readOnly}
        forcedSaveError={forced === 'saving-error'}
      />
    </div>
  );
}
