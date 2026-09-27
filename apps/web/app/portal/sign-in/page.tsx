// SPDX-License-Identifier: AGPL-3.0-only
// B-01 Sign in (states: check email; expired link).
import { Card, CardContent, CardDescription, CardHeader } from '@gms/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { forcedState, one } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tenant = await requireTenant();
  const sp = await searchParams;
  const next = one(sp.next) ?? '/portal';
  if (await getSession()) redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/portal');
  const state = forcedState(sp);
  return (
    <div className="mx-auto grid w-full max-w-md gap-6 py-10">
      <Card>
        <CardHeader>
          <h1 className="font-heading text-2xl font-semibold leading-tight">Sign in to {tenant.brand.displayName}</h1>
          <CardDescription>Apply for funding, check on your applications, and send reports. New here? Signing in creates your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <SignInForm next={next} expired={one(sp.error) === 'expired' || state === 'expired'} />
        </CardContent>
      </Card>
    </div>
  );
}
