// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import * as React from 'react';
import { cn } from '../lib/utils';
import { useFieldControl } from './field';

export const controlClasses = [
  'w-full min-w-0 rounded-md border border-input bg-card text-foreground shadow-soft',
  'transition-[border-color,box-shadow] duration-150 ease-out',
  'placeholder:text-muted-foreground',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:border-ring',
  'disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70',
  'aria-invalid:border-destructive aria-invalid:focus-visible:outline-destructive',
].join(' ');

export interface InputProps extends React.ComponentProps<'input'> {
  /** 'lg' is 44px tall for applicant and mobile forms. */
  inputSize?: 'sm' | 'default' | 'lg';
}

export function Input({ className, type = 'text', inputSize = 'default', ...props }: InputProps) {
  const wired = useFieldControl(props);
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        controlClasses,
        inputSize === 'sm' && 'h-8 px-2.5 text-[13px]',
        inputSize === 'default' && 'h-9 px-3 text-sm',
        inputSize === 'lg' && 'h-11 px-3.5 text-base',
        'file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium',
        (type === 'number' || props.inputMode === 'decimal' || props.inputMode === 'numeric') && 'tabular-nums',
        className,
      )}
      {...wired}
    />
  );
}
