// SPDX-License-Identifier: AGPL-3.0-only
// Root host (no tenant): platform directory, first-run setup, operator sign-in and console.
// Neutral GMS styling — no tenant brand tokens are injected here.
import { Button, PublicShell } from '@gms/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { NextLink } from '@/components/next-link';
import { getSession } from '@/lib/auth';
import { config } from '@/lib/config';
import { poweredBy } from '@/lib/site';
import { requestMeta } from '@/lib/tenant';

export default async function RootHostLayout({ children }: { children: ReactNode }) {
  const [session, meta] = await Promise.all([getSession(), requestMeta()]);
  const multi = config.mode === 'multi';
  const inSetup = meta.pathname.startsWith('/setup');
  return (
    <PublicShell
      brand={{ name: 'GMS', href: '/' }}
      nav={multi && !inSetup ? [{ label: 'Foundations', href: '/', exact: true }, ...(session ? [{ label: 'Operator console', href: '/operator' }] : [])] : []}
      currentPath={meta.pathname}
      linkComponent={NextLink}
      headerActions={
        multi && !inSetup && !session ? (
          <Button asChild variant="secondary">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        ) : null
      }
      footer={<p className="text-sm text-muted-foreground">GMS is open-source grants management software for foundations.</p>}
      poweredBy={poweredBy()}
    >
      {children}
    </PublicShell>
  );
}
