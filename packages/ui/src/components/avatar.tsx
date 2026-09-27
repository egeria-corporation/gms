// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Avatar as AvatarPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn, initials } from '../lib/utils';

export function Avatar({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return <AvatarPrimitive.Root data-slot="avatar" className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full', className)} {...props} />;
}

export function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return <AvatarPrimitive.Image data-slot="avatar-image" className={cn('aspect-square size-full object-cover', className)} {...props} />;
}

export function AvatarFallback({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn('flex size-full items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground', className)}
      {...props}
    />
  );
}

/** Avatar with initials fallback. The name is exposed as the image alt / to screen readers. */
export function PersonAvatar({
  name,
  src,
  className,
  decorative = false,
}: {
  name: string;
  src?: string | null;
  className?: string;
  /** Set when the name is already shown next to the avatar. */
  decorative?: boolean;
}) {
  return (
    <Avatar className={className} aria-hidden={decorative || undefined}>
      {src ? <AvatarImage src={src} alt={decorative ? '' : name} /> : null}
      <AvatarFallback>
        <span aria-hidden="true">{initials(name)}</span>
        {decorative ? null : <span className="sr-only">{name}</span>}
      </AvatarFallback>
    </Avatar>
  );
}
