// SPDX-License-Identifier: AGPL-3.0-or-later
// B-06 Review before submit (+ attestation and AI-disclosure per workspace policy).
import { compileForm, FormModelSchema } from '@gms/forms';
import { formatInZone } from '@gms/domain';
import { PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { NextLink } from '@/components/next-link';
import { requireViewer } from '@/lib/auth';
import { act } from '@/lib/server/act';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { SubmitPanel } from './submit-panel';

export const metadata: Metadata = { title: 'Review and submit' };

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireViewer()]);
  const { id } = await params;
  const forced = forcedState(await searchParams);
  const d = await rls(async (trx) => {
    const app = await trx
      .selectFrom('applications as a')
      .innerJoin('opportunities as o', 'o.id', 'a.opportunity_id')
      .select(['a.id', 'a.status', 'a.reference_number', 'o.title as opp_title', 'a.competition_id'])
      .where('a.id', '=', id)
      .where('a.workspace_id', '=', tenant.id)
      .executeTakeFirst();
    if (!app) return null;
    const form = await trx
      .selectFrom('form_responses as r')
      .innerJoin('form_versions as v', 'v.id', 'r.form_version_id')
      .select(['r.form_id', 'r.data', 'v.builder_model'])
      .where('r.application_id', '=', id)
      .orderBy('r.created_at')
      .executeTakeFirst();
    const policy = await trx.selectFrom('agent_policies').select(['ai_use', 'disclosure_prompt']).where('workspace_id', '=', tenant.id).executeTakeFirst();
    return { app, form, policy };
  });
  if (!d?.form) notFound();
  if (d.app.status !== 'in_progress') redirect(`/portal/applications/${id}`);
  const v = await act<{ ready: boolean; errors: { formId: string; pointer: string; message: string; fieldId?: string; pageId?: string }[]; deadline: { open: boolean; inGrace: boolean; closesAt: string | null } }>('applications.validate', { applicationId: id });
  const validation = v.ok ? v.data : { ready: false, errors: [], deadline: { open: true, inGrace: false, closesAt: null } };
  const compiled = compileForm(FormModelSchema.parse(d.form.builder_model));
  const deadlinePassed = forced === 'deadline-passed' || !validation.deadline.open;
  const inGrace = forced === 'grace' || validation.deadline.inGrace;
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-8 pb-16">
      <PageHeader
        density="spacious"
        linkComponent={NextLink}
        breadcrumbs={[
          { label: 'My applications', href: '/portal' },
          { label: d.app.reference_number, href: `/portal/applications/${id}` },
          { label: 'Review and submit' },
        ]}
        title="Review and submit"
        description={`Check your answers for ${d.app.opp_title}. You can go back and edit anything before you submit.`}
      />
      <SubmitPanel
        applicationId={id}
        model={d.form.builder_model}
        data={(d.form.data ?? {}) as Record<string, unknown>}
        serverErrors={validation.errors}
        canSubmit={!deadlinePassed && validation.errors.length === 0}
        deadlineMessage={
          deadlinePassed
            ? `The deadline was ${validation.deadline.closesAt ? formatInZone(validation.deadline.closesAt, tenant.timezone) : 'earlier'}. Message the foundation if you need an extension.`
            : inGrace
              ? `The deadline has passed, but you’re inside the grace period (until ${validation.deadline.closesAt ? formatInZone(validation.deadline.closesAt, tenant.timezone) : 'soon'}). Submit now.`
              : null
        }
        inGrace={inGrace && !deadlinePassed}
        aiPolicy={(d.policy?.ai_use ?? 'disclosure') as 'allowed' | 'disclosure' | 'prohibited'}
        disclosurePrompt={d.policy?.disclosure_prompt ?? 'Did you use AI tools to help write this application? If so, tell us how.'}
        formHasDisclosure={Object.prototype.hasOwnProperty.call(compiled.fieldMeta, 'ai_disclosure')}
        signerName={viewer.name}
      />
    </div>
  );
}
