// SPDX-License-Identifier: AGPL-3.0-only
// Per-workspace monthly quota for assistant calls.

export const DEFAULT_MONTHLY_QUOTA = 40;

/** The first instant of the calendar month containing `now`, in UTC. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
}

export function quotaState(used: number, limit: number, now: Date): QuotaState {
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { used, limit, remaining: Math.max(0, limit - used), resetsAt: reset.toISOString() };
}
