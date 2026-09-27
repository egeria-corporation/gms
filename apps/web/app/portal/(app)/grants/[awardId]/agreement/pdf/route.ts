// SPDX-License-Identifier: AGPL-3.0-only
// Streams the exact agreement PDF the grantee signs (access checked under RLS first).
import { getRuntime } from '@gms/actions';
import { rls } from '@/lib/server/db';

export async function GET(_req: Request, ctx: { params: Promise<{ awardId: string }> }) {
  const { awardId } = await ctx.params;
  const g = await rls((trx) => trx.selectFrom('agreements').select(['document_path', 'document_hash']).where('award_id', '=', awardId).where('status', '!=', 'void').orderBy('created_at', 'desc').executeTakeFirst());
  if (!g?.document_path) return new Response('Not found', { status: 404 });
  const bytes = await getRuntime().adapters.storage.get('agreements', g.document_path);
  if (!bytes) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(bytes), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="grant-agreement.pdf"`, 'cache-control': 'private, no-store', 'x-document-sha256': g.document_hash ?? '' },
  });
}
