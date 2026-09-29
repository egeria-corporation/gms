// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { formatMoney, formatMoneyShort } from '@gms/domain';
import * as React from 'react';
import {
  Area,
  AreaChart as RAreaChart,
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart as RLineChart,
  Pie,
  PieChart as RPieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '../lib/utils';

export type ChartDatum = Record<string, string | number | null>;
export type ChartColor = 1 | 2 | 3 | 4 | 5;
export type ValueFormat = 'number' | 'money' | 'percent';

export interface ChartSeries {
  key: string;
  label: string;
  /** Which --chart-N token to use. Defaults to the series position. */
  color?: ChartColor;
}

interface BaseChartProps {
  /** Visible title; also the chart's accessible name. */
  title: string;
  /** One-sentence takeaway, e.g. "Awards rose 12% over last year." Read by screen readers. */
  description?: string;
  data: ChartDatum[];
  height?: number;
  /** 'money' values are integer cents. */
  valueFormat?: ValueFormat;
  currency?: string;
  /** Hide the "Show data" table toggle. Avoid: it's the accessible fallback. */
  hideTable?: boolean;
  className?: string;
}

export interface CartesianChartProps extends BaseChartProps {
  /** Key of the category (x) value in each datum. */
  categoryKey: string;
  categoryLabel?: string;
  series: ChartSeries[];
}

const color = (s: ChartSeries, i: number) => `var(--chart-${s.color ?? ((i % 5) + 1)})`;

function formatter(format: ValueFormat, currency: string, short: boolean) {
  return (v: unknown): string => {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return '—';
    if (format === 'money') return short ? formatMoneyShort(n, currency) : formatMoney(n, currency);
    if (format === 'percent') return `${(n * 100).toFixed(short ? 0 : 1)}%`;
    return short && Math.abs(n) >= 10_000 ? new Intl.NumberFormat('en-US', { notation: 'compact' }).format(n) : n.toLocaleString('en-US');
  };
}

const axisProps = {
  tick: { fill: 'var(--muted-foreground)', fontSize: 12 },
  axisLine: { stroke: 'var(--border)' },
  tickLine: false,
} as const;

const tooltipProps = {
  contentStyle: {
    background: 'var(--popover)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--popover-foreground)',
    fontSize: 12,
    boxShadow: 'var(--shadow-raised)',
  },
  labelStyle: { color: 'var(--popover-foreground)', fontWeight: 600 },
  cursor: { fill: 'var(--muted)', opacity: 0.6 },
} as const;

/** Frame shared by all charts: title, description, the chart as one labelled image, and a data table. */
export function ChartFrame({
  title,
  description,
  height = 260,
  hideTable,
  className,
  table,
  children,
}: {
  title: string;
  description?: string;
  height?: number;
  hideTable?: boolean;
  className?: string;
  table: React.ReactNode;
  children: React.ReactElement;
}) {
  const id = React.useId();
  return (
    <figure data-slot="chart" aria-labelledby={`${id}-title`} className={cn('grid gap-3', className)}>
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
      <div role="img" aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-desc` : undefined} style={{ height }} className="w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
      {hideTable ? null : (
        <details className="group text-sm">
          <summary className="w-fit cursor-pointer rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground">
            Show data as a table
          </summary>
          <div className="mt-2 overflow-x-auto rounded-md border">{table}</div>
        </details>
      )}
    </figure>
  );
}

function ChartTable({
  caption,
  columns,
  rows,
  format,
}: {
  caption: string;
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: ChartDatum[];
  format: (v: unknown) => string;
}) {
  return (
    <table className="w-full text-xs tabular-nums">
      <caption className="sr-only">{caption}</caption>
      <thead className="bg-muted/60 text-muted-foreground">
        <tr>
          {columns.map((c) => (
            <th key={c.key} scope="col" className={cn('px-3 py-1.5 font-medium', c.numeric ? 'text-right' : 'text-left')}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map((r, i) => (
          <tr key={i}>
            {columns.map((c, j) =>
              j === 0 ? (
                <th key={c.key} scope="row" className="px-3 py-1.5 text-left font-medium">
                  {String(r[c.key] ?? '')}
                </th>
              ) : (
                <td key={c.key} className="px-3 py-1.5 text-right">
                  {format(r[c.key])}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function cartesianTable(p: CartesianChartProps, format: (v: unknown) => string) {
  return (
    <ChartTable
      caption={p.title}
      columns={[{ key: p.categoryKey, label: p.categoryLabel ?? p.categoryKey }, ...p.series.map((s) => ({ key: s.key, label: s.label, numeric: true }))]}
      rows={p.data}
      format={format}
    />
  );
}

function legendFormatter(series: ChartSeries[]) {
  return (value: unknown) => <span className="text-xs text-foreground">{series.find((s) => s.key === value)?.label ?? String(value)}</span>;
}

export interface BarChartProps extends CartesianChartProps {
  /** 'horizontal' draws bars left-to-right (good for long category names). */
  orientation?: 'vertical' | 'horizontal';
  stacked?: boolean;
}

export function BarChart(props: BarChartProps) {
  const { data, series, categoryKey, valueFormat = 'number', currency = 'USD', orientation = 'vertical', stacked = false } = props;
  const short = formatter(valueFormat, currency, true);
  const full = formatter(valueFormat, currency, false);
  const horizontal = orientation === 'horizontal';
  return (
    <ChartFrame {...props} table={cartesianTable(props, full)}>
      <RBarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} accessibilityLayer={false} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tickFormatter={short} {...axisProps} />
            <YAxis type="category" dataKey={categoryKey} width={120} {...axisProps} />
          </>
        ) : (
          <>
            <XAxis dataKey={categoryKey} {...axisProps} />
            <YAxis tickFormatter={short} width={56} {...axisProps} />
          </>
        )}
        <Tooltip formatter={(v, name) => [full(v), series.find((s) => s.key === name)?.label ?? String(name)]} {...tooltipProps} />
        {series.length > 1 ? <Legend formatter={legendFormatter(series)} iconType="square" iconSize={10} /> : null}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.key}
            fill={color(s, i)}
            stackId={stacked ? 'stack' : undefined}
            radius={stacked ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            maxBarSize={48}
            isAnimationActive={false}
          />
        ))}
      </RBarChart>
    </ChartFrame>
  );
}

export function StackedBarChart(props: Omit<BarChartProps, 'stacked'>) {
  return <BarChart {...props} stacked />;
}

export function LineChart(props: CartesianChartProps) {
  const { data, series, categoryKey, valueFormat = 'number', currency = 'USD' } = props;
  const short = formatter(valueFormat, currency, true);
  const full = formatter(valueFormat, currency, false);
  return (
    <ChartFrame {...props} table={cartesianTable(props, full)}>
      <RLineChart data={data} accessibilityLayer={false} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={categoryKey} {...axisProps} />
        <YAxis tickFormatter={short} width={56} {...axisProps} />
        <Tooltip formatter={(v, name) => [full(v), series.find((s) => s.key === name)?.label ?? String(name)]} {...tooltipProps} cursor={{ stroke: 'var(--border)' }} />
        {series.length > 1 ? <Legend formatter={legendFormatter(series)} iconType="plainline" /> : null}
        {series.map((s, i) => (
          <Line key={s.key} dataKey={s.key} name={s.key} stroke={color(s, i)} strokeWidth={2} dot={{ r: 2.5 }} type="monotone" isAnimationActive={false} />
        ))}
      </RLineChart>
    </ChartFrame>
  );
}

export function AreaChart(props: CartesianChartProps & { stacked?: boolean }) {
  const { data, series, categoryKey, valueFormat = 'number', currency = 'USD', stacked = false } = props;
  const short = formatter(valueFormat, currency, true);
  const full = formatter(valueFormat, currency, false);
  return (
    <ChartFrame {...props} table={cartesianTable(props, full)}>
      <RAreaChart data={data} accessibilityLayer={false} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={categoryKey} {...axisProps} />
        <YAxis tickFormatter={short} width={56} {...axisProps} />
        <Tooltip formatter={(v, name) => [full(v), series.find((s) => s.key === name)?.label ?? String(name)]} {...tooltipProps} cursor={{ stroke: 'var(--border)' }} />
        {series.length > 1 ? <Legend formatter={legendFormatter(series)} iconType="square" iconSize={10} /> : null}
        {series.map((s, i) => (
          <Area
            key={s.key}
            dataKey={s.key}
            name={s.key}
            stroke={color(s, i)}
            fill={color(s, i)}
            fillOpacity={0.18}
            strokeWidth={2}
            type="monotone"
            stackId={stacked ? 'stack' : undefined}
            isAnimationActive={false}
          />
        ))}
      </RAreaChart>
    </ChartFrame>
  );
}

export interface DonutChartProps extends BaseChartProps {
  nameKey: string;
  valueKey: string;
  nameLabel?: string;
  valueLabel?: string;
  /** Text in the middle, e.g. the total. */
  centerLabel?: string;
  /** Full pie instead of a donut. */
  pie?: boolean;
}

export function DonutChart(props: DonutChartProps) {
  const { data, nameKey, valueKey, valueFormat = 'number', currency = 'USD', centerLabel, pie = false, nameLabel, valueLabel } = props;
  const full = formatter(valueFormat, currency, false);
  return (
    <ChartFrame
      {...props}
      table={
        <ChartTable
          caption={props.title}
          columns={[
            { key: nameKey, label: nameLabel ?? nameKey },
            { key: valueKey, label: valueLabel ?? valueKey, numeric: true },
          ]}
          rows={data}
          format={full}
        />
      }
    >
      <RPieChart accessibilityLayer={false}>
        <Tooltip formatter={(v) => full(v)} {...tooltipProps} />
        <Legend iconType="square" iconSize={10} formatter={(v: unknown) => <span className="text-xs text-foreground">{String(v)}</span>} />
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          innerRadius={pie ? 0 : '58%'}
          outerRadius="85%"
          paddingAngle={pie ? 0 : 1.5}
          stroke="var(--card)"
          strokeWidth={2}
          isAnimationActive={false}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={`var(--chart-${(i % 5) + 1})`} />
          ))}
        </Pie>
        {centerLabel && !pie ? (
          <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-sm font-semibold tabular-nums">
            {centerLabel}
          </text>
        ) : null}
      </RPieChart>
    </ChartFrame>
  );
}
