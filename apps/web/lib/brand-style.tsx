// SPDX-License-Identifier: AGPL-3.0-or-later
// Server-side injection of the tenant's resolved brand tokens as CSS variables.
import { brandCss } from '@gms/ui/theme';
import type { Tenant } from './tenant';
import { requestMeta } from './tenant';

export async function BrandStyle({ tenant, scope }: { tenant: Tenant; scope: 'branded' | 'console' }) {
  const { nonce } = await requestMeta();
  const css = brandCss(tenant.brand.resolved, { scope });
  // A plain nonce'd <style> (React warns when `precedence` hoisting is combined with a nonce). It renders after
  // the app stylesheet, so the tenant tokens win over the defaults at equal specificity.
  return <style nonce={nonce} data-brand={`${tenant.id}-${tenant.brand.version}-${scope}`}>{css}</style>;
}
