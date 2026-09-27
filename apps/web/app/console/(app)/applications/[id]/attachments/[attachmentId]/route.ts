// SPDX-License-Identifier: AGPL-3.0-only
// Streams one application attachment to staff. Access is checked under RLS (the attachment row must be
// visible to the viewer, in this workspace, on this application); infected files are refused.
import { getRuntime } from '@gms/actions';
import { requireStaff } from '@/lib/auth';
import { isUuid } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { requireTenant } from '@/lib/tenant';

function asciiName(name: string): string {
  return name.replace(/[^\x20-\x7e]+/g, '_').replace(/["\\]/g, '_').slice(0, 150) || 'attachment';
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; attachmentId: string }> }) {
  const [tenant] = await Promise.all([requireTenant(), requireStaff()]);
  const { id, attachmentId } = await ctx.params;
  if (!isUuid(id) || !isUuid(attachmentId)) return new Response('Not found', { status: 404 });
  const att = await rls((trx) =>
    trx
      .selectFrom('attachments')
      .select(['file_name', 'content_type', 'storage_path', 'scan_status', 'status'])
      .where('id', '=', attachmentId)
      .where('application_id', '=', id)
      .where('workspace_id', '=', tenant.id)
      .where('status', '!=', 'deleted')
      .executeTakeFirst(),
  );
  if (!att) return new Response('Not found', { status: 404 });
  if (att.scan_status === 'infected') return new Response('This file failed the virus scan and cannot be downloaded.', { status: 403 });
  const bytes = await getRuntime().adapters.storage.get('applications', att.storage_path);
  if (!bytes) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': att.content_type || 'application/octet-stream',
      'content-disposition': `attachment; filename="${asciiName(att.file_name)}"; filename*=UTF-8''${encodeURIComponent(att.file_name)}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
