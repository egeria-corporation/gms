// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared status chips for the operator console.
import { ToneChip } from '@gms/ui';
import { CircleAlert, CircleCheck, CirclePause, Clock, Hourglass } from 'lucide-react';
import type { HealthLevel } from './data';

export const HEALTH_CHIP: Record<HealthLevel, { tone: 'success' | 'info' | 'warning' | 'danger'; icon: typeof CircleCheck; label: string }> = {
  ok: { tone: 'success', icon: CircleCheck, label: 'Healthy' },
  idle: { tone: 'info', icon: Hourglass, label: 'Processing' },
  backlog: { tone: 'warning', icon: Clock, label: 'Behind' },
  stalled: { tone: 'danger', icon: CircleAlert, label: 'Stalled' },
};

export function WorkspaceStatusChip({ status }: { status: string }) {
  if (status === 'active') return <ToneChip tone="success" icon={CircleCheck} label="Active" size="sm" />;
  if (status === 'suspended') return <ToneChip tone="warning" icon={CirclePause} label="Suspended" size="sm" />;
  return <ToneChip tone="muted" icon={CirclePause} label={status === 'archived' ? 'Archived' : status} size="sm" />;
}
