// SPDX-License-Identifier: AGPL-3.0-only
// RSS 2.0 feed of published opportunities.
import { formatMoney } from '@gms/domain';
import { listOpportunities } from '@/lib/public-data';
import { requireTenant } from '@/lib/tenant';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function GET() {
  const tenant = await requireTenant();
  const { items } = await listOpportunities(tenant, { pageSize: 50 });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${esc(`${tenant.brand.displayName} funding opportunities`)}</title>
<link>${esc(`${tenant.origin}/opportunities`)}</link>
<atom:link href="${esc(`${tenant.origin}/opportunities/feed.xml`)}" rel="self" type="application/rss+xml"/>
<description>${esc(`Current and upcoming grants from ${tenant.brand.displayName}.`)}</description>
${items
  .map(
    (o) => `<item>
<title>${esc(o.title)}</title>
<link>${esc(`${tenant.origin}/opportunities/${o.slug}`)}</link>
<guid isPermaLink="false">${esc(o.id)}</guid>
<pubDate>${new Date(o.publishedAt ?? o.lastModifiedAt).toUTCString()}</pubDate>
<category>${esc(o.status)}</category>
<description>${esc([o.summary ?? '', o.awardMaxCents ? `Awards up to ${formatMoney(o.awardMaxCents, o.currency, { compact: true })}.` : '', o.closesAt ? `Closes ${new Date(o.closesAt).toUTCString()}.` : ''].filter(Boolean).join(' '))}</description>
</item>`,
  )
  .join('\n')}
</channel>
</rss>`;
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}
