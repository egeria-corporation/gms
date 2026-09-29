// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { cn, Field, Input, Textarea } from '@gms/ui';
import * as React from 'react';
import { currencyDisplayValue, formatCentsForInput, formatEin, normalizeUei, parseDollarsToCents, parseNumberInput } from '../money';
import type { FieldRendererProps } from './types';

export function inputSize(p: Pick<FieldRendererProps, 'ctx'>): 'lg' | 'default' {
  return p.ctx.density === 'applicant' ? 'lg' : 'default';
}

/** Common Field wrapper props for single-control questions. */
export function fieldProps(p: FieldRendererProps) {
  return {
    label: p.meta.label,
    description: p.meta.help,
    error: p.error,
    required: p.required,
    optional: !p.required && p.ctx.density === 'applicant',
    htmlFor: p.domId,
  };
}

function strOr(v: unknown): string {
  return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
}

/** Blank text clears the answer. */
function textValue(s: string): string | undefined {
  return s === '' ? undefined : s;
}

export function TextRenderer(p: FieldRendererProps) {
  const max = p.meta.maxLength ?? p.schema.maxLength;
  const value = strOr(p.value);
  const countId = `${p.domId}-count`;
  const over = max !== undefined && [...value].length > max;
  return (
    <Field {...fieldProps(p)} describedBy={max ? [countId] : []}>
      <Input
        inputSize={inputSize(p)}
        value={value}
        disabled={p.disabled}
        readOnly={p.readOnly}
        autoComplete={autoCompleteFor(p)}
        onChange={(e) => p.onChange(textValue(e.currentTarget.value))}
      />
      {max ? (
        <p id={countId} className={cn('text-right text-xs tabular-nums text-muted-foreground', over && 'font-medium text-status-danger-fg')}>
          {[...value].length.toLocaleString('en-US')} of {max.toLocaleString('en-US')} characters
        </p>
      ) : null}
    </Field>
  );
}

function autoCompleteFor(p: FieldRendererProps): string | undefined {
  switch (p.meta.cgMapping) {
    case 'organization.name':
      return 'organization';
    case 'organization.website':
      return 'url';
    case 'contact.title':
      return 'organization-title';
    default:
      return undefined;
  }
}

export function LongTextRenderer(p: FieldRendererProps) {
  const maxWords = p.meta.maxWords ?? p.schema.maxWords;
  return (
    <Field {...fieldProps(p)}>
      <Textarea
        textareaSize={p.ctx.density === 'applicant' ? 'lg' : 'default'}
        rows={p.ctx.density === 'applicant' ? 6 : 4}
        maxWords={maxWords}
        showWordCount
        value={strOr(p.value)}
        disabled={p.disabled}
        readOnly={p.readOnly}
        onChange={(e) => p.onChange(textValue(e.currentTarget.value))}
      />
    </Field>
  );
}

/**
 * An input that keeps what the person typed while they type, and shows the formatted stored value
 * otherwise. `parse` returns the value to store (or `undefined` to keep the raw text, so
 * validation can explain what's wrong).
 */
