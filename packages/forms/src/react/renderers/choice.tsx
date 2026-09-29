// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { Button, CheckboxField, cn, Field, FieldSet, Input, RadioGroup, RadioOption, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@gms/ui';
import * as React from 'react';
import type { Option } from '../../model';
import { inputSize } from './basic';
import type { FieldRendererProps } from './types';

function optionsOf(p: FieldRendererProps): Option[] {
  return p.meta.options ?? [];
}

function fieldSetProps(p: FieldRendererProps) {
  return {
    id: p.domId,
    legend: p.meta.label,
    description: p.meta.help,
    error: p.error,
    required: p.required,
    optional: !p.required && p.ctx.density === 'applicant',
  };
}

export function SelectRenderer(p: FieldRendererProps) {
  const options = optionsOf(p);
  const value = typeof p.value === 'string' ? p.value : '';
  const size = inputSize(p);
  const locked = p.disabled || p.readOnly;
  if (p.options.format === 'radio') {
    return (
      <FieldSet className="min-w-0" {...fieldSetProps(p)}>
        <RadioGroup
          value={value}
          onValueChange={(v) => p.onChange(v || undefined)}
          disabled={locked}
          aria-required={p.required || undefined}
          aria-invalid={p.error ? true : undefined}
        >
          {options.map((o) => (
            <RadioOption key={o.value} id={`${p.domId}-${o.value}`} value={o.value} label={o.label} size={size === 'lg' ? 'lg' : 'default'} />
          ))}
        </RadioGroup>
        {!p.required && value && !locked ? <ClearButton onClick={() => p.onChange(undefined)} /> : null}
      </FieldSet>
    );
  }
  return (
    <Field label={p.meta.label} description={p.meta.help} error={p.error} required={p.required} optional={!p.required && p.ctx.density === 'applicant'} htmlFor={p.domId}>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={value} onValueChange={(v) => p.onChange(v || undefined)} disabled={locked}>
          <SelectTrigger size={size} className="max-w-md">
            <SelectValue placeholder="Choose one" />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value} className={size === 'lg' ? 'min-h-11 text-base' : undefined}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!p.required && value && !locked ? <ClearButton onClick={() => p.onChange(undefined)} /> : null}
      </div>
    </Field>
  );
}

function ClearButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="link" size="sm" className="min-h-11 justify-self-start" onClick={onClick}>
      Clear answer
    </Button>
  );
}

/** Checkbox list used by both "multiple choice" and "checkboxes" questions. */
export function CheckboxListRenderer(p: FieldRendererProps) {
  const options = optionsOf(p);
  const selected = Array.isArray(p.value) ? p.value.filter((v): v is string => typeof v === 'string') : [];
  const max = p.schema.maxItems;
  const [filter, setFilter] = React.useState('');
  const locked = p.disabled || p.readOnly;
  const filterable = p.meta.type === 'multi_select' && options.length > 8;
  const shown = filterable && filter.trim() ? options.filter((o) => o.label.toLowerCase().includes(filter.trim().toLowerCase()) || selected.includes(o.value)) : options;
  const toggle = (value: string, on: boolean) => {
    const set = new Set(selected);
    if (on) set.add(value);
    else set.delete(value);
    // Keep the question's option order, not click order.
    const next = options.map((o) => o.value).filter((v) => set.has(v));
    p.onChange(next.length ? next : undefined);
  };
  const size = p.ctx.density === 'applicant' ? 'lg' : 'default';
  const countId = `${p.domId}-count`;
  return (
    <FieldSet className="min-w-0" {...fieldSetProps(p)}>
      {max ? (
        <p id={countId} className={cn('text-sm text-muted-foreground', selected.length > max && 'font-medium text-status-danger-fg')} aria-live="polite">
          Choose up to {max}. {selected.length} chosen.
        </p>
      ) : null}
      {filterable ? (
        <Input
          type="search"
          inputSize={size === 'lg' ? 'lg' : 'default'}
          aria-label={`Filter choices for ${p.meta.label}`}
          className="max-w-sm"
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
        />
      ) : null}
      <div className={cn('grid gap-0.5', options.length > 6 && 'sm:grid-cols-2 sm:gap-x-6')}>
        {shown.map((o) => {
          const checked = selected.includes(o.value);
          return (
            <CheckboxField
              key={o.value}
              id={`${p.domId}-${o.value}`}
              label={o.label}
              size={size}
              checked={checked}
              disabled={locked || (!checked && max !== undefined && selected.length >= max)}
              onCheckedChange={(c) => toggle(o.value, c === true)}
              aria-invalid={p.error ? true : undefined}
            />
          );
        })}
      </div>
    </FieldSet>
  );
}

export function YesNoRenderer(p: FieldRendererProps) {
  const value = p.value === true ? 'yes' : p.value === false ? 'no' : '';
  const size = p.ctx.density === 'applicant' ? 'lg' : 'default';
  return (
    <FieldSet className="min-w-0" {...fieldSetProps(p)}>
      <RadioGroup
        value={value}
        onValueChange={(v) => p.onChange(v === 'yes' ? true : v === 'no' ? false : undefined)}
        disabled={p.disabled || p.readOnly}
        orientation="horizontal"
        className="flex flex-wrap gap-x-8"
        aria-required={p.required || undefined}
        aria-invalid={p.error ? true : undefined}
      >
        <RadioOption id={`${p.domId}-yes`} value="yes" label="Yes" size={size} />
        <RadioOption id={`${p.domId}-no`} value="no" label="No" size={size} />
      </RadioGroup>
    </FieldSet>
  );
}
