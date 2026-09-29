// SPDX-License-Identifier: AGPL-3.0-or-later
// Where requireMember() sends people without a reviewer role. Deliberately unguarded (no requireMember).
import { Button, DeniedState } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'No access' };

export default async function ReviewDeniedPage() {
  const tenant = await requireTenant();
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-xl content-center p-6">
      <h1 className="sr-only">No access to the reviewer workspace</h1>
      <DeniedState
        title="This is the reviewer workspace"
        description={`Only people invited to review for ${tenant.brand.displayName} can open it. If you should be reviewing, ask the program officer to invite you as a reviewer.`}
        action={
          <Button asChild>
            <Link href="/portal">Go to the applicant portal</Link>
          </Button>
        }
      />
    </main>
  );
}
