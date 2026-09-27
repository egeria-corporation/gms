// SPDX-License-Identifier: AGPL-3.0-only
// H-02…H-05 PDF previews: renders a document with sample data and the workspace brand (or ?brand=preset).
// Route handlers don't get the /dev layout's production guard, so this checks devToolsEnabled itself.
import { PDF_DOCUMENT_KEYS, pdfDocuments, renderPdf, type PdfDocumentKey } from '@gms/pdf';
import { config } from '@/lib/config';
import { previewBrand } from '../../preview-brand';

export const dynamic = 'force-dynamic';

function isDocKey(v: string): v is PdfDocumentKey {
  return (PDF_DOCUMENT_KEYS as string[]).includes(v);
}

export async function GET(req: Request, ctx: { params: Promise<{ doc: string }> }) {
  if (!config.devToolsEnabled) return new Response('Not found', { status: 404 });
  const { doc } = await ctx.params;
  if (!isDocKey(doc)) return new Response('Not found', { status: 404 });
  const { brand } = await previewBrand(new URL(req.url).searchParams.get('brand') ?? undefined);
  const bytes = await renderPdf(doc, pdfDocuments[doc].previewProps, brand);
  const download = new URL(req.url).searchParams.get('download') === '1';
  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `${download ? 'attachment' : 'inline'}; filename="preview-${doc}.pdf"`,
      'cache-control': 'no-store',
    },
  });
}
