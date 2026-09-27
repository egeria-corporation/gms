// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Tabs as TabsPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn } from '../lib/utils';

export function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-4', className)} {...props} />;
}

/** 'underline' for page-level sections; 'pill' for compact in-card switches. */
export function TabsList({
  className,
  variant = 'underline',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & { variant?: 'underline' | 'pill' }) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(
        'group/tabs inline-flex items-center text-muted-foreground',
        variant === 'underline' && 'w-full gap-4 overflow-x-auto border-b',
        variant === 'pill' && 'w-fit gap-1 rounded-md bg-muted p-1',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex min-h-8 items-center justify-center gap-1.5 whitespace-nowrap text-sm font-medium transition-colors duration-150 ease-out',
        'hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4',
        'group-data-[variant=underline]/tabs:-mb-px group-data-[variant=underline]/tabs:border-b-2 group-data-[variant=underline]/tabs:border-transparent group-data-[variant=underline]/tabs:px-0.5 group-data-[variant=underline]/tabs:pb-2',
        'group-data-[variant=underline]/tabs:data-[state=active]:border-primary group-data-[variant=underline]/tabs:data-[state=active]:text-foreground',
        'group-data-[variant=pill]/tabs:rounded-sm group-data-[variant=pill]/tabs:px-3 group-data-[variant=pill]/tabs:data-[state=active]:bg-card group-data-[variant=pill]/tabs:data-[state=active]:text-foreground group-data-[variant=pill]/tabs:data-[state=active]:shadow-soft',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('outline-none', className)} {...props} />;
}
