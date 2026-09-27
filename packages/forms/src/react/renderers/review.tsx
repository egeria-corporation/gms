// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { cn, formatBytes, MoneyDisplay } from '@gms/ui';
import { FileText } from 'lucide-react';
import * as React from 'react';
import type { FieldMeta } from '../../compile';
import { isEmptyValue, isPlainObject } from '../../util';
import { answerText, type FileRef, fileRefs } from '../form-state';
import { Markdown } from '../markdown-view';

export interface ReviewValueProps {
  meta: FieldMeta;
  value: unknown;
  fileHref?: (file: FileRef) => string | undefined;
  /** Column totals for repeater tables. */
  totals?: Record<string, number>;
}

export function NotAnswered() {
  return <span className="text-muted-foreground italic">Not answered</span>;
}

/** Read-only rendering of one answer for review and blind-review screens. */
export function ReviewValue({ meta, value, fileHref, totals }: ReviewValueProps) {
  if (isEmptyValue(value)) return <NotAnswered />;
  switch (meta.type) {
    case 'long_text':
      return <p className="max-w-prose whitespace-pre-wrap">{String(value)}</p>;
    case 'rich_text':
      return typeof value === 'string' ? <Markdown source={value} /> : <NotAnswered />;
    case 'currency':
      return typeof value === 'number' ? <MoneyDisplay cents={value} currency={meta.currency ?? 'USD'} /> : <span>{String(value)}</span>;
    case 'number':
      return <span className="tabular-nums">{answerText(meta, value)}</span>;
    case 'ein':
    case 'uei':
      return <span className="font-mono tabular-nums">{String(value)}</span>;
    case 'email':
      return typeof value === 'string' ? (
        <a className="text-link underline underline-offset-2" href={`mailto:${value}`}>
          {value}
        </a>
      ) : null;
    case 'file_upload': {
      const files = fileRefs(value);
      return (
        <ul className="grid gap-1">
          {files.map((f) => {
            const href = fileHref?.(f);
            return (
              <li key={f.fileId} className="flex items-center gap-2">
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {href ? (
                  <a className="text-link underline underline-offset-2" href={href}>
                    {f.name}
                  </a>
                ) : (
                  <span>{f.name}</span>
                )}
                {f.size ? <span className="text-xs text-muted-foreground tabular-nums">{formatBytes(f.size)}</span> : null}
              </li>
            );
          })}
        </ul>
      );
    }
    case 'repeater_table': {
      const rows = Array.isArray(value) ? value.filter(isPlainObject) : [];
      const cols = meta.columns ?? [];
      const hasTotals = totals && Object.keys(totals).length > 0;
      const numeric = (t: string) => t === 'currency' || t === 'number';
      return (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{meta.label}</caption>
            <thead className="bg-muted/60">
              <tr>
                {cols.map((c) => (
                  <th key={c.id} scope="col" className={cn('px-2 py-1.5 text-left font-medium', numeric(c.type) && 'text-right')}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t">
                  {cols.map((c) => (
                    <td key={c.id} className={cn('px-2 py-1.5', numeric(c.type) && 'text-right tabular-nums')}>
                      {c.type === 'currency' && typeof r[c.id] === 'number' ? (
                        <MoneyDisplay cents={r[c.id] as number} currency={c.currency ?? 'USD'} />
                      ) : isEmptyValue(r[c.id]) ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        (answerText({ ...meta, type: c.type, options: c.options, currency: c.currency }, r[c.id]) ?? '')
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {hasTotals ? (
              <tfoot className="border-t-2 font-medium">
                <tr>
                  {cols.map((c, i) => (
                    <td key={c.id} className={cn('px-2 py-1.5', numeric(c.type) && 'text-right tabular-nums')}>
                      {totals[c.id] !== undefined ? (
                        c.type === 'currency' ? (
                          <MoneyDisplay cents={totals[c.id]!} currency={c.currency ?? 'USD'} />
                        ) : (
                          totals[c.id]!.toLocaleString('en-US')
                        )
                      ) : i === 0 ? (
                        'Total'
                      ) : null}
                    </td>
                  ))}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      );
    }
    case 'likert_matrix': {
      const v = isPlainObject(value) ? value : {};
      return (
        <ul className="grid gap-1">
          {(meta.rows ?? []).map((r) => (
            <li key={r.id}>
              <span className="text-muted-foreground">{r.label}: </span>
              {v[r.id] !== undefined ? (meta.scale?.find((s) => s.value === v[r.id])?.label ?? String(v[r.id])) : <NotAnswered />}
            </li>
          ))}
        </ul>
      );
    }
    default:
      return <span className="whitespace-pre-wrap">{answerText(meta, value)}</span>;
  }
}
