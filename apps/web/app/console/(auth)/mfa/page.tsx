// SPDX-License-Identifier: AGPL-3.0-or-later
// TOTP MFA: staff enroll once, then verify each session (aal2) before the console opens.
import { Card, CardContent, CardHeader } from '@gms/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import { one } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { MfaForm } from './mfa-form';

export const metadata: Metadata = { title: 'Two-step sign-in' };

export default async function MfaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tenant = await requireTenant();
  const viewer = await getViewer();
  const nextRaw = one((await searchParams).next) ?? '/console';
  const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/console';
  if (!viewer) redirect(`/portal/sign-in?next=${encodeURIComponent(`/console/mfa?next=${next}`)}`);
  if (viewer.session.aal === 'aal2') redirect(next);
  return (
    <main id="main" className="mx-auto grid min-h-dvh w-full max-w-lg content-center gap-6 p-6">
      <Card>
        <CardHeader>
          <p className="text-sm text-muted-foreground">{tenant.brand.displayName}</p>
          <h1 className="font-heading text-2xl font-semibold">{viewer.hasVerifiedFactor ? 'Confirm it’s you' : 'Protect your staff account'}</h1>
        </CardHeader>
        <CardContent>
          <MfaForm mode={viewer.hasVerifiedFactor ? 'verify' : 'enroll'} next={next} />
        </CardContent>
      </Card>
    </main>
  );
}
