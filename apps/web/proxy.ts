// SPDX-License-Identifier: AGPL-3.0-only
// Runs before every request: resolves the tenant hint from the host, assigns a request id and a CSP nonce,
// and sets security headers. No database access here (see lib/tenant.ts for the DB lookup).
import { NextResponse, type NextRequest } from 'next/server';
import { config as gms, resolveHost } from './lib/config';

function buildCsp(nonce: string, pathname: string): string {
  const dev = process.env.NODE_ENV !== 'production';
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const embeddable = pathname.startsWith('/embed');
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Radix/Recharts set inline style attributes; styles cannot execute script.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    `connect-src 'self'${supabase ? ` ${supabase} ${supabase.replace(/^http/, 'ws')}` : ''}${dev ? ' ws:' : ''}`,
    `frame-src 'self'`,
    `frame-ancestors ${embeddable ? '*' : "'none'"}`,
    `form-action 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

/** Paths answered by @gms/agents' discovery dispatcher (see app/agent-discovery). */
function isDiscoveryPath(pathname: string, accept: string | null): boolean {
  if (/^\/\.well-known\/(?:oauth-protected-resource(?:\/.*)?|oauth-authorization-server|agent-card\.json|agent\.json)$/.test(pathname)) return true;
  if (pathname === '/llms.txt' || pathname === '/llms-full.txt' || pathname === '/agents.md') return true;
  if (/^\/opportunities\/[a-z0-9-]{1,80}\.md$/.test(pathname)) return true;
  // Content negotiation: an opportunity page requested as markdown.
  const a = (accept ?? '').toLowerCase();
  return /^\/opportunities\/[a-z0-9-]{1,80}$/.test(pathname) && a.includes('text/markdown') && !a.includes('text/html');
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const override = gms.devToolsEnabled
    ? (request.headers.get('x-gms-tenant') ?? request.cookies.get('gms_tenant')?.value ?? null)
    : null;
  const res = resolveHost(request.headers.get('host'), override);
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const requestId = request.headers.get('x-request-id')?.slice(0, 64) || crypto.randomUUID();

  const headers = new Headers(request.headers);
  // Never trust client-supplied internal headers.
  for (const h of ['x-gms-tenant-slug', 'x-gms-host-kind', 'x-gms-host', 'x-nonce', 'x-gms-pathname']) headers.delete(h);
  headers.set('x-gms-host-kind', res.kind);
  headers.set('x-gms-host', res.host);
  if (res.slug) headers.set('x-gms-tenant-slug', res.slug);
  headers.set('x-nonce', nonce);
  headers.set('x-request-id', requestId);
  headers.set('x-gms-pathname', pathname);

  // Root host (no tenant): serve platform pages (setup wizard, operator console, directory) from /gms-root.
  // Tenant hosts can never reach /gms-root directly.
  let response: NextResponse;
  if (pathname.startsWith('/gms-root')) {
    return new NextResponse('Not found', { status: 404 });
  }
  const rootPath = res.kind === 'root' || (gms.mode === 'single' && pathname.startsWith('/setup'));
  const passThrough = /^\/(?:_next|api\/storage|auth|fonts|brand)(?:\/|$)/.test(pathname) || pathname.includes('.');
  if (!rootPath && isDiscoveryPath(pathname, request.headers.get('accept'))) {
    // Agent discovery documents are served by one route handler; it rebuilds the public URL from x-gms-pathname.
    const url = request.nextUrl.clone();
    url.pathname = '/agent-discovery';
    response = NextResponse.rewrite(url, { request: { headers } });
    response.headers.set('Vary', 'Accept');
  } else if (rootPath && !passThrough) {
    const url = request.nextUrl.clone();
    url.pathname = `/gms-root${pathname === '/' ? '' : pathname}`;
    response = NextResponse.rewrite(url, { request: { headers } });
  } else {
    response = NextResponse.next({ request: { headers } });
  }
  response.headers.set('Content-Security-Policy', buildCsp(nonce, pathname));
  response.headers.set('X-Request-Id', requestId);
  if (!pathname.startsWith('/embed')) response.headers.set('X-Frame-Options', 'DENY');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|fonts/).*)'],
};
