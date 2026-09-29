// SPDX-License-Identifier: AGPL-3.0-or-later
import * as React from 'react';
import { cn } from '../lib/utils';

export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card" className={cn('flex flex-col rounded-lg border bg-card text-card-foreground shadow-soft', className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn('grid auto-rows-min grid-cols-1 items-start gap-1 px-5 pt-5 has-[[data-slot=card-action]]:grid-cols-[1fr_auto] has-[[data-slot=card-action]]:gap-x-4', className)}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  as: Heading = 'h3',
  ...props
}: React.ComponentProps<'h3'> & { as?: 'h2' | 'h3' | 'h4' }) {
  return <Heading data-slot="card-title" className={cn('col-start-1 font-heading text-base leading-tight font-semibold', className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p data-slot="card-description" className={cn('col-start-1 text-sm text-muted-foreground', className)} {...props} />;
}

export function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-action" className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-5 py-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-footer" className={cn('flex items-center gap-2 border-t px-5 py-3', className)} {...props} />;
}
