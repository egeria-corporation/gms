// SPDX-License-Identifier: AGPL-3.0-or-later
// Dev-only stand-in for Mercury's hosted recipient onboarding page (the fake invite's onboarding URL).
import { getRuntime } from '@gms/actions';
import { fakeMercuryControls } from '@gms/adapters';
import { formatInZone } from '@gms/domain';
import { Alert, Card, CardContent, CardHeader, CardTitle, DescriptionList, PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTenant } from '@/lib/tenant';
import { DevControl } from '../../controls';

export const metadata: Metadata = { title: 'Dev · simulated bank onboarding' };
export const dynamic = 'force-dynamic';

export default async function FakeInvitePage({ params }: { params: Promise<{ inviteId: string }> }) {
  const { inviteId } = await params;
  const tenant = await getTenant();
  if (!tenant || !/^fm_[a-z0-9]+_inv_[a-z0-9]+$/i.test(inviteId)) notFound();
  const state = await fakeMercuryControls(tenant.id, getRuntime().db).listState();
  const invite = state.invites.find((i) => i.inviteId === inviteId);
  if (!invite) notFound();
  return (
    <>
      <PageHeader title="Set up how you get paid" description={`Simulated Mercury onboarding for grants from ${tenant.brand.displayName}.`} />
      <Alert variant="warning" title="This is a simulation">
        In Mercury, the grantee would enter bank details and a W-9 on Mercury’s own site. GMS never sees those numbers.
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Invite
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <DescriptionList
            items={[
              { term: 'Contact', detail: invite.contactEmail },
              { term: 'Status', detail: invite.status },
              { term: 'Expires', detail: invite.expiresAt ? formatInZone(invite.expiresAt, tenant.timezone) : null },
            ]}
          />
          {invite.status === 'created' ? (
            <div className="flex flex-wrap gap-2">
              <DevControl control={{ kind: 'completeInvite', id: invite.inviteId }} variant="default">
                Finish onboarding
              </DevControl>
              <DevControl control={{ kind: 'expireInvite', id: invite.inviteId }}>Let it expire</DevControl>
            </div>
          ) : (
            <Alert variant={invite.status === 'completed' ? 'success' : 'info'} title={invite.status === 'completed' ? 'Onboarding complete' : 'This invite has expired'}>
              {invite.status === 'completed' ? 'The foundation can now pay you.' : 'Ask the foundation to send a new invite.'}
            </Alert>
          )}
        </CardContent>
      </Card>
    </>
  );
}
