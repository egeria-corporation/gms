// SPDX-License-Identifier: AGPL-3.0-or-later
// DS-01…DS-06 Design system: tokens & theming, components, form renderer modes, status & actors, shells, system states.
// Jump with #ds-01 … #ds-06, or render a single section with ?section=ds-0N.
import { Button, PageHeader } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { one } from '@/lib/site';
import { getTenant } from '@/lib/tenant';
import { ComponentsSection } from './components-section';
import { FormsSection } from './forms-section';
import { ShellsSection } from './shells-section';
import { StatesSection } from './states-section';
import { StatusSection } from './status-section';
import { TokensSection } from './tokens-section';

export const metadata: Metadata = { title: 'Design system' };
export const dynamic = 'force-dynamic';

const SECTIONS = [
  { id: 'ds-01', title: 'Tokens & theming' },
  { id: 'ds-02', title: 'Components' },
  { id: 'ds-03', title: 'Form renderer modes' },
  { id: 'ds-04', title: 'Status & actor system' },
  { id: 'ds-05', title: 'Shells' },
  { id: 'ds-06', title: 'System states' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

export default async function DesignSystemPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const requested = one(sp.section);
  const only = SECTIONS.some((s) => s.id === requested) ? (requested as SectionId) : null;
  const show = (id: SectionId) => only === null || only === id;
  const page = Math.min(13, Math.max(1, Number.parseInt(one(sp.page) ?? '1', 10) || 1));
  const tenant = show('ds-01') ? await getTenant() : null;

  return (
    <>
      <PageHeader
        title="Design system"
        description="The @gms/ui tokens, components and patterns every GMS surface is built from. Development only."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/dev/catalog">Screen catalog</Link>
            </Button>
            {only ? (
              <Button asChild variant="secondary" size="sm">
                <Link href="/dev/design-system">Show all sections</Link>
              </Button>
            ) : null}
          </>
        }
      />

      <nav aria-label="Design system sections" className="rounded-lg border bg-card p-4">
        <p className="mb-2 text-sm font-medium">On this page</p>
        <ol className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={only && only !== s.id ? `/dev/design-system?section=${s.id}` : `#${s.id}`}
                aria-current={only === s.id ? 'true' : undefined}
                className="flex gap-2 rounded-sm text-link underline-offset-4 hover:underline aria-[current=true]:font-semibold"
              >
                <span className="font-mono text-xs text-muted-foreground uppercase">{s.id}</span>
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="grid gap-14">
        {show('ds-01') ? <TokensSection tenant={tenant} /> : null}
        {show('ds-02') ? <ComponentsSection page={page} /> : null}
        {show('ds-03') ? <FormsSection /> : null}
        {show('ds-04') ? <StatusSection /> : null}
        {show('ds-05') ? <ShellsSection /> : null}
        {show('ds-06') ? <StatesSection /> : null}
      </div>
    </>
  );
}
