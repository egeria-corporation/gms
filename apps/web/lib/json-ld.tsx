// SPDX-License-Identifier: AGPL-3.0-or-later
// Structured data for search engines and agents. Content is JSON-serialized and '<' is escaped.
import type { PublicOpportunity } from './public-data';
import type { Tenant } from './tenant';

export function JsonLd({ data, nonce }: { data: unknown; nonce?: string }) {
  const json = JSON.stringify(data).replace(/</g, '\u003c');
  return <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: json }} />;
}

export function monetaryGrantLd(o: PublicOpportunity, tenant: Tenant) {
  return {
    '@context': 'https://schema.org',
    '@type': 'MonetaryGrant',
    '@id': `${tenant.origin}/opportunities/${o.slug}`,
    name: o.title,
    description: o.summary ?? undefined,
    url: `${tenant.origin}/opportunities/${o.slug}`,
    funder: { '@type': 'Organization', name: tenant.brand.displayName, url: tenant.origin },
    ...(o.fundingTotalCents ? { amount: { '@type': 'MonetaryAmount', currency: o.currency, value: o.fundingTotalCents / 100 } } : {}),
    ...(o.awardMaxCents
      ? {
          amount: {
            '@type': 'MonetaryAmount',
            currency: o.currency,
            ...(o.awardMinCents ? { minValue: o.awardMinCents / 100 } : {}),
            maxValue: o.awardMaxCents / 100,
          },
        }
      : {}),
    ...(o.opensAt ? { startDate: o.opensAt } : {}),
    ...(o.closesAt ? { endDate: o.closesAt } : {}),
    ...(o.causeTerms.length ? { keywords: o.causeTerms.join(', ') } : {}),
  };
}

