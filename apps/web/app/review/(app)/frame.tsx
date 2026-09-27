// SPDX-License-Identifier: AGPL-3.0-only
// The ReviewerShell with this tenant's brand, account menu and footer, shared by the reviewer pages.
import { ReviewerShell } from '@gms/ui';
import type { ReactNode } from 'react';
import { AccountMenu } from '@/components/account-menu';
import { NextLink } from '@/components/next-link';
import type { Viewer } from '@/lib/auth';
import { poweredBy } from '@/lib/site';
import type { Tenant } from '@/lib/tenant';

export function ReviewerFrame({
  tenant,
  viewer,
  context,
  progress,
  exit,
  aside,
  asideLabel,
  children,
}: {
  tenant: Tenant;
  viewer: Viewer;
  context?: ReactNode;
  progress?: ReactNode;
  exit?: { href: string; label: string };
  aside?: ReactNode;
  asideLabel?: string;
  children: ReactNode;
}) {
  const isStaff = Boolean(viewer.role && viewer.role !== 'reviewer' && viewer.role !== 'board');
  return (
    <ReviewerShell
      brand={{ name: tenant.brand.displayName, logoUrl: tenant.brand.logoPath ? '/brand/logo' : null, href: '/review' }}
      linkComponent={NextLink}
      context={context}
      progress={progress}
      exit={exit}
      aside={aside}
      asideLabel={asideLabel}
      accountMenu={
        <AccountMenu
          name={viewer.name}
          email={viewer.email}
          links={[
            { href: '/review', label: 'My review assignments' },
            { href: '/portal/account', label: 'Account & notifications' },
            ...(isStaff ? [{ href: '/console', label: 'Staff console' }] : []),
          ]}
        />
      }
      poweredBy={poweredBy()}
    >
      {children}
    </ReviewerShell>
  );
}
