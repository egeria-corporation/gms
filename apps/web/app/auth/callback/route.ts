// SPDX-License-Identifier: AGPL-3.0-or-later
// Magic-link landing: exchanges the one-time token for a session cookie, then continues to `next`.
import { getRuntime } from '@gms/actions';
import { NextResponse, type NextRequest } from 'next/server';
import { cookieJar } from '@/lib/auth';

/** Only same-site relative paths; never protocol-relative ("//evil") or backslash tricks. */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/portal';
  return next;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const session = await getRuntime().adapters.auth.handleCallback(params, await cookieJar());
  const base = `${req.nextUrl.protocol}//${req.headers.get('host')}`;
  if (!session) return NextResponse.redirect(new URL('/portal/sign-in?error=expired', base));
  return NextResponse.redirect(new URL(safeNext(params.get('next')), base));
}
