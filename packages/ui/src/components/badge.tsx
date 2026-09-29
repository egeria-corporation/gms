// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Tone } from '@gms/domain';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import * as React from 'react';
import { cn } from '../lib/utils';

export const toneClasses: Record<Tone, string> = {
  success: 'border-status-success-border bg-status-success-bg text-status-success-fg',
  warning: 'border-status-warning-border bg-status-warning-bg text-status-warning-fg',
  danger: 'border-status-danger-border bg-status-danger-bg text-status-danger-fg',
  info: 'border-status-info-border bg-status-info-bg text-status-info-fg',
  progress: 'border-status-progress-border bg-status-progress-bg text-status-progress-fg',
  neutral: 'border-status-neutral-border bg-status-neutral-bg text-status-neutral-fg',
  muted: 'border-status-muted-border bg-status-muted-bg text-status-muted-fg',
  agent: 'border-status-agent-border bg-status-agent-bg text-status-agent-fg',
};

export const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-medium [&>svg]:size-3.5 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-border bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        success: toneClasses.success,
        warning: toneClasses.warning,
        danger: toneClasses.danger,
        info: toneClasses.info,
        progress: toneClasses.progress,
        neutral: toneClasses.neutral,
        muted: toneClasses.muted,
        agent: toneClasses.agent,
      },
    },
    defaultVariants: { variant: 'secondary' },
  },
);

export interface BadgeProps extends React.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {
  asChild?: boolean;
}

/** Small label. For statuses use StatusChip (icon + text + color), never a colored Badge alone. */
export function Badge({ className, variant, asChild = false, ...props }: BadgeProps) {
  const Comp = asChild ? Slot.Root : 'span';
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
