// SPDX-License-Identifier: AGPL-3.0-only
import { RISK_TIER_LABELS, type RiskTier, type Tone } from '@gms/domain';
import { Eye, Hand, ShieldAlert, Undo2, type LucideIcon } from 'lucide-react';
import * as React from 'react';
import { ToneChip } from './status-chip';

const RISK: Record<RiskTier, { tone: Tone; icon: LucideIcon }> = {
  R0: { tone: 'muted', icon: Eye },
  R1: { tone: 'info', icon: Undo2 },
  R2: { tone: 'warning', icon: Hand },
  R3: { tone: 'danger', icon: ShieldAlert },
};

export interface RiskChipProps extends Omit<React.ComponentProps<'span'>, 'children'> {
  tier: RiskTier;
  /** Show only "R2" (the full meaning stays available to screen readers and on hover). */
  compact?: boolean;
  size?: 'sm' | 'default';
}

/** Risk tier R0–R3: R0 read, R1 reversible, R2 a person confirms, R3 people only. */
export function RiskChip({ tier, compact = false, size, ...props }: RiskChipProps) {
  const r = RISK[tier];
  const meaning = RISK_TIER_LABELS[tier];
  return (
    <ToneChip
      tone={r.tone}
      icon={r.icon}
      size={size}
      title={`${tier}: ${meaning}`}
      label={
        compact ? (
          <>
            {tier}
            <span className="sr-only">: {meaning}</span>
          </>
        ) : (
          `${tier} · ${meaning}`
        )
      }
      {...props}
    />
  );
}
