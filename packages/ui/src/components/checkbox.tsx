// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { Check, Minus } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn } from '../lib/utils';

export function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer grid size-4.5 shrink-0 place-items-center rounded-[5px] border border-input bg-card shadow-soft',
        'transition-colors duration-150 ease-out',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        'data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="grid place-items-center">
        {props.checked === 'indeterminate' ? (
          <Minus className="size-3.5" strokeWidth={3} aria-hidden="true" />
        ) : (
          <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export interface CheckboxFieldProps extends Omit<React.ComponentProps<typeof CheckboxPrimitive.Root>, 'children'> {
  label: React.ReactNode;
  description?: React.ReactNode;
  /** 'lg' gives a 44px tap row for applicant and mobile screens. */
  size?: 'default' | 'lg';
}

/** Checkbox with its label and optional description; the whole row is the click target. */
export function CheckboxField({ label, description, size = 'default', id, className, ...props }: CheckboxFieldProps) {
  const auto = React.useId();
  const cid = id ?? `checkbox-${auto}`;
  const descId = description ? `${cid}-description` : undefined;
  return (
    <div className={cn('flex items-start gap-3', size === 'lg' ? 'min-h-11 py-2.5' : 'min-h-6 py-0.5', className)}>
      <Checkbox id={cid} aria-describedby={descId} className={size === 'lg' ? 'mt-0.5 size-5' : 'mt-0.5'} {...props} />
      <div className="grid gap-0.5">
        <label htmlFor={cid} className={cn('font-medium leading-snug', size === 'lg' ? 'text-base' : 'text-sm', 'peer-disabled:opacity-60')}>
          {label}
        </label>
        {description ? (
          <p id={descId} className="text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
