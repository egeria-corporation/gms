// SPDX-License-Identifier: AGPL-3.0-only
import { Button, DeniedState } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'No access' };

export default function DeniedPage() {
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-xl content-center p-6">
      <DeniedState
        title="You don’t have access to this part of the console"
        description="Your role doesn’t include this page. If you need it, ask a workspace admin to change your role."
        action={
          <Button asChild>
            <Link href="/console">Go to console home</Link>
          </Button>
        }
        secondaryAction={
          <Button asChild variant="ghost">
            <Link href="/portal">Applicant portal</Link>
          </Button>
        }
      />
    </main>
  );
}
