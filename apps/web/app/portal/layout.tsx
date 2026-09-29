// SPDX-License-Identifier: AGPL-3.0-or-later
import { NextLink } from '@/components/next-link';
import { Button, PortalShell } from '@gms/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AccountMenu } from '@/components/account-menu';
import { getViewer } from '@/lib/auth';
import { BrandStyle } from '@/lib/brand-style';
import { poweredBy } from '@/lib/site';
import { requestMeta, requireTenant } from '@/lib/tenant';

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const tenant = await requireTenant();
  const [viewer, meta] = await Promise.all([getViewer(), requestMeta()]);
  const isStaff = Boolean(viewer?.role && viewer.role !== 'reviewer' && viewer.role !== 'board');
  return (
    <>
      <BrandStyle tenant={tenant} scope="branded" />
      <PortalShell
        brand={{ name: tenant.brand.displayName, logoUrl: tenant.brand.logoPath ? '/brand/logo' : null, href: '/' }}
        nav={
          viewer
            ? [
                { label: 'My applications', href: '/portal', exact: true },
                { label: 'Grants & reports', href: '/portal/grants' },
                { label: 'Organization', href: '/portal/org' },
                { label: 'Find funding', href: '/opportunities' },
              ]
            : [{ label: 'Find funding', href: '/opportunities' }]
        }
        currentPath={meta.pathname}
        linkComponent={NextLink}
        accountMenu={
          viewer ? (
            <AccountMenu
              name={viewer.name}
              email={viewer.email}
              links={[
                { href: '/portal/account', label: 'Account & notifications' },
                { href: '/portal/account/agents', label: 'Connected agents' },
                ...(isStaff ? [{ href: '/console', label: 'Staff console' }] : []),
                ...(viewer.role === 'reviewer' ? [{ href: '/review', label: 'Reviewer workspace' }] : []),
                ...(viewer.role === 'board' ? [{ href: '/board', label: 'Board docket' }] : []),
              ]}
            />
          ) : (
            <Button asChild variant="secondary">
              <Link href="/portal/sign-in">Sign in</Link>
            </Button>
          )
        }
        help={tenant.publicContactEmail ? <>Questions? Email <a className="text-link underline" href={`mailto:${tenant.publicContactEmail}`}>{tenant.publicContactEmail}</a>.</> : null}
        poweredBy={poweredBy()}
        width="wide"
      >
        {children}
      </PortalShell>
    </>
  );
}
