// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import {
  Alert,
  Button,
  CheckboxField,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldSet,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@gms/ui';
import { Download, Play, Save } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { exportReportAction, saveReportAction } from './actions';
import { CHARTS, configToQuery, DATASETS, FREQUENCIES, type ChartKind, type DatasetKey, type Frequency, type ReportConfig } from './datasets';

const NONE = '__none';

export function BuilderForm({ config, programs, openView, canExport }: { config: ReportConfig; programs: { id: string; name: string }[]; openView: { id: string; name: string; shared: boolean } | null; canExport: boolean }) {
  const router = useRouter();
  const [c, setC] = useState<ReportConfig>(config);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState(openView?.name ?? '');
  const [shared, setShared] = useState(openView?.shared ?? false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const meta = DATASETS[c.dataset];
  const set = <K extends keyof ReportConfig>(k: K, v: ReportConfig[K]) => setC((x) => ({ ...x, [k]: v }));

  const run = (next = c, extra: Record<string, string> = {}) => router.push(`/console/analytics/builder?${configToQuery(next, extra)}`);

  const changeDataset = (ds: DatasetKey) => {
    const m = DATASETS[ds];
    setC((x) => ({ ...x, dataset: ds, rows: 'status' in m.dims ? 'status' : Object.keys(m.dims)[0]!, cols: null, measure: 'count', statuses: [] }));
  };

  const doExport = (format: 'csv' | 'xlsx') =>
    start(async () => {
      const r = await exportReportAction({ config: c, format, name: openView?.name ?? null, savedViewId: openView?.id ?? null });
      if (r.ok)
        toast.success('Export requested. We’ll notify you when it’s ready.', { action: { label: 'Open exports', onClick: () => router.push('/console/exports') } });
      else toast.error(r.problem.detail);
    });

  return (
    <form
      className="grid content-start gap-5 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run();
      }}
      aria-label="Report settings"
    >
      <Field label="Dataset" htmlFor="rb-dataset" description={meta.description}>
        <Select value={c.dataset} onValueChange={(v) => changeDataset(v as DatasetKey)}>
          <SelectTrigger id="rb-dataset">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(DATASETS) as DatasetKey[]).map((k) => (
              <SelectItem key={k} value={k}>
                {DATASETS[k].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Measure" htmlFor="rb-measure">
        <Select value={c.measure} onValueChange={(v) => set('measure', v)}>
          <SelectTrigger id="rb-measure">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(meta.measures).map(([k, m]) => (
              <SelectItem key={k} value={k}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Group rows by" htmlFor="rb-rows">
          <Select value={c.rows} onValueChange={(v) => setC((x) => ({ ...x, rows: v, cols: x.cols === v ? null : x.cols }))}>
            <SelectTrigger id="rb-rows">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(meta.dims).map(([k, l]) => (
                <SelectItem key={k} value={k}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Split columns by" htmlFor="rb-cols">
          <Select value={c.cols ?? NONE} onValueChange={(v) => set('cols', v === NONE ? null : v)}>
            <SelectTrigger id="rb-cols">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Don’t split</SelectItem>
              {Object.entries(meta.dims)
                .filter(([k]) => k !== c.rows)
                .map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Chart" htmlFor="rb-chart">
        <Select value={c.chart} onValueChange={(v) => set('chart', v as ChartKind)}>
          <SelectTrigger id="rb-chart">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(CHARTS) as ChartKind[]).map((k) => (
              <SelectItem key={k} value={k} disabled={(k === 'donut' && Boolean(c.cols)) || (k === 'stacked' && !c.cols)}>
                {CHARTS[k]}
                {k === 'donut' && c.cols ? ' (no split)' : k === 'stacked' && !c.cols ? ' (needs a split)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <FieldSet legend="Filters">
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${meta.dateLabel} from`} htmlFor="rb-from">
            <Input id="rb-from" type="date" value={c.from ?? ''} onChange={(e) => set('from', e.target.value || null)} />
          </Field>
          <Field label="to" htmlFor="rb-to">
            <Input id="rb-to" type="date" value={c.to ?? ''} onChange={(e) => set('to', e.target.value || null)} />
          </Field>
        </div>
        <Field label="Program" htmlFor="rb-program">
          <Select value={c.programId ?? NONE} onValueChange={(v) => set('programId', v === NONE ? null : v)}>
            <SelectTrigger id="rb-program">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>All programs</SelectItem>
              {programs.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-sm font-medium">Status {c.statuses.length ? `(${c.statuses.length})` : '(any)'}</legend>
          <div className="grid max-h-44 grid-cols-2 gap-1 overflow-y-auto">
            {Object.entries(meta.statuses).map(([k, s]) => (
              <CheckboxField
                key={k}
                id={`rb-status-${k}`}
                label={s.label}
                checked={c.statuses.includes(k)}
                onCheckedChange={(v) => set('statuses', v === true ? [...c.statuses, k] : c.statuses.filter((x) => x !== k))}
              />
            ))}
          </div>
        </fieldset>
      </FieldSet>

      <Field label="Email me this report" htmlFor="rb-schedule" description="Saved with the report. Digests are sent by the background worker.">
        <Select value={c.schedule} onValueChange={(v) => set('schedule', v as Frequency)}>
          <SelectTrigger id="rb-schedule">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(FREQUENCIES) as Frequency[]).map((k) => (
              <SelectItem key={k} value={k}>
                {FREQUENCIES[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button type="submit">
          <Play aria-hidden="true" /> Run report
        </Button>
        <Button type="button" variant="secondary" onClick={() => setSaveOpen(true)}>
          <Save aria-hidden="true" /> {openView ? 'Save changes' : 'Save report'}
        </Button>
      </div>
      {canExport ? (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
          <span className="text-muted-foreground">Export the result:</span>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => doExport('csv')}>
            <Download aria-hidden="true" /> CSV
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => doExport('xlsx')}>
            <Download aria-hidden="true" /> Excel
          </Button>
          <Link href="/console/exports" className="text-link underline">
            Your exports
          </Link>
        </div>
      ) : null}

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{openView ? 'Save changes to this report' : 'Save this report'}</DialogTitle>
            <DialogDescription>Saved reports keep the dataset, grouping, filters, chart and email schedule.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {saveError ? (
              <Alert variant="danger" title="Not saved" role="alert">
                {saveError}
              </Alert>
            ) : null}
            <Field label="Report name" htmlFor="rb-name">
              <Input id="rb-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Awards by county, this fiscal year" />
            </Field>
            <CheckboxField id="rb-shared" label="Share with the team" description="Everyone on staff can open it. Only you can change it." checked={shared} onCheckedChange={(v) => setShared(v === true)} />
          </div>
          <DialogFooter>
            <Button
              pending={pending}
              pendingLabel="Saving…"
              onClick={() => {
                if (!name.trim()) {
                  setSaveError('Give the report a name.');
                  return;
                }
                setSaveError(null);
                start(async () => {
                  const r = await saveReportAction({ ...(openView ? { id: openView.id } : {}), name: name.trim(), shared, config: c });
                  if (r.ok) {
                    setSaveOpen(false);
                    run(c, { view: r.data.id, saved: '1' });
                    router.refresh();
                  } else setSaveError(r.problem.detail);
                });
              }}
            >
              Save report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
