// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { formatMoney, formatMoneyShort } from '@gms/domain';
import * as React from 'react';
import { cn } from '../lib/utils';

export interface CountyRegion {
  id: string;
  name: string;
  /** SVG path data in the map's viewBox coordinates. */
  path: string;
  /** Value for shading; null means no data. */
  value: number | null;
}

export interface CountyMapProps {
  title: string;
  description?: string;
  regions: CountyRegion[];
  /** e.g. "0 0 800 600". */
  viewBox: string;
  valueLabel?: string;
  /** 'money' values are integer cents. */
  valueFormat?: 'number' | 'money' | 'percent';
  currency?: string;
  /** Number of shading buckets (2–6). */
  steps?: number;
  selectedId?: string | null;
  /** Makes regions focusable buttons. */
  onSelect?: (id: string) => void;
  hideTable?: boolean;
  className?: string;
}

/**
 * Choropleth for a handful of named counties, drawn as inline SVG from paths you pass in
 * (no map tiles or third-party requests). Buckets are shades of --chart-1; a data table is included.
 */
export function CountyMap({
  title,
  description,
  regions,
  viewBox,
  valueLabel = 'Value',
  valueFormat = 'number',
  currency = 'USD',
  steps = 5,
  selectedId,
  onSelect,
  hideTable = false,
  className,
}: CountyMapProps) {
  const id = React.useId();
  const n = Math.max(2, Math.min(6, Math.round(steps)));
  const values = regions.map((r) => r.value).filter((v): v is number => v !== null && Number.isFinite(v));
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const bucketOf = (v: number) => (max === min ? n - 1 : Math.min(n - 1, Math.floor(((v - min) / (max - min)) * n)));
  const shade = (b: number) => `color-mix(in oklch, var(--chart-1) ${Math.round(18 + (b / (n - 1)) * 82)}%, var(--card))`;
  const fmt = (v: number | null, short = false) => {
    if (v === null) return 'No data';
    if (valueFormat === 'money') return short ? formatMoneyShort(v, currency) : formatMoney(v, currency);
    if (valueFormat === 'percent') return `${(v * 100).toFixed(short ? 0 : 1)}%`;
    return v.toLocaleString('en-US');
  };
  const edges = Array.from({ length: n + 1 }, (_, i) => min + ((max - min) * i) / n);

  return (
    <figure data-slot="county-map" aria-labelledby={`${id}-title`} className={cn('grid gap-3', className)}>
      <figcaption className="grid gap-0.5">
        <span id={`${id}-title`} className="text-sm font-semibold">
          {title}
        </span>
        {description ? (
          <span id={`${id}-desc`} className="text-xs text-muted-foreground">
            {description}
          </span>
        ) : null}
      </figcaption>
      <svg
        viewBox={viewBox}
        className="h-auto w-full"
        role={onSelect ? 'group' : 'img'}
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
      >
        {regions.map((r) => {
          const selected = r.id === selectedId;
          const label = `${r.name}: ${fmt(r.value)}`;
          const interactive = Boolean(onSelect);
          return (
            <path
              key={r.id}
              d={r.path}
              fill={r.value === null ? 'var(--muted)' : shade(bucketOf(r.value))}
              stroke={selected ? 'var(--foreground)' : 'var(--card)'}
              strokeWidth={selected ? 2.5 : 1.25}
              vectorEffect="non-scaling-stroke"
              className={cn(
                'transition-[fill-opacity] duration-150',
                interactive && 'cursor-pointer outline-none hover:fill-opacity-80 focus-visible:stroke-ring focus-visible:[stroke-width:3]',
              )}
              {...(interactive
                ? {
                    role: 'button',
                    tabIndex: 0,
                    'aria-label': label,
                    'aria-pressed': selected,
                    onClick: () => onSelect?.(r.id),
                    onKeyDown: (e: React.KeyboardEvent<SVGPathElement>) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelect?.(r.id);
                      }
                    },
                  }
                : {})}
            >
              <title>{label}</title>
            </path>
          );
        })}
      </svg>
      {values.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-hidden="true">
          <span>{valueLabel}</span>
          {Array.from({ length: n }, (_, b) => (
            <span key={b} className="inline-flex items-center gap-1 tabular-nums">
              <span className="size-3 rounded-[3px] border" style={{ background: shade(b) }} />
              {fmt(edges[b]!, true)}–{fmt(edges[b + 1]!, true)}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <span className="size-3 rounded-[3px] border bg-muted" />
            No data
          </span>
        </div>
      ) : null}
      {hideTable ? null : (
        <details className="text-sm">
          <summary className="w-fit cursor-pointer rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground">Show data as a table</summary>
          <div className="mt-2 overflow-x-auto rounded-md border">
            <table className="w-full text-xs tabular-nums">
              <caption className="sr-only">{title}</caption>
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-1.5 text-left font-medium">
                    County
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">
                    {valueLabel}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {regions.map((r) => (
                  <tr key={r.id}>
                    <th scope="row" className="px-3 py-1.5 text-left font-medium">
                      {r.name}
                    </th>
                    <td className="px-3 py-1.5 text-right">{fmt(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </figure>
  );
}
