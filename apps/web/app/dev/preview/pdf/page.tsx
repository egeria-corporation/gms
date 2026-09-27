// SPDX-License-Identifier: AGPL-3.0-only
// H-02…H-05 PDF previews: index of every generated document with open/download links and an embedded viewer.
import { PDF_DOCUMENT_KEYS, pdfDocuments } from '@gms/pdf';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  PageHeader,
} from '@gms/ui';
import { Download, ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';
import { one } from '@/lib/site';
import { BrandSwitcher } from '../brand-switcher';
import { isPreset, previewBrand } from '../preview-brand';

export const metadata: Metadata = { title: 'PDF previews' };
export const dynamic = 'force-dynamic';

const DESCRIPTIONS: Record<string, string> = {
  award_letter: 'Sent with the award notice: amount, terms, payment schedule and reporting requirements.',
  agreement: 'The document the grantee signs; its SHA-256 hash pins each signature to this exact version.',
  application_packet:
    'Everything an applicant submitted, with eligibility results and attachments, for reviewers and the file.',
  remittance: 'What a payee receives when a payment is sent: amount, reference and the awards it covers.',
  board_book: 'Docket summary with each recommendation and staff notes, for board meetings.',
};

export default async function PdfPreviewIndex({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const requested = one((await searchParams).brand);
  const { choice, hasWorkspace } = await previewBrand(requested);
  const q = isPreset(requested) ? `brand=${requested}` : '';
  const href = (doc: string, extra?: string) => {
    const s = [q, extra].filter(Boolean).join('&');
    return `/dev/preview/pdf/${doc}${s ? `?${s}` : ''}`;
  };

  return (
    <>
      <PageHeader
        title="PDF previews"
        description="Generated documents rendered with sample data. Each link renders a fresh PDF."
        breadcrumbs={[{ label: 'Screen catalog', href: '/dev/catalog' }, { label: 'PDF previews' }]}
      />
      <BrandSwitcher
        current={choice}
        hasWorkspace={hasWorkspace}
        hrefFor={(c) => (c === 'workspace' ? '/dev/preview/pdf' : `/dev/preview/pdf?brand=${c}`)}
      />
      <Alert variant="info" title="About the embedded viewers">
        The app&rsquo;s security headers forbid framing any page (frame-ancestors &lsquo;none&rsquo;), so the
        embedded viewer only works once proxy.ts allows same-origin framing for /dev/preview/pdf. Use
        &ldquo;Open PDF&rdquo; otherwise.
      </Alert>
      <ul className="grid gap-4">
        {PDF_DOCUMENT_KEYS.map((doc) => {
          const def = pdfDocuments[doc];
          return (
            <li key={doc}>
              <Card>
                <CardHeader>
                  <CardTitle as="h2" className="flex flex-wrap items-center gap-2">
                    {def.name}
                    <Badge variant="outline">{def.spec}</Badge>
                  </CardTitle>
                  <CardDescription>{DESCRIPTIONS[doc] ?? 'Generated document.'}</CardDescription>
                </CardHeader>
                <CardContent>
                  <details>
                    <summary className="w-fit cursor-pointer rounded-sm text-sm font-medium text-muted-foreground hover:text-foreground">
                      Show embedded viewer
                    </summary>
                    <iframe
                      title={`${def.name} PDF preview`}
                      src={href(doc)}
                      loading="lazy"
                      className="mt-3 h-[40rem] w-full rounded-md border bg-muted"
                    />
                  </details>
                </CardContent>
                <CardFooter className="flex-wrap">
                  <Button asChild size="sm">
                    <a href={href(doc)} target="_blank" rel="noopener">
                      <ExternalLink aria-hidden="true" />
                      Open PDF<span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <a href={href(doc, 'download=1')}>
                      <Download aria-hidden="true" />
                      Download
                    </a>
                  </Button>
                  <code className="ml-auto text-xs text-muted-foreground">/dev/preview/pdf/{doc}</code>
                </CardFooter>
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}
