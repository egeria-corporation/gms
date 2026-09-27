// SPDX-License-Identifier: AGPL-3.0-only
import { getRuntime } from '@gms/actions';
import { NextResponse, type NextRequest } from 'next/server';
import { cookieJar } from '@/lib/auth';

export async function POST(req: NextRequest) {
  await getRuntime().adapters.auth.signOut(await cookieJar());
  return NextResponse.redirect(new URL('/', `${req.nextUrl.protocol}//${req.headers.get('host')}`), 303);
}
