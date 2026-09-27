// SPDX-License-Identifier: AGPL-3.0-only
import type { MetadataRoute } from 'next';
import { getTenant } from '@/lib/tenant';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const tenant = await getTenant();
  return {
    rules: [{ userAgent: '*', allow: ['/', '/opportunities', '/awards', '/for-agents', '/llms.txt', '/agents.md'], disallow: ['/portal', '/console', '/review', '/board', '/dev', '/api', '/oauth'] }],
    ...(tenant ? { sitemap: `${tenant.origin}/sitemap.xml` } : {}),
  };
}
