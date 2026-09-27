// SPDX-License-Identifier: AGPL-3.0-only
import { Toaster } from '@gms/ui';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { getTenant } from '@/lib/tenant';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTenant();
  return {
    title: { default: t ? `${t.brand.displayName} grants` : 'GMS', template: t ? `%s · ${t.brand.displayName}` : '%s · GMS' },
    description: t ? `Funding opportunities from ${t.brand.displayName}.` : 'GMS — open-source grants management.',
    icons: t?.brand.faviconPath ? { icon: '/brand/favicon' } : undefined,
    metadataBase: t ? new URL(t.origin) : undefined,
    alternates: { types: { 'text/markdown': '/llms.txt' } },
  };
}

export const viewport: Viewport = { themeColor: '#ffffff', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
