// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { cn, FieldSet } from '@gms/ui';
import { CircleAlert } from 'lucide-react';
import * as React from 'react';
import { isPlainObject } from '../../util';
import { partDomId, partError } from '../form-state';
import type { FieldRendererProps } from './types';

/**
 * Rating grid. Each row is a native radio group (same `name`), so arrow keys move between the
 * choices in a row and Tab moves to the next row. Every radio is labelled by its row and column
 * headers.
 */
export function LikertMatrixRenderer(p: FieldRendererProps) {
  const rows = p.meta.rows ?? [];
  const scale = p.meta.scale ?? [];
  const value = isPlainObject(p.value) ? p.value : {};
  const locked = p.disabled || p.readOnly;
  const applicant = p.ctx.density === 'applicant';
  const setRow = (rowId: string, v: string) => p.onChange({ ...value, [rowId]: v });
  const headerId = (i: number) => `${p.domId}-col-${i}`;
  const rowHeaderId = (rowId: string) => `${p.domId}-row-${rowId}`;
  return (
    <FieldSet
      className="min-w-0"
      id={p.domId}
      legend={p.meta.label}
      description={p.meta.help}
      error={p.error}
      required={p.required}
      optional={!p.required && applicant}
    >
      <p className="text-xs text-muted-foreground sm:hidden">Scroll sideways to see every choice.</p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[32rem] border-collapse text-sm">
          <caption className="sr-only">{p.meta.label}</caption>
          <thead className="bg-muted/60">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                <span className="sr-only">Statement</span>
              </th>
              {scale.map((s, i) => (
                <th key={s.value} id={headerId(i)} scope="col" className="px-2 py-2 text-center text-xs font-medium">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const err = partError(p.errors, p.fieldId, [r.id]);
              const errId = `${rowHeaderId(r.id)}-error`;
              return (
                <tr key={r.id} className={cn('border-t', err && 'bg-status-danger-bg/40')}>
                  <th scope="row" id={rowHeaderId(r.id)} className="px-3 py-2 text-left font-normal">
                    {r.label}
                    {err ? (
                      <span id={errId} className="mt-1 flex items-center gap-1 text-xs font-medium text-status-danger-fg">
                        <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                        <span className="sr-only">Error: </span>
                        {err}
                      </span>
                    ) : null}
                  </th>
                  {scale.map((s, i) => (
                    <td key={s.value} className="p-0 text-center">
                      <label className={cn('flex cursor-pointer items-center justify-center', applicant ? 'min-h-11 min-w-11' : 'min-h-9 min-w-9', locked && 'cursor-not-allowed')}>
                        <input
                          type="radio"
                          id={i === 0 ? partDomId(p.fieldId, [r.id], p.ctx.idPrefix) : undefined}
                          name={`${p.domId}-${r.id}`}
                          value={s.value}
                          checked={value[r.id] === s.value}
                          disabled={locked}
                          required={p.required && i === 0}
                          aria-labelledby={`${rowHeaderId(r.id)} ${headerId(i)}`}
                          aria-describedby={err ? errId : undefined}
                          aria-invalid={err ? true : undefined}
                          onChange={() => setRow(r.id, s.value)}
                          className={cn('accent-primary', applicant ? 'size-5' : 'size-4')}
                        />
                      </label>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </FieldSet>
  );
}
