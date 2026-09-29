// SPDX-License-Identifier: AGPL-3.0-or-later
// B-05 Application workspace (states: offline retry; mobile).
import { deadlineState } from '@gms/domain';
import { PageHeader, type FileScanStatus } from '@gms/ui';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { NextLink } from '@/components/next-link';
import { rls } from '@/lib/server/db';
import { forcedState, one } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { ApplicationWorkspace } from './workspace';

export const metadata: Metadata = { title: 'Your application' };

export default async function FormPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tenant = await requireTenant();
  const { id } = await params;
  const sp = await searchParams;
  const d = await rls(async (trx) => {
    const app = await trx
      .selectFrom('applications as a')
      .innerJoin('opportunities as o', 'o.id', 'a.opportunity_id')
      .innerJoin('competitions as c', 'c.id', 'a.competition_id')
      .select(['a.id', 'a.status', 'a.title', 'a.reference_number', 'a.info_request_note', 'a.info_requested_at', 'a.deadline_override_at', 'o.title as opp_title', 'c.name as stage', 'c.opens_at', 'c.closes_at', 'c.grace_minutes', 'c.id as competition_id'])
      .where('a.id', '=', id)
      .where('a.workspace_id', '=', tenant.id)
      .executeTakeFirst();
    if (!app) return null;
    const responses = await trx
      .selectFrom('form_responses as r')
      .innerJoin('form_versions as v', 'v.id', 'r.form_version_id')
      .innerJoin('competition_forms as cf', (j) => j.onRef('cf.form_id', '=', 'r.form_id').on('cf.competition_id', '=', app.competition_id))
      .select(['r.form_id', 'r.data', 'r.etag', 'v.builder_model', 'cf.position'])
      .where('r.application_id', '=', id)
      .orderBy('cf.position')
      .execute();
    const collaborators = await trx.selectFrom('application_collaborators').select('id').where('application_id', '=', id).where('status', '!=', 'removed').execute();
    const files = await trx.selectFrom('attachments').select(['id', 'scan_status']).where('application_id', '=', id).execute();
    return { app, responses, collaborators: collaborators.length, files };
  });
  if (!d) notFound();
  if (d.app.status !== 'in_progress') redirect(`/portal/applications/${id}`);
  const form = d.responses.find((r) => r.form_id === one(sp.form)) ?? d.responses[0];
  if (!form) notFound();
  const forced = forcedState(sp);
  const dl = deadlineState(new Date(), { opensAt: d.app.opens_at, closesAt: d.app.closes_at, graceMinutes: d.app.grace_minutes, extensionAt: d.app.deadline_override_at });
  const fileStatus = Object.fromEntries(d.files.map((f) => [f.id, (f.scan_status === 'infected' ? 'infected' : f.scan_status === 'pending' ? 'scanning' : 'clean') as FileScanStatus]));
  return (
    <div className="grid gap-6 pb-16">
      <PageHeader
        density="spacious"
        linkComponent={NextLink}
        breadcrumbs={[
          { label: 'My applications', href: '/portal' },
          { label: d.app.reference_number, href: `/portal/applications/${id}` },
          { label: 'Answers' },
        ]}
        title={d.app.opp_title}
        description={`${d.app.stage} · ${d.app.reference_number} · Your answers save automatically.`}
      />
      <ApplicationWorkspace
        applicationId={id}
        formId={form.form_id}
        model={form.builder_model}
        initialData={(form.data ?? {}) as Record<string, unknown>}
        etag={form.etag}
        initialPageId={one(sp.page) ?? null}
        closesAt={dl.effectiveCloseAt?.toISOString() ?? d.app.closes_at}
        timeZone={tenant.timezone}
        inGrace={forced === 'grace' || dl.inGrace}
        deadlinePassed={forced === 'deadline-passed' || !dl.open}
        infoRequestNote={d.app.info_requested_at ? d.app.info_request_note : null}
        collaboratorCount={d.collaborators}
        fileStatus={fileStatus}
      />
    </div>
  );
}
