// SPDX-License-Identifier: AGPL-3.0-only
// Accept a collaborator invitation (the signed-in email must match the invitation).
import { Alert, Button, PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { act } from '@/lib/server/act';
import { one } from '@/lib/site';

export const metadata: Metadata = { title: 'Join an application' };

export default async function JoinPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const token = one((await searchParams).token);
  if (!token) redirect('/portal');
  const r = await act<{ applicationId: string }>('applications.accept_collaboration', { token });
  if (r.ok) redirect(`/portal/applications/${r.data.applicationId}/form`);
  return (
    <div className="mx-auto grid w-full max-w-xl gap-6 py-10">
      <PageHeader density="spacious" title="We couldn’t add you to this application" />
      <Alert variant="warning" title="This invitation didn’t work">
        {r.problem.detail} Make sure you’re signed in with the email address the invitation was sent to.
      </Alert>
      <Button asChild className="justify-self-start">
        <Link href="/portal">Go to my dashboard</Link>
      </Button>
    </div>
  );
}
