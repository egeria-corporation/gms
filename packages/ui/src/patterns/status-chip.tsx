// SPDX-License-Identifier: AGPL-3.0-or-later
import { statusMeta, type StatusKind, type StatusMeta, type Tone } from '@gms/domain';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';
import { toneClasses } from '../components/badge';
import { cn } from '../lib/utils';
import { statusIcon } from './status-icons';

export interface ToneChipProps extends Omit<React.ComponentProps<'span'>, 'children'> {
  tone: Tone;
  icon: LucideIcon;
  label: React.ReactNode;
  size?: 'sm' | 'default';
}

/** Icon + text + color. The building block for every status-like chip. */
export function ToneChip({ tone, icon: Icon, label, size = 'default', className, ...props }: ToneChipProps) {
  return (
    <span
      data-slot="status-chip"
      data-tone={tone}
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-md border font-medium',
        size === 'sm' ? 'px-1.5 py-px text-[11px] [&>svg]:size-3' : 'px-2 py-0.5 text-xs [&>svg]:size-3.5',
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className="shrink-0" />
      <span>{label}</span>
    </span>
  );
}

export type StatusChipProps = Omit<React.ComponentProps<'span'>, 'children'> & {
  size?: 'sm' | 'default';
  /** Override the canonical label (rarely needed; labels are defined in @gms/domain). */
  label?: React.ReactNode;
} & ({ kind: StatusKind; value: string; meta?: never } | { meta: StatusMeta; kind?: never; value?: never });

/** Status shown with icon + text + color from the canonical definitions in @gms/domain. */
export function StatusChip({ kind, value, meta, label, size, title, ...props }: StatusChipProps) {
  const m = meta ?? statusMeta(kind, value);
  return (
    <ToneChip
      tone={m.tone}
      icon={statusIcon(m.icon)}
      label={label ?? m.label}
      size={size}
      title={title ?? m.description}
      {...props}
    />
  );
}
