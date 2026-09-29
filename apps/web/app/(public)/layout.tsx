// SPDX-License-Identifier: AGPL-3.0-or-later
import { NextLink } from '@/components/next-link';
import { Button, PublicShell } from '@gms/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getSession } from '@/lib/auth';
import { BrandStyle } from '@/lib/brand-style';
import { poweredBy } from '@/lib/site';
import { requestMeta, requireTenant } from '@/lib/tenant';

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const tenant = await requireTenant();
  const [session, meta] = await Promise.all([getSession(), requestMeta()]);
  return (
    <>
      <BrandStyle tenant={tenant} scope="branded" />
      <PublicShell
        brand={{ name: tenant.brand.displayName, logoUrl: tenant.brand.logoPath ? '/brand/logo' : null }}
        nav={[
          { label: 'Home', href: '/', exact: true },
          { label: 'Opportunities', href: '/opportunities' },
          { label: 'Grants awarded', href: '/awards' },
          { label: 'For AI agents', href: '/for-agents' },
        ]}
        currentPath={meta.pathname}
        linkComponent={NextLink}
        headerActions={
          <Button asChild variant={session ? 'secondary' : 'default'}>
            <Link href={session ? '/portal' : '/portal/sign-in'}>{session ? 'My applications' : 'Sign in'}</Link>
          </Button>
        }
        footer={
          <div className="text-sm text-muted-foreground">
            {tenant.publicContactEmail ? (
              <p>
                Questions? Email <a className="text-link underline" href={`mailto:${tenant.publicContactEmail}`}>{tenant.publicContactEmail}</a>.
              </p>
            ) : null}
          </div>
        }
        poweredBy={poweredBy()}
      >
        {children}
      </PublicShell>
    </>
  );
}
