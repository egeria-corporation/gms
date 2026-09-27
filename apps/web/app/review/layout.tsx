// SPDX-License-Identifier: AGPL-3.0-only
// Reviewer workspace root: tenant + branded tokens. The member/role/TOTP guard lives in (app)/layout.tsx so
// that /review/denied (where non-reviewers are sent) is reachable without it.
import type { ReactNode } from 'react';
import { BrandStyle } from '@/lib/brand-style';
import { requireTenant } from '@/lib/tenant';

export default async function ReviewRootLayout({ children }: { children: ReactNode }) {
  const tenant = await requireTenant();
  return (
    <>
      <BrandStyle tenant={tenant} scope="branded" />
      {children}
    </>
  );
}
