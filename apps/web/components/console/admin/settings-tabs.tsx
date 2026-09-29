// SPDX-License-Identifier: AGPL-3.0-or-later
// Secondary navigation shared by every /console/settings page (the console nav links to the main ones).
import Link from 'next/link';

export const SETTINGS_TABS = [
  { href: '/console/settings', label: 'Workspace' },
  { href: '/console/settings/branding', label: 'Branding' },
  { href: '/console/settings/team', label: 'Team' },
  { href: '/console/settings/integrations', label: 'Integrations' },
  { href: '/console/settings/agents', label: 'AI agents' },
  { href: '/console/settings/developers', label: 'Developers' },
  { href: '/console/settings/fields', label: 'Fields & taxonomies' },
  { href: '/console/settings/audit', label: 'Audit log' },
  { href: '/console/settings/export', label: 'Export' },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]['href'];

/** Horizontal, scrollable tab links. `current` is the active tab's href. */
export function SettingsTabs({ current }: { current: SettingsTab }) {
  return (
    <nav aria-label="Settings sections" className="-mt-2 mb-2 overflow-x-auto border-b">
      <ul className="flex min-w-max gap-4 text-sm">
        {SETTINGS_TABS.map((t) => {
          const active = t.href === current;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={`-mb-px inline-flex min-h-9 items-center border-b-2 px-0.5 pb-2 font-medium outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring ${active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
