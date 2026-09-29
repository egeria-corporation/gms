// SPDX-License-Identifier: AGPL-3.0-or-later
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/utils';

export interface StatDelta {
  /** Signed change. Shown as-is with the `format` function (default: percent with one decimal). */
  value: number;
  /** Context, e.g. "vs. last cycle". */
  label?: string;
  /** Which direction is good. 'neutral' keeps the delta gray. Default 'up'. */
  goodWhen?: 'up' | 'down' | 'neutral';
  format?: (value: number) => string;
}

export interface StatTileProps extends Omit<React.ComponentProps<'div'>, 'children'> {
  label: React.ReactNode;
  /** Pre-formatted value, e.g. <MoneyDisplay cents={…} short /> or "142". */
  value: React.ReactNode;
  delta?: StatDelta;
  /** Small trend line; decorative (describe the trend in `delta` or `footnote`). */
  sparkline?: number[];
  footnote?: React.ReactNode;
  /** Optional link/action rendered at the bottom. */
  action?: React.ReactNode;
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const w = 96;
  const h = 28;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - 2 - ((v - min) / span) * (h - 4)] as const);
  const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const last = pts[pts.length - 1]!;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" focusable="false" className="shrink-0 overflow-visible text-chart-1">
      <path d={`${d}L${w} ${h}L0 ${h}Z`} fill="currentColor" opacity={0.1} />
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2} fill="currentColor" />
    </svg>
  );
}

const pct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`;

/** One number that matters, with an optional change and trend. */
export function StatTile({ label, value, delta, sparkline, footnote, action, className, ...props }: StatTileProps) {
  let deltaEl: React.ReactNode = null;
  if (delta) {
    const dir = delta.value > 0 ? 'up' : delta.value < 0 ? 'down' : 'flat';
    const good = delta.goodWhen ?? 'up';
    const tone = good === 'neutral' || dir === 'flat' ? 'neutral' : dir === good ? 'success' : 'danger';
    const Icon = dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : ArrowRight;
    const text = (delta.format ?? pct)(delta.value);
    deltaEl = (
      <p className="flex flex-wrap items-center gap-1 text-xs">
        <span
          className={cn(
            'inline-flex items-center gap-0.5 font-medium tabular-nums',
            tone === 'success' && 'text-status-success-fg',
            tone === 'danger' && 'text-status-danger-fg',
            tone === 'neutral' && 'text-muted-foreground',
          )}
        >
          <Icon className="size-3.5" aria-hidden="true" />
          <span className="sr-only">{dir === 'up' ? 'Up' : dir === 'down' ? 'Down' : 'No change'} </span>
          {text}
        </span>
        {delta.label ? <span className="text-muted-foreground">{delta.label}</span> : null}
      </p>
    );
  }
  return (
    <div data-slot="stat-tile" className={cn('flex flex-col gap-2 rounded-lg border bg-card p-4 text-card-foreground shadow-soft', className)} {...props}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="flex items-end justify-between gap-3">
        <p className="text-2xl leading-none font-semibold tracking-tight tabular-nums">{value}</p>
        {sparkline ? <Sparkline data={sparkline} /> : null}
      </div>
      {deltaEl}
      {footnote ? <p className="text-xs text-muted-foreground">{footnote}</p> : null}
      {action ? <div className="mt-auto pt-1 text-sm">{action}</div> : null}
    </div>
  );
}
