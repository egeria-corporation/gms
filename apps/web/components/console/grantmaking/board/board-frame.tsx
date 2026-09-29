// SPDX-License-Identifier: AGPL-3.0-or-later
// E-02: BoardShell with the tenant brand, account menu and AGPL footer, shared by the board pages.
// A Server Component (no 'use client'): pages pass their own section nav and context.
import { BoardShell } from '@gms/ui';
import type { ReactNode } from 'react';
import { AccountMenu } from '@/components/account-menu';
import { NextLink } from '@/components/next-link';
import type { Viewer } from '@/lib/auth';
import { poweredBy } from '@/lib/site';
import type { Tenant } from '@/lib/tenant';

export function BoardFrame({
  tenant,
  viewer,
  context,
  progress,
  exit,
  sectionNav,
  children,
}: {
  tenant: Tenant;
  viewer: Viewer;
  context?: ReactNode;
  progress?: ReactNode;
  exit?: { href: string; label: string };
  sectionNav?: ReactNode;
  children: ReactNode;
}) {
  return (
    <BoardShell
      brand={{ name: tenant.brand.displayName, logoUrl: tenant.brand.logoPath ? '/brand/logo' : null, href: '/board' }}
      linkComponent={NextLink}
      context={context ?? 'Board portal'}
      progress={progress}
      exit={exit}
      sectionNav={sectionNav}
      accountMenu={
        <AccountMenu
          name={viewer.name}
          email={viewer.email}
          links={[
            { href: '/board', label: 'Board dockets' },
            { href: '/portal/account', label: 'Account & notifications' },
          ]}
        />
      }
      poweredBy={poweredBy()}
    >
      {children}
    </BoardShell>
  );
}
