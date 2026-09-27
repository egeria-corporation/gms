// SPDX-License-Identifier: AGPL-3.0-only
// H-01 Email preview: one template rendered server-side with the workspace brand (or a fictional preset).
import {
  previewProps,
  renderEmail,
  TEMPLATE_KEYS,
  templates,
  type RenderedEmail,
  type TemplateKey,
} from '@gms/email';
import { Alert, Badge, DescriptionList, ErrorState, PageHeader, Section, cn } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { one } from '@/lib/site';
import { BrandSwitcher } from '../../brand-switcher';
import { isPreset, previewBrand } from '../../preview-brand';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ template: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function isTemplateKey(v: string): v is TemplateKey {
  return (TEMPLATE_KEYS as string[]).includes(v);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { template } = await params;
  return { title: isTemplateKey(template) ? `Email: ${templates[template].name}` : 'Email preview' };
}

export default async function EmailPreview({ params, searchParams }: Props) {
  const { template } = await params;
  if (!isTemplateKey(template)) notFound();
  const sp = await searchParams;
  const requested = one(sp.brand);
  const narrow = one(sp.width) === 'narrow';
  const { brand, choice, hasWorkspace } = await previewBrand(requested);
  const def = templates[template];
  let email: RenderedEmail | null = null;
  let renderError: string | null = null;
  try {
    email = await renderEmail(template, previewProps[template], brand);
  } catch (e) {
    renderError = e instanceof Error ? e.message : String(e);
  }

  const query = (next: { brand?: string; width?: string }) => {
    const p = new URLSearchParams();
    const b = next.brand ?? (isPreset(requested) ? requested : undefined);
    if (b && b !== 'workspace') p.set('brand', b);
    const w = next.width ?? (narrow ? 'narrow' : undefined);
    if (w && w !== 'wide') p.set('width', w);
    const s = p.toString();
    return `/dev/preview/email/${template}${s ? `?${s}` : ''}`;
  };

  const index = TEMPLATE_KEYS.indexOf(template);
  const prev = TEMPLATE_KEYS[index - 1];
  const next = TEMPLATE_KEYS[index + 1];

  return (
    <>
      <PageHeader
        title={def.name}
        description={def.description}
        breadcrumbs={[
          { label: 'Screen catalog', href: '/dev/catalog' },
          {
            label: 'Email previews',
            href: isPreset(requested) ? `/dev/preview/email?brand=${requested}` : '/dev/preview/email',
          },
          { label: def.name },
        ]}
        meta={<Badge variant="outline">{template}</Badge>}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <BrandSwitcher current={choice} hasWorkspace={hasWorkspace} hrefFor={(c) => query({ brand: c })} />
        <nav aria-label="Preview width" className="flex items-center gap-1.5 text-sm">
          <span className="mr-1 text-muted-foreground">Width:</span>
          {(['wide', 'narrow'] as const).map((w) => {
            const active = (w === 'narrow') === narrow;
            return (
              <Link
                key={w}
                href={query({ width: w })}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'rounded-md border px-2 py-1 hover:bg-muted',
                  active && 'border-primary bg-accent font-medium text-accent-foreground',
                )}
              >
                {w === 'wide' ? 'Desktop' : 'Phone (375px)'}
              </Link>
            );
          })}
        </nav>
      </div>

      {!hasWorkspace ? (
        <Alert variant="info" title="No workspace on this host">
          Showing a fictional brand. Open this page on a workspace host (for example halcyon.localhost:3000)
          to preview that workspace&rsquo;s brand.
        </Alert>
      ) : null}

      {renderError ? (
        <ErrorState
          title="This email couldn't be rendered"
          description={
            <>
              <p>{renderError}</p>
              <p className="mt-2">
                If it mentions react-dom/server or &ldquo;reading &lsquo;H&rsquo;&rdquo;, the React Email
                renderer is being bundled into the React Server Components layer. Add
                <code className="mx-1">@react-email/render</code>to <code>serverExternalPackages</code> in
                next.config.ts.
              </p>
            </>
          }
        />
      ) : null}

      {email ? (
        <>
          <Section title="Envelope" card>
            <DescriptionList
              items={[
                { term: 'Subject', detail: email.subject },
                { term: 'From', detail: brand.displayName },
                {
                  term: 'Audience',
                  detail:
                    def.audience === 'staff'
                      ? 'Staff'
                      : def.audience === 'applicant'
                        ? 'Applicants'
                        : 'Anyone',
                },
                {
                  term: 'Brand colors',
                  detail: `${brand.primaryColor} primary · ${brand.accentColor} accent`,
                },
              ]}
            />
          </Section>

          <Section
            title="HTML part"
            description="Sandboxed: no scripts, no same-origin access. Links inside the preview are inert."
          >
            <div className="rounded-lg border bg-muted p-3">
              <iframe
                title={`HTML preview of the “${def.name}” email`}
                srcDoc={email.html}
                sandbox=""
                className={cn(
                  'mx-auto block h-[52rem] rounded-md border bg-card',
                  narrow ? 'w-[375px] max-w-full' : 'w-full',
                )}
              />
            </div>
          </Section>

          <Section title="Plain-text part">
            <pre
              className="max-h-[36rem] overflow-auto rounded-lg border bg-card p-4 text-sm whitespace-pre-wrap"
              data-testid="email-text"
            >
              {email.text}
            </pre>
          </Section>
        </>
      ) : null}

      <nav aria-label="Other templates" className="flex flex-wrap justify-between gap-2 text-sm">
        {prev ? (
          <Link
            href={`/dev/preview/email/${prev}${isPreset(requested) ? `?brand=${requested}` : ''}`}
            className="text-link underline-offset-4 hover:underline"
          >
            ← {templates[prev].name}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/dev/preview/email/${next}${isPreset(requested) ? `?brand=${requested}` : ''}`}
            className="text-link underline-offset-4 hover:underline"
          >
            {templates[next].name} →
          </Link>
        ) : null}
      </nav>
    </>
  );
}
