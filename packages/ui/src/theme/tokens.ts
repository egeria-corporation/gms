// SPDX-License-Identifier: AGPL-3.0-or-later
// Machine-readable description of the design tokens, used by the /dev/design-system page.
import { SCALE_STEPS } from './color';

export interface DesignToken {
  /** CSS custom property, e.g. "--primary". */
  name: string;
  /** Tailwind utility stem when one exists, e.g. "bg-primary". */
  utility?: string;
  purpose: string;
}

export interface DesignTokenGroup {
  id: string;
  label: string;
  description: string;
  /** Whether a workspace's brand settings may change these values. */
  tenantOverridable: boolean | 'console-subset';
  tokens: DesignToken[];
}

export const STATUS_TONES = ['success', 'warning', 'danger', 'info', 'progress', 'neutral', 'muted', 'agent'] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

const TONE_PURPOSE: Record<StatusTone, string> = {
  success: 'Completed, approved, paid, passing checks',
  warning: 'Needs attention soon: due, pending approval, needs review',
  danger: 'Blocked, failed, overdue, held',
  info: 'Informational states: submitted, in review, sent to bank',
  progress: 'Work underway: in progress, onboarding, submitting',
  neutral: 'Final but unremarkable: closed, declined, completed',
  muted: 'Not started, draft, archived, cancelled',
  agent: 'Proposed or performed by an AI agent',
};

const t = (name: string, purpose: string, utility?: string): DesignToken => (utility ? { name, purpose, utility } : { name, purpose });

export const DESIGN_TOKENS: { groups: DesignTokenGroup[]; radius: DesignToken[]; motion: DesignToken[] } = {
  groups: [
    {
      id: 'surface',
      label: 'Surfaces and text',
      description: 'Warm-tinted neutrals. The console has light and dark themes; branded surfaces are light-first.',
      tenantOverridable: false,
      tokens: [
        t('--background', 'Page background', 'bg-background'),
        t('--foreground', 'Body text', 'text-foreground'),
        t('--card', 'Raised surfaces: cards, panels, table bodies', 'bg-card'),
        t('--card-foreground', 'Text on cards', 'text-card-foreground'),
        t('--popover', 'Menus, popovers, tooltips', 'bg-popover'),
        t('--popover-foreground', 'Text in menus and popovers', 'text-popover-foreground'),
        t('--muted', 'Quiet fills: table headers, disabled fields', 'bg-muted'),
        t('--muted-foreground', 'Secondary text (still AA on background and muted)', 'text-muted-foreground'),
        t('--secondary', 'Secondary buttons', 'bg-secondary'),
        t('--secondary-foreground', 'Text on secondary buttons', 'text-secondary-foreground'),
        t('--border', 'Low-contrast 1px dividers and card edges', 'border-border'),
        t('--input', 'Form control borders (3:1 against background)', 'border-input'),
        t('--destructive', 'Destructive buttons and destructive text', 'bg-destructive'),
      ],
    },
    {
      id: 'brand',
      label: 'Brand',
      description:
        'Set per workspace by the branding engine, contrast-checked automatically. Applied fully on applicant, public, reviewer and board surfaces.',
      tenantOverridable: true,
      tokens: [
        t('--primary', 'Primary buttons, links, selected states (white text is always 4.5:1)', 'bg-primary'),
        t('--primary-foreground', 'Text on primary', 'text-primary-foreground'),
        t('--link', 'Inline links', 'text-link'),
        t('--accent', 'Subtle brand-tinted hover and selected fill', 'bg-accent'),
        t('--accent-foreground', 'Text on the subtle fill', 'text-accent-foreground'),
        t('--brand-accent', 'The workspace accent color as a fill', 'bg-brand-accent'),
        t('--brand-accent-foreground', 'Text on the accent fill', 'text-brand-accent-foreground'),
        t('--font-heading', 'Heading font (one of the curated fonts)', 'font-heading'),
        ...SCALE_STEPS.map((s) => t(`--brand-${s}`, `Primary color scale, step ${s}`, `bg-brand-${s}`)),
        ...SCALE_STEPS.map((s) => t(`--accent-${s}`, `Accent color scale, step ${s}`, `bg-accent-${s}`)),
      ],
    },
    {
      id: 'console-brand',
      label: 'Console brand subset',
      description: 'The staff console only takes the logo, accent colors, focus ring and favicon from the brand.',
      tenantOverridable: 'console-subset',
      tokens: [
        t('--ring', 'Focus ring (3:1 against every background)', 'outline-ring'),
        t('--console-accent', 'Active navigation indicator', 'bg-console-accent'),
        t('--sidebar-ring', 'Focus ring inside the sidebar', 'outline-sidebar-ring'),
      ],
    },
    {
      id: 'status',
      label: 'Status',
      description:
        'Fixed for every workspace so a status color always means the same thing. Always paired with an icon and text.',
      tenantOverridable: false,
      tokens: STATUS_TONES.flatMap((tone) => [
        t(`--status-${tone}-fg`, `${TONE_PURPOSE[tone]}: text and icon`, `text-status-${tone}-fg`),
        t(`--status-${tone}-bg`, `${TONE_PURPOSE[tone]}: chip fill`, `bg-status-${tone}-bg`),
        t(`--status-${tone}-border`, `${TONE_PURPOSE[tone]}: chip border`, `border-status-${tone}-border`),
      ]),
    },
    {
      id: 'chart',
      label: 'Charts',
      description: 'Series colors. Each is at least 3:1 against the background; charts always ship a data table too.',
      tenantOverridable: true,
      tokens: [1, 2, 3, 4, 5].map((n) => t(`--chart-${n}`, `Series ${n}`, `fill-chart-${n}`)),
    },
    {
      id: 'sidebar',
      label: 'Console sidebar',
      description: 'Sidebar surfaces for the staff console.',
      tenantOverridable: false,
      tokens: [
        t('--sidebar', 'Sidebar background', 'bg-sidebar'),
        t('--sidebar-foreground', 'Sidebar text', 'text-sidebar-foreground'),
        t('--sidebar-primary', 'Sidebar emphasis', 'bg-sidebar-primary'),
        t('--sidebar-primary-foreground', 'Text on sidebar emphasis', 'text-sidebar-primary-foreground'),
        t('--sidebar-accent', 'Sidebar hover and active item fill', 'bg-sidebar-accent'),
        t('--sidebar-accent-foreground', 'Text on sidebar hover fill', 'text-sidebar-accent-foreground'),
        t('--sidebar-border', 'Sidebar divider', 'border-sidebar-border'),
      ],
    },
  ],
  radius: [
    t('--radius-md', '8px: controls, chips, inputs, buttons', 'rounded-md'),
    t('--radius-lg', '12px: cards, dialogs, sheets', 'rounded-lg'),
  ],
  motion: [
    t('--duration-fast', '150ms ease-out: hovers, focus, small reveals'),
    t('--duration-base', '200ms ease-out: dialogs, sheets, popovers. Disabled under prefers-reduced-motion'),
  ],
};
