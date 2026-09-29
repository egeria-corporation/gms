// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from '@gms/db';
import { ConsoleShell } from '@gms/ui';
import type { ReactNode } from 'react';
import { AccountMenu } from '@/components/account-menu';
import { ConsoleCommandPalette, NotificationsButton } from '@/components/console/console-chrome';
import { ThemeToggle } from '@/components/console/theme';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { CONSOLE_NAV, consoleNav } from '@/lib/console-nav';
import { rls } from '@/lib/server/db';
import { poweredBy } from '@/lib/site';
import { requestMeta, requireTenant } from '@/lib/tenant';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const [tenant, viewer, meta] = await Promise.all([requireTenant(), requireStaff(), requestMeta()]);
  const counts = await rls(async (trx) => {
    const approvals = await trx
      .selectFrom('approval_requests')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('workspace_id', '=', tenant.id)
      .where('status', '=', 'awaiting_confirmation')
      .where((eb) => eb.or([eb('on_behalf_of', '=', viewer.userId), eb('audience', '=', 'staff')]))
      .executeTakeFirst();
    const batches = viewer.role && ['owner', 'admin', 'finance'].includes(viewer.role)
      ? await trx.selectFrom('payment_batches').select(sql<number>`count(*)::int`.as('n')).where('workspace_id', '=', tenant.id).where('status', '=', 'awaiting_approval').where('created_by', '!=', viewer.userId).executeTakeFirst()
      : { n: 0 };
    const unread = await trx.selectFrom('notifications').select(sql<number>`count(*)::int`.as('n')).where('user_id', '=', viewer.userId).where('read_at', 'is', null).executeTakeFirst();
    return { approvals: Number(approvals?.n ?? 0) + Number(batches?.n ?? 0), unread: Number(unread?.n ?? 0) };
  });
  const nav = consoleNav(viewer.role, counts.approvals);
  const paletteGroups = CONSOLE_NAV.map((g) => ({
    heading: g.label ?? 'Go to',
    items: g.items.filter((it) => !it.roles || (viewer.role && it.roles.includes(viewer.role))).map((it) => ({ id: it.href, label: it.label, href: it.href, icon: it.icon })),
  })).filter((g) => g.items.length);
  return (
    <ConsoleShell
      workspace={{ name: tenant.brand.displayName, logoUrl: tenant.brand.logoPath ? '/brand/logo' : null, href: '/console' }}
      nav={nav}
      currentPath={meta.pathname}
      linkComponent={NextLink}
      approvalInbox={{ href: '/console/approvals', count: counts.approvals }}
      notifications={<NotificationsButton unread={counts.unread} />}
      themeToggle={<ThemeToggle />}
      commandPalette={<ConsoleCommandPalette navGroups={paletteGroups} />}
      userMenu={
        <AccountMenu
          name={viewer.name}
          email={viewer.email}
          links={[
            { href: '/portal/account', label: 'Your account' },
            { href: '/', label: 'Public site' },
          ]}
        />
      }
      poweredBy={poweredBy()}
    >
      {children}
    </ConsoleShell>
  );
}
