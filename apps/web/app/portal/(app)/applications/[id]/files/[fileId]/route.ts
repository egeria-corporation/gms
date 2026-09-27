// SPDX-License-Identifier: AGPL-3.0-only
// Download an application attachment the signed-in person can see (checked under RLS first).
import { getRuntime } from '@gms/actions';
import { rls } from '@/lib/server/db';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await ctx.params;
  const att = await rls((trx) =>
    trx.selectFrom('attachments').select(['storage_path', 'file_name', 'content_type', 'scan_status', 'status']).where('id', '=', fileId).where('application_id', '=', id).executeTakeFirst(),
  );
  if (!att || att.status === 'deleted' || att.scan_status === 'infected') return new Response('Not found', { status: 404 });
  const bytes = await getRuntime().adapters.storage.get('applications', att.storage_path);
  if (!bytes) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': att.content_type,
      'content-disposition': `attachment; filename="${att.file_name.replace(/["\\r\n]/g, '_')}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
