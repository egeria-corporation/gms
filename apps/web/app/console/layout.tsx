// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { BrandStyle } from '@/lib/brand-style';
import { requireTenant } from '@/lib/tenant';
import { ThemeProvider } from '@/components/console/theme';

/** The console takes only the logo, accent, focus ring and favicon from the brand; it has light and dark themes. */
export default async function ConsoleRoot({ children }: { children: ReactNode }) {
  const tenant = await requireTenant();
  return (
    <ThemeProvider>
      <BrandStyle tenant={tenant} scope="console" />
      {children}
    </ThemeProvider>
  );
}
