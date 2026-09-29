// SPDX-License-Identifier: AGPL-3.0-or-later
// The shared auth callback and guards send people to /portal/sign-in; on the root host that means the
// operator sign-in page.
import { redirect } from 'next/navigation';
import { one } from '@/lib/site';

export default async function RootPortalSignInRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  const next = one(sp.next);
  const error = one(sp.error);
  if (next) params.set('next', next);
  if (error) params.set('error', error);
  const qs = params.toString();
  redirect(`/sign-in${qs ? `?${qs}` : ''}`);
}
