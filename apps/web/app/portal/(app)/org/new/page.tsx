// SPDX-License-Identifier: AGPL-3.0-only
// B-02 Org setup.
import { PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import { one } from '@/lib/site';
import { OrgSetup } from './org-setup';

export const metadata: Metadata = { title: 'Set up your organization' };

export default async function NewOrgPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const next = one((await searchParams).next);
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-8 pb-16">
      <PageHeader
        density="spacious"
        title="Set up your organization"
        description="We use this to fill in your applications, so you only type it once. Only you and the foundations you apply to can see it."
      />
      <OrgSetup next={next && next.startsWith('/') && !next.startsWith('//') ? next : '/portal'} />
    </div>
  );
}
