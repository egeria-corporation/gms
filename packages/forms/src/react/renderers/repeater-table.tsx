// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { formatMoney } from '@gms/domain';
import { Button, cn, Field, FieldSet, Input, MoneyDisplay, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from '@gms/ui';
import { CircleCheck, Plus, TriangleAlert, X } from 'lucide-react';
import * as React from 'react';
import type { ColumnMeta, JsonSchema } from '../../compile';
import { isPlainObject } from '../../util';
import { partDomId, partError } from '../form-state';
import { parseNumberInput } from '../money';
import { MoneyInput } from './basic';
import type { FieldRendererProps } from './types';

type Row = Record<string, unknown>;

function rowsOf(v: unknown): Row[] {
  return Array.isArray(v) ? v.map((r) => (isPlainObject(r) ? r : {})) : [];
}

let keySeq = 0;
const nextKey = () => `row-${++keySeq}`;

/** Live "your rows add up to…" message for a repeater with a sum-equals rule. */
export function sumHint(opts: {
  total: number;
  target: unknown;
  targetLabel: string;
  isMoney: boolean;
  currency?: string;
  noun?: string;
}): { tone: 'ok' | 'warn' | 'info'; text: string } {
  const fmt = (n: number) => (opts.isMoney ? formatMoney(n, opts.currency ?? 'USD', { compact: true }) : n.toLocaleString('en-US'));
  const noun = opts.noun || 'rows';
  // “Label.” — but no extra period when the label already ends a sentence (“How much?”).
  const quoted = /[.?!]$/.test(opts.targetLabel.trim()) ? `“${opts.targetLabel.trim()}”` : `“${opts.targetLabel.trim()}.”`;
  if (typeof opts.target !== 'number') {
    return { tone: 'info', text: `Right now your ${noun} add up to ${fmt(opts.total)}. They will need to match your answer to ${quoted}` };
  }
  const diff = opts.target - opts.total;
  if (diff === 0) return { tone: 'ok', text: `Your ${noun} add up to ${fmt(opts.total)}, which matches ${quoted}` };
  return {
    tone: 'warn',
    text: `Your ${noun} add up to ${fmt(opts.total)}. They need to add up to ${fmt(opts.target)} (“${opts.targetLabel}”) — ${fmt(Math.abs(diff))} ${diff > 0 ? 'to go' : 'too much'}.`,
  };
}

export function RepeaterTableRenderer(p: FieldRendererProps) {
  const columns: ColumnMeta[] = p.meta.columns ?? [];
  const rows = rowsOf(p.value);
  const itemProps = p.schema.items?.properties ?? {};
  const maxRows = p.schema.maxItems;
  const minRows = p.schema.minItems;
  const totalsCols = new Set(p.schema['x-totals'] ?? []);
  const totals = p.ctx.totals[p.fieldId] ?? {};
  const locked = p.disabled || p.readOnly;
  const addLabel = typeof p.options.addLabel === 'string' && p.options.addLabel ? p.options.addLabel : 'Add a row';

  // Stable React keys for rows, kept in step with adds and removes.
  const keys = React.useRef<string[]>([]);
  while (keys.current.length < rows.length) keys.current.push(nextKey());
  if (keys.current.length > rows.length) keys.current.length = rows.length;

  const pendingFocus = React.useRef<string | null>(null);
  const addRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    const el = document.getElementById(id) ?? addRef.current;
    el?.focus();
  });

  const setRows = (next: Row[]) => p.onChange(next.length ? next : undefined);
  const setCell = (i: number, colId: string, v: unknown) => {
    const next = rows.map((r, j) => {
      if (j !== i) return r;
      const row = { ...r };
      if (v === undefined || v === '') delete row[colId];
      else row[colId] = v;
      return row;
    });
    setRows(next);
  };
  const addRow = () => {
    keys.current.push(nextKey());
    const first = columns[0];
    if (first) pendingFocus.current = cellId(rows.length, first.id);
    // A new empty row is kept (as {}) so the person sees it; blank rows are ignored when pruned.
    p.onChange([...rows, {}]);
  };
  const removeRow = (i: number) => {
    keys.current.splice(i, 1);
    const next = rows.filter((_, j) => j !== i);
    pendingFocus.current = next.length ? `${p.domId}-remove-${Math.max(0, i - 1)}` : null;
    setRows(next);
  };
  const cellId = (i: number, colId: string) => partDomId(p.fieldId, [i, colId], p.ctx.idPrefix);

  const sumEquals = p.schema['x-sumEquals'];
  let hint: ReturnType<typeof sumHint> | undefined;
  // When validation already reports the mismatch, the error says it; don't repeat it.
  const sumError = p.errors.some((e) => e.keyword === 'x-sumEquals');
  if (sumEquals && !sumError) {
    const col = columns.find((c) => c.id === sumEquals.column);
    const targetMeta = p.ctx.compiled.fieldMeta[sumEquals.field];
    hint = sumHint({
      total: totals[sumEquals.column] ?? 0,
      target: p.ctx.data[sumEquals.field],
      targetLabel: targetMeta?.label ?? sumEquals.field,
      isMoney: col?.type === 'currency',
      currency: col?.currency,
      noun: sumEquals.noun,
    });
  }
  const hintId = `${p.domId}-sum`;
  const size = p.ctx.density === 'applicant' ? 'lg' : 'default';
  const rowNoun = rows.length === 1 ? 'row' : 'rows';

  return (
    <FieldSet
      className="min-w-0"
      id={p.domId}
      legend={p.meta.label}
      description={p.meta.help}
      error={p.error}
      required={p.required}
      optional={!p.required && p.ctx.density === 'applicant'}
    >
      <p className="sr-only" aria-live="polite">
        {rows.length} {rowNoun}.
      </p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <caption className="sr-only">{p.meta.label}</caption>
          <thead className="bg-muted/60 text-left">
            <tr>
              <th scope="col" className="w-12 px-2 py-2 text-xs font-medium text-muted-foreground">
                <span aria-hidden="true">#</span>
                <span className="sr-only">Row</span>
              </th>
              {columns.map((c) => (
                <th key={c.id} scope="col" className={cn('px-2 py-2 font-medium', (c.type === 'currency' || c.type === 'number') && 'text-right')}>
                  {c.label}
                  {c.required ? (
                    <>
                      <span aria-hidden="true" className="text-destructive">
                        {' '}
                        *
                      </span>
                      <span className="sr-only"> (required)</span>
                    </>
                  ) : null}
                </th>
              ))}
              <th scope="col" className="w-14 px-2 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 2} className="px-3 py-6 text-center text-muted-foreground">
                  No rows yet. Use “{addLabel}” to start.
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={keys.current[i]} className="border-t align-top">
                  <th scope="row" className="px-2 py-2.5 text-left text-xs font-medium text-muted-foreground tabular-nums">
                    {i + 1}
                  </th>
                  {columns.map((c) => (
                    <td key={c.id} className="px-2 py-1.5">
                      <Field
                        label={`${c.label}, row ${i + 1}`}
                        hideLabel
                        htmlFor={cellId(i, c.id)}
                        error={partError(p.errors, p.fieldId, [i, c.id])}
                        required={c.required}
                        className="gap-1"
                      >
                        <CellEditor column={c} schema={itemProps[c.id] ?? {}} value={row[c.id]} size={size} disabled={locked} onChange={(v) => setCell(i, c.id, v)} />
                      </Field>
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right">
                    {!locked ? (
                      <Button
                        id={`${p.domId}-remove-${i}`}
                        type="button"
                        variant="ghost"
                        size={size === 'lg' ? 'icon-lg' : 'icon'}
                        onClick={() => removeRow(i)}
                        aria-label={`Remove row ${i + 1}`}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {totalsCols.size > 0 && rows.length > 0 ? (
            <tfoot className="border-t-2 bg-muted/30 font-medium">
              <tr>
                <th scope="row" colSpan={1} className="px-2 py-2 text-left">
                  Total
                </th>
                {columns.map((c) => (
                  <td key={c.id} className={cn('px-2 py-2 tabular-nums', (c.type === 'currency' || c.type === 'number') && 'text-right')}>
                    {totalsCols.has(c.id) ? (
                      c.type === 'currency' ? (
                        <MoneyDisplay cents={totals[c.id] ?? 0} currency={c.currency ?? 'USD'} compact />
                      ) : (
                        (totals[c.id] ?? 0).toLocaleString('en-US')
                      )
                    ) : null}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {hint ? (
        <p
          id={hintId}
          aria-live="polite"
          className={cn(
            'flex items-start gap-1.5 text-sm',
            hint.tone === 'ok' && 'text-status-success-fg',
            hint.tone === 'warn' && 'text-status-warning-fg',
            hint.tone === 'info' && 'text-muted-foreground',
          )}
        >
          {hint.tone === 'ok' ? <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : hint.tone === 'warn' ? <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : null}
          <span>{hint.text}</span>
        </p>
      ) : null}
      {!locked ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button ref={addRef} type="button" variant="outline" size={size === 'lg' ? 'lg' : 'default'} onClick={addRow} disabled={maxRows !== undefined && rows.length >= maxRows}>
            <Plus aria-hidden="true" />
            {addLabel}
          </Button>
          <span className="text-xs text-muted-foreground">
            {minRows ? `At least ${minRows} ${minRows === 1 ? 'row' : 'rows'}. ` : ''}
            {maxRows ? `Up to ${maxRows} rows.` : ''}
          </span>
        </div>
      ) : null}
    </FieldSet>
  );
}

function CellEditor({
  column,
  schema,
  value,
  size,
  disabled,
  onChange,
}: {
  column: ColumnMeta;
  schema: JsonSchema;
  value: unknown;
  size: 'lg' | 'default';
  disabled: boolean;
  onChange: (v: unknown) => void;
}) {
  const s = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
  const inputSize = size === 'lg' ? 'lg' : 'default';
  switch (column.type) {
    case 'currency':
      return <MoneyInput size={inputSize} className="ml-auto max-w-40" cents={value} disabled={disabled} onCents={onChange} />;
    case 'number':
      return (
        <NumberCell value={value} integer={schema.type === 'integer'} size={inputSize} disabled={disabled} onChange={onChange} />
      );
    case 'date':
      return <Input type="date" inputSize={inputSize} value={s} disabled={disabled} onChange={(e) => onChange(e.currentTarget.value || undefined)} />;
    case 'long_text':
      return <Textarea rows={2} value={s} disabled={disabled} onChange={(e) => onChange(e.currentTarget.value || undefined)} />;
    case 'select':
    case 'yes_no': {
      const opts = column.type === 'yes_no' ? [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] : (column.options ?? []);
      const current = column.type === 'yes_no' ? (value === true ? 'yes' : value === false ? 'no' : '') : s;
      return (
        <Select
          value={current}
          disabled={disabled}
          onValueChange={(v) => onChange(column.type === 'yes_no' ? v === 'yes' : v || undefined)}
        >
          <SelectTrigger size={inputSize}>
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            {opts.map((o) => (
              <SelectItem key={o.value} value={o.value} className={size === 'lg' ? 'min-h-11 text-base' : undefined}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    case 'email':
      return <Input type="email" inputSize={inputSize} value={s} disabled={disabled} onChange={(e) => onChange(e.currentTarget.value.trim() || undefined)} />;
    case 'phone':
      return <Input type="tel" inputSize={inputSize} value={s} disabled={disabled} onChange={(e) => onChange(e.currentTarget.value || undefined)} />;
    default:
      return <Input inputSize={inputSize} value={s} disabled={disabled} onChange={(e) => onChange(e.currentTarget.value || undefined)} />;
  }
}

function NumberCell({ value, integer, size, disabled, onChange }: { value: unknown; integer: boolean; size: 'lg' | 'default'; disabled: boolean; onChange: (v: unknown) => void }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const shown = draft ?? (typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '');
  return (
    <Input
      inputSize={size}
      inputMode={integer ? 'numeric' : 'decimal'}
      className="text-right tabular-nums"
      value={shown}
      disabled={disabled}
      onChange={(e) => {
        const t = e.currentTarget.value;
        setDraft(t);
        const n = parseNumberInput(t, integer);
        onChange(n === null ? undefined : n === undefined ? t.trim() : n);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
