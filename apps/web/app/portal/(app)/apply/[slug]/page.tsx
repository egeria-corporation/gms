// SPDX-License-Identifier: AGPL-3.0-or-later
// Start (or resume) an application to an opportunity's open stage.
import { formatInZone } from '@gms/domain';
import { Alert, Button, DeadlineChip, PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireViewer } from '@/lib/auth';
import { competitionsFor, getOpportunity } from '@/lib/public-data';
import { rls } from '@/lib/server/db';
import { requireTenant } from '@/lib/tenant';
import { StartForm } from './start-form';

export const metadata: Metadata = { title: 'Start an application' };

export default async function ApplyPage({ params }: { params: Promise<{ slug: string }> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireViewer()]);
  const { slug } = await params;
  const o = await getOpportunity(tenant, slug);
  if (!o) notFound();
  if (!viewer.orgs.length) redirect(`/portal/org/new?next=${encodeURIComponent(`/portal/apply/${slug}`)}`);
  const stages = await competitionsFor(o.id);
  const invites = await rls((trx) => trx.selectFrom('competition_invites').select(['competition_id']).where('status', 'in', ['pending', 'accepted']).execute());
  const invited = new Set(invites.map((i) => i.competition_id));
  const stage = [...stages].reverse().find((s) => s.status === 'open' && (s.access === 'public' || invited.has(s.id)));
  const existing = await rls((trx) =>
    trx
      .selectFrom('applications')
      .select(['id', 'status', 'competition_id'])
      .where('opportunity_id', '=', o.id)
      .where('status', '=', 'in_progress')
      .executeTakeFirst(),
  );
  if (existing) redirect(`/portal/applications/${existing.id}/form`);
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-8 pb-16">
      <PageHeader density="spacious" title={o.title} description="Start your application. It saves as you go, and you can invite teammates to help." meta={stage?.closes_at ? <DeadlineChip at={stage.closes_at} timeZone={tenant.timezone} label="Due" /> : undefined} />
      {o.status !== 'open' || !stage ? (
        <Alert variant="info" title={o.status === 'forecasted' ? 'Applications aren’t open yet' : 'This opportunity isn’t accepting applications'}>
          {o.status === 'forecasted' && o.opensAt ? `Applications open ${formatInZone(o.opensAt, tenant.timezone)}.` : 'Check back for future rounds, or look at other opportunities.'}
          <div className="mt-3">
            <Button asChild variant="secondary">
              <Link href={`/opportunities/${o.slug}`}>Back to the opportunity</Link>
            </Button>
          </div>
        </Alert>
      ) : (
        <>
          <ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
            <li>We’ll fill in what we already know from your organization profile.</li>
            <li>Deadline: {stage.closes_at ? formatInZone(stage.closes_at, tenant.timezone) : 'rolling'}{stage.grace_minutes ? ` (with a ${stage.grace_minutes}-minute grace period)` : ''}.</li>
            <li>Nothing is sent to the foundation until you review and submit.</li>
          </ul>
          <StartForm competitionId={stage.id} orgs={viewer.orgs.map((x) => ({ id: x.orgId, name: x.legalName, verified: x.einVerified }))} />
        </>
      )}
    </div>
  );
}
