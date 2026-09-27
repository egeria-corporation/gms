// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Button } from '@gms/ui';
import { Moon, Sun } from 'lucide-react';
import { ThemeProvider as NextThemes, useTheme } from 'next-themes';
import type { ReactNode } from 'react';

/** Follows the operating system until the person picks a theme. The nonce lets next-themes' pre-paint script run under the CSP. */
export function ThemeProvider({ children, nonce }: { children: ReactNode; nonce?: string }) {
  return (
    <NextThemes attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="gms-console-theme" nonce={nonce}>
      {children}
    </NextThemes>
  );
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  return (
    <Button variant="ghost" size="icon" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setTheme(dark ? 'light' : 'dark')}>
      {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
}
