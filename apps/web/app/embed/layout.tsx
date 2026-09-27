// SPDX-License-Identifier: AGPL-3.0-only
import { PoweredByFooter } from '@gms/ui';
import type { ReactNode } from 'react';
import { BrandStyle } from '@/lib/brand-style';
import { poweredBy } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

/** A-06 embed: minimal chrome, branded, framable (frame-ancestors * on /embed only). */
export default async function EmbedLayout({ children }: { children: ReactNode }) {
  const tenant = await requireTenant();
  return (
    <>
      <BrandStyle tenant={tenant} scope="branded" />
      <main id="main" className="grid gap-3 p-3">
        {children}
        <PoweredByFooter {...poweredBy()} />
      </main>
    </>
  );
}