function BufferedInput({
  value,
  format,
  parse,
  onCommit,
  formatOnBlur = true,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'> & {
  value: unknown;
  format: (v: unknown) => string;
  parse: (text: string) => unknown;
  onCommit: (v: unknown) => void;
  formatOnBlur?: boolean;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const shown = draft ?? format(value);
  return (
    <Input
      {...props}
      value={shown}
      onChange={(e) => {
        const text = e.currentTarget.value;
        setDraft(text);
        onCommit(parse(text));
      }}
      onFocus={(e) => {
        setDraft(format(value));
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        if (formatOnBlur) setDraft(null);
        props.onBlur?.(e);
      }}
    />
  );
}

export function NumberRenderer(p: FieldRendererProps) {
  const integer = p.schema.type === 'integer';
  const unit = typeof p.options.unit === 'string' ? p.options.unit : undefined;
  const unitId = `${p.domId}-unit`;
  return (
    <Field {...fieldProps(p)} describedBy={unit ? [unitId] : []}>
      <div className="flex items-center gap-2">
        <BufferedInput
          inputSize={inputSize(p)}
          inputMode={integer ? 'numeric' : 'decimal'}
          className="max-w-48 tabular-nums"
          value={p.value}
          disabled={p.disabled}
          readOnly={p.readOnly}
          format={(v) => (typeof v === 'number' ? String(v) : strOr(v))}
          parse={(t) => {
            const n = parseNumberInput(t, integer);
            return n === undefined ? t.trim() : n;
          }}
          onCommit={(v) => p.onChange(v === null ? undefined : v)}
        />
        {unit ? (
          <span id={unitId} className="text-sm text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </div>
    </Field>
  );
}

/** Dollar box ↔ integer cents. Formats on blur ("12500" → "12,500"); tabular numerals. */
export function MoneyInput({
  cents,
  onCents,
  size = 'default',
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'size'> & {
  cents: unknown;
  onCents: (v: number | string | undefined) => void;
  size?: 'lg' | 'default' | 'sm';
}) {
  return (
    <div className={cn('relative w-full max-w-56', className)}>
      <span aria-hidden="true" className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground', size === 'lg' ? 'left-3.5 text-base' : 'left-3 text-sm')}>
        $
      </span>
      <BufferedInput
        {...props}
        inputSize={size}
        inputMode="decimal"
        className={cn('tabular-nums', size === 'lg' ? 'pl-7' : 'pl-6')}
        value={cents}
        format={currencyDisplayValue}
        parse={(t) => {
          const c = parseDollarsToCents(t);
          return c === undefined ? t.trim() : c;
        }}
        onCommit={(v) => onCents(v === null ? undefined : (v as number | string))}
      />
    </div>
  );
}

export function CurrencyRenderer(p: FieldRendererProps) {
  const min = p.schema.minimum;
  const max = p.schema.maximum;
  const rangeId = `${p.domId}-range`;
  const range =
    min !== undefined && max !== undefined
      ? `From $${formatCentsForInput(min)} to $${formatCentsForInput(max)}`
      : min !== undefined && min > 0
        ? `At least $${formatCentsForInput(min)}`
        : max !== undefined
          ? `Up to $${formatCentsForInput(max)}`
          : undefined;
  // Don't repeat the range when the help text already says it.
  const showRange = range && !(p.meta.help ?? '').includes('$');
  return (
    <Field {...fieldProps(p)} describedBy={showRange ? [rangeId] : []}>
      <MoneyInput size={inputSize(p)} cents={p.value} disabled={p.disabled} readOnly={p.readOnly} onCents={(v) => p.onChange(v)} />
      {showRange ? (
        <p id={rangeId} className="text-xs text-muted-foreground">
          {range}
        </p>
      ) : null}
    </Field>
  );
}

export function DateRenderer(p: FieldRendererProps) {
  return (
    <Field {...fieldProps(p)}>
      <Input
        type="date"
        inputSize={inputSize(p)}
        className="max-w-56"
        value={strOr(p.value)}
        min={p.schema.formatMinimum}
        max={p.schema.formatMaximum}
        disabled={p.disabled}
        readOnly={p.readOnly}
        onChange={(e) => p.onChange(textValue(e.currentTarget.value))}
      />
    </Field>
  );
}

export function EmailRenderer(p: FieldRendererProps) {
  return (
    <Field {...fieldProps(p)}>
      <Input
        type="email"
        inputSize={inputSize(p)}
        autoComplete="email"
        spellCheck={false}
        value={strOr(p.value)}
        disabled={p.disabled}
        readOnly={p.readOnly}
        onChange={(e) => p.onChange(textValue(e.currentTarget.value.trim()))}
      />
    </Field>
  );
}

export function PhoneRenderer(p: FieldRendererProps) {
  return (
    <Field {...fieldProps(p)}>
      <Input
        type="tel"
        inputSize={inputSize(p)}
        autoComplete="tel"
        className="max-w-72"
        value={strOr(p.value)}
        disabled={p.disabled}
        readOnly={p.readOnly}
        onChange={(e) => p.onChange(textValue(e.currentTarget.value))}
      />
    </Field>
  );
}

export function EinRenderer(p: FieldRendererProps) {
  return (
    <Field {...fieldProps(p)}>
      <Input
        inputSize={inputSize(p)}
        inputMode="numeric"
        className="max-w-48 font-mono tabular-nums"
        maxLength={10}
        spellCheck={false}
        value={strOr(p.value)}
        disabled={p.disabled}
        readOnly={p.readOnly}
        onChange={(e) => p.onChange(textValue(formatEin(e.currentTarget.value)))}
      />
    </Field>
  );
}

export function UeiRenderer(p: FieldRendererProps) {
  return (
    <Field {...fieldProps(p)}>
      <Input
        inputSize={inputSize(p)}
        autoCapitalize="characters"
        className="max-w-56 font-mono tracking-wide uppercase"
        maxLength={12}
        spellCheck={false}
        value={strOr(p.value)}
        disabled={p.disabled}
        readOnly={p.readOnly}
        onChange={(e) => p.onChange(textValue(normalizeUei(e.currentTarget.value)))}
      />
    </Field>
  );
}
