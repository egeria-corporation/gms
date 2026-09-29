// SPDX-License-Identifier: AGPL-3.0-or-later
import type { MetadataRoute } from 'next';
import { listOpportunities } from '@/lib/public-data';
import { getTenant } from '@/lib/tenant';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const tenant = await getTenant();
  if (!tenant) return [];
  const { items } = await listOpportunities(tenant, { pageSize: 50 });
  const base = tenant.origin;
  return [
    { url: `${base}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/opportunities`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/awards`, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${base}/for-agents`, changeFrequency: 'monthly', priority: 0.4 },
    ...items.map((o) => ({ url: `${base}/opportunities/${o.slug}`, lastModified: o.lastModifiedAt, changeFrequency: 'weekly' as const, priority: o.status === 'open' ? 0.9 : 0.6 })),
  ];
}
