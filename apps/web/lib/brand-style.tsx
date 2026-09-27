// SPDX-License-Identifier: AGPL-3.0-only
// Server-side injection of the tenant's resolved brand tokens as CSS variables.
import { brandCss } from '@gms/ui/theme';
import type { Tenant } from './tenant';
import { requestMeta } from './tenant';

export async function BrandStyle({ tenant, scope }: { tenant: Tenant; scope: 'branded' | 'console' }) {
  const { nonce } = await requestMeta();
  const css = brandCss(tenant.brand.resolved, { scope });
  return <style nonce={nonce} precedence="high" href={`brand-${tenant.id}-${tenant.brand.version}-${scope}`}>{css}</style>;
}
