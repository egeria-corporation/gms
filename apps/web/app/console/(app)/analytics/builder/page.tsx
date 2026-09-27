// SPDX-License-Identifier: AGPL-3.0-only
// AN-02 Report builder: curated datasets (applications, awards, payments, reports), filters, group / pivot,
// chart type, save (saved_views surface "report_builder"), scheduled digest option, CSV/XLSX export
// (states: empty, saved).
import { formatMoney } from '@gms/domain';
import { Alert, Badge, BarChart, Card, CardContent, DonutChart, EmptyState, LineChart, PageHeader, Section, StackedBarChart, type ChartDatum } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState, one } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { monthLabel } from '../lib';
import { BuilderForm } from './builder-form';
import { CHARTS, configToQuery, DATASETS, FREQUENCIES, parseConfig, type ReportConfig } from './datasets';
import { runReport, type ResultRow } from './query';

export const metadata: Metadata = { title: 'Report builder' };

const MAX_SERIES = 8;

function labeler(c: ReportConfig, dim: string) {
  const meta = DATASETS[c.dataset];
  return (v: string) => {
    if (dim === 'status') return meta.statuses[v]?.label ?? v;
    if (dim === 'month' && /^\d{4}-\d{2}$/.test(v)) return monthLabel(`${v}-01`);
    if (dim === 'method' || dim === 'rail' || dim === 'kind') return v.replace(/_/g, ' ').replace(/^\w/, (x) => x.toUpperCase());
    return v;
  };
}

