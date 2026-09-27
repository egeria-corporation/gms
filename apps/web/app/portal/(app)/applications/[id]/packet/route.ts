// SPDX-License-Identifier: AGPL-3.0-only
// H-03 Application packet PDF for the applicant ("Download a copy"): read under the applicant's own RLS, so
// only applications they can see are rendered; anything else is a 404.
import { renderPdf } from '@gms/pdf';
import { requireViewer } from '@/lib/auth';
import { applicationPacket, fileSafe, isUuid, pdfBrand } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { requireTenant } from '@/lib/tenant';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const tenant = await requireTenant();
  const { id } = await ctx.params;
  await requireViewer(`/portal/applications/${isUuid(id) ? id : ''}`);
  if (!isUuid(id)) return new Response('Not found', { status: 404 });
  const props = await rls((trx) => applicationPacket(trx, tenant, id));
  if (!props) return new Response('Not found', { status: 404 });
  const bytes = await renderPdf('application_packet', props, pdfBrand(tenant));
  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${fileSafe(props.referenceNumber)}-application.pdf"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
