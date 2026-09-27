// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { CircleAlert } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/utils';
import { Label } from './label';

interface FieldContextValue {
  id: string;
  descriptionId: string | undefined;
  errorId: string | undefined;
  extraDescribedBy: string[];
  invalid: boolean;
  required: boolean;
}

const FieldContext = React.createContext<FieldContextValue | null>(null);

/** Props a form control should spread to be wired to its Field (id, aria-describedby, aria-invalid, required). */
export interface FieldControlProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
  required?: boolean;
  'aria-required'?: React.AriaAttributes['aria-required'];
}

/**
 * Reads the surrounding Field (if any) and merges its wiring with the control's own props.
 * Input, Textarea, Select and FileDropzone call this so they "just work" inside a Field.
 * `mode: 'aria'` sets aria-required instead of the native `required` (for button-based controls).
 */
export function useFieldControl<P extends FieldControlProps>(props: P, mode: 'native' | 'aria' = 'native'): P {
  const field = React.useContext(FieldContext);
  if (!field) return props;
  const describedBy = [field.errorId, field.descriptionId, ...field.extraDescribedBy, props['aria-describedby']]
    .filter(Boolean)
    .join(' ');
  const wired: P = {
    ...props,
    id: props.id ?? field.id,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': props['aria-invalid'] ?? (field.invalid || undefined),
  };
  if (mode === 'native') wired.required = props.required ?? (field.required || undefined);
  else wired['aria-required'] = props['aria-required'] ?? (field.required || undefined);
  return wired;
}

/** Lets a control register an extra description id (e.g. Textarea's word count). */
export function useFieldId(): string | undefined {
  return React.useContext(FieldContext)?.id;
}

export interface FieldProps extends Omit<React.ComponentProps<'div'>, 'children'> {
  /** Always visible. Never use placeholder text as the label. */
  label: React.ReactNode;
  /** Help text under the label. */
  description?: React.ReactNode;
  /** Error message; sets aria-invalid on the control and is announced via aria-describedby. */
  error?: React.ReactNode;
  /** Marks the field required (asterisk + "required" for screen readers). */
  required?: boolean;
  /** Shows "(Optional)" after the label. Use on applicant forms where most fields are required. */
  optional?: boolean;
  /** Control id. Defaults to a generated id. Use a stable id so ValidationSummary can link to "#id". */
  htmlFor?: string;
  /** Extra ids to add to the control's aria-describedby. */
  describedBy?: string[];
  labelClassName?: string;
  /** Visually hide the label (still read by screen readers). Use sparingly, e.g. table cell editors. */
  hideLabel?: boolean;
  children: React.ReactNode;
}

export function Field({
  label,
  description,
  error,
  required = false,
  optional = false,
  htmlFor,
  describedBy = [],
  className,
  labelClassName,
  hideLabel = false,
  children,
  ...props
}: FieldProps) {
  const auto = React.useId();
  const id = htmlFor ?? `field-${auto}`;
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedKey = describedBy.join(' ');
  const invalid = Boolean(error);
  const ctx = React.useMemo<FieldContextValue>(
    () => ({
      id,
      descriptionId,
      errorId,
      extraDescribedBy: describedKey ? describedKey.split(' ') : [],
      invalid,
      required,
    }),
    [id, descriptionId, errorId, describedKey, invalid, required],
  );
  return (
    <FieldContext.Provider value={ctx}>
      <div data-slot="field" data-invalid={error ? '' : undefined} className={cn('grid gap-1.5', className)} {...props}>
        <FieldLabel htmlFor={id} required={required} optional={optional} className={cn(hideLabel && 'sr-only', labelClassName)}>
          {label}
        </FieldLabel>
        {description ? (
          <p id={descriptionId} className="text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
        {error ? <FieldError id={errorId}>{error}</FieldError> : null}
        {children}
      </div>
    </FieldContext.Provider>
  );
}

function FieldLabel({
  required,
  optional,
  children,
  className,
  ...props
}: React.ComponentProps<typeof Label> & { required: boolean; optional: boolean }) {
  return (
    <Label className={className} {...props}>
      {children}
      {required ? (
        <>
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
          <span className="sr-only">(required)</span>
        </>
      ) : null}
      {optional && !required ? <span className="font-normal text-muted-foreground">(Optional)</span> : null}
    </Label>
  );
}

export function FieldError({ className, children, ...props }: React.ComponentProps<'p'>) {
  return (
    <p data-slot="field-error" className={cn('flex items-start gap-1.5 text-sm font-medium text-status-danger-fg', className)} {...props}>
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        <span className="sr-only">Error: </span>
        {children}
      </span>
    </p>
  );
}

export interface FieldSetProps extends Omit<React.ComponentProps<'fieldset'>, 'children'> {
  legend: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  optional?: boolean;
  /** Anchor id for ValidationSummary links (placed on the fieldset). */
  id?: string;
  children: React.ReactNode;
}

/** Groups related controls (radio groups, checkbox lists) under a visible legend. */
export function FieldSet({ legend, description, error, required, optional, id, className, children, ...props }: FieldSetProps) {
  const auto = React.useId();
  const base = id ?? `fieldset-${auto}`;
  const descriptionId = description ? `${base}-description` : undefined;
  const errorId = error ? `${base}-error` : undefined;
  return (
    <fieldset
      id={base}
      data-slot="fieldset"
      aria-describedby={[errorId, descriptionId].filter(Boolean).join(' ') || undefined}
      aria-invalid={error ? true : undefined}
      className={cn('grid gap-2', className)}
      {...props}
    >
      <legend className="mb-1 flex items-center gap-1 text-sm font-medium leading-none">
        {legend}
        {required ? (
          <>
            <span aria-hidden="true" className="text-destructive">
              *
            </span>
            <span className="sr-only">(required)</span>
          </>
        ) : null}
        {optional && !required ? <span className="font-normal text-muted-foreground">(Optional)</span> : null}
      </legend>
      {description ? (
        <p id={descriptionId} className="-mt-1 text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      {children}
    </fieldset>
  );
}
