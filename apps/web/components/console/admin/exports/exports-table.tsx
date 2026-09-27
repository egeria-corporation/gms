// SPDX-License-Identifier: AGPL-3.0-only
// S-09: export rows with status chips and download links (server-renderable).
import { formatInZone } from '@gms/domain';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, ToneChip } from '@gms/ui';
import { CircleCheck, Clock, Download, LoaderCircle, TriangleAlert } from 'lucide-react';

export interface ExportRow {
  id: string;
  kind: string;
  format: string;
  params: Record<string, unknown>;
  status: string;
  error: string | null;
  requestedBy: string | null;
  createdAt: string;
  completedAt: string | null;
  downloadable: boolean;
}

export const EXPORT_KIND_LABELS: Record<string, string> = {
  applications: 'Applications',
  awards: 'Awards',
  payments: 'Payments',
  reports: 'Grant reports',
  grantees: 'Grantees',
  form_990pf: '990-PF grants paid',
  qualifying_distributions: 'Qualifying distributions',
  workspace: 'Full workspace',
  report_definition: 'Saved report',
};

export function exportKindLabel(kind: string): string {
  return EXPORT_KIND_LABELS[kind] ?? kind.replace(/_/g, ' ');
}

export function ExportStatusChip({ status }: { status: string }) {
  if (status === 'succeeded') return <ToneChip tone="success" icon={CircleCheck} label="Ready" size="sm" />;
  if (status === 'failed') return <ToneChip tone="danger" icon={TriangleAlert} label="Failed" size="sm" />;
  if (status === 'running')
    return (
      <ToneChip
        tone="progress"
        icon={LoaderCircle}
        label="Preparing"
        size="sm"
        className="[&>svg]:animate-spin motion-reduce:[&>svg]:animate-none"
      />
    );
  return <ToneChip tone="progress" icon={Clock} label="Queued" size="sm" />;
}

/** "Tax year 2025 · Program: Arts" — a short, human summary of the export's parameters. */
export function paramsSummary(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    const label =
      k === 'taxYear'
        ? 'Tax year'
        : k
            .replace(/_/g, ' ')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/^./, (c) => c.toUpperCase());
    const value = Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
    parts.push(`${label} ${value}`);
  }
  return parts.join(' · ');
}

export function ExportsTable({
  rows,
  timeZone,
  showKind = true,
  label,
}: {
  rows: ExportRow[];
  timeZone: string;
  showKind?: boolean;
  label: string;
}) {
  return (
    <Table containerLabel={label}>
      <TableHeader>
        <TableRow>
          {showKind ? <TableHead>Export</TableHead> : null}
          <TableHead>Format</TableHead>
          {showKind ? <TableHead>Details</TableHead> : null}
          <TableHead>Requested by</TableHead>
          <TableHead>Requested</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Completed</TableHead>
          <TableHead>Download</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            {showKind ? <TableCell className="font-medium">{exportKindLabel(r.kind)}</TableCell> : null}
            <TableCell className="uppercase text-xs">{r.format}</TableCell>
            {showKind ? (
              <TableCell className="text-xs text-muted-foreground">
                {paramsSummary(r.params) || '—'}
              </TableCell>
            ) : null}
            <TableCell>{r.requestedBy ?? '—'}</TableCell>
            <TableCell className="whitespace-nowrap text-xs">{formatInZone(r.createdAt, timeZone)}</TableCell>
            <TableCell>
              <div className="grid gap-1">
                <ExportStatusChip status={r.status} />
                {r.status === 'failed' && r.error ? (
                  <span className="max-w-64 text-xs text-status-danger-fg">{r.error}</span>
                ) : null}
              </div>
            </TableCell>
            <TableCell className="whitespace-nowrap text-xs">
              {r.completedAt ? formatInZone(r.completedAt, timeZone) : '—'}
            </TableCell>
            <TableCell>
              {r.downloadable ? (
                <a
                  href={`/console/exports/${r.id}/download`}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-link underline underline-offset-4"
                  download
                >
                  <Download aria-hidden="true" className="size-4" />
                  Download
                  <span className="sr-only">
                    {' '}
                    {exportKindLabel(r.kind)} export ({r.format})
                  </span>
                </a>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {r.status === 'failed' ? 'Not available' : 'Not ready yet'}
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
