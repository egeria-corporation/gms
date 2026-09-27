// SPDX-License-Identifier: AGPL-3.0-only
// Status chips for agent accounts and consent grants (icon + text + color).
import { ToneChip } from '@gms/ui';
import { Ban, CircleCheck, CirclePause, Clock } from 'lucide-react';

export function AgentStatusChip({ status, expiresAt }: { status: string; expiresAt?: string | null }) {
  if (status === 'active' && expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    return <ToneChip tone="muted" icon={Clock} label="Expired" size="sm" />;
  }
  if (status === 'active') return <ToneChip tone="success" icon={CircleCheck} label="Active" size="sm" />;
  if (status === 'paused') return <ToneChip tone="warning" icon={CirclePause} label="Paused" size="sm" />;
  return <ToneChip tone="muted" icon={Ban} label="Revoked" size="sm" />;
}
