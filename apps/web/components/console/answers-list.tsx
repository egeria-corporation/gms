// SPDX-License-Identifier: AGPL-3.0-only
// Read-only answers of a submitted form, rendered generically from the form version's `field_meta` (label, type,
// options, columns) and the submission data. Plain text only — never injects HTML.
import { formatDateOnly, formatMoney } from '@gms/domain';
import { DescriptionList, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, type DescriptionItem } from '@gms/ui';
import * as React from 'react';

interface Option {
  value: string;
  label: string;
}

interface ColumnMeta {
  id: string;
  label: string;
  type: string;
  options?: Option[];
  currency?: string;
}

export interface AnswerFieldMeta {
  type: string;
  label: string;
  order?: number;
  pageId?: string;
  options?: Option[];
  currency?: string;
  columns?: ColumnMeta[];
  rows?: { id: string; label: string }[];
  scale?: Option[];
  statement?: string;
  indicator?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Narrows stored JSON `field_meta` into the shape this component needs (skips malformed entries). */
export function toFieldMeta(raw: unknown): Record<string, AnswerFieldMeta> {
  const out: Record<string, AnswerFieldMeta> = {};
  if (!isRecord(raw)) return out;
  for (const [id, m] of Object.entries(raw)) {
    if (isRecord(m) && typeof m.label === 'string' && typeof m.type === 'string') out[id] = m as unknown as AnswerFieldMeta;
  }
  return out;
}

function optionLabel(options: Option[] | undefined, v: unknown): string {
  const s = String(v);
  return options?.find((o) => o.value === s)?.label ?? s;
}

function scalar(type: string, v: unknown, meta: { options?: Option[]; currency?: string }): React.ReactNode {
  if (v === null || v === undefined || v === '') return null;
  switch (type) {
    case 'currency':
      return typeof v === 'number' ? <span className="tabular-nums">{formatMoney(v, meta.currency ?? 'USD')}</span> : String(v);
    case 'number':
      return typeof v === 'number' ? <span className="tabular-nums">{v.toLocaleString('en-US')}</span> : String(v);
    case 'date':
      return typeof v === 'string' ? formatDateOnly(v) : String(v);
    case 'yes_no':
      return v === true ? 'Yes' : v === false ? 'No' : String(v);
    case 'select':
      return optionLabel(meta.options, v);
    default:
      if (typeof v === 'boolean') return v ? 'Yes' : 'No';
      if (typeof v === 'number') return v.toLocaleString('en-US');
      if (typeof v === 'string') return <span className="whitespace-pre-wrap">{v}</span>;
      return <code className="text-xs">{JSON.stringify(v)}</code>;
  }
}

function fileItem(v: unknown): React.ReactNode {
  if (!isRecord(v)) return null;
  const size = typeof v.size === 'number' ? ` (${Math.max(1, Math.round(v.size / 1024)).toLocaleString('en-US')} KB)` : '';
  return `${typeof v.name === 'string' ? v.name : 'File'}${size}`;
}

function renderAnswer(meta: AnswerFieldMeta, v: unknown): React.ReactNode {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return null;
  switch (meta.type) {
    case 'multi_select':
    case 'checkbox_group':
      return Array.isArray(v) ? v.map((x) => optionLabel(meta.options, x)).join(', ') : scalar('select', v, meta);
    case 'name':
      return isRecord(v) ? [v.first, v.last].filter((x) => typeof x === 'string' && x).join(' ') || null : scalar('text', v, meta);
    case 'address':
      return isRecord(v) ? (
        <span className="whitespace-pre-line">
          {[v.line1, v.line2, [v.city, v.state, v.postal].filter(Boolean).join(', '), v.county ? `${String(v.county)} County` : null].filter((x) => typeof x === 'string' && x).join('\n')}
        </span>
      ) : (
        scalar('text', v, meta)
      );
    case 'file_upload':
      return Array.isArray(v) ? (
        <ul className="grid gap-0.5">
          {v.map((f, i) => (
            <li key={i}>{fileItem(f)}</li>
          ))}
        </ul>
      ) : (
        fileItem(v)
      );
    case 'attestation':
      return isRecord(v) ? `${v.agreed === true ? 'Confirmed' : 'Not confirmed'}${typeof v.name === 'string' && v.name ? ` — signed “${v.name}”` : ''}` : scalar('text', v, meta);
    case 'likert_matrix':
      return isRecord(v) ? (
        <ul className="grid gap-0.5">
          {(meta.rows ?? Object.keys(v).map((id) => ({ id, label: id }))).map((r) => (
            <li key={r.id}>
              {r.label}: <strong>{v[r.id] === undefined ? '—' : optionLabel(meta.scale, v[r.id])}</strong>
            </li>
          ))}
        </ul>
      ) : (
        scalar('text', v, meta)
      );
    case 'repeater_table': {
      if (!Array.isArray(v)) return scalar('text', v, meta);
      const cols: ColumnMeta[] = meta.columns ?? Object.keys(isRecord(v[0]) ? v[0] : {}).map((id) => ({ id, label: id, type: 'text' }));
      return (
        <Table containerLabel={meta.label} containerClassName="rounded-md border">
          <TableHeader>
            <TableRow>
              {cols.map((c) => (
                <TableHead key={c.id} className={c.type === 'currency' || c.type === 'number' ? 'text-right' : undefined}>
                  {c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {v.map((row, i) => (
              <TableRow key={i}>
                {cols.map((c) => (
                  <TableCell key={c.id} className={c.type === 'currency' || c.type === 'number' ? 'text-right' : undefined}>
                    {isRecord(row) ? (scalar(c.type, row[c.id], c) ?? '—') : '—'}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
    }
    default:
      return scalar(meta.type, v, meta);
  }
}

/** Answers keyed by field id, in form order. Answers without metadata are listed at the end by key. */
export function AnswersList({ fieldMeta, data, className }: { fieldMeta: Record<string, AnswerFieldMeta>; data: Record<string, unknown>; className?: string }) {
  const known = Object.entries(fieldMeta).sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0));
  const items: DescriptionItem[] = known.map(([id, meta]) => ({ term: meta.label, detail: renderAnswer(meta, data[id]), wide: meta.type === 'repeater_table' || meta.type === 'long_text' || meta.type === 'rich_text' }));
  for (const [key, v] of Object.entries(data)) {
    if (key.startsWith('_') || fieldMeta[key]) continue;
    items.push({ term: key.replace(/_/g, ' '), detail: renderAnswer({ type: 'text', label: key }, v) });
  }
  if (!items.length) return <p className="text-sm text-muted-foreground">No answers.</p>;
  return <DescriptionList items={items} className={className} />;
}
