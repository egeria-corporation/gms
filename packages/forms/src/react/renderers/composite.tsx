// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { CheckboxField, cn, Field, FieldError, FieldSet, Input } from '@gms/ui';
import * as React from 'react';
import { isPlainObject } from '../../util';
import { partDomId, partError } from '../form-state';
import { Markdown } from '../markdown-view';
import { inputSize } from './basic';
import type { FieldRendererProps } from './types';

function objectValue(v: unknown): Record<string, unknown> {
  return isPlainObject(v) ? v : {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Sets one part of an object answer; an all-blank object clears the answer. */
function withPart(value: unknown, key: string, next: unknown): Record<string, unknown> | undefined {
  const obj = { ...objectValue(value) };
  if (next === undefined || next === '') delete obj[key];
  else obj[key] = next;
  return Object.keys(obj).length ? obj : undefined;
}

interface PartSpec {
  key: string;
  label: string;
  autoComplete?: string;
  className?: string;
  required?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}

function Parts({ p, parts, className }: { p: FieldRendererProps; parts: PartSpec[]; className?: string }) {
  const value = objectValue(p.value);
  return (
    <div className={cn('grid gap-3', className)}>
      {parts.map((part) => (
        <Field
          key={part.key}
          label={part.label}
          htmlFor={partDomId(p.fieldId, [part.key], p.ctx.idPrefix)}
          error={partError(p.errors, p.fieldId, [part.key])}
          required={p.required && part.required !== false}
          optional={part.required === false && p.ctx.density === 'applicant'}
          className={part.className}
          labelClassName="font-normal"
        >
          <Input
            inputSize={inputSize(p)}
            autoComplete={part.autoComplete}
            inputMode={part.inputMode}
            value={str(value[part.key])}
            disabled={p.disabled}
            readOnly={p.readOnly}
            onChange={(e) => p.onChange(withPart(p.value, part.key, e.currentTarget.value))}
          />
        </Field>
      ))}
    </div>
  );
}

function compositeFieldSet(p: FieldRendererProps) {
  return {
    id: p.domId,
    legend: p.meta.label,
    description: p.meta.help,
    error: p.error,
    required: p.required,
    optional: !p.required && p.ctx.density === 'applicant',
  };
}

export function NameRenderer(p: FieldRendererProps) {
  return (
    <FieldSet {...compositeFieldSet(p)}>
      <Parts
        p={p}
        className="sm:grid-cols-2"
        parts={[
          { key: 'first', label: 'First name', autoComplete: 'given-name' },
          { key: 'last', label: 'Last name', autoComplete: 'family-name' },
        ]}
      />
    </FieldSet>
  );
}

export function AddressRenderer(p: FieldRendererProps) {
  return (
    <FieldSet {...compositeFieldSet(p)}>
      <Parts
        p={p}
        className="sm:grid-cols-6"
        parts={[
          { key: 'line1', label: 'Street address', autoComplete: 'address-line1', className: 'sm:col-span-6' },
          { key: 'line2', label: 'Apartment, suite, or unit', autoComplete: 'address-line2', className: 'sm:col-span-6', required: false },
          { key: 'city', label: 'City', autoComplete: 'address-level2', className: 'sm:col-span-3' },
          { key: 'state', label: 'State', autoComplete: 'address-level1', className: 'sm:col-span-1' },
          { key: 'postal', label: 'ZIP code', autoComplete: 'postal-code', inputMode: 'numeric', className: 'sm:col-span-2' },
          { key: 'county', label: 'County', className: 'sm:col-span-3', required: false },
        ]}
      />
    </FieldSet>
  );
}

export function AttestationRenderer(p: FieldRendererProps) {
  const value = objectValue(p.value);
  const statement = p.meta.statement ?? (typeof p.options.statement === 'string' ? p.options.statement : '');
  const requireName = p.options.requireName !== false && (p.schema.properties?.name !== undefined || p.options.requireName === true);
  const statementId = `${p.domId}-statement`;
  const agreedError = partError(p.errors, p.fieldId, ['agreed']);
  const nameId = partDomId(p.fieldId, ['name'], p.ctx.idPrefix);
  const size = p.ctx.density === 'applicant' ? 'lg' : 'default';
  const locked = p.disabled || p.readOnly;
  return (
    <FieldSet {...compositeFieldSet(p)} description={undefined}>
      {p.meta.help ? <p className="-mt-1 text-sm text-muted-foreground">{p.meta.help}</p> : null}
      <div id={statementId} className="rounded-md border bg-muted/40 p-4">
        <Markdown source={statement} className="text-foreground" />
      </div>
      {agreedError ? <FieldError id={`${partDomId(p.fieldId, ['agreed'], p.ctx.idPrefix)}-error`}>{agreedError}</FieldError> : null}
      <CheckboxField
        id={partDomId(p.fieldId, ['agreed'], p.ctx.idPrefix)}
        size={size}
        label="I confirm this statement is true"
        checked={value.agreed === true}
        disabled={locked}
        aria-invalid={agreedError ? true : undefined}
        aria-describedby={[statementId, agreedError ? `${partDomId(p.fieldId, ['agreed'], p.ctx.idPrefix)}-error` : undefined].filter(Boolean).join(' ')}
        onCheckedChange={(c) => p.onChange(withPart(p.value, 'agreed', c === true ? true : undefined))}
      />
      {requireName ? (
        <Field
          label="Type your full name to sign"
          description="This counts as your signature."
          htmlFor={nameId}
          error={partError(p.errors, p.fieldId, ['name'])}
          required={p.required}
          className="max-w-md"
        >
          <Input
            inputSize={inputSize(p)}
            autoComplete="name"
            value={str(value.name)}
            disabled={locked}
            readOnly={p.readOnly}
            onChange={(e) => p.onChange(withPart(p.value, 'name', e.currentTarget.value))}
          />
        </Field>
      ) : null}
    </FieldSet>
  );
}
