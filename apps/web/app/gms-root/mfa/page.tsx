// SPDX-License-Identifier: AGPL-3.0-only
// TOTP MFA on the root host: platform operators verify (aal2) before the operator console opens.
import { Card, CardContent, CardHeader } from '@gms/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import { one } from '@/lib/site';
import { MfaForm } from '../../console/(auth)/mfa/mfa-form';

export const metadata: Metadata = { title: 'Two-step sign-in' };

export default async function RootMfaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await getViewer();
  const nextRaw = one((await searchParams).next) ?? '/operator';
  const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/operator';
  if (!viewer) redirect(`/sign-in?next=${encodeURIComponent(`/mfa?next=${next}`)}`);
  if (viewer.session.aal === 'aal2') redirect(next);
  return (
    <main id="main" className="mx-auto grid min-h-dvh w-full max-w-lg content-center gap-6 p-6">
      <Card>
        <CardHeader>
          <p className="text-sm text-muted-foreground">GMS platform</p>
          <h1 className="font-heading text-2xl font-semibold">{viewer.hasVerifiedFactor ? 'Confirm it’s you' : 'Protect your operator account'}</h1>
        </CardHeader>
        <CardContent>
          <MfaForm mode={viewer.hasVerifiedFactor ? 'verify' : 'enroll'} next={next} />
        </CardContent>
      </Card>
    </main>
  );
}
