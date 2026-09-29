// SPDX-License-Identifier: AGPL-3.0-or-later
// R-07: streams the generated agreement PDF (the exact bytes the grantee signs) for inline preview on the
// console agreement page. Staff only; the agreement row is read under RLS first.
import { getRuntime } from '@gms/actions';
import { requireStaff } from '@/lib/auth';
import { fileSafe, isUuid } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { requireTenant } from '@/lib/tenant';

// Shown in an iframe on the (same-origin) agreement page. NOTE: proxy.ts currently overwrites these with
// X-Frame-Options: DENY / frame-ancestors 'none'; it needs a same-origin exception for this path.
const FRAMEABLE = { 'x-frame-options': 'SAMEORIGIN', 'content-security-policy': "frame-ancestors 'self'" };

export async function GET(_req: Request, ctx: { params: Promise<{ applicationId: string }> }) {
  const tenant = await requireTenant();
  await requireStaff();
  const { applicationId } = await ctx.params;
  if (!isUuid(applicationId)) return new Response('Not found', { status: 404, headers: FRAMEABLE });
  const g = await rls((trx) =>
    trx
      .selectFrom('agreements as g')
      .innerJoin('awards as a', 'a.id', 'g.award_id')
      .select(['g.document_path', 'g.document_hash', 'a.reference'])
      .where('a.application_id', '=', applicationId)
      .where('a.kind', '=', 'original')
      .where('a.workspace_id', '=', tenant.id)
      .where('g.status', '!=', 'void')
      .orderBy('g.created_at', 'desc')
      .executeTakeFirst(),
  );
  if (!g?.document_path) return new Response('Not found', { status: 404, headers: FRAMEABLE });
  const bytes = await getRuntime().adapters.storage.get('agreements', g.document_path);
  if (!bytes) return new Response('Not found', { status: 404, headers: FRAMEABLE });
  const name = `grant-agreement-${fileSafe(g.reference)}.pdf`;
  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${name}"`,
      'cache-control': 'private, no-store',
      'x-document-sha256': g.document_hash ?? '',
      ...FRAMEABLE,
    },
  });
}