export default async function BuilderPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(['owner', 'admin', 'program_officer', 'finance', 'auditor'])]);
  const sp = await searchParams;
  const forced = forcedState(sp);
  const viewId = one(sp.view);
  const { saved, programs, openView } = await rls(async (trx) => {
    const [saved, programs] = await Promise.all([
      trx
        .selectFrom('saved_views as v')
        .leftJoin('profiles as p', 'p.id', 'v.user_id')
        .select(['v.id', 'v.name', 'v.config', 'v.shared', 'v.user_id', 'v.last_modified_at', 'p.full_name'])
        .where('v.workspace_id', '=', tenant.id)
        .where('v.surface', '=', 'report_builder')
        .where((eb) => eb.or([eb('v.user_id', '=', viewer.userId), eb('v.shared', '=', true)]))
        .orderBy('v.name')
        .execute(),
      trx.selectFrom('programs').select(['id', 'name']).where('workspace_id', '=', tenant.id).orderBy('name').execute(),
    ]);
    return { saved, programs, openView: viewId ? saved.find((s) => s.id === viewId) : undefined };
  });
  const fromUrl = typeof sp.dataset === 'string';
  const config = parseConfig(fromUrl ? (sp as Record<string, unknown>) : ((openView?.config as Record<string, unknown> | undefined) ?? {}));
  const rows: ResultRow[] = forced === 'empty' ? [] : await rls((trx) => runReport(trx, tenant.id, tenant.timezone, config));

  const meta = DATASETS[config.dataset];
  const money = meta.measures[config.measure]?.money ?? false;
  const rowLabel = labeler(config, config.rows);
  const colLabel = config.cols ? labeler(config, config.cols) : (v: string) => v;
  // Pivot: rows × (top columns by total, the rest folded into "Other").
  const colTotals = new Map<string, number>();
  for (const r of rows) if (r.col !== null || config.cols) colTotals.set(r.col ?? '—', (colTotals.get(r.col ?? '—') ?? 0) + r.value);
  const topCols = [...colTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const shownCols = topCols.length > MAX_SERIES ? [...topCols.slice(0, MAX_SERIES - 1), '__other'] : topCols;
  const colOf = (c: string | null) => (!config.cols ? '__value' : shownCols.includes(c ?? '—') ? (c ?? '—') : '__other');
  const pivot = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = pivot.get(r.row) ?? new Map<string, number>();
    const k = colOf(r.col);
    m.set(k, (m.get(k) ?? 0) + r.value);
    pivot.set(r.row, m);
  }
  const seriesKeys = config.cols ? shownCols : ['__value'];
  const series = seriesKeys.map((k, i) => ({ key: `s${i}`, label: k === '__value' ? (meta.measures[config.measure]?.label ?? 'Value') : k === '__other' ? 'Other' : colLabel(k), color: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5 }));
  const rowKeys = [...pivot.keys()];
  const chartData: ChartDatum[] = rowKeys.map((rk) => ({ row: rowLabel(rk), ...Object.fromEntries(seriesKeys.map((k, i) => [`s${i}`, pivot.get(rk)?.get(k) ?? 0])) }));
  const total = rows.reduce((a, r) => a + r.value, 0);
  const fmt = (v: number) => (money ? formatMoney(v) : v.toLocaleString('en-US'));
  const title = openView && !fromUrl ? openView.name : `${meta.measures[config.measure]?.label} by ${meta.dims[config.rows]?.toLowerCase()}${config.cols ? ` and ${meta.dims[config.cols]?.toLowerCase()}` : ''}`;
  const description = `${meta.label}${config.from || config.to ? `, ${meta.dateLabel.toLowerCase()} ${config.from ?? '…'} to ${config.to ?? '…'}` : ''}. Total ${fmt(total)}.`;
  const chartProps = { title, description, data: chartData, categoryKey: 'row', categoryLabel: meta.dims[config.rows], series, valueFormat: money ? ('money' as const) : ('number' as const) };
  const justSaved = forced === 'saved' || one(sp.saved) === '1';

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Report builder"
        description="Pick a dataset, group it, filter it and chart it. Save reports to reuse or share them, email yourself a digest, or export the result."
        breadcrumbs={[{ label: 'Dashboards', href: '/console/analytics' }, { label: 'Report builder' }]}
        linkComponent={NextLink}
      />
      {justSaved ? (
        <Alert variant="success" title={`Report saved${openView ? `: ${openView.name}` : ''}`} role="status">
          {config.schedule !== 'off' ? `We’ll email it to you ${FREQUENCIES[config.schedule].toLowerCase()}.` : 'Find it under Saved reports.'}
        </Alert>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <BuilderForm
          config={config}
          programs={programs.map((p) => ({ id: p.id, name: p.name }))}
          openView={openView && openView.user_id === viewer.userId ? { id: openView.id, name: openView.name, shared: openView.shared } : null}
          canExport
        />
        <div className="grid content-start gap-6">
          <Card>
            <CardContent className="grid gap-4 pt-6">
              {rows.length === 0 ? (
                <EmptyState
                  title="No rows match"
                  description="Nothing in this dataset matches these filters. Widen the dates, clear a status, or pick another program."
                />
              ) : config.chart === 'table' ? (
                <p className="text-sm">
                  <span className="font-semibold">{title}</span> — {description}
                </p>
              ) : config.chart === 'donut' && !config.cols ? (
                <DonutChart title={title} description={description} data={chartData} nameKey="row" valueKey="s0" nameLabel={meta.dims[config.rows]} valueLabel={series[0]?.label} valueFormat={money ? 'money' : 'number'} hideTable />
              ) : config.chart === 'line' ? (
                <LineChart {...chartProps} hideTable />
              ) : config.chart === 'stacked' && config.cols ? (
                <StackedBarChart {...chartProps} hideTable />
              ) : (
                <BarChart {...chartProps} hideTable />
              )}
              {rows.length ? (
                <div className="overflow-x-auto rounded-md border" role="region" aria-label="Report results" tabIndex={0}>
                  <table className="w-full text-sm tabular-nums" data-testid="report-table">
                    <caption className="sr-only">{title}</caption>
                    <thead className="bg-muted/60 text-xs text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          {meta.dims[config.rows]}
                        </th>
                        {series.map((s) => (
                          <th key={s.key} scope="col" className="px-3 py-2 text-right font-medium">
                            {s.label}
                          </th>
                        ))}
                        {config.cols ? (
                          <th scope="col" className="px-3 py-2 text-right font-medium">
                            Total
                          </th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {chartData.map((d) => (
                        <tr key={String(d.row)}>
                          <th scope="row" className="px-3 py-1.5 text-left font-medium">
                            {d.row}
                          </th>
                          {series.map((s) => (
                            <td key={s.key} className="px-3 py-1.5 text-right">
                              {fmt(Number(d[s.key] ?? 0))}
                            </td>
                          ))}
                          {config.cols ? <td className="px-3 py-1.5 text-right font-medium">{fmt(series.reduce((a, s) => a + Number(d[s.key] ?? 0), 0))}</td> : null}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t bg-muted/40 font-medium">
                      <tr>
                        <th scope="row" className="px-3 py-1.5 text-left">
                          Total
                        </th>
                        {series.map((s) => (
                          <td key={s.key} className="px-3 py-1.5 text-right">
                            {fmt(chartData.reduce((a, d) => a + Number(d[s.key] ?? 0), 0))}
                          </td>
                        ))}
                        {config.cols ? <td className="px-3 py-1.5 text-right">{fmt(total)}</td> : null}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Section title="Saved reports" level={2}>
            {saved.length ? (
              <ul className="divide-y rounded-lg border bg-card">
                {saved.map((s) => {
                  const c = parseConfig((s.config as Record<string, unknown>) ?? {});
                  return (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                      <Link href={`/console/analytics/builder?${configToQuery(c, { view: s.id })}`} className="min-w-0 font-medium hover:underline" aria-current={s.id === viewId ? 'page' : undefined}>
                        {s.name}
                        <span className="block text-xs font-normal text-muted-foreground">
                          {DATASETS[c.dataset].label} · {CHARTS[c.chart]}
                          {s.user_id !== viewer.userId ? ` · by ${s.full_name ?? 'a teammate'}` : ''}
                        </span>
                      </Link>
                      <span className="flex gap-1">
                        {s.shared ? <Badge variant="info">Shared</Badge> : <Badge variant="neutral">Only you</Badge>}
                        {c.schedule !== 'off' ? <Badge variant="neutral">Emailed {c.schedule}</Badge> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No saved reports yet. Build one and choose “Save report”.</p>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
