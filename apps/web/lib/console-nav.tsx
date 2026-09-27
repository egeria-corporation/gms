// SPDX-License-Identifier: AGPL-3.0-only
// Console navigation, grouped by module and filtered by role. Every console route lives here.
import type { WorkspaceRole } from '@gms/domain';
import type { NavGroup } from '@gms/ui';
import {
  Award,
  BarChart3,
  Bot,
  Building2,
  ClipboardCheck,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  Gavel,
  Home,
  Inbox,
  Landmark,
  LayoutList,
  Mail,
  Megaphone,
  PiggyBank,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';

type Item = { label: string; href: string; icon: React.ReactNode; roles?: readonly WorkspaceRole[]; exact?: boolean };
type Group = { label?: string; items: Item[] };

const PROGRAM: readonly WorkspaceRole[] = ['owner', 'admin', 'program_officer', 'auditor'];
const FINANCE: readonly WorkspaceRole[] = ['owner', 'admin', 'finance', 'auditor'];
const ADMIN: readonly WorkspaceRole[] = ['owner', 'admin', 'auditor'];

const i = (Icon: React.ComponentType<{ 'aria-hidden'?: boolean }>) => <Icon aria-hidden />;

export const CONSOLE_NAV: Group[] = [
  {
    items: [
      { label: 'Home', href: '/console', icon: i(Home), exact: true },
      { label: 'Approvals', href: '/console/approvals', icon: i(Inbox) },
    ],
  },
  {
    label: 'Grantmaking',
    items: [
      { label: 'Programs', href: '/console/programs', icon: i(PiggyBank), roles: [...PROGRAM, 'finance'] },
      { label: 'Opportunities', href: '/console/opportunities', icon: i(Megaphone), roles: PROGRAM },
      { label: 'Forms', href: '/console/forms', icon: i(FileText), roles: PROGRAM },
      { label: 'Pipeline', href: '/console/pipeline', icon: i(FolderKanban), roles: [...PROGRAM, 'finance'] },
      { label: 'Review', href: '/console/review', icon: i(ClipboardCheck), roles: PROGRAM },
      { label: 'Decisions', href: '/console/decisions', icon: i(Gavel), roles: PROGRAM },
      { label: 'Board dockets', href: '/console/dockets', icon: i(LayoutList), roles: PROGRAM },
    ],
  },
  {
    label: 'Grants',
    items: [
      { label: 'Awards', href: '/console/awards', icon: i(Award), roles: [...PROGRAM, 'finance'] },
      { label: 'Payments', href: '/console/payments', icon: i(Landmark), roles: FINANCE },
      { label: 'Reports', href: '/console/reports', icon: i(FileCheck2), roles: PROGRAM },
      { label: 'Diligence', href: '/console/diligence', icon: i(ShieldCheck), roles: [...PROGRAM, 'finance'] },
      { label: 'Grantees', href: '/console/grantees', icon: i(Building2), roles: [...PROGRAM, 'finance'] },
    ],
  },
  {
    label: 'Communications',
    items: [{ label: 'Messages & email', href: '/console/comms', icon: i(Mail), roles: PROGRAM }],
  },
  {
    label: 'Insights',
    items: [
      { label: 'Dashboards', href: '/console/analytics', icon: i(BarChart3), roles: [...PROGRAM, 'finance'] },
      { label: 'Exports', href: '/console/exports', icon: i(FileSpreadsheet), roles: [...PROGRAM, 'finance'] },
    ],
  },
  {
    label: 'Settings',
    items: [
      { label: 'Team', href: '/console/settings/team', icon: i(Users), roles: ADMIN },
      { label: 'AI agents', href: '/console/settings/agents', icon: i(Bot), roles: ADMIN },
      { label: 'Audit log', href: '/console/settings/audit', icon: i(ScrollText), roles: ADMIN },
      { label: 'Workspace', href: '/console/settings', icon: i(Settings), roles: ADMIN, exact: true },
    ],
  },
];

export function consoleNav(role: WorkspaceRole | null, approvalCount: number): NavGroup[] {
  return CONSOLE_NAV.map((g) => ({
    ...(g.label ? { label: g.label } : {}),
    items: g.items
      .filter((it) => !it.roles || (role && it.roles.includes(role)))
      .map((it) => ({
        label: it.label,
        href: it.href,
        icon: it.icon,
        ...(it.exact ? { exact: true } : {}),
        ...(it.href === '/console/approvals' && approvalCount ? { badge: approvalCount } : {}),
      })),
  })).filter((g) => g.items.length);
}
