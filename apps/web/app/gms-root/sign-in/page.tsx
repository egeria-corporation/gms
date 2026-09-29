// SPDX-License-Identifier: AGPL-3.0-or-later
// Root sign-in — platform operators (states: check-email, expired).
import { Card, CardContent, CardDescription, CardHeader } from '@gms/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { forcedState, one } from '@/lib/site';
import { RootSignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

function safeNext(next: string | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/operator';
}

export default async function RootSignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(one(sp.next));
  const state = forcedState(sp);
  if (!state && (await getSession())) redirect(next);
  return (
    <div className="mx-auto grid w-full max-w-md gap-6 py-10">
      <Card>
        <CardHeader>
          <h1 className="font-heading text-2xl font-semibold leading-tight">Sign in to GMS</h1>
          <CardDescription>
            For platform operators. Applying for a grant or working at a foundation? Sign in on that foundation’s own site instead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RootSignInForm next={next} expired={one(sp.error) === 'expired' || state === 'expired'} forcedSentTo={state === 'check-email' ? 'amara.okafor@gms-ops.example' : undefined} />
        </CardContent>
      </Card>
    </div>
  );
}
