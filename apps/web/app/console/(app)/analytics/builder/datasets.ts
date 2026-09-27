// SPDX-License-Identifier: AGPL-3.0-only
// Curated datasets for the report builder (AN-02): the only fields a report can group, filter or sum.
// Pure metadata, shared by the server query and the client form.
import { APPLICATION_STATUS, AWARD_STATUS, PAYMENT_STATUS, REPORT_STATUS } from '@gms/domain';

export type DatasetKey = 'applications' | 'awards' | 'payments' | 'reports';
export type ChartKind = 'bar' | 'stacked' | 'line' | 'donut' | 'table';
export type Frequency = 'off' | 'weekly' | 'monthly';

export interface DatasetMeta {
  label: string;
  description: string;
  dateLabel: string;
  statuses: Record<string, { label: string }>;
  dims: Record<string, string>;
  measures: Record<string, { label: string; money: boolean }>;
}

export const DATASETS: Record<DatasetKey, DatasetMeta> = {
  applications: {
    label: 'Applications',
    description: 'Every application, submitted or not.',
    dateLabel: 'Submitted',
    statuses: APPLICATION_STATUS,
    dims: { status: 'Status', opportunity: 'Opportunity', program: 'Program', month: 'Month submitted', channel: 'Submitted via' },
    measures: { count: { label: 'Number of applications', money: false }, requested: { label: 'Amount requested', money: true } },
  },
  awards: {
    label: 'Awards',
    description: 'Original awards (amendments are included in amounts on the dashboards).',
    dateLabel: 'Start date',
    statuses: AWARD_STATUS,
    dims: { status: 'Status', program: 'Program', fiscal_year: 'Fiscal year', opportunity: 'Opportunity', county: 'County' },
    measures: { count: { label: 'Number of awards', money: false }, amount: { label: 'Amount awarded', money: true }, disbursed: { label: 'Amount paid', money: true } },
  },
  payments: {
    label: 'Payments',
    description: 'Payments to grantees, in any status.',
    dateLabel: 'Sent',
    statuses: PAYMENT_STATUS,
    dims: { status: 'Status', method: 'Method', program: 'Program', month: 'Month sent', rail: 'Rail' },
    measures: { count: { label: 'Number of payments', money: false }, amount: { label: 'Amount', money: true } },
  },
  reports: {
    label: 'Grant reports',
    description: 'Reports grantees owe, by due date.',
    dateLabel: 'Due',
    statuses: REPORT_STATUS,
    dims: { status: 'Status', kind: 'Report type', program: 'Program', month: 'Month due' },
    measures: { count: { label: 'Number of reports', money: false } },
  },
};

export const CHARTS: Record<ChartKind, string> = { bar: 'Bar chart', stacked: 'Stacked bars', line: 'Line chart', donut: 'Donut', table: 'Table only' };
export const FREQUENCIES: Record<Frequency, string> = { off: 'No email', weekly: 'Weekly (Monday morning)', monthly: 'Monthly (first weekday)' };

export interface ReportConfig {
  dataset: DatasetKey;
  rows: string;
  cols: string | null;
  measure: string;
  chart: ChartKind;
  from: string | null;
  to: string | null;
  statuses: string[];
  programId: string | null;
  schedule: Frequency;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

/** Parses and whitelists a report config from URL params or saved JSON. Unknown values fall back to defaults. */
export function parseConfig(raw: Record<string, unknown>): ReportConfig {
  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : Array.isArray(raw[k]) ? String((raw[k] as unknown[])[0] ?? '') : '');
  const dataset = (Object.keys(DATASETS).includes(str('dataset')) ? str('dataset') : 'applications') as DatasetKey;
  const meta = DATASETS[dataset];
  const rows = str('rows') in meta.dims ? str('rows') : 'status';
  const cols = str('cols') in meta.dims && str('cols') !== rows ? str('cols') : null;
  const measure = str('measure') in meta.measures ? str('measure') : 'count';
  const chart = (str('chart') in CHARTS ? str('chart') : 'bar') as ChartKind;
  const statusesRaw = Array.isArray(raw.statuses) ? (raw.statuses as unknown[]).map(String) : str('statuses').split(',');
  const statuses = statusesRaw.map((s) => s.trim()).filter((s) => s in meta.statuses);
  const from = ISO_DATE.test(str('from')) ? str('from') : null;
  const to = ISO_DATE.test(str('to')) ? str('to') : null;
  const programId = UUID.test(str('programId')) ? str('programId') : null;
  const schedule = (str('schedule') in FREQUENCIES ? str('schedule') : 'off') as Frequency;
  return { dataset, rows, cols, measure, chart, from, to, statuses, programId, schedule };
}

export function configToQuery(c: ReportConfig, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  q.set('dataset', c.dataset);
  q.set('rows', c.rows);
  if (c.cols) q.set('cols', c.cols);
  q.set('measure', c.measure);
  q.set('chart', c.chart);
  if (c.from) q.set('from', c.from);
  if (c.to) q.set('to', c.to);
  if (c.statuses.length) q.set('statuses', c.statuses.join(','));
  if (c.programId) q.set('programId', c.programId);
  if (c.schedule !== 'off') q.set('schedule', c.schedule);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return q.toString();
}
