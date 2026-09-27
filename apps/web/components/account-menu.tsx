// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, PersonAvatar } from '@gms/ui';
import { Bot, LogOut, Settings, UserRound } from 'lucide-react';
import Link from 'next/link';

export function AccountMenu({ name, email, links }: { name: string; email: string; links?: { href: string; label: string }[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2" aria-label={`Account menu for ${name}`}>
          <PersonAvatar name={name} className="size-7" decorative />
          <span className="hidden max-w-40 truncate sm:inline">{name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="grid">
          <span className="truncate">{name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(links ?? [
          { href: '/portal/account', label: 'Account & notifications' },
          { href: '/portal/account/agents', label: 'Connected agents' },
        ]).map((l) => (
          <DropdownMenuItem key={l.href} asChild>
            <Link href={l.href}>
              {l.href.includes('agents') ? <Bot aria-hidden="true" /> : l.href.includes('console') ? <Settings aria-hidden="true" /> : <UserRound aria-hidden="true" />}
              {l.label}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <form action="/auth/sign-out" method="post">
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut aria-hidden="true" /> Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
