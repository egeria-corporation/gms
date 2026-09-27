// SPDX-License-Identifier: AGPL-3.0-only
import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import { Slot } from 'radix-ui';
import * as React from 'react';
import { cn } from '../lib/utils';

export const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium select-none',
    'transition-[color,background-color,border-color,box-shadow] duration-150 ease-out',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-soft hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground border border-border hover:bg-secondary/70',
        outline: 'border border-input bg-card text-foreground shadow-soft hover:bg-accent hover:text-accent-foreground',
        ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-destructive-foreground shadow-soft hover:bg-destructive/90',
        link: 'h-auto px-0 text-link underline underline-offset-4 hover:decoration-2',
      },
      size: {
        sm: 'h-8 px-3 text-[13px] has-[>svg]:px-2.5',
        default: 'h-9 px-4 has-[>svg]:px-3',
        lg: 'h-11 px-5 text-base has-[>svg]:px-4',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-lg': 'size-11',
      },
    },
    compoundVariants: [{ variant: 'link', className: 'h-auto px-0 has-[>svg]:px-0' }],
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a link) with button styles. */
  asChild?: boolean;
  /** Shows a spinner, sets aria-busy and disables the button. */
  pending?: boolean;
  /** Text announced/shown while pending, e.g. "Saving…". Defaults to the children. */
  pendingLabel?: React.ReactNode;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  pending = false,
  pendingLabel,
  disabled,
  children,
  type,
  ...props
}: ButtonProps) {
  if (asChild) {
    return (
      <Slot.Root data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      data-slot="button"
      type={type ?? 'button'}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending ? (
        <>
          <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {pendingLabel ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
