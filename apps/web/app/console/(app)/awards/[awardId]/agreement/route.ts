// SPDX-License-Identifier: AGPL-3.0-or-later
// Streams the award's current agreement PDF for staff (access checked under RLS first).
import { getRuntime } from '@gms/actions';
import { AWARDS_READ } from '@/components/console/finance/params';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { requireTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ awardId: string }> }) {
  const [tenant] = await Promise.all([requireTenant(), requireStaff(AWARDS_READ)]);
  const { awardId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(awardId)) return new Response('Not found', { status: 404 });
  const g = await rls((trx) =>
    trx
      .selectFrom('agreements as g')
      .innerJoin('awards as a', 'a.id', 'g.award_id')
      .select(['g.document_path', 'g.document_hash', 'a.reference'])
      .where('g.award_id', '=', awardId)
      .where('a.workspace_id', '=', tenant.id)
      .where('g.status', '!=', 'void')
      .orderBy('g.created_at', 'desc')
      .executeTakeFirst(),
  );
  if (!g?.document_path) return new Response('Not found', { status: 404 });
  const bytes = await getRuntime().adapters.storage.get('agreements', g.document_path);
  if (!bytes) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="agreement-${g.reference.replace(/[^A-Za-z0-9-]/g, '')}.pdf"`,
      'cache-control': 'private, no-store',
      'x-document-sha256': g.document_hash ?? '',
    },
  });
}
