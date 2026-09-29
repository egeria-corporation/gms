// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ReactNode } from 'react';
import { BrandStyle } from '@/lib/brand-style';
import { requestMeta, requireTenant } from '@/lib/tenant';
import { ThemeProvider } from '@/components/console/theme';

/** The console takes only the logo, accent, focus ring and favicon from the brand; it has light and dark themes. */
export default async function ConsoleRoot({ children }: { children: ReactNode }) {
  const [tenant, meta] = await Promise.all([requireTenant(), requestMeta()]);
  return (
    <ThemeProvider nonce={meta.nonce}>
      <BrandStyle tenant={tenant} scope="console" />
      {children}
    </ThemeProvider>
  );
}
