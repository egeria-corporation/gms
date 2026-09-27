// SPDX-License-Identifier: AGPL-3.0-only
// Serves the current tenant's logo / favicon from the `brand` storage bucket. Public (logos appear on the
// public site and in emails) and cached; the stored path changes on every upload, so the ETag does too.
import 'server-only';
import { getRuntime } from '@gms/actions';
import { getTenant } from '@/lib/tenant';

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon' };

export async function serveBrandAsset(req: Request, kind: 'logo' | 'favicon'): Promise<Response> {
  const tenant = await getTenant();
  const path = kind === 'logo' ? tenant?.brand.logoPath : (tenant?.brand.faviconPath ?? tenant?.brand.logoPath);
  // Only files uploaded for this workspace (brand.request_asset_upload keys them by workspace id).
  if (!tenant || !path || !path.startsWith(`${tenant.id}/`)) return new Response('Not found', { status: 404, headers: { 'cache-control': 'public, max-age=60' } });
  const type = TYPES[path.split('.').pop()?.toLowerCase() ?? ''];
  if (!type) return new Response('Not found', { status: 404 });
  const etag = `"${path.replace(/[^a-zA-Z0-9._-]/g, '')}"`;
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag } });
  const bytes = await getRuntime().adapters.storage.get('brand', path);
  if (!bytes) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': type,
      'cache-control': 'public, max-age=300, stale-while-revalidate=86400',
      etag,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'cross-origin-resource-policy': 'cross-origin',
    },
  });
}
