// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn } from '../lib/utils';

export function RadioGroup({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root data-slot="radio-group" className={cn('grid gap-1', className)} {...props} />;
}

export function RadioGroupItem({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        'peer grid aspect-square size-4.5 shrink-0 place-items-center rounded-full border border-input bg-card shadow-soft',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-[state=checked]:border-primary',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="grid place-items-center">
        <span className="size-2.5 rounded-full bg-primary" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

export interface RadioOptionProps extends Omit<React.ComponentProps<typeof RadioGroupPrimitive.Item>, 'children'> {
  label: React.ReactNode;
  description?: React.ReactNode;
  size?: 'default' | 'lg';
}

/** A radio with its visible label and optional hint; the whole row is clickable. */
export function RadioOption({ label, description, size = 'default', id, className, ...props }: RadioOptionProps) {
  const auto = React.useId();
  const rid = id ?? `radio-${auto}`;
  const descId = description ? `${rid}-description` : undefined;
  return (
    <div className={cn('flex items-start gap-3', size === 'lg' ? 'min-h-11 py-2.5' : 'min-h-6 py-0.5', className)}>
      <RadioGroupItem id={rid} aria-describedby={descId} className={size === 'lg' ? 'mt-0.5 size-5' : 'mt-0.5'} {...props} />
      <div className="grid gap-0.5">
        <label htmlFor={rid} className={cn('font-medium leading-snug', size === 'lg' ? 'text-base' : 'text-sm')}>
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
