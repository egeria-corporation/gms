// SPDX-License-Identifier: AGPL-3.0-only
// Shared status metadata and small helpers for the review screens (console R-01…R-04 and the reviewer
// workspace D-01…D-03). Pure TS: safe on the server and the client.
import type { StatusMeta } from '@gms/domain';

export const STAGE_STATUS: Record<string, StatusMeta> = {
  draft: { label: 'Draft', tone: 'muted', icon: 'pencil-line', description: 'Reviewers can’t score yet' },
  active: { label: 'Active', tone: 'success', icon: 'circle-dot', description: 'Reviewers are scoring' },
  closed: { label: 'Closed', tone: 'neutral', icon: 'circle-slash', description: 'Scoring has ended' },
};

export const PANEL_STATUS: Record<string, StatusMeta> = {
  scheduled: { label: 'Scheduled', tone: 'info', icon: 'calendar-clock' },
  live: { label: 'Live', tone: 'success', icon: 'circle-dot' },
  closed: { label: 'Closed', tone: 'neutral', icon: 'circle-slash' },
};

export const RECOMMENDATION: Record<'fund' | 'maybe' | 'decline', StatusMeta> = {
  fund: { label: 'Fund', tone: 'success', icon: 'circle-check' },
  maybe: { label: 'Maybe', tone: 'warning', icon: 'circle-dashed' },
  decline: { label: 'Decline', tone: 'neutral', icon: 'circle-x' },
};

export const CONFLICT_META: StatusMeta = { label: 'Conflict declared', tone: 'danger', icon: 'shield-x' };
export const OVER_CAPACITY_META: StatusMeta = { label: 'Over capacity', tone: 'warning', icon: 'triangle-alert' };

export function stageMeta(status: string): StatusMeta {
  return STAGE_STATUS[status] ?? { label: status, tone: 'neutral', icon: 'circle' };
}

/** "72.5" for a 0–100 weighted score; em dash when missing. */
export function fmtScore(n: number | null | undefined, digits = 1): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : Number(n).toFixed(digits);
}

export function mean(xs: readonly number[]): number | null {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}

export interface WeightedCriterion {
  id: string;
  weightPct: number;
  scaleMin: number;
  scaleMax: number;
}

/** Weighted score on a 0–100 scale, same formula as the server: Σ weight × (score − min)/(max − min). */
export function weightedScore(criteria: readonly WeightedCriterion[], scores: Readonly<Record<string, number | undefined>>): number | null {
  let total = 0;
  let any = false;
  for (const c of criteria) {
    const s = scores[c.id];
    if (s === undefined || c.scaleMax === c.scaleMin) continue;
    any = true;
    total += (c.weightPct * (s - c.scaleMin)) / (c.scaleMax - c.scaleMin);
  }
  return any ? Math.round(total * 100) / 100 : null;
}
