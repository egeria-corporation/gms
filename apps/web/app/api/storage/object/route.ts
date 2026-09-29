// SPDX-License-Identifier: AGPL-3.0-or-later
// Signed-URL endpoint for the local-filesystem storage adapter (tier 3 / development).
// Supabase Storage issues its own signed URLs, so this route is only used with LocalStorage.
import { getRuntime } from '@gms/actions';
import { verifyStorageToken } from '@gms/adapters';
import type { NextRequest } from 'next/server';

function problem(status: number, detail: string) {
  return Response.json({ type: 'about:blank', title: 'Storage error', status, detail }, { status, headers: { 'content-type': 'application/problem+json' } });
}

export async function GET(req: NextRequest) {
  const p = verifyStorageToken(req.nextUrl.searchParams.get('token') ?? '');
  if (!p || p.op !== 'get') return problem(403, 'This link is invalid or has expired.');
  const storage = getRuntime().adapters.storage;
  const [bytes, head] = await Promise.all([storage.get(p.b, p.k), storage.head(p.b, p.k)]);
  if (!bytes) return problem(404, 'File not found.');
  const name = (p.fn ?? p.k.split('/').pop() ?? 'file').replace(/["\\r\n]/g, '_');
  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': head?.contentType ?? 'application/octet-stream',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function PUT(req: NextRequest) {
  const p = verifyStorageToken(req.nextUrl.searchParams.get('token') ?? '');
  if (!p || p.op !== 'put') return problem(403, 'This upload link is invalid or has expired.');
  const ct = req.headers.get('content-type') ?? '';
  if (p.ct && ct.split(';')[0] !== p.ct) return problem(415, `Expected ${p.ct}.`);
  const len = Number(req.headers.get('content-length') ?? 0);
  if (p.max && len > p.max) return problem(413, 'File is larger than allowed.');
  const body = new Uint8Array(await req.arrayBuffer());
  if (p.max && body.byteLength > p.max) return problem(413, 'File is larger than allowed.');
  await getRuntime().adapters.storage.put(p.b, p.k, body, p.ct ?? 'application/octet-stream');
  return new Response(null, { status: 204 });
}
