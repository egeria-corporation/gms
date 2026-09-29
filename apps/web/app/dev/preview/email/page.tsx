// SPDX-License-Identifier: AGPL-3.0-or-later
// H-01 Email previews: index of every transactional template.
import { TEMPLATE_KEYS, templates } from '@gms/email';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { one } from '@/lib/site';
import { BrandSwitcher } from '../brand-switcher';
import { isPreset, previewBrand } from '../preview-brand';

export const metadata: Metadata = { title: 'Email previews' };
export const dynamic = 'force-dynamic';

const AUDIENCE = { applicant: 'Applicants', staff: 'Staff', anyone: 'Anyone' } as const;

export default async function EmailPreviewIndex({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const requested = one((await searchParams).brand);
  const { choice, hasWorkspace } = await previewBrand(requested);
  const q = isPreset(requested) ? `?brand=${requested}` : '';
  return (
    <>
      <PageHeader
        title="Email previews"
        description={`${TEMPLATE_KEYS.length} transactional emails rendered with sample data. Nothing is sent.`}
        breadcrumbs={[{ label: 'Screen catalog', href: '/dev/catalog' }, { label: 'Email previews' }]}
      />
      <BrandSwitcher
        current={choice}
        hasWorkspace={hasWorkspace}
        hrefFor={(c) => (c === 'workspace' ? '/dev/preview/email' : `/dev/preview/email?brand=${c}`)}
      />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TEMPLATE_KEYS.map((key) => {
          const t = templates[key];
          return (
            <li key={key}>
              <Card className="h-full">
                <CardHeader>
                  <CardTitle as="h2">
                    <Link
                      href={`/dev/preview/email/${key}${q}`}
                      className="rounded-sm underline-offset-4 hover:underline"
                    >
                      {t.name}
                    </Link>
                  </CardTitle>
                  <CardDescription>{t.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{AUDIENCE[t.audience]}</Badge>
                  <code className="text-xs text-muted-foreground">{key}</code>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}
