// SPDX-License-Identifier: AGPL-3.0-only
// Tenant resolution: the proxy sets x-gms-host-kind / x-gms-tenant-slug / x-gms-host; this module looks the
// workspace up (slug or custom domain) and caches it briefly.
import 'server-only';
import { getRuntime, originFor } from '@gms/actions';
import { resolveBrand, type ResolvedBrand } from '@gms/ui/theme';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { config, tenantOrigin } from './config';

export interface TenantBrand {
  displayName: string;
  primaryColor: string;
  accentColor: string;
  headingFont: string;
  logoPath: string | null;
  faviconPath: string | null;
  version: number;
  resolved: ResolvedBrand;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  status: string;
  aboutMd: string | null;
  publicContactEmail: string | null;
  origin: string;
  brand: TenantBrand;
  flags: Record<string, boolean>;
}

const ttlCache = new Map<string, { at: number; tenant: Tenant | null }>();
const TTL_MS = 15_000;

export function invalidateTenantCache(): void {
  ttlCache.clear();
}

async function load(key: { slug?: string; host?: string }): Promise<Tenant | null> {
  const cacheKey = key.slug ? `s:${key.slug}` : `h:${key.host}`;
  const hit = ttlCache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.tenant;
  const db = getRuntime().db;
  let q = db
    .selectFrom('workspaces as w')
    .innerJoin('workspace_brand as b', 'b.workspace_id', 'w.id')
    .select([
      'w.id',
      'w.slug',
      'w.name',
      'w.timezone',
      'w.status',
      'w.about_md',
      'w.public_contact_email',
      'w.feature_flags',
      'b.display_name',
      'b.primary_color',
      'b.accent_color',
      'b.heading_font',
      'b.logo_path',
      'b.favicon_path',
      'b.version',
    ]);
  let customDomain: string | null = null;
  if (key.slug) q = q.where('w.slug', '=', key.slug);
  else {
    customDomain = key.host ?? null;
    q = q.where('w.id', 'in', (eb) => eb.selectFrom('workspace_domains').select('workspace_id').where('hostname', '=', key.host ?? '').where('verified_at', 'is not', null));
  }
  const row = await q.executeTakeFirst();
  const tenant: Tenant | null = row
    ? {
        id: row.id,
        slug: row.slug,
        name: row.name,
        timezone: row.timezone,
        status: row.status,
        aboutMd: row.about_md,
        publicContactEmail: row.public_contact_email,
        origin: customDomain ? tenantOrigin(null, customDomain) : originFor(row.slug),
        flags: (row.feature_flags ?? {}) as Record<string, boolean>,
        brand: {
          displayName: row.display_name,
          primaryColor: row.primary_color,
          accentColor: row.accent_color,
          headingFont: row.heading_font,
          logoPath: row.logo_path,
          faviconPath: row.favicon_path,
          version: row.version,
          resolved: resolveBrand({ primary: row.primary_color, accent: row.accent_color, headingFont: row.heading_font }),
        },
      }
    : null;
  ttlCache.set(cacheKey, { at: Date.now(), tenant });
  return tenant;
}

/** The tenant for this request, or null on the root host / unknown host. */
export const getTenant = cache(async (): Promise<Tenant | null> => {
  const h = await headers();
  const kind = h.get('x-gms-host-kind');
  if (kind === 'tenant-slug') return load({ slug: h.get('x-gms-tenant-slug') ?? config.defaultTenant });
  if (kind === 'custom-domain') return load({ host: h.get('x-gms-host') ?? '' });
  return null;
});

export async function requireTenant(): Promise<Tenant> {
  const t = await getTenant();
  if (!t || t.status !== 'active') notFound();
  return t;
}

export const requestMeta = cache(async () => {
  const h = await headers();
  return {
    requestId: h.get('x-request-id') ?? crypto.randomUUID(),
    nonce: h.get('x-nonce') ?? undefined,
    pathname: h.get('x-gms-pathname') ?? '/',
    ip: (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || h.get('x-real-ip') || null,
    userAgent: h.get('user-agent'),
    hostKind: h.get('x-gms-host-kind') ?? 'root',
  };
});
